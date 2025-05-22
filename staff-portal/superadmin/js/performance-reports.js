/* -----------------------------------------------------------
   Top-Level Manager Dashboard – Chart.js analytics  (v4)
   • Cash / Credit include deposits   • Robust refresh logic
----------------------------------------------------------- */
import {
  db, collection, collectionGroup, query, where,
  onSnapshot, Timestamp
} from '../../js/firebase-config.js';

/* ---------- DOM ---------- */
const startInp   = document.getElementById('reportStart');
const endInp     = document.getElementById('reportEnd');
const refreshBtn = document.getElementById('refreshDashboard');
const pdfBtn     = document.getElementById('exportPDF');

/* canvases */
const cvsSales = document.getElementById('salesByBranchChart');
const cvsStock = document.getElementById('stockValueChart');
const cvsNet   = document.getElementById('netCashChart');
const cvsTop   = document.getElementById('topProductsChart');
const cvsExp   = document.getElementById('expenseBreakdownChart');

/* ---------- caches ---------- */
const branchMap = new Map();   // branchId → branchName
const priceMap  = new Map();   // productId → sellingPrice
const nameMap   = new Map();   // productId → productName

/* ---------- chart refs / snapshot unsubs ---------- */
let chSales=null, chStock=null, chNet=null, chTop=null, chExp=null;
let unsubSales=()=>{}, unsubExp=()=>{}, unsubStock=()=>{};
let listenersActive = false;            // guard against double attach

/* ---------- default date range (current month) ---------- */
(function bootstrap () {
  const today   = new Date();
  const month0  = new Date(today.getFullYear(), today.getMonth(), 1);
  startInp.value = month0.toISOString().split('T')[0];
  endInp.value   = today .toISOString().split('T')[0];

  /* ---- load caches once, THEN build dashboard ------------- */
  const ready   = { branches:false, products:false };

  onSnapshot(collection(db, 'companyBranches'), s => {
    branchMap.clear();
    s.forEach(d => branchMap.set(d.id, d.data().name));
    if (!ready.branches) { ready.branches = true; tryStart(); }
  });

  onSnapshot(collection(db, 'companyProducts'), s => {
    priceMap.clear(); nameMap.clear();
    s.forEach(d => {
      priceMap.set(d.id, +d.data().sellingPrice || 0);
      nameMap .set(d.id, d.data().itemParticulars || d.id);
    });
    if (!ready.products) { ready.products = true; tryStart(); }
  });

  function tryStart () {
    if (ready.branches && ready.products && !listenersActive) {
      attachListeners();                  // exactly once
      listenersActive = true;
    }
  }

  refreshBtn.addEventListener('click', handleRefresh);
  pdfBtn    ?.addEventListener('click', handlePDFClick);
})();

/* ---------- helpers ---------- */
const fmt     = n => n.toLocaleString('en-UG',{style:'currency',currency:'UGX',maximumFractionDigits:0});
const ds      = (label,data,color)=>({ label,data,backgroundColor:color,borderColor:color,borderWidth:1 });
const pastel  = i => `hsl(${i*53%360} 70% 65%)`;
const COLORS  = { cash:'#14b8a6', credit:'#fb923c', stock:'#64748b', net:'#10b981', top:'#6366f1' };

function setBusy(btn,on,msg){
  if(!btn) return;
  if(on){
    btn.dataset.prev = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML =
      `<span class="spinner-border spinner-border-sm me-1"></span>${msg}`;
  }else{
    btn.disabled = false;
    btn.innerHTML = btn.dataset.prev || '';
  }
}

/* ---------- date-range util ---------- */
function getRange () {
  const s = new Date(startInp.value + 'T00:00:00');
  const e = new Date(endInp.value   + 'T23:59:59');
  return {
    start : isNaN(s) ? new Date(0) : s,
    end   : isNaN(e) ? new Date()  : e
  };
}

/* ---------- refresh ---------- */
function handleRefresh () {
  if (refreshBtn.disabled) return;           // debounce extra clicks
  setBusy(refreshBtn,true,'Refreshing…');
  detach();                  // stop previous snapshots
  attachListeners();         // re-attach with new range
  setTimeout(()=>setBusy(refreshBtn,false), 800);
}

/* ---------- detach snapshots ---------- */
function detach () {
  unsubSales(); unsubExp(); unsubStock();
}

/* =========================================================
   attachListeners  – live Firestore queries per date range
========================================================= */
function attachListeners () {
  const { start, end } = getRange();
  const sTS = Timestamp.fromDate(start);
  const eTS = Timestamp.fromDate(end);

  /* ----- 1. SALES (deposit-aware) ------------------------ */
  unsubSales = onSnapshot(
    query(collectionGroup(db,'branchSales'),
          where('createdAt','>=',sTS),
          where('createdAt','<=',eTS)),
    snap => {
      const cashMap   = new Map();   // branchId → UGX
      const creditMap = new Map();   // branchId → UGX
      const topQty    = new Map();   // productId → units

      snap.forEach(doc => {
        const d  = doc.data();
        const br = doc.ref.parent.parent.id;

        const paid   = +d.paidAmount  || 0;   // all deposits so far
        const credit = +d.balanceDue  || 0;   // still outstanding

        cashMap  .set(br,(cashMap.get(br)  ||0)+paid);
        creditMap.set(br,(creditMap.get(br)||0)+credit);

        (d.items||[]).forEach(it=>{
          topQty.set(it.productId,(topQty.get(it.productId)||0)+(+it.qty||0));
        });
      });

      renderSalesByBranch(cashMap, creditMap);
      renderTopProducts(topQty);
    });

  /* ----- 2. EXPENSES  ----------------------------------- */
  unsubExp = onSnapshot(
    query(collectionGroup(db,'branchExpenses'),
          where('createdAt','>=',sTS),
          where('createdAt','<=',eTS)),
    snap => {
      const expMap = new Map();      // branchId → UGX
      const catMap = new Map();      // category → UGX

      snap.forEach(doc => {
        const d  = doc.data();
        const br = doc.ref.parent.parent.id;
        expMap.set(br,(expMap.get(br)||0)+(+d.amount||0));

        const cat = (d.note || 'Uncategorised').trim();
        catMap.set(cat,(catMap.get(cat)||0)+(+d.amount||0));
      });

      renderNetCash(expMap);
      renderExpenseBreakdown(catMap);
    });

  /* ----- 3. STOCK (snapshot) ---------------------------- */
  unsubStock = onSnapshot(collectionGroup(db,'branchStock'), snap => {
    const valMap = new Map();        // branchId → UGX
    snap.forEach(d=>{
      const br   = d.ref.parent.parent.id;
      const { productId, quantity=0 } = d.data();
      valMap.set(br,
        (valMap.get(br)||0) + quantity*(priceMap.get(productId)||0)
      );
    });
    renderStockValue(valMap);
  });
}

/* =========================================================
   RENDERERS  (Chart.js)
========================================================= */
function renderSalesByBranch (cashMap, creditMap) {
  const ids  = [...branchMap.keys()].sort();
  const cash = ids.map(id=>cashMap  .get(id)||0);
  const cred = ids.map(id=>creditMap.get(id)||0);

  chSales?.destroy();
  chSales = new Chart(cvsSales,{
    type:'bar',
    data:{ labels:ids.map(i=>branchMap.get(i)||i),
           datasets:[ ds('Cash',cash,COLORS.cash),
                      ds('Outstanding Credit',cred,COLORS.credit) ] },
    options:{ responsive:true,
      interaction:{mode:'index',intersect:false},
      plugins:{ tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y)}`}} },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

function renderStockValue (valMap) {
  const ids  = [...branchMap.keys()].sort();
  const vals = ids.map(id=>valMap.get(id)||0);

  chStock?.destroy();
  chStock = new Chart(cvsStock,{
    type:'bar',
    data:{ labels:ids.map(i=>branchMap.get(i)||i),
           datasets:[ ds('Stock Value',vals,COLORS.stock) ] },
    options:{ responsive:true,
      plugins:{ tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}} },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

function renderNetCash (expMap) {
  if(!chSales) return;                        // wait until sales ready
  const ids  = [...branchMap.keys()].sort();
  const cash = chSales.data.datasets[0].data;
  const net  = ids.map((id,i)=> cash[i] - (expMap.get(id)||0));

  chNet?.destroy();
  chNet = new Chart(cvsNet,{
    type:'bar',
    data:{ labels:ids.map(i=>branchMap.get(i)||i),
           datasets:[ ds('Net Cash',net,COLORS.net) ] },
    options:{ responsive:true,
      plugins:{ tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}} },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

function renderTopProducts (qtyMap) {
  const top10  = [...qtyMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const labels = top10.map(([id])=>nameMap.get(id)||id);
  const data   = top10.map(([,q])=>q);

  chTop?.destroy();
  chTop = new Chart(cvsTop,{
    type:'bar',
    data:{ labels, datasets:[ ds('Units Sold',data,COLORS.top) ] },
    options:{ responsive:true, scales:{ y:{ beginAtZero:true } } }
  });
}

function renderExpenseBreakdown (catMap) {
  const labels = [...catMap.keys()];
  const data   = labels.map(k=>catMap.get(k));

  chExp?.destroy();
  chExp = new Chart(cvsExp,{
    type:'doughnut',
    data:{ labels,
           datasets:[{ data, backgroundColor:labels.map((_,i)=>pastel(i)) }] },
    options:{ responsive:true,
      plugins:{ tooltip:{callbacks:{ label:c=>`${c.label}: ${fmt(c.raw)}` }} }
    }
  });
}

/* =========================================================
   PDF export  (unchanged)
========================================================= */
async function handlePDFClick () {
  setBusy(pdfBtn,true,'Exporting…');
  await downloadPDF();
  setBusy(pdfBtn,false);
}

async function downloadPDF () {
  const { jsPDF } = window.jspdf;
  const pdf   = new jsPDF({ orientation:'p', unit:'mm', format:'a4' });
  const wrap  = document.getElementById('reports');
  const canvas= await html2canvas(wrap,{ scale:2 });
  const img   = canvas.toDataURL('image/png',1.0);
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const P = pdf.getImageProperties(img);
  const R = Math.min(W/P.width, H/P.height);

  pdf.addImage(img,'PNG',(W-P.width*R)/2,10,P.width*R,P.height*R);
  pdf.save('dashboard.pdf');
}
