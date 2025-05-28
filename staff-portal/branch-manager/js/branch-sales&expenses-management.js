/* ===================================================================
   sales-module.js   –   CASH • CREDIT • PARTIAL PAYMENTS (v2)
   =================================================================== */
import {
  db, collection, doc, getDoc, getDocs, setDoc,
  runTransaction, onSnapshot, serverTimestamp,
  query, where, orderBy
} from "../../js/firebase-config.js";

/* ── SESSION / BRANCH ───────────────────────────────────────────── */
// make sure the worker record is already in sessionStorage
await window.sessionReady;
const user        = JSON.parse(sessionStorage.getItem("user-information")||"{}");
const branchId    = user.branchId;
const branchName  = user.branchName;
const workerName  = user.fullName || "Unknown";
if(!branchId){ Swal.fire("Error","No branch in session","error"); throw new Error("no branch"); }

/* ── one-time branch profile (for receipt header) ───────────────── */
let branchProfile = { location:"", contact:"", email:"" };
getDoc(doc(db,"companyBranches",branchId))
  .then(s=>{ if(s.exists()) branchProfile={...branchProfile,...s.data()}; });

/* ── DOM refs – sale entry ─────────────────────────────────────── */
const productSel    = document.getElementById("branchProductSelect");
const saleBody      = document.querySelector("#saleItemsTable tbody");
const addRowBtn     = document.getElementById("addItemRow");

const paymentSel    = document.getElementById("paymentType");
const paidNowWrap   = document.getElementById("paidNowWrap");   // div (will toggle)
const paidNowInput  = document.getElementById("paidNow");       // input inside

const overallDisc   = document.getElementById("overallDisc");
const grandTotalEl  = document.getElementById("grandTotal");

const salesForm     = document.getElementById("salesForm");
const saleBtn       = document.getElementById("saveSaleBtn");
const saleSpin      = document.getElementById("saleSpin");
const saleTxt       = document.getElementById("saleTxt");

/* ── DOM – receipt / history / credit table ───────────────────── */
const receiptBody   = document.getElementById("receiptModalBody");
const receiptModal  = new bootstrap.Modal(document.getElementById("receiptModal"));
const creditTbody   = document.getElementById("creditTableBody");

/* credit-payment modal */
const payModal      = new bootstrap.Modal(document.getElementById("payModal"));
const payForm       = document.getElementById("payForm");
const paySaleIdInp  = document.getElementById("paySaleId");
const payBalEl      = document.getElementById("payBalance");
const payAmtInp     = document.getElementById("payAmount");
const payBtn        = document.getElementById("paySaveBtn");
const paySpin       = document.getElementById("paySpin");
const payTxt        = document.getElementById("payTxt");

/* ── local caches ─────────────────────────────────────────────── */
const productCache={}, priceCache={}; let branchStock={};

/* ── helpers ──────────────────────────────────────────────────── */
const toast=(m,icon="success")=>Swal.fire({toast:true,position:"top-end",timer:2500,showConfirmButton:false,title:m,icon});
const money=n=>n.toLocaleString("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0});

/* ── live caches: products + branch stock ─────────────────────── */
onSnapshot(collection(db,"companyProducts"), s=>{
  s.forEach(d=>{ productCache[d.id]=d.data(); priceCache[d.id]=+d.data().sellingPrice||0; });
});
onSnapshot(collection(db,"companyBranches",branchId,"branchStock"), s=>{
  branchStock={}; s.forEach(d=>branchStock[d.id]=d.data().quantity||0);
  refreshProductSelect();
});

/* ── toggle 'amount paid now' field --------------------------------*/
paymentSel.addEventListener("change",()=> {
  paidNowWrap.classList.toggle("d-none", paymentSel.value!=="credit");
});

/* ── build <select> options with items still in stock ───────────── */
function refreshProductSelect(){
  const opts = Object.entries(branchStock)
    .filter(([,q])=>q>0)
    .map(([id])=>`<option value="${id}">${productCache[id]?.itemParticulars||id}</option>`).join("");
  productSel.innerHTML = opts ? `<option value="">Choose</option>${opts}`
                              : `<option value="">No stock</option>`;
}

/* ── add row to sale table ─────────────────────────────────────── */
addRowBtn.onclick=()=>{ saleBody.insertAdjacentHTML("beforeend",rowHTML()); calcTotals(); };
const rowHTML=()=>`
<tr>
  <td><select class="form-select prodSel">${productSel.innerHTML}</select></td>
  <td class="unit">0</td>
  <td><input type="number" class="form-control qty" value="1" min="1"></td>
  <td><input type="number" class="form-control disc" value="0" min="0" max="100" placeholder="%"></td>
  <td class="lineTotal fw-bold">0</td>
  <td><button class="btn btn-sm btn-link text-danger remove">&times;</button></td>
</tr>`;

/* ── live totals -------------------------------------------------- */
saleBody.addEventListener("input",calcTotals);
saleBody.addEventListener("change",calcTotals);
saleBody.addEventListener("click",e=>{
  if(e.target.closest(".remove")){ e.target.closest("tr").remove(); calcTotals(); }
});
function calcTotals(){
  let sub=0;
  saleBody.querySelectorAll("tr").forEach(tr=>{
    const pid=tr.querySelector(".prodSel").value;
    const unit=priceCache[pid]||0;
    const qty =+tr.querySelector(".qty").value||0;
    const disc=+tr.querySelector(".disc").value||0;
    const line=unit*qty*(1-disc/100);
    tr.querySelector(".unit").textContent=money(unit);
    tr.querySelector(".lineTotal").textContent=money(line);
    Object.assign(tr.dataset,{pid,qty,disc,line});
    sub+=line;
  });
  grandTotalEl.value = money(sub*(1-(+overallDisc.value||0)/100));
}


/* =================================================================
   1️⃣  SAVE NEW SALE   (cash / credit / partial deposit)
   ================================================================= */
salesForm.addEventListener("submit", saveSale);

async function saveSale(e) {
  e.preventDefault();

  /* gather & validate rows --------------------------------------- */
  const rows = [...saleBody.querySelectorAll("tr")];
  if (!rows.length) return toast("Add items first", "info");

  const items = rows.map(tr => ({
    productId: tr.dataset.pid,
    qty      : +tr.dataset.qty,
    disc     : +tr.dataset.disc,
    unit     : priceCache[tr.dataset.pid] || 0
  }));

  /* 🔄 1) total quantity per product (handles duplicates) -------- */
  const totals = items.reduce((m, it) => {
    m[it.productId] = (m[it.productId] || 0) + it.qty;
    return m;
  }, {});

  /* stock check -------------------------------------------------- */
  for (const pid in totals) {
    if (totals[pid] > (branchStock[pid] || 0))
      return Swal.fire(
        "Low Stock",
        `${productCache[pid]?.itemParticulars || pid} only ${(branchStock[pid] || 0)} left`,
        "error"
      );
  }

  /* numbers ------------------------------------------------------ */
  const sub      = items.reduce((s, i) => s + i.unit * i.qty * (1 - i.disc / 100), 0);
  const oDiscPct = +overallDisc.value || 0;
  const grand    = sub * (1 - oDiscPct / 100);

  const payType  = paymentSel.value;        // cash | credit
  const paidNow  = payType === "credit" ? Math.min(+paidNowInput.value || 0, grand) : grand;
  const balance  = grand - paidNow;

  /* confirm ------------------------------------------------------ */
  if (!(await Swal.fire({
        title: "Confirm Sale?", text: money(grand),
        icon: "question", showCancelButton: true
      })).isConfirmed) return;

  /* busy UI ------------------------------------------------------ */
  saleBtn.disabled = true;
  saleSpin.classList.remove("d-none");
  saleTxt.textContent = "Saving…";

  const saleId  = `S${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const customer= document.getElementById("custName").value.trim() || "Walk-in";
  const customerContact= document.getElementById("custContact").value.trim() || "";

  try {
    await runTransaction(db, async tx => {
      /* ---------- A. update stock (one doc per product) ---------- */
      const uniquePids = Object.keys(totals);
      const refs       = uniquePids.map(pid => doc(db, "companyBranches", branchId, "branchStock", pid));
      const snaps      = await Promise.all(refs.map(r => tx.get(r)));

      snaps.forEach((s, i) => {
        const pid  = uniquePids[i];
        const need = totals[pid];
        if ((s.data().quantity || 0) < need) throw new Error("Stock changed");

        const left = (s.data().quantity || 0) - need;
        left === 0
          ? tx.delete(refs[i])
          : tx.update(refs[i], { quantity: left, updatedAt: serverTimestamp() });
      });

      /* ---------- B. logs (one per sale-row) --------------------- */
      items.forEach((it, idx) => {
        tx.set(
          doc(db, "companyBranches", branchId, "branchStockLogs", `${saleId}_${idx}`),
          {
            type: "sale",
            productId: it.productId,
            quantity : it.qty,
            itemParticulars: productCache[it.productId]?.itemParticulars || "",
            performedBy: workerName,
            note: customer,
            createdAt: serverTimestamp()
          }
        );
      });

      /* ---------- C. parent sale doc ----------------------------- */
      const saleRef = doc(db, "companyBranches", branchId, "branchSales", saleId);
      tx.set(saleRef, {
        saleId, customer, customerContact,
        createdAt  : serverTimestamp(),
        performedBy: workerName,
        paymentType: balance === 0 ? "cash" : "credit",
        status     : balance === 0 ? "Cleared" : paidNow ? "Partial" : "Unpaid",
        items,
        overallDiscountPct: oDiscPct,
        grandTotal: grand,
        paidAmount: paidNow,
        balanceDue: balance
      });

      /* ---------- D. optional deposit sub-doc -------------------- */
      if (payType === "credit" && paidNow) {
        tx.set(
          doc(collection(saleRef, "payments"), `PAY_${Date.now()}`),
          {
            amount: paidNow,
            method: "credit-deposit",
            paidAt: serverTimestamp(),
            paymentRecordedBy: workerName
          }
        );
      }
    });

    toast("Sale successfully saved");
    buildReceipt(saleId, {customer, payType: balance ? "Credit" : "Cash", items, oDiscPct, paidNow, balance });

    /* reset UI ---------------------------------------------------- */
    salesForm.reset();
    saleBody.innerHTML = "";
    calcTotals();
    paidNowInput.value = "";
    paidNowWrap.classList.add("d-none");

  } catch (err) {
    console.error(err);
    Swal.fire("Error", err.message, "error");
  } finally {
    saleBtn.disabled = false;
    saleSpin.classList.add("d-none");
    saleTxt.textContent = "Process Sale";
  }
}


/* =================================================================
    RECEIPT  (POS-friendly 72 mm, hides rows for cash sales)
   ── the HTML generator is now reused whenever a payment is added ──
================================================================= */

/* helper ───────────────────────────────────────────────────────── */
function renderReceiptHTML({
  saleId, customer, payLabel,
  items, oDiscPct = 0,
  paid = 0, balance = 0,
  when = new Date()
}) {

  const bodyRows = items.map(it => {
    const line = it.unit * it.qty * (1 - it.disc / 100);
    return `
      <tr>
        <td>${productCache[it.productId]?.itemParticulars || it.productId}</td>
        <td class="text-center">${it.unit}</td>
        <td class="text-center">${it.qty}</td>
        <td class="text-center">${it.disc}</td>
        <td class="text-end">${(line)}</td>
      </tr>`;
  }).join("");

  const sub   = items.reduce((s,i)=>s+i.unit*i.qty*(1-i.disc/100),0);
  const grand = sub * (1 - oDiscPct/100);

  /* hide Paid / Balance on cash sales */
  const extra = (paid < grand) ? `
      <tr><td>Paid</td><td class="text-end">${money(paid)}</td></tr>
      <tr><td>Balance</td><td class="text-end">${money(balance)}</td></tr>` : "";

  return `
<style>
  #receiptContent{max-width:72mm;font-size:13px}
  #receiptContent table{width:100%}
  #receiptContent th,#receiptContent td{padding:2px}
</style>

<section id="receiptContent">
  <div class="text-center">
    <img src="/img/logoShareDisplay.jpeg" style="height:90px" alt="logo"><br>
    ${branchName}<br>
    ${branchProfile.location}<br>
    ${branchProfile.contact}
  </div><hr>

  <div class="d-flex justify-content-between small">
    <span>No: ${saleId}</span>
    <span>${when.toLocaleString()}</span>
  </div>
  <div class="small mb-1">
    <b>Customer:</b> ${customer} | <b>${payLabel}</b>
  </div>

  <table class="table table-borderless table-sm mb-0" style="border:none !important;">
    <thead class="table-light text-center">
      <tr><th>Item</th><th>Unit</th><th>Qty</th><th>↓%</th><th class="text-end">Total</th></tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table><hr class="m-0">

  <table class="w-100 small">
    <tr><td>Sub-Total</td><td class="text-end">${money(sub)}</td></tr>
    ${ oDiscPct ? `<tr><td>Overall Disc ${oDiscPct}%</td><td class="text-end">-${money(sub-grand)}</td></tr>` : "" }
    <tr><td><strong>Grand Total</strong></td><td class="text-end"><strong>${money(grand)}</strong></td></tr>
    ${extra}
  </table><hr>
  <em><p class="text-center small m-0">Due to the concentration of minerals, <br> We advise not to take straight 
  mix with water or <br> fruit juice.</p>
  <p class="text-end   small m-0">Served by: ${workerName}</p></em>
</section>`;
}

/* original caller – builds, shows & stores the receipt */
function buildReceipt(
  id,
  { customer, payType, items, oDiscPct, paidNow = 0, balance = 0 }
){
  const html = renderReceiptHTML({
    saleId  : id,
    customer,
    payLabel: balance ? "Credit" : payType,
    items,
    oDiscPct,
    paid    : paidNow,
    balance
  });

  receiptBody.innerHTML = html;
  receiptModal.show();

  /* store / overwrite the copy kept in branchSalesReceipts */
  setDoc(
    doc(db,"companyBranches",branchId,"branchSalesReceipts",id),
    {
      html,
      grandTotal : items.reduce((s,i)=>s+i.unit*i.qty*(1-i.disc/100),0)*(1-oDiscPct/100),
      paidAmount : paidNow,
      balanceDue : balance,
      createdAt  : serverTimestamp(),
      updatedAt  : serverTimestamp()
    },
    { merge:true }
  );
}

document.getElementById("printReceiptModal").onclick = () => printDiv("receiptContent");


/* =================================================================
   2️⃣  SAVE NEW EXPENSE  (branchExpenses collection)
   ================================================================= */
{
  const expForm = document.getElementById("expenseForm");
  if (expForm) {
    /* field refs -------------------------------------------------- */
    const expNote = document.getElementById("expenseNote");
    const expAmt  = document.getElementById("expenseAmt");
    const expBtn  = document.getElementById("saveExpBtn");
    const expSpin = document.getElementById("expSpin");
    const expTxt  = document.getElementById("expTxt");

    expForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const note = expNote.value.trim();
      const amt  = +expAmt.value || 0;

      /* basic validation */
      if (!note || !amt) {
        return Swal.fire("Missing", "Enter both details and amount", "warning");
      }

      /* confirmation */
      const ok = await Swal.fire({
        title: "Confirm expense?",
        html: `<b>${note}</b><br>${money(amt)}`,
        icon: "question",
        showCancelButton: true
      });
      if (!ok.isConfirmed) return;

      /* busy UI */
      expBtn.disabled = true;
      expSpin.classList.remove("d-none");
      expTxt.textContent = "Saving…";

      try {
        const expId = `EXP${Date.now()}_${Math.floor(Math.random()*1000)}`;
        await setDoc(
          doc(db, "companyBranches", branchId, "branchExpenses", expId),
          {
            note,
            amount     : amt,
            recordedBy : workerName,
            createdAt  : serverTimestamp()
          }
        );
        toast("Expense saved");
        expForm.reset();
      } catch (err) {
        console.error(err);
        Swal.fire("Error", err.message, "error");
      } finally {
        expBtn.disabled = false;
        expSpin.classList.add("d-none");
        expTxt.textContent = "Save Expense";
      }
    });
  }
}


/* =================================================================
   3️⃣  OUTSTANDING CREDIT TABLE  (real-time)
   ================================================================= */
onSnapshot(
  query(
    collection(db, "companyBranches", branchId, "branchSales"),
    where("status", "in", ["Unpaid", "Partial"]),
    orderBy("createdAt", "desc")
  ),
  (snap) => {
    creditTbody.innerHTML = ""; // clear table body

    if (snap.size === 0) {
      // No records found — show message row
      creditTbody.insertAdjacentHTML(
        "beforeend",
        `<tr>
           <td colspan="5" class="text-center text-muted fst-italic">
             No outstanding credit
           </td>
         </tr>`
      );
    } else {
      // Records found — list them
      snap.forEach((d) => {
        creditTbody.insertAdjacentHTML(
          "beforeend",
          `<tr>
             <td>${d.id}</td>
             <td>${d.data().createdAt.toDate().toLocaleDateString()}</td>
             <td>${d.data().customer || "-"}</td>
             <td>${d.data().customerContact || "-"}</td>
             <td class="text-end">${money(d.data().balanceDue)}</td>
             <td class="text-end">
               <button class="btn btn-sm btn-outline-primary pay-btn"
                       data-id="${d.id}" data-bal="${d.data().balanceDue}">
                 <i class="fas fa-plus-circle"></i> Offset
               </button>
             </td>
           </tr>`
        );
      });
    }
  }
);

/* open pay-modal -------------------------------------------------- */
creditTbody.addEventListener("click",e=>{
  const btn=e.target.closest(".pay-btn"); if(!btn) return;
  paySaleIdInp.value=btn.dataset.id;
  payBalEl.textContent=money(+btn.dataset.bal);
  payAmtInp.max=+btn.dataset.bal; payAmtInp.value="";
  payModal.show();
});

/* =================================================================
   4️⃣  SAVE A DEPOSIT (transaction)
   ================================================================= */
payForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const saleId=paySaleIdInp.value;
  const payAmt=+payAmtInp.value||0;
  if(!payAmt) return Swal.fire("Enter amount","","warning");

  payBtn.disabled=true; paySpin.classList.remove("d-none"); payTxt.textContent="Saving…";
  try{
    await runTransaction(db,async tx=>{
      const saleRef=doc(db,"companyBranches",branchId,"branchSales",saleId);
      const snap=await tx.get(saleRef);
      if(!snap.exists()) throw new Error("Sale missing");
      const sale=snap.data();
      if(payAmt>sale.balanceDue) throw new Error("Exceeds balance");

      /* sub-doc */
      tx.set(
        doc(collection(saleRef,"payments"),`PAY_${Date.now()}`),
          { amount: payAmt, method: "credit-deposit", 
            paidAt: serverTimestamp(), 
            paymentRecordedBy: workerName });
      /* parent */
      const newPaid=(sale.paidAmount||0)+payAmt;
      const newBal = sale.balanceDue-payAmt;
      tx.update(saleRef,{
        paidAmount:newPaid,balanceDue:newBal,
        paymentType:newBal===0?"cash":sale.paymentType,
        status:newBal===0?"Cleared":"Partial"
      });
    });

    toast("Payment recorded");
    payModal.hide();

    /* 🔄  regenerate the stored receipt */
    const saleSnap = await getDoc(
      doc(db,"companyBranches",branchId,"branchSales",saleId)
    );
    if (saleSnap.exists()) {
      const s = saleSnap.data();

      const html = renderReceiptHTML({
        saleId,
        customer   : s.customer,
        payLabel   : s.balanceDue === 0 ? "Cash" : "Credit",
        items      : s.items,
        oDiscPct   : s.overallDiscountPct,
        paidAmount : s.paidAmount,
        balance    : s.balanceDue,
        when       : s.createdAt?.toDate() || new Date()
      });

      await setDoc(
        doc(db,"companyBranches",branchId,"branchSalesReceipts",saleId),
        {
          html,
          grandTotal : s.grandTotal,
          paidAmount : s.paidAmount,
          balanceDue : s.balanceDue,
          updatedAt  : serverTimestamp()
        },
        { merge:true }
      );
    }
  }catch(err){ console.error(err); Swal.fire("Error",err.message,"error"); }
  finally{ payBtn.disabled=false; paySpin.classList.add("d-none"); payTxt.textContent="Save Payment"; }
});


/* ================================================================
   📄  RECEIPT VIEW / PRINT – branch scoped, POS 72 mm
   ================================================================= */
(async () => {
  await window.sessionReady;                    // ensure branchId is ready

  const listEl   = document.getElementById("receiptPreviewContainer");
  if (!listEl) return console.warn("receiptPreviewContainer not found");

  const fromEl   = document.getElementById("receiptDateFrom");
  const toEl     = document.getElementById("receiptDateTo");
  const searchEl = document.getElementById("receiptSearch");
  const filterBtn= document.getElementById("filterReceiptsBtn");

  /* set “today” as default in the two date inputs */
  const todayISO = new Date().toISOString().slice(0,10);
  if (fromEl && !fromEl.value) fromEl.value = todayISO;
  if (toEl   && !toEl.value)   toEl.value   = todayISO;

  let receipts = [];

  filterBtn?.addEventListener("click", loadReceipts);
  window.addEventListener("DOMContentLoaded", loadReceipts);

  listEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-idx]");
    if (!btn) return;
    const r = receipts[+btn.dataset.idx];
    r?.html && printHtmlReceipt(r.html);
  });

  /* -------------------------------------------------------------- */
  async function loadReceipts () {
    listEl.innerHTML =
      `<div class="text-center my-4"><div class="spinner-border text-primary"></div></div>`;

    const start = new Date((fromEl?.value || todayISO) + "T00:00:00");
    const end   = (toEl?.value)
                    ? new Date(toEl.value + "T23:59:59")
                    : new Date();
    if (start > end) {
      listEl.innerHTML = `<p class="text-danger">"From" date cannot be after "To" date.</p>`;
      return;
    }

    const q = searchEl?.value.trim().toLowerCase() || "";

    try {
      const snap = await getDocs(
        query(
          collection(db, "companyBranches", branchId, "branchSalesReceipts"),
          where("createdAt", ">=", start),
          where("createdAt", "<=", end),
          orderBy("createdAt", "desc")
        )
      );

      receipts = [];
      const cards = [];

      snap.forEach(doc => {
        const r = doc.data();
        if (q && !r.html?.toLowerCase().includes(q)) return;
        receipts.push(r);
        cards.push(renderCard(receipts.length - 1, r));
      });

      listEl.innerHTML = cards.length
        ? cards.join("")
        : "<p class='text-muted'>No receipts found for this period.</p>";

    } catch (err) {
      console.error("Load error:", err);
      listEl.innerHTML = `<p class="text-danger">Failed to load receipts.</p>`;
    }
  }

  /* small card preview ------------------------------------------------ */
  const renderCard = (idx, r) => `
    <div class="border rounded shadow-sm p-2 mb-3 bg-white">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <small class="text-muted"><b>${ formatTS(r.createdAt) }</b></small>
        <button class="btn btn-sm btn-outline-dark" data-idx="${idx}">🖨️ Print</button>
      </div>
      <div class="small border-top pt-2" style="max-height:180px;overflow:auto;">
        ${r.html}
      </div>
    </div>`;

  const formatTS = ts =>
    ts?.toDate?.().toLocaleString("en-UG", {
      dateStyle: "short",
      timeStyle: "short"
    }) ?? "-";
})();

/* ================================================================
   🖨️  PRINT FUNCTION – duplicate-safe, 72 mm, invisible on-screen
   ================================================================= */
window.printHtmlReceipt = (html) => {
  if (document.getElementById("___printArea")) return;    // stop double-clicks
  const wrapper = document.createElement("div");
  wrapper.id = "___printArea";
  wrapper.innerHTML = html;
  /* hide on screen, but let @media print override it */
  wrapper.style.display = "none";
  wrapper.insertAdjacentHTML(
    "beforeend",
    `<style>
       @media print {
         body > * { display: none !important; }
         #___printArea {
           display: block !important;
           position: fixed !important;
           inset: 0;
           width: 72mm;
           font-size: 13px;
           margin: auto;
           background: white !important;
         }
       }
     </style>`
  );
  document.body.appendChild(wrapper);
  const clean = () => {
    wrapper.remove();
    window.removeEventListener("afterprint", clean);
  };
  window.addEventListener("afterprint", clean);
  try {
    window.print();
  } catch (e) {
    console.error("Print failed:", e);
    clean();
  }
};


/* =================================================================
   5️⃣  SALES REPORT  –  deposit-aware, sorted, “top seller” per item
   ================================================================= */
document.getElementById("genSalesReport")
        .addEventListener("click", generateSalesReport);

async function generateSalesReport () {
  const btn  = document.getElementById("genSalesReport");
  const salesReportArea = document.getElementById("salesReportArea");

  /* UX ---------------------------------------------------------------- */
  btn.disabled = true;
  salesReportArea.innerHTML = `
    <div class="text-center my-3">
      <div class="spinner-border text-primary"></div>
      <div class="mt-2">Generating…</div>
    </div>`;

  try {
    /* ---------- 1. date range (inclusive) ---------- */
    const start = (() => {
      const d = document.getElementById("repFrom").valueAsDate;
      return d ? new Date(d.setHours(0,0,0,0))
               : new Date(new Date().toISOString().slice(0,10)+"T00:00:00");
    })();
    const end = (() => {
      const d = document.getElementById("repTo").valueAsDate;
      return d ? new Date(d.setHours(23,59,59,999)) : new Date();
    })();

    if (start > end) {
      await Swal.fire("Invalid range","‘From’ date is after ‘To’ date","warning");
      return;
    }

    /* ---------- 2. parallel reads ---------- */
    const [ salesSnap , expSnap ] = await Promise.all([
      getDocs(query(
        collection(db,"companyBranches",branchId,"branchSales"),
        where("createdAt",">=",start), where("createdAt","<=",end)
      )),
      getDocs(query(
        collection(db,"companyBranches",branchId,"branchExpenses"),
        where("createdAt",">=",start), where("createdAt","<=",end)
      ))
    ]);

    /* ---------- 3. aggregate sales ---------- */
    const agg   = new Map();   // pid → { name, qty, cash, credit, sellers: Map(person → qty) }
    let totalCash=0, totalCred=0;

    salesSnap.forEach(doc=>{
      const s = doc.data();
      const paid = +s.paidAmount  || 0;
      const bal  = +s.balanceDue  || 0;

      totalCash   += paid;
      totalCred   += bal;

      /* weight for each item toward cash / credit */
      const netNoOvr = s.items.reduce((t,i)=>t+i.unit*i.qty*(1-i.disc/100),0);
      const scale    = netNoOvr ? s.grandTotal/netNoOvr : 1;
      const cashR    = paid   / s.grandTotal;
      const credR    = bal    / s.grandTotal;

      s.items.forEach(it=>{
        const rec = agg.get(it.productId) || {
          name    : productCache[it.productId]?.itemParticulars || "",
          qty     : 0, cash:0, credit:0,
          sellers : new Map()
        };

        const net = it.unit*it.qty*(1-it.disc/100)*scale;
        rec.qty    += it.qty;
        rec.cash   += net * cashR;
        rec.credit += net * credR;

        // seller stats
        const seller = s.performedBy || "N/A";
        rec.sellers.set(seller, (rec.sellers.get(seller)||0)+it.qty);

        agg.set(it.productId, rec);
      });
    });

    /* ---------- 4. expenses ---------- */
    let expenseTot = 0;
    const expRows  = expSnap.docs.map(d=>{
      const amt = +d.data().amount||0;
      expenseTot += amt;
      return `<tr><td>${d.data().note}</td><td>${(amt)}</td></tr>`;
    }).join("");

    /* ---------- 5. build & sort sales rows ---------- */
    const rows = [...agg.entries()]
      .sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}))   // by Item Code
      .map(([pid,r])=>{
        // pick top-seller
        let topSeller = "—";
        if (r.sellers.size){
          topSeller = [...r.sellers.entries()]
                        .sort((a,b)=>b[1]-a[1])[0][0];   // highest qty
        }
        return `<tr>
          <td>${pid}</td>
          <td>${r.name}</td>
          <td class="text-center">${r.qty}</td>
          <td class="text-end">${(r.cash)}</td>
          <td class="text-end">${(r.credit)}</td>
          <td>${topSeller}</td>
        </tr>`;
      }).join("");

    /* ---------- 6. print-ready HTML ---------- */
    salesReportArea.innerHTML = `
      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-outline-primary btn-sm" onclick="printDiv('printReport')">
          <i class="bi bi-printer me-1"></i> Print Report
        </button>
      </div>

      <div id="printReport" class="p-3">
        <div class="text-center mb-2">
          <img src="/img/logoShareDisplay.jpeg" style="height:90px" alt="logo"><br>
          <h5>${branchName}</h5>
          <small>Sales & Cash Movement Report (${start.toLocaleString()} → ${end.toLocaleString()})</small>
        </div>

        <div class="table-responsive">
          <table class="table table-sm table-bordered">
            <thead class="table-light">
              <tr>
                <th>Item Code</th><th>Item Particulars</th><th>Qty Sold</th>
                <th class="text-end">Cash Sales(USh)</th><th class="text-end">Credit Sales(USh)</th>
                <th>Processed By</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="6" class="text-center">No sales</td></tr>`}
            </tbody>
            <tfoot class="fw-bold">
              <tr>
                <td colspan="3" class="text-end">Total Cash</td>
                <td class="text-end">${money(totalCash)}</td><td colspan="2"></td>
              </tr>
              <tr>
                <td colspan="3" class="text-end">Outstanding Credit</td>
                <td class="text-end">${money(totalCred)}</td><td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <h6 class="mt-4">Expenses</h6>
        <div class="table-responsive">
          <table class="table table-sm table-bordered">
            <thead class="table-light"><tr><th>Details</th><th>Amount(USh)</th></tr></thead>
            <tbody>${expRows || `<tr><td colspan="2" class="text-center">No expenses</td></tr>`}</tbody>
            <tfoot class="fw-bold"><tr><td class="text-end">Total</td><td>${money(expenseTot)}</td></tr></tfoot>
          </table>
        </div>

        <p class="text-end"><em>Net Cash (Received)</em> ${money(totalCash - expenseTot)}</p>
        <p class="text-end"><em>Prepared by:</em> ${workerName}</p>
      </div>`;
  } catch (err) {
    console.error(err);
    Swal.fire("Error", err.message, "error");
  } finally {
    btn.disabled = false;
  }
}


/* =================================================================
   6️⃣  PRINT HELPER – preserves original layout/styles
   ================================================================= */
window.printDiv = (id) => {
  const target = document.getElementById(id);
  if (!target) {
    console.error(`printDiv: element #${id} not found`);
    if (typeof Swal !== "undefined" && Swal.fire) {
      Swal.fire("Print error", `Element #${id} not found`, "error");
    } else {
      alert(`Element #${id} not found`);
    }
    return;
  }
  // Avoid duplicate print areas
  if (document.getElementById("___printArea")) return;
  const clone = target.cloneNode(true);
  // Wrapper that holds the cloned content during print
  const wrapper = document.createElement("div");
  wrapper.id = "___printArea";
  Object.assign(wrapper.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    background: "white",
    zIndex: 9999,
    overflow: "auto",
    display: "none" // Stay hidden on screen
  });
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  // Print-only CSS: hide everything else, show only #___printArea
  const style = document.createElement("style");
  style.textContent = `
    @media print {
      body > * { display: none !important; }
      #___printArea {
        display: block !important;
        position: fixed;
        inset: 0;
        margin: 0;
        padding: 0;
        background: white !important;
        z-index: 9999;
      }
    }
  `;
  wrapper.appendChild(style);
  // Remove after print
  const cleanUp = () => {
    wrapper.remove();
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);
  window.print();
};
