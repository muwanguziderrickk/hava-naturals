/* ==================================================================
   Branch dashboard counters & modals – REAL‑TIME, deposit‑aware (rev 3.1)
   ================================================================== */
import {
  db,
  collection, collectionGroup,
  query, where, orderBy, limit,
  onSnapshot, Timestamp
} from "../../js/firebase-config.js";

/* ------------------------------------------------------------
   1️⃣  Ensure the session is ready so branchId is present
------------------------------------------------------------ */
await window.sessionReady;

const worker      = JSON.parse(sessionStorage.getItem("user-information") || "{}");
const branchId    = sessionStorage.getItem("branchId") || worker.branchId;
const workerName  = worker.fullName || "";

if (!branchId) {
  console.error("branchId missing in session");
  throw new Error("branchId missing");
}

/* ------------------------------------------------------------
   2️⃣  Date helpers (month‑to‑date scope)
------------------------------------------------------------ */
const now            = new Date();
const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
const tsMonthStart   = Timestamp.fromDate(monthStart);

/* ------------------------------------------------------------
   3️⃣  Product name cache (for stock modal)
------------------------------------------------------------ */
const prodNames = new Map();
onSnapshot(collection(db, "companyProducts"), snap => {
  snap.forEach(d => prodNames.set(d.id, d.data().itemParticulars || d.id));
});

/* ------------------------------------------------------------
   4️⃣  DOM refs
------------------------------------------------------------ */
const elStock     = document.getElementById("branchStockTotal");
const elSales     = document.getElementById("monthSalesTotal");          // cash‑in + credit‑due
const elExp       = document.getElementById("monthExpensesTotal");
const elCashIn    = document.getElementById("actualCashIn");             // optional span
const elCreditDue = document.getElementById("actualCredit");             // optional span
const feed        = document.getElementById("activityFeed");

/* ------------------------------------------------------------
   5️⃣  LIVE BRANCH STOCK DETAILS
------------------------------------------------------------ */
const stockPerProduct = new Map();
onSnapshot(collection(db, `companyBranches/${branchId}/branchStock`), snap => {
  let total = 0;
  stockPerProduct.clear();
  snap.forEach(d => {
    const { productId, quantity = 0 } = d.data();
    total += quantity;
    stockPerProduct.set(productId, quantity);
  });
  elStock.textContent = total.toLocaleString();
});

/* ------------------------------------------------------------
   6️⃣  SALES & CREDIT (deposit‑aware)
------------------------------------------------------------ */
const cashDailySales    = new Map();   // day → cash sales amount
const cashDailyDeposits = new Map();   // day → deposit amounts
const creditDaily       = new Map();   // day → outstanding balances
const totalDaily        = new Map();   // day → grandTotal of all sales
let   cashDepositsSum   = 0;           // quick running sum for headline

/* — a) CASH sales (paymentType === "cash") — */
onSnapshot(
  query(
    collection(db, `companyBranches/${branchId}/branchSales`),
    where("createdAt", ">=", tsMonthStart),
    where("paymentType", "==", "cash")
  ),
  snap => {
    cashDailySales.clear();
    snap.forEach(doc => {
      const d    = doc.data();
      const day  = isoDay(d.createdAt);
      const amt  = +d.grandTotal || 0;
      cashDailySales.set(day, (cashDailySales.get(day) || 0) + amt);
      totalDaily.set(day, (totalDaily.get(day) || 0) + amt);
    });
    updateHeadline();
  }
);

/* — b) CREDIT / PARTIAL sales (paymentType === "credit") — */
onSnapshot(
  query(
    collection(db, `companyBranches/${branchId}/branchSales`),
    where("createdAt", ">=", tsMonthStart),
    where("paymentType", "==", "credit")
  ),
  snap => {
    creditDaily.clear();
    snap.forEach(doc => {
      const d    = doc.data();
      const day  = isoDay(d.createdAt);
      const bal  = +d.balanceDue || 0;
      const gTot = +d.grandTotal || 0;
      if (bal) creditDaily.set(day, (creditDaily.get(day) || 0) + bal);
      totalDaily.set(day, (totalDaily.get(day) || 0) + gTot);
    });
    updateHeadline();
  }
);

/* — c) CREDIT-DEPOSIT payments (ONLY this branch) — */
onSnapshot(
  query(
    collectionGroup(db, "payments"),
    where("method", "==", "credit-deposit"),
    where("paidAt", ">=", tsMonthStart)
  ),
  snap => {
    cashDailyDeposits.clear();
    cashDepositsSum = 0;

    snap.forEach(doc => {
      /* branchId is the second segment in the doc’s path: companyBranches/{branchId}/branchSales/{saleId}/payments/{payId}*/
      const pathSeg = doc.ref.path.split('/');
      const payBranch = pathSeg[1];          // <-- this is branchId in the path
      if (payBranch !== branchId) return;    // 🚫 skip other branches

      const p   = doc.data();
      const day = isoDay(p.paidAt);
      const amt = +p.amount || 0;

      cashDailyDeposits.set(day, (cashDailyDeposits.get(day) || 0) + amt);
      cashDepositsSum += amt;
    });

    updateHeadline();
  }
);


function updateHeadline () {
  const cashSales  = sumMap(cashDailySales);
  const cashIn     = cashSales + cashDepositsSum;
  const creditDue  = sumMap(creditDaily);

  elSales.textContent = (cashIn + creditDue).toLocaleString();
  if (elCashIn)    elCashIn.textContent    = cashIn.toLocaleString();
  if (elCreditDue) elCreditDue.textContent = creditDue.toLocaleString();
}

/* ------------------------------------------------------------
   7️⃣  EXPENSES (month‑to‑date)
------------------------------------------------------------ */
const expDaily = new Map();

onSnapshot(
  query(
    collection(db, `companyBranches/${branchId}/branchExpenses`),
    where("createdAt", ">=", tsMonthStart)
  ),
  snap => {
    expDaily.clear();
    let sum = 0;
    snap.forEach(doc => {
      const d   = doc.data();
      const day = isoDay(d.createdAt);
      const amt = +d.amount || 0;
      expDaily.set(day, (expDaily.get(day) || 0) + amt);
      sum += amt;
    });
    elExp.textContent = sum.toLocaleString();
  }
);

/* ------------------------------------------------------------
   8️⃣  ACTIVITY FEED (sales • expenses • deposits) – per worker
------------------------------------------------------------ */
const maxFeed = 6;
const activities = [];

const pushFeed = (icon, text, ts) => {
  activities.push({ icon, text, ts });
  activities.sort((a, b) => b.ts - a.ts);
  if (activities.length > maxFeed) activities.length = maxFeed;
  renderFeed();
};

function renderFeed () {
  feed.innerHTML = "";
  activities.forEach(ev => {
    feed.insertAdjacentHTML(
      "beforeend",
      `<div class="list-group-item d-flex justify-content-between align-items-start">
         <span><i class="${ev.icon} me-2"></i>${ev.text}</span>
         <small class="text-muted">${timeAgo(ev.ts)}</small>
       </div>`
    );
  });
}

/* --- worker’s SALES --- */
onSnapshot(
  query(
    collection(db, `companyBranches/${branchId}/branchSales`),
    where("performedBy", "==", workerName),
    orderBy("createdAt", "desc"),
    limit(10)
  ),
  snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "added") {
        const d = ch.doc.data();
        pushFeed(
          "fas fa-receipt text-success",
          `Processed sale – UGX ${(+d.grandTotal).toLocaleString()}`,
          d.createdAt?.toDate().getTime() || Date.now()
        );
      }
    });
  }
);

/* --- worker’s EXPENSES --- */
onSnapshot(
  query(
    collection(db, `companyBranches/${branchId}/branchExpenses`),
    where("recordedBy", "==", workerName),
    orderBy("createdAt", "desc"),
    limit(10)
  ),
  snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "added") {
        const d = ch.doc.data();
        pushFeed(
          "fas fa-money-bill-wave text-warning",
          `Logged expense – UGX ${(+d.amount).toLocaleString()}`,
          d.createdAt?.toDate().getTime() || Date.now()
        );
      }
    });
  }
);

/* --- worker’s CREDIT DEPOSITS --- */
onSnapshot(
  query(
    collectionGroup(db, "payments"),
    where("paymentRecordedBy", "==", workerName),
    where("method", "==", "credit-deposit"),
    orderBy("paidAt", "desc"),
    limit(10)
  ),
  snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "added") {
        const p = ch.doc.data();
        pushFeed(
          "fas fa-hand-holding-usd text-primary",
          `Collected credit deposit – UGX ${(+p.amount).toLocaleString()}`,
          p.paidAt?.toDate().getTime() || Date.now()
        );
      }
    });
  }
);

/* ------------------------------------------------------------
   9️⃣  “More details” MODALS
------------------------------------------------------------ */

/* Stock modal */

document.getElementById("branchStockMore")?.addEventListener("click", () => {
  const body = document.getElementById("branchStockBody");
  body.innerHTML = "";
  stockPerProduct.forEach((qty, pid) => {
    body.insertAdjacentHTML(
      "beforeend",
      `<tr><td>${prodNames.get(pid) || pid}</td><td class="">${qty.toLocaleString()}</td></tr>`
    );
  });
  bootstrap.Modal.getOrCreateInstance("#branchStockModal").show();
});

/* Sales modal (cash‑in, credit‑due, total) */

document.getElementById("salesMore")?.addEventListener("click", () => {
  const body = document.getElementById("salesBody");
  body.innerHTML = "";

  // Gather all unique days tracked across the three daily maps
  const days = new Set([
    ...cashDailySales.keys(),
    ...cashDailyDeposits.keys(),
    ...creditDaily.keys(),
    ...totalDaily.keys()
  ]);

  [...days]
    .sort((a, b) => new Date(b) - new Date(a))
    .forEach(day => {
      const cash   = (cashDailySales.get(day) || 0) + (cashDailyDeposits.get(day) || 0);
      const credit = creditDaily.get(day) || 0;
      const total  = totalDaily.get(day) || 0;
      body.insertAdjacentHTML(
        "beforeend",
        `<tr>
           <td>${day}</td>
           <td class="">${cash.toLocaleString()}</td>
           <td class="">${credit.toLocaleString()}</td>
           <td class="">${total.toLocaleString()}</td>
         </tr>`
      );
    });

  bootstrap.Modal.getOrCreateInstance("#salesModal").show();
});

/* Monthly expenses modal */

document.getElementById("expensesMore")?.addEventListener("click", () => {
  const body = document.getElementById("expensesBody");
  body.innerHTML = "";

  const q = query(
    collection(db, `companyBranches/${branchId}/branchExpenses`),
    where("createdAt", ">=", tsMonthStart),
    orderBy("createdAt", "desc")
  );

  const unsub = onSnapshot(q, snap => {
    const daily = new Map();
    snap.forEach(doc => {
      const d       = doc.data();
      const dateStr = isoDay(d.createdAt);
      const entry   = daily.get(dateStr) || { total: 0, rows: [] };
      entry.total += +d.amount || 0;
      entry.rows.push({ note: d.note, amt: +d.amount || 0 });
      daily.set(dateStr, entry);
    });

    body.innerHTML = "";
    [...daily.entries()]
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .forEach(([day, info], idx) => {
        const collapseId = `exp-${idx}`;
        body.insertAdjacentHTML(
          "beforeend",
          `<tr>
             <td>${day}</td>
             <td class="">${info.total.toLocaleString()}</td>
             <td>
               <button class="btn btn-sm btn-outline-secondary text-end"
                       data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                 Details
               </button>
             </td>
           </tr>
           <tr id="${collapseId}" class="collapse">
             <td colspan="3">
               <ul class="mb-0 ps-3">
                 ${info.rows
                   .map(r => `<li>${r.note} — <strong>UGX ${r.amt.toLocaleString()}</strong></li>`)
                   .join("")}
               </ul>
             </td>
           </tr>`
        );
      });
  });

  const modalEl = document.getElementById("expensesModal");
  modalEl.addEventListener("hidden.bs.modal", () => unsub(), { once: true });
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
});

/* ------------------------------------------------------------
   🔧  Small util helpers
------------------------------------------------------------ */
function sumMap(map) {
  let s = 0;
  map.forEach(v => (s += v));
  return s;
}

function isoDay(ts) {
  return ts?.toDate?.().toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
}

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const min  = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}
