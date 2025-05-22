/* -----------------------------------------------------------
   Top-Level Manager Dashboard – live Chart.js analytics
   v2 – cash/credit now account for deposits on credit sales
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
const branchMap = new Map();   // id → name
const priceMap  = new Map();   // productId → sellingPrice
const nameMap   = new Map();   // productId → productName

/* ---------- chart refs / unsubs ---------- */
let chSales=null,chStock=null,chNet=null,chTop=null,chExp=null;
let unsubSales=()=>{},unsubExp=()=>{},unsubStock=()=>{};

/* ---------- default date range (current month) ---------- */
(function init(){
  const today = new Date();
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  startInp.value = mStart.toISOString().split('T')[0];
  endInp.value   = today.toISOString().split('T')[0];

  /* branch + product caches */
  onSnapshot(collection(db,'companyBranches'), s=>{
    s.forEach(d=> branchMap.set(d.id,d.data().name));
    attachListeners();               // run once after we know branches
  });
  onSnapshot(collection(db,'companyProducts'), s=>{
    s.forEach(d=>{
      priceMap.set(d.id, +d.data().sellingPrice||0);
      nameMap .set(d.id, d.data().itemParticulars || d.id);
    });
  });

  refreshBtn.addEventListener('click', handleRefresh);
  pdfBtn?.addEventListener('click', handlePDFClick);
})();

/* ---------- util ---------- */
const fmt = n => n.toLocaleString('en-UG',{style:'currency',currency:'UGX',maximumFractionDigits:0});
const ds  =(label,data,color)=>({label,data,backgroundColor:color,borderColor:color,borderWidth:1});
const pastel = i=>`hsl(${i*53%360} 70% 65%)`;

const PALETTE={
  cash:'#14b8a6', credit:'#fb923c', stock:'#64748b',
  net:'#10b981',  top:'#6366f1'
};

/* ---------- busy-btn helper ---------- */
function setBusy(btn,flag,txt){
  if(!btn) return;
  if(flag){
    btn.dataset.old=btn.innerHTML;
    btn.disabled=true;
    btn.innerHTML=`<span class="spinner-border spinner-border-sm me-1"></span>${txt}`;
  }else{
    btn.disabled=false;
    btn.innerHTML=btn.dataset.old;
  }
}

/* ---------- refresh ---------- */
function handleRefresh(){
  setBusy(refreshBtn,true,'Refreshing…');
  detach(); attachListeners();
  setTimeout(()=>setBusy(refreshBtn,false),1200);
}

/* ---------- detach ---------- */
const detach=()=>{unsubSales();unsubExp();unsubStock();};
const getRange = () => ({
  start:new Date(startInp.value+'T00:00:00'),
  end  :new Date(endInp.value  +'T23:59:59')
});

/* =========================================================
   attachListeners – creates live snapshots for the range
========================================================= */
function attachListeners(){
  const {start,end}=getRange();
  const sTS=Timestamp.fromDate(start), eTS=Timestamp.fromDate(end);

  /* ===== SALES (deposit-aware) ======================== */
  unsubSales = onSnapshot(
    query(collectionGroup(db,'branchSales'),
          where('createdAt','>=',sTS), where('createdAt','<=',eTS)),
    snap=>{
      const cash=new Map(), credit=new Map(), topQty=new Map();

      snap.forEach(doc=>{
        const d  = doc.data();
        const br = doc.ref.parent.parent.id;

        /*  cash = paidAmount,  credit = balanceDue  */
        const paid  = +d.paidAmount  || 0;
        const bal   = +d.balanceDue  || 0;

        cash.set  (br,(cash.get(br)||0)+paid);
        credit.set(br,(credit.get(br)||0)+bal);

        (d.items||[]).forEach(it=>{
          topQty.set(it.productId,(topQty.get(it.productId)||0)+(+it.qty||0));
        });
      });

      renderSalesByBranch(cash,credit);
      renderTopProducts(topQty);
    });

  /* ===== EXPENSES ==================================== */
  unsubExp = onSnapshot(
    query(collectionGroup(db,'branchExpenses'),
          where('createdAt','>=',sTS), where('createdAt','<=',eTS)),
    snap=>{
      const exp=new Map(), cat=new Map();
      snap.forEach(doc=>{
        const d=doc.data(), br=doc.ref.parent.parent.id;
        exp.set(br,(exp.get(br)||0)+(+d.amount||0));
        const cat=(d.note||'Uncategorised').trim();
        cat.set ? cat.set(cat,(cat.get(cat)||0)+(+d.amount||0))
                : catMap(cat,(catMap.get(cat)||0)+(+d.amount||0));
      });
      renderNetCash(exp);
      renderExpenseBreakdown(cat);
    });

  /* ===== STOCK (instant) ============================= */
  unsubStock = onSnapshot(collectionGroup(db,'branchStock'), snap=>{
    const val=new Map();
    snap.forEach(d=>{
      const br=d.ref.parent.parent.id;
      const {productId,quantity=0}=d.data();
      val.set(br,(val.get(br)||0)+quantity*(priceMap.get(productId)||0));
    });
    renderStockValue(val);
  });
}

/* =================    RENDERERS    =================== */
function renderSalesByBranch(cashMap,creditMap){
  const ids=[...branchMap.keys()].sort();
  const cash=ids.map(id=>cashMap.get(id)||0);
  const cred=ids.map(id=>creditMap.get(id)||0);

  chSales?.destroy();
  chSales=new Chart(cvsSales,{
    type:'bar',
    data:{labels:ids.map(i=>branchMap.get(i)||i),
          datasets:[ ds('Cash',cash,PALETTE.cash),
                     ds('Outstanding Credit',cred,PALETTE.credit) ]},
    options:{responsive:true,interaction:{mode:'index',intersect:false},
      plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
      scales:{y:{beginAtZero:true}}}
  });
}

function renderStockValue(map){
  const ids=[...branchMap.keys()].sort(), vals=ids.map(id=>map.get(id)||0);
  chStock?.destroy();
  chStock=new Chart(cvsStock,{
    type:'bar',
    data:{labels:ids.map(i=>branchMap.get(i)||i),
          datasets:[ ds('Stock Value',vals,PALETTE.stock) ]},
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},
             scales:{y:{beginAtZero:true}}}
  });
}

function renderNetCash(expMap){
  if(!chSales) return;                        // wait until sales chart exists
  const ids=[...branchMap.keys()].sort();
  const cash=chSales.data.datasets[0].data;   // ‘Cash’ dataset
  const net =ids.map((id,i)=>cash[i]-(expMap.get(id)||0));
  chNet?.destroy();
  chNet=new Chart(cvsNet,{
    type:'bar',
    data:{labels:ids.map(i=>branchMap.get(i)||i),
          datasets:[ ds('Net Cash',net,PALETTE.net) ]},
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>fmt(c.parsed.y)}}},
             scales:{y:{beginAtZero:true}}}
  });
}

function renderTopProducts(qtyMap){
  const top=[...qtyMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const labels=top.map(([id])=>nameMap.get(id)||id);
  const data  =top.map(([,q])=>q);

  chTop?.destroy();
  chTop=new Chart(cvsTop,{
    type:'bar',
    data:{labels,datasets:[ ds('Units Sold',data,PALETTE.top) ]},
    options:{responsive:true,scales:{y:{beginAtZero:true}}}
  });
}

function renderExpenseBreakdown(cat){
  const labels=[...cat.keys()], data=labels.map(k=>cat.get(k));
  chExp?.destroy();
  chExp=new Chart(cvsExp,{
    type:'doughnut',
    data:{labels,datasets:[{data,backgroundColor:labels.map((_,i)=>pastel(i))}]},
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>`${c.label}: ${fmt(c.raw)}`}}}}
  });
}

/* =================  PDF export (unchanged) =============== */
async function handlePDFClick(){
  setBusy(pdfBtn,true,'Exporting…');
  await downloadPDF();
  setBusy(pdfBtn,false);
}
async function downloadPDF(){
  const { jsPDF } = window.jspdf;
  const pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
  const wrap=document.getElementById('reports');
  const canvas=await html2canvas(wrap,{scale:2});
  const img=canvas.toDataURL('image/png',1.0);
  const w=pdf.internal.pageSize.getWidth();
  const h=pdf.internal.pageSize.getHeight();
  const p=pdf.getImageProperties(img);
  const r=Math.min(w/p.width,h/p.height);
  pdf.addImage(img,'PNG',(w-p.width*r)/2,10,p.width*r,p.height*r);
  pdf.save('dashboard.pdf');
}
