/* ==========================================================
   Branch Stock Management – robust & session-safe
   ========================================================== */
import {
  db, collection, collectionGroup, doc, getDoc, getDocs,
  runTransaction, onSnapshot, query, where, orderBy, limit,
  serverTimestamp
} from "../../js/firebase-config.js";

/* ----------------------------------------------------------
   0️⃣  Wait until Session is ready (populated by
       sessionManager.js). All scripts that rely on session
       data should do the same.
---------------------------------------------------------- */
await window.sessionReady        // provided by sessionManager.js

/* ----------------------------------------------------------
   1️⃣  Session constants
---------------------------------------------------------- */
const worker   = JSON.parse(sessionStorage.getItem("user-information") || "{}");
const branchId = sessionStorage.getItem("branchId");
const branchName = sessionStorage.getItem("branchName") || "";
const performedBy = worker.fullName || "Unknown User";

if (!branchId) {
  Swal.fire("Error", "No branch found in session – please reload.", "error");
  throw new Error("branchId missing");
}

/* ----------------------------------------------------------
   2️⃣  DOM references
---------------------------------------------------------- */
const productSel = document.getElementById("branchProductSelect");
const qtyField   = document.getElementById("moveQty");
const noteField  = document.getElementById("moveNote");
const targetWrap = document.getElementById("targetBranchWrap");
const targetSel  = document.getElementById("targetBranchSelect");
const form       = document.getElementById("movementForm");
const btn        = document.getElementById("submitMove");
const spin       = document.getElementById("moveSpinner");
const txt        = document.getElementById("moveText");
const historyBody= document.getElementById("historyTableBody");

const reportBtn  = document.getElementById("generateReport");
const reportArea = document.getElementById("reportArea");

/* ----------------------------------------------------------
   3️⃣  Local caches
---------------------------------------------------------- */
const productCache = new Map();     // id → full doc
function cacheProduct(pDoc){
  productCache.set(pDoc.id, pDoc.data());
}

/* prime cache once */
getDocs(collection(db,"companyProducts")).then(snap=>snap.forEach(cacheProduct));

/* ----------------------------------------------------------
   4️⃣  Helpers
---------------------------------------------------------- */
const money = n => n.toLocaleString("en-UG",
                   {style:"currency",currency:"UGX",maximumFractionDigits:0});
const busy  = (on) => {
  btn.disabled = on;
  spin.classList.toggle("d-none", !on);
  txt.textContent = on ? "Saving…" : "Save Movement";
};

/* ----------------------------------------------------------
   5️⃣  Populate <select> elements (always in-sync)
---------------------------------------------------------- */
/* local state */
const inStockIds = new Set();           // productId’s with qty > 0 at *this* branch
function rebuildProductSelect () {
  /* header / empty state */
  productSel.innerHTML = inStockIds.size
    ? '<option value="">Select Product</option>'
    : '<option value="">No stock available</option>';
  /* list every in-stock product that we have meta for */
  inStockIds.forEach(id => {
    const meta = productCache.get(id);
    if (meta) {
      productSel.insertAdjacentHTML(
        "beforeend",
        `<option value="${id}">${meta.itemParticulars}</option>`
      );
    }
  });
}
/* 🔄  a) catalogue – keeps productCache fresh */
onSnapshot(
  collection(db, "companyProducts"),
  snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "removed") productCache.delete(ch.doc.id);
      else                       cacheProduct(ch.doc);        // “added” or “modified”
    });
    rebuildProductSelect();                                   // refresh menu
  }
);
/* 🔄  b) live stock at THIS branch – fills inStockIds */
onSnapshot(
  collection(db, "companyBranches", branchId, "branchStock"),
  snap => {
    inStockIds.clear();
    snap.forEach(d => {
      if ((d.data().quantity || 0) > 0) inStockIds.add(d.id);
    });
    rebuildProductSelect();                                   // refresh menu
  }
);


/* other branches (targets) */
onSnapshot(collection(db,"companyBranches"), snap=>{
  targetSel.innerHTML = '<option value="">Choose target branch</option>';
  snap.forEach(d=>{
    if(d.id!==branchId)
      targetSel.insertAdjacentHTML("beforeend",
        `<option value="${d.id}">${d.data().name}</option>`);
  });
});

/* ----------------------------------------------------------
   6️⃣  Submit transfer form
---------------------------------------------------------- */
form.addEventListener("submit", async e => {
  e.preventDefault();

  const productId = productSel.value;
  const qty       = +qtyField.value;
  const note      = noteField.value.trim();
  const targetId  = targetSel.value;

  if (!(productId && qty > 0 && targetId))
    return Swal.fire("Missing", "Fill all fields (product, qty, branch).", "warning");

  const meta = productCache.get(productId) || {};
  const confirm = await Swal.fire({
    title: "Confirm Transfer",
    text: `Move ${qty} × ${meta.itemParticulars || productId} ➜ ${targetId}?`,
    icon: "question",
    showCancelButton: true
  });
  if (!confirm.isConfirmed) return;

  busy(true);
  const now = Date.now();
  const logIdOut = `BSL_${now}`;
  const logIdIn  = `BSL_${now}_IN`;

  // Pre-declare all doc refs BEFORE transaction starts
  const srcRef   = doc(db, "companyBranches", branchId, "branchStock", productId);
  const tgtRef   = doc(db, "companyBranches", targetId, "branchStock", productId);
  const logOut   = doc(db, "companyBranches", branchId, "branchStockLogs", logIdOut);
  const logIn    = doc(db, "companyBranches", targetId, "branchStockLogs", logIdIn);

  try {
    await runTransaction(db, async tx => {
      // ✅ All reads happen first
      const srcSnap = await tx.get(srcRef);
      const tgtSnap = await tx.get(tgtRef);

      const srcQty = srcSnap.exists() ? srcSnap.data().quantity : 0;
      if (srcQty < qty) throw new Error(`Only ${srcQty} Unit(s) remaining in stock`);

      const tgtQty = tgtSnap.exists() ? tgtSnap.data().quantity : 0;

      // ✅ Writes after all reads
      if (srcQty - qty === 0) {
        tx.delete(srcRef);
      } else {
        tx.update(srcRef, {
          quantity: srcQty - qty,
          updatedAt: serverTimestamp()
        });
      }

      tx.set(tgtRef, {
        productId,
        quantity: tgtQty + qty,
        updatedAt: serverTimestamp()
      }, { merge: true });

      const baseLog = {
        productId,
        quantity: qty,
        note,
        itemParticulars: meta.itemParticulars || "",
        performedBy,
        createdAt: serverTimestamp()
      };

      tx.set(logOut, { ...baseLog, type: "transferOut", targetBranchId: targetId });
      tx.set(logIn,  { ...baseLog, type: "transferIn",  targetBranchId: branchId });
    });

    Swal.fire("Saved!", "Transfer recorded.", "success");
    form.reset();
    targetWrap.classList.add("d-none");

  } catch (err) {
    console.error(err);
    Swal.fire("Error", err.message, "error");
  } finally {
    busy(false);
  }
});


/* ----------------------------------------------------------
   7️⃣  Recent Stock Movements  (limited to latest 100)
---------------------------------------------------------- */
const MOVES_LIMIT = 100;

onSnapshot(
  query(
    collection(db,"companyBranches",branchId,"branchStockLogs"),
    orderBy("createdAt","desc"),
    limit(MOVES_LIMIT)
  ),
  snap=>{
    historyBody.innerHTML="";
    snap.forEach(d=>{
      const l=d.data();
      const when = l.createdAt?.toDate().toLocaleString() || "";
      const target = l.type==="transferOut" ? `→ ${l.targetBranchId}` :
                     l.type==="transferIn"  ? `← ${l.targetBranchId}` : "";
      historyBody.insertAdjacentHTML("beforeend",`
        <tr>
          <td>${when}</td>
          <td>${l.productId}</td>
          <td>${l.itemParticulars||""}</td>
          <td>${l.type}</td>
          <td>${l.quantity}</td>
          <td>${l.note||""} ${target}</td>
          <td>${l.performedBy||""}</td>
        </tr>`);
    });
  });

/* ----------------------------------------------------------
   8️⃣  Stock-Movement report  (unchanged logic, safer)
---------------------------------------------------------- */
reportBtn.addEventListener("click", generateReport);

async function generateReport(){
  const fromInp=document.getElementById("reportFrom");
  const toInp  =document.getElementById("reportTo");

  const fromDate=new Date((fromInp.value||new Date().toISOString().slice(0,10))+"T00:00:00");
  const toDate  =toInp.value ? new Date(toInp.value+"T23:59:59") : new Date();

  reportBtn.disabled=true;
  reportArea.innerHTML=`<div class="text-center my-3">
      <div class="spinner-border text-primary"></div><div class="mt-2">Generating…</div></div>`;

  try{
    const logsSnap=await getDocs(query(
      collection(db,"companyBranches",branchId,"branchStockLogs"),
      where("createdAt",">=",fromDate), where("createdAt","<=",toDate)
    ));

    /* aggregate */
    const agg=new Map();  // pid→{sales,in,out}
    logsSnap.forEach(l=>{
      const d=l.data();
      if(!agg.has(d.productId)) agg.set(d.productId,{sales:0,in:0,out:0});
      const rec=agg.get(d.productId);
      if(d.type==="sale")        rec.sales+=d.quantity;
      if(d.type==="transferIn")  rec.in   +=d.quantity;
      if(d.type==="transferOut") rec.out  +=d.quantity;
    });

    /* rows */
    const rows=[];
    for(const [pid, stat] of agg){
      /* opening=closing+out+sales-in  (snapshot at end) */
      const stockSnap = await getDoc(doc(db,"companyBranches",branchId,"branchStock",pid));
      const closing   = stockSnap.exists()?stockSnap.data().quantity:0;
      const opening   = closing+stat.out+stat.sales-stat.in;
      const meta=productCache.get(pid)||{itemCode:pid,itemParticulars:""};
      rows.push(`<tr>
        <td>${meta.itemCode}</td><td>${meta.itemParticulars}</td>
        <td>${opening}</td><td>${stat.sales}</td><td>${stat.out}</td>
        <td>${stat.in}</td><td>${closing}</td></tr>`);
    }

    reportArea.innerHTML = rows.length
      ? `<div class="d-flex justify-content-end">
           <button class="btn btn-outline-primary btn-sm" onclick="printDiv('reportContent')">
             <i class="bi bi-printer me-1"></i> Print Report
           </button></div>
         <div id="reportContent">
           <div class="text-center mb-2">
             <img src="/img/logoShareDisplay.jpeg" style="height:90px"><br>
             <h5>${branchName}</h5>
             <small>Stock Movement Report (${fromDate.toLocaleString()} ➜ ${toDate.toLocaleString()})</small>
           </div>
           <table class="table table-sm table-bordered">
             <thead class="table-light"><tr>
               <th>Item Code</th><th>Item Particulars</th><th>Opening Stock</th>
               <th>Sales</th><th>Transfer Out</th><th>Transfer In</th><th>Closing Stock</th>
             </tr></thead><tbody>${rows.join("")}</tbody>
           </table>
           <p class="text-end"><em>Prepared by:</em> ${performedBy}</p>
         </div>`
      : `<div class="alert alert-info">No movement recorded in this period.</div>`;

  }catch(err){
    console.error(err);
    Swal.fire("Error", err.message, "error");
  }finally{
    reportBtn.disabled=false;
  }
}

/* ----------------------------------------------------------
   9️⃣  Simple print helper – same-tab dialog + white page
---------------------------------------------------------- */
window.printDiv = (id) => {
  const el = document.getElementById(id);
  if (!el || !el.innerHTML.trim()) {
    return Swal.fire("Error", "Nothing to print", "info");
  }

  /* clone all <link rel="stylesheet"> and <style> now on the page */
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map(node => node.outerHTML)
    .join("");

  /* build printable markup */
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Print</title>
        ${styles}
        <style>
          /* ensure crisp white and tight margins for A4 / POS */
          body { background:#fff !important; color:#000; }
          @media print { @page { size:A4 portrait; margin:12mm } }
          table { width:100%; border-collapse:collapse; font-size:12px }
          th,td { border:1px solid #888; padding:4px }
        </style>
      </head>
      <body>${el.outerHTML}</body>
    </html>`;

  /* create hidden iframe in current tab */
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, {
    position: "fixed",
    right: 0, bottom: 0,
    width: 0, height: 0,
    border: "0", visibility: "hidden"
  });
  document.body.appendChild(iframe);

  iframe.onload = () => {
    iframe.contentWindow.focus();     // for Safari
    iframe.contentWindow.print();     // open system dialog
    setTimeout(() => iframe.remove(), 1000); // tidy up
  };

  /* write & close – triggers onload in most browsers */
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
};
