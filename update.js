const fs = require('fs');

let html = fs.readFileSync('../dashboard/index.html', 'utf8');

// 1. Replace RAW DATA section
const rawDataRegex = /\/\/ 1\. RAW DATA[\s\S]*?\/\/ ═══════════════════════════════════════════════\r?\n\/\/ 2\. HELPERS/g;
const newRawData = `// 1. RAW DATA
var DATES = [];
var REV   = [];
var RM    = [];
var CP    = [];
var PKG   = [];
var HK    = [];
var GASU  = [];
var GASV  = [];
var WATQ  = [];
var WATV  = [];
var PETTY = [];

var TARGET = 14200000;
var MONTH_DAYS = 30;

// ═══════════════════════════════════════════════
// 2. HELPERS`;
html = html.replace(rawDataRegex, newRawData);

// 2. Replace doSync and disconnect
const syncRegex = /async function doSync\(\)\{[\s\S]*?function disconnect\(\)\{[\s\S]*?\}/;
const newSync = `async function doSync(){
  var url = document.getElementById('sheetUrlInput') ? document.getElementById('sheetUrlInput').value.trim() : "YOUR_APPS_SCRIPT_URL";
  var btn = document.getElementById('syncBtn');
  if(btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Connecting...';
  }
  setMsg('syncMsg','🔄 Fetching live data...','#94a3b8');

  try{
    var r = await fetch(url);
    var json = await r.json();
    if(json.status !== 'success' || !json.data) throw new Error('Invalid data format');
    
    var data = json.data;
    DATES = []; REV = []; RM = []; CP = []; PKG = []; HK = []; GASU = []; GASV = []; WATQ = []; WATV = []; PETTY = [];
    
    var keys = Object.keys(data[0]);
    var dateKeys = keys.filter(function(k){ return k !== "Particulars" && k !== "Target" && k !== "Run Rate" && k !== "MTD" && k !== ""; });
    
    var getVal = function(name, dKey) {
      var row = data.find(function(x){ return x.Particulars && x.Particulars.toLowerCase().includes(name.toLowerCase()); });
      return row && row[dKey] !== "" ? (parseFloat(row[dKey]) || 0) : 0;
    };
    
    for(var i=0; i<dateKeys.length; i++) {
      var dKey = dateKeys[i];
      var revRow = data.find(function(r){ return r.Particulars === "Net Revenue"; });
      var rv = revRow ? revRow[dKey] : "";
      if(rv === "" || rv == null) continue;
      
      var shortDate = dKey.split('\\n');
      shortDate = shortDate.length > 1 ? shortDate[1] : shortDate[0];
      
      DATES.push(shortDate);
      REV.push(parseFloat(rv) || 0);
      RM.push(getVal("RM Indent Value", dKey));
      CP.push(getVal("CP Indent Value", dKey));
      PKG.push(getVal("Packaging Indent value", dKey));
      HK.push(getVal("HK Materials Indent", dKey));
      GASU.push(getVal("Gail Gas consumption Unit", dKey));
      GASV.push(getVal("Gail gas consumption Value", dKey));
      WATQ.push(getVal("Water consumption Unit", dKey));
      WATV.push(getVal("Water consumption Value", dKey));
      PETTY.push(getVal("Petty cash expenses", dKey));
    }
    
    if(REV.length === 0) throw new Error("No revenue data found");
    
    killAllCharts();
    Object.keys(builtPages).forEach(function(k){ delete builtPages[k]; });
    
    renderUI();
    setTimeout(function(){ buildPageCharts('overview'); }, 80);
    
    document.getElementById('srcInfoEl').textContent = 'Live data: '+DATES.length+' days applied · '+new Date().toLocaleDateString('en-IN');
    setMsg('syncMsg','✅ '+DATES.length+' days loaded!','#22c55e');
    showToast('✅ Dashboard updated!');
    
    var b=document.getElementById('connectedBanner');
    if(b){
      b.style.display='flex';
      var cs = document.getElementById('connectedSub');
      if(cs) cs.textContent = DATES.length+' days · '+new Date().toLocaleTimeString('en-IN');
    }
  } catch(e){
    setMsg('syncMsg','❌ '+e.message,'#ef4444');
  }
  
  if(btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Sync Now';
  }
}

function disconnect(){
  DATES = []; REV = []; RM = []; CP = []; PKG = []; HK = []; GASU = []; GASV = []; WATQ = []; WATV = []; PETTY = [];
  killAllCharts();
  Object.keys(builtPages).forEach(function(k){ delete builtPages[k]; });
  renderUI();
  var b=document.getElementById('connectedBanner');
  if(b) b.style.display='none';
  setMsg('syncMsg','','');
  showToast('Sheet disconnected.');
}`;
html = html.replace(syncRegex, newSync);

// 3. Pre-fill the Input with the new URL
html = html.replace(/value="https:\/\/docs\.google\.com.*?pub\?gid=0&single=true&output=csv"/g, 'value="YOUR_APPS_SCRIPT_URL"');

// 4. Update the boot logic to automatically sync on load
const bootRegex = /document\.addEventListener\('DOMContentLoaded', function\(\)\{[\s\S]*?\}\);/;
const newBoot = `document.addEventListener('DOMContentLoaded', function(){
  renderUI();
  setTimeout(function(){ buildPageCharts('overview'); }, 120);
  refreshKeyBadge();

  // Restore saved sheet URL or use default
  var savedUrl = localStorage.getItem('sjp_sheet_url');
  if(savedUrl){
    var f = document.getElementById('sheetUrlInput');
    if(f) f.value = savedUrl;
  }
  
  // Automatically sync on load!
  doSync();
});`;
html = html.replace(bootRegex, newBoot);

fs.writeFileSync('../dashboard/index.html', html);
console.log("Successfully rebuilt index.html");
