/* ==========================================================
   Stock Management – robust, session-safe, Delete buttons only shown when stock is not yet allocated
   ========================================================== */
import {
  db,
  collection, doc, getDocs, setDoc,
  onSnapshot, query, where, runTransaction,
  serverTimestamp
} from "../../js/firebase-config.js";

/* ---------- DOM ---------- */
const stockForm  = document.getElementById("stockForm");
const tableBody  = document.getElementById("generalStockTableBody");
const productSel = document.getElementById("stockProductSelect");
const addBtn     = document.getElementById("addStockBtn");
const spinner    = document.getElementById("stockSpinner");
const btnText    = document.getElementById("stockBtnText");

/* ---------- Helpers ---------- */
const toast = (msg, icon = "success") =>
  Swal.fire({ toast: true, position: "top-end", timer: 2500, showConfirmButton: false, title: msg, icon });

const genBatchCode = () => {
  const n = new Date();
  return `SB${n.getFullYear()}${(n.getMonth() + 1).toString().padStart(2, "0")}${n.getDate().toString().padStart(2, "0")}${n.getHours()}${n.getMinutes()}${n.getSeconds()}`;
};

/* ---------- Cache product meta ---------- */
const productCache = {};
onSnapshot(collection(db, "companyProducts"), snap => {
  productSel.innerHTML = '<option value="">Select Product</option>';
  snap.forEach(d => {
    const data = d.data();
    productCache[d.id] = data;
    productSel.innerHTML += `<option value="${d.id}">${data.itemParticulars}</option>`;
  });
});

/* ---------- Add stock ---------- */
stockForm.addEventListener("submit", async e => {
  e.preventDefault();
  const productId = productSel.value;
  const qty       = parseInt(document.getElementById("stockQuantity").value, 10);
  const expiry    = document.getElementById("expiryDate").value;
  if (!(productId && qty > 0 && expiry))
    return Swal.fire("Missing fields", "Fill all inputs", "warning");

  if (!(await Swal.fire({
    title: "Confirm Addition!",
    text: "Add this batch?",
    icon: "question",
    showCancelButton: true
  })).isConfirmed) return;

  addBtn.disabled = true; spinner.classList.remove("d-none"); btnText.textContent = "Saving…";
  try {
    const batchId = genBatchCode();
    await setDoc(doc(db, "companyStock", batchId), {
      productId,
      batchCode: batchId,
      quantity: qty,
      remainingCompanyStockQuantity: qty,
      expiryDate: expiry,
      addedAt: serverTimestamp()
    });
    toast("Stock Batch added");
    stockForm.reset();
  } catch (err) {
    Swal.fire("Error", err.message, "error");
  } finally {
    addBtn.disabled = false;
    spinner.classList.add("d-none");
    btnText.textContent = "Add Stock";
  }
});

/* ---------- Render row ---------- */
function upsertStockRow(docId, stock) {
  if ((+stock.remainingCompanyStockQuantity || 0) <= 0) {
    document.getElementById(`row-${docId}`)?.remove();
    return;
  }

  const prod = productCache[stock.productId] || { itemCode: "N/A", itemParticulars: "Unknown" };
  const rowId = `row-${docId}`;
  const isDeletable = stock.quantity === stock.remainingCompanyStockQuantity;

  const actionCell = isDeletable
    ? `<button class="btn btn-sm btn-outline-danger" data-del="${docId}" data-prod="${stock.productId}">
         <i class="fas fa-trash-alt"></i> Delete
       </button>`
    : `<span class="badge bg-warning text-dark px-2">
         <i class="fas fa-lock me-1"></i> In Use
       </span>`;

  const html = `
    <tr id="${rowId}" class="recent-row">
      <td>${prod.itemCode}</td>
      <td>${prod.itemParticulars}</td>
      <td>${stock.batchCode}</td>
      <td>${stock.quantity}</td>
      <td>${stock.remainingCompanyStockQuantity}</td>
      <td>${stock.expiryDate}</td>
      <td>${actionCell}</td>
    </tr>`;

  const existing = document.getElementById(rowId);
  if (existing) {
    existing.outerHTML = html;
  } else {
    const allRows = [...tableBody.querySelectorAll("tr")];
    let inserted = false;

    for (const row of allRows) {
      const rowAddedAt = row.dataset.addedat;
      if (rowAddedAt && stock.addedAt?.seconds > parseInt(rowAddedAt)) {
        row.insertAdjacentHTML("beforebegin", html);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      tableBody.insertAdjacentHTML("beforeend", html);
    }
  }

  const el = document.getElementById(rowId);
  if (el && stock.addedAt?.seconds) {
    el.dataset.addedat = stock.addedAt.seconds.toString();
  }
}

/* ---------- Realtime table (fixed) ---------- */
onSnapshot(collection(db, "companyStock"), snap => {
  snap.docChanges().forEach(change => {
    const docId = change.doc.id;
    const stock = change.doc.data();

    if (change.type === "removed") {
      document.getElementById(`row-${docId}`)?.remove();
    } else {
      upsertStockRow(docId, stock);
    }
  });

  const rows = [...tableBody.querySelectorAll("tr")];
  rows.sort((a, b) => {
    const aTime = parseInt(a.dataset.addedat || "0");
    const bTime = parseInt(b.dataset.addedat || "0");
    return bTime - aTime;
  });
  rows.forEach(row => tableBody.appendChild(row));
});

/* ---------- Cascade delete handler ---------- */
tableBody.addEventListener("click", async e => {
  const btn = e.target.closest("button[data-del]");
  if (!btn) return;

  const batchId = btn.dataset.del;
  const productId = btn.dataset.prod;

  if (!(await Swal.fire({
    title: "Delete batch?",
    text: "All allocations & branch stock will adjust.",
    icon: "warning",
    showCancelButton: true
  })).isConfirmed) return;

  try {
    const allocQuery = query(collection(db, "allocatedStockToBranches"), where("batchId", "==", batchId));
    const allocSnap = await getDocs(allocQuery);

    await runTransaction(db, async t => {
      const batchRef = doc(db, "companyStock", batchId);
      const batchSnap = await t.get(batchRef);
      if (!batchSnap.exists()) throw new Error("Batch already removed.");

      for (const alloc of allocSnap.docs) {
        const { branchId, quantityAllocated } = alloc.data();
        const allocRef = doc(db, "allocatedStockToBranches", alloc.id);
        const branchStockRef = doc(db, "companyBranches", branchId, "branchStock", productId);

        const bSnap = await t.get(branchStockRef);
        const cur = bSnap.exists() ? bSnap.data().quantity : 0;
        const newQ = cur - quantityAllocated;
        if (newQ < 0) throw new Error("Branch stock inconsistency.");

        if (newQ === 0) t.delete(branchStockRef);
        else t.update(branchStockRef, { quantity: newQ, updatedAt: serverTimestamp() });

        t.delete(allocRef);
      }

      t.delete(batchRef);
    });

    toast("Stock Batch & allocations deleted", "info");
  } catch (err) {
    Swal.fire("Error", err.message, "error");
  }
});
