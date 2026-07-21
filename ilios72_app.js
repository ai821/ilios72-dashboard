// ============================================
// SUPABASE AUTH CHECK — runs on page load
// ============================================
(async function checkAuth() {
  try {
    if (typeof sb === 'undefined') {
      console.error('supabase.js not loaded');
      return;
    }
    const restored = await sb.restoreSession();
    if (!restored) {
      window.location.href = 'index.html';
      return;
    }
    if (sb.isClient()) {
      window.location.href = 'client.html';
      return;
    }
    // Show user info in nav bar
    const profile = sb.profile;
    const nameEl = document.getElementById('userBarName');
    const roleEl = document.getElementById('userBarRole');
    if (nameEl) nameEl.textContent = profile?.full_name || profile?.email || '';
    if (roleEl) roleEl.textContent = 'Company';
    // Pull latest PMS performance data (kept fresh by the daily GitHub
    // Actions APMI sync) as soon as the session is confirmed — works on
    // any computer, no button click required.
    if (typeof syncPmsFromSupabase === 'function') syncPmsFromSupabase({ silent: true });
  } catch(e) {
    console.error('Auth check failed:', e);
  }
})();

async function doLogout() {
  try {
    if (typeof sb !== 'undefined') await sb.signOut();
  } catch(e) {}
  window.location.href = 'index.html';
}


// ==================================================
// DATA STORE
// ==================================================
const K={H:'i72_h',T:'i72_t',P:'i72_p',C:'i72_c',PMS:'i72_pms',UP:'i72_up',TK:'i72_tk',SM:'i72_scripmaster',AN:'i72_analysis',PSA:'i72_pms_sector_alloc'};
function ld(k){try{const d=localStorage.getItem(k);return d?JSON.parse(d):[]}catch{return[]}}
function sv(k,d){localStorage.setItem(k,JSON.stringify(d))}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

let clients=ld(K.C), holdings=ld(K.H), txns=ld(K.T), prices={};
let pmsSectorAlloc={};
try{pmsSectorAlloc=JSON.parse(localStorage.getItem(K.PSA)||'{}')}catch{pmsSectorAlloc={}}
try{prices=JSON.parse(localStorage.getItem(K.P)||'{}')}catch{prices={}}
let uploads=ld(K.UP);
let tickerMap={};
try{tickerMap=JSON.parse(localStorage.getItem(K.TK)||'{}')}catch{tickerMap={}}

// Angel One
let aoToken=localStorage.getItem('ao_token')||'';
const AO_CONFIG={apiKey:'q8VzMrXq',clientId:'AACB743528',mpin:'1192',totpSecret:'5A2NTCA7IASO2IBE6NYZTAYBC4'};

// -- PMS Library --
const DEFAULT_PMS = [
  {id:'stallion',name:'Stallion Asset Private Limited',strategy:'Stallion Asset Core Fund',aum:7681.11,bench:'S&P BSE 500 TRI',r1m:7.56,r1y:15.31,r3y:39.14,r4y:32.43,r5y:25.90,rsi:28.02},
  {id:'negen',name:'Negen Capital Services',strategy:'Negen Special Situations & Dynamic Allocation',aum:1384.71,bench:'S&P BSE 500 TRI',r1m:2.45,r1y:-0.35,r3y:24.59,r4y:20.91,r5y:21.12,rsi:17.10},
  {id:'abakkus',name:'Abakkus Asset Manager',strategy:'Abakkus Diversified Alpha Approach',aum:1283.92,bench:'Nifty 500 TRI',r1m:2.08,r1y:9.49,r3y:null,r4y:null,r5y:null,rsi:9.94},
  {id:'sameeksha',name:'Sameeksha Capital',strategy:'Sameeksha India Equity Fund',aum:1209.60,bench:'S&P BSE 500 TRI',r1m:1.57,r1y:-1.06,r3y:20.62,r4y:20.50,r5y:17.47,rsi:20.20},
  {id:'hem_dream',name:'Hem Securities Limited',strategy:'DREAM Strategy',aum:182.31,bench:'S&P BSE 500 TRI',r1m:1.37,r1y:-0.36,r3y:18.25,r4y:18.50,r5y:17.42,rsi:21.09},
  {id:'icici_pipe',name:'ICICI Prudential AMC',strategy:'ICICI Prudential PMS PIPE',aum:7464.86,bench:'S&P BSE 500 TRI',r1m:0.09,r1y:5.95,r3y:22.20,r4y:23.49,r5y:22.99,rsi:24.75},
  {id:'buoyant',name:'Buoyant Capital Private Limited',strategy:'Buoyant Opportunities PMS',aum:10812.77,bench:'S&P BSE 500 TRI',r1m:-0.78,r1y:8.11,r3y:18.92,r4y:20.98,r5y:20.92,rsi:20.64},
  {id:'renaissance',name:'Renaissance Investment Managers',strategy:'Renaissance India Next Portfolio',aum:880.94,bench:'Nifty 500 TRI',r1m:-0.80,r1y:-8.85,r3y:12.91,r4y:16.16,r5y:17.28,rsi:13.10},
  {id:'2point2',name:'2Point2 Capital Advisors',strategy:'2Point2 Long Term Value Fund',aum:1985.20,bench:'Nifty 500 TRI',r1m:-1.10,r1y:5.60,r3y:18.42,r4y:20.78,r5y:18.19,rsi:18.83},
  {id:'hem_sme',name:'Hem Securities Limited',strategy:'India Rising SME Stars',aum:91.41,bench:'S&P BSE SmallCap TRI',r1m:-1.98,r1y:-3.99,r3y:15.83,r4y:24.43,r5y:null,rsi:22.16},
];
let pmsList=ld(K.PMS);
if(!pmsList.length){pmsList=[...DEFAULT_PMS];sv(K.PMS,pmsList)}
// Ensure all DEFAULT_PMS entries exist (re-adds any that were accidentally removed)
DEFAULT_PMS.forEach(def=>{
  if(!pmsList.find(p=>p.id===def.id)){
    pmsList.unshift(def); // add missing PMS back at top
    sv(K.PMS,pmsList);
  }
});

// Normalizes any weird whitespace (non-breaking spaces, unicode spaces from
// PDF copy-paste — common at line-wrap points) down to plain single spaces,
// so stock names match the symbol dictionary reliably.
function normalizeSpaces(s){return (s||'').replace(/[\s\u00A0\u2000-\u200B\u202F\uFEFF]+/g,' ').trim()}

// NSE Symbol Lookup
const NSE_SYM={
  'MAX FINANCIAL SERVICES LTD':'MFSL','ONE 97 COMMUNICATIONS LTD':'PAYTM','KAYNES TECHNOLOGY INDIA LTD':'KAYNES',
  'CAMPUS ACTIVEWEAR LTD':'CAMPUS','GLENMARK PHARMACEUTICALS LTD':'GLENMARK','INDEGENE LTD':'INDGN',
  'VARUN BEVERAGES LTD':'VBL','CHAMBAL FERTILISERS AND CHEMICALS LTD':'CHAMBLFERT','CHAMBAL FERTILISERS and CHEMICALS LTD':'CHAMBLFERT',
  'RAMKRISHNA FORGINGS LTD':'RKFORGE','TRENT LTD':'TRENT','VEDANTA ALUMINIUM METAL LTD':'VAML','VEDANTA LTD':'VEDL',
  'LARSEN AND TOUBRO LTD':'LT','LARSEN and TOUBRO LTD':'LT','HINDUSTAN UNILEVER LTD':'HINDUNILVR',
  'BHARTI AIRTEL LTD':'BHARTIARTL','INTERGLOBE AVIATION LTD':'INDIGO','STATE BANK OF INDIA':'SBIN',
  'ICICI LOMBARD GENERAL INSURANCE COMPANY LTD':'ICICIGI','DALMIA BHARAT LTD':'DALBHARAT','ULTRATECH CEMENT LTD':'ULTRACEMCO',
  'INFOSYS LTD':'INFY','SHRIRAM FINANCE LTD':'SHRIRAMFIN','AUROBINDO PHARMA LTD':'AUROPHARMA',
  'DR REDDYS LABORATORIES LTD':'DRREDDY','BAJAJ FINANCE LTD':'BAJFINANCE','AXIS BANK LTD':'AXISBANK',
  'HDFC BANK LTD':'HDFCBANK','ICICI BANK LTD':'ICICIBANK','IDFC FIRST BANK LTD':'IDFCFIRSTB',
  'SBI LIFE INSURANCE COMPANY LTD':'SBILIFE','BHARAT PETROLEUM CORPORATION LTD':'BPCL',
  'PVR INOX LTD':'PVRINOX','ITC LTD':'ITC','DIVIS LABORATORIES LTD':'DIVISLAB',
  'BAJAJ AUTO LTD':'BAJAJ-AUTO','ASIAN PAINTS LTD':'ASIANPAINT',
  'SUN PHARMACEUTICAL INDUSTRIES LTD':'SUNPHARMA','BRITANNIA INDUSTRIES LTD':'BRITANNIA',
  'ASTRAL LTD':'ASTRAL','MANAPPURAM FINANCE LTD':'MANAPPURAM','UNITED SPIRITS LTD':'UNITDSPR',
  'BANK OF BARODA':'BANKBARODA','VIYASH SCIENTIFIC LTD':'VIYASHSCI',
  'DEEPAK FERTILISERS AND PETROCHEMICALS CORPORATION LTD':'DEEPAKFERT',
  'DEEPAK FERTILISERS and PETROCHEMICALS CORPORATION LTD':'DEEPAKFERT',
  'ITC HOTELS LTD':'ITCHOTELS','DECCAN CEMENTS LTD':'DECCANCE','SPR AUTO TECHNOLOGIES LTD':'SHRIPISTON',
};

function resolveNSE(name){
  if(!name)return name;
  name=normalizeSpaces(name);
  // User-defined ticker map takes priority
  if(tickerMap[name.toUpperCase()])return tickerMap[name.toUpperCase()];
  if(NSE_SYM[name])return NSE_SYM[name];
  if(NSE_SYM[name.toUpperCase()])return NSE_SYM[name.toUpperCase()];
  // Strip LTD and try again
  const cleaned=name.toUpperCase().replace(/\s+LTD\.?$/,'').trim();
  if(NSE_SYM[cleaned])return NSE_SYM[cleaned];
  return name.toUpperCase().replace(/\s+LTD\.?$/,'').replace(/\s+/g,'');
}

// True only if we have a real, previously-confirmed mapping for this name
// (either user-added or built-in) — false means resolveNSE() had to fall
// back to a raw guess that's unlikely to be a real ticker.
function isKnownSymbolMapping(name){
  if(!name)return false;
  const n=normalizeSpaces(name);
  const cleaned=n.toUpperCase().replace(/\s+LTD\.?$/,'').trim();
  return !!(tickerMap[n.toUpperCase()]||NSE_SYM[n]||NSE_SYM[n.toUpperCase()]||NSE_SYM[cleaned]);
}

// == HELPERS ==
function fINR(n){if(!n&&n!==0)return'—';return'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2})}
function fCr(n){if(!n&&n!==0)return'—';const cr=n/10000000;if(Math.abs(cr)>=1)return'₹'+cr.toFixed(2)+' Cr';const lk=n/100000;if(Math.abs(lk)>=1)return'₹'+lk.toFixed(2)+' L';return fINR(n)}
function fPct(n){if(n===null||n===undefined)return'NA';return(n>=0?'+':'')+Number(n).toFixed(2)+'%'}
function toast(msg,err){const t=document.getElementById('toast');t.textContent=msg;t.className='toast show'+(err?' err':'');setTimeout(()=>t.className='toast',3000)}
function openMo(id){document.getElementById(id).classList.add('open')}
function closeMo(id){document.getElementById(id).classList.remove('open')}
function getClientName(id){const c=clients.find(x=>x.id===id);return c?c.name:(id||'—')}
function getPmsName(id){const p=pmsList.find(x=>x.id===id);return p?p.strategy:(id||'—')}

// == TABS ==
// IMPORTANT: scoped to #tabsBar only. The `.tab` CSS class is reused on the
// Factsheet Intelligence sub-tabs (fsiTab0/1/2) and the Fund Manager modal's
// tabs (fmTab1/2/3), which have no `data-tab` attribute. Previously this
// selector matched ALL `.tab` elements on the page, so clicking one of those
// sub-tabs also ran this handler, wiped `.active` off every top-level panel
// (including p-factsheets itself), then crashed on
// `document.getElementById('p-undefined')` — leaving the whole panel blank.
document.querySelectorAll('#tabsBar .tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('#tabsBar .tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('p-'+t.dataset.tab).classList.add('active');
}));

// == SPLASH ==
setTimeout(()=>{document.getElementById('splash').classList.add('hide');document.getElementById('app').style.display='block';renderAll()},2200);

// == POPULATE ==
function populateDropdowns(){
  const pmsOpts=pmsList.map(p=>`<option value="${p.id}">${p.name} — ${p.strategy}</option>`).join('');
  const clientOpts=[...clients].sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  ['cl-pms','ecl-pms','upHPms','upTPms'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<option value="">Select PMS...</option>'+pmsOpts});
  ['upHClient','upTClient'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<option value="">Select Client...</option>'+clientOpts});
  ['holdClientFilter','txnClientFilter'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<option value="all">All Clients</option>'+clientOpts});
  const holdPmsEl=document.getElementById('holdPmsFilter');
  if(holdPmsEl){
    const prevVal=holdPmsEl.value||'all';
    holdPmsEl.innerHTML='<option value="all">All PMS</option>'+pmsOpts;
    if([...holdPmsEl.options].some(o=>o.value===prevVal))holdPmsEl.value=prevVal;
  }
}

// == CLIENTS ==
function addClient(){
  const name=document.getElementById('cl-name').value.trim();
  if(!name){toast('Enter client name','r');return}
  clients.push({id:uid(),name,pan:document.getElementById('cl-pan').value.trim(),pmsId:document.getElementById('cl-pms').value,risk:document.getElementById('cl-risk').value,amount:parseFloat(document.getElementById('cl-amt').value)||0,date:document.getElementById('cl-date').value,notes:document.getElementById('cl-notes').value.trim(),createdAt:new Date().toISOString()});
  sv(K.C,clients);closeMo('addClientMo');renderAll();toast(name+' added ✓');
  ['cl-name','cl-pan','cl-amt','cl-date','cl-notes'].forEach(id=>document.getElementById(id).value='');
}

function openEditClient(id){
  const c=clients.find(x=>x.id===id);if(!c)return;
  populateDropdowns();
  document.getElementById('ecl-id').value=c.id;
  document.getElementById('ecl-name').value=c.name||'';
  document.getElementById('ecl-pan').value=c.pan||'';
  document.getElementById('ecl-risk').value=c.risk||'Aggressive';
  document.getElementById('ecl-amt').value=c.amount||'';
  document.getElementById('ecl-date').value=c.date||'';
  document.getElementById('ecl-notes').value=c.notes||'';
  const pEl=document.getElementById('ecl-pms');if(pEl&&c.pmsId)pEl.value=c.pmsId;
  openMo('editClientMo');
}

function updateClient(){
  const id=document.getElementById('ecl-id').value;
  const name=document.getElementById('ecl-name').value.trim();
  if(!name){toast('Name required','r');return}
  const idx=clients.findIndex(c=>c.id===id);if(idx===-1)return;
  clients[idx]={...clients[idx],name,pan:document.getElementById('ecl-pan').value.trim(),pmsId:document.getElementById('ecl-pms').value,risk:document.getElementById('ecl-risk').value,amount:parseFloat(document.getElementById('ecl-amt').value)||0,date:document.getElementById('ecl-date').value,notes:document.getElementById('ecl-notes').value.trim()};
  sv(K.C,clients);closeMo('editClientMo');renderAll();toast(name+' updated ✓');
}

function deleteClient(id){if(!confirm('Delete client and all data?'))return;clients=clients.filter(c=>c.id!==id);holdings=holdings.filter(h=>h.clientId!==id);txns=txns.filter(t=>t.clientId!==id);sv(K.C,clients);sv(K.H,holdings);sv(K.T,txns);renderAll();toast('Client deleted')}

// == RENDER ==
function renderAll(){
  autoFixOrphansSilently();
  populateDropdowns();
  renderOverview();
  renderClients();
  renderHoldings();
  renderTxns();
  renderCompare();
  renderAnalysis();
  updateOrphanWarning();
  updateApmiSyncLabel();
  renderUploadHistory();
  renderTickerMappings();
  document.getElementById('headerMeta').textContent=`${clients.length} clients · ${holdings.length} holdings · ${txns.length} txns`;
}

// Shared corruption check — same rule already visible as "⚠ bad data" in
// the Holdings tab. A real stock name or sector is never this long; this
// flags rows from bad imports so every aggregate view (Overview charts,
// PMS comparisons, etc.) excludes them consistently rather than letting
// garbled text distort real numbers.
// Phrases that are never real stock names but commonly leak in from
// factsheet section headings, disclaimers, or summary tables when a PDF's
// layout confuses the extractor — these are always corrupted regardless of
// how short they are, unlike the length-based check below which only
// catches long glued-together fragments.
const NON_STOCK_PHRASE_RE=/^(Sector Allocation|Investment Objective|Portfolio Holdings|Portfolio Summary|Portfolio Returns|Portfolio Value|Contribution|Withdrawal|Profit\s*\/\s*Loss|Since Inception|Inception Date|Account|Strategy|Benchmark|Performance|Total|Other Apparels?|Forest Products?)\b/i;

function isCorruptedHolding(h){
  const stock=(h.stock||'').trim();
  const sector=(h.sector||'').trim();
  if(stock.length>60 || sector.length>30) return true;
  if(NON_STOCK_PHRASE_RE.test(stock)) return true;
  if(/\d+(\.\d+)?%/.test(stock)) return true; // a real stock name never contains a percentage figure
  return false;
}

// ══ SECTOR NAME MERGING ══
// Different factsheets (and even the same PMS's own chart vs table) spell
// the same sector differently — casing, punctuation, a bracketed
// abbreviation, or a well-known shorthand ("IT"/"NBFC"/"FMCG"). Left as-is,
// charts show these as separate near-duplicate slices instead of one. This
// deliberately only merges exact-same-sector spelling/abbreviation variants
// — it never collapses genuinely different (if related) sectors like a
// broad "Financials" vs a narrower "NBFC".
const SECTOR_ALIAS_MAP={
  'it':'Information Technology','informationtechnology':'Information Technology',
  'fmcg':'Fast Moving Consumer Goods','fastmovingconsumergoods':'Fast Moving Consumer Goods',
  'nbfc':'NBFC','nonbankingfinancecompany':'NBFC','nonbankingfinancialcompany':'NBFC','nonbankingfinancialcompanies':'NBFC',
  'fintech':'FinTech','financialtechnology':'FinTech',
  'healthcare':'Healthcare',
  'oilgas':'Oil & Gas','oilgases':'Oil & Gas',
  'cash':'Cash & Equivalents','cashequivalent':'Cash & Equivalents','cashequivalents':'Cash & Equivalents',
  'others':'Others','other':'Others','miscellaneous':'Others',
  'unclassified':'Unclassified','uncategorized':'Unclassified','notclassified':'Unclassified',
  'consumerdurable':'Consumer Durables','consumerdurables':'Consumer Durables',
  'itservices':'Information Technology','computerssoftwareconsulting':'Information Technology',
};
function sectorNormKey(name){
  let s=normalizeSpaces((name||'').toString());
  s=s.replace(/\s*\([^()]{1,40}\)\s*$/,'').trim()||s;
  return s.toLowerCase().replace(/\band\b/g,'').replace(/[^a-z0-9]/g,'');
}
function mergeSimilarSectors(raw){
  const amounts={},labelForKey={};
  Object.entries(raw).forEach(([name,amt])=>{
    const key=sectorNormKey(name);
    if(!key){amounts['']=(amounts['']||0)+amt;labelForKey['']=labelForKey['']||normalizeSpaces(name)||'Unclassified';return}
    const canon=SECTOR_ALIAS_MAP[key];
    if(canon)labelForKey[key]=canon;
    else if(!labelForKey[key])labelForKey[key]=normalizeSpaces(name);
    amounts[key]=(amounts[key]||0)+amt;
  });
  const out={};
  Object.keys(amounts).forEach(k=>{out[labelForKey[k]]=(out[labelForKey[k]]||0)+amounts[k]});
  return out;
}

// ══ ANALYSIS: stock / sector drift alerts ══
// Compares holdings state immediately before vs after each holdings import
// (confirmHoldingsImport) and records any move big enough to matter:
//   - a single stock's weight within one client's portfolio moving >= 3%
//   - a sector's share of one PMS's total book (across all its clients)
//     moving by more than 2%
// Alerts persist in localStorage (K.AN) so the Analysis tab reflects the
// latest state on every visit, not just right after an upload.
function computeSectorBreakdown(hArr){
  const rawSectors={};
  let total=0;
  hArr.forEach(x=>{const s=x.sector||'Other';const v=x.mktValue||0;rawSectors[s]=(rawSectors[s]||0)+v;total+=v;});
  const sectors=mergeSimilarSectors(rawSectors);
  const out={};
  Object.keys(sectors).forEach(s=>{out[s]=total>0?(sectors[s]/total*100):0});
  return out;
}

function recordDriftAlerts(clientId,pmsId,oldClientRows,newClientRows,oldPmsHoldings,newPmsHoldings,uploadId){
  const alerts=ld(K.AN);
  const now=new Date().toISOString();
  const clientName=getClientName(clientId);
  const pmsName=getPmsName(pmsId);

  const oldByStock={};
  oldClientRows.forEach(r=>{oldByStock[r.stock]=(oldByStock[r.stock]||0)+(r.weight||0)});
  const newByStock={};
  newClientRows.forEach(r=>{newByStock[r.stock]=(newByStock[r.stock]||0)+(r.weight||0)});
  const allStocks=new Set([...Object.keys(oldByStock),...Object.keys(newByStock)]);
  allStocks.forEach(stock=>{
    const oldW=oldByStock[stock]||0,newW=newByStock[stock]||0;
    const delta=newW-oldW;
    if(Math.abs(delta)>=3){
      alerts.unshift({id:uid(),type:'stock',date:now,clientId,client:clientName,pmsId,pms:pmsName,name:stock,oldPct:oldW,newPct:newW,delta,uploadId});
    }
  });

  const oldSec=computeSectorBreakdown(oldPmsHoldings);
  const newSec=computeSectorBreakdown(newPmsHoldings);
  const allSectors=new Set([...Object.keys(oldSec),...Object.keys(newSec)]);
  allSectors.forEach(sector=>{
    const oldW=oldSec[sector]||0,newW=newSec[sector]||0;
    const delta=newW-oldW;
    if(Math.abs(delta)>2){
      alerts.unshift({id:uid(),type:'sector',date:now,pmsId,pms:pmsName,name:sector,oldPct:oldW,newPct:newW,delta,uploadId});
    }
  });

  sv(K.AN,alerts.slice(0,300));
}

// Stocks moving 3% or more today, either direction, using live price data
// already fetched (prices[sym+'_chg']) — same field the Overview "Top
// Movers" section reads, so this stays in sync with real fetched data.
function renderPriceMoveAlerts(){
  const box=document.getElementById('priceMoveBox');
  if(!box)return;
  const moveAlerts=[];
  const seen=new Set();
  holdings.filter(x=>!isCorruptedHolding(x)).forEach(x=>{
    if(seen.has(x.stock))return; // one alert per distinct stock, not per client holding it
    const nseSym=resolveNSE(x.stock);
    const chg=prices[nseSym+'_chg'];
    if(chg===undefined||chg===null)return;
    if(Math.abs(chg)>=3){
      seen.add(x.stock);
      const up=chg>0;
      moveAlerts.push(`<div style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="badge ${up?'bg':'br'}">${up?'▲':'▼'} ${chg.toFixed(2)}%</span> <b>${x.stock}</b> ${up?'jumped':'dropped'} significantly today</div>`);
    }
  });
  box.innerHTML=moveAlerts.length?moveAlerts.join(''):'<span style="color:var(--green)">✓ No stock moved 3% or more today (or no live price data fetched yet).</span>';
}

function renderAnalysis(){
  const stockBox=document.getElementById('stockDriftBox');
  const sectorBox=document.getElementById('sectorDriftBox');
  if(!stockBox||!sectorBox)return; // Analysis tab not on this page (or not yet added)
  renderPriceMoveAlerts();
  const alerts=ld(K.AN);
  const stockAlerts=alerts.filter(a=>a.type==='stock');
  const sectorAlerts=alerts.filter(a=>a.type==='sector');
  const row=a=>{
    const dirColor=a.delta>0?'var(--green)':'var(--red)';
    const dirIcon=a.delta>0?'▲':'▼';
    const label=a.type==='stock'?`<b>${a.client}</b> — ${a.name} <span style="color:var(--muted);font-weight:400">(${a.pms})</span>`:`<b>${a.pms}</b> — ${a.name}`;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>${label}<div style="font-size:10px;color:var(--muted);margin-top:2px">${new Date(a.date).toLocaleString('en-IN')}</div></div>
      <div style="text-align:right;white-space:nowrap"><span style="color:${dirColor};font-weight:700">${dirIcon} ${Math.abs(a.delta).toFixed(2)}%</span><div style="font-size:10px;color:var(--muted)">${a.oldPct.toFixed(2)}% → ${a.newPct.toFixed(2)}%</div></div>
    </div>`;
  };
  stockBox.innerHTML=stockAlerts.length?stockAlerts.map(row).join(''):'<span style="color:var(--green)">✓ No stock weight moves of 3% or more since the last upload.</span>';
  sectorBox.innerHTML=sectorAlerts.length?sectorAlerts.map(row).join(''):'<span style="color:var(--green)">✓ No sector allocation moves greater than 2% since the last upload.</span>';
}

function clearDriftAlerts(){
  if(!confirm('Clear all drift alerts? This cannot be undone.'))return;
  sv(K.AN,[]);
  renderAnalysis();
  toast('Drift alerts cleared');
}


// Real invested amount for a client: prefer the manually-entered amount
// field if it's actually been set; otherwise derive it from real BUY/SELL
// transaction records already on file for that client — never a guess or
// placeholder, only whichever real data source is actually populated.
function getClientInvestedAmount(client){
  if(client.amount && client.amount>0) return client.amount;
  const clientTxns=txns.filter(t=>t.clientId===client.id);
  if(!clientTxns.length) return 0;
  return clientTxns.reduce((s,t)=>{
    const amt=t.amount||0;
    return s + ((t.type||'').toUpperCase()==='SELL' ? -amt : amt);
  },0);
}

function renderOverview(){
  const pmsFilter=document.getElementById('overviewPmsFilter')?.value||'all';
  // Populate PMS filter dropdown
  const pmsDropdown=document.getElementById('overviewPmsFilter');
  if(pmsDropdown&&pmsDropdown.options.length<=1){
    pmsDropdown.innerHTML='<option value="all">All PMS — Combined</option>'+pmsList.map(p=>`<option value="${p.id}">${p.name} — ${p.strategy}</option>`).join('');
    pmsDropdown.value=pmsFilter;
  }

  let hAll=pmsFilter==='all'?holdings:holdings.filter(x=>x.pmsId===pmsFilter);
  const h=hAll.filter(x=>!isCorruptedHolding(x)); // clean holdings only, for every calculation below
  const corruptedCount=hAll.length-h.length;
  let c=pmsFilter==='all'?clients:clients.filter(x=>x.pmsId===pmsFilter);

  // Use live prices for current value
  const totalHoldValue=h.reduce((s,x)=>{
    const nseSym=resolveNSE(x.stock);
    const cmp=prices[nseSym]||prices[x.stock]||0;
    return s+(cmp>0&&x.qty?x.qty*cmp:x.mktValue||0);
  },0);
  const totalInvested=c.reduce((s,x)=>s+getClientInvestedAmount(x),0);
  const pnl=totalInvested>0?totalHoldValue-totalInvested:0;
  const pnlPct=totalInvested>0?(pnl/totalInvested*100):0;
  const totalStocks=[...new Set(h.map(x=>x.stock))].length;

  document.getElementById('overviewMetrics').innerHTML=`
    <div class="metric"><div class="label">Portfolio Value</div><div class="val">${fCr(totalHoldValue)}</div><div class="sub">${pnl!==0?`<span class="${pnl>=0?'tg':'tr'}">${fPct(pnlPct)} P&L</span>`:''}</div></div>
    <div class="metric"><div class="label">Total Invested</div><div class="val">${fCr(totalInvested)}</div></div>
    <div class="metric"><div class="label">${pmsFilter==='all'?'Clients':'Stocks'}</div><div class="val">${pmsFilter==='all'?c.length:totalStocks}</div></div>
    <div class="metric"><div class="label">${pmsFilter==='all'?'Stocks Tracked':'Holdings Value'}</div><div class="val">${pmsFilter==='all'?totalStocks:fCr(totalHoldValue)}</div></div>
  `;

  // Quiet, honest flag when corrupted rows were excluded from the numbers
  // above — better than silently including or silently hiding the issue.
  const dqEl=document.getElementById('overviewDataQuality');
  if(dqEl){
    dqEl.innerHTML = corruptedCount>0
      ? `⚠ ${corruptedCount} holding${corruptedCount!==1?'s':''} excluded from these figures due to corrupted import data — fix via the ✎ Edit button in Holdings tab.`
      : '';
  }

  renderSectorChart(h);
  renderAumTrend();
  renderAlerts(h);
  renderClientSectorAccordion(pmsFilter);
  renderTopMovers(h);
  renderPmsAumComparison();
}

// -- AUM Trend from snapshots --
let aumChartInstance=null;
function renderAumTrend(){
  let snapshots=[];try{snapshots=JSON.parse(localStorage.getItem('i72_snaps')||'[]')}catch{}
  const ctx=document.getElementById('aumChart');
  if(aumChartInstance)aumChartInstance.destroy();
  if(!snapshots.length){
    ctx.parentElement.querySelector('.sec').textContent='AUM Trend (uploads build this chart)';
    return;
  }
  const labels=snapshots.map(s=>s.date);
  const data=snapshots.map(s=>s.value/10000000);
  aumChartInstance=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'AUM (Cr)',data,borderColor:'#E8731A',backgroundColor:'rgba(232,115,26,0.1)',fill:true,tension:0.3,pointRadius:3}]},options:{responsive:true,scales:{y:{ticks:{color:'#666',callback:v=>v.toFixed(1)+'Cr'},grid:{color:'#222'}},x:{ticks:{color:'#666',maxRotation:45},grid:{display:false}}},plugins:{legend:{display:false}}}});
}

// Save snapshot on factsheet upload
function saveSnapshot(){
  let snaps=[];try{snaps=JSON.parse(localStorage.getItem('i72_snaps')||'[]')}catch{}
  const val=holdings.reduce((s,h)=>s+(h.mktValue||0),0);
  snaps.push({date:new Date().toLocaleDateString('en-IN'),value:val,stocks:holdings.length});
  localStorage.setItem('i72_snaps',JSON.stringify(snaps));
}

// -- Backup / Restore — protects against the browser-storage-only /
// multi-tab data loss risk, since there's no server-side copy of anything --
function downloadBackup(){
  const backup={
    _meta:{app:'ILIOS 72',exportedAt:new Date().toISOString(),version:1},
    clients,holdings,txns,pmsList,uploads,tickerMap
  };
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.href=url;a.download=`ilios72-backup-${stamp}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const statusEl=document.getElementById('backupStatus');
  if(statusEl)statusEl.textContent=`✓ Backup downloaded: ${clients.length} clients, ${holdings.length} holdings, ${txns.length} txns (${new Date().toLocaleTimeString('en-IN')})`;
}

function restoreBackup(event){
  const file=event.target.files[0];if(!file)return;
  const statusEl=document.getElementById('backupStatus');
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.clients||!data.holdings){throw new Error('Not a valid backup file')}
      if(!confirm(`Restore this backup? It has ${data.clients.length} clients, ${data.holdings.length} holdings, ${(data.txns||[]).length} txns.\n\nThis will REPLACE all current data in this browser.`))return;
      clients=data.clients||[];holdings=data.holdings||[];txns=data.txns||[];
      pmsList=data.pmsList&&data.pmsList.length?data.pmsList:pmsList;
      uploads=data.uploads||[];tickerMap=data.tickerMap||{};
      sv(K.C,clients);sv(K.H,holdings);sv(K.T,txns);sv(K.PMS,pmsList);sv(K.UP,uploads);sv(K.TK,tickerMap);
      renderAll();
      if(statusEl)statusEl.textContent=`✓ Restored: ${clients.length} clients, ${holdings.length} holdings (${new Date().toLocaleTimeString('en-IN')})`;
      toast('Backup restored ✓');
    }catch(err){
      if(statusEl)statusEl.textContent='❌ Restore failed: '+err.message;
      toast('Restore failed — check file','r');
    }
  };
  reader.readAsText(file);
  event.target.value=''; // allow re-selecting the same file later
}

// -- Alerts --
function renderAlerts(h){
  const box=document.getElementById('alertsBox');
  const alerts=[];
  // Alert: stocks with >5% drop
  h.forEach(x=>{
    const nseSym=resolveNSE(x.stock);
    const chg=prices[nseSym+'_chg']||0;
    if(chg<-5) alerts.push(`<div style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="badge br">- ${chg.toFixed(2)}%</span> <b>${x.stock}</b> dropped significantly today</div>`);
  });
  // Alert: stale factsheets
  clients.forEach(c=>{
    const lastUp=uploads.filter(u=>u.type==='holdings'&&u.clientId===c.id).pop();
    if(lastUp){
      const days=Math.floor((Date.now()-new Date(lastUp.date).getTime())/86400000);
      if(days>15) alerts.push(`<div style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="badge bo">⏰ ${days}d ago</span> <b>${c.name}</b> factsheet is stale — upload a fresh one</div>`);
    } else {
      alerts.push(`<div style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="badge bb">ℹ</span> <b>${c.name}</b> — no factsheet uploaded yet</div>`);
    }
  });
  box.innerHTML=alerts.length?alerts.join(''):'<span style="color:var(--green)">✓ No alerts — everything looks good.</span>';
}

function renderClients(){
  const grid=document.getElementById('clientGrid');
  const empty=document.getElementById('clientEmpty');
  if(!clients.length){grid.innerHTML='';empty.style.display='block';return}
  empty.style.display='none';
  grid.innerHTML=clients.map(c=>{
    const myH=holdings.filter(h=>h.clientId===c.id);
    const holdVal=myH.reduce((s,h)=>{
      const nseSym=resolveNSE(h.stock);
      const cmp=prices[nseSym]||prices[h.stock]||0;
      return s+(cmp>0&&h.qty?h.qty*cmp:h.mktValue||0);
    },0);
    const lastUp=uploads.filter(u=>u.type==='holdings'&&u.clientId===c.id).pop();
    const daysSinceUp=lastUp?Math.floor((Date.now()-new Date(lastUp.date).getTime())/86400000):null;
    const staleColor=daysSinceUp===null?'var(--blue)':daysSinceUp>30?'var(--red)':daysSinceUp>15?'var(--orange)':'var(--green)';
    const staleText=daysSinceUp===null?'No factsheet':daysSinceUp===0?'Today':daysSinceUp+'d ago';
    const pmsName=getPmsName(c.pmsId);
    return `<div class="card" style="border-left:3px solid var(--orange)">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
        <div><div style="font-size:15px;font-weight:700">${c.name}</div><div style="font-size:10px;color:var(--muted);margin-top:2px">${c.pan||'—'} · ${c.risk||'—'}</div></div>
        <div style="display:flex;gap:6px"><button class="btn btn-s btn-sm" onclick="openEditClient('${c.id}')">✎</button><button class="btn btn-d btn-sm" onclick="deleteClient('${c.id}')">✕</button></div>
      </div>
      ${c.amount>0?`<div style="display:flex;justify-content:space-between;padding:8px 10px;background:var(--card2);border-radius:var(--r);margin-bottom:8px"><span style="font-size:10px;color:var(--muted);font-weight:600">Initial Investment</span><span style="font-family:var(--mono);font-size:12px;font-weight:600">${fCr(c.amount)}</span></div>`:''}
      <div style="display:flex;justify-content:space-between;padding:8px 10px;background:var(--orangeBg);border-radius:var(--r);margin-bottom:8px"><span style="font-size:10px;color:var(--orange);font-weight:600">Current Holdings Value</span><span style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--orange)">${fCr(holdVal)}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <span class="badge bo">${myH.length} stocks</span>
        <span class="badge bb">${txns.filter(t=>t.clientId===c.id).length} txns</span>
        <span class="badge" style="background:${staleColor}22;color:${staleColor}">📄 ${staleText}</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:8px">PMS: ${pmsName}</div>
    </div>`;
  }).join('');
}

function renderHoldings(){
  const cf=document.getElementById('holdClientFilter')?.value||'all';
  const pf=document.getElementById('holdPmsFilter')?.value||'all';
  const searchTerm=(document.getElementById('holdSearchInput')?.value||'').trim().toLowerCase();
  let h=[...holdings];
  if(cf!=='all')h=h.filter(x=>x.clientId===cf);
  if(pf!=='all')h=h.filter(x=>x.pmsId===pf);
  if(searchTerm)h=h.filter(x=>(x.stock||'').toLowerCase().includes(searchTerm));
  const tbody=document.getElementById('holdingsTbody');
  const empty=document.getElementById('holdingsEmpty');
  if(!h.length){
    tbody.innerHTML='';
    empty.style.display='block';
    empty.textContent=searchTerm?`No holdings match "${searchTerm}".`:'No holdings yet. Upload a factsheet in the Upload Center.';
    return;
  }
  empty.style.display='none';

  // Defensive display-only clip — a stock name this long always means bad
  // import data (e.g. an entire document glued into one field), never a
  // real security name. Full text still available on hover via title=.
  const clipName = s => (s && s.length>60) ? s.slice(0,60)+'…' : s;
  const isSuspicious = x => isCorruptedHolding(x);

  tbody.innerHTML=h.map(x=>{
    const nseSym=resolveNSE(x.stock);
    const cmp=prices[nseSym]||prices[x.stock]||0;
    const chg=prices[nseSym+'_chg']||null;
    const liveVal=cmp>0?(x.qty?x.qty*cmp:x.mktValue):x.mktValue;
    const suspicious = isSuspicious(x);
    return `<tr${suspicious?' style="background:rgba(239,68,68,0.06)"':''}>
      <td style="font-size:11px">${getClientName(x.clientId)}</td>
      <td style="font-size:10px;color:var(--muted)">${getPmsName(x.pmsId)}</td>
      <td style="max-width:260px" title="${suspicious ? 'This looks like a mangled name from a bad import — the ✎ Edit button lets you fix the name without losing the market value/weight below.' : ''}">
        <b style="${suspicious?'color:var(--red)':''}">${clipName(x.stock)}</b>${suspicious?' <span class="badge br" style="font-size:8px">⚠ bad data</span>':''}<br>
        <span style="font-size:9px;color:var(--muted);font-family:var(--mono)">${suspicious?'—':nseSym}</span>
      </td>
      <td><span class="badge bb">${x.sector||'—'}</span></td>
      <td class="num"><b>${fCr(liveVal||x.mktValue)}</b></td>
      <td class="num">
        ${x.weight ? `<div style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
          <span>${x.weight.toFixed(2)}%</span>
          <div style="width:36px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
            <div style="width:${Math.min(x.weight,100)}%;height:100%;background:var(--orange)"></div>
          </div>
        </div>` : '—'}
      </td>
      <td class="num" style="font-weight:600">${cmp>0?fINR(cmp):'—'}</td>
      <td class="num">${chg!==null?`<span class="${chg>=0?'tg':'tr'}">${fPct(chg)}</span>`:'—'}</td>
      <td style="text-align:center;white-space:nowrap">
        <button class="btn btn-s btn-sm" style="padding:2px 8px;font-size:10px" onclick="editHolding('${x.id}')" title="Fix the name/sector without losing this position">✎</button>
        <button class="btn btn-d btn-sm" style="padding:2px 8px;font-size:10px" onclick="deleteHolding('${x.id}')" title="Delete this holding">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function deleteHolding(id){
  const h = holdings.find(x=>x.id===id);
  if(!h) return;
  if(!confirm(`Remove "${(h.stock||'').slice(0,60)}" from ${getClientName(h.clientId)}'s holdings?`)) return;
  holdings = holdings.filter(x=>x.id!==id);
  sv(K.H,holdings);
  renderAll();
  toast('Holding removed ✓');
}

function bulkDeleteBadHoldings(){
  const bad = holdings.filter(h=>isCorruptedHolding(h));
  if(!bad.length){ toast('No bad-data holdings found ✓'); return; }
  const byClient = {};
  bad.forEach(h=>{ const n=getClientName(h.clientId); byClient[n]=(byClient[n]||0)+1; });
  const breakdown = Object.entries(byClient).map(([n,c])=>`${n}: ${c}`).join(', ');
  if(!confirm(`Remove all ${bad.length} corrupted holdings? (${breakdown})\n\nThis only removes rows already flagged "⚠ bad data" — real holdings are untouched. You'll need to re-upload correct data for these positions afterward.`)) return;
  holdings = holdings.filter(h=>!isCorruptedHolding(h));
  sv(K.H,holdings);
  renderAll();
  toast(`${bad.length} corrupted holdings removed ✓`);
}

function editHolding(id){
  const h = holdings.find(x=>x.id===id);
  if(!h) return;
  const newStock = prompt('Correct stock name (the market value and weight below are kept as-is — only the name/sector changes):', h.stock||'');
  if(newStock===null) return; // cancelled
  if(!newStock.trim()){ toast('Stock name cannot be empty','r'); return; }
  const newSector = prompt('Sector for this stock:', h.sector||'');
  h.stock = newStock.trim();
  if(newSector!==null) h.sector = newSector.trim() || h.sector;
  sv(K.H,holdings);
  renderAll();
  toast('Holding corrected ✓ — market value and weight unchanged');
}

// -- Orphaned holdings (clientId with no matching client record) --
function findOrphanClientIds(){
  const validIds=new Set(clients.map(c=>c.id));
  const orphanMap={};
  holdings.forEach(h=>{
    if(!validIds.has(h.clientId)){
      if(!orphanMap[h.clientId])orphanMap[h.clientId]=[];
      orphanMap[h.clientId].push(h);
    }
  });
  return orphanMap;
}

function updateOrphanWarning(){
  const btn=document.getElementById('btnFixOrphans');
  if(!btn)return;
  const orphanCount=Object.keys(findOrphanClientIds()).length;
  btn.style.display=orphanCount>0?'inline-block':'none';
  if(orphanCount>0)btn.textContent=`⚠️ Needs Manual Review (${orphanCount})`;
}

// Guess which real client an orphaned ID used to belong to, using the
// upload history log (which freezes the client's name at upload time,
// even after the client record itself is gone).
function guessClientForOrphan(orphanId){
  const relatedUploads=uploads.filter(u=>u.clientId===orphanId&&u.client);
  if(!relatedUploads.length)return null;
  const frozenName=relatedUploads[relatedUploads.length-1].client.trim().toLowerCase();
  const matches=clients.filter(c=>c.name.trim().toLowerCase()===frozenName);
  return matches.length===1?matches[0].id:null; // only auto-trust an unambiguous exact match
}

// Runs automatically on every render (including right after every upload).
// Silently reassigns any orphaned holdings/txns where the upload history
// gives an unambiguous match — no button, no confirmation needed.
// Anything it can't confidently resolve is left for the manual review panel.
let _lastAutoFixToast=0;
function autoFixOrphansSilently(){
  const orphanMap=findOrphanClientIds();
  const ids=Object.keys(orphanMap);
  if(!ids.length)return;
  let fixed=0;
  ids.forEach(orphanId=>{
    const guess=guessClientForOrphan(orphanId);
    if(guess){
      holdings.forEach(h=>{if(h.clientId===orphanId)h.clientId=guess});
      txns.forEach(t=>{if(t.clientId===orphanId)t.clientId=guess});
      fixed++;
    }
  });
  if(fixed){
    sv(K.H,holdings);
    sv(K.T,txns);
    // Avoid spamming a toast on every single re-render — only announce once per batch
    if(Date.now()-_lastAutoFixToast>3000){
      toast(`Auto-reconnected ${fixed} unlinked holding group(s) ✓`);
      _lastAutoFixToast=Date.now();
    }
  }
}

function openFixOrphansModal(){
  renderOrphanList();
  openMo('fixOrphansMo');
}

function renderOrphanList(){
  const orphanMap=findOrphanClientIds(); // only genuinely unresolved ones remain by this point
  const ids=Object.keys(orphanMap);
  const box=document.getElementById('orphanList');
  if(!ids.length){box.innerHTML='<p style="font-size:12px;color:var(--green)">✓ No unlinked holdings found.</p>';return}
  const clientOpts=[...clients].sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  box.innerHTML=`<p style="font-size:11px;color:var(--muted);margin-bottom:10px">These couldn't be auto-matched (no upload history, or the name matches more than one client) — pick the right client for each.</p>`+ids.map(orphanId=>{
    const rows=orphanMap[orphanId];
    const stockNames=rows.slice(0,5).map(r=>r.stock).join(', ')+(rows.length>5?`, +${rows.length-5} more`:'');
    return `<div class="card card-sm" style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Unknown ID: <span style="font-family:var(--mono)">${orphanId}</span> — ${rows.length} holdings</div>
      <div style="font-size:11px;margin-bottom:8px">${stockNames}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="fc" id="orphanFix-${orphanId}"><option value="">Assign to client...</option>${clientOpts}</select>
        <button class="btn btn-o btn-sm" onclick="reassignOrphan('${orphanId}')">Reassign</button>
      </div>
    </div>`;
  }).join('');
}

function reassignOrphan(orphanId){
  const sel=document.getElementById('orphanFix-'+orphanId);
  const newClientId=sel.value;
  if(!newClientId){toast('Select a client first','r');return}
  const newClientName=getClientName(newClientId);
  holdings.forEach(h=>{if(h.clientId===orphanId)h.clientId=newClientId});
  txns.forEach(t=>{if(t.clientId===orphanId)t.clientId=newClientId});
  sv(K.H,holdings);
  sv(K.T,txns);
  renderOrphanList();
  renderAll();
  toast(`Holdings reassigned to ${newClientName} ✓`);
}

function renderTxns(){
  const cf=document.getElementById('txnClientFilter')?.value||'all';
  const tf=document.getElementById('txnTypeFilter')?.value||'all';
  let t=[...txns];
  if(cf!=='all')t=t.filter(x=>x.clientId===cf);
  if(tf!=='all')t=t.filter(x=>x.type===tf);
  // Sort by date descending (most recent first)
  t.sort((a,b)=>{
    const da=parseTxnDate(a.date),db=parseTxnDate(b.date);
    if(da&&db)return db-da;
    return (b.date||'').localeCompare(a.date||'');
  });
  const tbody=document.getElementById('txnsTbody');
  const empty=document.getElementById('txnsEmpty');
  if(!t.length){tbody.innerHTML='';empty.style.display='block';return}
  empty.style.display='none';
  // Group by date for section headers
  let lastDate='';
  let rows='';
  t.forEach(x=>{
    const dateKey=x.date||'';
    if(dateKey!==lastDate){
      lastDate=dateKey;
    }
    const isBuy=x.type==='BUY';
    const effAmount=x.amount&&x.amount>0?x.amount:(x.qty&&x.price?(x.qty*x.price):0);
    const settleDate=x.settlementDate||x.date||'';
    const exchg=x.exchange||x.exchg||'NSE';
    const brkg=x.brokerage!=null?fINR(x.brokerage):'—';
    const stt=x.stt!=null?fINR(x.stt):'—';
    rows+=`<tr style="background:${isBuy?'rgba(34,197,94,0.04)':'rgba(239,68,68,0.04)'}">
      <td style="font-weight:600;color:${isBuy?'var(--green)':'var(--red)'};white-space:nowrap">${isBuy?'Buy':'Sell'}</td>
      <td style="font-family:var(--mono);font-size:11px;white-space:nowrap">${x.date||'—'}</td>
      <td style="font-family:var(--mono);font-size:11px;white-space:nowrap;color:var(--muted)">${settleDate||'—'}</td>
      <td style="font-weight:500;max-width:260px">${x.stock||'—'}</td>
      <td style="font-size:11px;color:var(--dim)">${getClientName(x.clientId)}</td>
      <td style="font-size:11px;color:var(--muted)">${exchg}</td>
      <td class="num">${x.qty?Number(x.qty).toLocaleString('en-IN',{maximumFractionDigits:3}):'—'}</td>
      <td class="num">${x.price&&x.price>0?fINR(x.price):'—'}</td>
      <td class="num" style="color:var(--muted)">${brkg}</td>
      <td class="num" style="color:var(--muted)">${stt}</td>
      <td class="num" style="font-weight:600">${effAmount>0?fINR(effAmount):'—'}</td>
    </tr>`;
  });
  tbody.innerHTML=rows;
}

function parseTxnDate(s){
  if(!s)return null;
  // DD/MM/YYYY
  const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  // YYYY-MM-DD
  const m2=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m2)return new Date(s);
  return null;
}

// renderCompare defined below (overridden version used)

// ============================================
// PMS DATA SYNC — reads from Supabase pms_list
// ------------------------------------------------
// Previously this called a local proxy at localhost:8420, which only
// worked on whichever computer had apmi_proxy.py running. That's been
// replaced by a GitHub Actions workflow (apmi_sync.py) that scrapes
// APMI on a daily schedule and writes straight into Supabase's
// `pms_list` table. This function just reads that table — so it works
// identically for every employee, on any computer, with nothing extra
// running locally.
// ============================================

function updateApmiSyncLabel(){
  const t=localStorage.getItem('i72_apmi_sync');
  const el=document.getElementById('apmiSyncStatus');
  if(!el)return;
  el.textContent=t?('APMI synced: '+new Date(t).toLocaleString('en-IN')):'APMI: not synced yet';
}

async function syncPmsFromSupabase(opts={}){
  const {silent=false}=opts;
  const btn=document.getElementById('apmiRefreshBtn');
  const orig=btn?btn.textContent:null;
  if(btn){btn.disabled=true;btn.textContent='⏳ Refreshing…';}
  try{
    if(typeof sb==='undefined')throw new Error('Supabase client not loaded');
    const rows=await sb.from('pms_list').select('*');
    let updated=0,unmatched=0;
    (rows||[]).forEach(r=>{
      const p=pmsList.find(x=>x.id===r.id);
      if(!p){unmatched++;return;}
      if(r.aum!=null)p.aum=r.aum;
      if(r.r1m!=null)p.r1m=r.r1m;
      if(r.r3m!=null)p.r3m=r.r3m;
      if(r.r6m!=null)p.r6m=r.r6m;
      if(r.r1y!=null)p.r1y=r.r1y;
      if(r.r3y!=null)p.r3y=r.r3y;
      if(r.r4y!=null)p.r4y=r.r4y;
      if(r.r5y!=null)p.r5y=r.r5y;
      if(r.rsi!=null)p.rsi=r.rsi;
      p.updatedAt=r.updated_at||new Date().toISOString();
      updated++;
    });
    sv(K.PMS,pmsList);
    localStorage.setItem('i72_apmi_sync', new Date().toISOString());
    updateApmiSyncLabel();
    if(typeof renderAll==='function')renderAll();
    if(!silent) toast(updated+' PMS updated from Supabase'+(unmatched?(', '+unmatched+' unmatched'):'')+' ✓');
    return {updated,unmatched};
  }catch(e){
    if(!silent) toast('Could not load PMS data from Supabase — '+e.message);
    console.error('syncPmsFromSupabase failed:', e);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=orig;}
  }
}

// Kept under its original name since this is what the existing
// "🔄 Refresh from APMI" button already calls — now it re-reads
// Supabase (kept fresh by GitHub Actions) instead of hitting a local
// proxy, so the button works for every employee, everywhere.
async function refreshFromAPMI(){
  await syncPmsFromSupabase({ silent:false });
}

function editPMS(id){
  const p=pmsList.find(x=>x.id===id);if(!p)return;
  document.getElementById('pms-name').value=p.name||'';
  document.getElementById('pms-strategy').value=p.strategy||'';
  document.getElementById('pms-aum').value=p.aum||'';
  document.getElementById('pms-bench').value=p.bench||'S&P BSE 500 TRI';
  document.getElementById('pms-1m').value=p.r1m||'';
  document.getElementById('pms-1y').value=p.r1y||'';
  document.getElementById('pms-3y').value=p.r3y||'';
  document.getElementById('pms-4y').value=p.r4y||'';
  document.getElementById('pms-5y').value=p.r5y||'';
  document.getElementById('pms-si').value=p.rsi||'';
  // Delete old and open modal to re-add with updates
  pmsList=pmsList.filter(x=>x.id!==id);
  sv(K.PMS,pmsList);
  openMo('addPMSMo');
}

function renderUploadHistory(){
  const box=document.getElementById('uploadHistory');
  if(!uploads.length){box.innerHTML='<span style="color:var(--muted)">No uploads yet.</span>';return}
  box.innerHTML=uploads.slice().reverse().map((u,ri)=>{
    const realIdx=uploads.length-1-ri;
    const isHoldings=u.type==='holdings';
    const dataLabel=isHoldings?`${u.count} holdings`:`${u.count} transactions`;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="display:flex;flex-direction:column;gap:3px">
        <span><span class="badge ${isHoldings?'bo':'bb'}">${u.type}</span> <b>${u.client}</b> · ${u.pms||''}</span>
        <span style="font-size:10px;color:var(--muted)">${dataLabel} · ${new Date(u.date).toLocaleString('en-IN')}</span>
      </div>
      <button class="btn btn-d btn-sm" title="Delete this upload and all its ${dataLabel}" onclick="deleteUpload(${realIdx})">🗑 Delete & Remove Data</button>
    </div>`;
  }).join('');
}

function deleteUpload(idx){
  const u=uploads[idx];
  if(!u)return;
  const isHoldings=u.type==='holdings';
  const dataLabel=isHoldings?`${u.count} holdings`:`${u.count} transactions`;
  if(!confirm(`Delete this upload and permanently remove all ${dataLabel} it created for ${u.client}?\n\nThis cannot be undone.`))return;

  if(u.importedIds&&u.importedIds.length){
    // New-style upload: remove only the exact records created by this upload
    const idSet=new Set(u.importedIds);
    if(isHoldings){
      holdings=holdings.filter(h=>!idSet.has(h.id));
      sv(K.H,holdings);
    } else {
      txns=txns.filter(t=>!idSet.has(t.id));
      sv(K.T,txns);
    }
  } else {
    // Legacy upload (no importedIds stored): fall back to removing by client+pms match
    // Warn the user this is a broader deletion
    if(isHoldings){
      holdings=holdings.filter(h=>!(h.clientId===u.clientId&&h.pmsId===u.pmsId));
      sv(K.H,holdings);
    } else {
      if(!confirm(`This is an older upload record without individual row tracking.\nThis will remove ALL transactions for ${u.client} / ${u.pms||'this PMS'}.\n\nContinue?`))return;
      txns=txns.filter(t=>!(t.clientId===u.clientId&&t.pmsId===u.pmsId));
      sv(K.T,txns);
    }
  }

  uploads.splice(idx,1);
  sv(K.UP,uploads);

  // Safety sweep: if NO upload history remains for this exact client+PMS+type,
  // make sure no stray holdings/txns for that combo linger either (e.g. from
  // an older import, or a manual reassignment, that wasn't tracked in this
  // upload's importedIds). Keeps "no uploads" and "no data shown" in sync.
  const stillHasUploads=uploads.some(x=>x.type===u.type&&x.clientId===u.clientId&&x.pmsId===u.pmsId);
  if(!stillHasUploads){
    if(isHoldings){
      const before=holdings.length;
      holdings=holdings.filter(h=>!(h.clientId===u.clientId&&h.pmsId===u.pmsId));
      if(holdings.length!==before)sv(K.H,holdings);
    }else{
      const before=txns.length;
      txns=txns.filter(t=>!(t.clientId===u.clientId&&t.pmsId===u.pmsId));
      if(txns.length!==before)sv(K.T,txns);
    }
  }

  renderAll();
  toast(`Upload deleted — ${dataLabel} removed`);
}

// == SECTOR CHART ==
let sectorChartInstance=null;
function renderSectorChart(filteredH){
  const h=(filteredH||holdings).filter(x=>!isCorruptedHolding(x));
  const pmsIdsInView=[...new Set(h.map(x=>x.pmsId))];
  const sectorTotalsRaw={};
  pmsIdsInView.forEach(pmsId=>{
    const pmsHold=h.filter(x=>x.pmsId===pmsId);
    const pmsVal=pmsHold.reduce((s,x)=>s+(x.mktValue||0),0);
    const snap=pmsSectorAlloc[pmsId];
    if(snap&&snap.bySector&&pmsVal>0){
      // This PMS has its own authoritative Sector Allocation from its
      // factsheet — apply those percentages to its real market value here,
      // rather than aggregating individual (possibly imperfectly-labeled)
      // holdings for this provider.
      Object.entries(snap.bySector).forEach(([sec,pct])=>{
        sectorTotalsRaw[sec]=(sectorTotalsRaw[sec]||0)+(pct/100*pmsVal);
      });
    } else {
      pmsHold.forEach(x=>{
        const s=x.sector||'Other';
        sectorTotalsRaw[s]=(sectorTotalsRaw[s]||0)+(x.mktValue||0);
      });
    }
  });
  const sectorTotals=mergeSimilarSectors(sectorTotalsRaw);
  let grandTotal=0;
  Object.values(sectorTotals).forEach(v=>grandTotal+=v);
  let sortedSectors=Object.keys(sectorTotals).sort((a,b)=>sectorTotals[b]-sectorTotals[a]);

  // Cap the legend to the top 6 real sectors + a combined "Others" bucket —
  // a long tail of tiny slices is unreadable and not actually more accurate,
  // just more cluttered.
  let labels, data;
  if(sortedSectors.length>7){
    const top=sortedSectors.slice(0,6);
    const otherTotal=sortedSectors.slice(6).reduce((s,k)=>s+sectorTotals[k],0);
    labels=[...top,'Others'];
    data=[...top.map(l=>sectorTotals[l]),otherTotal];
  } else {
    labels=sortedSectors;
    data=labels.map(l=>sectorTotals[l]);
  }

  const colors=['#E8731A','#3B82F6','#22C55E','#EF4444','#8B5CF6','#F59E0B','#666'];
  const ctx=document.getElementById('sectorChart');
  if(sectorChartInstance)sectorChartInstance.destroy();
  if(!labels.length)return;
  const pctLabels=labels.map((l,i)=>`${l} (${grandTotal>0?(data[i]/grandTotal*100).toFixed(1):'0'}%)`);
  sectorChartInstance=new Chart(ctx,{type:'doughnut',data:{labels:pctLabels,datasets:[{data,backgroundColor:colors.slice(0,labels.length),borderWidth:0}]},options:{responsive:true,plugins:{legend:{position:'right',labels:{color:'#A0A0A0',font:{size:10}}}}}});
}

// ==============================================================
// CLIENT-WISE SECTOR ALLOCATION (accordion) — real per-client data only
// ==============================================================
function renderClientSectorAccordion(pmsFilter){
  const el=document.getElementById('clientSectorAccordion');
  if(!el) return;
  let clientList = pmsFilter==='all' ? clients : clients.filter(c=>c.pmsId===pmsFilter);

  if(!clientList.length){
    el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:12px">No clients to show yet.</div>';
    return;
  }

  el.innerHTML = clientList.map(c=>{
    const cHoldings = holdings.filter(h=>h.clientId===c.id && !isCorruptedHolding(h));
    const total = cHoldings.reduce((s,h)=>s+(h.mktValue||0),0);
    const bySectorRaw = {};
    const pmsIdsForClient=[...new Set(cHoldings.map(h=>h.pmsId))];
    pmsIdsForClient.forEach(pmsId=>{
      const pHold=cHoldings.filter(h=>h.pmsId===pmsId);
      const pVal=pHold.reduce((s,h)=>s+(h.mktValue||0),0);
      const snap=pmsSectorAlloc[pmsId];
      if(snap&&snap.bySector&&pVal>0){
        Object.entries(snap.bySector).forEach(([sec,pct])=>{
          bySectorRaw[sec]=(bySectorRaw[sec]||0)+(pct/100*pVal);
        });
      } else {
        pHold.forEach(h=>{
          const s=h.sector||'Other';
          bySectorRaw[s]=(bySectorRaw[s]||0)+(h.mktValue||0);
        });
      }
    });
    const bySector = mergeSimilarSectors(bySectorRaw);
    const rows = Object.keys(bySector).sort((a,b)=>bySector[b]-bySector[a]);
    const bodyHtml = rows.length ? rows.map(s=>{
      const v=bySector[s];
      const pct = total>0 ? (v/total*100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0">
        <div style="width:130px;font-size:11px;color:var(--dim)">${s}</div>
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="width:${Math.min(pct,100)}%;height:100%;background:var(--orange)"></div>
        </div>
        <div style="width:100px;text-align:right;font-size:11px;font-family:var(--mono)">${pct.toFixed(1)}% · ${fCr(v)}</div>
      </div>`;
    }).join('') : '<div style="color:var(--muted);font-size:11px;padding:8px 0">No holdings on file for this client yet.</div>';

    return `<div class="card-sm" style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:8px;overflow:hidden">
      <div style="padding:12px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center"
           onclick="const b=this.nextElementSibling;const open=b.style.display==='block';b.style.display=open?'none':'block';this.querySelector('.acc-arrow').textContent=open?'▸':'▾'">
        <div style="font-weight:600;font-size:12px">${c.name} <span style="color:var(--muted);font-weight:400;font-size:10px">— ${getPmsName(c.pmsId)}</span></div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-family:var(--mono);font-size:11px;color:var(--dim)">${fCr(total)}</span>
          <span class="acc-arrow" style="color:var(--orange)">▸</span>
        </div>
      </div>
      <div style="display:none;padding:4px 14px 14px;border-top:1px solid var(--border)">${bodyHtml}</div>
    </div>`;
  }).join('');
}

// ==============================================================
// TOP MOVERS — only ever built from holdings with real live price
// data already fetched. If nothing has been fetched, says so plainly
// rather than showing zeros or estimates.
// ==============================================================
function renderTopMovers(h){
  const el=document.getElementById('topMoversBox');
  if(!el) return;

  const withChg = h.map(x=>{
    const nseSym=resolveNSE(x.stock);
    const chg = prices[nseSym+'_chg'];
    return (chg!==undefined && chg!==null) ? {stock:x.stock, chg:parseFloat(chg)} : null;
  }).filter(Boolean);

  if(!withChg.length){
    el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:12px">No live price data yet — click "⚡ Fetch Live Prices" in the Holdings tab to see today\'s movers.</div>';
    return;
  }

  const sorted=[...withChg].sort((a,b)=>b.chg-a.chg);
  const gainers=sorted.slice(0,5);
  const losers=sorted.slice(-5).reverse();

  const rowHtml = r => `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px">
    <span>${r.stock}</span>
    <span class="${r.chg>=0?'tg':'tr'}" style="font-family:var(--mono);font-weight:600">${r.chg>=0?'+':''}${r.chg.toFixed(2)}%</span>
  </div>`;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <div style="font-size:10px;color:var(--green);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px">Top Gainers</div>
        ${gainers.map(rowHtml).join('')}
      </div>
      <div>
        <div style="font-size:10px;color:var(--red);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px">Top Losers</div>
        ${losers.map(rowHtml).join('')}
      </div>
    </div>`;
}

// ==============================================================
// PMS-WISE AUM COMPARISON — sum of YOUR CLIENTS' actual holdings
// value per PMS provider. NOT the provider's own total industry AUM
// (that's a different figure, shown separately in PMS Compare) — this
// is specifically how much of your own book sits with each provider.
// ==============================================================
let pmsAumChartInstance=null;
function renderPmsAumComparison(){
  const ctx=document.getElementById('pmsAumChart');
  if(!ctx) return;
  const clean = holdings.filter(h=>!isCorruptedHolding(h));

  const byPms={};
  clean.forEach(h=>{ byPms[h.pmsId]=(byPms[h.pmsId]||0)+(h.mktValue||0); });
  const pmsIds=Object.keys(byPms).sort((a,b)=>byPms[b]-byPms[a]);

  if(pmsAumChartInstance) pmsAumChartInstance.destroy();
  if(!pmsIds.length){
    const wrap=ctx.parentElement;
    let msg=wrap.querySelector('.pms-aum-empty');
    if(!msg){
      msg=document.createElement('div');
      msg.className='pms-aum-empty';
      msg.style.cssText='color:var(--muted);font-size:12px;padding:12px';
      wrap.appendChild(msg);
    }
    msg.textContent='No holdings data yet — upload client holdings to see AUM by provider.';
    ctx.style.display='none';
    return;
  }
  ctx.style.display='block';
  const existingMsg=ctx.parentElement.querySelector('.pms-aum-empty');
  if(existingMsg) existingMsg.remove();
  const labels=pmsIds.map(id=>getPmsName(id)||id);
  const data=pmsIds.map(id=>byPms[id]/10000000); // Cr

  pmsAumChartInstance=new Chart(ctx,{
    type:'bar',
    data:{labels,datasets:[{label:'Your AUM (Cr)',data,backgroundColor:'#E8731A',borderRadius:4}]},
    options:{
      indexAxis:'y',
      responsive:true,
      scales:{
        x:{ticks:{color:'#666',callback:v=>v.toFixed(1)+'Cr'},grid:{color:'#222'}},
        y:{ticks:{color:'#A0A0A0',font:{size:10}},grid:{display:false}}
      },
      plugins:{legend:{display:false}}
    }
  });
}

// Some PDFs render a company-suffix word run straight into the next word
// with no space at all (a quirk of how the source PDF was generated). This
// trims exactly that stray fragment when it sits right after a proper
// corporate suffix — never touches a genuine company name.
const STRAY_SECTOR_WORD_RE=/^(Health|Real|Information|Consumer|Communication|Communications|Financial|Financials|Industrial|Industrials|Material|Materials|Energy|Utilities|Discretionary|Staples|Diversified|Services|Equity|Not)$/i;
function stripStraySectorFragment(name){
  const words=(name||'').split(/\s+/).filter(Boolean);
  if(words.length<2)return name;
  const last=words[words.length-1];
  const withoutLast=words.slice(0,-1).join(' ');
  if(STRAY_SECTOR_WORD_RE.test(last)&&/(LTD\.?|LIMITED|BANK|CORP\.?|CORPORATION|INC\.?|PLC|LLP|CO\.?)$/i.test(withoutLast)){
    return withoutLast;
  }
  return name;
}

function parseHoldingsRowsText(text){
  if(!text)return[];
  text=text.replace(/\b(LTD|LIMITED|LLP|PLC|INC|CORP|CORPORATION)([A-Z][a-z])/g,'$1 $2');
  let rawLines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  rawLines=rawLines.filter(l=>!/^Portfolio Holdings$/i.test(l)&&!/^Sr\.?\s*Security\s*Sector/i.test(l));

  const rowEndPattern=/[\d,]+(?:\.\d+)?\s+\d+(?:\.\d+)?%?\s*$/;
  const lines=[];
  let buffer='';
  rawLines.forEach(line=>{
    buffer=buffer?buffer+' '+line:line;
    if(rowEndPattern.test(buffer)){
      lines.push(buffer);
      buffer='';
    }
  });
  if(buffer)lines.push(buffer);

  const parsed=[];
  const KNOWN_SECTORS='Financials|Information Technology|Industrials|Consumer Discretionary|Communication Services|Health Care|Consumer Staples|Materials|Not classified|Energy|Utilities|Real Estate|Other|Equity';
  lines.forEach(line=>{
    if(/^Total\b/i.test(line))return;
    if(/^\d*\s*Cash\b/i.test(line))return;
    if(/Dividend\s*\/\s*Interest/i.test(line))return;

    const sectorPattern=new RegExp('^\\d*\\s*(.+?)\\s*(?:'+KNOWN_SECTORS+')\\s+([\\d,]+(?:\\.\\d+)?)\\s+(\\d+\\.\\d+)%?','i');
    const sectorMatch=line.match(new RegExp('('+KNOWN_SECTORS+')','i'));
    const m=line.match(sectorPattern);
    if(m){
      parsed.push({
        stock:stripStraySectorFragment(normalizeSpaces(m[1])),
        sector:sectorMatch?sectorMatch[1].trim():'Other',
        mktValue:parseFloat(m[2].replace(/,/g,'')),
        weight:parseFloat(m[3])
      });
      return;
    }

    // No recognized sector text — everything between the serial number and
    // the trailing value+weight% is the stock name, full stop. Anchoring on
    // a company-suffix word (older approach) misfired on names that merely
    // CONTAIN a suffix-like word without ending on it (e.g. "STATE BANK OF
    // INDIA" getting cut to "STATE BANK"). Since per-stock sector isn't the
    // primary source for sector charts anymore (the PMS's own Sector
    // Allocation table is — see pmsSectorAlloc below), there's no upside to
    // that guesswork and real downside, so this keeps the full name intact.
    const wholeNamePattern=/^\d*\s*(.+?)\s+([\d,]+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%?\s*$/;
    const mWhole=line.match(wholeNamePattern);
    if(mWhole&&mWhole[1].length>2&&!mWhole[1].match(/^(Total|Sr\.?|Security|Cash|Dividend)/i)){
      parsed.push({
        stock:stripStraySectorFragment(normalizeSpaces(mWhole[1])),
        sector:'Unclassified',
        mktValue:parseFloat(mWhole[2].replace(/,/g,'')),
        weight:parseFloat(mWhole[3])
      });
    }
  });
  return parsed;
}

function parseHoldingsPaste(){
  const text=document.getElementById('pasteHoldings').innerText.trim();
  if(!text){toast('Paste holdings data first','r');return}
  const parsed=parseHoldingsRowsText(text);
  if(!parsed.length){toast('Could not parse holdings. Check format.','r');return}
  // Show preview
  window._pendingHoldings=parsed;
  document.getElementById('holdPreview').style.display='block';
  const selClientName1=getClientName(document.getElementById('upHClient').value)||'(none selected)';
  const selPmsName1=getPmsName(document.getElementById('upHPms').value)||'(none selected)';
  document.getElementById('holdPreviewInfo').innerHTML=`${parsed.length} holdings detected for <b style="color:var(--text)">${selClientName1}</b> — <b style="color:var(--text)">${selPmsName1}</b>. Double-check this is the right client, then click Confirm.`;
  document.getElementById('holdPreviewHead').innerHTML='<tr><th>Stock</th><th>Sector</th><th>Mkt Value</th><th>Weight%</th></tr>';
  document.getElementById('holdPreviewBody').innerHTML=parsed.slice(0,8).map(r=>`<tr><td>${r.stock}</td><td>${r.sector}</td><td class="num">${fINR(r.mktValue)}</td><td class="num">${r.weight}%</td></tr>`).join('');
  toast(`${parsed.length} holdings parsed ✓`);
}

// ══ PDF HOLDINGS + SECTOR ALLOCATION EXTRACTION (geometry-based) ══
// Nothing below is hardcoded to any one PMS's stock list, sector names, or
// column positions. Each table is located purely by its own header text and
// the header's on-page position, then read relative to that anchor.
// Factsheets commonly lay the holdings table out next to a second table
// (e.g. Sector Allocation) at the same page height — a naive top-to-bottom
// text dump interleaves the two; this keeps them apart by only ever
// collecting text at/after each table's own header column.
const PDF_HOLDINGS_HEADER_RE=/^(Security|Stock|Scrip|Company|Instrument)/i;
const PDF_NUM_RE=/^[\d,]+(?:\.\d+)?$/;
const PDF_PCT_RE=/^\(?\d+(?:\.\d+)?\)?%$/;

function pdfOrderTokensForLine(tokens,tol){
  tol=tol||3;
  const sorted=tokens.slice().sort((a,b)=>a.top-b.top);
  const clusters=[];
  let cur=[],curTop=null;
  sorted.forEach(t=>{
    if(curTop===null||Math.abs(t.top-curTop)<=tol){
      cur.push(t);
      if(curTop===null)curTop=t.top;
    }else{
      clusters.push(cur);cur=[t];curTop=t.top;
    }
  });
  if(cur.length)clusters.push(cur);
  const out=[];
  clusters.forEach(c=>{c.sort((a,b)=>a.x-b.x);out.push(...c)});
  return out;
}

function pdfSplitItemsIntoWords(items){
  const words=[];
  items.forEach(it=>{
    const text=it.text;
    if(!text)return;
    if(!/\s/.test(text)){words.push(it);return;}
    const avgCharW=text.length>0?(it.w||0)/text.length:0;
    const re=/\S+/g;
    let m;
    while((m=re.exec(text))){
      words.push({text:m[0],x:it.x+m.index*avgCharW,top:it.top,w:m[0].length*avgCharW});
    }
  });
  return words;
}

function pdfGroupWordRows(items,tol){
  tol=tol||2.5;
  const sorted=items.slice().sort((a,b)=>a.top-b.top);
  const rows=[];
  let cur=[],curTop=null;
  sorted.forEach(it=>{
    if(curTop===null||Math.abs(it.top-curTop)<=tol){
      cur.push(it);
      if(curTop===null)curTop=it.top;
    }else{
      rows.push(cur);cur=[it];curTop=it.top;
    }
  });
  if(cur.length)rows.push(cur);
  return rows;
}

function pdfFindTableAnchor(rows,headerRe){
  for(const r of rows){
    const rs=r.slice().sort((a,b)=>a.x-b.x);
    for(let i=0;i<rs.length;i++){
      if(headerRe.test(rs[i].text)){
        let leftEdge;
        if(i>0){
          const prev=rs[i-1];
          const gap=rs[i].x-(prev.x+prev.w);
          leftEdge=(gap<60&&/^Sr\.?$/i.test(prev.text))?prev.x:Math.max(0,rs[i].x-25);
        }else{
          leftEdge=Math.max(0,rs[i].x-25);
        }
        const nameColEnd=(i+1<rs.length)?rs[i+1].x:rs[i].x+250;
        return{headerRow:r,leftEdge,nameColEnd};
      }
    }
  }
  return null;
}

function pdfExtractHoldingsLines(items,headerRe,startExpected,fallbackAnchor){
  const rows=pdfGroupWordRows(items);
  let anchor=pdfFindTableAnchor(rows,headerRe);
  let usedFallback=false;
  if(!anchor&&fallbackAnchor&&startExpected>1){
    anchor=fallbackAnchor;
    usedFallback=true;
  }
  if(!anchor)return{lines:[],nextExpected:startExpected,found:false,threshold:null,nameColEnd:null};
  const headerTop=usedFallback?0:Math.min(...anchor.headerRow.map(w=>w.top));
  const threshold=anchor.leftEdge;
  let allTok=items.filter(w=>w.top>=headerTop-1&&w.x>=threshold-3);
  allTok=allTok.filter(w=>!/^Total$/i.test(w.text));
  allTok.sort((a,b)=>a.top-b.top);
  const srColMax=threshold+40;
  let expected=startExpected;
  const markers=[];
  allTok.forEach(w=>{
    if(/^\d+$/.test(w.text)&&w.x>=threshold-2&&w.x<=srColMax){
      if(parseInt(w.text,10)===expected){markers.push(w);expected++;}
    }
  });
  const gaps=[];
  for(let i=1;i<markers.length;i++)gaps.push(markers[i].top-markers[i-1].top);
  gaps.sort((a,b)=>a-b);
  const typicalGap=gaps.length?gaps[Math.floor(gaps.length/2)]:20;
  const lines=[];
  markers.forEach((m,i)=>{
    const top0=i===0?m.top:(markers[i-1].top+m.top)/2;
    const top1=(i+1<markers.length)?(m.top+markers[i+1].top)/2:m.top+typicalGap*2.2;
    const bandTok=allTok.filter(w=>w.top>=top0-0.5&&w.top<top1-0.5);
    const bandSorted=pdfOrderTokensForLine(bandTok);
    let valTok=null,pctTok=null;
    for(let j=0;j<bandSorted.length-1;j++){
      if(!valTok&&PDF_NUM_RE.test(bandSorted[j].text)&&PDF_PCT_RE.test(bandSorted[j+1].text)){
        valTok=bandSorted[j];pctTok=bandSorted[j+1];
      }
    }
    const rest=pdfOrderTokensForLine(bandSorted.filter(w=>w!==valTok&&w!==pctTok&&w!==m&&w.x<anchor.nameColEnd-2));
    const prefix=(m.text+' '+rest.map(w=>w.text).join(' ')).trim();
    lines.push(valTok&&pctTok?`${prefix} ${valTok.text} ${pctTok.text}`:prefix);
  });
  if(!markers.length){
    const simpleRows=pdfGroupWordRows(allTok);
    simpleRows.forEach(r=>{
      const rs=r.slice().sort((a,b)=>a.x-b.x);
      lines.push(rs.map(w=>w.text).join(' '));
    });
  }
  return{lines,nextExpected:expected,found:true,threshold,nameColEnd:anchor.nameColEnd,anchorForNextPage:{headerRow:anchor.headerRow,leftEdge:anchor.leftEdge,nameColEnd:anchor.nameColEnd}};
}

function pdfExtractSectorAllocationLines(items,holdingsThreshold){
  const rows=pdfGroupWordRows(items);
  const SECTOR_COL_RE=/^(Sectors?|Sectoral)$/i;
  const ASSETS_COL_RE=/^(Assets?|Weightage|Weight|NAV)$/i;
  const HEADING_ONLY_RE=/^(Allocation|Wise|Break-?up|Table|Chart|Wise\/?Break-?up)$/i;
  const BIG_NUMBER_RE=/^[\d,]*\d,\d{3}(?:\.\d+)?$/;
  let headerRow=null;
  for(const r of rows){
    const texts=r.map(w=>w.text);
    const hasSector=texts.some(t=>SECTOR_COL_RE.test(t));
    const hasSecurity=texts.some(t=>/^Security$/i.test(t));
    const hasAssets=texts.some(t=>ASSETS_COL_RE.test(t)||t.includes('%'));
    const isHeadingOnly=r.length<=3&&texts.some(t=>HEADING_ONLY_RE.test(t));
    const looksLikeData=r.length>6||texts.some(t=>BIG_NUMBER_RE.test(t));
    if(hasSector&&hasAssets&&!hasSecurity&&!isHeadingOnly&&!looksLikeData){headerRow=r;break;}
  }
  if(!headerRow)return{lines:[],found:false};
  const rs=headerRow.slice().sort((a,b)=>a.x-b.x);
  const secTok=rs.find(w=>SECTOR_COL_RE.test(w.text));
  const secIdx=rs.indexOf(secTok);
  let threshold;
  if(secIdx>0){
    const prev=rs[secIdx-1];
    const gap=secTok.x-(prev.x+prev.w);
    threshold=(gap<60&&/^Sr\.?$/i.test(prev.text))?prev.x:Math.max(0,secTok.x-25);
  }else{
    threshold=Math.max(0,secTok.x-25);
  }
  const later=rs.filter(w=>w.x>secTok.x+1);
  const nameColEnd=later.length?Math.min(...later.map(w=>w.x)):secTok.x+150;
  const headerTop=Math.min(...headerRow.map(w=>w.top));
  const rightBound=(holdingsThreshold!==null&&holdingsThreshold!==undefined&&holdingsThreshold>threshold)?holdingsThreshold-10:threshold+300;
  const allTok=items.filter(w=>w.top>=headerTop-1&&w.x>=threshold-3&&w.x<rightBound&&!/^Total$/i.test(w.text)).sort((a,b)=>a.top-b.top);
  const srColMax=threshold+40;
  const markers=[];let expected=1;
  allTok.forEach(w=>{
    if(/^\d+$/.test(w.text)&&w.x>=threshold-2&&w.x<=srColMax){
      if(parseInt(w.text,10)===expected){markers.push(w);expected++;}
    }
  });
  const lines=[];
  markers.forEach((m,i)=>{
    const top0=i===0?m.top:(markers[i-1].top+m.top)/2;
    const top1=(i+1<markers.length)?(m.top+markers[i+1].top)/2:m.top+15;
    const band=pdfOrderTokensForLine(allTok.filter(w=>w.top>=top0-0.5&&w.top<top1-0.5));
    let pctTok=null;
    band.forEach(w=>{if(PDF_PCT_RE.test(w.text)&&!pctTok)pctTok=w;});
    const rest=pdfOrderTokensForLine(band.filter(w=>w!==pctTok&&w!==m&&w.x<nameColEnd-2));
    const prefix=(m.text+' '+rest.map(w=>w.text).join(' ')).trim();
    lines.push(pctTok?`${prefix} ${pctTok.text}`:prefix);
  });
  if(!lines.length){
    rows.forEach(r=>{
      if(r===headerRow)return;
      const rowTop=Math.min(...r.map(w=>w.top));
      if(rowTop<=headerTop)return;
      const inCol=r.filter(w=>w.x>=threshold-3&&w.x<rightBound&&!/^Total$/i.test(w.text));
      if(!inCol.length)return;
      const ordered=pdfOrderTokensForLine(inCol);
      let pctTok=null;
      ordered.forEach(w=>{if(PDF_PCT_RE.test(w.text)&&!pctTok)pctTok=w});
      if(!pctTok)return;
      const rest=pdfOrderTokensForLine(ordered.filter(w=>w!==pctTok&&w.x<nameColEnd-2));
      if(!rest.length)return;
      lines.push(`${rest.map(w=>w.text).join(' ')} ${pctTok.text}`);
    });
  }
  return{lines,found:true};
}

function pdfFindSectorChartRegion(items,holdingsThreshold,pageWidth,pageHeight){
  const rows=pdfGroupWordRows(items);
  const HEADING_RE=/Sector(?:\s*-?\s*(?:Wise|wise))?\s*(?:Allocation|Split|Composition|Break-?up|Distribution)|Industry\s*-?\s*(?:Wise|wise)?\s*Allocation|Sectoral\s*Allocation/i;
  let headingRow=null;
  for(const r of rows){
    if(r.length>6)continue;
    const joined=pdfOrderTokensForLine(r).map(w=>w.text).join(' ');
    if(HEADING_RE.test(joined)){headingRow=r;break;}
  }
  if(!headingRow)return null;
  const headingTop=Math.min(...headingRow.map(w=>w.top));
  const headingX=Math.min(...headingRow.map(w=>w.x));
  const leftBound=Math.max(0,headingX-40);
  const rightBound=(holdingsThreshold!==null&&holdingsThreshold!==undefined&&holdingsThreshold>headingX+50)
    ?holdingsThreshold-3
    :Math.max(leftBound+150,pageWidth-10);
  const candidates=rows.filter(r=>{
    const rTop=Math.min(...r.map(w=>w.top));
    const rMinX=Math.min(...r.map(w=>w.x));
    const rMaxX=Math.max(...r.map(w=>w.x));
    return r!==headingRow&&rTop>headingTop+15&&rMinX>=leftBound-5&&rMaxX<=rightBound+5&&r.length<=6
      &&!r.some(w=>PDF_PCT_RE.test(w.text)||/^[\d,.]+$/.test(w.text));
  }).sort((a,b)=>Math.min(...a.map(w=>w.top))-Math.min(...b.map(w=>w.top)));
  const defaultBottom=Math.min(headingTop+260,pageHeight-10);
  let bottomBound=candidates.length?Math.min(Math.min(...candidates[0].map(w=>w.top))-3,defaultBottom>headingTop+60?defaultBottom:pageHeight-10):defaultBottom;
  if(bottomBound-headingTop<60)bottomBound=Math.min(headingTop+260,pageHeight-10);
  const top=Math.max(0,headingTop-5);
  return{top,left:leftBound,width:Math.max(20,rightBound-leftBound),height:Math.max(40,bottomBound-top)};
}

async function pdfCaptureSectorAllocationImage(page,region){
  try{
    if(!region||typeof document==='undefined')return null;
    const scale=2;
    const viewport=page.getViewport({scale});
    const full=document.createElement('canvas');
    full.width=viewport.width;full.height=viewport.height;
    const fctx=full.getContext('2d');
    await page.render({canvasContext:fctx,viewport}).promise;
    const ocrUpscale=2;
    const cw=Math.max(10,Math.round(region.width*scale*ocrUpscale));
    const ch=Math.max(10,Math.round(region.height*scale*ocrUpscale));
    const crop=document.createElement('canvas');
    crop.width=cw;crop.height=ch;
    const cctx=crop.getContext('2d');
    if('imageSmoothingEnabled'in cctx){cctx.imageSmoothingEnabled=true;cctx.imageSmoothingQuality='high';}
    cctx.drawImage(full,Math.round(region.left*scale),Math.round(region.top*scale),Math.round(region.width*scale),Math.round(region.height*scale),0,0,cw,ch);
    return crop.toDataURL('image/png');
  }catch(err){
    console.error('Sector allocation chart image capture failed (non-fatal):',err);
    return null;
  }
}

async function pdfOcrSectorChartImage(dataUrl){
  try{
    if(typeof window==='undefined'||!window.Tesseract||!dataUrl)return null;
    const worker=await Tesseract.createWorker('eng');
    try{
      const ret=await worker.recognize(dataUrl);
      return(ret&&ret.data)?ret.data.text:null;
    }finally{
      await worker.terminate();
    }
  }catch(err){
    console.error('OCR sector chart read failed (non-fatal):',err);
    return null;
  }
}

function parseOcrSectorText(text){
  if(!text)return[];
  const cleaned=text.replace(/\r/g,' ').replace(/[|_©®°]/g,' ');
  const pctRe=/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;
  const out=[];
  let lastEnd=0,m;
  while((m=pctRe.exec(cleaned))){
    const pct=parseFloat(m[1].replace(',','.'));
    if(!(pct>0&&pct<=100)){lastEnd=pctRe.lastIndex;continue;}
    const segment=cleaned.slice(lastEnd,m.index);
    const words=segment.split(/\s+/).map(w=>w.trim()).filter(Boolean);
    const nameWords=[];
    for(let i=words.length-1;i>=0&&nameWords.length<6;i--){
      const w=words[i];
      if(/^[-•●■◆*|:;]+$/.test(w))break;
      if(/^\d+$/.test(w)){if(nameWords.length===0)continue;else break;}
      if(!/[A-Za-z]/.test(w)){if(nameWords.length)break;else continue;}
      nameWords.unshift(w);
    }
    let name=normalizeSpaces(nameWords.join(' '));
    name=name.replace(/^Sector(?:\s*-?\s*(?:Wise|wise))?\s*(?:Allocation|Split|Composition|Break-?up|Distribution)\s*/i,'').trim();
    if(name&&name.length>=3&&!/^(Total|Sector|Sectors|Allocation)$/i.test(name)){
      out.push({sector:name,pct});
    }
    lastEnd=pctRe.lastIndex;
  }
  return out;
}

function isPlausibleSectorBreakdown(rows){
  if(!rows||rows.length<2)return false;
  const total=rows.reduce((a,r)=>a+r.pct,0);
  return total>=55&&total<=145;
}

function parseSectorAllocationLines(text){
  const out=[];
  (text||'').split('\n').map(l=>l.trim()).filter(Boolean).forEach(line=>{
    if(/^Total\b/i.test(line))return;
    line=line.replace(/\s*\bTotal\b.*$/i,'').trim();
    const m=line.match(/^\d*\s*(.+?)\s+\(?(\d+(?:\.\d+)?)\)?%\s*$/);
    if(m){
      const name=normalizeSpaces(m[1]);
      if(name&&!/^(Total|Sr\.?|Sector)$/i.test(name)){
        out.push({sector:name,pct:parseFloat(m[2])});
      }
    }
  });
  return out;
}

function pdfExtractScatteredSectorLabels(items,region){
  if(!region)return{lines:[],found:false};
  const inRegion=items.filter(w=>w.top>=region.top&&w.top<region.top+region.height&&w.x>=region.left&&w.x<region.left+region.width);
  if(!inRegion.length)return{lines:[],found:false};
  const rows=pdfGroupWordRows(inRegion);
  const lines=[];
  rows.forEach(r=>{
    const ordered=pdfOrderTokensForLine(r);
    if(ordered.some(w=>/^Total$/i.test(w.text)))return;
    let pctTok=null;
    ordered.forEach(w=>{if(PDF_PCT_RE.test(w.text)&&!pctTok)pctTok=w});
    if(!pctTok)return;
    const nameToks=ordered.filter(w=>w!==pctTok);
    const name=nameToks.map(w=>w.text).join(' ').trim();
    if(!name||!/[A-Za-z]/.test(name))return;
    if(/^Sector(?:s|al)?$/i.test(nameToks[0]&&nameToks[0].text||'')&&/Allocation|Wise|Split|Break-?up|Distribution/i.test(name))return;
    lines.push(`${name} ${pctTok.text}`);
  });
  return{lines,found:lines.length>0};
}

async function extractFromPdf(file){
  if(!window.pdfjsLib)throw new Error('PDF engine did not load — check your internet connection and reload the page');
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let holdingsLines=[],sectorLines=[],nextExpected=1,anyFound=false,anyText=false,sectorImage=null,lastAnchor=null,sectorSource=null;
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const content=await page.getTextContent();
    const viewport=page.getViewport({scale:1});
    const rawItems=content.items.map(it=>({
      text:(it.str||'').trim(),
      x:it.transform[4],
      top:viewport.height-it.transform[5],
      w:it.width||0
    })).filter(it=>it.text);
    const items=pdfSplitItemsIntoWords(rawItems);
    if(items.length)anyText=true;
    const hRes=pdfExtractHoldingsLines(items,PDF_HOLDINGS_HEADER_RE,nextExpected,lastAnchor);
    if(hRes.found){anyFound=true;nextExpected=hRes.nextExpected;holdingsLines=holdingsLines.concat(hRes.lines);if(hRes.anchorForNextPage)lastAnchor=hRes.anchorForNextPage;}
    const sRes=pdfExtractSectorAllocationLines(items,hRes.found?hRes.threshold:null);
    if(sRes.found)sectorLines=sectorLines.concat(sRes.lines);
    if(!sRes.lines.length&&!sectorLines.length&&!sectorImage){
      try{
        const region=pdfFindSectorChartRegion(items,hRes.found?hRes.threshold:null,viewport.width,viewport.height);
        if(region){
          const scatRes=pdfExtractScatteredSectorLabels(items,region);
          if(scatRes.found){
            sectorLines=sectorLines.concat(scatRes.lines);
          }else{
            sectorImage=await pdfCaptureSectorAllocationImage(page,region);
            if(sectorImage){
              const ocrText=await pdfOcrSectorChartImage(sectorImage);
              const ocrRows=parseOcrSectorText(ocrText);
              if(isPlausibleSectorBreakdown(ocrRows)){
                sectorLines=sectorLines.concat(ocrRows.map(r=>`${r.sector} ${r.pct}%`));
                sectorSource='ocr';
              }
            }
          }
        }
      }catch(err){
        console.error('Sector chart region detection failed (non-fatal):',err);
      }
    }
  }
  if(!anyText)throw new Error('No selectable text found in this PDF — it looks like a scanned image, so it can\'t be auto-read. Please type or paste the holdings table instead.');
  if(!anyFound)throw new Error('Could not find a holdings table (looked for a "Security"/"Stock" column header) in this PDF. Try Upload CSV/Excel, or paste the table manually.');
  return{holdingsText:holdingsLines.join('\n'),sectorAllocationText:sectorLines.join('\n'),sectorAllocationImage:sectorImage,sectorSource};
}

async function handleHoldingsPdfUpload(event){
  const file=event.target.files[0];
  if(!file)return;
  toast('Reading PDF… (if its sector chart has no selectable text, this can take a bit longer while it runs OCR on it)');
  try{
    const{holdingsText,sectorAllocationText,sectorAllocationImage,sectorSource}=await extractFromPdf(file);
    document.getElementById('pasteHoldings').innerText=holdingsText;
    const sectorRows=parseSectorAllocationLines(sectorAllocationText);
    window._pendingSectorAllocation=sectorRows;
    window._pendingSectorAllocationSource=sectorSource||null;
    window._pendingSectorAllocationImage=sectorAllocationImage||null;
    parseHoldingsPaste();

    const reviewBox=document.getElementById('sectorReview');
    const reviewImg=document.getElementById('sectorReviewImg');
    const reviewText=document.getElementById('sectorReviewText');
    const reviewInfo=document.getElementById('sectorReviewInfo');
    if(reviewBox){
      if(sectorAllocationImage||sectorRows.length){
        reviewBox.style.display='block';
        if(sectorAllocationImage){reviewImg.src=sectorAllocationImage;reviewImg.style.display='block';}
        else{reviewImg.style.display='none';reviewImg.removeAttribute('src');}
        reviewText.innerText=sectorRows.map(r=>`${r.sector} ${r.pct}%`).join('\n');
        if(sectorSource==='ocr')reviewInfo.textContent='Chart had no selectable text — this was read via OCR and may have errors. Check it against the image above, fix anything wrong below, then click "Use this breakdown".';
        else if(sectorRows.length)reviewInfo.textContent='Sector Allocation found — review below, then click "Use this breakdown" if it looks right (or after fixing it).';
        else reviewInfo.textContent='No sector data could be read automatically. Type it in below using the chart image above as reference, then click "Use this breakdown".';
      }else{
        reviewBox.style.display='none';
      }
    }
    if(sectorRows.length&&sectorSource==='ocr')toast(`Sector chart had no text — read ${sectorRows.length} sector(s) off it via OCR instead. Check it in the Sector Allocation box below before confirming`);
    else if(sectorRows.length)toast(`Also found this PMS's Sector Allocation table (${sectorRows.length} sectors) — review below, will be saved on Confirm Import`);
    else if(window._pendingSectorAllocationImage)toast('No sector data could be read automatically — its chart image is shown below, type the breakdown in there');
  }catch(e){
    console.error('PDF holdings extraction failed:',e);
    toast(e.message||'Could not read this PDF','r');
  }finally{
    event.target.value='';
  }
}

function useSectorBreakdownFromReview(){
  const text=document.getElementById('sectorReviewText')?.innerText||'';
  const rows=parseSectorAllocationLines(text);
  if(!rows.length){toast('No valid "Sector NN%" lines found in that box','r');return}
  window._pendingSectorAllocation=rows;
  toast(`Using ${rows.length} sector row(s) from your review ✓`);
}

// ==============================================================
// AI-BASED SMART EXTRACTION (holdings & transactions)
// ------------------------------------------------
// The regex parsers above need near-perfect, one-row-per-line text —
// which raw PDF extraction often can't guarantee, especially on
// multi-column layouts (a sector-allocation panel next to a holdings
// table, etc.) where content from two visual columns can interleave
// even after row reconstruction. Rather than keep chasing every PMS
// provider's different layout with more brittle heuristics, this
// routes the same raw text through the AI proxy (already verified for
// factsheet analysis) — it can correctly identify which numbers belong
// to which stock name semantically, even from imperfectly-ordered text,
// which generalizes far better across different providers' formats.
// ==============================================================

async function smartExtractHoldingsAI(){
  const text = document.getElementById('pasteHoldings').innerText.trim();
  if(!text){ toast('Paste or upload holdings data first','r'); return; }

  const btn = document.getElementById('btnSmartHoldings');
  const orig = btn ? btn.textContent : null;
  if(btn){ btn.disabled=true; btn.textContent='🤖 Extracting...'; }

  try{
    const prompt = `You are extracting a client's stock holdings table from PMS portfolio statement text. The text below was extracted from a PDF and may have imperfect ordering (e.g. from a multi-column page layout, where a sector-allocation summary and the holdings table interleaved) — use your judgement to correctly identify each real holding (stock name, sector, market value, %Assets) from the "Portfolio Holdings" table specifically, ignoring unrelated numbers from other panels on the page.

TEXT:
${text.slice(0,40000)}

Respond with ONLY a JSON array (no markdown, no explanation), one object per actual stock holding — skip "Cash", "Total", and "Dividend/Interest receivable" rows, those are not stocks:
[{"stock": "", "sector": "", "mktValue": 0, "weight": 0}]

Rules:
- "mktValue" is the rupee market value as a plain number (no commas, no currency symbol).
- "weight" is the %Assets figure as a plain number (e.g. 2.80, not "2.80%").
- Use the EXACT stock names and figures found in the text — never invent or estimate a value.
- If a figure genuinely isn't present for a stock, use null for that field rather than guessing.`;

    const responseText = await callAIProxy(null, prompt, {maxTokens:3000, temperature:0.1});
    const clean = responseText.replace(/^```json?\s*/i,'').replace(/```$/,'').trim();
    const parsed = JSON.parse(clean).filter(r=>r.stock);

    if(!parsed.length){ toast('AI could not find any holdings in this text','r'); return; }

    window._pendingHoldings = parsed;
    document.getElementById('holdPreview').style.display='block';
    const selClientName=getClientName(document.getElementById('upHClient').value)||'(none selected)';
    const selPmsName=getPmsName(document.getElementById('upHPms').value)||'(none selected)';
    document.getElementById('holdPreviewInfo').innerHTML=`🤖 ${parsed.length} holdings extracted by AI for <b style="color:var(--text)">${selClientName}</b> — <b style="color:var(--text)">${selPmsName}</b>. Double-check this is correct, then click Confirm.`;
    document.getElementById('holdPreviewHead').innerHTML='<tr><th>Stock</th><th>Sector</th><th>Mkt Value</th><th>Weight%</th></tr>';
    document.getElementById('holdPreviewBody').innerHTML=parsed.slice(0,8).map(r=>`<tr><td>${r.stock}</td><td>${r.sector||'—'}</td><td class="num">${fINR(r.mktValue||0)}</td><td class="num">${r.weight||0}%</td></tr>`).join('');
    toast(`🤖 ${parsed.length} holdings extracted ✓`);
  }catch(e){
    console.error('Smart holdings extraction failed:', e);
    toast('AI extraction failed — '+e.message, 'r');
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=orig; }
  }
}

async function smartExtractTxnsAI(){
  const text = document.getElementById('pasteTxns').innerText.trim();
  if(!text){ toast('Paste or upload transaction data first','r'); return; }

  const btn = document.getElementById('btnSmartTxns');
  const orig = btn ? btn.textContent : null;
  if(btn){ btn.disabled=true; btn.textContent='🤖 Extracting...'; }

  try{
    const prompt = `You are extracting transaction rows from a PMS transaction statement. The text below was extracted from a PDF table and may have imperfect row ordering — use your judgement to correctly reconstruct each transaction row.

TEXT:
${text.slice(0,40000)}

Respond with ONLY a JSON array (no markdown, no explanation), one object per transaction row (skip summary/total rows):
[{"type": "BUY or SELL", "date": "DD/MM/YYYY", "settlementDate": "DD/MM/YYYY", "stock": "", "exchange": "NSE or BSE", "qty": 0, "price": 0, "brokerage": 0, "stt": 0, "amount": 0}]

Rules:
- "date" is the transaction date; "settlementDate" is the settlement date — use the exact dates found, do not swap them.
- All numeric fields are plain numbers (no commas, no currency symbols, no % signs).
- "amount" is the final settlement amount for that row.
- Use the EXACT stock names and figures found in the text — never invent or estimate a value.
- If a figure genuinely isn't present, use null for that field rather than guessing.`;

    const responseText = await callAIProxy(null, prompt, {maxTokens:3500, temperature:0.1});
    const clean = responseText.replace(/^```json?\s*/i,'').replace(/```$/,'').trim();
    const parsed = JSON.parse(clean).filter(r=>r.stock);

    if(!parsed.length){ toast('AI could not find any transactions in this text','r'); return; }

    window._pendingTxns = parsed;
    document.getElementById('txnPreview').style.display='block';
    document.getElementById('txnPreviewInfo').textContent=`🤖 ${parsed.length} transactions extracted by AI.`;
    document.getElementById('txnPreviewHead').innerHTML='<tr><th>Type</th><th>Date</th><th>Stock</th><th>Qty</th><th>Price</th><th>Amount</th></tr>';
    document.getElementById('txnPreviewBody').innerHTML=parsed.slice(0,8).map(r=>`<tr><td><span class="badge ${(r.type||'').toUpperCase()==='BUY'?'bg':'br'}">${(r.type||'').toUpperCase()}</span></td><td>${r.date||'—'}</td><td>${r.stock}</td><td class="num">${r.qty||0}</td><td class="num">${fINR(r.price||0)}</td><td class="num">${fCr(r.amount||0)}</td></tr>`).join('');
    toast(`🤖 ${parsed.length} transactions extracted ✓`);
  }catch(e){
    console.error('Smart transaction extraction failed:', e);
    toast('AI extraction failed — '+e.message, 'r');
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=orig; }
  }
}

function parseTxnsPaste(){
  const text=document.getElementById('pasteTxns').innerText.trim();
  if(!text){toast('Paste transaction data first','r');return}
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const parsed=[];
  lines.forEach(line=>{
    // Match: Buy/Sell Date Date Stock Exchange Qty Price ... Amount
    const m=line.match(/^(Buy|Sell)\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+(.+?)\s+(?:NSE|BSE)\s+([\d,.]+)\s+([\d,.]+)(?:\s+[\d,.]+){2}\s+([\d,.]+)/i);
    if(m){
      parsed.push({
        type:m[1].toUpperCase(),
        date:m[2],
        stock:m[3].trim(),
        qty:parseFloat(m[4].replace(/,/g,'')),
        price:parseFloat(m[5].replace(/,/g,'')),
        amount:parseFloat(m[6].replace(/,/g,''))
      });
    }
  });
  if(!parsed.length){
    // Try simpler: Buy/Sell Date Stock Qty Price Amount
    lines.forEach(line=>{
      const m2=line.match(/^(Buy|Sell)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,.]+)\s+([\d,.]+)/i);
      if(m2)parsed.push({type:m2[1].toUpperCase(),date:m2[2],stock:m2[3].trim(),qty:parseFloat(m2[4].replace(/,/g,'')),price:parseFloat(m2[5].replace(/,/g,'')),amount:0});
    });
  }
  if(!parsed.length){toast('Could not parse transactions. Check format.','r');return}
  window._pendingTxns=parsed;
  document.getElementById('txnPreview').style.display='block';
  document.getElementById('txnPreviewInfo').textContent=`${parsed.length} transactions detected.`;
  document.getElementById('txnPreviewHead').innerHTML='<tr><th>Type</th><th>Date</th><th>Stock</th><th>Qty</th><th>Price</th><th>Amount</th></tr>';
  document.getElementById('txnPreviewBody').innerHTML=parsed.slice(0,8).map(r=>`<tr><td><span class="badge ${r.type==='BUY'?'bg':'br'}">${r.type}</span></td><td>${r.date}</td><td>${r.stock}</td><td class="num">${r.qty}</td><td class="num">${fINR(r.price)}</td><td class="num">${fCr(r.amount)}</td></tr>`).join('');
  toast(`${parsed.length} transactions parsed ✓`);
}

function confirmHoldingsImport(){
  const clientId=document.getElementById('upHClient').value;
  const pmsId=document.getElementById('upHPms').value;
  if(!clientId){toast('Select a client','r');return}
  if(!pmsId){toast('Select a PMS','r');return}
  const rows=window._pendingHoldings||[];
  if(!rows.length){toast('No data to import','r');return}

  // Capture "before" state for drift detection, ahead of the replace below
  const oldClientRows=holdings.filter(h=>h.clientId===clientId&&h.pmsId===pmsId);
  const oldPmsHoldings=holdings.filter(h=>h.pmsId===pmsId);

  // Replace all holdings for this client+PMS
  holdings=holdings.filter(h=>!(h.clientId===clientId&&h.pmsId===pmsId));
  const uploadId=uid();
  const importedIds=[];
  rows.forEach(r=>{
    if(!r.stock||r.stock.match(/^(Cash|Total|Dividend|Interest)/i))return;
    const id=uid();
    holdings.push({id,clientId,pmsId,stock:r.stock,sector:r.sector||'Other',mktValue:r.mktValue||0,weight:r.weight||0,qty:r.qty||0,avgCost:r.avgCost||0,cmp:0,uploadId,addedAt:new Date().toISOString()});
    importedIds.push(id);
  });
  sv(K.H,holdings);

  // Capture "after" state and record any significant drift
  const newClientRows=holdings.filter(h=>h.clientId===clientId&&h.pmsId===pmsId);
  const newPmsHoldings=holdings.filter(h=>h.pmsId===pmsId);
  recordDriftAlerts(clientId,pmsId,oldClientRows,newClientRows,oldPmsHoldings,newPmsHoldings,uploadId);

  // If a Sector Allocation was extracted/reviewed for this PMS's factsheet,
  // store it as that PMS's authoritative sector split — used in preference
  // to aggregating individual (sometimes imperfectly-labeled) holdings.
  if(window._pendingSectorAllocation && window._pendingSectorAllocation.length){
    const bySector={};
    window._pendingSectorAllocation.forEach(r=>{ bySector[r.sector]=(bySector[r.sector]||0)+r.pct; });
    pmsSectorAlloc[pmsId]={bySector,uploadId,capturedAt:new Date().toISOString()};
    sv(K.PSA,pmsSectorAlloc);
  }
  window._pendingSectorAllocation=null;
  window._pendingSectorAllocationImage=null;
  const reviewBoxEl=document.getElementById('sectorReview');
  if(reviewBoxEl)reviewBoxEl.style.display='none';

  uploads.push({id:uploadId,type:'holdings',client:getClientName(clientId),clientId,pms:getPmsName(pmsId),pmsId,count:importedIds.length,importedIds,date:new Date().toISOString()});
  sv(K.UP,uploads);
  document.getElementById('holdPreview').style.display='none';
  document.getElementById('pasteHoldings').innerText='';
  window._pendingHoldings=[];
  saveSnapshot();
  renderAll();
  toast(`${importedIds.length} holdings imported ✓ (replaced previous)`);
}

function confirmTxnsImport(){
  const clientId=document.getElementById('upTClient').value;
  const pmsId=document.getElementById('upTPms').value;
  if(!clientId){toast('Select a client','r');return}
  if(!pmsId){toast('Select a PMS','r');return}
  const rows=window._pendingTxns||[];
  if(!rows.length){toast('No data to import','r');return}
  const uploadId=uid();
  const importedIds=[];
  rows.forEach(r=>{
    if(!r.stock)return;
    const effAmt=r.amount&&r.amount>0?r.amount:(r.qty&&r.price?r.qty*r.price:0);
    const id=uid();
    txns.push({id,uploadId,clientId,pmsId,stock:r.stock,date:r.date||'',settlementDate:r.settlementDate||'',type:r.type||'BUY',exchange:r.exchange||'NSE',qty:r.qty||0,price:r.price||0,brokerage:r.brokerage||0,stt:r.stt||0,amount:effAmt,notes:'Imported',addedAt:new Date().toISOString()});
    importedIds.push(id);
  });
  // Sort by date descending
  txns.sort((a,b)=>{
    const da=parseTxnDate(a.date),db=parseTxnDate(b.date);
    if(da&&db)return db-da;
    return (b.date||'').localeCompare(a.date||'');
  });
  sv(K.T,txns);
  uploads.push({id:uploadId,type:'transactions',client:getClientName(clientId),clientId,pms:getPmsName(pmsId),pmsId,count:importedIds.length,importedIds,date:new Date().toISOString()});
  sv(K.UP,uploads);
  document.getElementById('txnPreview').style.display='none';
  document.getElementById('pasteTxns').innerText='';
  window._pendingTxns=[];
  renderAll();
  toast(`${importedIds.length} transactions imported ✓`);
}

// == CSV/EXCEL UPLOAD — FULLY AUTOMATIC ==

// Parses ILIOS-style transaction statement Excel files where data is spread across many merged columns.
// Detects column positions from the header row then reads each data row using those positions.
function parseILIOSExcel(ws){
  // Build a row-indexed map by iterating all cell keys directly.
  // We CANNOT use ws['!ref'] + decode_range because ILIOS statements declare
  // dimension ref="A1" in their XML even though they have hundreds of rows —
  // so decode_range gives a 1x1 grid and the loop misses all data.
  const rowMap={};  // rowMap[rowIdx][colIdx] = cellValue
  Object.keys(ws).forEach(key=>{
    if(key[0]==='!')return;  // skip metadata keys like !ref, !cols, !merges
    const addr=XLSX.utils.decode_cell(key);
    if(!rowMap[addr.r])rowMap[addr.r]={};
    const cell=ws[key];
    rowMap[addr.r][addr.c]=cell?cell.v:'';
  });
  const rowNums=Object.keys(rowMap).map(Number).sort((a,b)=>a-b);
  if(!rowNums.length)return[];

  // Find the header row: first row whose cells include "Transaction Description" or "Security"
  let hdrRowNum=-1;
  for(const rn of rowNums){
    const vals=Object.values(rowMap[rn]).map(v=>(v||'').toString().toLowerCase());
    if(vals.some(v=>v.includes('transaction description'))||vals.some(v=>v==='security')){
      hdrRowNum=rn; break;
    }
  }

  if(hdrRowNum>=0){
    // Map column index -> field name from header row
    const hdr=rowMap[hdrRowNum];
    const ci={};
    Object.entries(hdr).forEach(([c,v])=>{
      const col=Number(c);
      // Strip ALL whitespace (spaces, newlines, tabs) and lowercase for matching
      const vl=(v||'').toString().toLowerCase().replace(/[\s\r\n]+/g,'');
      // Transaction Description -> col A (0)
      if(vl.includes('transactiondesc')||vl==='buysell')ci.type=col;
      // Tran Date -> col D (3)
      if(vl==='trandate'||vl==='transactiondate'||vl==='tradedate')ci.date=col;
      // Settlement Date -> col F (5)
      if(vl==='settlementdate'||vl.includes('settlement')&&vl.includes('date'))ci.settlementDate=col;
      // Security -> col H (7)
      if(vl==='security'||vl==='stock'||vl==='scrip')ci.stock=col;
      // Exchg -> col L (11)
      if(vl==='exchg'||vl==='exchange'||vl==='market')ci.exchange=col;
      // Quantity -> col O (14)
      if(vl==='quantity'||vl==='qty')ci.qty=col;
      // Unit Price -> col R (17)
      if(vl==='unitprice'||vl==='price'||vl==='rate')ci.price=col;
      // Brkg. -> col W (22)
      if(vl==='brkg.'||vl==='brkg'||vl.includes('brokerage')||vl.includes('commission'))ci.brokerage=col;
      // STT -> col Y (24)
      if(vl==='stt')ci.stt=col;
      // Settlement Amount -> col AC (28)
      if(vl==='settlementamount'||vl.includes('settlement')&&vl.includes('amount'))ci.amount=col;
    });
    // Exact fallback positions verified from actual ILIOS Transaction Statement Excel
    // (I200_101544_TransactionStatement_India94CT.xlsx, openpyxl inspection):
    // A(0):type  D(3):tranDate  F(5):settlementDate  H(7):security
    // L(11):exchg  O(14):qty  R(17):unitPrice  W(22):brkg  Y(24):stt  AC(28):settlementAmount
    if(ci.type===undefined)ci.type=0;
    if(ci.date===undefined)ci.date=3;
    if(ci.settlementDate===undefined)ci.settlementDate=5;
    if(ci.stock===undefined)ci.stock=7;
    if(ci.exchange===undefined)ci.exchange=11;
    if(ci.qty===undefined)ci.qty=14;
    if(ci.price===undefined)ci.price=17;
    if(ci.brokerage===undefined)ci.brokerage=22;
    if(ci.stt===undefined)ci.stt=24;
    if(ci.amount===undefined)ci.amount=28;

    const clean=s=>parseFloat((s||'0').toString().replace(/,/g,''))||0;
    // Section/header text patterns to skip — these repeat every ~37 rows (one page per month)
    const SKIP_PAT=/^(buy|sell)$/i;
    const SECTION_PAT=/^(transaction\s*statement|account\s*:|buoyant|from\s+\d|current\s+period|shares\s*-|transaction\s*desc|not\s+settled|debt|summary|grand)/i;
    const parsed=[];
    for(const rn of rowNums){
      if(rn<=hdrRowNum)continue;
      const row=rowMap[rn];
      const typeVal=(row[ci.type]||'').toString().trim();
      // Skip blank rows, section headers, repeated column headers
      if(!typeVal)continue;
      if(!SKIP_PAT.test(typeVal))continue;
      const stockVal=(row[ci.stock]||'').toString().trim();
      if(!stockVal||SECTION_PAT.test(stockVal))continue;
      const rawAmt=clean(row[ci.amount]);
      const rawQty=clean(row[ci.qty]);
      const rawPrice=clean(row[ci.price]);
      const effAmt=rawAmt>0?rawAmt:(rawQty>0&&rawPrice>0?rawQty*rawPrice:0);
      parsed.push({
        'Transaction Description':typeVal,
        'Tran Date':(row[ci.date]||'').toString().trim(),
        'Settlement Date':(row[ci.settlementDate]||'').toString().trim(),
        'Security':stockVal,
        'Exchange':(row[ci.exchange]||'NSE').toString().trim()||'NSE',
        'Quantity':rawQty,
        'Unit Price':rawPrice,
        'Brokerage':clean(row[ci.brokerage]),
        'STT':clean(row[ci.stt]),
        'Settlement Amount':effAmt,
      });
    }
    return parsed;
  }

  // No recognised header — build rows as plain objects keyed by column index
  // so autoMapHoldings/autoMapTxns can still attempt to match by name
  const maxCol=Math.max(...rowNums.map(rn=>Math.max(...Object.keys(rowMap[rn]).map(Number))));
  const hdrRn=rowNums[0];
  const hdrCells=rowMap[hdrRn];
  const colNames={};
  for(let c=0;c<=maxCol;c++) colNames[c]=(hdrCells[c]||`Col_${c}`).toString();
  return rowNums.slice(1).map(rn=>{
    const obj={};
    for(let c=0;c<=maxCol;c++) obj[colNames[c]]=(rowMap[rn][c]||'').toString();
    return obj;
  }).filter(r=>Object.values(r).some(v=>v.trim()!==''));
}

function handleFileUpload(event,type){
  const file=event.target.files[0];if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();

  // -- Fully-automatic mapper for ILIOS-format & standard CSV/Excel --
  // For transactions: expects cols "Transaction Description", "Tran Date", "Security",
  //   "Quantity", "Unit Price", "Settlement Amount"  (ILIOS Transaction Statement format)
  // For holdings: expects cols "Security"/"Stock", "Sector", market value, weight, qty, avg cost

  const clean=s=>parseFloat((s||'0').toString().replace(/,/g,'').replace(/[^0-9.-]/g,''))||0;

  function findCol(keys,matchers){
    for(const m of matchers){
      const found=keys.find(k=>k.toLowerCase().replace(/[\s_-]/g,'').includes(m));
      if(found)return found;
    }
    return null;
  }

  function autoMapHoldings(data){
    if(!data.length)return[];
    const keys=Object.keys(data[0]);
    const stockCol=findCol(keys,['security','stock','scrip','company','name']);
    const sectorCol=findCol(keys,['sector','industry']);
    const mktCol=findCol(keys,['mktvalue','marketvalue','currentvalue','portfoliovalue']);
    const weightCol=findCol(keys,['weight','allocation','assets','%oftotal']);
    const qtyCol=findCol(keys,['quantity','qty','shares','units']);
    const costCol=findCol(keys,['avgcost','averagecost','cost','purchaseprice','avgprice']);
    if(!stockCol){toast('Could not detect Stock column in file','r');return[]}
    return data.map(r=>({
      stock:normalizeSpaces((r[stockCol]||'').toString()),
      sector:sectorCol?(r[sectorCol]||'').toString().trim()||'Other':'Other',
      mktValue:mktCol?clean(r[mktCol]):0,
      weight:weightCol?parseFloat((r[weightCol]||'0').toString().replace(/[,%]/g,''))||0:0,
      qty:qtyCol?clean(r[qtyCol]):0,
      avgCost:costCol?clean(r[costCol]):0,
    })).filter(r=>r.stock&&!r.stock.match(/^(Cash|Total|Dividend|Interest|Sr\.?$|Security|Grand)/i));
  }

  function autoMapTxns(data){
    if(!data.length)return[];
    const keys=Object.keys(data[0]);
    // ILIOS Transaction Statement column names take priority
    const typeCol=findCol(keys,['transactiondescription','transactiondesc','description','type','buysell','action']);
    const dateCol=findCol(keys,['trandate','transactiondate','date','tradedate']);
    const settleDateCol=findCol(keys,['settlementdate','settledate','valuedate']);
    const stockCol=findCol(keys,['security','stock','scrip','instrument','company']);
    const exchgCol=findCol(keys,['exchange','exchg','market']);
    const qtyCol=findCol(keys,['quantity','qty','shares','units']);
    const priceCol=findCol(keys,['unitprice','price','rate','tradeprice']);
    const brkgCol=findCol(keys,['brokerage','brkg','commission']);
    const sttCol=findCol(keys,['stt']);
    const amtCol=findCol(keys,['settlementamount','amount','netamount','value','settlement']);
    if(!stockCol){toast('Could not detect Security/Stock column in file','r');return[]}
    return data.map(r=>{
      const rawType=typeCol?(r[typeCol]||'').toString().trim().toUpperCase():'BUY';
      const rawQty=qtyCol?clean(r[qtyCol]):0;
      const rawPrice=priceCol?clean(r[priceCol]):0;
      const rawAmt=amtCol?clean(r[amtCol]):0;
      const effAmt=rawAmt>0?rawAmt:(rawQty>0&&rawPrice>0?rawQty*rawPrice:0);
      return {
        type:rawType.includes('SELL')?'SELL':rawType.includes('DIV')?'DIVIDEND':'BUY',
        date:dateCol?(r[dateCol]||'').toString().trim():'',
        settlementDate:settleDateCol?(r[settleDateCol]||'').toString().trim():'',
        stock:normalizeSpaces((r[stockCol]||'').toString()),
        exchange:exchgCol?(r[exchgCol]||'NSE').toString().trim()||'NSE':'NSE',
        qty:rawQty,
        price:rawPrice,
        brokerage:brkgCol?clean(r[brkgCol]):0,
        stt:sttCol?clean(r[sttCol]):0,
        amount:effAmt,
      };
    }).filter(r=>r.stock&&r.stock.length>1&&!r.stock.match(/^(Cash|Total|Shares|Current|Transaction|Security|Grand)/i));
  }

  function processData(data){
    if(!data||!data.length){toast('File appears empty or could not be parsed','r');return}
    if(type==='holdings'){
      window._pendingHoldings=autoMapHoldings(data);
      showHoldingsPreview();
    } else {
      window._pendingTxns=autoMapTxns(data);
      showTxnsPreview();
    }
  }

  if(ext==='csv'){
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:function(res){processData(res.data)}});
  } else {
    const reader=new FileReader();
    reader.onload=function(e){
      const wb=XLSX.read(e.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      // Always use parseILIOSExcel — reads the raw cell grid, finds the real header row
      // (wherever it sits), and maps columns by name + known ILIOS column positions.
      // sheet_to_json is NOT used: it blindly treats row 0 as header, which for ILIOS
      // statements is the title row ("Transaction Statement"), not the actual header
      // ("Transaction Description", "Security", etc. which sits at row 5).
      processData(parseILIOSExcel(ws));
    };reader.readAsArrayBuffer(file);
  }
}

function showHoldingsPreview(){
  const p=window._pendingHoldings||[];
  if(!p.length){toast('No valid holdings rows detected in file','r');return}
  document.getElementById('holdPreview').style.display='block';
  const selClientName2=getClientName(document.getElementById('upHClient').value)||'(none selected)';
  const selPmsName2=getPmsName(document.getElementById('upHPms').value)||'(none selected)';
  document.getElementById('holdPreviewInfo').innerHTML=`${p.length} holdings auto-detected from file for <b style="color:var(--text)">${selClientName2}</b> — <b style="color:var(--text)">${selPmsName2}</b>. Double-check this is the right client, then confirm.`;
  document.getElementById('holdPreviewHead').innerHTML='<tr><th>Stock</th><th>Sector</th><th>Qty</th><th>Mkt Value</th><th>Weight%</th></tr>';
  document.getElementById('holdPreviewBody').innerHTML=p.slice(0,10).map(r=>`<tr><td>${r.stock}</td><td>${r.sector}</td><td class="num">${r.qty||'—'}</td><td class="num">${fINR(r.mktValue)}</td><td class="num">${r.weight}%</td></tr>`).join('');
  toast(`${p.length} holdings parsed ✓`);
}
function showTxnsPreview(){
  const p=window._pendingTxns||[];
  if(!p.length){toast('No valid transaction rows detected in file','r');return}
  document.getElementById('txnPreview').style.display='block';
  document.getElementById('txnPreviewInfo').textContent=`${p.length} transactions auto-detected — verify and confirm.`;
  document.getElementById('txnPreviewHead').innerHTML='<tr><th>Type</th><th>Tran Date</th><th>Settle Date</th><th>Security</th><th>Exchg</th><th>Qty</th><th>Unit Price</th><th>Brkg</th><th>STT</th><th>Settlement Amount</th></tr>';
  document.getElementById('txnPreviewBody').innerHTML=p.slice(0,10).map(r=>{
    const effAmt=r.amount&&r.amount>0?r.amount:(r.qty&&r.price?r.qty*r.price:0);
    return `<tr>
      <td style="color:${r.type==='BUY'?'var(--green)':'var(--red)'};font-weight:600">${r.type}</td>
      <td style="font-size:11px">${r.date||'—'}</td>
      <td style="font-size:11px;color:var(--muted)">${r.settlementDate||'—'}</td>
      <td>${r.stock}</td>
      <td style="font-size:11px">${r.exchange||'NSE'}</td>
      <td class="num">${r.qty?Number(r.qty).toLocaleString('en-IN',{maximumFractionDigits:3}):'—'}</td>
      <td class="num">${r.price>0?fINR(r.price):'—'}</td>
      <td class="num" style="color:var(--muted)">${r.brokerage>0?fINR(r.brokerage):'—'}</td>
      <td class="num" style="color:var(--muted)">${r.stt>0?fINR(r.stt):'—'}</td>
      <td class="num"><b>${effAmt>0?fINR(effAmt):'—'}</b></td>
    </tr>`;
  }).join('');
  toast(`${p.length} transactions parsed ✓`);
}

// == PMS MANAGEMENT ==
function addPMS(){
  const name=document.getElementById('pms-name').value.trim();
  const strategy=document.getElementById('pms-strategy').value.trim();
  if(!name||!strategy){toast('Enter PMS name and strategy','r');return}
  pmsList.push({id:uid(),name,strategy,aum:parseFloat(document.getElementById('pms-aum').value)||0,bench:document.getElementById('pms-bench').value,r1m:parseFloat(document.getElementById('pms-1m').value)||null,r3m:null,r6m:null,r1y:parseFloat(document.getElementById('pms-1y').value)||null,r3y:parseFloat(document.getElementById('pms-3y').value)||null,r4y:parseFloat(document.getElementById('pms-4y').value)||null,r5y:parseFloat(document.getElementById('pms-5y').value)||null,rsi:parseFloat(document.getElementById('pms-si').value)||null,updatedAt:new Date().toISOString()});
  sv(K.PMS,pmsList);closeMo('addPMSMo');renderAll();toast(name+' added ✓');
  ['pms-name','pms-strategy','pms-aum','pms-1m','pms-1y','pms-3y','pms-4y','pms-5y','pms-si'].forEach(id=>document.getElementById(id).value='');
}
function deletePMS(id){if(!confirm('Remove this PMS?'))return;pmsList=pmsList.filter(p=>p.id!==id);sv(K.PMS,pmsList);renderAll()}

// == TICKER MAPPINGS ==
function addTickerMapping(){
  const from=document.getElementById('tickerFrom').value.trim().toUpperCase();
  const to=document.getElementById('tickerTo').value.trim().toUpperCase();
  if(!from||!to){toast('Enter both fields','r');return}
  tickerMap[from]=to;
  sv(K.TK,tickerMap);
  document.getElementById('tickerFrom').value='';document.getElementById('tickerTo').value='';
  renderTickerMappings();toast('Mapping added ✓');
}
function renderTickerMappings(){
  const box=document.getElementById('tickerMappings');
  const entries=Object.entries(tickerMap);
  if(!entries.length){box.innerHTML='<span style="color:var(--muted)">No custom mappings.</span>';return}
  box.innerHTML=entries.map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span>${k} → <span style="color:var(--orange)">${v}</span></span><button class="btn btn-d btn-sm" onclick="delete tickerMap['${k}'];sv(K.TK,tickerMap);renderTickerMappings()">✕</button></div>`).join('');
}

// == ANGEL ONE API ==
// Resolve NSE trading symbols to Angel One instrument tokens using the searchScrip
// endpoint on apiconnect.angelbroking.com (same authenticated, CORS-friendly domain
// used for login/getLtpData — no scrip master file, no proxy needed).
function loadTokenCache(){
  try{return JSON.parse(localStorage.getItem(K.SM)||'{}')}catch{return{}}
}
function saveTokenCache(cache){localStorage.setItem(K.SM,JSON.stringify(cache))}

async function resolveSymbolToken(tradingSym,headers,cache,attempt,exchange){
  attempt=attempt||0;
  exchange=exchange||'NSE';
  const cacheKey=exchange+':'+tradingSym;
  if(cache[cacheKey])return{token:cache[cacheKey],exchange};
  const searchUrl='https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/searchScrip';
  const searchTerm=tradingSym.replace(/-EQ$/,'');
  const resp=await fetch(searchUrl,{method:'POST',headers,body:JSON.stringify({exchange,searchscrip:searchTerm})});
  let data;
  try{
    data=await resp.json();
  }catch(e){
    // Non-JSON body — almost always Angel One's rate limiter kicking in
    if(attempt<2){await new Promise(r=>setTimeout(r,2000));return resolveSymbolToken(tradingSym,headers,cache,attempt+1,exchange)}
    throw e;
  }
  if(data.errorcode==='AB1004'&&attempt<2){
    await new Promise(r=>setTimeout(r,2000));
    return resolveSymbolToken(tradingSym,headers,cache,attempt+1,exchange);
  }
  if(data.status&&Array.isArray(data.data)){
    const match=data.data.find(d=>d.exchange===exchange&&d.tradingsymbol===tradingSym)
      ||data.data.find(d=>d.exchange===exchange&&d.tradingsymbol===searchTerm+'-EQ');
    if(match){
      cache[cacheKey]=match.symboltoken;
      return{token:match.symboltoken,exchange};
    }
  }
  // Not found on this exchange — fall back to BSE if we haven't tried it yet.
  if(exchange==='NSE'){
    return resolveSymbolToken(tradingSym,headers,cache,0,'BSE');
  }
  return null;
}

// For stocks with NO known ticker mapping yet: search Angel One's own NSE
// symbol list using the actual company name (progressively shortened),
// score results by how many significant words overlap with the company
// name, and return the best NSE cash-equity match. Called automatically —
// no manual ticker entry needed, ever.
async function smartSearchTicker(companyName,headers){
  const clean=companyName.toUpperCase().replace(/\s+LTD\.?$/,'').replace(/[.,]/g,'').trim();
  const words=clean.split(/\s+/).filter(w=>w.length>2&&!['AND','THE','LTD'].includes(w));
  const candidates=[clean,words.slice(0,2).join(' '),words[0]].filter((v,i,a)=>v&&a.indexOf(v)===i);
  const searchUrl='https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/searchScrip';
  for(const exchange of['NSE','BSE']){
    for(const term of candidates){
      try{
        const resp=await fetch(searchUrl,{method:'POST',headers,body:JSON.stringify({exchange,searchscrip:term})});
        const data=await resp.json();
        if(data.status&&Array.isArray(data.data)&&data.data.length){
          const eq=data.data.filter(d=>d.exchange===exchange&&(exchange==='NSE'?/-EQ$/.test(d.tradingsymbol||''):true));
          if(eq.length){
            const scored=eq.map(d=>{
              const dn=(d.name||d.tradingsymbol||'').toUpperCase();
              const score=words.filter(w=>dn.includes(w)).length;
              return{d,score};
            }).sort((a,b)=>b.score-a.score);
            if(scored[0]&&scored[0].score>0)return{...scored[0].d,exchange};
          }
        }
      }catch(e){/* try next, shorter candidate */}
      await new Promise(r=>setTimeout(r,400));
    }
  }
  return null;
}

// ==============================================================
// AI-ASSISTED TICKER RESOLUTION (last resort, always verified)
// ------------------------------------------------
// smartSearchTicker() above matches words from the full company name
// against Angel One's own instrument data — but Angel One's "name"
// field is actually just a shortened symbol variant (e.g. SBIN-EQ's
// name is "SBIN", not "State Bank Of India"), not a real company name.
// That's a structural mismatch, not a coverage gap, so many correctly-
// spelled, genuinely listed companies will keep failing that search
// no matter how many manual entries get added.
//
// This asks the AI (general knowledge) what the likely NSE symbol is,
// but NEVER trusts that guess directly — a wrong ticker would silently
// show the wrong stock's price under the right company's name, which
// is worse than no price at all. The AI's suggestion is only ever used
// if Angel One's own data confirms a matching instrument actually
// exists under that exact symbol.
// ==============================================================
async function aiAssistedTickerLookup(companyName, headers){
  try{
    const prompt = `What is the exact NSE trading symbol for the Indian company "${companyName}"? Respond with ONLY the bare symbol (e.g. "RELIANCE", "TCS"), with no "-EQ" suffix, no explanation, no punctuation. If you are not confident of the exact symbol, respond with exactly: UNKNOWN`;
    const suggestion = (await callAIProxy(null, prompt, {maxTokens:20, temperature:0})).trim().toUpperCase().replace(/[^A-Z0-9&-]/g,'');
    if(!suggestion || suggestion==='UNKNOWN') return null;

    // Verify the AI's suggestion against Angel One's own data — this is
    // the step that makes this safe. An unverified AI guess never reaches
    // the price-fetch step.
    const searchUrl='https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/searchScrip';
    const resp = await fetch(searchUrl,{method:'POST',headers,body:JSON.stringify({exchange:'NSE',searchscrip:suggestion})});
    const data = await resp.json();
    if(data.status && Array.isArray(data.data)){
      const match = data.data.find(d=>d.exchange==='NSE' && (d.tradingsymbol||'')===suggestion+'-EQ');
      if(match) return {...match, exchange:'NSE', _aiAssisted:true};
    }
    return null; // AI's guess didn't check out against real data — treat as unresolved, don't guess further
  }catch(e){
    console.error('AI-assisted ticker lookup failed:', e);
    return null;
  }
}

function base32Decode(s){const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';s=s.toUpperCase().replace(/=+$/,'');let b=0,v=0;const o=[];for(let i=0;i<s.length;i++){v=(v<<5)|a.indexOf(s[i]);b+=5;if(b>=8){b-=8;o.push((v>>b)&0xFF)}}return new Uint8Array(o)}
async function generateTOTP(secret){const key=base32Decode(secret);const counter=Math.floor(Date.now()/1000/30);const buf=new ArrayBuffer(8);const view=new DataView(buf);view.setUint32(4,counter,false);const ck=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-1'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',ck,buf));const off=sig[19]&0xF;const otp=((sig[off]&0x7F)<<24|(sig[off+1]&0xFF)<<16|(sig[off+2]&0xFF)<<8|(sig[off+3]&0xFF))%1000000;return String(otp).padStart(6,'0')}

async function angelLogin(){
  const statusEl=document.getElementById('aoStatus')||document.getElementById('priceStatus');
  statusEl.textContent='⏳ Logging in...';
  try{
    const totp=await generateTOTP(AO_CONFIG.totpSecret);
    const resp=await fetch('https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','X-UserType':'USER','X-SourceID':'WEB','X-ClientLocalIP':'127.0.0.1','X-ClientPublicIP':'127.0.0.1','X-MACAddress':'00:00:00:00:00:00','X-PrivateKey':AO_CONFIG.apiKey},
      body:JSON.stringify({clientcode:AO_CONFIG.clientId,password:AO_CONFIG.mpin,totp})
    });
    const data=await resp.json();
    if(data.status&&data.data?.jwtToken){
      aoToken=data.data.jwtToken;
      localStorage.setItem('ao_token',aoToken);
      statusEl.textContent='✓ Logged in to Angel One. Click ⚡ Fetch Live Prices in Holdings tab.';
      toast('Angel One login ✓');
    }else{
      statusEl.textContent='❌ Login failed: '+(data.message||'Check credentials');
      toast('Login failed','r');
    }
  }catch(e){statusEl.textContent='❌ '+e.message;toast('Login error','r')}
}
function angelLogout(){aoToken='';localStorage.removeItem('ao_token');document.getElementById('aoStatus').textContent='Logged out.';toast('Logged out')}

async function fetchLivePrices(){
  if(!aoToken){toast('Login to Angel One first (Settings tab)','r');return}
  const statusEl=document.getElementById('priceStatus');
  const stockMap={};
  holdings.forEach(h=>{const s=(h.stock||'').trim();if(s)stockMap[s]=resolveNSE(s)});
  const entries=Object.entries(stockMap);
  if(!entries.length){toast('No holdings to fetch prices for','r');return}

  statusEl.textContent=`⏳ Fetching prices for ${entries.length} stocks via Angel One...`;
  const tokenCache=loadTokenCache();
  const headers={'Content-Type':'application/json','Accept':'application/json','X-UserType':'USER','X-SourceID':'WEB','X-ClientLocalIP':'127.0.0.1','X-ClientPublicIP':'127.0.0.1','X-MACAddress':'00:00:00:00:00:00','X-PrivateKey':AO_CONFIG.apiKey,'Authorization':'Bearer '+aoToken};
  const ltpUrl='https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/getLtpData';
  let updated=0;
  const reasons=[]; // {sym, reason}

  let autoDiscovered=0;

  // Fetch one stock's price, with a single retry+backoff if we hit Angel One's rate limiter
  async function fetchOne(stockName,nseSym,attempt){
    let tradingSym=nseSym+'-EQ';
    let token,exchange='NSE';

    // No confirmed ticker mapping for this stock — auto-discover it by
    // searching Angel One's own symbol list using the company name itself,
    // then remember it permanently so this never has to happen again.
    if(!isKnownSymbolMapping(stockName)){
      let found=await smartSearchTicker(stockName,headers);
      let aiAssisted=false;
      if(!found){
        // Direct search failed — Angel One's own data doesn't store full
        // company names, so this is common even for correctly-named,
        // genuinely listed stocks. Try an AI-suggested symbol, but only
        // ever accept it if Angel One's real data confirms it exists.
        found=await aiAssistedTickerLookup(stockName,headers);
        aiAssisted=true;
      }
      if(found){
        const discoveredTicker=found.tradingsymbol.replace(/-EQ$/,'');
        tickerMap[normalizeSpaces(stockName).toUpperCase()]=discoveredTicker;
        sv(K.TK,tickerMap);
        tradingSym=found.tradingsymbol;
        token=found.symboltoken;
        exchange=found.exchange||'NSE';
        tokenCache[exchange+':'+tradingSym]=token;
        autoDiscovered++;
        if(aiAssisted) console.log(`AI-assisted ticker match for "${stockName}" → ${discoveredTicker} (verified against Angel One)`);
      }else{
        reasons.push({sym:nseSym,reason:`could not auto-identify a ticker for "${stockName}" on NSE or BSE — add it manually in Ticker Mappings (Settings)`});
        return false;
      }
    }

    if(!token){
      try{
        const found=await resolveSymbolToken(tradingSym,headers,tokenCache);
        if(found){token=found.token;exchange=found.exchange}
      }catch(e){
        reasons.push({sym:nseSym,reason:'token lookup error: '+e.message});
        return false;
      }
    }
    if(!token){
      reasons.push({sym:nseSym,reason:`no matching symbol found on NSE or BSE for "${stockName}" (check ticker mapping)`});
      return false;
    }
    try{
      const resp=await fetch(ltpUrl,{method:'POST',headers,body:JSON.stringify({exchange,tradingsymbol:tradingSym,symboltoken:token})});
      let data;
      try{data=await resp.json()}
      catch{
        // Non-JSON body — almost always Angel One's rate limiter kicking in
        if(attempt<2){await new Promise(r=>setTimeout(r,2000));return fetchOne(stockName,nseSym,attempt+1)}
        reasons.push({sym:nseSym,reason:'rate limited (non-JSON response) after retry'});
        return false;
      }
      if(data.status&&data.data){
        const ltp=parseFloat(data.data.ltp)||0;
        if(ltp>0){
          prices[nseSym]=ltp;prices[stockName]=ltp;
          // Angel One's getLtpData response never includes a percentChange
          // field (confirmed against their documented response shape) — but
          // it does return the previous day's close alongside ltp, so the
          // real day change can be derived directly, with no extra API call.
          const prevClose=parseFloat(data.data.close)||0;
          if(prevClose>0) prices[nseSym+'_chg']=((ltp-prevClose)/prevClose)*100;
          holdings=holdings.map(h=>(h.stock===stockName)?{...h,cmp:ltp}:h);
          return true;
        }
        reasons.push({sym:nseSym,reason:'LTP returned 0'});
        return false;
      }
      if(data.errorcode==='AB1010'||data.errorcode==='AB1008'||/invalid\s*token/i.test(data.message||'')){
        statusEl.textContent='⚠ Session expired — re-login in Settings.';
        aoToken='';localStorage.removeItem('ao_token');
        throw {sessionExpired:true};
      }
      if(data.errorcode==='AB1004'&&attempt<2){
        // Rate limited — back off and retry once
        await new Promise(r=>setTimeout(r,2000));
        return fetchOne(stockName,nseSym,attempt+1);
      }
      reasons.push({sym:nseSym,reason:(data.errorcode||'')+' '+(data.message||'unknown error')});
      return false;
    }catch(e){
      if(e&&e.sessionExpired)throw e;
      reasons.push({sym:nseSym,reason:'network/fetch error: '+e.message});
      return false;
    }
  }

  for(let i=0;i<entries.length;i++){
    const [stockName,nseSym]=entries[i];
    const displaySym = nseSym.length>40 ? nseSym.slice(0,40)+'…' : nseSym;
    statusEl.textContent=`⏳ ${i+1}/${entries.length}: ${displaySym}...`;
    try{
      if(await fetchOne(stockName,nseSym,0))updated++;
    }catch(e){
      if(e&&e.sessionExpired)return; // status already set, bail out
      reasons.push({sym:nseSym,reason:'unexpected error: '+(e.message||e)});
    }
    // Pace requests to stay under Angel One's rate limit (2 calls/stock: searchScrip + getLtpData)
    await new Promise(r=>setTimeout(r,600));
  }

  saveTokenCache(tokenCache);
  sv(K.P,prices);sv(K.H,holdings);
  const now=new Date().toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  if(reasons.length)console.log('Fetch Live Prices — failures:',reasons);

  // Cap how much of any single reason (and the stock name inside it) can
  // ever be shown inline — without this, one corrupted/oversized "stock"
  // name (e.g. from a bad PDF import) blows up into a wall of text that
  // makes the whole status line unreadable.
  const clip = s => String(s).length>90 ? String(s).slice(0,90)+'…' : s;

  const summary = `✓ ${updated}/${entries.length} prices updated (${now})`
    + (autoDiscovered ? ` · 🔎 ${autoDiscovered} new ticker(s) auto-identified` : '');

  if(!reasons.length){
    statusEl.innerHTML = summary;
  } else {
    const detailRows = reasons.map(r=>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border)">
         <span style="color:var(--red);font-family:var(--mono)">${clip(r.sym)}</span>
         <span style="color:var(--muted)"> — ${clip(r.reason)}</span>
       </div>`
    ).join('');
    statusEl.innerHTML = `${summary} · <span style="color:var(--red)">${reasons.length} failed</span>
      <details style="display:inline;margin-left:4px">
        <summary style="display:inline;cursor:pointer;color:var(--orange);font-size:10px">show details</summary>
        <div style="margin-top:6px;max-height:160px;overflow-y:auto;font-size:11px">${detailRows}</div>
      </details>`;
  }
  renderTickerMappings();
  renderAll();
  toast(`${updated} prices updated ✓`);
}

// == PERFORMANCE ==
let perfBarChart=null,perfMonthlyChart=null;

function renderPerformance(){
  const cf=document.getElementById('perfClient')?.value||'all';
  const pf=document.getElementById('perfPms')?.value||'all';
  // Populate dropdowns
  const perfClientDd=document.getElementById('perfClient');
  if(perfClientDd&&perfClientDd.options.length<=1){
    perfClientDd.innerHTML='<option value="all">All Clients</option>'+clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  }
  const perfPmsDd=document.getElementById('perfPms');
  if(perfPmsDd&&perfPmsDd.options.length<=1){
    perfPmsDd.innerHTML='<option value="all">All PMS</option>'+pmsList.map(p=>`<option value="${p.id}">${p.strategy}</option>`).join('');
  }

  // -- All data sourced from holdings only — no transactions used --
  let myH=[...holdings];
  if(cf!=='all')myH=myH.filter(h=>h.clientId===cf);
  if(pf!=='all')myH=myH.filter(h=>h.pmsId===pf);

  // Current portfolio value: live CMP × qty if available, else mktValue from factsheet
  const curValue=myH.reduce((s,h)=>{
    const cmp=prices[resolveNSE(h.stock)]||prices[h.stock]||0;
    return s+(cmp>0&&h.qty?h.qty*cmp:h.mktValue||0);
  },0);

  // Contribution & inception date — from client record only
  const client=cf!=='all'?clients.find(c=>c.id===cf):null;
  const inceptionDate=client?.date?new Date(client.date):null;
  const contribution=client?.amount||myH.reduce((s,h)=>s+(h.mktValue||0),0)||0;

  // Withdrawal — from client record field (no transactions used)
  const withdrawal=client?.withdrawal||0;

  // Profit/Loss purely from holdings: current value vs net contributed
  const netContributed=contribution-withdrawal;
  const profitLoss=curValue-netContributed;
  const simplePnlPct=netContributed>0?(profitLoss/netContributed*100):null;

  // -- Period returns from holdings snapshots only --
  const now=new Date();
  let snaps=[];try{snaps=JSON.parse(localStorage.getItem('i72_snaps')||'[]')}catch{}

  // Benchmark from PMS record linked to client
  const benchPms=pf!=='all'?pmsList.find(p=>p.id===pf):(client?.pmsId?pmsList.find(p=>p.id===client.pmsId):pmsList[0]);

  function snapReturn(daysAgo){
    if(!snaps.length||!curValue)return null;
    const target=new Date(now.getTime()-daysAgo*86400000);
    const older=snaps.filter(s=>{
      const parts=s.date.split('/');
      const d=parts.length===3?new Date(+parts[2],+parts[1]-1,+parts[0]):new Date(s.date);
      return d<=target;
    });
    if(!older.length)return null;
    const base=older[older.length-1].value;
    if(!base)return null;
    return (curValue-base)/base*100;
  }

  const mtdDays=now.getDate()-1;
  const qStart=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1);
  const qtdDays=Math.floor((now-qStart)/86400000);
  const ytdDays=Math.floor((now-new Date(now.getFullYear(),0,1))/86400000);
  const siDays=inceptionDate?Math.floor((now-inceptionDate)/86400000):null;

  const portfolioMTD=snapReturn(mtdDays);
  const portfolioQTD=snapReturn(qtdDays);
  const portfolioYTD=snapReturn(ytdDays);
  const portfolioSI=siDays?snapReturn(siDays):null;

  // Benchmark returns from PMS record
  const bmkMTD=benchPms?.r1m??null;
  const bmkQTD=benchPms?.r3m??null;
  const bmkYTD=benchPms?.r1y??null;
  const bmkSI=benchPms?.rsi??null;
  const bmkName=benchPms?.bench||'S&P BSE 500 TRI';

  // -- Since inception label --
  const siLabel=inceptionDate
    ?`Since ${inceptionDate.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})}`
    :(snaps.length?`Since ${snaps[0].date}`:'Since Inception');
  const perfSinceEl=document.getElementById('perfSinceLabel');
  if(perfSinceEl)perfSinceEl.textContent=siLabel;
  const hdrEl=document.getElementById('perfSinceHeader');
  if(hdrEl)hdrEl.textContent=siLabel;

  // -- Portfolio Summary — holdings only --
  document.getElementById('perfSummaryBody').innerHTML=`
    <tr><td style="color:var(--muted);font-size:12px;padding:5px 8px">Contribution</td><td class="num" style="padding:5px 8px"><b>${fINR(contribution)}</b></td></tr>
    <tr><td style="color:var(--muted);font-size:12px;padding:5px 8px">Withdrawal</td><td class="num" style="padding:5px 8px">${fINR(withdrawal)}</td></tr>
    <tr><td style="color:var(--muted);font-size:12px;padding:5px 8px">Profit / Loss</td><td class="num" style="padding:5px 8px;color:${profitLoss>=0?'var(--green)':'var(--red)'}"><b>${fINR(profitLoss)}</b></td></tr>
    <tr style="border-top:1px solid var(--border2)"><td style="font-size:13px;font-weight:700;padding:8px 8px">Portfolio Value (${now.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})})</td><td class="num" style="padding:8px 8px;font-size:14px;font-weight:800;color:var(--orange)"><b>${fINR(curValue)}</b></td></tr>
  `;

  // -- IRR Table --
  function irrCell(val){
    if(val===null||val===undefined)return`<td style="text-align:center;color:var(--muted);font-family:var(--mono)">—</td>`;
    const col=val>=0?'var(--green)':'var(--red)';
    return`<td style="text-align:center;font-family:var(--mono);font-weight:600;color:${col}">${fPct(val)}</td>`;
  }
  document.getElementById('perfIRRBody').innerHTML=`
    <tr style="background:rgba(59,130,246,0.06)">
      <td style="display:flex;align-items:center;gap:8px;padding:10px 12px">
        <span style="display:inline-block;width:12px;height:12px;background:#3B82F6;border-radius:2px"></span>
        <b>Portfolio</b>
      </td>
      ${irrCell(portfolioMTD)}${irrCell(portfolioQTD)}${irrCell(portfolioYTD)}${irrCell(portfolioSI??simplePnlPct)}
    </tr>
    <tr style="background:rgba(100,100,100,0.04)">
      <td style="display:flex;align-items:center;gap:8px;padding:10px 12px">
        <span style="display:inline-block;width:12px;height:12px;background:#888;border-radius:2px"></span>
        <span style="color:var(--dim)">${bmkName}</span>
      </td>
      ${irrCell(bmkMTD)}${irrCell(bmkQTD)}${irrCell(bmkYTD)}${irrCell(bmkSI)}
    </tr>
  `;

  // -- Bar Chart --
  const barLabels=['MTD','QTD','YTD',siLabel];
  const portVals=[portfolioMTD,portfolioQTD,portfolioYTD,portfolioSI??simplePnlPct].map(v=>v??0);
  const bmkVals=[bmkMTD,bmkQTD,bmkYTD,bmkSI].map(v=>v??0);
  const barCtx=document.getElementById('perfChart');
  if(perfBarChart)perfBarChart.destroy();
  perfBarChart=new Chart(barCtx,{
    type:'bar',
    data:{
      labels:barLabels,
      datasets:[
        {label:'Portfolio',data:portVals,backgroundColor:'rgba(59,130,246,0.75)',borderRadius:4},
        {label:bmkName,data:bmkVals,backgroundColor:'rgba(150,150,150,0.6)',borderRadius:4}
      ]
    },
    options:{
      responsive:true,
      plugins:{legend:{labels:{color:'#A0A0A0',font:{size:11}}}},
      scales:{
        y:{ticks:{color:'#666',callback:v=>v.toFixed(1)+'%'},grid:{color:'#222'}},
        x:{ticks:{color:'#A0A0A0'},grid:{display:false}}
      }
    }
  });

  // -- Metric cards — holdings only --
  const years=inceptionDate?((Date.now()-inceptionDate.getTime())/31557600000):null;
  const cagr=years&&years>0&&netContributed>0?((Math.pow(curValue/netContributed,1/years)-1)*100):null;
  document.getElementById('perfMetrics').innerHTML=`
    <div class="metric"><div class="label">Portfolio Value</div><div class="val" style="color:var(--orange)">${fCr(curValue)}</div><div class="sub">${now.toLocaleDateString('en-IN')}</div></div>
    <div class="metric"><div class="label">Contribution</div><div class="val">${fCr(contribution)}</div></div>
    <div class="metric"><div class="label">Withdrawal</div><div class="val">${fCr(withdrawal)}</div></div>
    <div class="metric"><div class="label">Profit / Loss</div><div class="val" style="color:${profitLoss>=0?'var(--green)':'var(--red)'}">${fCr(profitLoss)}</div><div class="sub">${simplePnlPct!==null?fPct(simplePnlPct):''}</div></div>
    ${cagr!==null?`<div class="metric"><div class="label">CAGR (est.)</div><div class="val" style="color:${cagr>=0?'var(--green)':'var(--red)'}">${fPct(cagr)}</div><div class="sub">${years.toFixed(1)} yrs</div></div>`:''}
    <div class="metric"><div class="label">Holdings</div><div class="val">${myH.length}</div><div class="sub">stocks</div></div>
  `;

  // -- Portfolio value over time from factsheet snapshots --
  renderHoldingsValueChart(snaps);
}

function renderHoldingsValueChart(snaps){
  const ctx2=document.getElementById('monthlyChart');
  if(!snaps||!snaps.length){
    if(ctx2)ctx2.parentElement.style.display='none';
    return;
  }
  ctx2.parentElement.style.display='block';
  const secEl=ctx2.parentElement.querySelector('.sec2');
  if(secEl)secEl.textContent='Portfolio Value Over Time (Factsheet Uploads)';
  const labels=snaps.map(s=>s.date);
  const vals=snaps.map(s=>s.value/10000000);
  if(perfMonthlyChart)perfMonthlyChart.destroy();
  perfMonthlyChart=new Chart(ctx2,{
    type:'line',
    data:{labels,datasets:[{label:'Portfolio Value (Cr)',data:vals,borderColor:'#3B82F6',backgroundColor:'rgba(59,130,246,0.1)',fill:true,tension:0.3,pointRadius:4,pointBackgroundColor:'#3B82F6'}]},
    options:{
      responsive:true,
      plugins:{legend:{display:false}},
      scales:{
        y:{ticks:{color:'#666',callback:v=>v.toFixed(2)+' Cr'},grid:{color:'#222'}},
        x:{ticks:{color:'#666',maxRotation:45},grid:{display:false}}
      }
    }
  });
}

// == PDF DOWNLOAD ==
async function downloadPerfPDF(){
  const cf=document.getElementById('perfClient')?.value||'all';
  const client=cf!=='all'?clients.find(c=>c.id===cf):null;
  const clientName=client?client.name:'All Clients';
  const now=new Date();

  // Collect data
  const summaryRows=document.getElementById('perfSummaryBody')?.querySelectorAll('tr')||[];
  const irrRows=document.getElementById('perfIRRBody')?.querySelectorAll('tr')||[];

  // Build printable HTML
  const summaryHTML=Array.from(summaryRows).map(r=>`<tr>${Array.from(r.querySelectorAll('td')).map(td=>`<td style="padding:7px 12px;border-bottom:1px solid #eee;font-size:13px">${td.innerHTML}</td>`).join('')}</tr>`).join('');
  const irrHeaderCells=document.querySelectorAll('#perfIRRTable thead th');
  const irrHeaderHTML=Array.from(irrHeaderCells).map(th=>`<th style="background:#1a6b3a;color:#fff;padding:9px 14px;text-align:center;font-size:12px">${th.textContent}</th>`).join('');
  const irrBodyHTML=Array.from(irrRows).map(r=>`<tr>${Array.from(r.querySelectorAll('td')).map((td,i)=>`<td style="padding:9px 14px;border-bottom:1px solid #eee;text-align:${i===0?'left':'center'};font-size:12px">${td.textContent}</td>`).join('')}</tr>`).join('');

  const win=window.open('','_blank','width=900,height=700');
  win.document.write(`<!DOCTYPE html><html><head><title>Performance Report — ${clientName}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:0;padding:30px;color:#222;background:#fff}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a6b3a;padding-bottom:16px;margin-bottom:24px}
    .logo{font-size:22px;font-weight:800;color:#1a6b3a;letter-spacing:2px}
    .meta{text-align:right;font-size:12px;color:#555}
    h2{font-size:14px;font-weight:700;color:#1a6b3a;text-transform:uppercase;letter-spacing:1px;margin:20px 0 8px}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    td{padding:7px 12px;border-bottom:1px solid #eee;font-size:13px}
    th{padding:9px 14px;font-size:12px}
    .footer{margin-top:30px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:10px}
    @media print{body{padding:15px}.no-print{display:none}}
  </style></head><body>
  <div class="header">
    <div><div class="logo">ILIOS 72</div><div style="font-size:11px;color:#888;margin-top:4px">Alternative Capital</div></div>
    <div class="meta"><b>Performance Report</b><br>${clientName}<br>${now.toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}</div>
  </div>
  <h2>Portfolio Summary</h2>
  <table><tbody>${summaryHTML}</tbody></table>
  <h2>Performance (IRR)</h2>
  <table><thead><tr>${irrHeaderHTML}</tr></thead><tbody>${irrBodyHTML}</tbody></table>
  <div class="footer">Portfolio returns are after management fees and other expenses. Return over 1 year period are annualised. This report is generated for informational purposes only.</div>
  <div class="no-print" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;background:#1a6b3a;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600">🖨 Print / Save as PDF</button></div>
  
<!-- == FUND MANAGER MODAL == -->
<div class="mo" id="fundManagerMo">
  <div class="modal" style="max-width:680px">
    <div class="mt">
      <div>
        <div id="fmName" style="font-size:17px;font-weight:700;color:var(--text)"></div>
        <div id="fmStrategy" style="font-size:11px;color:var(--orange);font-family:var(--mono);margin-top:2px"></div>
      </div>
      <button class="mc" onclick="closeMo('fundManagerMo')">×</button>
    </div>

    <!-- PMS Quick Stats -->
    <div class="grid g4" id="fmStats" style="margin-bottom:16px;gap:8px"></div>

    <!-- Tabs inside modal -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:14px">
      <div class="tab active" id="fmTab1" onclick="switchFmTab(1)" style="padding:8px 16px;font-size:11px;cursor:pointer;border-bottom:2px solid var(--orange);color:var(--orange)">Fund Manager</div>
      <div class="tab" id="fmTab2" onclick="switchFmTab(2)" style="padding:8px 16px;font-size:11px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted)">Strategy</div>
      <div class="tab" id="fmTab3" onclick="switchFmTab(3)" style="padding:8px 16px;font-size:11px;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted)">Factsheet Status</div>
    </div>

    <div id="fmContent1" style="font-size:12px;line-height:1.7"></div>
    <div id="fmContent2" style="font-size:12px;line-height:1.7;display:none"></div>
    <div id="fmContent3" style="font-size:12px;line-height:1.7;display:none"></div>
  </div>
</div>


<!-- == PMS DETAIL READ MORE MODAL == -->
<div class="mo" id="pmsDetailMo">
  <div class="modal" style="max-width:720px">
    <div class="mt">
      <div>
        <div id="rmPmsName" style="font-size:17px;font-weight:700"></div>
        <div id="rmPmsStrat" style="font-size:11px;color:var(--orange);font-family:var(--mono);margin-top:2px"></div>
      </div>
      <button class="mc" onclick="closeMo('pmsDetailMo')">×</button>
    </div>
    <!-- Stat pills -->
    <div class="rm-stat-grid" id="rmStats"></div>
    <!-- Tabs -->
    <div class="rm-tabs">
      <div class="rm-tab active" onclick="rmTab(0)">👤 Fund Manager</div>
      <div class="rm-tab" onclick="rmTab(1)">📐 Strategy</div>
      <div class="rm-tab" onclick="rmTab(2)">📈 Performance</div>
      <div class="rm-tab" onclick="rmTab(3)">🏆 Awards</div>
    </div>
    <div class="rm-panel active" id="rmPanel0" style="max-height:52vh;overflow-y:auto"></div>
    <div class="rm-panel" id="rmPanel1" style="max-height:52vh;overflow-y:auto"></div>
    <div class="rm-panel" id="rmPanel2" style="max-height:52vh;overflow-y:auto"></div>
    <div class="rm-panel" id="rmPanel3" style="max-height:52vh;overflow-y:auto"></div>
  </div>
</div>

</body></html>`);
  win.document.close();
  setTimeout(()=>win.print(),600);
}

// == AUTO-REFRESH PRICES ==
let autoRefreshInterval=null;
function startAutoRefresh(){
  if(autoRefreshInterval)return;
  autoRefreshInterval=setInterval(()=>{
    const now=new Date();
    const h=now.getHours(),m=now.getMinutes();
    // Market hours: 9:15 AM to 3:30 PM IST (weekdays)
    const day=now.getDay();
    if(day>=1&&day<=5&&((h===9&&m>=15)||h>=10)&&(h<15||(h===15&&m<=30))){
      if(aoToken&&holdings.length>0){
        console.log('Auto-refreshing prices...');
        fetchLivePrices();
      }
    }
  },300000); // Every 5 minutes
}

// == RENDER ALL UPDATE ==
const origRenderAll=renderAll;
renderAll=function(){
  origRenderAll();
  renderPerformance();
  // Populate overview PMS dropdown fresh
  const dd=document.getElementById('overviewPmsFilter');
  if(dd)dd.innerHTML='<option value="all">All PMS — Combined</option>'+pmsList.map(p=>`<option value="${p.id}">${p.name} — ${p.strategy}</option>`).join('');
};


// ==================================================
// FACTSHEET MONITOR & FUND MANAGER DATA
// ==================================================

const PMS_FACTSHEET_CONFIG = {
  stallion: {
    fetchType: 'auto',
    liveEnabled: true,
    label: '🟢 AUTO — LIVE',
    badgeClass: 'bg',
    description: 'Direct PDF from stallionasset.com/regulatory — tries all naming variants',
    website: 'https://www.stallionasset.com',
    // Generates all URL variants to try for a given year+month (0-based)
    urlVariants: (y, m) => {
      const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const BASE  = 'https://www.stallionasset.com/regulatory/Stallion_Asset_Factsheet_';
      const SUFFIXES = ['', '_revised', '_revised_final', '_revised_revised', '_1'];
      const urls = [];
      for (const suf of SUFFIXES) {
        urls.push(BASE + FULL[m]  + '_' + y + suf + '.pdf');
        urls.push(BASE + SHORT[m] + '_' + y + suf + '.pdf');
      }
      return urls;
    },
    knownLatest: {
      url: 'https://www.stallionasset.com/regulatory/Stallion_Asset_Factsheet_July_2025.pdf',
      label: 'Stallion_Asset_Factsheet_July_2025.pdf',
      month: 'July 2025',
      returns: {r1m:7.56, r1y:15.31, r3y:39.14, r4y:32.43, r5y:25.90, rsi:28.02},
      sectors: {'Consumer Discretionary':38.1,'Financial Services':26.3,'Services':8.5,'Industrials':7.3,'Healthcare':5.7},
      capSplit: {'Large Cap':46.9,'Mid Cap':25.1,'Small Cap':24.7,'Cash':3.3},
      aum: 5800
    },
    fundManagers: [
      {name:'Amit Jeswani', title:'Founder & CIO', bg:'Founded Stallion Asset in 2018. Prior experience in equity research and portfolio management. Known for momentum + growth-at-reasonable-price strategy. Featured in CNBC, ET Now.', education:'B.Com, MBA Finance'},
      {name:'Behzad Bhiwandiwala', title:'Co-Founder & Portfolio Manager', bg:'Co-founded Stallion Asset. Expertise in small & mid cap equity analysis. Focus on identifying multi-bagger opportunities in high-growth sectors.', education:'CA, CFA'}
    ],
    strategy: 'Stallion Asset follows a concentrated growth equity approach, investing in companies with high earnings growth potential, strong capital allocation discipline, and identifiable business moats. The fund is sector-agnostic but has historically been overweight in consumer discretionary, technology, and financial services. Uses a momentum overlay — stocks in confirmed uptrends get higher allocation. Benchmark: S&P BSE 500 TRI. Typically 20–30 stocks.',
    awardHistory: ['Best PMS sub-100 Cr category 1Y Absolute Returns (PMS-AIF World) 2019','Star Performer PMS Bazaar 2019','Best PMS all categories 2Y Absolute Returns (PMS-AIF World) 2020']
  },
  negen: {
    liveEnabled: false,
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'Login required — upload PDF manually to Drive',
    fallbackUrl: 'https://www.negencapital.com',
    website: 'https://www.negencapital.com',
    fundManagers: [
      {name:'Negen Capital Team', title:'Portfolio Management Team', bg:'Negen Capital Services focuses on special situations and dynamic allocation. The firm manages both PMS and AIF (Category III) strategies. Their approach combines top-down macro with bottom-up stock selection. Exact fund manager details not publicly disclosed.', education:'Details not publicly available'}
    ],
    strategy: 'Negen Special Situations & Dynamic Allocation PMS targets undervalued companies undergoing corporate events — restructurings, management changes, sector tailwinds, or regulatory shifts. Dynamic allocation allows the fund to hold cash when opportunities are scarce. AUM: ~₹1,384 Cr. Benchmark: S&P BSE 500 TRI.',
    awardHistory: []
  },
  buoyant: {
    fetchType: 'auto',
    liveEnabled: true,
    label: '🟢 AUTO — LIVE',
    badgeClass: 'bg',
    description: 'Motilal FTP (always-latest) + buoyantcap.com WordPress uploads',
    website: 'https://www.buoyantcap.com',
    ftpUrl: 'https://ftp.motilaloswal.com/emailer/MutualFund/mutualfund/BuoyantFS.pdf',
    urlVariants: (y, m) => {
      const FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const BASE = 'https://www.buoyantcap.com/wp-content/uploads/';
      const mo   = String(m + 2).padStart(2,'0'); // upload folder is month+1 (posted next month)
      const mn   = FULL[m];
      return [
        'https://ftp.motilaloswal.com/emailer/MutualFund/mutualfund/BuoyantFS.pdf',
        BASE + y + '/' + mo + '/Buoyant-factsheet-' + mn + '-' + y + '-1.pdf',
        BASE + y + '/' + mo + '/Buoyant-factsheet-' + mn + '-' + y + '.pdf',
        BASE + y + '/' + mo + '/Buoyant-Factsheet-' + mn + '-' + y + '.pdf',
        BASE + y + '/' + String(m+1).padStart(2,'0') + '/Buoyant-factsheet-' + mn + '-' + y + '-1.pdf',
        BASE + y + '/' + String(m+1).padStart(2,'0') + '/Buoyant-factsheet-' + mn + '-' + y + '.pdf',
      ];
    },
    knownLatest: {
      url: 'https://ftp.motilaloswal.com/emailer/MutualFund/mutualfund/BuoyantFS.pdf',
      label: 'BuoyantFS.pdf — Motilal FTP (always latest)',
      month: 'March 2026',
      returns: {r1m:-0.78, r1y:8.11, r3y:18.92, r4y:20.98, r5y:20.92, rsi:20.64},
      sectors: {},
      capSplit: {},
      aum: 10812
    },
    fundManagers: [
      {name:'Jigar Mistry', title:'Co-Founder & Fund Manager', bg:'22+ years in equity investing. Prior Director of Research at HSBC. Also worked at Kotak and Goldman Sachs. B.Com, ACA, CFA (AIMR, US). Known for deep sector expertise across IT, FMCG, and industrials.', education:'B.Com, ACA, CFA-AIMR'},
      {name:'Sachin Khivasara', title:'Co-Founder & Portfolio Manager', bg:'24+ years. Prior Analyst at Nippon Mutual Fund, Edelweiss, Enam. B.Com, ACA, CWA. Expert in automobiles, engineering, capital goods and mid-caps. Disciplined stock selection with long-term valuation focus.', education:'B.Com, ACA, CWA'},
      {name:'Viral Berawala', title:'Co-CIO', bg:'25+ years including CIO at Essel Mutual Fund and Reliance Nippon Life Insurance. IIM-Ahmedabad alumnus and CA. Sector expertise: IT, FMCG, retail, oil & gas, real estate.', education:'CA, IIM-Ahmedabad'},
      {name:'Dipen Sheth', title:'Head of Research', bg:'33+ years across capital markets, consulting, tech, and institutional equity research. Led institutional equity research at HDFC Securities. Advised major Indian investors.', education:'Extensive capital markets background'}
    ],
    strategy: 'Buoyant Opportunities PMS is a flexi-cap, sector-agnostic, open-ended discretionary strategy focused on long-term equity wealth creation. Holds 25–30 stocks. Uses a "Core vs Satellite" framework — core positions in durable businesses, satellite in special opportunities. Non-model portfolio approach (each investor portfolio is customized). Progressive reduction in small-cap exposure since March 2024. Benchmark: BSE 500 TRI. CRISIL 5-star rated.',
    awardHistory: ['CRISIL 5-Star PMS Rating (Multicap)','Ranked Top 7 out of 65 Multicap schemes — 5-star CRISIL/PMS-Bazaar 2022']
  },
  abakkus: {
    liveEnabled: false,
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'No public PDF — upload manually',
    website: 'https://www.abakkus.in',
    fundManagers: [
      {name:'Sunil Singhania', title:'Founder & CIO', bg:'Legendary fund manager with 25+ years. Former CIO of Reliance Mutual Fund (now Nippon) where he managed over ₹1 lakh crore. Known for identifying multi-baggers in mid and small cap space. Founded Abakkus Asset Manager in 2018. One of India\'s most respected equity investors.', education:'CA, MBA'}
    ],
    strategy: 'Abakkus Diversified Alpha Approach invests across all market caps with a bias towards growth-oriented businesses. Focus on identifying "Hidden Champions" — companies with dominant market positions in niche segments. Bottom-up stock picking with quality and growth filters. Benchmark: Nifty 500 TRI.',
    awardHistory: ['Sunil Singhania awarded multiple times as Best Fund Manager in India']
  },
  sameeksha: {
    liveEnabled: false,
    fetchType: 'semi',
    label: '🟡 SEMI-AUTO',
    badgeClass: 'bo',
    description: 'Monthly blog posts — can scrape sameeksha.capital',
    website: 'https://sameeksha.capital',
    blogUrl: 'https://sameeksha.capital/category/pms-and-aif/',
    fundManagers: [
      {name:'Bhavin Shah', title:'Founder & Portfolio Manager', bg:'Rated #1 technology sector analyst in Institutional Investor polls for a decade. 20+ years experience. 7 years as MD & Global Head of Technology at JP Morgan. 6 years as Director & Head of Asia Pacific Technology at Credit Suisse. Founded Equirus Securities. Set up Sameeksha Capital to manage his personal savings in an institutional framework. MBA with Beta Gamma Sigma honors from University of Chicago Booth. Masters in Computer Engineering from UC.', education:'MBA (U Chicago Booth), MS Computer Engineering (UC)'}
    ],
    strategy: 'Sameeksha Capital follows a rules-based, process-driven, 140-point checklist approach. Market-cap agnostic — invests across large, mid, and small caps. Uses a unique valuation framework that differs from standard GARP — required rate of return varies by company size and risk. Does NOT follow model portfolio; each investor\'s portfolio is customized. Holds cash when no investible opportunity exists. Avoids illiquid small caps unless compensated with 20-25% CAGR expectation. Benchmark: S&P BSE 500 TRI. 10+ years track record.',
    awardHistory: ['#1 Technology Analyst — Institutional Investor (10 consecutive years)','PMS AIF World + IIM-A: Rank #2 Best PMS all categories 5Y risk-adjusted (2023)','PMS AIF World + IIM-A: Rank #2 Best PMS all categories 3Y risk-adjusted (2023)','50+ consecutive months of top-decile performance (as of 2025)']
  },
  hem_dream: {
    liveEnabled: false,
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'No public PDF — upload manually',
    website: 'https://www.hemsecurities.com',
    fundManagers: [
      {name:'Hem Securities PMS Team', title:'Portfolio Management Team', bg:'Hem Securities Limited is a SEBI-registered broker and portfolio manager. The DREAM Strategy focuses on Diversified Returns through Emerging Attractive Markets. Details of individual fund managers not prominently disclosed publicly.', education:'Details not publicly available'}
    ],
    strategy: 'DREAM (Diversified Returns through Emerging Attractive Markets) Strategy focuses on mid and small cap companies with strong growth potential. Sector diversified approach with active rebalancing. AUM: ~₹182 Cr. Benchmark: S&P BSE 500 TRI.',
    awardHistory: []
  },
  icici_pipe: {
    liveEnabled: false,
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'JS-heavy portal — upload manually',
    website: 'https://www.icicipruamc.com/pms',
    fundManagers: [
      {name:'Mrinal Singh', title:'CIO — PMS & AIF (ICICI Pru)', bg:'Veteran fund manager at ICICI Prudential AMC. Extensive experience managing large institutional equity portfolios. Known for value-oriented approach with quality filter. PIPE strategy identifies undervalued companies in sectors undergoing positive inflection.', education:'MBA, CA'}
    ],
    strategy: 'ICICI Prudential PMS PIPE (Private Investments in Public Equity) strategy targets companies undergoing positive business inflection — typically in out-of-favor sectors or companies with improving governance. Value with catalyst approach. One of the largest PMS AUMs in India at ~₹7,464 Cr. Benchmark: S&P BSE 500 TRI.',
    awardHistory: ['Part of ICICI Prudential AMC — India\'s one of largest asset managers']
  },
  renaissance: {
    liveEnabled: false,
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'Boutique — no public PDFs found',
    website: 'https://www.renaissanceinvestment.in',
    fundManagers: [
      {name:'Renaissance Investment Team', title:'Portfolio Management Team', bg:'Renaissance Investment Managers is a boutique PMS firm focused on mid and small cap opportunities in India. The "India Next" portfolio targets the next generation of market leaders. AUM: ~₹880 Cr.', education:'Details not publicly available'}
    ],
    strategy: 'Renaissance India Next Portfolio focuses on identifying the next generation of market leaders — companies in their growth phase that are likely to become large-caps over a 5-7 year horizon. Strong emphasis on earnings growth quality and management integrity. Benchmark: Nifty 500 TRI.',
    awardHistory: []
  },
  '2point2': {
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'Boutique — no public PDFs found',
    website: 'https://www.2point2capital.com',
    fundManagers: [
      {name:'Savi Jain', title:'Founder & Portfolio Manager', bg:'2Point2 Capital Advisors focuses on long-term value investing with a deep research orientation. The firm is known for concentrated, high-conviction portfolios. Boutique setup with significant own capital invested alongside client funds. AUM: ~₹1,985 Cr.', education:'Details not publicly available'}
    ],
    strategy: '2Point2 Long Term Value Fund employs a concentrated, patient, long-term value investing approach. Typically holds 15–20 high-conviction positions. Significant emphasis on business quality, management track record, and reinvestment opportunities. Will hold cash if opportunities are scarce. Benchmark: Nifty 500 TRI.',
    awardHistory: []
  },
  hem_sme: {
    liveEnabled: false,
    fetchType: 'manual',
    label: '🔴 MANUAL',
    badgeClass: 'br',
    description: 'No public PDF — upload manually',
    website: 'https://www.hemsecurities.com',
    fundManagers: [
      {name:'Hem Securities SME Team', title:'Portfolio Management Team', bg:'Hem Securities\' India Rising SME Stars strategy specifically targets BSE SME and NSE Emerge listed companies — India\'s emerging small and micro-cap universe. High-risk, high-potential growth strategy. AUM: ~₹91 Cr.', education:'Details not publicly available'}
    ],
    strategy: 'India Rising SME Stars is a high-conviction small/micro-cap strategy investing in SME-listed companies on BSE SME and NSE Emerge platforms. Targets early-stage growth companies before they migrate to mainboard. Very high risk — suitable only for sophisticated investors with 5+ year horizon. Benchmark: S&P BSE SmallCap TRI.',
    awardHistory: []
  }
};

// Factsheet check state stored in localStorage
const FS_STATE_KEY = 'i72_fs_state';
function loadFsState(){try{return JSON.parse(localStorage.getItem(FS_STATE_KEY)||'{}')}catch{return {}}}
function saveFsState(s){localStorage.setItem(FS_STATE_KEY,JSON.stringify(s))}

// == RENDER FACTSHEET STATUS GRID ==
function renderFactsheetPanel(){
  const grid = document.getElementById('fsStatusGrid');
  if(!grid) return;

  grid.innerHTML = pmsList.map(p => {
    const cfg = PMS_FACTSHEET_CONFIG[p.id] || {description:'No config found',website:'#'};

    return `<div class="card" style="transition:border-color .2s"
            onmouseenter="this.style.borderColor='var(--orange)'"
            onmouseleave="this.style.borderColor='var(--border)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="flex:1;min-width:0;margin-right:8px">
          <div style="font-weight:700;font-size:13px">${p.name}</div>
          <div style="font-size:10px;color:var(--blue);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.strategy}</div>
        </div>
        <span class="badge bo" style="flex-shrink:0">📂 MANUAL</span>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;font-family:var(--mono)">${cfg.description}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-o btn-sm" onclick="openFundManager('${p.id}')">👤 Fund Manager</button>
        <button class="btn btn-s btn-sm" onclick="showManualUploadTip('${p.id}')">📂 Upload Manually</button>
        <a href="${cfg.website||'#'}" target="_blank" style="text-decoration:none"><button class="btn btn-s btn-sm">🌐 Site</button></a>
      </div>
    </div>`;
  }).join('');
}

// == FUND MANAGER MODAL ==
function openFundManager(pmsId) {
  const p = pmsList.find(x => x.id === pmsId);
  const cfg = PMS_FACTSHEET_CONFIG[pmsId];
  if(!p || !cfg) return;

  document.getElementById('fmName').textContent = p.name;
  document.getElementById('fmStrategy').textContent = p.strategy;

  // Stats
  document.getElementById('fmStats').innerHTML = [
    {label:'AUM', val: p.aum ? '₹' + p.aum.toLocaleString('en-IN') + ' Cr' : '—'},
    {label:'1Y Return', val: fPct(p.r1y), color: (p.r1y||0)>=0?'var(--green)':'var(--red)'},
    {label:'3Y Return', val: fPct(p.r3y), color: (p.r3y||0)>=0?'var(--green)':'var(--red)'},
    {label:'Since Inception', val: fPct(p.rsi), color:'var(--orange)'}
  ].map(s => `<div class="metric card-sm"><div class="label">${s.label}</div><div class="val" style="font-size:16px;${s.color?'color:'+s.color:''}">${s.val}</div></div>`).join('');

  // Fund Manager tab
  const managers = cfg.fundManagers || [];
  document.getElementById('fmContent1').innerHTML = managers.map(m => `
    <div style="background:var(--card2);border-radius:var(--r2);padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--text)">${m.name}</div>
          <div style="font-size:10px;color:var(--orange);font-family:var(--mono);margin-top:2px">${m.title}</div>
        </div>
        <span class="badge bo" style="font-size:9px">${m.education}</span>
      </div>
      <div style="font-size:11px;color:var(--dim);line-height:1.6">${m.bg}</div>
    </div>
  `).join('') || '<div style="color:var(--muted)">Fund manager details not publicly available.</div>';

  // Awards if any
  if(cfg.awardHistory && cfg.awardHistory.length) {
    document.getElementById('fmContent1').innerHTML += `
      <div style="margin-top:12px">
        <div class="sec" style="margin-bottom:6px">Awards & Recognition</div>
        ${cfg.awardHistory.map(a=>`<div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:11px;color:var(--dim)">🏆 ${a}</div>`).join('')}
      </div>`;
  }

  // Strategy tab
  document.getElementById('fmContent2').innerHTML = `
    <div style="background:var(--card2);border-radius:var(--r2);padding:16px">
      <div class="sec" style="margin-bottom:10px">Investment Strategy</div>
      <div style="font-size:12px;color:var(--dim);line-height:1.7">${cfg.strategy || 'Strategy details not available.'}</div>
    </div>
    <div style="margin-top:12px;background:var(--card2);border-radius:var(--r2);padding:14px">
      <div class="sec" style="margin-bottom:8px">Factsheet Access</div>
      <span class="badge ${cfg.badgeClass}" style="margin-bottom:8px;display:inline-block">${cfg.label}</span>
      <div style="font-size:11px;color:var(--dim)">${cfg.description}</div>
      ${cfg.website?`<div style="margin-top:8px"><a href="${cfg.website}" target="_blank" style="color:var(--orange);font-size:11px">🌐 ${cfg.website}</a></div>`:''}
    </div>`;

  // Factsheet Status tab
  const fsState = loadFsState();
  const state = fsState[pmsId] || {};
  document.getElementById('fmContent3').innerHTML = `
    <div style="background:var(--card2);border-radius:var(--r2);padding:14px;margin-bottom:10px">
      <div class="sec" style="margin-bottom:8px">Factsheet Status</div>
      <div style="font-size:12px;color:var(--dim)">Fetch Method: <span class="badge ${cfg.badgeClass}">${cfg.label}</span></div>
      <div style="font-size:12px;color:var(--dim);margin-top:6px">Last Checked: ${state.lastChecked ? new Date(state.lastChecked).toLocaleString('en-IN') : 'Never'}</div>
      ${state.latestFactsheet ? `<div style="font-size:12px;color:var(--green);margin-top:6px">✓ Latest factsheet: ${state.latestFactsheet}</div>` : ''}
      ${state.isNew ? `<div style="margin-top:8px"><span class="badge bb">🔵 NEW FACTSHEET AVAILABLE</span></div>` : ''}
      ${state.error ? `<div style="font-size:11px;color:var(--red);margin-top:6px">⚠ ${state.error}</div>` : ''}
    </div>
    ${cfg.fetchType === 'manual' ? `
    <div style="background:var(--orangeBg);border:1px solid var(--orange);border-radius:var(--r2);padding:14px">
      <div style="font-weight:600;color:var(--orange);margin-bottom:6px">📂 How to Upload This Factsheet</div>
      <div style="font-size:11px;color:var(--dim);line-height:1.6">
        1. Visit <a href="${cfg.website||'#'}" target="_blank" style="color:var(--orange)">${cfg.website||'PMS website'}</a><br>
        2. Log in to your investor portal (if required)<br>
        3. Download the latest fact sheet PDF<br>
        4. Go to the <b>Upload Center</b> tab in this dashboard<br>
        5. Use "Upload Holdings (Factsheet)" to import the data
      </div>
    </div>` : ''}`;

  switchFmTab(1);
  openMo('fundManagerMo');
}

function switchFmTab(n) {
  [1,2,3].forEach(i => {
    const tab = document.getElementById('fmTab'+i);
    const content = document.getElementById('fmContent'+i);
    if(i===n){
      tab.style.borderBottomColor='var(--orange)';tab.style.color='var(--orange)';
      content.style.display='block';
    } else {
      tab.style.borderBottomColor='transparent';tab.style.color='var(--muted)';
      content.style.display='none';
    }
  });
}

function showManualUploadTip(pmsId) {
  const cfg = PMS_FACTSHEET_CONFIG[pmsId] || {};
  const p = pmsList.find(x=>x.id===pmsId);
  alert(`📂 ${p?.name}\n\nThis PMS requires manual upload.\n\n1. Visit: ${cfg.website||'PMS website'}\n2. Download the latest fact sheet PDF\n3. Go to Upload Center tab → Upload Holdings\n\nNote: ${cfg.description}`);
}

// == AI ANALYSIS — via server-side Edge Function ==
// No API key is ever typed into or stored in the browser. The real
// Mistral key lives only in Supabase's Edge Function secrets. This
// also means it survives refreshes for every user automatically,
// since there's nothing to persist client-side in the first place.
async function callAIProxy(systemPrompt, userPrompt, opts={}){
  if(typeof sb === 'undefined' || !sb.token){
    throw new Error('Your session has expired — please sign in again.');
  }
  const resp = await fetch(sb.url + '/functions/v1/ai-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': sb.key,
      'Authorization': 'Bearer ' + sb.token
    },
    body: JSON.stringify({
      systemPrompt,
      userPrompt,
      maxTokens: opts.maxTokens || 1200,
      temperature: opts.temperature != null ? opts.temperature : 0.3
    })
  });
  const data = await resp.json().catch(()=>({}));
  if(!resp.ok || data.error) throw new Error(data.error || 'AI request failed (' + resp.status + ')');
  return data.text || '';
}

async function analyzeFactsheet(pmsId) {
  const p   = pmsList.find(x=>x.id===pmsId);
  const cfg = PMS_FACTSHEET_CONFIG[pmsId] || {};
  const fsState = loadFsState();
  const st  = fsState[pmsId] || {};

  const card      = document.getElementById('fsAnalysisCard');
  const contentEl = document.getElementById('fsAnalysisContent');
  const titleEl   = document.getElementById('fsAnalysisTitle');
  const badgeEl   = document.getElementById('fsAnalysisBadge');

  card.style.display = 'block';
  titleEl.textContent = 'AI Analysis — ' + (p?.name || pmsId);
  badgeEl.textContent = 'AI — Generating...';
  contentEl.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">🤖 AI is analysing '
    + (p?.name||pmsId) + ' factsheet data — please wait...</div>';
  card.scrollIntoView({behavior:'smooth'});

  // Build rich context
  const ret      = st.returns  || {};
  const sectors  = st.sectors  || {};
  const capSplit = st.capSplit || {};
  const aum      = st.aum || p?.aum || 0;
  const fms      = (cfg.fundManagers||[]).map(m=>m.name+' ('+m.title+') — '+m.bg).join('\n  ');
  const sectorStr = Object.keys(sectors).length
    ? Object.entries(sectors).map(([k,v])=>k+': '+v+'%').join(', ')
    : 'Not available';
  const capStr = Object.keys(capSplit).length
    ? Object.entries(capSplit).map(([k,v])=>k+': '+v+'%').join(', ')
    : 'Not available';

  const context = [
    'PMS Name: '+(p?.name||''),
    'Strategy: '+(p?.strategy||''),
    'AUM: ₹'+aum.toLocaleString('en-IN')+' Cr',
    'Benchmark: '+(p?.bench||'BSE 500 TRI'),
    'Factsheet: '+(st.latestFactsheet||'Latest available'),
    'Period: '+(st.month||'Recent'),
    '',
    'RETURNS (net of fees, TWRR):',
    '  1M: '+(ret.r1m!=null?ret.r1m+'%':p?.r1m!=null?p.r1m+'%':'N/A'),
    '  1Y: '+(ret.r1y!=null?ret.r1y+'%':p?.r1y!=null?p.r1y+'%':'N/A'),
    '  3Y CAGR: '+(ret.r3y!=null?ret.r3y+'%':p?.r3y!=null?p.r3y+'%':'N/A'),
    '  5Y CAGR: '+(ret.r5y!=null?ret.r5y+'%':p?.r5y!=null?p.r5y+'%':'N/A'),
    '  Since Inception CAGR: '+(ret.rsi!=null?ret.rsi+'%':p?.rsi!=null?p.rsi+'%':'N/A'),
    '',
    'SECTOR ALLOCATION: '+sectorStr,
    'MARKET CAP SPLIT: '+capStr,
    '',
    'FUND MANAGERS:',
    '  '+(fms||'See website'),
    '',
    'INVESTMENT STRATEGY:',
    cfg.strategy||p?.strategy||'Not available'
  ].join('\n');

  const systemPrompt = 'You are a senior equity analyst at ILIOS 72 Alternative Capital, a boutique PMS advisory firm in India. You write crisp, professional analyst notes that interpret data rather than repeat it.';

  const userPrompt = `Based on the factsheet data below, write a concise professional analyst note in clean HTML (no markdown, no backticks).

${context}

Structure with five sections — use <b> for headers, 2-4 sentences each:
1. <b>Performance Assessment</b> — Interpret returns vs BSE 500 TRI. Highlight consistency or volatility.
2. <b>Portfolio Positioning</b> — What sector/cap allocation signals about the manager's current market view.
3. <b>Team & Process</b> — Manager quality and investment discipline in 2-3 lines.
4. <b>Client Fit</b> — Ideal investor profile (risk, horizon, ticket size).
5. <b>Analyst Verdict</b> — One sentence overall view with an outlook badge.

Use these inline badges where appropriate:
<span style="background:rgba(34,197,94,0.12);color:#22C55E;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">POSITIVE</span>
<span style="background:rgba(239,68,68,0.12);color:#EF4444;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">RISK</span>
<span style="background:rgba(232,115,26,0.12);color:#E8731A;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">WATCH</span>
<span style="background:rgba(59,130,246,0.12);color:#3B82F6;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">NEUTRAL</span>

Output pure HTML only. Do not repeat raw numbers — interpret them.`;

  try {
    let html = await callAIProxy(systemPrompt, userPrompt, {maxTokens:1200, temperature:0.3});

    // Strip any markdown fences if the model returned them
    html = html.replace(/^```html?\s*/i,'').replace(/\s*```$/,'').trim();

    contentEl.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">'
      + '<span class="badge bo" style="font-size:9px">AI — '+(p?.name||'')+' Analysis</span>'
      + '<span style="font-size:10px;color:var(--muted);font-family:var(--mono)">'+new Date().toLocaleString('en-IN')+'</span>'
      + '</div>'
      + '<div style="font-size:12px;line-height:1.75;color:var(--dim)">'+html+'</div>';
    badgeEl.textContent = 'Analysis Ready ✓';
    toast('AI analysis ready ✓');

  } catch(e) {
    contentEl.innerHTML = '<div style="color:var(--red);padding:12px">⚠ Error: '+e.message+'</div>';
    badgeEl.textContent = 'Error';
    toast('Analysis failed — ' + e.message);
  }
}

// -- Provider change: update placeholder text --
function onProviderChange(){
  const p   = document.getElementById('aiProvider')?.value;
  const inp = document.getElementById('aiApiKey');
  if(!inp) return;
  inp.placeholder = p==='mistral' ? 'Mistral key (console.mistral.ai)' : 'Claude key (sk-ant-...)';
}

// == RENDER FACTSHEET PANEL ON TAB SWITCH ==
const origTabSwitch = document.querySelectorAll ? null : null;

// == COMPARE TABLE — EXPANDABLE ROWS + READ MORE ==
let _expandedPmsId = null;

function renderCompare(){
  const fsState = loadFsState();
  document.getElementById('compareTbody').innerHTML = pmsList.map(p => {
    const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('en-IN') : '—';
    const cfg     = PMS_FACTSHEET_CONFIG[p.id] || {};
    const isNew   = fsState[p.id]?.isNew;
    const isExpanded = _expandedPmsId === p.id;
    const fms     = (cfg.fundManagers||[]).map(m=>m.name).join(', ') || '—';

    const mainRow = `<tr class="pms-main-row ${isExpanded?'pms-row-expanded':''}"
        style="cursor:pointer"
        onclick="togglePmsRow('${p.id}')">
      <td style="font-weight:600;font-size:12px">
        <span style="color:var(--orange);margin-right:6px;font-size:10px">${isExpanded?'-':'-'}</span>
        ${p.name}
        ${isNew?'<span class="badge bb" style="margin-left:6px;font-size:9px">NEW</span>':''}
      </td>
      <td style="color:var(--blue);font-size:11px">${p.strategy}</td>
      <td class="num">${p.aum?'₹'+p.aum.toLocaleString()+'Cr':'—'}</td>
      <td style="font-size:9px;color:var(--muted)">${p.bench||'—'}</td>
      <td class="num ${(p.r1m||0)>=0?'tg':'tr'}">${fPct(p.r1m)}</td>
      <td class="num ${(p.r3m||0)>=0?'tg':'tr'}">${fPct(p.r3m)}</td>
      <td class="num ${(p.r6m||0)>=0?'tg':'tr'}">${fPct(p.r6m)}</td>
      <td class="num ${(p.r1y||0)>=0?'tg':'tr'}">${fPct(p.r1y)}</td>
      <td class="num ${(p.r3y||0)>=0?'tg':'tr'}">${fPct(p.r3y)}</td>
      <td class="num ${(p.r4y||0)>=0?'tg':'tr'}">${fPct(p.r4y)}</td>
      <td class="num ${(p.r5y||0)>=0?'tg':'tr'}">${fPct(p.r5y)}</td>
      <td class="num" style="font-weight:700;color:var(--orange)">${fPct(p.rsi)}</td>
      <td style="font-size:9px;color:var(--muted);font-family:var(--mono)">${updated}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-s btn-sm" onclick="openPmsDetail('${p.id}')">📖 More</button>
          <button class="btn btn-s btn-sm" onclick="editPMS('${p.id}')">✎</button>
          <button class="btn btn-d btn-sm" onclick="deletePMS('${p.id}')">✕</button>
        </div>
      </td>
    </tr>`;

    // Expanded detail drawer row
    const drawerRow = isExpanded ? `<tr class="pms-detail-row">
      <td colspan="14">
        <div class="pms-detail-drawer">
          <div class="drawer-section">
            <div class="drawer-label">Fund Manager(s)</div>
            <div class="drawer-text">
              ${(cfg.fundManagers||[]).map(m=>`<b>${m.name}</b> — ${m.title}<br><span style="font-size:10px">${m.education||''}</span>`).join('<br><br>') || '—'}
            </div>
            <span class="read-more-link" onclick="openPmsDetail('${p.id}');rmTab(0)">Read full bio →</span>
          </div>
          <div class="drawer-section">
            <div class="drawer-label">Investment Strategy</div>
            <div class="drawer-text">${(cfg.strategy||'Strategy not available.').slice(0,220)}${(cfg.strategy||'').length>220?'…':''}</div>
            <span class="read-more-link" onclick="openPmsDetail('${p.id}');rmTab(1)">Read full strategy →</span>
          </div>
          <div class="drawer-section">
            <div class="drawer-label">Performance Snapshot</div>
            <div class="drawer-text">
              ${[
                ['1M', p.r1m], ['1Y', p.r1y], ['3Y', p.r3y], ['5Y', p.r5y], ['SI', p.rsi]
              ].filter(([,v])=>v!=null).map(([k,v])=>`<span class="perf-pill ${v>=0?'pos':'neg'}">${k}: ${v>=0?'+':''}${v.toFixed(2)}%</span>`).join('')}
              <br><span style="font-size:10px;color:var(--muted);margin-top:4px;display:block">Benchmark: ${p.bench||'—'} | AUM: ₹${(p.aum||0).toLocaleString()}Cr</span>
            </div>
            <span class="read-more-link" onclick="openPmsDetail('${p.id}');rmTab(2)">Full performance →</span>
          </div>
        </div>
      </td>
    </tr>` : '';

    return mainRow + drawerRow;
  }).join('');
}

function togglePmsRow(pmsId){
  _expandedPmsId = (_expandedPmsId === pmsId) ? null : pmsId;
  renderCompare();
}

// == PMS DETAIL READ MORE MODAL ==
function rmTab(n){
  document.querySelectorAll('.rm-tab').forEach((t,i)=>t.classList.toggle('active',i===n));
  document.querySelectorAll('.rm-panel').forEach((p,i)=>p.classList.toggle('active',i===n));
}

function openPmsDetail(pmsId){
  const p   = pmsList.find(x=>x.id===pmsId);
  const cfg = PMS_FACTSHEET_CONFIG[pmsId] || {};
  if(!p) return;

  document.getElementById('rmPmsName').textContent  = p.name;
  document.getElementById('rmPmsStrat').textContent = p.strategy;

  // Stat grid
  const stats = [
    {lbl:'AUM',        val:'₹'+(p.aum||0).toLocaleString('en-IN')+' Cr', color:'var(--orange)'},
    {lbl:'1M Return',  val:fPct(p.r1m),  color:(p.r1m||0)>=0?'var(--green)':'var(--red)'},
    {lbl:'1Y Return',  val:fPct(p.r1y),  color:(p.r1y||0)>=0?'var(--green)':'var(--red)'},
    {lbl:'3Y Return',  val:fPct(p.r3y),  color:(p.r3y||0)>=0?'var(--green)':'var(--red)'},
    {lbl:'5Y Return',  val:fPct(p.r5y),  color:(p.r5y||0)>=0?'var(--green)':'var(--red)'},
    {lbl:'Since Incep',val:fPct(p.rsi),  color:'var(--orange)'},
  ];
  document.getElementById('rmStats').innerHTML = stats.map(s=>
    `<div class="rm-stat"><div class="lbl">${s.lbl}</div><div class="val" style="color:${s.color}">${s.val}</div></div>`
  ).join('');

  // Panel 0 — Fund Managers
  const fms = cfg.fundManagers || [];
  document.getElementById('rmPanel0').innerHTML = fms.length
    ? fms.map(m=>`
        <div class="rm-manager-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:6px">
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--text)">${m.name}</div>
              <div style="font-size:10px;color:var(--orange);font-family:var(--mono)">${m.title}</div>
            </div>
            <span class="badge bo" style="font-size:9px">${m.education||'—'}</span>
          </div>
          <div style="font-size:11px;color:var(--dim);line-height:1.65">${m.bg||'—'}</div>
        </div>`).join('')
    : '<div style="color:var(--muted);padding:12px">Fund manager details not publicly available.</div>';

  // Panel 1 — Strategy
  document.getElementById('rmPanel1').innerHTML = `
    <div style="background:var(--card2);border-radius:var(--r);padding:14px;margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--orange);margin-bottom:8px">Investment Philosophy & Approach</div>
      <div style="font-size:12px;color:var(--dim);line-height:1.75">${cfg.strategy||'Strategy details not available.'}</div>
    </div>
    <div style="background:var(--card2);border-radius:var(--r);padding:14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--orange);margin-bottom:8px">Benchmark & Structure</div>
      <div style="font-size:12px;color:var(--dim)">
        <b>Benchmark:</b> ${p.bench||'—'}<br>
        <b>AUM:</b> ₹${(p.aum||0).toLocaleString('en-IN')} Cr<br>
        <b>SEBI Registration:</b> Portfolio Manager
      </div>
    </div>`;

  // Panel 2 — Performance
  const perfRows = [
    ['1 Month',        p.r1m,  null],
    ['3 Month',        p.r3m,  null],
    ['6 Month',        p.r6m,  null],
    ['1 Year',         p.r1y,  null],
    ['3 Year (CAGR)',  p.r3y,  null],
    ['4 Year (CAGR)',  p.r4y,  null],
    ['5 Year (CAGR)',  p.r5y,  null],
    ['Since Inception',p.rsi,  null],
  ].filter(([,v])=>v!=null);

  document.getElementById('rmPanel2').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px">
      <thead><tr>
        <th style="text-align:left;padding:8px 10px;background:var(--card2);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Period</th>
        <th style="text-align:right;padding:8px 10px;background:var(--card2);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Return</th>
        <th style="text-align:right;padding:8px 10px;background:var(--card2);font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">vs Benchmark</th>
      </tr></thead>
      <tbody>
        ${perfRows.map(([period,val])=>`
          <tr>
            <td style="padding:9px 10px;border-bottom:1px solid var(--border)">${period}</td>
            <td style="padding:9px 10px;border-bottom:1px solid var(--border);text-align:right;font-family:var(--mono);font-weight:700;color:${val>=0?'var(--green)':'var(--red)'}">${val>=0?'+':''}${val.toFixed(2)}%</td>
            <td style="padding:9px 10px;border-bottom:1px solid var(--border);text-align:right;font-size:10px;color:var(--muted)">Benchmark: ${p.bench||'—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="font-size:10px;color:var(--muted);padding:8px;background:var(--card2);border-radius:var(--r)">
      Returns are net of fees and expenses (TWRR). Returns over 1 year are annualised. Past performance is not indicative of future results.
    </div>`;

  // Panel 3 — Awards
  const awards = cfg.awardHistory || [];
  document.getElementById('rmPanel3').innerHTML = awards.length
    ? awards.map(a=>`<div style="padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;color:var(--dim)">🏆 ${a}</div>`).join('')
    : '<div style="color:var(--muted);padding:12px">No awards data available.</div>';

  rmTab(0);
  openMo('pmsDetailMo');
}

// Hook tab switching to render factsheet panel
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', function(){
    if(this.dataset.tab === 'factsheets') {
      setTimeout(renderFactsheetPanel, 50);
    }
  });
});

// Auto-check factsheets on load (silently update state)
setTimeout(async () => {
  const fsState = loadFsState();
  const now = new Date();
  // Only auto-check if we haven't checked today
  const lastGlobalCheck = localStorage.getItem('i72_fs_last_global_check');
  const isToday = lastGlobalCheck && new Date(lastGlobalCheck).toDateString() === now.toDateString();
  if(!isToday) {
    // Run silently in background for auto-fetchable ones
    for(const p of pmsList) {
      const cfg = PMS_FACTSHEET_CONFIG[p.id];
      if(cfg && cfg.latestUrl && !fsState[p.id]?.lastChecked) {
        fsState[p.id] = {lastChecked: now.toISOString(), latestFactsheet:'Awaiting manual check', isNew:false};
      }
    }
    saveFsState(fsState);
    localStorage.setItem('i72_fs_last_global_check', now.toISOString());
  }
}, 2000);


// ==============================================================
// FACTSHEET INTELLIGENCE — Full System
// ==============================================================

// -- Sub-tab switching (Manual Upload = 0, URL Monitor = 1) --
function fsiTab(n){
  [0,1].forEach(i=>{
    const tab = document.getElementById('fsiTab'+i);
    const panel = document.getElementById('fsiPanel'+i);
    if(!tab||!panel) return;
    if(i===n){
      tab.style.borderBottomColor='var(--orange)'; tab.style.color='var(--orange)'; tab.style.fontWeight='600';
      panel.style.display='block';
    } else {
      tab.style.borderBottomColor='transparent'; tab.style.color='var(--muted)'; tab.style.fontWeight='500';
      panel.style.display='none';
    }
  });
  if(n===0) renderManualHistory();
  if(n===1){ setTimeout(renderFactsheetPanel,50); }
}

// -- Populate manual PMS select --
function populateFsiPmsSelect(){
  const sel = document.getElementById('manualPmsSelect');
  if(!sel) return;
  sel.innerHTML = '<option value="">Select PMS...</option>' +
    pmsList.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
}


async function runFactsheetAI(entry, aiDiv, aiBadge, structDiv, holdingsElId, clientElId, entryId){
  const pms = pmsList.find(p=>p.id===entry.pmsId) || {};
  const clientsInPms = clients.filter(c=>c.pmsId===entry.pmsId);
  const holdingsInPms = holdings.filter(h=>h.pmsId===entry.pmsId);

  // Build client context
  const clientCtx = clientsInPms.map(c=>{
    const cHoldings = holdingsInPms.filter(h=>h.clientId===c.id);
    return `Client: ${c.name} | Amount: ₹${(c.amount||0).toLocaleString('en-IN')} | Risk: ${c.risk} | Holdings: ${cHoldings.length} stocks`;
  }).join('\n') || 'No clients linked to this PMS yet';

  const holdingsCtx = holdingsInPms.length
    ? holdingsInPms.slice(0,15).map(h=>`${h.stock}: ₹${(h.mktValue||0).toLocaleString('en-IN')} (${h.weight||0}%)`).join(', ')
    : 'No holdings uploaded yet';

  // Real factsheets (like a full monthly PDF) run to many pages — 4000 chars
  // was cutting off almost everything past the cover page. This gives the
  // model enough of the actual portfolio/holdings/commentary sections to
  // work with.
  // mistral-small-latest has a 256k-token context window (confirmed), so a
  // typical monthly factsheet (even a dense 20+ page one) fits comfortably
  // without truncation. The earlier 18,000-char limit was cutting off entire
  // fund sections on longer documents — this cap is just a sane ceiling for
  // unusually massive PDFs (e.g. annual reports), not a real constraint for
  // normal factsheets.
  const textSample = (entry.extractedText||'').slice(0,120000);

  // -- Pull the most recent stored snapshot for this PMS, if one exists --
  // This is what lets the AI actually compare "what changed" between this
  // factsheet and the last one analysed, instead of only describing a
  // single point in time.
  let prevSnapshotCtx = 'No previous snapshot on file — this is the first analysed factsheet for this PMS, so no month-over-month comparison is possible yet.';
  let prevSnapshotExists = false;
  try {
    const rows = await sb.from('factsheet_snapshots').select('*').eq('pms_id', entry.pmsId).order('captured_at',{ascending:false}).limit(1);
    if(rows && rows.length){
      const prev = rows[0];
      prevSnapshotExists = true;
      const prevHoldings = (prev.holdings||[]).map(h=>`${h.stock}: ${h.weight}%`).join(', ');
      prevSnapshotCtx = `Snapshot from ${prev.period||prev.captured_at}:\n${prevHoldings || 'No holdings recorded in that snapshot'}`;
    }
  } catch(e){
    console.error('Could not load previous factsheet snapshot:', e);
  }

  const extractionPrompt = `You are a professional PMS/mutual fund analyst. Below is text extracted from a ${entry.pmsName} factsheet PDF.

FACTSHEET TEXT:
${textSample || 'No text available — use PMS data below'}

PMS DATA ON FILE:
Name: ${pms.name||entry.pmsName}
AUM: ₹${(pms.aum||0).toLocaleString('en-IN')} Cr
Benchmark: ${pms.bench||'BSE 500 TRI'}
1M: ${pms.r1m||'N/A'}% | 1Y: ${pms.r1y||'N/A'}% | 3Y: ${pms.r3y||'N/A'}% | SI: ${pms.rsi||'N/A'}%

CLIENT PORTFOLIOS INVESTED IN THIS PMS:
${clientCtx}

CURRENT HOLDINGS ON FILE (your firm's clients):
${holdingsCtx}

PREVIOUS FACTSHEET HOLDINGS SNAPSHOT (for detecting what the fund manager changed):
${prevSnapshotCtx}

Respond with a JSON object ONLY (no markdown, no explanation) in this exact format:
{
  "factsheetSummary": {
    "pmsName": "",
    "period": "",
    "aum": "",
    "benchmark": "",
    "inceptionDate": ""
  },
  "fundManagers": [
    {"name": "", "role": "", "tenureNote": ""}
  ],
  "returns": [
    {"period": "", "fund": "", "benchmark": "", "alpha": ""}
  ],
  "topHoldings": [
    {"rank": 1, "stock": "", "sector": "", "weight": ""}
  ],
  "fullHoldings": [
    {"stock": "", "sector": "", "weight": ""}
  ],
  "sectorAllocation": [
    {"sector": "", "weight": ""}
  ],
  "marketCapSplit": [
    {"cap": "", "weight": ""}
  ],
  "keyHighlights": ["", "", ""],
  "managerCommentary": "",
  "portfolioMoves": [
    {"stock": "", "previousWeight": "", "currentWeight": "", "direction": "New Entry/Exited/Increased/Reduced", "changeAmount": "", "reason": ""}
  ],
  "holdingsImpact": {
    "summary": "",
    "stocksInPortfolio": [],
    "recommendation": ""
  },
  "clientImpact": [
    {"clientName": "", "impactLevel": "High/Medium/Low", "reason": "", "recommendation": ""}
  ],
  "analystNote": {
    "performanceView": "",
    "positioningView": "",
    "riskFlags": [],
    "opportunities": [],
    "overallVerdict": "",
    "verdictBadge": "POSITIVE/NEUTRAL/CAUTIOUS/NEGATIVE"
  }
}

IMPORTANT RULES:
- "sectorAllocation" and "marketCapSplit" are often drawn as pie/bar charts in the original PDF, which means the text extraction may pull out all the sector/cap NAMES as one cluster and all their PERCENTAGES as a separate cluster elsewhere in the text, rather than side by side. If you find a list of sector or cap names and a separate list of percentages that are the SAME COUNT and appear in a consistent chart-legend order, pair them positionally in that order. Only do this when the counts match exactly — if you cannot confidently tell which percentage belongs to which name, leave the field as "Not available" rather than guessing.
- "returns": include EVERY period actually shown in the factsheet's returns table (e.g. 7 Days, 15 Days, 30 Days, 1 Month, 3 Months, 6 Months, 1 Year, Since Inception — whatever the document actually shows), not a fixed list. Use the fund's own numbers, not the benchmark's, unless labeled otherwise.
- "fullHoldings": list EVERY stock/holding disclosed in the portfolio table with its exact % of net assets, not just the top 10. This is used for accurate holdings comparison — do not summarize or truncate it.
- "fundManagers": extract the actual named fund manager(s) and their stated role (Equity / Fixed Income / etc.) and how long they've managed the scheme, if stated.
- "portfolioMoves": ${prevSnapshotExists
    ? 'Compare the PREVIOUS FACTSHEET HOLDINGS SNAPSHOT above against the fullHoldings you just extracted. List every stock that is new, fully exited, or whose weight changed by more than 0.3 percentage points, with the exact before/after weights and the change amount.'
    : 'There is no previous snapshot to compare against (see note above) — return this as an empty array.'}
- For the "reason" field in portfolioMoves: ONLY state a reason if the factsheet's own commentary, market overview, or outlook sections explicitly discuss that stock or its sector. If no such explicit discussion exists in the text, write exactly "Not explicitly disclosed by the fund manager in this factsheet" — never invent or guess a rationale that isn't grounded in the actual text provided.
- For holdingsImpact.stocksInPortfolio, cross-reference the fullHoldings against your firm's current holdings on file: [${holdingsCtx}]
- For clientImpact, assess each client based on their investment amount and risk profile.
- Fill every field using actual numbers/names from the factsheet text. Use "Not available" only where the text genuinely doesn't cover something — never fabricate a figure.`;

  try {
    aiBadge.textContent = 'Extracting...';
    const responseText = await callAIProxy(null, extractionPrompt, {maxTokens:7000, temperature:0.1});

    // Parse JSON response
    const clean = responseText.replace(/^```json?\s*/i,'').replace(/```$/,'').trim();
    const data = JSON.parse(clean);

    // Save this factsheet's full holdings as the new snapshot, so the
    // NEXT factsheet analysed for this PMS can detect what changed.
    if(data.fullHoldings && data.fullHoldings.length){
      try {
        await sb.from('factsheet_snapshots').insert({
          id: uid(),
          pms_id: entry.pmsId,
          period: data.factsheetSummary?.period || new Date().toISOString(),
          holdings: data.fullHoldings,
          manager_name: (data.fundManagers||[]).map(m=>m.name).filter(Boolean).join(', ')
        });
      } catch(e){
        console.error('Could not save factsheet snapshot:', e);
      }
    }

    // Render structured tables
    structDiv.innerHTML = renderStructuredFactsheet(data, entry.pmsId);

    // Render impact sections
    renderHoldingsImpactFromData(data, holdingsElId);
    renderClientImpactFromData(data, clientElId);

    // Render analyst note
    const note = data.analystNote||{};
    const badgeColors = {POSITIVE:'var(--green)',NEUTRAL:'var(--blue)',CAUTIOUS:'var(--orange)',NEGATIVE:'var(--red)'};
    const bc = badgeColors[note.verdictBadge]||'var(--orange)';
    aiDiv.innerHTML = `
      <div style="margin-bottom:14px">
        <span style="background:rgba(0,0,0,0.2);color:${bc};padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid ${bc}">${note.verdictBadge||'NEUTRAL'}</span>
      </div>
      ${note.performanceView?`<div style="margin-bottom:12px"><b style="color:var(--text)">Performance:</b> ${note.performanceView}</div>`:''}
      ${note.positioningView?`<div style="margin-bottom:12px"><b style="color:var(--text)">Positioning:</b> ${note.positioningView}</div>`:''}
      ${(note.riskFlags||[]).length?`<div style="margin-bottom:12px"><b style="color:var(--red)">⚠ Risk Flags:</b><ul style="margin:6px 0 0 18px">${note.riskFlags.map(r=>`<li style="margin-bottom:4px">${r}</li>`).join('')}</ul></div>`:''}
      ${(note.opportunities||[]).length?`<div style="margin-bottom:12px"><b style="color:var(--green)">✓ Opportunities:</b><ul style="margin:6px 0 0 18px">${note.opportunities.map(o=>`<li style="margin-bottom:4px">${o}</li>`).join('')}</ul></div>`:''}
      ${note.overallVerdict?`<div style="margin-top:14px;padding:12px 16px;background:var(--card2);border-radius:var(--r);border-left:3px solid ${bc}"><b style="color:var(--text)">Verdict:</b> ${note.overallVerdict}</div>`:''}`;

    aiBadge.textContent = 'Analysis Ready ✓';
    entry.aiAnalysis = aiDiv.innerHTML;
    toast('Analysis complete ✓');

  } catch(e){
    aiDiv.innerHTML=`<div style="color:var(--red)">Error: ${e.message}</div>`;
    aiBadge.textContent='Error';
    toast('Analysis failed — '+e.message);
  }
}

// ==============================================================
// RENDER STRUCTURED FACTSHEET (tables + bullets)
// ==============================================================
function renderStructuredFactsheet(data, pmsId){
  if(!data) return '<div style="color:var(--muted);padding:16px">No structured data available</div>';

  const s = data.factsheetSummary||{};
  const managers = data.fundManagers||[];
  const returns = data.returns||[];
  const fullHoldings = data.fullHoldings||[];
  const holdings = fullHoldings.length ? fullHoldings : (data.topHoldings||[]);
  const moves = data.portfolioMoves||[];
  const sectors = data.sectorAllocation||[];
  const caps = data.marketCapSplit||[];
  const highlights = data.keyHighlights||[];
  const commentary = data.managerCommentary||'';

  const fPct = v => v && v!==''&&v!=='N/A' ? v+(String(v).includes('%')?'':' %') : '—';
  const alphaColor = v => {
    if(!v||v==='—'||v==='N/A') return 'var(--muted)';
    const n = parseFloat(String(v).replace('%',''));
    return n>0?'var(--green)':n<0?'var(--red)':'var(--dim)';
  };
  const moveBadge = dir => {
    if(dir==='New Entry') return '<span class="badge bb">New Entry</span>';
    if(dir==='Exited') return '<span class="badge br">Exited</span>';
    if(dir==='Increased') return '<span class="badge bg">Increased</span>';
    if(dir==='Reduced') return '<span class="badge bo">Reduced</span>';
    return `<span class="badge bo">${dir||'—'}</span>`;
  };

  return `
    <!-- Summary card -->
    <div class="card" style="margin-bottom:14px">
      <div class="sec">📋 Factsheet Summary</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${[['PMS',s.pmsName||'—'],['Period',s.period||'—'],['AUM',s.aum||'—'],['Benchmark',s.benchmark||'—'],['Inception',s.inceptionDate||'—']]
          .map(([l,v])=>`<div style="background:var(--card2);border-radius:var(--r);padding:10px 12px">
            <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">${l}</div>
            <div style="font-size:12px;font-weight:600;color:var(--text)">${v}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Fund Manager(s) -->
    ${managers.length?`
    <div class="card" style="margin-bottom:14px">
      <div class="sec">👤 Fund Manager${managers.length>1?'s':''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${managers.map(m=>`<div style="background:var(--card2);border-radius:var(--r);padding:10px 12px">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${m.name||'—'}</div>
          <div style="font-size:11px;color:var(--orange);margin-top:2px">${m.role||''}</div>
          ${m.tenureNote?`<div style="font-size:11px;color:var(--dim);margin-top:4px">${m.tenureNote}</div>`:''}
        </div>`).join('')}
      </div>
    </div>`:''}

    <!-- Returns table -->
    ${returns.length?`
    <div class="card" style="margin-bottom:14px;padding:0;overflow-x:auto">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)"><div class="sec" style="margin:0">📈 Returns (Net of Fees)</div></div>
      <table style="min-width:500px">
        <thead><tr>
          <th>Period</th>
          <th style="text-align:right">Fund</th>
          <th style="text-align:right">Benchmark</th>
          <th style="text-align:right">Alpha</th>
        </tr></thead>
        <tbody>
          ${returns.filter(r=>r.fund&&r.fund!=='').map(r=>`<tr>
            <td style="font-weight:500">${r.period}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:700;color:${parseFloat(String(r.fund).replace('%',''))>=0?'var(--green)':'var(--red)'}">${fPct(r.fund)}</td>
            <td style="text-align:right;font-family:var(--mono);color:var(--dim)">${fPct(r.benchmark)}</td>
            <td style="text-align:right;font-family:var(--mono);font-weight:600;color:${alphaColor(r.alpha)}">${r.alpha||'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`:''}

    <!-- Portfolio Moves (month-over-month) -->
    <div class="card" style="margin-bottom:14px;padding:0;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div class="sec" style="margin:0">🔄 Portfolio Moves This Period</div>
        ${moves.length?`<span class="badge bo">${moves.length} change${moves.length!==1?'s':''} detected</span>`:''}
      </div>
      ${moves.length?`
      <div style="overflow-x:auto">
        <table style="min-width:600px">
          <thead><tr>
            <th>Stock</th><th style="text-align:right">Prev Wt%</th><th style="text-align:right">Curr Wt%</th>
            <th style="text-align:right">Change</th><th>Move</th><th>Reason (from factsheet)</th>
          </tr></thead>
          <tbody>${moves.map(m=>`<tr>
            <td style="font-weight:600;font-size:12px">${m.stock||'—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:11px;color:var(--muted)">${m.previousWeight||'—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:11px">${m.currentWeight||'—'}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:11px;font-weight:600">${m.changeAmount||'—'}</td>
            <td>${moveBadge(m.direction)}</td>
            <td style="font-size:11px;color:var(--dim);max-width:260px">${m.reason||'—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`:`<div style="padding:16px;font-size:12px;color:var(--muted)">
        ${fullHoldings.length ? 'No previous factsheet on file for this PMS yet, so there\'s nothing to compare against — portfolio move tracking starts from the next factsheet analysed for this PMS.' : 'No holdings data available to compare.'}
      </div>`}
    </div>

    <!-- Full Holdings + Sector + Cap -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      ${holdings.length?`
      <div class="card" style="padding:0;overflow:hidden;grid-column:1 / -1">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div class="sec" style="margin:0">🏦 Portfolio Holdings</div>
          <span style="font-size:10px;color:var(--muted)">${holdings.length} holdings</span>
        </div>
        <div style="max-height:320px;overflow-y:auto">
          <table>
            <thead><tr><th>Stock</th><th>Sector</th><th style="text-align:right">Wt%</th></tr></thead>
            <tbody>${holdings.map(h=>`<tr>
              <td style="font-size:11px;font-weight:500">${h.stock}</td>
              <td style="font-size:10px;color:var(--muted)">${h.sector||''}</td>
              <td style="text-align:right;font-family:var(--mono);font-size:11px">${h.weight||'—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`:''}

      ${sectors.length?`
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border)"><div class="sec" style="margin:0">🏭 Sector Allocation</div></div>
        <table>
          <thead><tr><th>Sector</th><th style="text-align:right">Wt%</th></tr></thead>
          <tbody>${sectors.map(s=>`<tr>
            <td style="font-size:11px">${s.sector}</td>
            <td style="text-align:right">
              <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
                <span style="font-family:var(--mono);font-size:11px">${s.weight}</span>
                <div style="width:50px;height:5px;background:var(--border);border-radius:2px">
                  <div style="width:${Math.min(parseFloat(s.weight)||0,100)}%;height:100%;background:var(--orange);border-radius:2px"></div>
                </div>
              </div>
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`:'<div></div>'}

      ${caps.length?`
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border)"><div class="sec" style="margin:0">📊 Market Cap Split</div></div>
        <table>
          <thead><tr><th>Cap</th><th style="text-align:right">Wt%</th></tr></thead>
          <tbody>${caps.map(c=>`<tr>
            <td style="font-size:11px">${c.cap}</td>
            <td style="text-align:right;font-family:var(--mono);font-size:11px">${c.weight}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`:'<div></div>'}
    </div>

    <!-- Key Highlights -->
    ${highlights.length?`
    <div class="card" style="margin-bottom:14px">
      <div class="sec">💡 Key Highlights from Factsheet</div>
      <ul style="margin:0;padding-left:18px">
        ${highlights.map(h=>`<li style="font-size:12px;color:var(--dim);margin-bottom:6px;line-height:1.6">${h}</li>`).join('')}
      </ul>
    </div>`:''}

    <!-- Manager Commentary -->
    ${commentary?`
    <div class="card" style="margin-bottom:14px">
      <div class="sec">💬 Manager Commentary</div>
      <div style="font-size:12px;color:var(--dim);line-height:1.7;font-style:italic">"${commentary}"</div>
    </div>`:''}
  `;
}

// ==============================================================
// HOLDINGS IMPACT
// ==============================================================
function renderHoldingsImpact(pmsId, elId, structuredData){
  const el = document.getElementById(elId);
  if(!el) return;
  if(structuredData){ renderHoldingsImpactFromData(structuredData, elId); return; }
  const h = holdings.filter(x=>x.pmsId===pmsId);
  if(!h.length){ el.innerHTML='<div style="color:var(--muted)">No holdings uploaded for this PMS yet. Upload holdings in the Upload Center tab first.</div>'; return; }
  el.innerHTML=`<div style="color:var(--muted)">Run AI analysis to see holdings impact.</div>`;
}

function renderHoldingsImpactFromData(data, elId){
  const el = document.getElementById(elId);
  if(!el||!data) return;
  const impact = data.holdingsImpact||{};
  const stocksInPort = impact.stocksInPortfolio||[];

  el.innerHTML = `
    ${impact.summary?`<div style="font-size:12px;color:var(--dim);margin-bottom:12px;padding:10px 14px;background:var(--card2);border-radius:var(--r)">${impact.summary}</div>`:''}
    ${stocksInPort.length?`
    <div style="margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--orange);margin-bottom:8px">Stocks from factsheet in your portfolio</div>
      <table>
        <thead><tr><th>Stock</th><th>Factsheet Weight</th><th>Your Exposure</th><th>Change Signal</th></tr></thead>
        <tbody>${stocksInPort.map(s=>`<tr>
          <td style="font-weight:600;font-size:12px">${s.stock||s.name||'—'}</td>
          <td style="font-family:var(--mono);font-size:11px">${s.factsheetWeight||s.weight||'—'}</td>
          <td style="font-family:var(--mono);font-size:11px">${s.yourExposure||s.exposure||'—'}</td>
          <td><span class="badge ${s.signal==='Increased'?'bg':s.signal==='Decreased'?'br':'bo'}">${s.signal||'—'}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`:'<div style="font-size:12px;color:var(--muted);margin-bottom:10px">No overlap detected between factsheet holdings and your portfolio holdings.</div>'}
    ${impact.recommendation?`<div style="font-size:12px;padding:10px 14px;background:var(--orangeBg);border-radius:var(--r);color:var(--orange);border:1px solid rgba(232,115,26,0.3)"><b>Recommendation:</b> ${impact.recommendation}</div>`:''}
  `;
}

// ==============================================================
// CLIENT IMPACT
// ==============================================================
function renderClientImpact(pmsId, elId, structuredData){
  const el = document.getElementById(elId);
  if(!el) return;
  const clientsInPms = clients.filter(c=>c.pmsId===pmsId);
  if(!clientsInPms.length){ el.innerHTML='<div style="color:var(--muted)">No clients linked to this PMS. Add clients in the Clients tab first.</div>'; return; }
  if(structuredData){ renderClientImpactFromData(structuredData, elId); return; }
  el.innerHTML='<div style="color:var(--muted)">Run AI analysis to see client-specific impact.</div>';
}

function renderClientImpactFromData(data, elId){
  const el = document.getElementById(elId);
  if(!el||!data) return;
  const clientImpacts = data.clientImpact||[];
  if(!clientImpacts.length){ el.innerHTML='<div style="color:var(--muted)">No client impact data generated.</div>'; return; }

  const impactBadge = lvl => {
    if(lvl==='High') return '<span class="badge br">High Impact</span>';
    if(lvl==='Medium') return '<span class="badge bo">Medium Impact</span>';
    return '<span class="badge bg">Low Impact</span>';
  };

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Client</th>
        <th>Impact Level</th>
        <th>Reason</th>
        <th>Recommendation</th>
      </tr></thead>
      <tbody>${clientImpacts.map(c=>`<tr>
        <td style="font-weight:600;font-size:12px">${c.clientName||'—'}</td>
        <td>${impactBadge(c.impactLevel)}</td>
        <td style="font-size:11px;color:var(--dim)">${c.reason||'—'}</td>
        <td style="font-size:11px;color:var(--dim)">${c.recommendation||'—'}</td>
      </tr>`).join('')}</tbody>
    </table>
  `;
}

// ==============================================================
// MANUAL UPLOAD & ANALYSIS
// ==============================================================
const MANUAL_KEY = 'i72_fsi_manual';
function manualLoad(){ try{ return JSON.parse(localStorage.getItem(MANUAL_KEY)||'[]'); }catch{ return []; } }
function manualSave(d){ localStorage.setItem(MANUAL_KEY, JSON.stringify(d)); }

// ==============================================================
// SHARED PDF TEXT EXTRACTION — layout-aware (reconstructs rows)
// ------------------------------------------------
// A PDF has no real concept of "line breaks" for tables — each cell is
// just text floating at an (x,y) position on the page. Naively joining
// every text item left-to-right in stream order runs whole table rows
// together with no separator at all (e.g. a quantity like "1,119"
// gets glued directly onto the next row's "Buy", producing "1,119Buy").
// That breaks any line-based parser downstream.
//
// This groups text items by their actual Y position on the page (i.e.
// which visual row they belong to), then orders items left-to-right by
// X position within that row — reconstructing real, separate lines the
// way a human reads the table, not just raw stream order.
// ==============================================================
async function extractPdfTextLayoutAware(file, onProgress){
  if(typeof pdfjsLib === 'undefined'){
    throw new Error('PDF reader library did not load — refresh the page and try again');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for(let pageNum=1; pageNum<=pdf.numPages; pageNum++){
    if(onProgress) onProgress(pageNum, pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // IMPORTANT: item.transform is in the PDF's raw, unrotated internal
    // coordinate space. Some documents (like tables exported in landscape)
    // store pages with a rotation flag — reading raw coordinates on those
    // pages puts every item at the same X with scattered Y values (columns
    // misread as rows). Applying the page's own viewport transform corrects
    // for this, the same way PDF.js corrects it when actually rendering the
    // page on screen.
    const viewport = page.getViewport({ scale: 1 });
    const rowMap = {};
    textContent.items.forEach(item=>{
      const t = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const x = t[4], y = t[5];
      const key = Math.round(y / 3) * 3;
      if(!rowMap[key]) rowMap[key] = [];
      rowMap[key].push({ str: item.str, x });
    });

    const sortedYs = Object.keys(rowMap).map(Number).sort((a,b)=>a-b);
    for(const y of sortedYs){
      const rowItems = rowMap[y].sort((a,b)=>a.x-b.x);
      const rowText = rowItems.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
      if(rowText) fullText += rowText + '\n';
    }
    fullText += '\n';
  }
  return { text: fullText.trim(), numPages: pdf.numPages };
}

// Generic PDF -> paste-area extractor, used by Upload Center's Holdings
// and Transactions cards.
async function handlePdfToPaste(event, targetElId){
  const file = event.target.files[0];
  if(!file) return;
  const targetEl = document.getElementById(targetElId);
  if(!targetEl) return;
  const original = targetEl.textContent;
  targetEl.textContent = '⏳ Reading PDF...';

  try {
    const { text: fullText } = await extractPdfTextLayoutAware(file, (p,total)=>{
      targetEl.textContent = `⏳ Extracting page ${p} of ${total}...`;
    });

    if(!fullText){
      targetEl.textContent = original;
      toast('No selectable text found in this PDF — it may be scanned. Paste the table manually instead.', 'r');
      return;
    }

    targetEl.textContent = fullText;
    toast('PDF text loaded — review it, then click Parse & Preview ✓');
  } catch(e){
    console.error('PDF extraction failed:', e);
    targetEl.textContent = original;
    toast('Could not read this PDF — ' + e.message, 'r');
  } finally {
    event.target.value = ''; // allow re-selecting the same file later
  }
}

async function handleManualPdfUpload(event){
  const file = event.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('manualUploadStatus');
  statusEl.textContent = '⏳ Reading PDF...';

  try {
    const { text: fullText, numPages } = await extractPdfTextLayoutAware(file, (p,total)=>{
      statusEl.textContent = `⏳ Extracting page ${p} of ${total}...`;
    });

    document.getElementById('manualPasteText').value = fullText;

    if(!fullText){
      statusEl.textContent = '⚠ No selectable text found in this PDF — it may be a scanned/image-based document. Please paste the text manually instead.';
    } else {
      statusEl.textContent = `✓ PDF loaded — ${file.name} (${numPages} page${numPages!==1?'s':''}, ${Math.round(fullText.length/1024)}KB text extracted)`;
    }
  } catch(e){
    console.error('PDF extraction failed:', e);
    statusEl.textContent = '❌ Could not read this PDF — '+e.message+'. Please paste the factsheet text manually instead.';
  }
}

async function runManualAnalysis(){
  const pmsId = document.getElementById('manualPmsSelect').value;
  const text  = document.getElementById('manualPasteText').value.trim();
  const statusEl = document.getElementById('manualUploadStatus');

  if(!pmsId){ toast('Select a PMS first'); return; }
  if(!text){ toast('Paste factsheet text or upload a PDF first'); return; }

  const pms = pmsList.find(p=>p.id===pmsId);
  statusEl.textContent = '🤖 Analysing...';

  const entry = {
    id: Date.now().toString(36),
    pmsId, pmsName: pms?.name||pmsId,
    filename: 'Manual Upload — '+new Date().toLocaleDateString('en-IN'),
    pdfUrl: '#',
    extractedText: text,
    receivedAt: new Date().toISOString(),
    analysed: false, structuredData: null, aiAnalysis: null
  };

  // Show result area
  const resultDiv = document.getElementById('manualAnalysisResult');
  resultDiv.style.display = 'block';
  resultDiv.scrollIntoView({behavior:'smooth'});

  const structDiv = document.getElementById('manualStructuredData');
  const holdEl    = document.getElementById('manualHoldingsImpact');
  const clientEl  = document.getElementById('manualClientImpact');
  const aiDiv     = document.getElementById('manualAiAnalysis');
  const aiBadge   = document.getElementById('manualAiBadge');

  structDiv.innerHTML='<div class="card" style="color:var(--muted);padding:16px">Extracting structured data from factsheet...</div>';
  holdEl.innerHTML='<div style="color:var(--muted)">Loading...</div>';
  clientEl.innerHTML='<div style="color:var(--muted)">Loading...</div>';
  aiDiv.innerHTML='<div style="color:var(--muted)">Generating analysis...</div>';
  aiBadge.textContent='Generating...';

  await runFactsheetAI(entry, aiDiv, aiBadge, structDiv, 'manualHoldingsImpact', 'manualClientImpact', null);

  // Save to manual history
  if(entry.structuredData){
    const hist = manualLoad();
    hist.unshift({...entry, aiAnalysis: aiDiv.innerHTML});
    if(hist.length>20) hist.pop();
    manualSave(hist);
    renderManualHistory();
  }
  statusEl.textContent = '✓ Analysis complete';
}

function renderManualHistory(){
  const el = document.getElementById('manualHistory');
  if(!el) return;
  const hist = manualLoad();
  if(!hist.length){ el.innerHTML='<div style="color:var(--muted);font-size:12px">No factsheets analysed yet.</div>'; return; }
  el.innerHTML = hist.map(h=>{
    const dt = new Date(h.receivedAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div>
        <div style="font-size:12px;font-weight:600">${h.pmsName}</div>
        <div style="font-size:10px;color:var(--muted)">${h.filename} — ${dt}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-s btn-sm" onclick="reloadManualEntry('${h.id}')">📊 View</button>
        <button class="btn btn-d btn-sm" onclick="deleteManualEntry('${h.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function deleteManualEntry(id){
  let h = manualLoad(); h=h.filter(x=>x.id!==id); manualSave(h); renderManualHistory();
}

function reloadManualEntry(id){
  const hist = manualLoad();
  const entry = hist.find(h=>h.id===id);
  if(!entry) return;
  const resultDiv = document.getElementById('manualAnalysisResult');
  resultDiv.style.display='block';
  document.getElementById('manualStructuredData').innerHTML = entry.structuredData ? renderStructuredFactsheet(entry.structuredData, entry.pmsId) : '<div style="color:var(--muted)">No data</div>';
  renderHoldingsImpactFromData(entry.structuredData||{}, 'manualHoldingsImpact');
  renderClientImpactFromData(entry.structuredData||{}, 'manualClientImpact');
  document.getElementById('manualAiAnalysis').innerHTML = entry.aiAnalysis||'<div style="color:var(--muted)">No analysis saved</div>';
  document.getElementById('manualAiBadge').textContent = 'Loaded ✓';
  resultDiv.scrollIntoView({behavior:'smooth'});
}

// Hook tab switch to populate PMS select
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', function(){
    if(this.dataset.tab==='factsheets'){
      setTimeout(()=>{ populateFsiPmsSelect(); fsiTab(0); }, 50);
    }
  });
});

// == INIT ==
if(aoToken){document.getElementById('aoStatus').textContent='✓ Session active';startAutoRefresh()}
