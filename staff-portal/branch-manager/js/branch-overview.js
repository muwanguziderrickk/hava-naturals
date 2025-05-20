/* ==================================================================
   Branch dashboard counters & modals – real‑time for signed‑in user
================================================================== */
import {
  db, collection, query, where, orderBy, onSnapshot, Timestamp, limit
} from '../../js/firebase-config.js';

/* ---- session info ------------------------------------------------ */
const worker   = JSON.parse(sessionStorage.getItem('user-information')||'{}');

/* branchId might be stored separately OR inside user‑information */
let branchId   = sessionStorage.getItem('branchId') || worker.branchId || '';

/* ---------- Wait until branchId is present ----------------------- */
if (!branchId) {
  /* some apps fill sessionStorage asynchronously after auth;
     poll a few times before giving up */
  const idTimer = setInterval(() => {
    branchId = sessionStorage.getItem('branchId') || worker.branchId || '';
    if (branchId) {
      clearInterval(idTimer);
      startDash();
    }
  }, 300);
} else {
  startDash();
}

/* ==================================================================
   Everything wrapped in a function so we can call after branchId set
================================================================== */
function startDash () {

  const fullName = worker.fullName || '';

  /* ---- date helpers ---------------------------------------------- */
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0,0);
  const tsMonthStart = Timestamp.fromDate(monthStart);

  /* ---- product name cache --------------------------------------- */
  const prodNames = new Map();
  onSnapshot(collection(db,'companyProducts'), snap=>{
    snap.forEach(d => prodNames.set(d.id, d.data().itemParticulars || d.id));
  });

  /* ---- DOM refs -------------------------------------------------- */
  const elStock   = document.getElementById('branchStockTotal');
  const elSales   = document.getElementById('monthSalesTotal');
  const elExp     = document.getElementById('monthExpensesTotal');
  const feed      = document.getElementById('activityFeed');

  /* ---- live branch stock ---------------------------------------- */
  const stockPerProduct = new Map();
  onSnapshot(collection(db, `companyBranches/${branchId}/branchStock`), snap=>{
    let total = 0;
    stockPerProduct.clear();
    snap.forEach(d=>{
      const { productId, quantity=0 } = d.data();
      total += quantity;
      stockPerProduct.set(productId, quantity);
    });
    elStock.textContent = total.toLocaleString();
  });

  /* ---- month‑to‑date sales -------------------------------------- */
  const cashDaily   = new Map();
  const creditDaily = new Map();
  const totalDaily  = new Map();   // cash+credit per day

  onSnapshot(
    query(collection(db,`companyBranches/${branchId}/branchSales`),
          where('createdAt','>=', tsMonthStart)),
    snap=>{
      cashDaily.clear(); creditDaily.clear(); totalDaily.clear();
      let cashTot=0, credTot=0;

      snap.forEach(doc=>{
        const d = doc.data();
        const day = d.createdAt.toDate().toLocaleDateString();
        const amt = d.grandTotal || 0;           // already net of discounts

        if (d.paymentType === 'credit') {
          credTot += amt;
          creditDaily.set(day, (creditDaily.get(day)||0) + amt);
        } else {
          cashTot += amt;
          cashDaily.set(day, (cashDaily.get(day)||0) + amt);
        }
        totalDaily.set(day, (totalDaily.get(day)||0) + amt);
      });
      elSales.textContent = (cashTot+credTot).toLocaleString();
  });

  /* ---- month‑to‑date expenses ----------------------------------- */
  const expDaily = new Map();
  onSnapshot(
    query(collection(db,`companyBranches/${branchId}/branchExpenses`),
          where('createdAt','>=', tsMonthStart)),
    snap=>{
      expDaily.clear();
      let total = 0;
      snap.forEach(doc=>{
        const d = doc.data();
        const day = d.createdAt.toDate().toLocaleDateString();
        total += d.amount || 0;
        expDaily.set(day, (expDaily.get(day)||0) + (+d.amount||0));
      });
      elExp.textContent = total.toLocaleString();
  });

  /* ---- Recent activities (worker‑specific) ---------------------- */
  const maxFeed = 6;
  const activities=[];
  const pushFeed = (icon, text, ts)=>{
    activities.push({icon,text,ts});
    activities.sort((a,b)=>b.ts-a.ts);
    if(activities.length>maxFeed) activities.length=maxFeed;
    renderFeed();
  };
  const renderFeed = ()=>{
    feed.innerHTML='';
    activities.forEach(ev=>{
      feed.insertAdjacentHTML('beforeend',`
        <div class="list-group-item d-flex justify-content-between">
          <span><i class="${ev.icon} me-2"></i>${ev.text}</span>
          <small class="text-muted">${timeAgo(ev.ts)}</small>
        </div>`);
    });
  };
  const timeAgo = ms=>{
    const diff=Date.now()-ms;
    const m=Math.round(diff/60000);
    if(m<1) return 'just now';
    if(m<60) return `${m} min ago`;
    const h=Math.round(m/60);
    if(h<24) return `${h} h ago`;
    return `${Math.round(h/24)} d ago`;
  };

  /* Worker’s sales */
  onSnapshot(
    query(collection(db,`companyBranches/${branchId}/branchSales`),
          where('performedBy','==', fullName),
          orderBy('createdAt','desc'), limit(5)),
    snap=>{
      snap.docChanges().forEach(ch=>{
        if(ch.type==='added'){
          const d = ch.doc.data();
          pushFeed('fas fa-receipt text-success',
                   `Recorded sale UGX ${(d.grandTotal||0).toLocaleString()}`,
                   d.createdAt?.toDate().getTime()||Date.now());
        }
      });
  });

  /* Worker’s expenses */
  onSnapshot(
    query(collection(db,`companyBranches/${branchId}/branchExpenses`),
          where('recordedBy','==', fullName),
          orderBy('createdAt','desc'), limit(5)),
    snap=>{
      snap.docChanges().forEach(ch=>{
        if(ch.type==='added'){
          const d = ch.doc.data();
          pushFeed('fas fa-money-bill-wave text-warning',
                   `Logged expense: ${d.note} – UGX ${d.amount.toLocaleString()}`,
                   d.createdAt?.toDate().getTime()||Date.now());
        }
      });
  });

  /* Transfers / stock logs (optional) */
  onSnapshot(
    query(collection(db,`companyBranches/${branchId}/branchStockLogs`),
          where('performedBy','==', fullName),
          orderBy('createdAt','desc'), limit(5)),
    snap=>{
      snap.docChanges().forEach(ch=>{
        if(ch.type==='added'){
          const d = ch.doc.data();
          const txt = d.type==='sale'
            ? `Sold ${d.quantity} ${prodNames.get(d.productId)||d.productId}`
            : d.type==='transferOut'
              ? `Transferred out ${d.quantity} ${prodNames.get(d.productId)||d.productId}`
              : `Received ${d.quantity} ${prodNames.get(d.productId)||d.productId}`;
          pushFeed('fas fa-exchange-alt text-primary', txt,
                   d.createdAt?.toDate().getTime()||Date.now());
        }
      });
  });

  /* ---- Modal buttons -------------------------------------------- */
  document.getElementById('branchStockMore')?.addEventListener('click',()=>{
    const body=document.getElementById('branchStockBody');
    body.innerHTML='';
    stockPerProduct.forEach((qty,pid)=>{
      body.insertAdjacentHTML('beforeend',`
        <tr><td>${prodNames.get(pid)||pid}</td><td>${qty.toLocaleString()}</td></tr>`);
    });
    bootstrap.Modal.getOrCreateInstance('#branchStockModal').show();
  });

  document.getElementById('salesMore')?.addEventListener('click',()=>{
    const body=document.getElementById('salesBody');
    body.innerHTML='';
    [...totalDaily.keys()].sort((a,b)=>new Date(b)-new Date(a)).forEach(day=>{
      const cash   = cashDaily.get(day)   || 0;
      const credit = creditDaily.get(day) || 0;
      const total  = totalDaily.get(day)  || 0;
      body.insertAdjacentHTML('beforeend',`
        <tr><td>${day}</td><td>${cash.toLocaleString()}</td>
            <td>${credit.toLocaleString()}</td><td>${total.toLocaleString()}</td></tr>`);
    });
    bootstrap.Modal.getOrCreateInstance('#salesModal').show();
  });

  /* ----------- “View More Details” for Monthly Expenses ------------- */
  document.getElementById('expensesMore')?.addEventListener('click', () => {
    const body = document.getElementById('expensesBody');
    body.innerHTML = '';

    /* one live listener so numbers stay fresh while modal is open */
    const q = query(
      collection(db, `companyBranches/${branchId}/branchExpenses`),
      where('createdAt', '>=', tsMonthStart),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, snap => {
      /* -------- aggregate by yyyy‑mm‑dd ------------------- */
      const daily = new Map();          // dateStr → { total, rows[] }
      snap.forEach(doc => {
        const d = doc.data();
        const dateStr = d.createdAt.toDate().toISOString().split('T')[0];
        const entry = daily.get(dateStr) || { total: 0, rows: [] };
        entry.total += +d.amount || 0;
        entry.rows.push({ note: d.note, amt: +d.amount || 0 });
        daily.set(dateStr, entry);
      });

      /* -------- rebuild tbody ----------------------------- */
      body.innerHTML = '';
      [...daily.entries()]
        .sort((a, b) => new Date(b[0]) - new Date(a[0]))          // newest first
        .forEach(([day, info], idx) => {
          const collapseId = `exp-${idx}`;
          /* main row */
          body.insertAdjacentHTML('beforeend', `
            <tr>
              <td>${day}</td>
              <td>${info.total.toLocaleString()}</td>
              <td>
                <button class="btn btn-sm btn-outline-secondary"
                        data-bs-toggle="collapse"
                        data-bs-target="#${collapseId}">
                  Details
                </button>
              </td>
            </tr>
            <tr class="collapse" id="${collapseId}">
              <td colspan="3">
                <ul class="mb-0 ps-3">
                  ${info.rows.map(r =>
                    `<li>${r.note} — <strong>UGX ${r.amt.toLocaleString()}</strong></li>`
                  ).join('')}
                </ul>
              </td>
            </tr>
          `);
        });
    });

    /* close listener when modal hides to save bandwidth */
    const modalEl = document.getElementById('expensesModal');
    modalEl.addEventListener('hidden.bs.modal', () => unsub(), { once: true });

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  });
}
