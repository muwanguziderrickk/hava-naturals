/* -----------------------------------------------------------
   Top‑Level Manager Dashboard – live Chart.js analytics
   now with progress indicators on Refresh + PDF Export
----------------------------------------------------------- */
import {
  db, collection, collectionGroup, query, where, onSnapshot, Timestamp
} from '../../js/firebase-config.js';

/* ---------- DOM ---------- */
const startInp  = document.getElementById('reportStart');
const endInp    = document.getElementById('reportEnd');
const refreshBtn= document.getElementById('refreshDashboard'); // <button>Refresh</button>
const pdfBtn    = document.getElementById('exportPDF');        // <button>PDF Export</button>

/* canvases */
const cvsSales = document.getElementById('salesByBranchChart');
const cvsStock = document.getElementById('stockValueChart');
const cvsNet   = document.getElementById('netCashChart');
const cvsTop   = document.getElementById('topProductsChart');
const cvsExp   = document.getElementById('expenseBreakdownChart');

/* ---------- caches ---------- */
const branchMap = new Map();
const priceMap  = new Map();
const nameMap   = new Map();

/* ---------- chart refs ---------- */
let chSales=null, chStock=null, chNet=null, chTop=null, chExp=null;
/* ---------- listener unsubs ---------- */
let unsubSales=()=>{}, unsubExp=()=>{}, unsubStock=()=>{};

/* ---------- init ---------- */
(function init(){
  /* default range = Current month start to current day of the current month */
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  startInp.value = monthStart.toISOString().split('T')[0];
  endInp.value   = today.toISOString().split('T')[0];

  /* branch + product caches */
  onSnapshot(collection(db,'companyBranches'),snap=>{
    snap.forEach(d=>branchMap.set(d.id,d.data().name));
    attachListeners();          // run once
  });
  onSnapshot(collection(db,'companyProducts'),snap=>{
    snap.forEach(d=>{
      const p=d.data();
      priceMap.set(d.id,+p.sellingPrice||0);
      nameMap .set(d.id,p.itemParticulars||d.id);
    });
  });

  refreshBtn.addEventListener('click', handleRefreshClick);
  pdfBtn    ?.addEventListener('click', handlePDFClick);
})();

/* ---------- UI helpers ---------- */
function setBtnBusy(btn, busy, textBusy){
  if(!btn) return;
  if(busy){
    btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${textBusy}`;
  }else{
    btn.disabled = false;
    if(btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
  }
}

/* ---------- refresh handler ---------- */
function handleRefreshClick(){
  setBtnBusy(refreshBtn, true, 'Refreshing…');
  detach();
  attachListeners();
  /* allow a small delay for first snapshots to land */
  setTimeout(()=> setBtnBusy(refreshBtn,false), 1500);
}

/* ---------- pdf handler ---------- */
async function handlePDFClick(){
  setBtnBusy(pdfBtn, true, 'Exporting…');
  await downloadPDF();
  setBtnBusy(pdfBtn,false);
}

/* ---------- detach / range ---------- */
const detach = () => { unsubSales();unsubExp();unsubStock(); };
const getRange = () => ({
  start:new Date(startInp.value+'T00:00:00'),
  end  :new Date(endInp.value  +'T23:59:59')
});

/* ---------- util ---------- */
const fmt = n=>n.toLocaleString('en-UG',{style:'currency',currency:'UGX',maximumFractionDigits:0});
const ds  =(label,data,color)=>({label,data,backgroundColor:color,borderColor:color,borderWidth:1});
const pastel = i=>`hsl(${i*53%360} 70% 65%)`;

/* colour palette */
const C_TEAL='#14b8a6', C_ORANGE='#fb923c', C_SLATE='#64748b',
      C_EMERALD='#10b981', C_INDIGO='#6366f1';

/* ---------- listeners ---------- */
function attachListeners(){
  const {start,end}=getRange();
  const sTS=Timestamp.fromDate(start), eTS=Timestamp.fromDate(end);

  /* SALES */
  unsubSales=onSnapshot(
    query(collectionGroup(db,'branchSales'),where('createdAt','>=',sTS),where('createdAt','<=',eTS)),
    snap=>{
      const cashMap=new Map(), creditMap=new Map(), prodQty=new Map();
      snap.forEach(doc=>{
        const d=doc.data(), br=doc.ref.parent.parent.id;
        const bucket=d.paymentType==='credit'?creditMap:cashMap;
        bucket.set(br,(bucket.get(br)||0)+(d.grandTotal||0));
        (d.items||[]).forEach(it=>{
          prodQty.set(it.productId,(prodQty.get(it.productId)||0)+(+it.qty||0));
        });
      });
      renderSalesByBranch(cashMap,creditMap);
      renderTopProducts(prodQty);
    });

  /* EXPENSES */
  unsubExp=onSnapshot(
    query(collectionGroup(db,'branchExpenses'),where('createdAt','>=',sTS),where('createdAt','<=',eTS)),
    snap=>{
      const expMap=new Map(), catMap=new Map();
      snap.forEach(doc=>{
        const d=doc.data(), br=doc.ref.parent.parent.id;
        expMap.set(br,(expMap.get(br)||0)+(+d.amount||0));
        const cat=(d.note||'Uncategorised').trim();
        catMap.set(cat,(catMap.get(cat)||0)+(+d.amount||0));
      });
      renderNetCash(expMap);
      renderExpenseBreakdown(catMap);
    });

  /* STOCK */
  unsubStock=onSnapshot(collectionGroup(db,'branchStock'),snap=>{
    const valMap=new Map();
    snap.forEach(d=>{
      const br=d.ref.parent.parent.id;
      const {productId,quantity=0}=d.data();
      const val=quantity*(priceMap.get(productId)||0);
      valMap.set(br,(valMap.get(br)||0)+val);
    });
    renderStockValue(valMap);
  });
}

/* ---------- renderers (same logic, new colours) ---------- */
function renderSalesByBranch(cashMap,creditMap){
  const ids=[...branchMap.keys()].sort(),
        cash=ids.map(id=>cashMap.get(id)||0),
        cred=ids.map(id=>creditMap.get(id)||0);
  chSales?.destroy();
  chSales=new Chart(cvsSales,{
    type:'bar',
    data:{ labels:ids.map(i=>branchMap.get(i)||i),
           datasets:[ ds('Cash',cash,C_TEAL), ds('Credit',cred,C_ORANGE) ] },
    options:{responsive:true,interaction:{mode:'index',intersect:false},
      plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
      scales:{y:{beginAtZero:true}}}
  });
}

function renderStockValue(map){
  const ids=[...branchMap.keys()].sort(),
        vals=ids.map(id=>map.get(id)||0);
  chStock?.destroy();
  chStock=new Chart(cvsStock,{
    type:'bar',
    data:{ labels:ids.map(i=>branchMap.get(i)||i),
           datasets:[ ds('Stock Value',vals,C_SLATE) ] },
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},
             scales:{y:{beginAtZero:true}}}
  });
}

function renderNetCash(expMap){
  if(!chSales) return;
  const ids=[...branchMap.keys()].sort(),
        cash=chSales.data.datasets[0].data,
        net =ids.map((id,i)=>cash[i]-(expMap.get(id)||0));
  chNet?.destroy();
  chNet=new Chart(cvsNet,{
    type:'bar',
    data:{ labels:ids.map(i=>branchMap.get(i)||i),
           datasets:[ ds('Net Cash',net,C_EMERALD) ] },
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},
             scales:{y:{beginAtZero:true}}}
  });
}

function renderTopProducts(prodMap){
  const sorted=[...prodMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10),
        labels=sorted.map(([pid])=>nameMap.get(pid)||pid),
        data  =sorted.map(([,q])=>q);
  chTop?.destroy();
  chTop=new Chart(cvsTop,{
    type:'bar',
    data:{ labels, datasets:[ ds('Units Sold',data,C_INDIGO) ] },
    options:{responsive:true,scales:{y:{beginAtZero:true}}}
  });
}

function renderExpenseBreakdown(catMap){
  const labels=[...catMap.keys()], data=labels.map(k=>catMap.get(k));
  chExp?.destroy();
  chExp=new Chart(cvsExp,{
    type:'doughnut',
    data:{labels,datasets:[{data,backgroundColor:labels.map((_,i)=>pastel(i))}]},
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>`${c.label}: ${fmt(c.raw)}`}}}}
  });
}

/* ---------- PDF export ---------- */
async function downloadPDF(){
  const { jsPDF } = window.jspdf;
  const pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
  const chartsWrap=document.getElementById('reports'); // wrap your chart canvases

  const canvas = await html2canvas(chartsWrap,{scale:2});
  const img   = canvas.toDataURL('image/png',1.0);

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgProps = pdf.getImageProperties(img);
  const ratio = Math.min(pageW / imgProps.width, pageH / imgProps.height);
  pdf.addImage(img,'PNG',(pageW-imgProps.width*ratio)/2,10,imgProps.width*ratio,imgProps.height*ratio);
  pdf.save('dashboard.pdf');
}
