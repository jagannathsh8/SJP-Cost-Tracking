"use strict";

var SHEET_COLORS = ['#f59e0b','#60a5fa','#22c55e','#a78bfa','#f87171','#38bdf8','#e879f9','#facc15','#4ade80','#fb923c','#818cf8','#2dd4bf'];
var SHEET_DATA = {};
var SHEET_REGISTRY = [];
var activeSheetId = '';
var DEFAULT_API_URL = 'YOUR_APPS_SCRIPT_URL';

function loadRegistry(){
  try { SHEET_REGISTRY = JSON.parse(localStorage.getItem('sjp_outlets')||'[]'); } catch(e){ SHEET_REGISTRY=[]; }
  activeSheetId = localStorage.getItem('sjp_active_outlet')||'';
  
  // Auto-select latest sheet if none active
  if(!activeSheetId && SHEET_REGISTRY.length) {
    // We'll pick the last one added as the "latest"
    var last = SHEET_REGISTRY[SHEET_REGISTRY.length-1];
    var tabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === last.id; });
    if(tabs.length) activeSheetId = tabs[tabs.length-1];
  }
}
function saveRegistry(){
  localStorage.setItem('sjp_outlets', JSON.stringify(SHEET_REGISTRY));
  localStorage.setItem('sjp_active_outlet', activeSheetId);
}

// Deprecated early switchActiveSheet implementation removed; now handled by applySheetToGlobals and later switchActiveSheet.

// ── Parse multi-tab Apps Script JSON into data objects ──
function parseAppsScriptTabs(json){
  console.log("Raw JSON received:", json);
  if(json.status!=='success' || !json.tabs) {
    console.error('Invalid multi-tab response:', json);
    throw new Error('Invalid multi-tab response');
  }
  var parsedTabs = {};
  
  json.tabs.forEach(function(tab){
    if(tab.name.toUpperCase() === 'MIS') {
      window.MIS_DATA = tab.rawData;
      return;
    }

    if(tab.name.toLowerCase().indexOf('employee') !== -1) {
      window.TEAM_DATA = tab.data;
      return;
    }

    if(tab.name.toLowerCase() === 'sales summary' || tab.name.toLowerCase() === 'sales_summary') {
      parsedTabs[tab.name] = tab.data;
      return;
    }

    // Skip sheets that don't have a month name (e.g., "Scrap sale")
    var hasMonth = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(tab.name);
    if (!hasMonth) {
      console.log("Skipping non-month tab:", tab.name);
      return;
    }

    var data = tab.data;
    if(!data || !data.length) return;
    
    var keys = Object.keys(data[0]);
    var dateKeys = keys.filter(function(k){ return k!=='Particulars'&&k!=='Target'&&k!=='Run Rate'&&k!=='MTD'&&k!==''; });
    
    var findRow = function(name){ return data.find(function(x){ return x.Particulars&&x.Particulars.toLowerCase().indexOf(name.toLowerCase())!==-1; }); };
    var getVal = function(row,dKey){ return row&&row[dKey]!==''&&row[dKey]!=null?(parseFloat(row[dKey])||0):0; };
    
    var nd=[],nr=[],nrm=[],ncp=[],npk=[],nhk=[],ngu=[],ngv=[],nwq=[],nwv=[],npt=[];
    var revRow=findRow('Net Revenue'), rmRow=findRow('RM Indent'), cpRow=findRow('CP Indent');
    var pkRow=findRow('Packaging Indent'), hkRow=findRow('HK Materials');
    var guRow=findRow('Gail Gas consumption Unit') || findRow('Gas consumption Unit'), gvRow=findRow('Gail gas consumption Value') || findRow('Gas consumption Value') || findRow('Total Gas consumption Value');
    var wqRow=findRow('Water consumption Unit'), wvRow=findRow('Water consumption Value');
    var ptRow=findRow('Petty cash');
    var tgt = 14200000;
    if(revRow&&revRow['Target']&&parseFloat(revRow['Target'])) tgt=parseFloat(revRow['Target']);
    
    // Dynamic Extractor & Targets
    var dynamicRows = {};
    var TARGETS = {}, RUN_RATES = {}, MTDS = {};
    data.forEach(function(row){
        var p = row.Particulars;
        if(!p) return;
        
        // Store targets, run rates, MTDs for all rows
        var getNum = function(val){ return val!==''&&val!=null?(parseFloat(val)||0):0; };
        TARGETS[p] = getNum(row['Target']);
        RUN_RATES[p] = getNum(row['Run Rate']);
        MTDS[p] = getNum(row['MTD']);
        
        if(p==='Net Revenue' || p==='Total Revenue' || p.indexOf('Indent')!==-1 || p.indexOf('HK')!==-1 || p.toLowerCase().indexOf('packaging')!==-1) return;
        dynamicRows[p] = [];
    });

    for(var i=0;i<dateKeys.length;i++){
      var dKey=dateKeys[i], rv=revRow?revRow[dKey]:'';
      if(rv===''||rv==null) continue;
      var parts=dKey.split('\n');
      var dStr = parts.length>1 ? parts[1] : parts[0];
      
      var match = dStr.match(/(\d{1,2})\s*([a-zA-Z]{3,})/);
      if (match) {
          var dateNum = match[1];
          var monthStr = match[2].substring(0,3);
          var dObj = new Date(dateNum + " " + monthStr + " 2026");
          if(!isNaN(dObj.getTime())) {
             var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
             dStr = dayNames[dObj.getDay()] + ' ' + dateNum + ' ' + monthStr;
          }
      }
      
      nd.push(dStr);
      nr.push(parseFloat(rv)||0); nrm.push(getVal(rmRow,dKey)); ncp.push(getVal(cpRow,dKey));
      npk.push(getVal(pkRow,dKey)); nhk.push(getVal(hkRow,dKey));
      ngu.push(getVal(guRow,dKey)); ngv.push(getVal(gvRow,dKey));
      nwq.push(getVal(wqRow,dKey)); nwv.push(getVal(wvRow,dKey)); npt.push(getVal(ptRow,dKey));
      
      // Dynamic rows
      Object.keys(dynamicRows).forEach(function(dr){ dynamicRows[dr].push(getVal(findRow(dr), dKey)); });
    }
    
    // ── Determine days in month from tab name ──
    var daysInMonth = nd.length; // Default to data length
    var mMatch = tab.name.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if(mMatch){
      var monthStr = mMatch[0].toLowerCase();
      var year = 2026;
      var yMatch = tab.name.match(/\d{4}/);
      if(yMatch) year = parseInt(yMatch[0]);
      var monthIdx = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(monthStr);
      if(monthIdx !== -1) daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    }

    parsedTabs[tab.name] = {
      DATES:nd, REV:nr, RM:nrm, CP:ncp, PKG:npk, HK:nhk, 
      GASU:ngu, GASV:ngv, WATQ:nwq, WATV:nwv, PETTY:npt, 
      TARGET:tgt, MONTH_DAYS:daysInMonth,
      DYNAMIC: dynamicRows,
      TARGETS: TARGETS,
      RUN_RATES: RUN_RATES,
      MTDS: MTDS
    };
  });
  return parsedTabs;
}

// ── Fetch one outlet by URL, store in SHEET_DATA ──
async function fetchOutletData(outletId, url){
  // Cache busting for aggressive mobile browsers
  var fetchUrl = url + (url.indexOf('?') !== -1 ? '&' : '?') + '_t=' + Date.now();
  var r = await fetch(fetchUrl, { cache: 'no-store' });
  var json = await r.json();
  var parsedTabs = parseAppsScriptTabs(json);
  
  // Intercept Sales summary tab and store it separately
  var salesSummaryTabName = Object.keys(parsedTabs).find(function(k){
    return k.toLowerCase() === 'sales summary' || k.toLowerCase() === 'sales_summary';
  });
  if (salesSummaryTabName) {
    window.SALES_SUMMARY_DATA = window.SALES_SUMMARY_DATA || {};
    var cleanNum = function(val) {
      if (val == null || val === '') return 0;
      if (typeof val === 'number') return val;
      var s = String(val).replace(/[₹,]/g, '').trim();
      var num = parseFloat(s);
      return isNaN(num) ? 0 : num;
    };
    window.SALES_SUMMARY_DATA[outletId] = parsedTabs[salesSummaryTabName].map(function(row) {
      var gross = cleanNum(row['Gross Revenue'] || row['GrossRevenue'] || row['gross revenue'] || row['grossrevenue']);
      var tax = cleanNum(row['Total Tax'] || row['TotalTax'] || row['total tax'] || row['totaltax'] || row['Tax'] || row['tax']);
      // Calculate Net Revenue as Gross - Tax as requested
      var calculatedNet = gross - tax;
      return {
        Date: row['Date'] || row['date'] || '',
        Outlet: row['Outlet'] || row['outlet'] || '',
        MealSlot: row['Meal Slot'] || row['MealSlot'] || row['meal slot'] || row['mealslot'] || '',
        GrossRevenue: gross,
        NetRevenue: calculatedNet,
        TotalTax: tax,
        Packaging: cleanNum(row['Packaging'] || row['packaging']),
        DineInRev: cleanNum(row['Dine-In Rev'] || row['Dine-in Rev'] || row['DineInRev'] || row['dine-in rev'] || row['dineinrev']),
        PickupRev: cleanNum(row['Pickup Rev'] || row['PickupRev'] || row['pickup rev'] || row['pickuprev']),
        DeliveryRev: cleanNum(row['Delivery Rev'] || row['DeliveryRev'] || row['delivery rev'] || row['deliveryrev']),
        ZomatoRev: cleanNum(row['Zomato Rev'] || row['ZomatoRev'] || row['zomato rev'] || row['zomatorev']),
        ZomatoOrders: cleanNum(row['Zomato Orders'] || row['ZomatoOrders'] || row['zomato orders'] || row['zomatoorders']),
        SwiggyRev: cleanNum(row['Swiggy Rev'] || row['SwiggyRev'] || row['swiggy rev'] || row['swiggyrev']),
        SwiggyOrders: cleanNum(row['Swiggy Orders'] || row['SwiggyOrders'] || row['swiggy orders'] || row['swiggyorders']),
        OtherDeliveryRev: cleanNum(row['Other Delivery Rev'] || row['OtherDeliveryRev'] || row['other delivery rev'] || row['otherdeliveryrev']),
        UpiWalletRev: cleanNum(row['UPI/Wallet Rev'] || row['UPI/WalletRev'] || row['upi/wallet rev'] || row['upi/walletrev'] || row['UPI/Wallet'] || row['upi/wallet']),
        CancelledOrders: cleanNum(row['Cancelled Orders'] || row['CancelledOrders'] || row['cancelled orders'] || row['cancelledorders']),
        TotalOrders: cleanNum(row['Total Orders'] || row['TotalOrders'] || row['total orders'] || row['totalorders']),
        AOV: cleanNum(row['AOV'] || row['aov'])
      };
    });
    delete parsedTabs[salesSummaryTabName];
  }

  // Save each tab as outletId__tabName
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

// ── Apply a sheet's data to global arrays ──
function applySheetToGlobals(compositeId){
  var d = SHEET_DATA[compositeId];
  if(!d) return;
  function inject(arr,vals){ arr.length=0; for(var i=0;i<vals.length;i++) arr.push(vals[i]); }
  inject(DATES,d.DATES); inject(REV,d.REV); inject(RM,d.RM); inject(CP,d.CP);
  inject(PKG,d.PKG); inject(HK,d.HK); inject(GASU,d.GASU); inject(GASV,d.GASV);
  inject(WATQ,d.WATQ); inject(WATV,d.WATV); inject(PETTY,d.PETTY);
  TARGET = d.TARGET; MONTH_DAYS = d.MONTH_DAYS;
  window.DYNAMIC_DATA = d.DYNAMIC || {};
  window.TARGETS = d.TARGETS || {};
  window.RUN_RATES = d.RUN_RATES || {};
  window.MTDS = d.MTDS || {};
  activeSheetId = compositeId;
  saveRegistry();
}

// ── Switch active sheet (called from dropdown) ──
function switchActiveSheet(compositeId){
  if(!compositeId||!SHEET_DATA[compositeId]) return;
  applySheetToGlobals(compositeId);
  var d = SHEET_DATA[compositeId];
  var entry = SHEET_REGISTRY.find(function(s){return s.id===d.outletId;});
  // Update header
  document.getElementById('hdrTitle').innerHTML = (entry?entry.label:'Dashboard')+' - '+d.tabName;
  document.getElementById('hdrSub').textContent = 'MIS Dashboard · '+DATES.length+' days · Jagan';
  killAllCharts();
  Object.keys(builtPages).forEach(function(k){ delete builtPages[k]; });
  renderUI();
  
  // Re-build the currently active page instead of hardcoding 'overview'
  var activeNav = document.querySelector('.nav-btn.active');
  var activePage = activeNav ? activeNav.getAttribute('data-page') : 'overview';
  setTimeout(function(){ 
    buildPageCharts(activePage); 
    if(activePage === 'mis' && window.renderMIS) renderMIS();
  }, 80);
  
  document.getElementById('srcInfoEl').textContent = 'Active: '+(entry?entry.label:'')+' ('+d.tabName+') · '+DATES.length+' days';
}

// ── Render outlet list on Data Source page ──
function renderSheetList(){
  var el = document.getElementById('sheetListEl');
  if(!SHEET_REGISTRY.length){ el.innerHTML='<div style="text-align:center;padding:24px;color:var(--m1);font-size:12px">No outlets added yet.</div>'; return; }
  
  el.innerHTML = SHEET_REGISTRY.map(function(s){
    // Find all tabs for this outlet
    var outletTabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    var isSynced = outletTabs.length > 0;
    var statusColor = isSynced ? '#22c55e' : '#f59e0b';
    var sid = s.id;
    
    var html = '<div class="sheet-card" style="border-color:var(--b2); flex-direction:column; align-items:stretch;">'
      +'<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--b1); padding-bottom:12px; margin-bottom:12px;">'
        +'<div style="display:flex; align-items:center; gap:12px;">'
          +'<div class="sheet-dot" style="background:'+s.color+'"></div>'
          +'<div class="sheet-info">'
            +'<div class="sheet-label">'+s.label+'</div>'
            +'<div class="sheet-url">'+s.url.substring(0,60)+'...</div>'
            +'<div class="sheet-meta" style="color:'+statusColor+'">'+(isSynced?'[OK] '+outletTabs.length+' months found':'[WAIT] Not synced')+(s.lastSynced?' · '+s.lastSynced:'')+'</div>'
          +'</div>'
        +'</div>'
        +'<div class="sheet-actions">'
          +'<button class="icon-btn" data-action="sync" data-sid="'+sid+'" title="Sync Outlet">Sync</button>'
          +'<button class="icon-btn" data-action="edit" data-sid="'+sid+'" title="Edit">Edit</button>'
          +'<button class="icon-btn danger" data-action="remove" data-sid="'+sid+'" title="Remove">Remove</button>'
        +'</div>'
      +'</div>';
      
    if(isSynced) {
      html += '<div style="display:flex; gap:8px; flex-wrap:wrap;">';
      outletTabs.forEach(function(compKey){
         var d = SHEET_DATA[compKey];
         var isAct = (compKey === activeSheetId);
         html += '<button data-action="activate" data-sid="'+compKey+'" style="background:'+(isAct?'#166534':'var(--s2)')+'; border:1px solid '+(isAct?'#22c55e':'var(--b2)')+'; color:'+(isAct?'#fff':'var(--m1)')+'; padding:4px 10px; border-radius:12px; font-size:11px; cursor:pointer;">'
              + d.tabName + ' ('+d.DATES.length+'d)'
              + '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }).join('');

  el.onclick = function(ev){
    var btn = ev.target.closest('[data-action]');
    if(!btn) return;
    var action = btn.getAttribute('data-action');
    var sid = btn.getAttribute('data-sid');
    if(action==='activate') setActiveSheet(sid);
    else if(action==='sync') syncOneSheet(sid);
    else if(action==='edit') editSheet(sid);
    else if(action==='remove') removeSheet(sid);
  };
}

// ── Set active sheet from Data Source page ──
function setActiveSheet(compositeId){
  if(!SHEET_DATA[compositeId]){ showToast('Sync this sheet first.'); return; }
  switchActiveSheet(compositeId);
  renderSheetList();
  renderSheetDropdown();
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelector('[data-page="overview"]').classList.add('active');
  document.getElementById('page-overview').classList.add('active');
  setTimeout(function(){ buildPageCharts('overview'); }, 80);
}

// ── Update header dropdown ──
function renderSheetDropdown(){
  var sel = document.getElementById('sheetSelectorDrop');
  sel.innerHTML = '<option value="">-- Select Month --</option>';
  SHEET_REGISTRY.forEach(function(s){
    var outletTabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    if(outletTabs.length) {
      sel.innerHTML += '<optgroup label="'+s.label+'">';
      outletTabs.forEach(function(compKey){
         var d = SHEET_DATA[compKey];
         sel.innerHTML += '<option value="'+compKey+'"'+(compKey===activeSheetId?' selected':'')+'>'+d.tabName+' ('+d.DATES.length+'d)</option>';
      });
      sel.innerHTML += '</optgroup>';
    } else {
      sel.innerHTML += '<option value="" disabled>'+s.label+' (Not synced)</option>';
    }
  });
  sel.value = activeSheetId || '';
}

// ── Open add sheet modal ──
function openAddSheet(){
  document.getElementById('addSheetModalTitle').textContent = '+ Add Outlet';
  document.getElementById('addSheetLabel').value = '';
  document.getElementById('addSheetUrl').value = '';
  document.getElementById('addSheetEditId').value = '';
  document.getElementById('addSheetErr').textContent = '';
  openModal('addSheetModal');
}
function editSheet(id){
  var s = SHEET_REGISTRY.find(function(x){return x.id===id;});
  if(!s) return;
  document.getElementById('addSheetModalTitle').textContent = 'Edit Outlet';
  document.getElementById('addSheetLabel').value = s.label;
  document.getElementById('addSheetUrl').value = s.url;
  document.getElementById('addSheetEditId').value = id;
  document.getElementById('addSheetErr').textContent = '';
  openModal('addSheetModal');
}

// ── Save sheet (add or edit) ──
async function saveSheet(){
  var label = document.getElementById('addSheetLabel').value.trim();
  var url = document.getElementById('addSheetUrl').value.trim();
  var editId = document.getElementById('addSheetEditId').value;
  if(!label||!url){ document.getElementById('addSheetErr').textContent='Both fields required.'; return; }
  if(url.indexOf('/macros/s/')===-1){ document.getElementById('addSheetErr').textContent='Must be an Apps Script /exec URL.'; return; }

  if(editId){
    var existing = SHEET_REGISTRY.find(function(x){return x.id===editId;});
    if(existing){ existing.label=label; existing.url=url; }
  } else {
    var id = 'outlet_'+Date.now();
    SHEET_REGISTRY.push({id:id, label:label, url:url, color:SHEET_COLORS[SHEET_REGISTRY.length%SHEET_COLORS.length], lastSynced:null});
    editId = id;
  }
  saveRegistry();
  closeModal('addSheetModal');
  renderSheetList();
  renderSheetDropdown();
  populateAnaSelectors();
  await syncOneSheet(editId);
}

// ── Remove sheet ──
function removeSheet(id){
  SHEET_REGISTRY = SHEET_REGISTRY.filter(function(s){return s.id!==id;});
  // remove all tabs for this outlet
  Object.keys(SHEET_DATA).forEach(function(k){
    if(SHEET_DATA[k].outletId === id) delete SHEET_DATA[k];
  });
  if(activeSheetId && activeSheetId.indexOf(id)===0){ activeSheetId=''; DATES.length=0; REV.length=0; }
  saveRegistry(); renderSheetList(); renderSheetDropdown(); populateAnaSelectors();
}

// ── Sync one sheet ──
async function syncOneSheet(id){
  var s = SHEET_REGISTRY.find(function(x){return x.id===id;});
  if(!s) return;
  try{
    var savedKeys = await fetchOutletData(id, s.url);
    s.lastSynced = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    saveRegistry();
    renderSheetList();
    renderSheetDropdown();
    populateAnaSelectors();
    if((!activeSheetId || activeSheetId.indexOf(id)===0) && savedKeys.length){
      switchActiveSheet(savedKeys[savedKeys.length-1]); // switch to the latest added tab
    }
  } catch(e){
    showToast('[ERR] Failed: '+e.message);
  }
}

// ── Sync all sheets ──
async function syncAllSheets(){
  showToast('Syncing all outlets...');
  for(var i=0;i<SHEET_REGISTRY.length;i++){
    await syncOneSheet(SHEET_REGISTRY[i].id);
  }
  showToast('[OK] All outlets synced!');
}

// ═══════════════════════════════════════════════
// ANALYSIS ENGINE
// ═══════════════════════════════════════════════
function setAnaMode(mode, btn){
  ['date','week','month'].forEach(function(m){ document.getElementById('ana-'+m).style.display = m===mode?'block':'none'; });
  document.querySelectorAll('.ana-mode-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
}

function populateAnaSelectors(){
  var opts = '';
  SHEET_REGISTRY.forEach(function(s){
    var outletTabs = Object.keys(SHEET_DATA).filter(function(k){ return SHEET_DATA[k].outletId === s.id; });
    if(outletTabs.length) {
      opts += '<optgroup label="'+s.label+'">';
      outletTabs.forEach(function(compKey){
         opts += '<option value="'+compKey+'">'+s.label+' - '+SHEET_DATA[compKey].tabName+'</option>';
      });
      opts += '</optgroup>';
    }
  });

  ['anaDateSheetA','anaDateSheetB','anaWeekSheetA','anaWeekSheetB'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.innerHTML = '<option value="">-- Select --</option>'+opts;
  });
  
  var ms = document.getElementById('anaMonthSelectors');
  if(ms){
    ms.innerHTML = Object.keys(SHEET_DATA).map(function(compKey){
      var d = SHEET_DATA[compKey];
      var s = SHEET_REGISTRY.find(function(x){return x.id===d.outletId;});
      return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;background:var(--s2);border:1px solid var(--b2);padding:8px 12px;border-radius:8px">'
        +'<input type="checkbox" class="ana-month-cb" value="'+compKey+'" style="accent-color:'+s.color+'">'
        +'<span class="sheet-dot" style="background:'+s.color+';width:8px;height:8px"></span>'+s.label+' ('+d.tabName+')</label>';
    }).join('');
  }
}

function populateAnaDates(side){
  var compositeId = document.getElementById('anaDateSheet'+side).value;
  var sel = document.getElementById('anaDate'+side);
  sel.innerHTML = '<option value="">-- Date --</option>';
  if(!compositeId||!SHEET_DATA[compositeId]) return;
  SHEET_DATA[compositeId].DATES.forEach(function(d,i){ sel.innerHTML+='<option value="'+i+'">'+d+'</option>'; });
}

function populateAnaWeeks(side){
  var compositeId = document.getElementById('anaWeekSheet'+side).value;
  var sel = document.getElementById('anaWeek'+side);
  sel.innerHTML = '<option value="">-- Week --</option>';
  if(!compositeId||!SHEET_DATA[compositeId]) return;
  var dates = SHEET_DATA[compositeId].DATES;
  var weeks = Math.ceil(dates.length/7);
  for(var w=0;w<weeks;w++){
    var s=w*7, e=Math.min(s+6,dates.length-1);
    sel.innerHTML+='<option value="'+w+'">W'+(w+1)+': '+dates[s]+' to '+dates[e]+'</option>';
  }
}

function deltaPill(a,b){
  if(!a||!b) return '';
  var pct=((a-b)/b*100).toFixed(1);
  var cls=pct>0?'delta-pos':pct<0?'delta-neg':'delta-neu';
  return '<span class="delta-pill '+cls+'">'+(pct>0?'Up ':'Dn ')+Math.abs(pct)+'%</span>';
}

function cmpSection(title){
  return '<div style="margin:24px 0 10px;padding:8px 12px;background:var(--s2);border-radius:8px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--amb);border-left:3px solid var(--amb)">'+title+'</div>';
}

function cmpRow(label,a,b,fmt){
  var va=fmt?fmt(a):fmtL(a), vb=fmt?fmt(b):fmtL(b);
  return '<div class="cmp-grid-row" style="display:grid;grid-template-columns:minmax(140px, 1fr) 100px 100px 80px;align-items:center;padding:12px 0;border-bottom:1px solid var(--b1);font-size:13px">'
    +'<span style="color:var(--m1);font-weight:500">'+label+'</span>'
    +'<span style="color:#f59e0b;font-family:\'DM Mono\',monospace;font-weight:700;text-align:right">'+va+'</span>'
    +'<span style="color:#60a5fa;font-family:\'DM Mono\',monospace;font-weight:700;text-align:right">'+vb+'</span>'
    +'<div style="text-align:right">'+deltaPill(a,b)+'</div></div>';
}

function runDateVsDate(){
  var sA=document.getElementById('anaDateSheetA').value, iA=parseInt(document.getElementById('anaDateA').value);
  var sB=document.getElementById('anaDateSheetB').value, iB=parseInt(document.getElementById('anaDateB').value);
  if(!sA||!sB||isNaN(iA)||isNaN(iB)){ showToast('Select both tabs and dates.'); return; }
  var dA=SHEET_DATA[sA], dB=SHEET_DATA[sB];
  var eA=SHEET_REGISTRY.find(function(x){return x.id===dA.outletId;}), eB=SHEET_REGISTRY.find(function(x){return x.id===dB.outletId;});
  var pct = function(v){ return v.toFixed(1)+'%'; };
  var el=document.getElementById('anaDateResult');
  
  var html = '<div class="card card-body" style="padding:20px">'
    +'<div class="cmp-grid-header" style="display:grid;grid-template-columns:minmax(140px, 1fr) 100px 100px 80px;align-items:center;padding:0 0 16px;border-bottom:2px solid var(--b2);margin-bottom:10px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">'
      +'<span style="color:var(--m1)">Particulars</span>'
      +'<span style="text-align:right;color:'+eA.color+'">'+dA.DATES[iA]+'<div style="font-size:8px;font-weight:400;text-transform:none">'+dA.tabName+'</div></span>'
      +'<span style="text-align:right;color:'+eB.color+'">'+dB.DATES[iB]+'<div style="font-size:8px;font-weight:400;text-transform:none">'+dB.tabName+'</div></span>'
      +'<span style="text-align:right;color:var(--m1)">Trend</span>'
    +'</div>'
    +cmpSection('Core Revenue')
    +cmpRow('Net Revenue',dA.REV[iA],dB.REV[iB])
    +cmpSection('Critical Indents')
    +cmpRow('RM Indent',dA.RM[iA],dB.RM[iB])
    +cmpRow('CP Indent',dA.CP[iA],dB.CP[iB])
    +cmpRow('Total Indent',dA.RM[iA]+dA.CP[iA],dB.RM[iB]+dB.CP[iB])
    +cmpRow('Indent %', (dA.RM[iA]+dA.CP[iA])/(dA.REV[iA]||1)*100, (dB.RM[iB]+dB.CP[iB])/(dB.REV[iB]||1)*100, pct)
    +cmpSection('Utilities & Ops')
    +cmpRow('GAIL Gas Value',dA.GASV[iA],dB.GASV[iB])
    +cmpRow('Water Value',dA.WATV[iA],dB.WATV[iB])
    +cmpRow('Packaging',dA.PKG[iA],dB.PKG[iB])
    +cmpRow('HK Materials',dA.HK[iA],dB.HK[iB])
    +cmpRow('Petty Cash',dA.PETTY[iA],dB.PETTY[iB]);

  var dKeys = Object.keys(dA.DYNAMIC || {}).filter(function(k){
     var kl = k.toLowerCase();
     return kl.indexOf('revenue')===-1 && kl.indexOf('indent')===-1 && kl.indexOf('gas')===-1 && kl.indexOf('water')===-1 && kl.indexOf('hk')===-1 && kl.indexOf('packaging')===-1 && kl.indexOf('petty')===-1;
  });

  if(dKeys.length) {
    html += cmpSection('Other Cost Drivers');
    // Sort dKeys by the average value of both sides to put bigger costs on top
    dKeys.sort(function(k1, k2){
       var val1 = ((dA.DYNAMIC[k1]?dA.DYNAMIC[k1][iA]:0) + (dB.DYNAMIC && dB.DYNAMIC[k1] ? dB.DYNAMIC[k1][iB] : 0));
       var val2 = ((dA.DYNAMIC[k2]?dA.DYNAMIC[k2][iA]:0) + (dB.DYNAMIC && dB.DYNAMIC[k2] ? dB.DYNAMIC[k2][iB] : 0));
       return val2 - val1;
    });
    dKeys.forEach(function(k){
      if(dB.DYNAMIC && dB.DYNAMIC[k] !== undefined){
        html += cmpRow(k, dA.DYNAMIC[k][iA], dB.DYNAMIC[k][iB]);
      }
    });
  }

  html += '</div>';
  el.innerHTML = html;
}

function runWeekVsWeek(){
  var sA=document.getElementById('anaWeekSheetA').value, wA=parseInt(document.getElementById('anaWeekA').value);
  var sB=document.getElementById('anaWeekSheetB').value, wB=parseInt(document.getElementById('anaWeekB').value);
  if(!sA||!sB||isNaN(wA)||isNaN(wB)){ showToast('Select both tabs and weeks.'); return; }
  var dA=SHEET_DATA[sA], dB=SHEET_DATA[sB];
  var eA=SHEET_REGISTRY.find(function(x){return x.id===dA.outletId;}), eB=SHEET_REGISTRY.find(function(x){return x.id===dB.outletId;});
  var ss=function(arr,w){ var s=w*7,e=Math.min(s+7,arr.length),t=0; for(var i=s;i<e;i++) t+=arr[i]; return t; };
  var sa=function(arr,w){ var s=w*7,e=Math.min(s+7,arr.length),t=0,c=0; for(var i=s;i<e;i++){t+=arr[i];c++;} return c?t/c:0; };
  var pct=function(v){return v.toFixed(1)+'%';};
  var rA=ss(dA.REV,wA),rB=ss(dB.REV,wB);
  var rmcpA=ss(dA.RM,wA)+ss(dA.CP,wA), rmcpB=ss(dB.RM,wB)+ss(dB.CP,wB);
  var el=document.getElementById('anaWeekResult');
  
  var html = '<div class="card card-body" style="padding:20px">'
    +'<div class="cmp-grid-header" style="display:grid;grid-template-columns:minmax(140px, 1fr) 100px 100px 80px;align-items:center;padding:0 0 16px;border-bottom:2px solid var(--b2);margin-bottom:10px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">'
      +'<span style="color:var(--m1)">Particulars</span>'
      +'<span style="text-align:right;color:'+eA.color+'">Week '+(wA+1)+'<div style="font-size:8px;font-weight:400;text-transform:none">'+dA.tabName+'</div></span>'
      +'<span style="text-align:right;color:'+eB.color+'">Week '+(wB+1)+'<div style="font-size:8px;font-weight:400;text-transform:none">'+dB.tabName+'</div></span>'
      +'<span style="text-align:right;color:var(--m1)">Trend</span>'
    +'</div>'
    +cmpSection('Revenue')
    +cmpRow('Total Revenue',rA,rB)
    +cmpRow('Daily Average',sa(dA.REV,wA),sa(dB.REV,wB))
    +cmpSection('Raw Materials')
    +cmpRow('RM Indent',ss(dA.RM,wA),ss(dB.RM,wB))
    +cmpRow('CP Indent',ss(dA.CP,wA),ss(dB.CP,wB))
    +cmpRow('Total Indent',rmcpA,rmcpB)
    +cmpRow('Indent %',rA?rmcpA/rA*100:0,rB?rmcpB/rB*100:0,pct)
    +cmpSection('Packaging & HK')
    +cmpRow('Packaging',ss(dA.PKG,wA),ss(dB.PKG,wB))
    +cmpRow('HK Materials',ss(dA.HK,wA),ss(dB.HK,wB))
    +cmpSection('Gas (GAIL)')
    +cmpRow('Gas Units',ss(dA.GASU,wA),ss(dB.GASU,wB),function(v){return v.toFixed(1)+' u';})
    +cmpRow('Gas Value',ss(dA.GASV,wA),ss(dB.GASV,wB))
    +cmpSection('Water')
    +cmpRow('Water Tankers',ss(dA.WATQ,wA),ss(dB.WATQ,wB),function(v){return v.toFixed(1)+' T';})
    +cmpRow('Water Value',ss(dA.WATV,wA),ss(dB.WATV,wB))
    +cmpSection('Petty Cash')
    +cmpRow('Petty Cash',ss(dA.PETTY,wA),ss(dB.PETTY,wB));

  var dKeys = Object.keys(dA.DYNAMIC || {});
  if(dKeys.length) html += cmpSection('Other Particulars');
  dKeys.forEach(function(k){
     if(dB.DYNAMIC && dB.DYNAMIC[k]){
       html += cmpRow(k, ss(dA.DYNAMIC[k],wA), ss(dB.DYNAMIC[k],wB));
     }
  });

  html += '</div>';
  el.innerHTML = html;
}

function runMonthVsMonth(){
  var checked=[]; document.querySelectorAll('.ana-month-cb:checked').forEach(function(cb){ checked.push(cb.value); });
  if(checked.length<2){ showToast('Select at least 2 months.'); return; }
  if(checked.length>3){ showToast('Maximum 3 months.'); return; }
  var sets=checked.map(function(compKey){ 
    var d = SHEET_DATA[compKey];
    return {id:compKey, d:d, e:SHEET_REGISTRY.find(function(x){return x.id===d.outletId;})}; 
  });

  var el=document.getElementById('anaMonthResult');
  var kpiHtml='<div class="cmp-grid">';
  var metrics=[
    {label:'MTD REVENUE',fn:function(d){return sum(d.REV);},fmt:fmtL},
    {label:'DAILY AVG',fn:function(d){return avg(d.REV);},fmt:function(v){return fmtL(rnd(v));}},
    {label:'INDENT %',fn:function(d){var r=sum(d.REV);return r?(sum(d.RM)+sum(d.CP))/r*100:0;},fmt:function(v){return v.toFixed(1)+'%';}},
    {label:'GAS MTD',fn:function(d){return sum(d.GASV);},fmt:fmtL},
  ];
  metrics.forEach(function(met){
    kpiHtml+='<div class="cmp-card"><div class="cmp-label">'+met.label+'</div>';
    sets.forEach(function(s,i){
      var v=met.fn(s.d);
      kpiHtml+='<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">'
        +'<span style="font-size:10px;color:'+s.e.color+'">'+s.e.label+' ('+s.d.tabName+')</span>'
        +'<span class="cmp-val" style="font-size:15px;color:'+s.e.color+'">'+met.fmt(v)+'</span>'
        +'</div>';
      if(i>0) kpiHtml+=deltaPill(v,met.fn(sets[0].d));
    });
    kpiHtml+='</div>';
  });
  kpiHtml+='</div>';
  el.innerHTML=kpiHtml;

  killChart('chAnaRev'); killChart('chAnaCost'); killChart('chAnaInd');
  document.getElementById('anaMonthChartCard').style.display='block';
  document.getElementById('anaMonthCostCard').style.display='block';
  document.getElementById('anaMonthIndCard').style.display='block';
  
  var maxLen=Math.max.apply(null,sets.map(function(s){return s.d.DATES.length;}));
  var labels=[]; for(var i=0;i<maxLen;i++) labels.push('Day '+(i+1));
  
  var revDs=sets.map(function(s){return{label:s.e.label+' '+s.d.tabName,data:s.d.REV,borderColor:s.e.color,backgroundColor:s.e.color+'30',fill:false,tension:.3,pointRadius:0,borderWidth:2};});
  CI.chAnaRev=new Chart(document.getElementById('chartAnaRev'),{type:'line',data:{labels:labels,datasets:revDs},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},
    scales:{x:{grid:{color:'rgba(26,34,53,0.7)'},ticks:{maxTicksLimit:10}},y:{grid:{color:'rgba(26,34,53,0.7)'},ticks:{callback:function(v){return(v/100000).toFixed(0)+'L';}}}}}});

  var costLabels=['Indent %','Gas %','Pkg %','Water %'];
  var costDs=sets.map(function(s){
    var r=sum(s.d.REV)||1;
    return{label:s.e.label+' '+s.d.tabName,data:[(sum(s.d.RM)+sum(s.d.CP))/r*100,sum(s.d.GASV)/r*100,sum(s.d.PKG)/r*100,sum(s.d.WATV)/r*100],
      backgroundColor:s.e.color+'99',borderRadius:4};
  });
  CI.chAnaCost=new Chart(document.getElementById('chartAnaCost'),{type:'bar',data:{labels:costLabels,datasets:costDs},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},
    scales:{x:{grid:{color:'rgba(26,34,53,0.7)'}},y:{grid:{color:'rgba(26,34,53,0.7)'},ticks:{callback:function(v){return v.toFixed(0)+'%';}}}}}});

  var indDs=sets.map(function(s){
    var ipc=s.d.DATES.map(function(_,i){return s.d.REV[i]?((s.d.RM[i]+s.d.CP[i])/s.d.REV[i]*100):0;});
    return{label:s.e.label+' '+s.d.tabName,data:ipc,borderColor:s.e.color,fill:false,tension:.3,pointRadius:0,borderWidth:2};
  });
  CI.chAnaInd=new Chart(document.getElementById('chartAnaInd'),{type:'line',data:{labels:labels,datasets:indDs},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},
    scales:{x:{grid:{color:'rgba(26,34,53,0.7)'},ticks:{maxTicksLimit:8}},y:{grid:{color:'rgba(26,34,53,0.7)'},ticks:{callback:function(v){return v+'%';}},suggestedMax:45}}}});
}

function parseSheetDate(val) {
  if(!val) return null;
  if(val instanceof Date) return val;
  var s = String(val).trim();
  if(!s) return null;

  var d = new Date(s);
  if(!isNaN(d.getTime())) return d;
  
  // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  var parts = s.split(/[-/.]/);
  if(parts.length === 3) {
    var p0=parseInt(parts[0]), p1=parseInt(parts[1]), p2=parseInt(parts[2]);
    var y = p2, m = p1, day = p0;
    
    // Check if first part is year (YYYY-MM-DD)
    if(parts[0].length === 4) { y=p0; m=p1; day=p2; }
    
    // Handle 2-digit year (e.g., 26 -> 2026)
    if(y < 100) y += 2000;
    
    var finalD = new Date(y, m-1, day);
    return isNaN(finalD.getTime()) ? null : finalD;
  }
  return null;
}

// ═══════════════════════════════════════════════
// TEAM DASHBOARD LOGIC
// ═══════════════════════════════════════════════
function buildTeamCharts() {
  if(!window.TEAM_DATA || !window.TEAM_DATA.length) {
    var el = document.getElementById('teamKpiGrid');
    if(el) el.innerHTML = '<div style="padding:20px;color:var(--m1)">Sync "Employee onboarding data" tab to view insights.</div>';
    return;
  }

  // Dynamically populate outlet dropdown
  var outletSlicer = document.getElementById('teamOutletSlicer');
  if(outletSlicer && !outletSlicer.dataset.dynamic) {
    var currentVal = outletSlicer.value;
    var raw = window.TEAM_DATA;
    var locs = new Set();
    raw.forEach(function(r){
      var loc = r['Location'] || r['Work Location'] || r['Store'];
      if(loc) locs.add(String(loc).trim());
    });
    var sortedLocs = Array.from(locs).sort();
    var html = '<option value="all">All Outlets</option>';
    sortedLocs.forEach(function(l){
      html += '<option value="'+l.toLowerCase()+'">'+l+'</option>';
    });
    outletSlicer.innerHTML = html;
    outletSlicer.value = currentVal;
    outletSlicer.dataset.dynamic = "true";
  }
  
  var raw = window.TEAM_DATA;
  var filter = document.getElementById('teamTimeSlicer') ? document.getElementById('teamTimeSlicer').value : 'all';
  var outletFilter = document.getElementById('teamOutletSlicer') ? document.getElementById('teamOutletSlicer').value : 'all';
  var now = new Date();
  
  // Filter Data
  var data = raw.filter(function(r){
    // 1. Outlet Filter
    if(outletFilter !== 'all') {
      var loc = String(r['Work Location'] || r['Location'] || '').toLowerCase();
      if(loc.indexOf(outletFilter) === -1) return false;
    }

    // 2. Time Filter
    if(filter === 'all') return true;
    var keys = Object.keys(r);
    // Fuzzy search for Joining Date
    var dKey = keys.find(k => k.toLowerCase().indexOf('joining')!==-1 || k.toLowerCase().indexOf('hired')!==-1 || k.toLowerCase()==='date');
    var dtStr = r[dKey] || '';
    
    var d = parseSheetDate(dtStr);
    if(!d) return filter === 'all';
    
    // Normalize to midnight for clean comparison
    var dNorm = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var nowNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    if(filter === '7d') return (nowNorm - dNorm) <= (7 * 24 * 60 * 60 * 1000);
    if(filter === 'mtd') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if(filter === 'lm') {
      var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    if(filter === '3m') return (nowNorm - dNorm) <= (90 * 24 * 60 * 60 * 1000);
    if(filter === 'custom') {
      var sVal = document.getElementById('teamStart').value;
      var eVal = document.getElementById('teamEnd').value;
      if(!sVal || !eVal) return true;
      var start = parseSheetDate(sVal), end = parseSheetDate(eVal);
      if(!start || !end) return true;
      var sNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
      var eNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
      return dNorm >= sNorm && dNorm <= eNorm;
    }
    return true;
  });

  window.LAST_FILTERED_TEAM = data;

  var total = data.length;
  
  // Aggregates
  var locMap = {}, monthMap = {}, refMap = {}, desigMap = {};
  var idToName = {};

  data.forEach(function(r){
    // Location
    var loc = r['Location'] || r['Work Location'] || r['Store'] || 'Unknown';
    locMap[loc] = (locMap[loc]||0) + 1;
    
    // Designation
    var rawDes = r['Designation'] || r['Role'] || r['Dept'] || r['Designation '] || 'Other';
    var des = String(rawDes).trim().toLowerCase().split(' ').map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
    desigMap[des] = (desigMap[des]||0) + 1;
    
    // Referral Logic
    var rawRef = '';
    var keys = Object.keys(r);
    var refKeyHeader = keys.find(k => k.toLowerCase().indexOf('refer') !== -1) || keys[7];
    rawRef = String(r[refKeyHeader] || '').trim();
    
    var refKey = 'HR'; // Default to HR
    if(rawRef && rawRef.toLowerCase() !== 'direct' && rawRef.toLowerCase() !== 'n/a' && rawRef !== '0') {
      var idMatch = rawRef.match(/\d{4,}/);
      if(idMatch) {
        var id = idMatch[0];
        refKey = 'ID: ' + id;
        if(!idToName[id]) {
          var nameOnly = rawRef.replace('Id no - ','').replace('name - ','').replace('Name - ','').replace(id, '').replace(/[-]/g,'').trim();
          if(nameOnly) idToName[id] = nameOnly;
        }
      }
    }
    refMap[refKey] = (refMap[refKey]||0) + 1;
    
    // Months
    var dt = r['Date of Joining'] || r['Joining Date'] || r['Hired Date'] || r['Date'] || '';
    var mLabel = 'Unknown';
    if(dt) {
      var dObj = parseSheetDate(dt);
      if(dObj) mLabel = dObj.toLocaleString('default', { month: 'short', year: '2-digit' });
    }
    monthMap[mLabel] = (monthMap[mLabel]||0) + 1;
  });

  // Top 3 Referrers
  var top3List = Object.keys(refMap)
    .filter(function(k){ return k.startsWith('ID: '); })
    .sort(function(a,b){ return refMap[b] - refMap[a]; })
    .slice(0, 3)
    .map(function(k){
      var id = k.replace('ID: ','');
      return (idToName[id] || id) + ' ('+refMap[k]+')';
    }).join(', ');

  // KPIs
  var teamKpis = [
    {l:'TOTAL EMPLOYEES', v:total, s:'Active on roster', c:'#60a5fa'},
    {l:'TOTAL LOCATIONS', v:Object.keys(locMap).length, s:'Total Branches', c:'#22c55e'},
    {l:'NEW ONBOARDED',   v:monthMap[new Date().toLocaleString('default',{month:'short',year:'2-digit'})]||0, s:'This month', c:'#f59e0b'},
    {l:'TOP REFERRERS',   v:top3List || 'None', s:'Top 3 performers', c:'#a78bfa'}
  ];
  var kpiEl = document.getElementById('teamKpiGrid');
  if(kpiEl) kpiEl.innerHTML = teamKpis.map(function(k){
    return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div>'
          +'<div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div>'
          +'<div class="kpi-sub">'+k.s+'</div></div>';
  }).join('');

  // Charts
  killChart('chTeamLoc');
  var cLoc = document.getElementById('chartTeamLoc');
  if(cLoc) CI.chTeamLoc = new Chart(cLoc, {
    type:'pie', data:{
      labels:Object.keys(locMap), 
      datasets:[{data:Object.values(locMap), backgroundColor:SHEET_COLORS, borderWidth:0}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#94a3b8',font:{size:10}}}}}
  });

  killChart('chTeamDesig');
  var cDes = document.getElementById('chartTeamDesig');
  var desKeys = Object.keys(desigMap).sort((a,b)=>desigMap[b]-desigMap[a]);
  if(cDes) CI.chTeamDesig = new Chart(cDes, {
    type:'doughnut', data:{
      labels:desKeys, 
      datasets:[{data:desKeys.map(k=>desigMap[k]), backgroundColor:SHEET_COLORS.slice().reverse(), borderWidth:0}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{position:'right',labels:{color:'#94a3b8',font:{size:10}}},
        datalabels: {
          color: '#fff', font: { weight: 'bold', size: 10 },
          formatter: function(val) { return val > 1 ? val : ''; },
          anchor: 'center', align: 'center'
        }
      },
      cutout:'65%'
    }
  });

  killChart('chTeamMonth');
  var mKeys = Object.keys(monthMap).sort((a,b)=>new Date('01 '+a)-new Date('01 '+b));
  var cMonth = document.getElementById('chartTeamMonth');
  if(cMonth) CI.chTeamMonth = new Chart(cMonth, {
    type:'bar', data:{
      labels:mKeys, 
      datasets:[{label:'Hired', data:mKeys.map(k=>monthMap[k]), backgroundColor:'#38bdf8', borderRadius:4}]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#64748b'}},y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#64748b'}}}}
  });

  killChart('chTeamRef');
  var rKeysRaw = Object.keys(refMap).filter(k=>k.toLowerCase()!=='direct' && k.toLowerCase()!=='n/a' && k!=='0' && k!=='');
  var rKeys = rKeysRaw.sort((a,b)=>refMap[b]-refMap[a]).slice(0,8);
  var cRef = document.getElementById('chartTeamRef');
  if(cRef) {
    CI.chTeamRef = new Chart(cRef, {
      type:'bar', data:{
        labels: rKeys.map(function(k){
          if(k.startsWith('ID: ')) {
            var id = k.replace('ID: ','');
            return (idToName[id] ? idToName[id] + ' ('+id+')' : k);
          }
          return k;
        }), 
        datasets:[{label:'Referrals', data:rKeys.map(k=>refMap[k]), backgroundColor:'#a78bfa', borderRadius:4}]
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          datalabels: {
            color: '#fff', anchor: 'end', align: 'end', offset: 4,
            font: { weight: 'bold', size: 11 },
            formatter: function(val) { return val; }
          }
        },
        scales:{x:{grid:{display:false},ticks:{color:'#64748b'}},y:{grid:{display:false},ticks:{color:'#64748b'}}},
        onClick: function(e, activeEls) {
          if(!activeEls.length) return;
          var idx = activeEls[0].index;
          var key = rKeys[idx]; // The ID Key (e.g. "ID: 1571")
          var idOnly = key.replace('ID: ','');
          
          var referred = data.filter(function(emp){
            var keys = Object.keys(emp);
            var refH = keys.find(k => k.toLowerCase().indexOf('refer') !== -1) || keys[7];
            var refVal = String(emp[refH] || '');
            return refVal.indexOf(idOnly) !== -1;
          });
          
          if(!referred.length) return;
          
          var title = (idToName[idOnly] || idOnly);
          document.getElementById('teamModalTitle').innerText = 'Referred by: ' + title;
          var html = '<table style="width:100%;border-collapse:collapse;margin-top:10px">';
          html += '<tr style="border-bottom:1px solid var(--b1);color:var(--m1)"><th style="text-align:left;padding:8px">Employee</th><th style="text-align:left;padding:8px">Designation</th><th style="text-align:left;padding:8px">Joined</th></tr>';
          referred.forEach(function(emp){
            var name = emp['Name as per Govt ID'] || emp['Name'] || 'Unknown';
            var dsg = emp['Designation'] || emp['Role'] || '-';
            var jdt = emp['Date of Joining'] || emp['Joining Date'] || '-';
            html += '<tr style="border-bottom:1px solid var(--s1)"><td style="padding:8px">'+name+'</td><td style="padding:8px">'+dsg+'</td><td style="padding:8px">'+jdt+'</td></tr>';
          });
          html += '</table>';
          document.getElementById('teamModalBody').innerHTML = html;
          document.getElementById('teamDetailModal').style.display = 'flex';
        }
      }
    });
  }
}

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function(){
  loadRegistry();
  if(window.refreshKeyBadge) refreshKeyBadge();
  renderSheetList();
  renderSheetDropdown();
  populateAnaSelectors();

  // Sync the outlet of the active sheet, or the first outlet
  if(SHEET_REGISTRY.length) {
    var targetOutlet = activeSheetId ? activeSheetId.split('__')[0] : SHEET_REGISTRY[0].id;
    syncOneSheet(targetOutlet);
  }
});
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// MIS 4-TAB INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════

function switchMisTab(id, btn) {
  ['pl','visuals','advice','bi'].forEach(function(t){
    var el = document.getElementById('misTab-'+t);
    if(el) el.style.display = t===id ? 'block' : 'none';
  });
  document.querySelectorAll('#page-mis .stab-btn').forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  if(id==='visuals') buildMisVisuals();
  if(id==='advice')  buildMisAdvice();
  if(id==='bi')      buildMisBI();
}

// KEY FIX: parentCat propagates down to sub-rows
// KEY FIX: parentCat propagates down to sub-rows
function parseMisRows(data) {
  var rows = [], currentCat = '';
  for(var i=2; i<data.length; i++) {
    var r = data[i];
    if(!r[0] && !r[1]) continue;
    var isHdr = !!(r[0] && !r[1]);
    if(r[0]) currentCat = String(r[0]);
    var rrRaw=r[2], tgRaw=r[5], mtdRaw=r[4];
    rows.push({
      cat:       String(r[0]||''),
      sub:       String(r[1]||''),
      parentCat: currentCat,
      rr:    typeof rrRaw==='number'  ? rrRaw  : (parseFloat(rrRaw)||0),
      rrPct: r[3],
      mtd:   typeof mtdRaw==='number' ? mtdRaw : (parseFloat(mtdRaw)||0),
      tg:    typeof tgRaw==='number'  ? tgRaw  : (parseFloat(tgRaw)||0),
      tgPct: r[6],
      isHdr: isHdr
    });
  }
  return rows;
}

function isRevRow(r) {
  return r.parentCat.toLowerCase().indexOf('revenue') !== -1;
}

function renderMIS() {
  var data = window.MIS_DATA;
  if(!data || !data.length) return;
  var isPL = data[1] && String(data[1][0]).toLowerCase().indexOf('category') !== -1;
  var rows = isPL ? parseMisRows(data) : [];

  // KEY FIX: Differentiate between "Total" rows and individual "Head" rows
  var totRowRev = rows.find(function(r){ 
    var full = (r.cat + ' ' + r.sub).toLowerCase();
    return full.indexOf('total') !== -1 && (full.indexOf('revenue') !== -1 || full.indexOf('income') !== -1);
  });
  var totRowCost = rows.find(function(r){ 
    var full = (r.cat + ' ' + r.sub).toLowerCase();
    return full.indexOf('total') !== -1 && (full.indexOf('expenditure') !== -1 || full.indexOf('cost') !== -1 || full.indexOf('expense') !== -1 || full.indexOf('operating cost') !== -1);
  });
  var totRowNOI = rows.find(function(r){ 
    var full = (r.cat + ' ' + r.sub).toLowerCase();
    return full.indexOf('net operating income') !== -1 || full.indexOf('operating profit') !== -1;
  });

  var revSubs  = rows.filter(function(r){ 
    return !r.isHdr && isRevRow(r) && (r.cat+r.sub).toLowerCase().indexOf('total') === -1; 
  });
  var costSubs = rows.filter(function(r){ 
    return !r.isHdr && !isRevRow(r) && r.rr>0 && (r.cat+r.sub).toLowerCase().indexOf('total') === -1; 
  });

  var totRev   = totRowRev ? totRowRev.rr : revSubs.reduce(function(a,r){return a+r.rr;},0);
  var totCost  = totRowCost ? totRowCost.rr : costSubs.reduce(function(a,r){return a+r.rr;},0);
  var totNOI   = totRowNOI ? totRowNOI.rr : (totRev - totCost);
  var noiPct   = totRev > 0 ? (totNOI / totRev * 100) : 0;
  var totTgt   = totRowRev ? totRowRev.tg : revSubs.reduce(function(a,r){return a+r.tg;},0);
  var ach      = totTgt>0 ? (totRev/totTgt*100) : 0;

  var kpiEl = document.getElementById('misKpiStrip');
  if(kpiEl) {
    kpiEl.innerHTML = [
      {l:'RUN RATE REVENUE',    v:'\u20b9'+fmtN(totRev),      c:'var(--grn)',  s:totRowRev ? 'From: '+(totRowRev.sub||totRowRev.cat) : 'Calculated Sum'},
      {l:'TOTAL EXPENDITURE',   v:'\u20b9'+fmtN(totCost),     c:'var(--red)',  s:totRowCost ? 'From: '+(totRowCost.sub||totRowCost.cat) : 'Calculated Sum'},
      {l:'NET OPERATING INCOME',v:'\u20b9'+fmtN(totNOI),      c:'#facc15',     s:noiPct.toFixed(1)+'% of Revenue'},
      {l:'OPS EFFICIENCY',      v:noiPct.toFixed(1)+'%',      c:noiPct>25?'var(--grn)':'var(--amb)', s:'Profit Conversion Rate'},
      {l:'TARGET ACHIEVEMENT',  v:ach.toFixed(1)+'%',          c:ach>=100?'var(--grn)':ach>=80?'var(--amb)':'var(--red)', s:'vs monthly target'},
    ].map(function(k){
      return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div>'
        +'<div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div>'
        +'<div class="kpi-sub">'+k.s+'</div></div>';
    }).join('');
  }

  // Action Pointers
  var pointers = [];
  data.forEach(function(r){ var t=String(r[0]||''); if(t.indexOf('>')===0||t.indexOf('\u2022')===0) pointers.push(t.replace(/^[>\u2022]\s*/, '')); });
  var apEl = document.getElementById('misActionPointers');
  if(apEl) apEl.innerHTML = pointers.length ? '<div class="card card-body" style="margin-bottom:12px;border-left:4px solid var(--amb)">'
    +'<div class="card-title" style="color:var(--amb)">\ud83d\ude80 Strategic Action Pointers</div>'
    +'<div style="display:flex;flex-direction:column;gap:8px">'
    +pointers.map(function(p){ return '<div style="display:flex;gap:10px;font-size:13px"><span style="color:var(--amb);font-weight:900">\u2192</span><span>'+p+'</span></div>'; }).join('')
    +'</div></div>' : '';

  // P&L Table
  var tlEl = document.getElementById('misPLTable');
  if(!tlEl) { window._misRows=rows; window._misCostSubs=costSubs; window._misRevSubs=revSubs; return; }
  if(isPL && rows.length) {
    var tbl = '<div class="card card-body"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div class="card-title" style="margin:0">Financial P&amp;L Summary</div>'
      +'<div style="font-size:10px;color:var(--m1);text-transform:uppercase;letter-spacing:1px">Run Rate \u00b7 MTD \u00b7 Target</div></div>'
      +'<div class="tbl-scroll"><table><thead><tr>'
      +'<th>Category</th><th>Sub Category</th><th class="num">Run Rate</th><th class="num">RR%</th>'
      +'<th class="num">MTD</th><th class="num">Target</th><th class="num">Tgt%</th><th class="num">Status</th>'
      +'</tr></thead><tbody>';
    rows.forEach(function(r){
      var gap = r.tg>0 ? r.rr-r.tg : 0;
      var st  = r.tg>0 ? (r.rr>=r.tg ? '<span style="color:var(--grn);font-weight:700">\u2713 On Track</span>'
                                      : '<span style="color:var(--red);font-weight:700">\u26a0 \u20b9'+fmtN(Math.abs(gap))+'</span>') : '';
      var bg  = r.isHdr ? 'background:var(--s2);font-weight:800' : '';
      var pct = function(v){ return v ? (typeof v==='number' ? (v*100).toFixed(1)+'%' : v) : ''; };
      tbl += '<tr style="'+bg+'"><td>'+r.cat+'</td><td style="font-size:11px;color:var(--m1)">'+r.sub+'</td>'
        +'<td class="num">'+(r.rr?'\u20b9'+fmtN(r.rr):'')+'</td>'
        +'<td class="num" style="color:var(--m1)">'+pct(r.rrPct)+'</td>'
        +'<td class="num">'+(r.mtd?'\u20b9'+fmtN(r.mtd):'')+'</td>'
        +'<td class="num">'+(r.tg?'\u20b9'+fmtN(r.tg):'')+'</td>'
        +'<td class="num" style="color:var(--m1)">'+pct(r.tgPct)+'</td>'
        +'<td class="num">'+st+'</td></tr>';
    });
    tbl += '</tbody></table></div></div>';
    tlEl.innerHTML = tbl;
  } else {
    var raw = '<div class="card card-body"><div class="card-title">MIS Raw Data</div><div class="tbl-scroll"><table>';
    data.forEach(function(r,i){ raw+='<tr>'; r.forEach(function(c){ raw+='<td style="'+(i===0?'background:var(--s2);font-weight:800':'')+'">'+(c||'')+'</td>'; }); raw+='</tr>'; });
    raw += '</table></div></div>';
    tlEl.innerHTML = raw;
  }
  window._misRows = rows;
  window._misCostSubs = costSubs;
  window._misRevSubs  = revSubs;
}

function buildMisVisuals() {
  var rows     = window._misRows     || [];
  var costSubs = window._misCostSubs || [];
  var revSubs  = window._misRevSubs  || [];
  if(!rows.length) return;

  var totRev  = revSubs.reduce(function(a,r){return a+r.rr;},0);
  var totCost = costSubs.reduce(function(a,r){return a+r.rr;},0);
  var netMargin = totRev - totCost;

  // Chart 1: Rev vs Cost vs Net Margin
  killChart('chMisRevCost');
  var c1=document.getElementById('chartMisRevCost');
  if(c1) CI.chMisRevCost = new Chart(c1,{
    type:'bar',
    data:{labels:['Revenue','Total Costs','Net Margin'],
      datasets:[{data:[totRev,totCost,netMargin],
        backgroundColor:['rgba(34,197,94,0.75)','rgba(239,68,68,0.75)','rgba(59,130,246,0.75)'],borderRadius:10,barThickness:60}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return '\u20b9'+fmtN(c.raw);}}}},
      scales:{y:{ticks:{color:'#64748b',callback:function(v){return '\u20b9'+fmtN(v);}},grid:{color:'rgba(255,255,255,0.04)'}},
              x:{ticks:{color:'#f8fafc',font:{size:13,weight:'700'}},grid:{display:false}}}}
  });

  // Chart 2: Cost breakdown by category (group-level headers only)
  var costHdrs = rows.filter(function(r){ return r.isHdr && !isRevRow(r) && r.rr>0; });
  if(!costHdrs.length) costHdrs = costSubs.slice(0,8); // fallback to sub-rows
  killChart('chMisCostPie');
  var c2=document.getElementById('chartMisCostPie');
  var PIE_COLORS=['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
  if(c2 && costHdrs.length) CI.chMisCostPie = new Chart(c2,{
    type:'doughnut',
    data:{labels:costHdrs.map(function(r){return r.cat||r.sub;}),
      datasets:[{data:costHdrs.map(function(r){return r.rr;}),
        backgroundColor:PIE_COLORS,borderWidth:2,borderColor:'rgba(0,0,0,0.3)',hoverOffset:10}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',
      plugins:{legend:{position:'right',labels:{color:'#94a3b8',font:{size:11},boxWidth:12,padding:8}}}}
  });

  // Chart 3: Cost category RR vs Target (top 10 cost sub-rows)
  var top10 = costSubs.slice(0,10);
  killChart('chMisRRvsTgt');
  var c3=document.getElementById('chartMisRRvsTgt');
  if(c3 && top10.length) CI.chMisRRvsTgt = new Chart(c3,{
    type:'bar',
    data:{labels:top10.map(function(r){return (r.sub||r.cat).substring(0,20);}),
      datasets:[
        {label:'Run Rate',data:top10.map(function(r){return r.rr;}),backgroundColor:'rgba(59,130,246,0.7)',borderRadius:5},
        {label:'Target',  data:top10.map(function(r){return r.tg;}),backgroundColor:'rgba(245,158,11,0.4)',borderRadius:5}
      ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#94a3b8',font:{size:11}}}},
      scales:{y:{ticks:{color:'#64748b',callback:function(v){return '\u20b9'+fmtN(v);}},grid:{color:'rgba(255,255,255,0.04)'}},
              x:{ticks:{color:'#94a3b8',font:{size:9},maxRotation:40},grid:{display:false}}}}
  });

  // Chart 4: Waterfall (Rev → Cost categories → Net)
  var costCats = rows.filter(function(r){ return r.isHdr && !isRevRow(r) && r.rr>0; }).slice(0,6);
  var wfLbl=['Revenue'], wfDat=[totRev], run=totRev;
  costCats.forEach(function(r){ wfLbl.push(r.cat.substring(0,16)); wfDat.push(-r.rr); run-=r.rr; });
  wfLbl.push('Net'); wfDat.push(run);
  killChart('chMisWaterfall');
  var c4=document.getElementById('chartMisWaterfall');
  if(c4) CI.chMisWaterfall = new Chart(c4,{
    type:'bar',
    data:{labels:wfLbl,
      datasets:[{data:wfDat,
        backgroundColor:wfDat.map(function(v,i){return i===0||i===wfLbl.length-1?'rgba(34,197,94,0.75)':'rgba(239,68,68,0.65)';}),
        borderRadius:7}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return '\u20b9'+fmtN(Math.abs(c.raw));}}}},
      scales:{y:{ticks:{color:'#64748b',callback:function(v){return '\u20b9'+fmtN(v);}},grid:{color:'rgba(255,255,255,0.04)'}},
              x:{ticks:{color:'#94a3b8',font:{size:10}},grid:{display:false}}}}
  });

  // Chart 5: MTD tracker (cost sub-rows only)
  var mtdRows = costSubs.filter(function(r){return r.mtd>0;}).slice(0,10);
  killChart('chMisMTD');
  var c5=document.getElementById('chartMisMTD');
  if(c5 && mtdRows.length) CI.chMisMTD = new Chart(c5,{
    type:'bar',
    data:{labels:mtdRows.map(function(r){return (r.sub||r.cat).substring(0,20);}),
      datasets:[
        {label:'MTD Actual',data:mtdRows.map(function(r){return r.mtd;}),backgroundColor:'rgba(96,165,250,0.75)',borderRadius:5},
        {label:'Target',    data:mtdRows.map(function(r){return r.tg; }),backgroundColor:'rgba(245,158,11,0.3)', borderRadius:5}
      ]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#94a3b8',font:{size:11}}}},
      scales:{x:{ticks:{color:'#64748b',callback:function(v){return '\u20b9'+fmtN(v);}},grid:{color:'rgba(255,255,255,0.04)'}},
              y:{ticks:{color:'#94a3b8',font:{size:10}},grid:{display:false}}}}
  });
}

function buildMisAdvice() {
  var costSubs = window._misCostSubs || [];
  var revSubs  = window._misRevSubs  || [];
  var el = document.getElementById('misAdviceContent');
  if(!el) return;
  if(!revSubs.length && !costSubs.length) {
    el.innerHTML='<div class="card card-body" style="text-align:center;padding:40px;color:var(--m1)">Sync data first.</div>'; return;
  }
  var totRev  = revSubs.reduce(function(a,r){return a+r.rr;},0);
  var totTgt  = revSubs.reduce(function(a,r){return a+r.tg;},0);
  var totCost = costSubs.reduce(function(a,r){return a+r.rr;},0);
  var margin  = totRev>0 ? ((totRev-totCost)/totRev*100) : 0;
  var ach     = totTgt>0 ? (totRev/totTgt*100) : 0;
  var topCost = costSubs.slice().sort(function(a,b){return b.rr-a.rr;}).slice(0,3);
  var gapRows = costSubs.filter(function(r){return r.tg>0 && r.rr>r.tg;});

  var items = [
    { icon:'\ud83d\udcb0', title:'Revenue Health',
      color: ach>=100?'var(--grn)':ach>=80?'var(--amb)':'var(--red)',
      body: 'Total run rate \u20b9'+fmtN(totRev)+' is '+ach.toFixed(1)+'% of target \u20b9'+fmtN(totTgt)+'.'
           +(ach<100?' Gap of \u20b9'+fmtN(totTgt-totRev)+' still needs to be closed.':' Target achieved — excellent!')
    },
    { icon:'\u2699\ufe0f', title:'Operating Margin',
      color: margin>35?'var(--grn)':margin>25?'var(--amb)':'var(--red)',
      body: 'Current margin is '+margin.toFixed(1)+'%. '
           +(margin>35?'Healthy — focus on revenue growth.':margin>25?'Acceptable but improvable. Target 35%+.':'Critical — costs consuming revenue. Immediate cost audit needed.')
    },
    { icon:'\ud83d\udd25', title:'Top Cost Pressure',
      color:'var(--amb)',
      body: 'Highest 3 cost lines: '+topCost.map(function(r){return (r.sub||r.cat)+' \u20b9'+fmtN(r.rr);}).join(', ')+'. Attack these first for maximum impact.'
    },
    { icon:'\ud83c\udfaf', title:'Over-Budget Lines',
      color: gapRows.length===0?'var(--grn)':'var(--red)',
      body: gapRows.length===0 ? 'All cost heads are within budget. Great cost discipline!'
           : gapRows.length+' lines over budget: '+gapRows.map(function(r){return (r.sub||r.cat);}).join(', ')+'. Review these immediately.'
    },
    { icon:'\ud83d\udccc', title:'Action Plan',
      color:'var(--blu)',
      body: '1. Review top 3 cost heads weekly. '
           +'2. Daily revenue floor: \u20b9'+fmtN(Math.round(totRev/25))+'/day. '
           +(margin<30?'3. URGENT: reduce costs to reach 30% margin. ':'3. Maintain cost discipline while scaling. ')
           +'4. Compare MTD vs same period last month for trend analysis.'
    }
  ];
  el.innerHTML = items.map(function(i){
    return '<div class="card card-body" style="margin-bottom:12px;border-left:4px solid '+i.color+'">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
        +'<span style="font-size:20px">'+i.icon+'</span>'
        +'<div style="font-size:14px;font-weight:800;color:var(--txt)">'+i.title+'</div>'
      +'</div><div style="font-size:13px;line-height:1.7;color:var(--m2)">'+i.body+'</div></div>';
  }).join('');
}

function buildMisBI() {
  var costSubs = window._misCostSubs || [];
  var revSubs  = window._misRevSubs  || [];
  var el = document.getElementById('misBIContent');
  if(!el) return;
  if(!costSubs.length && !revSubs.length) {
    el.innerHTML='<div class="card card-body" style="text-align:center;padding:40px;color:var(--m1)">Sync data first.</div>'; return;
  }
  var totRev  = revSubs.reduce(function(a,r){return a+r.rr;},0);
  var totTgt  = revSubs.reduce(function(a,r){return a+r.tg;},0);
  var totCost = costSubs.reduce(function(a,r){return a+r.rr;},0);
  var margin  = totRev>0 ? ((totRev-totCost)/totRev*100) : 0;
  var ach     = totTgt>0 ? (totRev/totTgt*100) : 0;
  var effScore = Math.max(0,Math.min(100,(1-(totCost/Math.max(totRev,1)))*100));

  var h = '';
  // Scorecard KPIs
  h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">'
    +[{l:'Cost Efficiency',v:effScore.toFixed(0)+'/100',c:'var(--blu)'},
      {l:'Revenue Target %',v:ach.toFixed(1)+'%',c:ach>=100?'var(--grn)':ach>=80?'var(--amb)':'var(--red)'},
      {l:'Margin Score',v:margin.toFixed(1)+'%',c:margin>=35?'var(--grn)':margin>=25?'var(--amb)':'var(--red)'}
    ].map(function(k){
      return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div>'
            +'<div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div></div>';
    }).join('')+'</div>';

  // Cost Health Monitor — ONLY cost rows
  h += '<div class="card card-body" style="margin-bottom:14px"><div class="card-title">Cost Head Health Monitor</div>'
    +'<div class="tbl-scroll"><table><thead><tr>'
    +'<th>Cost Head</th><th class="num">Run Rate</th><th class="num">Target</th>'
    +'<th class="num">Variance</th><th class="num">% of Rev</th><th class="num">Health</th>'
    +'</tr></thead><tbody>';
  costSubs.forEach(function(r){
    var v = r.rr - r.tg;
    var pRev = totRev>0?(r.rr/totRev*100):0;
    var health = r.tg>0 ? (r.rr<=r.tg?'<span style="color:var(--grn);font-weight:700">\u2713 Good</span>'
                                      :'<span style="color:var(--red);font-weight:700">\u26a0 Over</span>')
                        : '<span style="color:var(--m1)">-</span>';
    h += '<tr><td>'+(r.sub||r.cat)+'</td>'
      +'<td class="num">\u20b9'+fmtN(r.rr)+'</td>'
      +'<td class="num">'+(r.tg?'\u20b9'+fmtN(r.tg):'-')+'</td>'
      +'<td class="num" style="color:'+(v<=0?'var(--grn)':'var(--red)')+'">'+( r.tg?(v<=0?'-':'+')+'  \u20b9'+fmtN(Math.abs(v)):'-')+'</td>'
      +'<td class="num">'+pRev.toFixed(1)+'%</td>'
      +'<td class="num">'+health+'</td></tr>';
  });
  h += '</tbody></table></div></div>';

  // Cost % of Revenue progress bars
  h += '<div class="card card-body" style="margin-bottom:14px"><div class="card-title">Cost as % of Revenue</div>'
    +'<div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">';
  costSubs.filter(function(r){return r.rr>0;}).forEach(function(r){
    var pct=totRev>0?(r.rr/totRev*100):0;
    var bc=pct>20?'var(--red)':pct>10?'var(--amb)':'var(--grn)';
    h += '<div style="display:flex;align-items:center;gap:10px">'
      +'<div style="min-width:130px;font-size:12px;color:var(--m2)">'+(r.sub||r.cat)+'</div>'
      +'<div style="flex:1;background:var(--s2);border-radius:99px;height:7px">'
        +'<div style="width:'+Math.min(pct,100)+'%;height:100%;background:'+bc+';border-radius:99px"></div>'
      +'</div><div style="min-width:40px;font-size:12px;color:var(--txt);text-align:right;font-weight:700">'+pct.toFixed(1)+'%</div>'
      +'</div>';
  });
  h += '</div></div>';

  // Intelligence Flags
  var flags = [];
  if(margin<25)   flags.push({c:'#ef4444',m:'Margin below 25% — immediate cost reduction required.'});
  if(ach<80)      flags.push({c:'#f59e0b',m:'Revenue below 80% of target — accelerate sales.'});
  if(ach>=100)    flags.push({c:'#22c55e',m:'Revenue target achieved — focus on margin improvement.'});
  costSubs.forEach(function(r){
    if(r.tg>0 && r.rr>r.tg*1.1) flags.push({c:'#ef4444',m:(r.sub||r.cat)+' is 10%+ over budget.'});
  });
  if(!flags.length) flags.push({c:'#22c55e',m:'All indicators healthy. Maintain current discipline.'});

  h += '<div class="card card-body" style="border-left:4px solid var(--blu)">'
    +'<div class="card-title" style="color:var(--blu)">\ud83c\udfaf Strategic Intelligence Flags</div>'
    +'<div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">'
    +flags.map(function(f){
      return '<div style="display:flex;align-items:flex-start;gap:10px;font-size:13px;line-height:1.6">'
            +'<span style="color:'+f.c+';font-weight:800;font-size:16px">\u25cf</span>'
            +'<span style="color:var(--m2)">'+f.m+'</span></div>';
    }).join('')+'</div></div>';

  el.innerHTML = h;
}


function getActiveSheet() {
  return SHEET_DATA[activeSheetId];
}

function buildAnOverview() {
  if(!window.REV || !window.REV.length) return;
  
  var rev = window.REV;
  var rm  = window.RM || [];
  var cp  = window.CP || [];
  var pkg = window.PKG || [];
  var gas = window.GASV || [];
  
  var totRev = sum(rev);
  var totVar = sum(rm) + sum(cp) + sum(pkg) + sum(gas);
  
  // 1. Operating Margin (Gross)
  var margin = totRev > 0 ? ((totRev - totVar) / totRev) * 100 : 0;
  document.getElementById('anKpiMargin').innerText = margin.toFixed(1) + '%';
  document.getElementById('anKpiMarginSub').innerText = 'Efficiency: ' + (margin > 30 ? 'High' : 'Optimal') + ' range';
  
  // 2. Run Rate (Linear Projection)
  var daysElapsed = rev.filter(function(v){return v > 0}).length || 1;
  var monthDays = window.MONTH_DAYS || 30;
  var dAvg = totRev / daysElapsed;
  var runRate = (window.RUN_RATES && window.RUN_RATES['Net Revenue']) ? window.RUN_RATES['Net Revenue'] : (dAvg * monthDays);
  document.getElementById('anKpiRunRate').innerText = '₹' + fmtN(runRate);
  document.getElementById('anKpiRunRateSub').innerText = 'Pace: ₹' + fmtN(dAvg) + ' / day';
  
  // 3. Peak Day
  var peak = Math.max.apply(null, rev);
  document.getElementById('anKpiPeak').innerText = '₹' + fmtN(peak);
  document.getElementById('anKpiPeakSub').innerText = 'Max potential recorded';

  // 4. Momentum Chart (7-Day Moving Average)
  var roll7 = rev.map(function(_, i) {
    if(i < 6) return null;
    var slice = rev.slice(i-6, i+1);
    return sum(slice) / 7;
  });
  
  killChart('chAnRevTrend');
  var cTrend = document.getElementById('chartAnRevTrend');
  if(cTrend) CI.chAnRevTrend = new Chart(cTrend, {
    type: 'line',
    data: {
      labels: window.DATES.map(function(d){return d.split(' ')[1] || d}),
      datasets: [
        { label: 'Daily Revenue', data: rev, borderColor: 'rgba(96, 165, 250, 0.2)', borderWidth: 1, pointRadius: 0, fill: false },
        { label: 'Momentum (7d)', data: roll7, borderColor: '#3b82f6', borderWidth: 3, pointRadius: 0, tension: 0.4, fill: false }
      ]
    },
    options: { 
      responsive:true, maintainAspectRatio:false, 
      plugins:{legend:{display:false}, tooltip:{mode:'index', intersect:false}}, 
      scales:{
        y:{grid:{color:'rgba(255,255,255,0.03)'}, ticks:{color:'#64748b', callback: function(v){return (v/1000).toFixed(0)+'k'}}},
        x:{grid:{display:false}, ticks:{color:'#64748b', maxTicksLimit: 10}}
      }
    }
  });

  // 5. Daily Margin Trend Chart
  var dailyMargins = rev.map(function(r, i) {
    if(!r) return 0;
    var v = (rm[i]||0) + (cp[i]||0) + (pkg[i]||0) + (gas[i]||0);
    return ((r - v) / r) * 100;
  });

  killChart('chAnMargin');
  var cMargin = document.getElementById('chartAnMargin');
  if(cMargin) CI.chAnMargin = new Chart(cMargin, {
    type: 'line',
    data: {
      labels: window.DATES.map(function(d){return d.split(' ')[1] || d}),
      datasets: [{
        label: 'Margin %',
        data: dailyMargins,
        borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2
      }]
    },
    options: { 
      responsive:true, maintainAspectRatio:false, 
      plugins:{legend:{display:false}}, 
      scales:{
        y:{grid:{color:'rgba(255,255,255,0.03)'}, ticks:{color:'#64748b', callback:function(v){return v+'%'}}},
        x:{grid:{display:false}, ticks:{color:'#64748b', maxTicksLimit: 10}}
      }
    }
  });
}

function buildAnBenchmark() {
  if(!window.REV || !window.REV.length) return;
  
  var todayIdx = window.REV.findLastIndex(function(v){return v > 0});
  if(todayIdx === -1) todayIdx = window.REV.length - 1;
  
  var todayVal = window.REV[todayIdx];
  function getDayOfWeek(dateStr) {
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var parts = dateStr.split(' ');
    return parts.length > 0 ? days.indexOf(parts[0]) : -1;
  }

  var targetDOW = getDayOfWeek(window.DATES[todayIdx]);
  
  var sameDOWData = [];
  Object.keys(SHEET_DATA).forEach(function(k) {
    var sh = SHEET_DATA[k];
    if(!sh.DATES || !sh.REV) return;
    sh.DATES.forEach(function(dStr, i) {
      var val = sh.REV[i];
      if(getDayOfWeek(dStr) === targetDOW && val > 0 && !(k === activeSheetId && i === todayIdx)) {
        sameDOWData.push(val);
      }
    });
  });
  
  var recent4 = sameDOWData.slice(-4);
  var avg4 = recent4.length > 0 ? sum(recent4) / recent4.length : 0;
  if(avg4 === 0) avg4 = todayVal * 0.9; 


  var diff = todayVal - avg4;
  var pct = (diff / avg4) * 100;
  
  var grid = document.getElementById('anBenchmarkGrid');
  if(grid) {
    grid.innerHTML = `
      <div class="kpi-card" style="padding:12px 15px">
        <div class="kpi-lbl" style="font-size:9px">TARGET INDEX</div>
        <div class="kpi-val" style="color:var(--txt);font-size:20px">₹${fmtN(todayVal)}</div>
        <div class="kpi-sub" style="font-size:10px">Today's Actuals</div>
      </div>
      <div class="kpi-card" style="padding:12px 15px">
        <div class="kpi-lbl" style="font-size:9px">MARKET AVG</div>
        <div class="kpi-val" style="color:var(--m1);font-size:20px">₹${fmtN(avg4)}</div>
        <div class="kpi-sub" style="font-size:10px">Last 4-week mean</div>
      </div>
      <div class="kpi-card" style="padding:12px 15px">
        <div class="kpi-lbl" style="font-size:9px">GROWTH DELTA</div>
        <div class="kpi-val" style="color:${pct>=0?'var(--grn)':'var(--red)'};font-size:20px">${pct>=0?'+':''}${pct.toFixed(1)}%</div>
        <div class="kpi-sub" style="font-size:10px">${pct>=0?'Outperforming':'Underperforming'}</div>
      </div>
    `;
  }

  killChart('chAnBenchmark');
  var cBench = document.getElementById('chartAnBenchmark');
  if(cBench) CI.chAnBenchmark = new Chart(cBench, {
    type: 'bar',
    data: {
      labels: ['Historical Benchmark', 'Current Performance'],
      datasets: [{
        data: [avg4, todayVal],
        backgroundColor: ['rgba(255,255,255,0.15)', 'var(--amb)'],
        borderRadius: 12, barThickness: 80
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      layout: { padding: { top: 35 } },
      plugins:{
        legend:{display:false},
        datalabels: {
          color: '#fff', font: { weight: 'bold', size: 12 },
          formatter: function(v){ return '₹' + fmtN(v); }, anchor: 'end', align: 'top',
          offset: 5
        }
      },
      scales:{
        y:{display:false, suggestedMax: Math.max(avg4, todayVal) * 1.2},
        x:{ticks:{color:'#f8fafc', font:{size:12, weight:'700'}}, grid:{display:false}}
      }
    }
  });
}

// ═══════════════════════════════════════════════
// SALES DETAIL LOGIC
// ═══════════════════════════════════════════════
window.activeSalesSubTab = window.activeSalesSubTab || 'overview';

window.switchSalesTab = function(tab, btn) {
  window.activeSalesSubTab = tab;
  
  // Toggle tab contents
  ['overview', 'channels', 'daycompare', 'slots', 'datatables'].forEach(function(t) {
    var el = document.getElementById('salesTab-' + t);
    if (el) el.style.display = (t === tab) ? 'block' : 'none';
  });
  
  // Update active tab button
  document.querySelectorAll('#page-salesdetail .stab-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  if (btn) {
    btn.classList.add('active');
  }
  
  // Toggle visibility of slot filter (only needed for slots and datatables)
  var slotFilter = document.getElementById('salesSlotFilter');
  if (slotFilter) {
    if (tab === 'slots' || tab === 'datatables') {
      slotFilter.style.display = 'inline-block';
    } else {
      slotFilter.style.display = 'none';
    }
  }
  
  buildSalesDetailCharts();
};

function getDayNameFromDate(dateStr) {
  if(!dateStr) return '';
  var d = new Date(dateStr);
  if(isNaN(d.getTime())) return '';
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()];
}

function fmtDateShort(dateStr) {
  if(!dateStr) return '';
  var parts = dateStr.split('-');
  if(parts.length < 3) return dateStr;
  var mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return parseInt(parts[2]) + ' ' + mNames[parseInt(parts[1]) - 1];
}

function getWeekdayBaseline(allData, weekday, selectedMonth) {
  var baselineRows = allData.filter(function(row) {
    var isAllDay = row.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
    if (!isAllDay) return false;
    if (!row.Date) return false;
    
    // Exclude currently selected month
    if (selectedMonth !== 'all' && row.Date.indexOf(selectedMonth) === 0) return false;
    
    return getDayNameFromDate(row.Date) === weekday;
  });
  
  baselineRows.sort(function(a, b) { return b.Date.localeCompare(a.Date); });
  var recent4 = baselineRows.slice(0, 4);
  
  if (recent4.length === 0) {
    recent4 = allData.filter(function(row) {
      var isAllDay = row.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
      if (!isAllDay) return false;
      if (!row.Date) return false;
      return getDayNameFromDate(row.Date) === weekday;
    });
  }
  
  var sumRev = recent4.reduce(function(a, r) { return a + r.GrossRevenue; }, 0);
  var sumOrd = recent4.reduce(function(a, r) { return a + r.TotalOrders; }, 0);
  
  return {
    rev: recent4.length > 0 ? sumRev / recent4.length : 0,
    ord: recent4.length > 0 ? sumOrd / recent4.length : 0
  };
}

function getCompareData(allData, selectedMonth, offsetMonths) {
  if (!selectedMonth || selectedMonth === 'all') return null;
  
  var parts = selectedMonth.split('-');
  var curYear = parseInt(parts[0]);
  var curMonth = parseInt(parts[1]);
  
  var targetYear = curYear;
  var targetMonth = curMonth - offsetMonths;
  while (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }
  
  var targetMonthStr = targetYear + '-' + (targetMonth < 10 ? '0' + targetMonth : targetMonth);
  
  var curRows = allData.filter(function(r) {
    return r.Date && r.Date.indexOf(selectedMonth) === 0 && r.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
  });
  
  if (curRows.length === 0) return null;
  
  var curDays = curRows.map(function(r) {
    var dParts = r.Date.split('-');
    return dParts.length > 2 ? parseInt(dParts[2]) : 0;
  }).filter(function(d) { return d > 0; });
  
  if (curDays.length === 0) return null;
  var maxDay = Math.max.apply(null, curDays);
  
  var targetRows = allData.filter(function(r) {
    if (!r.Date || r.Date.indexOf(targetMonthStr) !== 0 || r.MealSlot.toUpperCase().indexOf('ALL DAY') === -1) return false;
    var dParts = r.Date.split('-');
    var day = dParts.length > 2 ? parseInt(dParts[2]) : 0;
    return day > 0 && day <= maxDay;
  });
  
  if (targetRows.length === 0) return null;
  
  var curGross = curRows.reduce(function(a, r) { return a + r.GrossRevenue; }, 0);
  var curOrders = curRows.reduce(function(a, r) { return a + r.TotalOrders; }, 0);
  
  var tgtGross = targetRows.reduce(function(a, r) { return a + r.GrossRevenue; }, 0);
  var tgtOrders = targetRows.reduce(function(a, r) { return a + r.TotalOrders; }, 0);
  
  var sssg = tgtGross > 0 ? ((curGross - tgtGross) / tgtGross * 100) : 0;
  var sstg = tgtOrders > 0 ? ((curOrders - tgtOrders) / tgtOrders * 100) : 0;
  
  var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var targetMonthLabel = monthNames[targetMonth - 1] + ' ' + targetYear;
  
  return {
    curGross: curGross,
    curOrders: curOrders,
    tgtGross: tgtGross,
    tgtOrders: tgtOrders,
    sssg: sssg,
    sstg: sstg,
    daysCompared: maxDay,
    targetMonthLabel: targetMonthLabel
  };
}

function buildSalesDetailCharts() {
  var activeOutletId = activeSheetId ? activeSheetId.split('__')[0] : '';
  if (!activeOutletId && SHEET_REGISTRY.length) {
    activeOutletId = SHEET_REGISTRY[0].id;
  }
  
  var data = (window.SALES_SUMMARY_DATA && activeOutletId) ? window.SALES_SUMMARY_DATA[activeOutletId] : null;
  if (!data || !data.length) {
    var kpiGrid = document.getElementById('salesKpiGrid');
    if (kpiGrid) kpiGrid.innerHTML = '<div style="padding:20px;color:var(--m1);grid-column: span 2;">Sync "Sales summary" tab on Data Source page to view details.</div>';
    
    var salesLogBody = document.getElementById('salesLogBody');
    if (salesLogBody) salesLogBody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--m1)">No data available.</td></tr>';
    return;
  }
  
  var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var uniqueMonths = {};
  data.forEach(function(row) {
    if (!row.Date) return;
    var parts = row.Date.split('-');
    if (parts.length < 2) return;
    var y = parts[0];
    var mIdx = parseInt(parts[1]) - 1;
    var mName = monthNames[mIdx] + ' ' + y;
    uniqueMonths[mName] = parts[0] + '-' + parts[1];
  });
  
  var sortedMonths = Object.keys(uniqueMonths).sort(function(a, b) {
    return uniqueMonths[a].localeCompare(uniqueMonths[b]);
  });
  
  var monthFilter = document.getElementById('salesMonthFilter');
  var prevMonthVal = monthFilter.value;
  var lastOutletId = monthFilter.dataset.outletId || '';
  
  if (lastOutletId !== activeOutletId) {
    monthFilter.innerHTML = '';
    monthFilter.dataset.outletId = activeOutletId;
    prevMonthVal = '';
  }
  
  if (monthFilter.options.length <= 1 || !prevMonthVal) {
    var html = '<option value="all">All Months</option>';
    sortedMonths.forEach(function(m) {
      var selected = (prevMonthVal === uniqueMonths[m]) ? ' selected' : '';
      html += '<option value="' + uniqueMonths[m] + '"' + selected + '>' + m + '</option>';
    });
    monthFilter.innerHTML = html;
    
    if ((!prevMonthVal || prevMonthVal === 'all') && sortedMonths.length) {
      monthFilter.value = uniqueMonths[sortedMonths[sortedMonths.length - 1]];
    }
  }
  
  var selectedMonth = monthFilter.value;
  var slotFilter = document.getElementById('salesSlotFilter').value;
  
  var filteredData = data.filter(function(row) {
    if (selectedMonth !== 'all') {
      if (!row.Date || row.Date.indexOf(selectedMonth) !== 0) return false;
    }
    return true;
  });
  
  var specificSlot = (slotFilter !== 'all_slots' && slotFilter !== 'slots_split') ? slotFilter : null;
  
  var kpiData = filteredData.filter(function(row) {
    var isAllDay = row.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
    if (specificSlot) {
      return row.MealSlot === specificSlot;
    } else {
      return isAllDay;
    }
  });
  
  var totalGross = kpiData.reduce(function(a, r){ return a + r.GrossRevenue; }, 0);
  var totalNet = kpiData.reduce(function(a, r){ return a + r.NetRevenue; }, 0);
  var totalTax = kpiData.reduce(function(a, r){ return a + r.TotalTax; }, 0);
  var totalPkg = kpiData.reduce(function(a, r){ return a + r.Packaging; }, 0);
  var totalOrders = kpiData.reduce(function(a, r){ return a + r.TotalOrders; }, 0);
  var totalCancelled = kpiData.reduce(function(a, r){ return a + r.CancelledOrders; }, 0);
  var overallAov = totalOrders > 0 ? (totalGross / totalOrders) : 0;
  var cancelPct = totalOrders > 0 ? (totalCancelled / totalOrders * 100) : 0;
  
  var activeTab = window.activeSalesSubTab || 'overview';
  
  // Render KPI grid
  var kpiGrid = document.getElementById('salesKpiGrid');
  if (kpiGrid) {
    kpiGrid.innerHTML = [
      {l:'GROSS REVENUE', v:'₹'+fmtN(totalGross), s:'Total sales before tax & packaging', c:'var(--grn)'},
      {l:'NET REVENUE', v:'₹'+fmtN(totalNet), s:'Net Sales (Gross - Tax)', c:'#facc15'},
      {l:'TOTAL ORDERS', v:fmtN(totalOrders), s:'Total orders placed', c:'#60a5fa'},
      {l:'AVG ORDER VALUE', v:'₹'+overallAov.toFixed(2), s:'AOV = Gross / Orders', c:'#a78bfa'},
      {l:'CANCELLED ORDERS', v:fmtN(totalCancelled), s:cancelPct.toFixed(1)+'% cancellation rate', c:'var(--red)'},
      {l:'PACKAGING & TAX', v:'₹'+fmtN(totalPkg), s:'Tax subtracted: ₹'+fmtN(totalTax), c:'#38bdf8'}
    ].map(function(k){
      return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div>'
            +'<div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div>'
            +'<div class="kpi-sub">'+k.s+'</div></div>';
    }).join('');
  }
  
  // Render LFL Growth Grid on Overview
  var growthGrid = document.getElementById('salesGrowthGrid');
  if (growthGrid) {
    var momData = getCompareData(data, selectedMonth, 1);
    var yoyData = getCompareData(data, selectedMonth, 12);
    
    var renderGrowthCard = function(title, gData) {
      if (!gData) {
        return '<div style="background:var(--s2); border:1px solid var(--b1); border-radius:12px; padding:16px; text-align:center; color:var(--m1); font-size:11px">'
          + '<div style="font-weight:800; text-transform:uppercase; margin-bottom:8px">' + title + '</div>'
          + 'No historical baseline data found.'
          + '</div>';
      }
      
      var sssgColor = gData.sssg >= 0 ? 'var(--grn)' : 'var(--red)';
      var sstgColor = gData.sstg >= 0 ? 'var(--grn)' : 'var(--red)';
      var sssgSign = gData.sssg >= 0 ? '+' : '';
      var sstgSign = gData.sstg >= 0 ? '+' : '';
      
      return '<div style="background:var(--s2); border:1px solid var(--b1); border-radius:12px; padding:16px">'
        + '<div style="font-size:11px; font-weight:800; color:var(--m1); letter-spacing:0.5px; text-transform:uppercase; margin-bottom:12px">LFL Growth vs ' + gData.targetMonthLabel + '</div>'
        + '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">'
        + '  <span style="font-size:12px; color:var(--m2)">SSSG (Sales Growth)</span>'
        + '  <span style="font-size:14px; font-weight:800; color:' + sssgColor + '">' + sssgSign + gData.sssg.toFixed(1) + '%</span>'
        + '</div>'
        + '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">'
        + '  <span style="font-size:12px; color:var(--m2)">SSTG (Orders Growth)</span>'
        + '  <span style="font-size:14px; font-weight:800; color:' + sstgColor + '">' + sstgSign + gData.sstg.toFixed(1) + '%</span>'
        + '</div>'
        + '<div style="font-size:9px; color:var(--m1); margin-top:10px; border-top:1px solid var(--b1); padding-top:6px">Matched Day Range: Days 1-' + gData.daysCompared + '</div>'
        + '</div>';
    };
    
    if (selectedMonth === 'all') {
      growthGrid.innerHTML = '<div style="grid-column: span 2; text-align:center; padding:16px; color:var(--m1); font-size:11px">Select a specific month to view growth comparisons.</div>';
    } else {
      growthGrid.innerHTML = renderGrowthCard('Month-over-Month (MoM)', momData) + renderGrowthCard('Year-over-Year (YoY)', yoyData);
    }
  }

  // Populate charts/tables based on active sub-tab
  if (activeTab === 'overview') {
    killChart('chSalesTrend');
    killChart('chSalesChannelShare');
    
    var datesSet = {};
    filteredData.forEach(function(r) { if (r.Date) datesSet[r.Date] = true; });
    var sortedDates = Object.keys(datesSet).sort();
    var dailyLabels = sortedDates.map(function(d) {
      var parts = d.split('-');
      if (parts.length < 3) return d;
      var mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return parseInt(parts[2]) + ' ' + mNames[parseInt(parts[1]) - 1];
    });
    
    var dailyGross = [];
    var dailyNet = [];
    sortedDates.forEach(function(d) {
      var dayRows = filteredData.filter(function(r) { return r.Date === d; });
      var allDayRow = dayRows.find(function(r) {
        return r.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
      });
      dailyGross.push(allDayRow ? allDayRow.GrossRevenue : 0);
      dailyNet.push(allDayRow ? allDayRow.NetRevenue : 0);
    });
    
    var canvasTrend = document.getElementById('chartSalesTrend');
    if (canvasTrend) {
      CI.chSalesTrend = new Chart(canvasTrend, {
        type: 'bar',
        data: {
          labels: dailyLabels,
          datasets: [
            { label: 'Gross Revenue', data: dailyGross, backgroundColor: 'rgba(34, 197, 94, 0.75)', borderRadius: 4 },
            { label: 'Net Revenue', data: dailyNet, backgroundColor: 'rgba(245, 158, 11, 0.75)', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: GC }, ticks: { maxTicksLimit: 10 } },
            y: { grid: { color: GC }, ticks: { callback: function(v){ return '₹'+fmtN(v); } } }
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) { return c.dataset.label + ': ₹' + fmtN(c.raw); }
              }
            }
          }
        }
      });
    }
    
    var totalDineIn = kpiData.reduce(function(a, r){ return a + r.DineInRev; }, 0);
    var totalPickup = kpiData.reduce(function(a, r){ return a + r.PickupRev; }, 0);
    var totalDelivery = kpiData.reduce(function(a, r){ return a + r.DeliveryRev; }, 0);
    
    var canvasShare = document.getElementById('chartSalesChannelShare');
    if (canvasShare) {
      CI.chSalesChannelShare = new Chart(canvasShare, {
        type: 'doughnut',
        data: {
          labels: ['Dine-In', 'Pickup', 'Delivery'],
          datasets: [{
            data: [totalDineIn, totalPickup, totalDelivery],
            backgroundColor: ['#22c55e', '#3b82f6', '#a78bfa'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) {
                  var total = totalDineIn + totalPickup + totalDelivery;
                  var pct = total > 0 ? (c.raw / total * 100).toFixed(1) : 0;
                  return c.label + ': ₹' + fmtN(c.raw) + ' (' + pct + '%)';
                }
              }
            }
          }
        }
      });
    }
  } else if (activeTab === 'channels') {
    var totalDineIn = kpiData.reduce(function(a, r){ return a + r.DineInRev; }, 0);
    var totalPickup = kpiData.reduce(function(a, r){ return a + r.PickupRev; }, 0);
    var totalDelivery = kpiData.reduce(function(a, r){ return a + r.DeliveryRev; }, 0);
    var totalZomato = kpiData.reduce(function(a, r){ return a + r.ZomatoRev; }, 0);
    var totalSwiggy = kpiData.reduce(function(a, r){ return a + r.SwiggyRev; }, 0);
    var totalZomatoOrders = kpiData.reduce(function(a, r){ return a + r.ZomatoOrders; }, 0);
    var totalSwiggyOrders = kpiData.reduce(function(a, r){ return a + r.SwiggyOrders; }, 0);
    var totalDeliveryOrders = totalZomatoOrders + totalSwiggyOrders;
    var avgDeliveryAov = totalDeliveryOrders > 0 ? (totalDelivery / totalDeliveryOrders) : 0;
    
    var channelKpis = document.getElementById('salesChannelKpis');
    if (channelKpis) {
      channelKpis.innerHTML = [
        {l:'DINE-IN REVENUE', v:'₹'+fmtN(totalDineIn), s:'Direct walk-in tables', c:'#22c55e'},
        {l:'PICKUP / TAKEAWAY', v:'₹'+fmtN(totalPickup), s:'Self pick-up orders', c:'#3b82f6'},
        {l:'DELIVERY (TOTAL)', v:'₹'+fmtN(totalDelivery), s:'Avg Delivery AOV: ₹'+avgDeliveryAov.toFixed(1), c:'#a78bfa'},
        {l:'ZOMATO PARTNER', v:'₹'+fmtN(totalZomato), s:fmtN(totalZomatoOrders)+' orders placed', c:'#ef4444'},
        {l:'SWIGGY PARTNER', v:'₹'+fmtN(totalSwiggy), s:fmtN(totalSwiggyOrders)+' orders placed', c:'#f59e0b'}
      ].map(function(k){
        return '<div class="kpi-card"><div class="kpi-lbl">'+k.l+'</div>'
              +'<div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div>'
              +'<div class="kpi-sub">'+k.s+'</div></div>';
      }).join('');
    }
    
    var datesSet = {};
    filteredData.forEach(function(r) { if (r.Date) datesSet[r.Date] = true; });
    var sortedDates = Object.keys(datesSet).sort();
    var dailyLabels = sortedDates.map(function(d) {
      var parts = d.split('-');
      if (parts.length < 3) return d;
      var mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return parseInt(parts[2]) + ' ' + mNames[parseInt(parts[1]) - 1];
    });

    // Zomato vs Swiggy Comparison Chart
    killChart('chSalesDeliveryComparison');
    var dailyZomatoRev = [];
    var dailySwiggyRev = [];
    sortedDates.forEach(function(d) {
      var row = filteredData.find(function(r) {
        return r.Date === d && r.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
      });
      dailyZomatoRev.push(row ? row.ZomatoRev : 0);
      dailySwiggyRev.push(row ? row.SwiggyRev : 0);
    });
    
    var canvasDel = document.getElementById('chartSalesDeliveryComparison');
    if (canvasDel) {
      CI.chSalesDeliveryComparison = new Chart(canvasDel, {
        type: 'bar',
        data: {
          labels: dailyLabels,
          datasets: [
            { label: 'Zomato Rev', data: dailyZomatoRev, backgroundColor: '#ef4444', borderRadius: 4 },
            { label: 'Swiggy Rev', data: dailySwiggyRev, backgroundColor: '#f59e0b', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: GC }, ticks: { maxTicksLimit: 10 } },
            y: { grid: { color: GC }, ticks: { callback: function(v){ return '₹'+fmtN(v); } } }
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) { return c.dataset.label + ': ₹' + fmtN(c.raw); }
              }
            }
          }
        }
      });
    }
    
    // AOV & Orders Trend Chart
    killChart('chSalesAovTrend');
    var dailyOrders = [];
    var dailyAov = [];
    sortedDates.forEach(function(d) {
      var row = filteredData.find(function(r) {
        return r.Date === d && r.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
      });
      dailyOrders.push(row ? row.TotalOrders : 0);
      dailyAov.push(row ? row.AOV : 0);
    });
    
    var canvasAov = document.getElementById('chartSalesAovTrend');
    if (canvasAov) {
      CI.chSalesAovTrend = new Chart(canvasAov, {
        type: 'bar',
        data: {
          labels: dailyLabels,
          datasets: [
            { label: 'Orders', type: 'bar', data: dailyOrders, backgroundColor: '#3b82f6', yAxisID: 'yOrders', borderRadius: 4 },
            { label: 'AOV', type: 'line', data: dailyAov, borderColor: '#a78bfa', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.4, pointRadius: 3, yAxisID: 'yAov' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: GC }, ticks: { maxTicksLimit: 10 } },
            yOrders: { type: 'linear', position: 'left', grid: { color: GC }, ticks: { color: '#3b82f6' }, title: { display: true, text: 'Orders Count', color: '#3b82f6' } },
            yAov: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#a78bfa', callback: function(v){ return '₹'+fmtN(v); } }, title: { display: true, text: 'Average Order Value (₹)', color: '#a78bfa' } }
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) {
                  if (c.dataset.label === 'AOV') return 'AOV: ₹' + c.raw.toFixed(2);
                  return 'Orders: ' + c.raw;
                }
              }
            }
          }
        }
      });
    }
    
    // Channel Summary Table
    var chSummaryBody = document.getElementById('salesChannelSummaryBody');
    if (chSummaryBody) {
      var totalRev = totalDineIn + totalPickup + totalDelivery;
      var channelsList = [
        { name: 'Dine-In', rev: totalDineIn, ord: totalOrders - totalZomatoOrders - totalSwiggyOrders, aov: (totalOrders - totalZomatoOrders - totalSwiggyOrders) > 0 ? (totalDineIn / (totalOrders - totalZomatoOrders - totalSwiggyOrders)) : 0 },
        { name: 'Pickup/Takeaway', rev: totalPickup, ord: 0, aov: 0 },
        { name: 'Zomato Delivery', rev: totalZomato, ord: totalZomatoOrders, aov: totalZomatoOrders > 0 ? (totalZomato / totalZomatoOrders) : 0 },
        { name: 'Swiggy Delivery', rev: totalSwiggy, ord: totalSwiggyOrders, aov: totalSwiggyOrders > 0 ? (totalSwiggy / totalSwiggyOrders) : 0 }
      ];
      
      chSummaryBody.innerHTML = channelsList.map(function(ch) {
        var share = totalRev > 0 ? (ch.rev / totalRev * 100).toFixed(1) : '0.0';
        return '<tr>'
          + '<td style="font-weight:600">' + ch.name + '</td>'
          + '<td class="num">₹' + fmtN(ch.rev) + '</td>'
          + '<td class="num">' + share + '%</td>'
          + '<td class="num">' + (ch.ord > 0 ? fmtN(ch.ord) : '—') + '</td>'
          + '<td class="num">' + (ch.aov > 0 ? '₹' + ch.aov.toFixed(1) : '—') + '</td>'
          + '</tr>';
      }).join('');
    }
  } else if (activeTab === 'daycompare') {
    var weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    var curWeekdayAverages = weekdays.map(function(day) {
      var dayRows = kpiData.filter(function(r) {
        return r.Date && getDayNameFromDate(r.Date) === day;
      });
      var sumRev = dayRows.reduce(function(a, r) { return a + r.GrossRevenue; }, 0);
      var sumOrd = dayRows.reduce(function(a, r) { return a + r.TotalOrders; }, 0);
      return {
        day: day,
        rev: dayRows.length > 0 ? sumRev / dayRows.length : 0,
        ord: dayRows.length > 0 ? sumOrd / dayRows.length : 0,
        count: dayRows.length
      };
    });
    
    var baselineAverages = weekdays.map(function(day) {
      var base = getWeekdayBaseline(data, day, selectedMonth);
      return { day: day, rev: base.rev, ord: base.ord };
    });
    
    // Revenue Comparison Chart
    killChart('chSalesDayVs4W');
    var canvasDayRev = document.getElementById('chartSalesDayVs4W');
    if (canvasDayRev) {
      CI.chSalesDayVs4W = new Chart(canvasDayRev, {
        type: 'bar',
        data: {
          labels: weekdays,
          datasets: [
            { label: 'This Month Average', data: curWeekdayAverages.map(function(d) { return d.rev; }), backgroundColor: 'rgba(59, 130, 246, 0.85)', borderRadius: 4 },
            { label: '4-Week Historical Average', data: baselineAverages.map(function(d) { return d.rev; }), backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: GC } },
            y: { grid: { color: GC }, ticks: { callback: function(v){ return '₹'+fmtN(v); } } }
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) { return c.dataset.label + ': ₹' + fmtN(c.raw); }
              }
            }
          }
        }
      });
    }
    
    // Orders Comparison Chart
    killChart('chSalesDayVs4WOrd');
    var canvasDayOrd = document.getElementById('chartSalesDayVs4WOrd');
    if (canvasDayOrd) {
      CI.chSalesDayVs4WOrd = new Chart(canvasDayOrd, {
        type: 'bar',
        data: {
          labels: weekdays,
          datasets: [
            { label: 'This Month Avg Orders', data: curWeekdayAverages.map(function(d) { return d.ord; }), backgroundColor: 'rgba(167, 139, 250, 0.85)', borderRadius: 4 },
            { label: '4-Week Historical Avg Orders', data: baselineAverages.map(function(d) { return d.ord; }), backgroundColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { grid: { color: GC } }, y: { grid: { color: GC } } },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: { ...TT }
          }
        }
      });
    }
    
    // Populate comparative table
    var compareBody = document.getElementById('salesDayCompareBody');
    if (compareBody) {
      compareBody.innerHTML = weekdays.map(function(day, idx) {
        var cur = curWeekdayAverages[idx];
        var base = baselineAverages[idx];
        var revDelta = cur.rev - base.rev;
        var revPct = base.rev > 0 ? (revDelta / base.rev * 100) : 0;
        var ordDelta = cur.ord - base.ord;
        var ordPct = base.ord > 0 ? (ordDelta / base.ord * 100) : 0;
        
        var revDeltaHtml = revDelta >= 0 
          ? '<span style="color:var(--grn); font-weight:700">+' + revPct.toFixed(1) + '% (+₹' + fmtN(revDelta) + ')</span>'
          : '<span style="color:var(--red); font-weight:700">' + revPct.toFixed(1) + '% (-₹' + fmtN(Math.abs(revDelta)) + ')</span>';
          
        var ordDeltaHtml = ordDelta >= 0
          ? '<span style="color:var(--grn); font-weight:700">+' + ordPct.toFixed(1) + '% (+' + ordDelta.toFixed(1) + ')</span>'
          : '<span style="color:var(--red); font-weight:700">' + ordPct.toFixed(1) + '% (-' + Math.abs(ordDelta).toFixed(1) + ')</span>';
          
        return '<tr>'
          + '<td style="font-weight:600">' + day + ' <span style="font-size:10px; color:var(--m1)">(' + cur.count + 'd)</span></td>'
          + '<td class="num">₹' + fmtN(cur.rev) + '</td>'
          + '<td class="num">₹' + fmtN(base.rev) + '</td>'
          + '<td class="num">' + revDeltaHtml + '</td>'
          + '<td class="num">' + cur.ord.toFixed(1) + '</td>'
          + '<td class="num">' + base.ord.toFixed(1) + '</td>'
          + '<td class="num">' + ordDeltaHtml + '</td>'
          + '</tr>';
      }).join('');
    }
  } else if (activeTab === 'slots') {
    var slotNames = ["Breakfast (7AM-12PM)", "Lunch (12PM-4PM)", "Snacks (4PM-7PM)", "Dinner (7PM+)"];
    
    var slotSummaries = slotNames.map(function(slot) {
      var slotRows = filteredData.filter(function(r) { return r.MealSlot === slot; });
      var gross = slotRows.reduce(function(a, r){ return a + r.GrossRevenue; }, 0);
      var net = slotRows.reduce(function(a, r){ return a + r.NetRevenue; }, 0);
      var tax = slotRows.reduce(function(a, r){ return a + r.TotalTax; }, 0);
      var dineIn = slotRows.reduce(function(a, r){ return a + r.DineInRev; }, 0);
      var pickup = slotRows.reduce(function(a, r){ return a + r.PickupRev; }, 0);
      var delivery = slotRows.reduce(function(a, r){ return a + r.DeliveryRev; }, 0);
      var zomato = slotRows.reduce(function(a, r){ return a + r.ZomatoRev; }, 0);
      var swiggy = slotRows.reduce(function(a, r){ return a + r.SwiggyRev; }, 0);
      var orders = slotRows.reduce(function(a, r){ return a + r.TotalOrders; }, 0);
      var cxl = slotRows.reduce(function(a, r){ return a + r.CancelledOrders; }, 0);
      var aov = orders > 0 ? (gross / orders) : 0;
      
      return {
        slot: slot, gross: gross, net: net, tax: tax, dineIn: dineIn, pickup: pickup,
        delivery: delivery, zomato: zomato, swiggy: swiggy, orders: orders, cxl: cxl, aov: aov
      };
    });
    
    var totalSlotGross = slotSummaries.reduce(function(a, r) { return a + r.gross; }, 0);
    
    // Render Meal Slot Mix Doughnut Chart
    killChart('chSalesSlotShare');
    var canvasSlotShare = document.getElementById('chartSalesSlotShare');
    if (canvasSlotShare) {
      CI.chSalesSlotShare = new Chart(canvasSlotShare, {
        type: 'doughnut',
        data: {
          labels: slotNames.map(function(s) { return s.split(' ')[0]; }),
          datasets: [{
            data: slotSummaries.map(function(s) { return s.gross; }),
            backgroundColor: ['#f59e0b', '#60a5fa', '#a78bfa', '#f87171'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) {
                  var total = totalSlotGross;
                  var pct = total > 0 ? (c.raw / total * 100).toFixed(1) : 0;
                  return c.label + ': ₹' + fmtN(c.raw) + ' (' + pct + '%)';
                }
              }
            }
          }
        }
      });
    }
    
    // Populate Operations summary table
    var slotSummaryBody = document.getElementById('salesSlotSummaryBodyOnly');
    if (slotSummaryBody) {
      slotSummaryBody.innerHTML = slotSummaries.map(function(s) {
        return '<tr>'
          + '<td style="font-weight:600">' + s.slot.split(' ')[0] + '</td>'
          + '<td class="num">₹' + fmtN(s.gross) + '</td>'
          + '<td class="num" style="color:#facc15">₹' + fmtN(s.net) + '</td>'
          + '<td class="num">' + fmtN(s.orders) + '</td>'
          + '<td class="num">₹' + s.aov.toFixed(1) + '</td>'
          + '</tr>';
      }).join('');
    }
    
    // Daily Meal Slot Revenue trend Chart
    killChart('chSalesSlotTrend');
    var datesSet = {};
    filteredData.forEach(function(r) { if (r.Date) datesSet[r.Date] = true; });
    var sortedDates = Object.keys(datesSet).sort();
    var dailyLabels = sortedDates.map(function(d) {
      var parts = d.split('-');
      if (parts.length < 3) return d;
      var mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return parseInt(parts[2]) + ' ' + mNames[parseInt(parts[1]) - 1];
    });

    var slotSeries = {
      "Breakfast (7AM-12PM)": [],
      "Lunch (12PM-4PM)": [],
      "Snacks (4PM-7PM)": [],
      "Dinner (7PM+)": []
    };
    sortedDates.forEach(function(d) {
      var dayRows = filteredData.filter(function(r) { return r.Date === d; });
      slotNames.forEach(function(slot) {
        var row = dayRows.find(function(r) { return r.MealSlot === slot; });
        slotSeries[slot].push(row ? row.GrossRevenue : 0);
      });
    });
    
    var canvasSlotTrend = document.getElementById('chartSalesSlotTrend');
    if (canvasSlotTrend) {
      var colors = ['#f59e0b', '#60a5fa', '#a78bfa', '#f87171'];
      CI.chSalesSlotTrend = new Chart(canvasSlotTrend, {
        type: 'bar',
        data: {
          labels: dailyLabels,
          datasets: slotNames.map(function(slot, idx) {
            return {
              label: slot.split(' ')[0],
              data: slotSeries[slot],
              backgroundColor: colors[idx],
              borderRadius: 4
            };
          })
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { grid: { color: GC }, stacked: true, ticks: { maxTicksLimit: 10 } },
            y: { grid: { color: GC }, stacked: true, ticks: { callback: function(v){ return '₹'+fmtN(v); } } }
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: {
              ...TT,
              callbacks: {
                label: function(c) { return c.dataset.label + ': ₹' + fmtN(c.raw); }
              }
            }
          }
        }
      });
    }
    
    // Renders Slot Operations Matrix
    var matrixBody = document.getElementById('salesMatrixBodySlots');
    if (matrixBody) {
      var allDayRows = filteredData.filter(function(r) {
        return r.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
      });
      var totGross = allDayRows.reduce(function(a, r){ return a + r.GrossRevenue; }, 0);
      var totNet = allDayRows.reduce(function(a, r){ return a + r.NetRevenue; }, 0);
      var totDine = allDayRows.reduce(function(a, r){ return a + r.DineInRev; }, 0);
      var totPick = allDayRows.reduce(function(a, r){ return a + r.PickupRev; }, 0);
      var totDel = allDayRows.reduce(function(a, r){ return a + r.DeliveryRev; }, 0);
      var totZom = allDayRows.reduce(function(a, r){ return a + r.ZomatoRev; }, 0);
      var totSwi = allDayRows.reduce(function(a, r){ return a + r.SwiggyRev; }, 0);
      var totOrds = allDayRows.reduce(function(a, r){ return a + r.TotalOrders; }, 0);
      var totCxl = allDayRows.reduce(function(a, r){ return a + r.CancelledOrders; }, 0);
      var totAov = totOrds > 0 ? (totGross / totOrds) : 0;
      
      var matrixRowsHtml = slotSummaries.map(function(s) {
        return '<tr>'
          + '<td style="font-weight:600">' + s.slot + '</td>'
          + '<td class="num">₹' + fmtN(s.gross) + '</td>'
          + '<td class="num" style="color:#facc15">₹' + fmtN(s.net) + '</td>'
          + '<td class="num">₹' + fmtN(s.dineIn) + '</td>'
          + '<td class="num">₹' + fmtN(s.pickup) + '</td>'
          + '<td class="num">₹' + fmtN(s.delivery) + '</td>'
          + '<td class="num">₹' + fmtN(s.zomato) + '</td>'
          + '<td class="num">₹' + fmtN(s.swiggy) + '</td>'
          + '<td class="num">' + fmtN(s.orders) + '</td>'
          + '<td class="num">₹' + s.aov.toFixed(1) + '</td>'
          + '<td class="num" style="color:' + (s.cxl > 0 ? 'var(--red)' : 'var(--m1)') + '">' + s.cxl + '</td>'
          + '</tr>';
      }).join('');
      
      // Append Total row
      matrixRowsHtml += '<tr style="background:var(--s2); font-weight:800">'
        + '<td style="color:#facc15">ALL DAY TOTAL</td>'
        + '<td class="num">₹' + fmtN(totGross) + '</td>'
        + '<td class="num" style="color:#facc15">₹' + fmtN(totNet) + '</td>'
        + '<td class="num">₹' + fmtN(totDine) + '</td>'
        + '<td class="num">₹' + fmtN(totPick) + '</td>'
        + '<td class="num">₹' + fmtN(totDel) + '</td>'
        + '<td class="num">₹' + fmtN(totZom) + '</td>'
        + '<td class="num">₹' + fmtN(totSwi) + '</td>'
        + '<td class="num">' + fmtN(totOrds) + '</td>'
        + '<td class="num">₹' + totAov.toFixed(1) + '</td>'
        + '<td class="num" style="color:' + (totCxl > 0 ? 'var(--red)' : 'var(--m1)') + '">' + totCxl + '</td>'
        + '</tr>';
        
      matrixBody.innerHTML = matrixRowsHtml;
    }
  } else if (activeTab === 'datatables') {
    renderSalesLogTable();
  }
}

window.renderSalesLogTable = function() {
  var activeOutletId = activeSheetId ? activeSheetId.split('__')[0] : '';
  if (!activeOutletId && SHEET_REGISTRY.length) activeOutletId = SHEET_REGISTRY[0].id;
  var data = (window.SALES_SUMMARY_DATA && activeOutletId) ? window.SALES_SUMMARY_DATA[activeOutletId] : null;
  if (!data || !data.length) return;

  var monthFilter = document.getElementById('salesMonthFilter').value;
  var slotFilter = document.getElementById('salesSlotFilter').value;
  var searchEl = document.getElementById('salesLogSearch');
  var searchQuery = searchEl ? searchEl.value.trim() : '';

  var rows = data.filter(function(row) {
    if (monthFilter !== 'all' && (!row.Date || row.Date.indexOf(monthFilter) !== 0)) return false;
    
    var isAllDay = row.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
    if (slotFilter === 'all_slots') {
      if (!isAllDay) return false;
    } else if (slotFilter === 'slots_split') {
      if (isAllDay) return false;
    } else {
      if (row.MealSlot !== slotFilter) return false;
    }

    if (searchQuery && row.Date.indexOf(searchQuery) === -1) return false;
    
    return true;
  });

  rows.sort(function(a, b) {
    return b.Date.localeCompare(a.Date);
  });

  var logHtml = rows.map(function(r) {
    var isAllDay = r.MealSlot.toUpperCase().indexOf('ALL DAY') !== -1;
    var bg = isAllDay ? 'background:rgba(245,158,11,0.03);' : '';
    var dayName = getDayNameFromDate(r.Date);
    return '<tr style="' + bg + '">'
      + '<td style="color:#f59e0b;font-weight:600">' + fmtDateShort(r.Date) + '</td>'
      + '<td style="color:var(--m1)">' + dayName + '</td>'
      + '<td style="color:var(--m2)">' + r.MealSlot + '</td>'
      + '<td class="num">₹' + fmtN(r.GrossRevenue) + '</td>'
      + '<td class="num" style="color:#facc15">₹' + fmtN(r.NetRevenue) + '</td>'
      + '<td class="num">₹' + fmtN(r.DineInRev) + '</td>'
      + '<td class="num">₹' + fmtN(r.PickupRev) + '</td>'
      + '<td class="num">₹' + fmtN(r.DeliveryRev) + '</td>'
      + '<td class="num">₹' + fmtN(r.ZomatoRev) + ' <span style="font-size:9px;color:#64748b">(' + r.ZomatoOrders + ')</span></td>'
      + '<td class="num">₹' + fmtN(r.SwiggyRev) + ' <span style="font-size:9px;color:#64748b">(' + r.SwiggyOrders + ')</span></td>'
      + '<td class="num">' + fmtN(r.TotalOrders) + '</td>'
      + '<td class="num">₹' + r.AOV.toFixed(1) + '</td>'
      + '<td class="num" style="color:' + (r.CancelledOrders > 0 ? 'var(--red)' : 'var(--m1)') + '">' + r.CancelledOrders + '</td>'
      + '</tr>';
  }).join('');
  
  var logBody = document.getElementById('salesLogBody');
  if (logBody) {
    if (!logHtml) {
      logBody.innerHTML = '<tr><td colspan="13" style="text-align:center;color:var(--m1)">No matching rows found.</td></tr>';
    } else {
      logBody.innerHTML = logHtml;
    }
  }
};