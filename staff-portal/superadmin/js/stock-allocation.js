/* ==========================================================
   Stock Allocation – robust, session-safe, with LOCKED reverts
   ========================================================== */
import {
  db,
  collection, doc, getDocs, orderBy,
  query, where, onSnapshot, runTransaction, serverTimestamp,
  getDoc, limit        //  <--  getDoc used for server-side lock check
} from "../../js/firebase-config.js";

/* ---------- CONFIG ---------- */
const REVERT_LOCK_HOURS = 24;          // ⏳ after this, allocations are frozen

/* ---------- DOM ---------- */
const productSelect           = document.getElementById("allocateProductSelect");
const batchSelect             = document.getElementById("batchSelect");
const branchSelect            = document.getElementById("branchSelect");
const allocationForm          = document.getElementById("allocationForm");
const allocateBtn             = document.getElementById("allocateStockBtn");
const allocateSpinner         = document.getElementById("allocateSpinner");
const allocateBtnText         = document.getElementById("allocateBtnText");
const branchStockTableBody    = document.getElementById("branchStockTableBody");

/* ---------- Session ---------- */
const me          = JSON.parse(sessionStorage.getItem("user-information") || "{}");
const performedBy = me.fullName || "System";

/* ---------- Caches ---------- */
const branchNames  = {};
const productMap   = new Map();    // productId → itemParticulars
const stockCounts  = new Map();    // productId → total available stock

/* ---------- Live product cache ---------- */
onSnapshot(collection(db, "companyProducts"), snap => {
  productMap.clear();
  snap.forEach(d => productMap.set(d.id, d.data().itemParticulars || d.id));
  updateProductSelect();           // may still be empty if no stock
});

/* ---------- Live top-level stock cache ---------- */
onSnapshot(collection(db, "companyStock"), snap => {
  stockCounts.clear();
  snap.forEach(d => {
    const { productId, remainingCompanyStockQuantity: qty = 0 } = d.data();
    if (+qty > 0) stockCounts.set(productId, (stockCounts.get(productId)||0) + +qty);
  });
  updateProductSelect();
});

/* ---------- Populate product <select> ---------- */
function updateProductSelect () {
  productSelect.innerHTML = '<option value="">Select Product</option>';
  for (const [pid, name] of productMap.entries()) {
    if (stockCounts.has(pid)) productSelect.innerHTML += `<option value="${pid}">${name}</option>`;
  }
}

/* ---------- Branch list ---------- */
onSnapshot(collection(db, "companyBranches"), snap => {
  branchSelect.innerHTML = '<option value="">Select Branch</option>';
  snap.forEach(d => {
    branchNames[d.id] = d.data().name;
    branchSelect.innerHTML += `<option value="${d.id}">${branchNames[d.id]}</option>`;
  });
});

/* ---------- Batch list for chosen product ---------- */
productSelect.addEventListener("change", async () => {
  const pid = productSelect.value;
  batchSelect.innerHTML = '<option value="">Select Batch</option>';
  if (!pid) return;

  const snap = await getDocs(query(collection(db,"companyStock"), where("productId","==",pid)));
  snap.forEach(d=>{
    const { batchCode, remainingCompanyStockQuantity:qty=0 } = d.data();
    if(+qty>0){
      batchSelect.innerHTML += `<option value="${d.id}" data-available="${qty}">
        ${batchCode} (Available: ${qty})
      </option>`;
    }
  });
});

/* =========================================================
   1️⃣  CREATE / ALLOCATE
========================================================= */
allocationForm.addEventListener("submit", async e => {
  e.preventDefault();

  const productId = productSelect.value;
  const batchId   = batchSelect.value;
  const branchId  = branchSelect.value;
  const quantity  = +document.getElementById("allocateQuantity").value;
  const available = +batchSelect.selectedOptions[0]?.dataset.available || 0;

  if(!(productId && batchId && branchId && quantity>0))
    return Swal.fire("Check fields","Please fill everything correctly","warning");
  if(quantity>available)
    return Swal.fire("Too many","Specified quantity exceeds available batch stock","error");

  if(!(await Swal.fire({title:"Confirm", text:`Allocate ${quantity} Unit(s)?`, icon:"question", showCancelButton:true})).isConfirmed)
    return;

  allocateBtn.disabled=true; allocateSpinner.classList.remove("d-none"); allocateBtnText.textContent="Allocating…";

  try{
    const allocId = `ASTB${Date.now()}`;
    const logId   = `BSL${Date.now()}_MAIN`;

    await runTransaction(db, async t=>{
      const batchRef  = doc(db,"companyStock",batchId);
      const prodRef   = doc(db,"companyProducts",productId);
      const branchRef = doc(db,"companyBranches",branchId,"branchStock",productId);
      const allocRef  = doc(db,"allocatedStockToBranches",allocId);
      const logRef    = doc(db,"companyBranches",branchId,"branchStockLogs",logId);

      /* ---- reads ---- */
      const [batchSnap, prodSnap, branchSnap] = await Promise.all([
        t.get(batchRef), t.get(prodRef), t.get(branchRef)
      ]);

      const remain = (batchSnap.data()?.remainingCompanyStockQuantity||0) - quantity;
      if(remain<0) throw new Error("Race-condition: Not enough stock");

      const particulars    = prodSnap.data()?.itemParticulars || "N/A";
      const branchQuantity = (branchSnap.data()?.quantity||0) + quantity;

      /* ---- writes ---- */
      t.update(batchRef,{ remainingCompanyStockQuantity:remain });

      t.set(allocRef,{
        productId,batchId,branchId, quantityAllocated:quantity,
        itemParticulars:particulars, allocatedAt:serverTimestamp(),
        logId
      });

      t.set(branchRef,{ productId, quantity:branchQuantity, updatedAt:serverTimestamp() },{ merge:true });

      t.set(logRef,{
        productId, quantity, itemParticulars:particulars,
        type:"transferIn", targetBranchId:me.branchId, note:"From Main Store",
        performedBy, createdAt:serverTimestamp()
      });
    });

    Swal.fire("Done","Stock successfully allocated","success");
    allocationForm.reset(); batchSelect.innerHTML='<option value="">Select Batch</option>';
  }catch(err){ Swal.fire("Error",err.message,"error"); }
  finally{ allocateBtn.disabled=false; allocateSpinner.classList.add("d-none"); allocateBtnText.textContent="Allocate Stock"; }
});

/* =========================================================
   2️⃣  REVERT Allocations  (locked after X hours)
========================================================= */
branchStockTableBody.addEventListener("click", async e=>{
  const btn=e.target.closest(".delete-btn"); if(!btn) return;

  const {id:allocId,batchId,qty,branchId,productId,logId,ts} = btn.dataset;
  const quantity = +qty;
  const allocTS  = +ts;                                    // ms epoch from data-attr
  const hoursOld = (Date.now()-allocTS)/(1000*60*60);

  if(hoursOld>REVERT_LOCK_HOURS)
    return Swal.fire("Locked","Allocation is older than 24 h and cannot be reverted.","info");

  if(!(await Swal.fire({title:"Revert?",text:"Stock will be restored to batch and respective branch stock will be adjusted.",icon:"warning",showCancelButton:true})).isConfirmed)
    return;

  try{
    await runTransaction(db, async t=>{
      const allocRef  = doc(db,"allocatedStockToBranches",allocId);
      const batchRef  = doc(db,"companyStock",batchId);
      const branchRef = doc(db,"companyBranches",branchId,"branchStock",productId);
      const logRef    = doc(db,"companyBranches",branchId,"branchStockLogs",logId);

      /* extra guard – ensure not older than lock window */
      const allocSnap = await t.get(allocRef);
      const allocTime = allocSnap.data()?.allocatedAt?.toDate();
      if((Date.now()-allocTime)/(1000*60*60) > REVERT_LOCK_HOURS)
        throw new Error("Revert window passed.");

      const [batchSnap, branchSnap] = await Promise.all([ t.get(batchRef), t.get(branchRef) ]);

      const newRemain  = (batchSnap.data()?.remainingCompanyStockQuantity||0)+quantity;
      const newBranchQ = (branchSnap.data()?.quantity||0)-quantity;

      t.delete(allocRef);
      t.update(batchRef,{ remainingCompanyStockQuantity:newRemain });
      t.delete(logRef);

      if(newBranchQ<=0) t.delete(branchRef);
      else t.update(branchRef,{ quantity:newBranchQ, updatedAt:serverTimestamp() });
    });
    Swal.fire("Reverted","Allocation rolled back","success");
  }catch(err){ Swal.fire("Error",err.message,"error"); }
});

/* =========================================================
   3️⃣  LIVE Allocation table  (last 10)  + lock info
========================================================= */
onSnapshot(
  query(collection(db,"allocatedStockToBranches"),
        where("allocatedAt","!=",null),
        orderBy("allocatedAt","desc"),
        limit(10)),
  snap=>{
    branchStockTableBody.innerHTML="";
    snap.forEach(d=>{
      const a = d.data();
      const branchName  = branchNames[a.branchId] || a.branchId;
      const ts          = a.allocatedAt?.toMillis?.() || Date.now();
      const hoursOld    = (Date.now()-ts)/(1000*60*60);
      const locked      = hoursOld > REVERT_LOCK_HOURS;

      branchStockTableBody.insertAdjacentHTML("beforeend",`
        <tr>
          <td>${a.productId}</td>
          <td>${a.itemParticulars}</td>
          <td>${branchName}</td>
          <td>${a.allocatedAt.toDate().toLocaleString()}</td>
          <td>${a.batchId}</td>
          <td>${a.quantityAllocated}</td>
          <td>
            ${locked
              ? '<span class="text-muted">🔒Locked</span>'
              : `<button class="btn btn-sm btn-outline-danger delete-btn"
                   data-id="${d.id}" data-batch-id="${a.batchId}"
                   data-qty="${a.quantityAllocated}" data-branch-id="${a.branchId}"
                   data-product-id="${a.productId}" data-log-id="${a.logId}"
                   data-ts="${ts}">
                   <i class="fas fa-undo-alt"></i> Revert
                 </button>`}
          </td>
        </tr>`);
    });
});
