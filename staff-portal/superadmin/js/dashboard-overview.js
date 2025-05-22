/* ===========================================================
   Top-Level Dashboard Overview – live Firestore metrics
   (v3 – fixed activity feed, ensured deposit-aware logic)
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

/* ========== 1. Total products ========== */
onSnapshot(collection(db, 'companyProducts'), snap => {
  elProdCnt.textContent = snap.size.toLocaleString();
});

/* ========== 2. Company-level stock ========== */
const companyPerProduct = new Map();
onSnapshot(collection(db, 'companyStock'), snap => {
  let total = 0;
  companyPerProduct.clear();
  snap.forEach(d => {
    const { productId, remainingCompanyStockQuantity = 0 } = d.data();
    const qty = +remainingCompanyStockQuantity || 0;
    total += qty;
    companyPerProduct.set(productId, (companyPerProduct.get(productId) || 0) + qty);
  });
  elCompStock.textContent = total.toLocaleString();
});

/* ========== 3. Branch count & map ========== */
const branchNames = new Map();
onSnapshot(collection(db, 'companyBranches'), snap => {
  branchNames.clear();
  snap.forEach(d => branchNames.set(d.id, d.data().name));
  elBranchCnt.textContent = snap.size.toString();
});

/* ========== 4. Branch stock aggregate ========== */
const branchStockAgg = new Map();
onSnapshot(collectionGroup(db, 'branchStock'), snap => {
  branchStockAgg.clear();
  let grand = 0;
  snap.forEach(d => {
    const br = d.ref.parent.parent.id;
    const { productId, quantity = 0 } = d.data();
    const qty = +quantity || 0;
    grand += qty;
    const inner = branchStockAgg.get(br) || new Map();
    inner.set(productId, (inner.get(productId) || 0) + qty);
    branchStockAgg.set(br, inner);
  });
  elBranchStockTot.textContent = grand.toLocaleString();
});

/* ========== 5. Month-to-date Sales & Expenses ========== */
const startMonth = (() => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
})();

/* 5a. Sales (deposit-aware) */
const salesByBranch = new Map();
onSnapshot(
  query(collectionGroup(db, 'branchSales'), where('createdAt', '>=', startMonth)),
  snap => {
    salesByBranch.clear();
    let grandTotal = 0, cashCompany = 0, creditCompany = 0;

    snap.forEach(docSnap => {
      const d = docSnap.data();
      const br = docSnap.ref.parent.parent.id;
      const paid = +d.paidAmount || 0;
      const balance = +d.balanceDue || 0;

      const rec = salesByBranch.get(br) || { cash: 0, credit: 0, total: 0 };
      rec.cash += paid;
      rec.credit += balance;
      rec.total += d.grandTotal || 0;
      salesByBranch.set(br, rec);

      cashCompany += paid;
      creditCompany += balance;
      grandTotal += d.grandTotal || 0;
    });

    elMonthSalesTot.textContent = grandTotal.toLocaleString();
  }
);

/* 5b. Expenses */
const expByBranch = new Map();
onSnapshot(
  query(collectionGroup(db, 'branchExpenses'), where('createdAt', '>=', startMonth)),
  snap => {
    expByBranch.clear();
    let grand = 0;
    snap.forEach(doc => {
      const d = doc.data();
      const br = doc.ref.parent.parent.id;
      const amt = +d.amount || 0;
      grand += amt;
      expByBranch.set(br, (expByBranch.get(br) || 0) + amt);
    });
    elMonthExpTot.textContent = grand.toLocaleString();
  }
);

/* ==========================================================
   6. Recent-activity feed
   ----------------------------------------------------------
   • Company-wide events   → ALWAYS visible to Top-Level user
   • Branch-level events   → ONLY if performedBy === me
========================================================== */

/* 🄰  Feed helpers */
const ACTIVITY_LIMIT = 6;
const feed = [];                   // newest → oldest

function pushActivity (icon, text, ts = Date.now()) {
  feed.push({ icon, text, ts });
  feed.sort((a, b) => b.ts - a.ts);        // newest first
  if (feed.length > ACTIVITY_LIMIT) feed.length = ACTIVITY_LIMIT;
  renderFeed();
}

function renderFeed () {
  ulActivity.innerHTML = '';
  feed.forEach(ev => {
    ulActivity.insertAdjacentHTML(
      'beforeend',
      `<div class="list-group-item d-flex justify-content-between">
         <span><i class="${ev.icon} me-2"></i>${ev.text}</span>
         <small class="text-muted">${timeAgo(ev.ts)}</small>
       </div>`
    );
  });
}

const timeAgo = ms => {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

/* 🄱  Current user info (for branch-level filters) */
const me = JSON.parse(sessionStorage.getItem('user-information') || '{}');
const myName = me.fullName || '';        // used in where('performedBy' …)

/* ---------- COMPANY-WIDE WATCHERS (no filter) ---------- */
/* New branch added */
onSnapshot(
  query(collection(db, 'companyBranches'),
        orderBy('createdAt', 'desc'), limit(1)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-house-add',
        `New branch added: ${d.name || c.doc.id}`,
        d.createdAt?.toMillis?.() || Date.now());
    }
  })
);

/* New product added */
onSnapshot(
  query(collection(db, 'companyProducts'),
        orderBy('createdAt', 'desc'), limit(1)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-box-seam',
        `New product: ${d.itemParticulars || c.doc.id}`,
        d.createdAt?.toMillis?.() || Date.now());
    }
  })
);

/* New worker created */
onSnapshot(
  query(collection(db, 'workers'),
        orderBy('createdAt', 'desc'), limit(1)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-person-plus',
        `Worker registered: ${d.fullName}`,
        d.createdAt?.toMillis?.() || Date.now());
    }
  })
);

/* Company-level stock batch */
onSnapshot(
  query(collection(db, 'companyStock'),
        orderBy('createdAt', 'desc'), limit(2)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-journal-plus',
        `Stock batch ${d.batchCode || '(no code)'}`,
        d.createdAt?.toMillis?.() || Date.now());
    }
  })
);

/* Stock allocated to branch */
onSnapshot(
  query(collection(db, 'allocatedStockToBranches'),
        orderBy('allocatedAt', 'desc'), limit(2)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-truck',
        `Stock allocated ➜ ${branchNames.get(d.branchId) || d.branchId}`,
        d.allocatedAt?.toMillis?.() || Date.now());
    }
  })
);

/* ---------- BRANCH-LEVEL WATCHERS (filtered by me) ----- */
/* My sales */
onSnapshot(
  query(collectionGroup(db, 'branchSales'),
        where('performedBy', '==', myName),
        orderBy('createdAt', 'desc'), limit(5)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-receipt-cutoff',
        `Sale UGX ${(+d.grandTotal || 0).toLocaleString()}`,
        d.createdAt?.toMillis?.() || Date.now());
    }
  })
);

/* My expenses */
onSnapshot(
  query(collectionGroup(db, 'branchExpenses'),
        where('recordedBy', '==', myName),
        orderBy('createdAt', 'desc'), limit(5)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      pushActivity('bi-cash-stack',
        `Expense UGX ${(+d.amount || 0).toLocaleString()} – ${d.note || ''}`,
        d.createdAt?.toMillis?.() || Date.now());
    }
  })
);

/* My stock movements (in / out) */
onSnapshot(
  query(collectionGroup(db, 'branchStockLogs'),
        where('performedBy', '==', myName),
        orderBy('createdAt', 'desc'), limit(5)),
  s => s.docChanges().forEach(c => {
    if (c.type === 'added') {
      const d = c.doc.data();
      const txt =
        d.type === 'transferOut' ? `Transferred ${d.quantity} ${d.itemParticulars || d.productId} ➜ ${d.targetBranchId}`
      : d.type === 'transferIn'  ? `Received ${d.quantity} ${d.itemParticulars || d.productId} ← ${d.targetBranchId}`
      :                             `Sold ${d.quantity} ${d.itemParticulars || d.productId}`;
      pushActivity('bi-box-arrow-left', txt, d.createdAt?.toMillis?.() || Date.now());
    }
  })
);


/* ========== 7. Modal helpers ========== */
const productNames = new Map();
onSnapshot(collection(db, 'companyProducts'), snap => {
  snap.forEach(doc => productNames.set(doc.id, doc.data().itemParticulars || doc.id));
});

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

function openBranchStockModal () {
  const body = document.getElementById('branchStockBody');
  body.innerHTML = '';
  branchStockAgg.forEach((map, br) => {
    body.insertAdjacentHTML('beforeend', `<h6 class="mt-3">${branchNames.get(br) || br}</h6>`);
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
