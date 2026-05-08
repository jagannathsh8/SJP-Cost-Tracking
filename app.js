"use strict";

var SHEET_COLORS = ['#f59e0b','#60a5fa','#22c55e','#a78bfa','#f87171','#38bdf8','#e879f9','#facc15','#4ade80','#fb923c','#818cf8','#2dd4bf'];
var SHEET_DATA = {};
var SHEET_REGISTRY = [];
var activeSheetId = '';

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
      TARGET:TARGETS['Net Revenue']||14200000, MONTH_DAYS:nd.length, DYNAMIC: dynamicRows, TARGETS: TARGETS, RUN_RATES: RUN_RATES, MTDS: MTDS
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
  if(window.killAllCharts) killAllCharts();
  window.builtPages = {};
  if(window.renderUI) renderUI();
  var activeNav = document.querySelector('.nav-btn.active');
  var activePage = activeNav ? activeNav.getAttribute('data-page') : 'overview';
  setTimeout(function(){ if(window.buildPageCharts) buildPageCharts(activePage); }, 80);
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

// ── Analysis Logic ──
function buildAnOverview() {
  if(!window.calcMetrics) return;
  var m = calcMetrics();
  
  // Use Run Rate column from sheet for Net Operating Margin if available
  var rrMarginVal = (window.RUN_RATES && (window.RUN_RATES['Net Operating Margin'] || window.RUN_RATES['Operating Margin'])) || 0;
  var rrRevenue = (window.RUN_RATES && (window.RUN_RATES['Net Revenue'] || window.RUN_RATES['Total Revenue'])) || 0;
  
  var marginPct = rrRevenue > 0 ? (rrMarginVal / rrRevenue * 100) : 0;

  document.getElementById('anKpiMargin').innerText = marginPct.toFixed(1) + '%';
  document.getElementById('anKpiMarginSub').innerText = 'Margin: \u20b9' + fmtN(rrMarginVal);
  
  document.getElementById('anKpiRunRate').innerText = '\u20b9' + fmtN(rrRevenue);
  document.getElementById('anKpiRunRateSub').innerText = 'Ach: ' + (window.TARGET > 0 ? (rrRevenue/window.TARGET*100).toFixed(1) : 0) + '% of Target';
  
  // Last month till that day run rate (Placeholder calculation based on sheet if exists, otherwise same as RR)
  var peakVal = (window.RUN_RATES && window.RUN_RATES['Last Month Run Rate']) || rrRevenue;
  document.getElementById('anKpiPeak').innerText = '\u20b9' + fmtN(peakVal);
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
async function saveSheet(){
  var l = document.getElementById('addSheetLabel').value.trim(), u = document.getElementById('addSheetUrl').value.trim();
  if(!l||!u) return;
  var id = 'outlet_'+Date.now();
  SHEET_REGISTRY.push({id:id, label:l, url:u, color:SHEET_COLORS[SHEET_REGISTRY.length%SHEET_COLORS.length]});
  saveRegistry(); closeModal('addSheetModal'); renderSheetList(); renderSheetDropdown();
  await syncOneSheet(id);
}
function removeSheet(id){ SHEET_REGISTRY=SHEET_REGISTRY.filter(s=>s.id!==id); saveRegistry(); renderSheetList(); renderSheetDropdown(); }

// Initialization
document.addEventListener('DOMContentLoaded', function(){
  loadRegistry();
  renderSheetList();
  renderSheetDropdown();
  if(activeSheetId) switchActiveSheet(activeSheetId);
});