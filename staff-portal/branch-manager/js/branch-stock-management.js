// Load Products with Available Stock
import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  runTransaction, onSnapshot, query, where, orderBy, serverTimestamp
} from "../../js/firebase-config.js";

const userInfo = JSON.parse(sessionStorage.getItem("user-information") || "{}");
const branchId = userInfo.branchId;
const branchName = userInfo.branchName;
const performedBy = userInfo.fullName || "Unknown User";

if (!branchId) Swal.fire("Error", "No branch found in session", "error");

const productSel = document.getElementById("branchProductSelect");
const qtyField = document.getElementById("moveQty");
const noteField = document.getElementById("moveNote");
const targetWrap = document.getElementById("targetBranchWrap");
const targetSel = document.getElementById("targetBranchSelect");
const form = document.getElementById("movementForm");
const btn = document.getElementById("submitMove");
const spin = document.getElementById("moveSpinner");
const txt = document.getElementById("moveText");
const historyBody = document.getElementById("historyTableBody");

const productCache = {};

function updateProductSelect(snapshot) {
  const ids = snapshot.docs.filter(d => (d.data().quantity || 0) > 0).map(d => d.id);
  if (!ids.length) {
    productSel.innerHTML = '<option value="">No stock available</option>';
    return;
  }
  getDocs(collection(db, "companyProducts")).then(productSnap => {
    productSel.innerHTML = '<option value="">Select Product</option>';
    productSnap.forEach(p => {
      if (ids.includes(p.id)) {
        const data = p.data();
        productCache[p.id] = data;
        productSel.innerHTML += `<option value="${p.id}">${data.itemParticulars}</option>`;
      }
    });
  });
}

onSnapshot(collection(db, "companyBranches", branchId, "branchStock"), updateProductSelect);

onSnapshot(collection(db, "companyBranches"), snap => {
  targetSel.innerHTML = '<option value="">Choose target branch</option>';
  snap.forEach(d => {
    if (d.id !== branchId) targetSel.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
  });
});

// Transfer Movement Submission
form.addEventListener("submit", async e => {
  e.preventDefault();
  const productId = productSel.value;
  const qty = parseInt(qtyField.value, 10);
  const note = noteField.value.trim();
  const targetId = targetSel.value;

  if (!(productId && qty > 0 && targetId))
    return Swal.fire("Missing", "Fill all fields", "warning");

  const confirm = await Swal.fire({
    title: "Confirm Transfer",
    text: `Transfer ${qty} units of ${productCache[productId]?.itemParticulars || productId} to ${targetId}?`,
    icon: "question",
    showCancelButton: true
  });
  if (!confirm.isConfirmed) return;

  btn.disabled = true; spin.classList.remove("d-none"); txt.textContent = "Saving…";

  const now = Date.now();
  const logId = `BSL_${now}`;

  try {
    const sourceStockRef = doc(db, "companyBranches", branchId, "branchStock", productId);
    const targetStockRef = doc(db, "companyBranches", targetId, "branchStock", productId);
    const logRef = doc(db, "companyBranches", branchId, "branchStockLogs", logId);
    const targetLogRef = doc(db, "companyBranches", targetId, "branchStockLogs", `BSL_${now + 1}`);

    await runTransaction(db, async t => {
      const snap = await t.get(sourceStockRef);
      const tgtSnap = await t.get(targetStockRef);

      const current = snap.exists() ? snap.data().quantity : 0;
      const newQty = current - qty;
      if (newQty < 0) throw new Error("Not enough stock");

      const tgtQty = tgtSnap.exists() ? tgtSnap.data().quantity : 0;

      if (newQty === 0) t.delete(sourceStockRef);
      else t.set(sourceStockRef, {
        productId,
        quantity: newQty,
        updatedAt: serverTimestamp()
      }, { merge: true });

      t.set(logRef, {
        productId, quantity: qty, type: "transferOut", note,
        targetBranchId: targetId, performedBy, createdAt: serverTimestamp(),
        itemParticulars: productCache[productId]?.itemParticulars || ""
      });

      t.set(targetStockRef, {
        productId, quantity: tgtQty + qty, updatedAt: serverTimestamp()
      }, { merge: true });

      t.set(targetLogRef, {
        productId, quantity: qty, type: "transferIn", note: `From ${branchId}`,
        targetBranchId: branchId, performedBy, createdAt: serverTimestamp(),
        itemParticulars: productCache[productId]?.itemParticulars || ""
      });
    });

    Swal.fire("Saved!", "Transfer recorded successfully.", "success");
    form.reset(); targetWrap.classList.add("d-none");
  } catch (err) {
    Swal.fire("Error", err.message, "error");
  } finally {
    btn.disabled = false; spin.classList.add("d-none"); txt.textContent = "Save Movement";
  }
});

// Movement History Table
const q = query(
  collection(db, "companyBranches", branchId, "branchStockLogs"),
  orderBy("createdAt", "desc")
);

onSnapshot(q, snap => {
  historyBody.innerHTML = "";
  snap.forEach(d => {
    const l = d.data();
    const when = l.createdAt?.toDate().toLocaleString() || "";
    const target = l.type === "transferOut" ? `→ ${l.targetBranchId}` :
                   l.type === "transferIn" ? `← ${l.targetBranchId}` : "";
    const row = `<tr>
      <td>${when}</td>
      <td>${l.productId}</td>
      <td>${l.itemParticulars || ""}</td>
      <td>${l.type}</td>
      <td>${l.quantity}</td>
      <td>${l.note || ""} ${target}</td>
      <td>${l.performedBy || ""}</td>
    </tr>`;
    historyBody.insertAdjacentHTML("beforeend", row);
  });
});


/* ----------  Generate Stock‑Movement Report  ---------- */
const reportBtn  = document.getElementById("generateReport");
const reportArea = document.getElementById("reportArea");

reportBtn.addEventListener("click", generateReport);

async function generateReport () {
  /* date range: default = today 00:00 → now */
  const fromInp = document.getElementById("reportFrom");
  const toInp   = document.getElementById("reportTo");

  const fromDate = fromInp.value
        ? new Date(fromInp.value + "T00:00:00")
        : new Date(new Date().toISOString().split("T")[0] + "T00:00:00");

  const toDate   = toInp.value
        ? new Date(toInp.value)
        : new Date();                       // now

  /* UX: show spinner */
  reportBtn.disabled = true;
  reportArea.innerHTML = `
     <div class="text-center my-3">
       <div class="spinner-border text-primary"></div>
       <div class="mt-2">Generating report …</div>
     </div>`;

  /* ----- read movement logs (single source) ----- */
  const logsQ = query(
    collection(db, "companyBranches", branchId, "branchStockLogs"),
    where("createdAt", ">=",  fromDate),
    where("createdAt", "<=",  toDate)
  );
  const logsSnap = await getDocs(logsQ);

  /* aggregate */
  const agg = new Map();          // pid → {sales,in,out}
  const take = (pid, key, q) => {
    if (!agg.has(pid)) agg.set(pid, {sales:0,in:0,out:0});
    agg.get(pid)[key] += q;
  };

  logsSnap.forEach(l => {
    const d = l.data();
    if (d.type === "sale")        take(d.productId, "sales",       d.quantity);
    if (d.type === "transferIn")  take(d.productId, "in",          d.quantity);
    if (d.type === "transferOut") take(d.productId, "out",         d.quantity);
  });

  /* rows */
  const rows = [];
  for (const [pid, {sales, in:inn, out}] of agg) {
    const stockRef   = doc(db,"companyBranches",branchId,"branchStock",pid);
    const closeSnap  = await getDoc(stockRef);
    const closing    = closeSnap.exists() ? closeSnap.data().quantity : 0;
    const opening    = closing + out + sales - inn;

    const meta = productCache[pid] || {itemCode: pid, itemParticulars:""};
    rows.push(`
      <tr>
        <td>${meta.itemCode}</td>
        <td>${meta.itemParticulars}</td>
        <td>${opening}</td>
        <td>${sales}</td>
        <td>${out}</td>
        <td>${inn}</td>
        <td>${closing}</td>
      </tr>`);
  }

  /* render */
  reportArea.innerHTML = rows.length
    ? `
      <div class="d-flex justify-content-end"><button class="btn btn-outline-primary btn-sm" onclick="printDiv('reportContent')">
        <i class="bi bi-printer me-1"></i> Print Report
      </button></div>
      <div id="reportContent">
        <div class="text-center mb-2">
          <img src="/img/logoShareDisplay.jpeg" style="height:100px" alt="logo"><br>
          <h5>${branchName}</h5>
          <small>Stock Movement Report (${fromDate.toLocaleString()} ➜ ${toDate.toLocaleString()})</small>
        </div>

        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr>
              <th>Item Code</th><th>Item Particulars</th><th>Opening Stock</th>
              <th>Sales</th><th>Transfer Out</th><th>Transfer In</th><th>Closing Stock</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>

        <p class="text-end"><em>Prepared by:</em> ${performedBy}</p>
      </div>`
    : `<div class='alert alert-info'>No movement recorded in selected period.</div>`;

  reportBtn.disabled = false;
}


window.printReport = () => {
  const report = document.getElementById("reportContent");
  if (!report || !report.innerHTML.trim()) {
    return Swal.fire("Nothing to export", "Generate a report first.", "info");
  }

  const original = document.body.innerHTML;
  document.body.innerHTML = `
    <div style="margin: 20px; font-family: Arial, sans-serif;">
      ${report.innerHTML}
    </div>
  `;

  window.print();
  document.body.innerHTML = original;
};
