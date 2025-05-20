/* ===========================================================
   Top‑Level Dashboard Overview – live Firestore metrics
   collections referenced:
     companyProducts
     companyBranches
     companyStock
     companyBranches/{branch}/branchStock
     branchSales
     branchExpenses
     workers
     companyStock   (for “stock addition” activity)
     allocatedStockToBranches
=========================================================== */
import {
  db, collection, collectionGroup, doc,
  onSnapshot, query, where, orderBy, limit,
  Timestamp
} from '../../js/firebase-config.js';

/* ---------- DOM elements ---------- */
// ‑‑ first row counts
const elProdCnt   = document.getElementById('totalProducts');           // <p id="totalProducts">
const elCompStock = document.getElementById('companyStock');            // <p id="companyStock">
const elBranchCnt = document.getElementById('totalBranches');           // <p id="totalBranches">
// ‑‑ second row counts
const elBranchStockTot = document.getElementById('branchStockTotal');   // <p id="branchStockTotal">
const elMonthSalesTot  = document.getElementById('monthSalesTotal');    // <p id="monthSalesTotal">
const elMonthExpTot    = document.getElementById('monthExpensesTotal'); // <p id="monthExpensesTotal">
// ‑‑ recent activity list
const ulActivity  = document.getElementById('activityFeed');            // <div id="activityFeed" class="list-group">

// buttons to open modals
document.getElementById('companyStockMore') ?.addEventListener('click',openCompanyStockModal);
document.getElementById('branchStockMore')  ?.addEventListener('click',openBranchStockModal);
document.getElementById('salesMore')        ?.addEventListener('click',openSalesModal);
document.getElementById('expensesMore')     ?.addEventListener('click',openExpensesModal);

/* ---------- realtime 1: Products count ---------- */
onSnapshot(collection(db,'companyProducts'), snap=>{
  elProdCnt.textContent = snap.size.toLocaleString();
});

/* ---------- realtime 2: Company stock (remaining) ---------- */
let companyPerProduct = new Map();  // productId → remainingCompanyStockQuantity
onSnapshot(collection(db,'companyStock'), snap=>{
  let total = 0;
  companyPerProduct.clear();
  snap.forEach(d=>{
    const { productId, remainingCompanyStockQuantity = 0 } = d.data();
    total += remainingCompanyStockQuantity;
    companyPerProduct.set(productId,
      (companyPerProduct.get(productId)||0) + remainingCompanyStockQuantity);
  });
  elCompStock.textContent = total.toLocaleString();
});

/* ---------- realtime 3: Branch count ---------- */
const branchNames = new Map();
onSnapshot(collection(db,'companyBranches'), snap=>{
  branchNames.clear();
  snap.forEach(d=> branchNames.set(d.id,d.data().name));
  elBranchCnt.textContent = snap.size.toString();
});

/* ---------- realtime 4: Branch stock totals ---------- */
let branchStockAgg = new Map();     // branchId → Map(productId → qty)
onSnapshot(collectionGroup(db,'branchStock'), snap=>{
  branchStockAgg.clear();
  let grand = 0;
  snap.forEach(d=>{
    const br = d.ref.parent.parent.id;
    const { productId, quantity = 0 } = d.data();
    grand += quantity;
    const inner = branchStockAgg.get(br) || new Map();
    inner.set(productId,(inner.get(productId)||0)+quantity);
    branchStockAgg.set(br,inner);
  });
  elBranchStockTot.textContent = grand.toLocaleString();
});

/* ---------- realtime 5: Month‑to‑date Sales & Expenses ---------- */
const startMonth = (()=>{ const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return Timestamp.fromDate(d); })();

/* sales */
let salesByBranch = new Map();  // branchId → {cash,credit,total}
onSnapshot(query(collectionGroup(db,'branchSales'),where('createdAt','>=',startMonth)), snap=>{
  salesByBranch.clear();
  let grand = 0;
  snap.forEach(doc=>{
    const d=doc.data(), br=doc.ref.parent.parent.id;
    const rec = salesByBranch.get(br) || {cash:0,credit:0,total:0};
    if(d.paymentType==='credit') rec.credit += d.grandTotal||0;
    else                          rec.cash   += d.grandTotal||0;
    rec.total += d.grandTotal||0;
    grand += d.grandTotal||0;
    salesByBranch.set(br,rec);
  });
  elMonthSalesTot.textContent = grand.toLocaleString();
});

/* expenses */
let expByBranch = new Map();
onSnapshot(query(collectionGroup(db,'branchExpenses'),where('createdAt','>=',startMonth)), snap=>{
  expByBranch.clear();
  let grand=0;
  snap.forEach(doc=>{
    const d=doc.data(), br=doc.ref.parent.parent.id;
    grand += d.amount||0;
    expByBranch.set(br,(expByBranch.get(br)||0)+(+d.amount||0));
  });
  elMonthExpTot.textContent = grand.toLocaleString();
});

/* ---------- recent activities (latest 10 events) ---------- */
const feed = [];

function pushActivity(icon,text,timestamp){   // timestamp = ms
  feed.push({icon,text,ts:timestamp});
  feed.sort((a,b)=>b.ts - a.ts);
  if(feed.length>10) feed.length=10;
  renderFeed();
}
function renderFeed(){
  ulActivity.innerHTML = '';
  feed.forEach(ev=>{
    ulActivity.insertAdjacentHTML('beforeend',`
      <div class="list-group-item d-flex justify-content-between">
        <span><i class="${ev.icon} me-2"></i>${ev.text}</span>
        <small class="text-muted">${timeAgo(ev.ts)}</small>
      </div>`);
  });
}
const timeAgo = t=>{
  const diff = Date.now() - t;
  const m = Math.round(diff/60000);
  if(m < 1)            return 'just now';
  if(m < 60)           return `${m} min ago`;
  const h = Math.round(m/60);
  if(h < 24)           return `${h} h ago`;
  return `${Math.round(h/24)} d ago`;
};

/* --- Workers registration -------------------------------- */
onSnapshot(query(collection(db,'workers'),
          orderBy('createdAt','desc'), limit(1)), snap=>{
  snap.docChanges().forEach(ch=>{
    if(ch.type==='added'){
      const d = ch.doc.data();
      const ts = d.createdAt?.toDate().getTime() || Date.now();
      pushActivity('fas fa-user-plus text-primary', `Worker ${d.fullName} registered`, ts);
    }
  });
});

/* --- Company stock addition ------------------------------ */
onSnapshot(query(collection(db,'companyStock'),
          orderBy('createdAt','desc'), limit(1)), snap=>{
  snap.docChanges().forEach(ch=>{
    if(ch.type==='added'){
      const d = ch.doc.data();
      const ts = d.createdAt?.toDate().getTime() || Date.now();
      pushActivity('fas fa-file text-warning', `New company stock batch ${d.batchCode||''}`, ts);
    }
  });
});

/* --- Stock allocation ------------------------------------ */
onSnapshot(query(collection(db,'allocatedStockToBranches'),
          orderBy('allocatedAt','desc'), limit(1)), snap=>{
  snap.docChanges().forEach(ch=>{
    if(ch.type==='added'){
      const d  = ch.doc.data();
      const ts = d.allocatedAt?.toDate().getTime() || Date.now();
      pushActivity('fas fa-upload text-success', `Allocated stock to ${branchNames.get(d.branchId)||d.branchId}`, ts);
    }
  });
});


/* ---------- Modal openers ---------- */
/* === extra cache ======================================= */
const productNames = new Map();
/* fill it once */
onSnapshot(collection(db,'companyProducts'), snap=>{
  snap.forEach(doc=>{
    productNames.set(doc.id, doc.data().itemParticulars || doc.id);
  });
});

/* === Company‑stock modal (use names) ==================== */
function openCompanyStockModal(){
  const body = document.getElementById('companyStockBody');
  body.innerHTML = '';
  companyPerProduct.forEach((qty,pid)=>{
    body.insertAdjacentHTML('beforeend',`
      <tr><td>${productNames.get(pid) || pid}</td>
          <td>${qty.toLocaleString()}</td></tr>`);
  });
  bootstrap.Modal.getOrCreateInstance('#companyStockModal').show();
}

/* === Branch‑stock modal (use names) ===================== */
function openBranchStockModal(){
  const body = document.getElementById('branchStockBody');
  body.innerHTML='';
  branchStockAgg.forEach((map,br)=>{
    body.insertAdjacentHTML('beforeend',`<h6 class="mt-3">${branchNames.get(br)||br}</h6>`);
    map.forEach((q,pid)=>{
      body.insertAdjacentHTML('beforeend',`
        <div class="d-flex justify-content-between">
          <span>${productNames.get(pid) || pid}</span>
          <span>${q.toLocaleString()}</span>
        </div>`);
    });
  });
  bootstrap.Modal.getOrCreateInstance('#branchStockModal').show();
}

function openSalesModal(){
  const body=document.getElementById('salesBody');
  body.innerHTML='';
  salesByBranch.forEach((rec,br)=>{
    body.insertAdjacentHTML('beforeend',`
      <tr><td>${branchNames.get(br)||br}</td><td>${rec.cash.toLocaleString()}</td>
          <td>${rec.credit.toLocaleString()}</td><td>${rec.total.toLocaleString()}</td></tr>`);
  });
  bootstrap.Modal.getOrCreateInstance('#salesModal').show();
}

function openExpensesModal(){
  const body=document.getElementById('expensesBody');
  body.innerHTML='';
  expByBranch.forEach((amt,br)=>{
    body.insertAdjacentHTML('beforeend',`
      <tr><td>${branchNames.get(br)||br}</td><td>${amt.toLocaleString()}</td></tr>`);
  });
  bootstrap.Modal.getOrCreateInstance('#expensesModal').show();
}