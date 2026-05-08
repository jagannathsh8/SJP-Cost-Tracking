"use strict";

var SHEET_COLORS = ['#f59e0b','#60a5fa','#22c55e','#a78bfa','#f87171','#38bdf8','#e879f9','#facc15','#4ade80','#fb923c','#818cf8','#2dd4bf'];
var SHEET_DATA = {};
var SHEET_REGISTRY = [];
var activeSheetId = '';
var builtPages = {};
var CI = {}; // Chart instances

// ── Registry & Initialization ──
function loadRegistry(){
  try { SHEET_REGISTRY = JSON.parse(localStorage.getItem('sjp_outlets')||'[]'); } catch(e){ SHEET_REGISTRY=[]; }
  activeSheetId = localStorage.getItem('sjp_active_outlet')||'';
  if(!activeSheetId && SHEET_REGISTRY.length) {
    var last = SHEET_REGISTRY[SHEET_REGISTRY.length-1];
    var tabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === last.id; });
    if(tabs.length) activeSheetId = tabs[tabs.length-1];
  }
}
function saveRegistry(){
  localStorage.setItem('sjp_outlets', JSON.stringify(SHEET_REGISTRY));
  localStorage.setItem('sjp_active_outlet', activeSheetId);
}

// ── Core Sync Logic ──
async function fetchOutletData(outletId, url){
  var fetchUrl = url + (url.indexOf('?') !== -1 ? '&' : '?') + '_t=' + Date.now();
  var r = await fetch(fetchUrl, { cache: 'no-store' });
  var json = await r.json();
  var parsedTabs = parseAppsScriptTabs(json);
  var savedKeys = [];
  Object.keys(parsedTabs).forEach(function(tabName){
    var compositeId = outletId + '__' + tabName;
    parsedTabs[tabName].id = compositeId;
    parsedTabs[tabName].outletId = outletId;
    parsedTabs[tabName].tabName = tabName;
    SHEET_DATA[compositeId] = parsedTabs[tabName];
    savedKeys.push(compositeId);
  });
  return savedKeys;
}

function parseAppsScriptTabs(json){
  if(json.status!=='success' || !json.tabs) throw new Error('Invalid multi-tab response');
  var parsedTabs = {};
  json.tabs.forEach(function(tab){
    if(tab.name.toUpperCase() === 'MIS') { window.MIS_DATA = tab.rawData; return; }
    if(tab.name.toLowerCase().indexOf('employee') !== -1) { window.TEAM_DATA = tab.data; return; }
    var data = tab.data; if(!data || !data.length) return;
    
    var keys = Object.keys(data[0]);
    var dateKeys = keys.filter(function(k){ return k!=='Particulars'&&k!=='Target'&&k!=='Run Rate'&&k!=='MTD'&&k!==''; });
    var findRow = function(name){ return data.find(function(x){ return x.Particulars&&x.Particulars.toLowerCase().indexOf(name.toLowerCase())!==-1; }); };
    var getVal = function(row,dKey){ return row&&row[dKey]!==''&&row[dKey]!=null?(parseFloat(row[dKey])||0):0; };
    
    var nd=[],nr=[],nrm=[],ncp=[],npk=[],nhk=[],ngu=[],ngv=[],nwq=[],nwv=[],npt=[];
    var revRow=findRow('Net Revenue'), rmRow=findRow('RM Indent'), cpRow=findRow('CP Indent');
    var pkRow=findRow('Packaging Indent'), hkRow=findRow('HK Materials');
    var guRow=findRow('Gail Gas consumption Unit'), gvRow=findRow('Gail gas consumption Value');
    var wqRow=findRow('Water consumption Unit'), wvRow=findRow('Water consumption Value');
    var ptRow=findRow('Petty cash');
    var tgt = 14200000;
    if(revRow&&revRow['Target']) tgt=parseFloat(revRow['Target'])||14200000;
    
    var dynamicRows = {}, TARGETS = {}, RUN_RATES = {}, MTDS = {};
    data.forEach(function(row){
        var p = row.Particulars; if(!p) return;
        TARGETS[p] = parseFloat(row['Target'])||0;
        RUN_RATES[p] = parseFloat(row['Run Rate'])||0;
        MTDS[p] = parseFloat(row['MTD'])||0;
        if(p==='Net Revenue' || p.indexOf('Indent')!==-1 || p.indexOf('HK')!==-1) return;
        dynamicRows[p] = [];
    });

    for(var i=0;i<dateKeys.length;i++){
      var dKey=dateKeys[i], rv=revRow?revRow[dKey]:'';
      if(rv===''||rv==null) continue;
      var parts=dKey.split('\n'), dStr = parts.length>1 ? parts[1] : parts[0];
      nd.push(dStr); nr.push(parseFloat(rv)||0); nrm.push(getVal(rmRow,dKey)); ncp.push(getVal(cpRow,dKey));
      npk.push(getVal(pkRow,dKey)); nhk.push(getVal(hkRow,dKey)); ngu.push(getVal(guRow,dKey)); ngv.push(getVal(gvRow,dKey));
      nwq.push(getVal(wqRow,dKey)); nwv.push(getVal(wvRow,dKey)); npt.push(getVal(ptRow,dKey));
      Object.keys(dynamicRows).forEach(function(dr){ dynamicRows[dr].push(getVal(findRow(dr), dKey)); });
    }
    parsedTabs[tab.name] = {
      DATES:nd, REV:nr, RM:nrm, CP:ncp, PKG:npk, HK:nhk, GASU:ngu, GASV:ngv, WATQ:nwq, WATV:nwv, PETTY:npt, 
      TARGET:tgt, MONTH_DAYS:nd.length, DYNAMIC: dynamicRows, TARGETS: TARGETS, RUN_RATES: RUN_RATES, MTDS: MTDS
    };
  });
  return parsedTabs;
}

// ── Application Logic ──
function switchActiveSheet(id){
  if(!SHEET_DATA[id]) return;
  applySheetToGlobals(id);
  var d = SHEET_DATA[id];
  var entry = SHEET_REGISTRY.find(function(s){return s.id===d.outletId;});
  document.getElementById('hdrTitle').innerHTML = (entry?entry.label:'Dashboard')+' - '+d.tabName;
  document.getElementById('hdrSub').textContent = 'MIS Dashboard \u00b7 '+DATES.length+' days \u00b7 Jagan';
  killAllCharts();
  builtPages = {};
  renderUI();
  var activeNav = document.querySelector('.nav-btn.active');
  var activePage = activeNav ? activeNav.getAttribute('data-page') : 'overview';
  setTimeout(function(){ buildPageCharts(activePage); }, 80);
}

function applySheetToGlobals(id){
  var d = SHEET_DATA[id]; if(!d) return;
  function inject(arr,vals){ if(!arr)return; arr.length=0; if(!vals)return; for(var i=0;i<vals.length;i++) arr.push(vals[i]); }
  inject(DATES,d.DATES); inject(REV,d.REV); inject(RM,d.RM); inject(CP,d.CP);
  inject(PKG,d.PKG); inject(HK,d.HK); inject(GASU,d.GASU); inject(GASV,d.GASV);
  inject(WATQ,d.WATQ); inject(WATV,d.WATV); inject(PETTY,d.PETTY);
  window.TARGET = d.TARGET; window.MONTH_DAYS = d.MONTH_DAYS;
  window.DYNAMIC_DATA = d.DYNAMIC||{}; window.TARGETS = d.TARGETS||{};
  window.RUN_RATES = d.RUN_RATES||{}; window.MTDS = d.MTDS||{};
  activeSheetId = id; saveRegistry();
}

// ── UI Rendering ──
function renderUI() {
  if(!REV.length) return;
  var m = calcMetrics();
  var prog = document.getElementById('revProgFill');
  if(prog) {
    var ach = m.totTgt > 0 ? (m.totRev/m.totTgt*100) : 0;
    prog.style.width = Math.min(ach, 100) + '%';
    document.getElementById('revAchText').textContent = 'Achieved: \u20b9' + fmtN(m.totRev);
    document.getElementById('revTargetText').textContent = 'Target: \u20b9' + fmtN(m.totTgt);
  }
  var dr = document.getElementById('hdrDays');
  if(dr) dr.textContent = 'Day '+REV.filter(v=>v>0).length+' of '+MONTH_DAYS;
  if(activeSheetId) { renderOverview(); if(window.renderMIS) renderMIS(); }
}

function renderOverview() {
  var m = calcMetrics();
  var kpiEl = document.getElementById('kpiGrid');
  if(kpiEl) {
    var todayVal = REV[REV.findLastIndex(v=>v>0)] || 0;
    var ach = m.totTgt > 0 ? (m.totRev/m.totTgt*100) : 0;
    kpiEl.innerHTML = [
      {l:'DAILY REVENUE', v:'\u20b9'+fmtN(todayVal), s:'Last entry', c:'var(--txt)'},
      {l:'MTD REVENUE',   v:'\u20b9'+fmtN(sum(REV)), s:'Actuals to date', c:'var(--blu)'},
      {l:'MTD TARGET',    v:'\u20b9'+fmtN(m.totTgt), s:ach.toFixed(1)+'% Achieved', c:'var(--red)'},
      {l:'SHEET RUN RATE',v:'\u20b9'+fmtN(m.totRev), s:'Official Projection', c:'var(--amb)'}
    ].map(function(k){
      return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div><div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div><div class="kpi-sub">'+k.s+'</div></div>';
    }).join('');
  }

  var tbl = document.getElementById('overviewMtdTbl');
  if(tbl) {
    var curCost = sum(RM)+sum(CP)+sum(PKG)+sum(GASV)+sum(WATV)+sum(PETTY);
    var rows = [
      {p:'Net Revenue', t:m.totTgt, r:m.totRev, a:sum(REV)},
      {p:'Total Costs', t:m.totTgt*0.7, r:m.totCost, a:curCost},
      {p:'Net Margin',  t:m.totTgt*0.3, r:m.totNOI, a:sum(REV)-curCost}
    ];
    tbl.innerHTML = rows.map(function(r){
      return '<tr><td style="font-weight:700;color:var(--txt)">'+r.p+'</td><td class="num">\u20b9'+fmtN(r.t)+'</td><td class="num">\u20b9'+fmtN(r.r)+'</td><td class="num">\u20b9'+fmtN(r.a)+'</td><td class="num" style="font-weight:700;color:var(--amb)">'+(m.totRev>0?(r.r/m.totRev*100).toFixed(1):'0')+'%</td></tr>';
    }).join('');
  }

  var dayObjs = DATES.map(function(d,i){ return {d:d, v:REV[i]}; }).filter(x=>x.v>0);
  var sorted = dayObjs.slice().sort((a,b)=>b.v-a.v);
  document.getElementById('top3Days').innerHTML = sorted.slice(0,3).map(x=>'<div class="day-row"><span>'+x.d+'</span><span style="color:var(--grn);font-weight:700">\u20b9'+fmtN(x.v)+'</span></div>').join('');
  document.getElementById('bot3Days').innerHTML = sorted.slice(-3).reverse().map(x=>'<div class="day-row"><span>'+x.d+'</span><span style="color:var(--red);font-weight:700">\u20b9'+fmtN(x.v)+'</span></div>').join('');

  var ratiosEl = document.getElementById('costRatiosBars');
  if(ratiosEl) {
     var rSum = sum(REV)||1;
     var items = [{l:'RM/CP Indent', v:(sum(RM)+sum(CP))/rSum*100, t:32, c:'var(--blu)'}, {l:'Utilities', v:(sum(GASV)+sum(WATV))/rSum*100, t:5, c:'var(--pur)'}, {l:'Operating', v:(sum(PKG)+sum(HK))/rSum*100, t:3, c:'var(--cyn)'}];
     ratiosEl.innerHTML = items.map(function(i){
       return '<div class="ratio-row"><div class="ratio-meta"><span>'+i.l+'</span><span>'+i.v.toFixed(1)+'% / '+i.t+'%</span></div><div class="ratio-track"><div class="ratio-fill" style="width:'+Math.min(i.v/i.t*100, 100)+'%;background:'+(i.v>i.t?'var(--red)':i.c)+'"></div></div></div>';
     }).join('');
  }
}

function buildPageCharts(page) {
  if(!activeSheetId) return;
  if(page==='overview') buildOverviewCharts();
  else if(page==='analysis') buildAnOverview();
  else if(page==='team') buildTeamCharts();
}

function buildOverviewCharts() {
  killChart('chOv');
  var c1 = document.getElementById('chartOverview');
  if(c1) CI.chOv = new Chart(c1, {
    type:'bar',
    data:{ labels:DATES.map(d=>d.split(' ')[1]||d), datasets:[{label:'Revenue', data:REV, backgroundColor:'rgba(59,130,246,0.6)', borderRadius:4}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, datalabels:{display:true, color:'#fff', font:{weight:'bold',size:9}, anchor:'end', align:'top', backgroundColor:'rgba(0,0,0,0.4)', borderRadius:3, formatter:v=>v>0?(v/1000).toFixed(0)+'k':''}}, scales:{x:{grid:{display:false}, ticks:{color:'#cbd5e1', font:{size:10}}}, y:{grid:{color:'rgba(255,255,255,0.05)'}, grace:'15%', ticks:{color:'#cbd5e1', callback:v=>(v/1000).toFixed(0)+'k'}}} }
  });
}

function killChart(id){ if(CI[id]){ CI[id].destroy(); delete CI[id]; } }
function killAllCharts(){ Object.keys(CI).forEach(killChart); }

// Initialize
document.addEventListener('DOMContentLoaded', function(){
  loadRegistry();
  renderSheetList();
  renderSheetDropdown();
  if(activeSheetId) switchActiveSheet(activeSheetId);
});

// ── Analysis Logic ──
function buildAnOverview() {
  var m = calcMetrics();
  document.getElementById('anKpiMargin').innerText = m.noiPct.toFixed(1) + '%';
  document.getElementById('anKpiMarginSub').innerText = 'NOI: \u20b9' + fmtN(m.totNOI);
  document.getElementById('anKpiRunRate').innerText = '\u20b9' + fmtN(m.totRev);
  document.getElementById('anKpiRunRateSub').innerText = 'Ach: ' + (m.totTgt > 0 ? (m.totRev/m.totTgt*100).toFixed(1) : 0) + '% of Target';
}

// ── Outlet Registry UI ──
function renderSheetList(){
  var el = document.getElementById('sheetListEl'); if(!el) return;
  if(!SHEET_REGISTRY.length) { el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--m1);font-size:12px">No sheets added yet.</div>'; return; }
  el.innerHTML = SHEET_REGISTRY.map(function(s){
    return '<div class="sheet-card"><div class="sheet-dot" style="background:'+s.color+'"></div><div class="sheet-info"><div class="sheet-label">'+s.label+'</div><div class="sheet-url">'+s.url+'</div><div class="sheet-meta">Last synced: '+(s.lastSynced||'Never')+'</div></div><div class="sheet-actions"><button class="icon-btn" onclick="syncOneSheet(\''+s.id+'\')">Sync</button><button class="icon-btn danger" onclick="removeSheet(\''+s.id+'\')">Delete</button></div></div>';
  }).join('');
}
function renderSheetDropdown(){
  var sel = document.getElementById('sheetSelectorDrop'); if(!sel) return;
  sel.innerHTML = '<option value="">-- Select Month --</option>';
  SHEET_REGISTRY.forEach(function(s){
    var tabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    if(tabs.length) {
      sel.innerHTML += '<optgroup label="'+s.label+'">';
      tabs.forEach(function(k){ sel.innerHTML += '<option value="'+k+'"'+(k===activeSheetId?' selected':'')+'>'+SHEET_DATA[k].tabName+'</option>'; });
      sel.innerHTML += '</optgroup>';
    } else { sel.innerHTML += '<option value="" disabled>'+s.label+' (Not synced)</option>'; }
  });
}

// ── Sync Actions ──
async function syncOneSheet(id){
  var s = SHEET_REGISTRY.find(x=>x.id===id); if(!s) return;
  try {
    showToast('Syncing '+s.label+'...');
    await fetchOutletData(id, s.url);
    s.lastSynced = new Date().toLocaleTimeString();
    saveRegistry(); renderSheetList(); renderSheetDropdown();
    showToast('Sync complete!');
  } catch(e) { showToast('[ERR] Sync failed: '+e.message); }
}
async function syncAllSheets(){ for(var i=0; i<SHEET_REGISTRY.length; i++) await syncOneSheet(SHEET_REGISTRY[i].id); }
function openAddSheet(){ document.getElementById('addSheetLabel').value=''; document.getElementById('addSheetUrl').value=''; document.getElementById('addSheetModal').classList.add('show'); }
function closeModal(id){ document.getElementById(id).classList.remove('show'); }
async function saveSheet(){
  var l = document.getElementById('addSheetLabel').value.trim(), u = document.getElementById('addSheetUrl').value.trim();
  if(!l||!u) return;
  var id = 'outlet_'+Date.now();
  SHEET_REGISTRY.push({id:id, label:l, url:u, color:SHEET_COLORS[SHEET_REGISTRY.length%SHEET_COLORS.length]});
  saveRegistry(); closeModal('addSheetModal'); renderSheetList(); renderSheetDropdown();
  await syncOneSheet(id);
}
function removeSheet(id){ SHEET_REGISTRY=SHEET_REGISTRY.filter(s=>s.id!==id); saveRegistry(); renderSheetList(); renderSheetDropdown(); }
function showToast(m){ var e=document.getElementById('toastEl'); e.textContent=m; e.classList.add('show'); setTimeout(()=>e.classList.remove('show'),3000); }