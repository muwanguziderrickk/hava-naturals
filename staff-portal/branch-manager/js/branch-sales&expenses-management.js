/* =====================================================
   sales‑module.js  (receipt in modal • full sales report)
===================================================== */
import {
  db, collection, doc, getDoc, getDocs, setDoc,
  runTransaction, onSnapshot, serverTimestamp,
  query, where, orderBy
} from "../../js/firebase-config.js";

/* ─── USER / BRANCH ─────────────────────────────────── */
const user        = JSON.parse(sessionStorage.getItem("user-information")||"{}");
const branchId    = user.branchId;
const branchName  = user.branchName;
const workerName  = user.fullName||"Unknown";
if (!branchId) Swal.fire("Error","No branch in session","error");
/* ---------- get branch profile once ------------------- */
let branchProfile = {
  location: '',
  contact: '',
  email: '',
};

(async () => {
  try {
    const snap = await getDoc(doc(db, 'companyBranches', branchId));
    if (snap.exists()) {
      branchProfile = { ...branchProfile, ...snap.data() };
    }
  } catch (err) {
    console.error('Cannot load branch profile:', err);
  }
})();


/* ─── DOM REFS ──────────────────────────────────────── */
const productSel   = document.getElementById("branchProductSelect");
const saleBody     = document.querySelector("#saleItemsTable tbody");
const addRowBtn    = document.getElementById("addItemRow");
const grandTotalEl = document.getElementById("grandTotal");
const overallDisc  = document.getElementById("overallDisc");
const salesForm    = document.getElementById("salesForm");
const saleBtn      = document.getElementById("saveSaleBtn");
const saleSpin     = document.getElementById("saleSpin");
const saleTxt      = document.getElementById("saleTxt");

const expenseForm  = document.getElementById("expenseForm");
const expBtn       = document.getElementById("saveExpBtn");
const expSpin      = document.getElementById("expSpin");
const expTxt       = document.getElementById("expTxt");

const historyBody  = document.getElementById("historyTableBody");
const receiptBody  = document.getElementById("receiptModalBody");        // 🆕
const receiptModal = new bootstrap.Modal(document.getElementById("receiptModal")); // 🆕

/* ─── CACHE ─────────────────────────────────────────── */
const productCache={}, priceCache={}; let branchStock={};

/* ─── HELPERS ───────────────────────────────────────── */
const toast =(m,icon="success")=>Swal.fire({toast:true,position:"top-end",timer:2200,showConfirmButton:false,title:m,icon});
const money =n=>n.toLocaleString("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:0});

/* ─── LIVE PRODUCTS & STOCK ─────────────────────────── */
onSnapshot(collection(db,"companyProducts"),s=>s.forEach(d=>{productCache[d.id]=d.data();priceCache[d.id]=+d.data().sellingPrice||0;}));
onSnapshot(collection(db,"companyBranches",branchId,"branchStock"),s=>{branchStock={};s.forEach(d=>branchStock[d.id]=d.data().quantity||0);refreshProductSelect();});

/* ─── PRODUCT SELECT ───────────────────────────────── */
function refreshProductSelect(){
  const opts=Object.entries(branchStock).filter(([,q])=>q>0).map(([id])=>`<option value="${id}">${productCache[id]?.itemParticulars||id}</option>`).join("");
  productSel.innerHTML=opts?`<option value="">Choose</option>${opts}`:`<option value="">No stock</option>`;
}

/* ─── SALE ROWS ─────────────────────────────────────── */
addRowBtn.onclick = ()=>{ saleBody.insertAdjacentHTML("beforeend",rowHTML()); calcTotals(); };
const rowHTML=()=>`
<tr>
  <td><select class="form-select prodSel">${productSel.innerHTML}</select></td>
  <td class="unit">0</td>
  <td><input type="number" class="form-control qty"  value="1" min="1"></td>
  <td><input type="number" class="form-control disc" value="0" min="0" max="100" placeholder="%"></td>
  <td class="lineTotal fw-bold">0</td>
  <td><button class="btn btn-sm btn-link text-danger remove">&times;</button></td>
</tr>`;

/* live calc */
saleBody.addEventListener("input",calcTotals);
saleBody.addEventListener("change",calcTotals);
saleBody.addEventListener("click",e=>{if(e.target.classList.contains("remove"))e.target.closest("tr").remove(),calcTotals();});

function calcTotals(){
  let sub=0;
  saleBody.querySelectorAll("tr").forEach(tr=>{
    const pid=tr.querySelector(".prodSel").value;
    const unit=priceCache[pid]||0;
    const qty =+tr.querySelector(".qty").value||0;
    const disc=+tr.querySelector(".disc").value||0;
    const line=Math.max(unit*qty*(1-disc/100),0);
    tr.querySelector(".unit").textContent=money(unit);
    tr.querySelector(".lineTotal").textContent=money(line);
    tr.dataset.pid=pid;tr.dataset.qty=qty;tr.dataset.line=line;tr.dataset.disc=disc;
    sub+=line;
  });
  const grand=Math.max(sub*(1-(+overallDisc.value||0)/100),0);
  grandTotalEl.value=money(grand);
}

/* ─── PROCESS SALE ─────────────────────────────────── */
salesForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const rows=[...saleBody.querySelectorAll("tr")];
  if(!rows.length)return toast("Add items first","info");

  const items=rows.map(tr=>({
    productId:tr.dataset.pid, qty:+tr.dataset.qty, disc:+tr.dataset.disc, unit:priceCache[tr.dataset.pid]||0
  }));

  // stock check
  for(const it of items)
    if(it.qty>(branchStock[it.productId]||0))
      return Swal.fire("Stock Low",`${productCache[it.productId]?.itemParticulars||it.productId} only ${(branchStock[it.productId]||0)} left`,"error");

  if(!(await Swal.fire({title:"Confirm Sale",icon:"question",showCancelButton:true})).isConfirmed)return;

  saleBtn.disabled=true;saleSpin.classList.remove("d-none");saleTxt.textContent="Processing…";
  const saleId=`SALE_${Date.now()}`;
  const payType=document.getElementById("paymentType").value;
  const oDiscPct=+overallDisc.value||0;
  const customer=document.getElementById("custName").value.trim()||"Walk‑in";

  try{
    await runTransaction(db,async t=>{
      /* READS first */
      const refs=items.map(it=>doc(db,"companyBranches",branchId,"branchStock",it.productId));
      const snaps=await Promise.all(refs.map(r=>t.get(r)));
      snaps.forEach((s,i)=>{if((s.data().quantity||0)<items[i].qty)throw new Error("Concurrent stock change");});

      /* WRITES */
      items.forEach((it,i)=>{
        const ref=refs[i];const left=(snaps[i].data().quantity||0)-it.qty;
        if(left===0)t.delete(ref);else t.update(ref,{quantity:left,updatedAt:serverTimestamp()});

        const logId=`BSL_${Date.now()}_${i}`;           // 🆕 predictable ID
        t.set(doc(db,"companyBranches",branchId,"branchStockLogs",logId),{
          type:"sale",productId:it.productId,quantity:it.qty,
          itemParticulars:productCache[it.productId]?.itemParticulars||"",
          performedBy:workerName,createdAt:serverTimestamp()
        });
      });

      const grand=items.reduce((s,i)=>s+i.unit*i.qty*(1-i.disc/100),0)*(1-oDiscPct/100);
      // sale document
      t.set(doc(db,"companyBranches",branchId,"branchSales",saleId),{
        saleId,customer,paymentType:payType,items,overallDiscountPct:oDiscPct,
        grandTotal:grand,createdAt:serverTimestamp(),performedBy:workerName
      });
    });

    toast("Sale recorded");
    buildReceipt(saleId,{customer,payType,items,oDiscPct});  // modal pops here
    salesForm.reset();saleBody.innerHTML="";calcTotals();
    // refreshProductSelect will auto‑update via branchStock snapshot

  }catch(err){Swal.fire("Error",err.message,"error");}
  finally{saleBtn.disabled=false;saleSpin.classList.add("d-none");saleTxt.textContent="Process Sale";}
});

/* ─── RECEIPT (modal) ──────────────────────────────── */
function buildReceipt(id,{customer,payType,items,oDiscPct}){
  /* row builder */
  const rows = items.map(it=>{
    const net = it.unit*it.qty*(1-it.disc/100);
    return `<tr>
      <td class="text-muted">${it.productId}</td>
      <td>${productCache[it.productId]?.itemParticulars||""}</td>
      <td class="text-end">${(it.unit)}</td>
      <td class="text-center">${it.qty}</td>
      <td class="text-end">${it.disc}%</td>
      <td class="text-end">${(net)}</td>
    </tr>`;
  }).join("");

  const sub   = items.reduce((s,i)=>s+i.unit*i.qty*(1-i.disc/100),0);
  const grand = sub * (1-oDiscPct/100);

  receiptBody.innerHTML = `
    <section id="receiptContent" class="p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="d-flex align-items-center gap-2">
          <img src="/img/logoShareDisplay.jpeg" style="height:100px" alt="logo">
          <div>
            <h5 class="m-0 fw-bold">Hava Naturals</h5>
            <small class="text-muted">${branchName}</small><br>
            <small class="text-muted">${branchProfile.location}</small><br>
            <small class="text-muted">${branchProfile.contact} | ${branchProfile.email}</small><br>
            <small class="text-muted">Website: www.havanaturals.life</small>
          </div>
        </div>
        <div class="text-end small">
          <div><b>Receipt&nbsp;No:</b> ${id}</div>
          <div>${(new Date()).toLocaleString()}</div>
        </div>
      </div><hr>

      <div class="mb-2 small">
        <b>Customer:</b> ${customer} &nbsp;|&nbsp;
        <b>Payment:</b> ${payType}
      </div>

      <table class="table table-bordered table-sm">
        <thead class="table-light text-center">
          <tr><th>ID</th><th>Name</th><th class="text-end">Unit (USh)</th>
              <th>Qty</th><th class="text-end">Disc %</th><th class="text-end">Total (USh)</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot class="fw-bold">
          <tr><td colspan="5" class="text-end">Sub‑Total</td><td class="text-end">${money(sub)}</td></tr>
          <tr><td colspan="5" class="text-end">Overall Discount ${oDiscPct}%</td><td class="text-end">${money(sub-grand)}</td></tr>
          <tr><td colspan="5" class="text-end">Grand Total</td><td class="text-end">${money(grand)}</td></tr>
        </tfoot>
      </table>

      <p class="text-center fst-italic small">“Due to the concentration of the minerals, <br> We advise do not
      drink straight mix with water or fruit juice.”</p>
      <p class="text-end small">Served by: ${workerName}</p>
    </section>
  `;
  receiptModal.show();

  /* store receipt html for archive */
  setDoc(
    doc(db, "companyBranches", branchId, "branchSalesReceipts", id), // ← this is key
    { html: receiptBody.innerHTML, createdAt: serverTimestamp(), grandTotal: grand },
    { merge: true }
  );
}


document.getElementById("printReceiptModal").onclick = () => printDiv("receiptContent");


/* ─── EXPENSE ───────────────────────────────────────── */
expenseForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const note=document.getElementById("expenseNote").value.trim();
  const amt =+document.getElementById("expenseAmt").value;
  if(!note||!amt)return;
  if(!(await Swal.fire({title:"Confirm expense?",text:money(amt),showCancelButton:true})).isConfirmed)return;

  expBtn.disabled=true;expSpin.classList.remove("d-none");expTxt.textContent="Saving…";
  const expId=`EXPENSE_${Date.now()}`;                              // 🆕
  try{
    await setDoc(doc(db,"companyBranches",branchId,"branchExpenses",expId),
      {note,amount:amt,createdAt:serverTimestamp(),recordedBy:workerName});
    toast("Expense saved","info");expenseForm.reset();
  }catch(err){Swal.fire("Error",err.message,"error");}
  finally{expBtn.disabled=false;expSpin.classList.add("d-none");expTxt.textContent="Save Expense";}
});

/* ─── SALES HISTORY (same) ─────────────────────────── */
onSnapshot(query(collection(db,"companyBranches",branchId,"branchSales"),orderBy("createdAt","desc")),snap=>{
  historyBody.innerHTML="";
  snap.forEach(s=>{
    const d=s.data();d.items.forEach(it=>{
      historyBody.insertAdjacentHTML("beforeend",`
        <tr>
          <td>${d.createdAt?.toDate().toLocaleString()}</td>
          <td>${it.productId}</td>
          <td>${productCache[it.productId]?.itemParticulars||""}</td>
          <td>${it.qty}</td>
          <td>${money(it.unit*it.qty*(1-it.disc/100))}</td>
          <td>${d.performedBy}</td>
        </tr>`);
    });
  });
});

/* ─── SALES REPORT  (sales + expenses) ─────────────── */
document.getElementById("genSalesReport").addEventListener("click", generateSalesReport);
async function generateSalesReport() {
  const btn  = document.getElementById("genSalesReport");
  const spin = document.getElementById("repSpin");
  const txt  = document.getElementById("repTxt");

  spin.classList.remove("d-none");
  txt.textContent = "Generating…";
  btn.disabled = true;

  try {
    /* ── dates ───────────────────────────────────────*/
    const from = document.getElementById("repFrom").value || new Date().toISOString().split("T")[0];
    const to   = document.getElementById("repTo").value || from;
    const start = new Date(`${from}T00:00:00`);
    const end   = new Date(`${to}T23:59:59`);

    /* ── fetch sales + expenses in parallel ───────── */
    const qSales = query(
      collection(db, "companyBranches", branchId, "branchSales"),
      where("createdAt", ">=", start),
      where("createdAt", "<=", end)
    );
    const qExp = query(
      collection(db, "companyBranches", branchId, "branchExpenses"),
      where("createdAt", ">=", start),
      where("createdAt", "<=", end)
    );
    const [salesSnap, expSnap] = await Promise.all([
      getDocs(qSales),
      getDocs(qExp)
    ]);

    /* ── aggregate per‑product ───────────────────────*/
    const agg = new Map();          // id → { name, qty, cash, credit }

    let totalCash   = 0;
    let totalCredit = 0;

    salesSnap.forEach(s => {
      const sale   = s.data();
      const byCredit = sale.paymentType === "credit";

      /* 1️⃣ net value PER‑SALE after all discounts */
      const lineNetTotal = sale.items
        .reduce((sum, it) => sum + it.unit * it.qty * (1 - it.disc / 100), 0);

      const grandTotal = sale.grandTotal;            // already includes overallDiscountPct
      const scale      = lineNetTotal
                       ? grandTotal / lineNetTotal   // proportion to spread overall disc
                       : 1;

      sale.items.forEach(it => {
        const netLine = it.unit * it.qty * (1 - it.disc / 100) * scale;

        if (!agg.has(it.productId)) {
          agg.set(it.productId, {
            name  : productCache[it.productId]?.itemParticulars || "",
            qty   : 0,
            cash  : 0,
            credit: 0
          });
        }

        const rec = agg.get(it.productId);
        rec.qty += it.qty;
        if (byCredit) {
          rec.credit += netLine;
          totalCredit += netLine;
        } else {
          rec.cash += netLine;
          totalCash += netLine;
        }
      });
    });

    /* ── total expenses ─────────────────────────────*/
    let expenseTotal = 0;
    expSnap.forEach(e => (expenseTotal += e.data().amount));

    /* ── build report table rows ────────────────────*/
    const rows = [...agg.entries()]
      .map(([pid, { name, qty, cash, credit }]) => `
        <tr>
          <td>${pid}</td>
          <td>${name}</td>
          <td class="text-center">${qty}</td>
          <td class="text-end">${(cash)}</td>
          <td class="text-end">${(credit)}</td>
          <td>${workerName}</td>
        </tr>
      `)
      .join("");

    const expRows = expSnap.docs
      .map(e => `<tr><td>${e.data().note}</td><td>${(
        e.data().amount
      )}</td></tr>`)
      .join("");

    /* ── inject into DOM ────────────────────────────*/
    document.getElementById("salesReportArea").innerHTML = `
      <div class="d-flex justify-content-end">
        <button class="btn btn-outline-primary btn-sm"
                onclick="printDiv('printReport')">
          <i class="bi bi-printer me-1"></i> Print Report
        </button>
      </div>

      <div id="printReport" class="p-3">
        <div class="text-center mb-2">
          <img src="/img/logoShareDisplay.jpeg" style="height:100px" alt="logo"><br>
          <h5>${branchName}<br><small>Sales & Cash Report&nbsp;(${from} – ${to})</small></h5>
        </div>

        <table class="table table-sm table-bordered">
          <thead class="table-light">
            <tr>
              <th>Code</th><th>Product</th><th>Qty</th>
              <th>Cash Sales (USh)</th><th>Credit Sales (USh)</th><th>Recorded by</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows ||
              `<tr><td colspan="6" class="text-center">No sales</td></tr>`
            }
          </tbody>
          <tfoot class="fw-bold">
            <tr>
              <td colspan="3" class="text-end">Total Cash</td>
              <td class="text-end">${money(totalCash)}</td>
              <td colspan="2"></td>
            </tr>
            <tr>
              <td colspan="3" class="text-end">Total Credit</td>
              <td class="text-end">${money(totalCredit)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>

        <h6 class="mt-4">Expenses</h6>
        <table class="table table-sm table-bordered">
          <thead class="table-light"><tr><th>Details</th><th>Amount</th></tr></thead>
          <tbody>
            ${
              expRows ||
              `<tr><td colspan="2" class="text-center">No expenses</td></tr>`
            }
          </tbody>
          <tfoot class="fw-bold">
            <tr><td class="text-end">Total</td><td>${money(
              expenseTotal
            )}</td></tr>
          </tfoot>
        </table>

        <p class="text-end"><em>Net Cash (received):</em> ${money(
          totalCash - expenseTotal
        )}</p>
        <p class="text-end"><em>Prepared by:</em> ${workerName}</p>
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


/* =====================================================
─── PRINT HELPER (already global) ───
   GLOBAL  printDiv(id)  –  no duplicates, modal‑safe
   -----------------------------------------------------
   • id  –  the element you want printed
===================================================== */
window.printDiv = (id) => {
  const target = document.getElementById(id);
  if (!target) {
    console.error(`printDiv: element #${id} not found`);
    Swal?.fire
      ? Swal.fire("Print error", `Element #${id} not found`, "error")
      : alert(`Element #${id} not found`);
    return;
  }

  /* Prevent multiple print areas if user double‑clicks */
  if (document.getElementById("___printArea")) return;

  /* 1️⃣  clone the element into a wrapper */
  const wrapper   = document.createElement("div");
  wrapper.id      = "___printArea";
  wrapper.appendChild(target.cloneNode(true));

  /* 2️⃣  add minimal print‑only CSS */
  const style = document.createElement("style");
  style.textContent = `
    /* Hide wrapper on screen */
    #___printArea { display:none; }
    /* Only show wrapper when printing, hide everything else */
    @media print {
      body > *         { display:none !important; }
      #___printArea    { display:block !important; }
      table            { width:100%; border-collapse:collapse; }
      th,td            { border:1px solid #888; padding:4px; }
    }`;
  wrapper.appendChild(style);

  /* 3️⃣  add & print, then clean‑up */
  document.body.appendChild(wrapper);

  const clean = () => {
    wrapper.remove();
    window.removeEventListener("afterprint", clean);
  };
  window.addEventListener("afterprint", clean);

  window.print();              // opens system dialog in SAME tab
};
