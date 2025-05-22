/* ===========================================================
   Top-Level Dashboard Overview – live Firestore metrics
   (v2 – sales cash/credit now respect deposits on credit sales)
=========================================================== */
import {
  db, collection, collectionGroup, doc,
  onSnapshot, query, where, orderBy, limit,
  Timestamp
} from '../../js/firebase-config.js';

/* ---------- DOM elements ---------- */
// 1st-row counters
const elProdCnt   = document.getElementById('totalProducts');
const elCompStock = document.getElementById('companyStock');
const elBranchCnt = document.getElementById('totalBranches');
// 2nd-row counters
const elBranchStockTot = document.getElementById('branchStockTotal');
const elMonthSalesTot  = document.getElementById('monthSalesTotal');
const elMonthExpTot    = document.getElementById('monthExpensesTotal');
// recent activities feed
const ulActivity  = document.getElementById('activityFeed');

// modal buttons
document.getElementById('companyStockMore')?.addEventListener('click', openCompanyStockModal);
document.getElementById('branchStockMore') ?.addEventListener('click', openBranchStockModal);
document.getElementById('salesMore')       ?.addEventListener('click', openSalesModal);
document.getElementById('expensesMore')    ?.addEventListener('click', openExpensesModal);

/* ==========================================================
   1. Counts  – companyProducts
========================================================== */
onSnapshot(collection(db, 'companyProducts'), snap => {
  elProdCnt.textContent = snap.size.toLocaleString();
});

/* ==========================================================
   2. Company-level stock  – companyStock
========================================================== */
const companyPerProduct = new Map();      // productId → qty
onSnapshot(collection(db, 'companyStock'), snap => {
  let total = 0;
  companyPerProduct.clear();
  snap.forEach(d => {
    const { productId, remainingCompanyStockQuantity = 0 } = d.data();
    total += remainingCompanyStockQuantity;
    companyPerProduct.set(
      productId,
      (companyPerProduct.get(productId) || 0) + remainingCompanyStockQuantity
    );
  });
  elCompStock.textContent = total.toLocaleString();
});

/* ==========================================================
   3. Branches count & map
========================================================== */
const branchNames = new Map();
onSnapshot(collection(db, 'companyBranches'), snap => {
  branchNames.clear();
  snap.forEach(d => branchNames.set(d.id, d.data().name));
  elBranchCnt.textContent = snap.size.toString();
});

/* ==========================================================
   4. Aggregate branch stock (all branches)
========================================================== */
const branchStockAgg = new Map();        // branchId → Map(productId → qty)
onSnapshot(collectionGroup(db, 'branchStock'), snap => {
  branchStockAgg.clear();
  let grand = 0;
  snap.forEach(d => {
    const br = d.ref.parent.parent.id;
    const { productId, quantity = 0 } = d.data();
    grand += quantity;
    const inner = branchStockAgg.get(br) || new Map();
    inner.set(productId, (inner.get(productId) || 0) + quantity);
    branchStockAgg.set(br, inner);
  });
  elBranchStockTot.textContent = grand.toLocaleString();
});

/* ==========================================================
   5  Month-to-date Sales & Expenses
========================================================== */
const startMonth = (() => {
  const d = new Date();
  d.setDate(1); d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
})();

/* ---------- 5a   SALES  (deposits-aware) ----------------- */
const salesByBranch = new Map();       // branchId → { cash, credit, total }

onSnapshot(
  query(collectionGroup(db, 'branchSales'), where('createdAt', '>=', startMonth)),
  snap => {
    salesByBranch.clear();
    let grandTotal = 0, cashCompany = 0, creditCompany = 0;

    snap.forEach(docSnap => {
      const d  = docSnap.data();
      const br = docSnap.ref.parent.parent.id;

      /*  NEW  :  cash = paidAmount (deposits or full cash)
                  credit = balanceDue (still outstanding)            */
      const paid      = +d.paidAmount  || 0;
      const balance   = +d.balanceDue  || 0;

      const rec = salesByBranch.get(br) || { cash: 0, credit: 0, total: 0 };
      rec.cash   += paid;
      rec.credit += balance;
      rec.total  += d.grandTotal || 0;
      salesByBranch.set(br, rec);

      cashCompany   += paid;
      creditCompany += balance;
      grandTotal    += d.grandTotal || 0;
    });

    /* you may wish to show cashCompany / creditCompany somewhere
       — here we continue to show combined grandTotal as before */
    elMonthSalesTot.textContent = grandTotal.toLocaleString();
  }
);

/* ---------- 5b   EXPENSES  ------------------------------- */
const expByBranch = new Map();
onSnapshot(
  query(collectionGroup(db, 'branchExpenses'), where('createdAt', '>=', startMonth)),
  snap => {
    expByBranch.clear();
    let grand = 0;
    snap.forEach(doc => {
      const d  = doc.data();
      const br = doc.ref.parent.parent.id;
      grand += d.amount || 0;
      expByBranch.set(br, (expByBranch.get(br) || 0) + (+d.amount || 0));
    });
    elMonthExpTot.textContent = grand.toLocaleString();
  }
);

/* ==========================================================
   6. Recent activity feed  (unchanged)
========================================================== */
const feed = [];
function pushActivity (icon, text, ts) {
  feed.push({ icon, text, ts });
  feed.sort((a, b) => b.ts - a.ts);
  if (feed.length > 10) feed.length = 10;
  renderFeed();
}
function renderFeed () {
  ulActivity.innerHTML = '';
  feed.forEach(ev => {
    ulActivity.insertAdjacentHTML('beforeend', `
      <div class="list-group-item d-flex justify-content-between">
        <span><i class="${ev.icon} me-2"></i>${ev.text}</span>
        <small class="text-muted">${timeAgo(ev.ts)}</small>
      </div>`);
  });
}
const timeAgo = ms => {
  const diff = Date.now() - ms;
  const m    = Math.round(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

/* Worker, stock-addition, allocation activities …  (unchanged) */
/* … code removed here for brevity – keep your existing blocks! */

/* ==========================================================
   7. Modal helpers (unchanged except sales modal uses new cache)
========================================================== */
const productNames = new Map();
onSnapshot(collection(db, 'companyProducts'), snap => {
  snap.forEach(doc => productNames.set(doc.id, doc.data().itemParticulars || doc.id));
});

/* — company stock modal — */
function openCompanyStockModal () {
  const body = document.getElementById('companyStockBody');
  body.innerHTML = '';
  companyPerProduct.forEach((qty, pid) => {
    body.insertAdjacentHTML('beforeend', `
      <tr><td>${productNames.get(pid) || pid}</td>
          <td>${qty.toLocaleString()}</td></tr>`);
  });
  bootstrap.Modal.getOrCreateInstance('#companyStockModal').show();
}

/* — branch stock modal — */
function openBranchStockModal () {
  const body = document.getElementById('branchStockBody');
  body.innerHTML = '';
  branchStockAgg.forEach((map, br) => {
    body.insertAdjacentHTML('beforeend',
      `<h6 class="mt-3">${branchNames.get(br) || br}</h6>`);
    map.forEach((q, pid) => {
      body.insertAdjacentHTML('beforeend', `
        <div class="d-flex justify-content-between">
          <span>${productNames.get(pid) || pid}</span>
          <span>${q.toLocaleString()}</span>
        </div>`);
    });
  });
  bootstrap.Modal.getOrCreateInstance('#branchStockModal').show();
}

/* — sales modal (now shows deposit-aware figures) — */
function openSalesModal () {
  const body = document.getElementById('salesBody');
  body.innerHTML = '';
  salesByBranch.forEach((rec, br) => {
    body.insertAdjacentHTML('beforeend', `
      <tr><td>${branchNames.get(br) || br}</td>
          <td>${rec.cash.toLocaleString()}</td>
          <td>${rec.credit.toLocaleString()}</td>
          <td>${rec.total.toLocaleString()}</td></tr>`);
  });
  bootstrap.Modal.getOrCreateInstance('#salesModal').show();
}

/* — expenses modal — */
function openExpensesModal () {
  const body = document.getElementById('expensesBody');
  body.innerHTML = '';
  expByBranch.forEach((amt, br) => {
    body.insertAdjacentHTML('beforeend', `
      <tr><td>${branchNames.get(br) || br}</td>
          <td>${amt.toLocaleString()}</td></tr>`);
  });
  bootstrap.Modal.getOrCreateInstance('#expensesModal').show();
}
