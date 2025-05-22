/* ==========================================================
   Branch-level analytics – realtime, filterable & robust
   (v2 – payment split honours deposits on credit sales)
========================================================== */
import {
  db, collection, query, where, onSnapshot,
  Timestamp, getDocs, doc, getDoc, getAuth
} from '../../js/firebase-config.js';

/* ---------- colours ---------- */
const COLORS = {
  salesLine : '#36A2EB',
  topBars   : '#4BC0C0',
  pieCash   : '#1CC88A',
  pieCred   : '#FFCE56',
  stockBars : '#9966FF',
  expLine   : '#FF9F40'
};

/* ---------- DOM refs ---------- */
const startInp = document.getElementById('branchStart');
const endInp   = document.getElementById('branchEnd');
const btn      = document.getElementById('branchFilterBtn');

/* ---------- default date range (1st → today) ---------- */
(function setDefaultDates () {
  const today = new Date();
  startInp.value = new Date(today.getFullYear(), today.getMonth(), 1)
                   .toISOString().split('T')[0];
  endInp.value   = today.toISOString().split('T')[0];
})();

/* ---------- busy-button helper ---------- */
const setBtnBusy = busy => {
  if (!btn) return;
  if (busy) {
    btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      `<span class="spinner-border spinner-border-sm me-1"></span>Refreshing…`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.orig || 'Refresh';
  }
};

/* ---------- product name cache ---------- */
const productNames = new Map();
const preloadProducts = async () => {
  const snap = await getDocs(collection(db, 'companyProducts'));
  snap.forEach(d => productNames.set(d.id, d.data().itemParticulars || d.id));
};

/* ---------- chart refs & unsub placeholders ---------- */
let chSales = null, chTop = null, chPay = null, chStock = null, chExp = null;
let unsubSales = () => {}, unsubTop = () => {}, unsubPay = () => {},
    unsubStock = () => {}, unsubExp = () => {};
const detach = () => { unsubSales(); unsubTop(); unsubPay(); unsubStock(); unsubExp(); };

/* ---------- tiny utils ---------- */
const rangeTS = () => {
  const s = new Date(startInp.value + 'T00:00:00');
  const e = new Date(endInp.value   + 'T23:59:59');
  return [Timestamp.fromDate(s), Timestamp.fromDate(e)];
};
const dateSpan = (s, e) => {
  const out = [], d = new Date(s);
  while (d <= e) { out.push(d.toLocaleDateString()); d.setDate(d.getDate() + 1); }
  return out;
};

const redraw = (old, cid, type, labels, datasets, setter, opts = {}) => {
  old?.destroy();
  const chart = new Chart(document.getElementById(cid), {
    type,
    data: { labels, datasets },
    options: { responsive: true, scales: { y: { beginAtZero: true } }, ...opts }
  });
  setter && setter(chart);
};

/* ---------- MAIN bootstrap ---------- */
bootstrapAnalytics();   // auto-run

/** Boots analytics only when branchId is available */
async function bootstrapAnalytics () {

  let branchId = sessionStorage.getItem('branchId');

  /* 1️⃣  Wait (max 2 s) for async session storage from auth flow */
  if (!branchId) {
    branchId = await new Promise(res => {
      const t = setTimeout(() => res(null), 2000);
      window.addEventListener('storage', function handler (e) {
        if (e.key === 'branchId' && e.newValue) {
          clearTimeout(t); window.removeEventListener('storage', handler);
          res(e.newValue);
        }
      });
    });
  }

  /* 2️⃣  Fallback – read worker doc directly */
  if (!branchId) {
    const user = getAuth().currentUser;
    if (user) {
      const snap = await getDoc(doc(db, 'workers', user.uid));
      branchId = snap.exists() ? snap.data().branchId : null;
      if (branchId) sessionStorage.setItem('branchId', branchId);
    }
  }

  if (!branchId) {
    alert('No branch assigned to your account. Contact admin.');
    return;
  }

  await preloadProducts();
  await attachListeners(branchId);

  /* ---------- Refresh button ---------- */
  btn.addEventListener('click', async () => {
    setBtnBusy(true);
    detach();
    await attachListeners(branchId);
    requestAnimationFrame(() => setBtnBusy(false));
  });
}

/* ---------- listeners attached per range/branch ---------- */
async function attachListeners (branchId) {

  const [sTS, eTS]  = rangeTS();
  const startDate   = sTS.toDate();
  const endDate     = eTS.toDate();

  /* === 1 Sales trend (grandTotal) ====================== */
  unsubSales = onSnapshot(
    query(
      collection(db, `companyBranches/${branchId}/branchSales`),
      where('createdAt', '>=', sTS),
      where('createdAt', '<=', eTS)),
    snap => {
      const map = {};
      snap.forEach(d => {
        const ds = d.data().createdAt.toDate().toLocaleDateString();
        map[ds]  = (map[ds] || 0) + d.data().grandTotal;
      });
      const labels = dateSpan(startDate, endDate);
      const data   = labels.map(l => map[l] || 0);
      redraw(chSales, 'salesTrendChart', 'line', labels,
        [{ label: 'Daily Sales', data,
           borderColor: COLORS.salesLine, tension: .1, fill: false }],
        r => (chSales = r));
    });

  /* === 2 Top-selling products ========================= */
  unsubTop = onSnapshot(
    query(
      collection(db, `companyBranches/${branchId}/branchSales`),
      where('createdAt', '>=', sTS),
      where('createdAt', '<=', eTS)),
    snap => {
      const qty = new Map();
      snap.forEach(d => {
        (d.data().items || []).forEach(({ productId, qty: q }) =>
          qty.set(productId, (qty.get(productId) || 0) + q)
        );
      });
      const top    = [...qty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
      const labels = top.map(([id]) => productNames.get(id) || id);
      const data   = top.map(([, q]) => q);
      redraw(chTop, 'topProductsChart', 'bar', labels,
        [{ label: 'Units Sold', data, backgroundColor: COLORS.topBars }],
        r => (chTop = r));
    });

  /* === 3 Payment split  (deposits-aware) =============== */
  unsubPay = onSnapshot(
    query(
      collection(db, `companyBranches/${branchId}/branchSales`),
      where('createdAt', '>=', sTS),
      where('createdAt', '<=', eTS)),
    snap => {
      let cash = 0, credit = 0;
      snap.forEach(d => {
        const sale = d.data();
        const paid = +sale.paidAmount || 0;
        const bal  = +sale.balanceDue || 0;

        cash   += paid;                      // all deposits count as cash-in
        credit += bal;                       // only unpaid part counts as credit
      });
      redraw(
        chPay, 'paymentTypeChart', 'doughnut',
        ['Cash-in', 'Credit Outstanding'],
        [{
          data: [cash, credit],
          backgroundColor: [COLORS.pieCash, COLORS.pieCred]
        }],
        r => (chPay = r),
        { plugins: { legend: { position: 'bottom' } } }
      );
    });

  /* === 4 Current stock levels ========================= */
  unsubStock = onSnapshot(
    collection(db, `companyBranches/${branchId}/branchStock`),
    snap => {
      const labels = [], data = [];
      snap.forEach(d => {
        labels.push(productNames.get(d.data().productId));
        data.push(d.data().quantity || 0);
      });
      redraw(chStock, 'stockLevelsChart', 'bar', labels,
        [{ label: 'Qty', data, backgroundColor: COLORS.stockBars }],
        r => (chStock = r));
    });

  /* === 5 Expenses trend =============================== */
  unsubExp = onSnapshot(
    query(
      collection(db, `companyBranches/${branchId}/branchExpenses`),
      where('createdAt', '>=', sTS),
      where('createdAt', '<=', eTS)),
    snap => {
      const map = {};
      snap.forEach(d => {
        const ds = d.data().createdAt.toDate().toLocaleDateString();
        map[ds]  = (map[ds] || 0) + d.data().amount;
      });
      const labels = dateSpan(startDate, endDate);
      const data   = labels.map(l => map[l] || 0);
      redraw(chExp, 'expensesTrendChart', 'line', labels,
        [{ label: 'Daily Expenses', data,
           borderColor: COLORS.expLine, tension: .1, fill: false }],
        r => (chExp = r));
    });
}
