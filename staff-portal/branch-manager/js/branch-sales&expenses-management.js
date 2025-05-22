/* ===================================================================
   sales-module.js   –   CASH • CREDIT • PARTIAL PAYMENTS (v2)
   =================================================================== */
import {
  db, collection, collectionGroup, doc, getDoc, getDocs, setDoc,
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
salesForm.addEventListener("submit",saveSale);

async function saveSale(e){
  e.preventDefault();

  /* gather & validate rows --------------------------------------- */
  const rows=[...saleBody.querySelectorAll("tr")];
  if(!rows.length) return toast("Add items first","info");

  const items=rows.map(tr=>({
    productId:tr.dataset.pid,
    qty      :+tr.dataset.qty,
    disc     :+tr.dataset.disc,
    unit     :priceCache[tr.dataset.pid]||0
  }));

  /* stock check -------------------------------------------------- */
  for(const it of items){
    if(it.qty>(branchStock[it.productId]||0))
      return Swal.fire("Low Stock",
        `${productCache[it.productId]?.itemParticulars||it.productId} only ${(branchStock[it.productId]||0)} left`,
        "error");
  }

  /* numbers ------------------------------------------------------ */
  const sub = items.reduce((s,i)=>s+i.unit*i.qty*(1-i.disc/100),0);
  const oDiscPct = +overallDisc.value||0;
  const grand    = sub*(1-oDiscPct/100);

  const payType  = paymentSel.value;           // cash | credit
  const paidNow  = payType==="credit" ? Math.min(+paidNowInput.value||0, grand) : grand;
  const balance  = grand - paidNow;

  /* confirm ------------------------------------------------------ */
  if(!(await Swal.fire({title:"Confirm?",text:money(grand),icon:"question",showCancelButton:true})).isConfirmed)
      return;

  /* busy UI ------------------------------------------------------ */
  saleBtn.disabled=true; saleSpin.classList.remove("d-none"); saleTxt.textContent="Saving…";

  const saleId  = `SALE_${Date.now()}_${Math.floor(Math.random()*1000)}`;
  const customer= document.getElementById("custName").value.trim()||"Walk-in";

  try{
    await runTransaction(db,async tx=>{
      /* update stock + log --------------------------------------- */
      const refs = items.map(it=>doc(db,"companyBranches",branchId,"branchStock",it.productId));
      const snaps=await Promise.all(refs.map(r=>tx.get(r)));
      snaps.forEach((s,i)=>{
        if((s.data().quantity||0)<items[i].qty) throw new Error("Stock changed");
      });
      items.forEach((it,i)=>{
        const left=(snaps[i].data().quantity||0)-it.qty;
        left===0 ? tx.delete(refs[i])
                  : tx.update(refs[i],{quantity:left,updatedAt:serverTimestamp()});
        tx.set(doc(db,"companyBranches",branchId,"branchStockLogs",`${saleId}_${i}`),
          {type:"sale",productId:it.productId,quantity:it.qty,
           itemParticulars:productCache[it.productId]?.itemParticulars||"",
           performedBy:workerName,createdAt:serverTimestamp()});
      });

      /* parent sale ---------------------------------------------- */
      const saleRef=doc(db,"companyBranches",branchId,"branchSales",saleId);
      tx.set(saleRef,{
        saleId, customer, createdAt:serverTimestamp(), performedBy:workerName,
        paymentType : balance===0?"cash":"credit",
        status      : balance===0?"Cleared": paidNow?"Partial":"Unpaid",
        items, overallDiscountPct:oDiscPct,
        grandTotal:grand, paidAmount:paidNow, balanceDue:balance
      });

      /* immediate deposit sub-doc – ONLY for credit sales -------- */
      if(payType === "credit" && paidNow){
          tx.set(
            doc(collection(saleRef,"payments"),`PAY_${Date.now()}`),
          { amount: paidNow,
            method: "credit-deposit",
            paidAt: serverTimestamp(),
            paymentRecordedBy: workerName });
      }
    });

    toast("Sale successfully saved");
    buildReceipt(saleId,{customer,payType:balance? "Credit":"cash",items,oDiscPct,paidNow,balance});

    salesForm.reset(); saleBody.innerHTML=""; calcTotals(); paidNowInput.value="";
    paidNowWrap.classList.add("d-none");         // reset UX
  }catch(err){
    console.error(err); Swal.fire("Error",err.message,"error");
  }finally{
    saleBtn.disabled=false; saleSpin.classList.add("d-none"); saleTxt.textContent="Process Sale";
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

  <table class="table table-borderless table-sm mb-0">
    <thead class="table-light text-center">
      <tr><th>Item</th><th>Unit</th><th>Qty</th><th>↓%</th><th class="text-end">Total</th></tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table><hr class="m-0">

  <table class="w-100 small">
    <tr><td>Sub-Total</td><td class="text-end">${money(sub)}</td></tr>
    ${ oDiscPct ? `<tr><td>Overall Disc ${oDiscPct}%</td><td class="text-end">-${money(sub-grand)}</td></tr>` : "" }
    <tr><td><strong>Grand</strong></td><td class="text-end"><strong>${money(grand)}</strong></td></tr>
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
    payLabel: balance ? "Credit (partial)" : payType,
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
        const expId = `EXP_${Date.now()}`;
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
  query(collection(db,"companyBranches",branchId,"branchSales"),
        where("status","in",["Unpaid","Partial"]),
        orderBy("createdAt","desc")),
  snap=>{
    creditTbody.innerHTML="";
    snap.forEach(d=>{
      creditTbody.insertAdjacentHTML("beforeend",`
        <tr>
          <td>${d.id}</td>
          <td>${d.data().createdAt.toDate().toLocaleDateString()}</td>
          <td>${d.data().customer||"-"}</td>
          <td class="text-end">${money(d.data().balanceDue)}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary pay-btn"
                    data-id="${d.id}" data-bal="${d.data().balanceDue}">
              Add Payment
            </button>
          </td>
        </tr>`);
    });
});

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
        payLabel   : s.balanceDue === 0 ? "Cash" : "Credit (partial)",
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
   🖨️  PRINT FUNCTION – duplicate-safe, exact 72 mm width
   ================================================================= */
window.printHtmlReceipt = (html) => {
  if (document.getElementById("___printArea")) return; // prevent double prints

  const wrapper = document.createElement("div");
  wrapper.id = "___printArea";
  wrapper.innerHTML = html;

  wrapper.insertAdjacentHTML("beforeend", `
    <style>
      @media print {
        body > * { display:none !important; }
        #___printArea {
          display:block !important;
          position:fixed;
          inset:0;
          width:72mm;
          font-size:13px;
          margin:auto;
          background:white !important;
        }
      }
    </style>
  `);

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
   5️⃣  SALES REPORT – adds deposits as daily cash (sales + expenses + credit-deposits)
   ================================================================= */
document.getElementById("genSalesReport")
        .addEventListener("click", generateSalesReport);

async function generateSalesReport () {
  const btn  = document.getElementById("genSalesReport");
  const spin = document.getElementById("repSpin");
  const txt  = document.getElementById("repTxt");

  spin.classList.remove("d-none");
  txt.textContent = "Generating…";
  btn.disabled = true;

  try {
    /* 1. date range ------------------------------------------------ */
    const todayISO = new Date().toISOString().slice(0,10);
    const fromStr  = document.getElementById("repFrom").value || todayISO;
    const toStr    = document.getElementById("repTo").value   || todayISO;

    const start = new Date(fromStr + "T00:00:00");
    const end   = (fromStr === toStr) ? new Date()            // “today → now”
                                      : new Date(toStr + "T23:59:59");

    /* 2. fetch data in parallel ----------------------------------- */
    const [salesSnap, expSnap, paySnap] = await Promise.all([
      getDocs(query(
        collection(db,"companyBranches",branchId,"branchSales"),
        where("createdAt",">=",start), where("createdAt","<=",end)
      )),
      getDocs(query(
        collection(db,"companyBranches",branchId,"branchExpenses"),
        where("createdAt",">=",start), where("createdAt","<=",end)
      )),
      getDocs(query(
        collectionGroup(db,"payments"),
        where("method","==","credit-deposit"),
        where("paidAt",">=",start), where("paidAt","<=",end)
      ))
    ]);

    /* 3. build a quick lookup of sales already inside the range --- */
    const inRangeSaleIds = new Set( salesSnap.docs.map(d => d.id) );

    /* 4. aggregate sales per product ------------------------------ */
    const agg = new Map();         // productId → { name, qty, cash, credit }
    let  totalCash = 0, totalCredit = 0;

    salesSnap.forEach(s => {
      const sale        = s.data();
      const paidAmount  = sale.paidAmount  || 0;   // cash we have *right now*
      const balanceDue  = sale.balanceDue  || 0;   // outstanding credit

      totalCash   += paidAmount;
      totalCredit += balanceDue;

      /* proportionally spread discounts across items */
      const netWithoutOvr = sale.items
        .reduce((sum,i)=>sum + i.unit*i.qty*(1-i.disc/100), 0);
      const scale = netWithoutOvr ? sale.grandTotal / netWithoutOvr : 1;

      sale.items.forEach(it => {
        const net = it.unit * it.qty * (1 - it.disc/100) * scale;
        if (!agg.has(it.productId)) {
          agg.set(it.productId, {
            name   : productCache[it.productId]?.itemParticulars || "",
            qty    : 0,
            cash   : 0,
            credit : 0
          });
        }
        const rec   = agg.get(it.productId);
        const cashR = paidAmount  / sale.grandTotal;
        const credR = balanceDue  / sale.grandTotal;

        rec.qty    += it.qty;
        rec.cash   += net * cashR;
        rec.credit += net * credR;
      });
    });

    /* 5. add CREDIT-DEPOSIT payments that belong to THIS branch
          and whose parent sale is not already inside the range. */
    let depositsTotal = 0;
    paySnap.forEach(p => {
      const pathSeg   = p.ref.path.split("/");   // ["companyBranches", "{branchId}", …]
      const payBranch = pathSeg[1];              // branchId embedded in the path

      if (payBranch !== branchId) return;        // 🚫 skip payments from other branches

      const saleId = p.ref.parent.parent.id;     // parent sale document id
      if (!inRangeSaleIds.has(saleId)) {
        depositsTotal += p.data().amount || 0;
      }
    });
    totalCash += depositsTotal;

    /* 6. build expenses ------------------------------------------- */
    let expenseTotal = 0;
    const expRows = expSnap.docs.map(d => {
      expenseTotal += d.data().amount || 0;
      return `<tr><td>${d.data().note}</td><td class="">${(d.data().amount)}</td></tr>`;
    }).join("");

    /* 7. build sales rows ----------------------------------------- */
    const salesRows = [...agg.entries()].map(([id,r]) => `
      <tr>
        <td>${id}</td>
        <td>${r.name}</td>
        <td class="text-center">${r.qty}</td>
        <td class="text-end">${(r.cash)}</td>
        <td class="text-end">${(r.credit)}</td>
        <td>${workerName}</td>
      </tr>`).join("");

    /* 8. inject HTML --------------------------------------------- */
    document.getElementById("salesReportArea").innerHTML = `
      <div class="d-flex justify-content-end">
        <button class="btn btn-outline-primary btn-sm" onclick="printDiv('printReport')">
          <i class="bi bi-printer me-1"></i> Print Report
        </button>
      </div>

      <div id="printReport" class="p-3">
        <div class="text-center mb-2">
          <img src="/img/logoShareDisplay.jpeg" style="height:90px" alt="logo"><br>
          <h5>${branchName}</h5>
          <small>Sales & Cash Report (${start.toLocaleString()} → ${end.toLocaleString()})</small>
        </div>

        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr>
              <th>Code</th><th>Product</th><th>Qty</th>
              <th>Cash Sales(USh)</th><th>Credit Sales(USh)</th><th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            ${salesRows || `<tr><td colspan="6" class="text-center">No sales</td></tr>`}
          </tbody>
          <tfoot class="fw-bold">
            <tr>
              <td colspan="3" class="text-end">Total Cash</td>
              <td class="text-end">${money(totalCash)}</td><td colspan="2"></td>
            </tr>
            <tr>
              <td colspan="3" class="text-end">Total Credit (outstanding)</td>
              <td class="text-end">${money(totalCredit)}</td><td colspan="2"></td>
            </tr>
          </tfoot>
        </table>

        <h6 class="mt-4">Expenses</h6>
        <table class="table table-sm table-bordered">
          <thead class="table-light"><tr><th>Details</th><th>Amount (USh)</th></tr></thead>
          <tbody>
            ${expRows || `<tr><td colspan="2" class="text-center">No expenses</td></tr>`}
          </tbody>
          <tfoot class="fw-bold">
            <tr><td class="text-end">Total</td><td class="">${money(expenseTotal)}</td></tr>
          </tfoot>
        </table>

        <p class="text-end"><em>Net Cash (received)</em> ${money(totalCash - expenseTotal)}</p>
        <p class="text-end"><em>Prepared by:</em> ${workerName}</p>
      </div>
    `;
  } catch (err) {
    console.error(err);
    Swal.fire("Error", err.message, "error");
  } finally {
    spin.classList.add("d-none");
    txt.textContent = "Generate";
    btn.disabled = false;
  }
}



/* =================================================================
   6️⃣  PRINT HELPER  (unchanged tiny util)
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

  if (document.getElementById("___printArea")) return;

  const clone = target.cloneNode(true);

  const wrapper = document.createElement("div");
  wrapper.id = "___printArea";
  wrapper.style.position = "fixed";
  wrapper.style.top = 0;
  wrapper.style.left = 0;
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  wrapper.style.background = "white";
  wrapper.style.zIndex = 9999;
  wrapper.style.overflow = "auto";
  wrapper.style.display = "none";  // Hide on screen by default

  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // Print-only CSS: hide everything except #___printArea
  const style = document.createElement("style");
  style.textContent = `
    @media print {
      body > * {
        display: none !important;
      }
      #___printArea {
        display: block !important;
        position: fixed;
        inset:0;
        margin: auto;
        overflow: visible;
        background: white !important;
        z-index: 9999;
      }
    }
  `;
  wrapper.appendChild(style);

  const cleanUp = () => {
    wrapper.remove();
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);

  window.print();
};