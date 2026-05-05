/**
 * SJP MIS Dashboard - Backend API
 * 
 * Deployment Instructions:
 * 1. Open your Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this code.
 * 4. Deploy > New Deployment > Web App.
 * 5. Set "Execute as" to "Me" and "Who has access" to "Anyone".
 */

/**
 * doGet — Returns ALL sheet tabs as JSON.
 * Each tab is a month. Response format:
 * { status:"success", tabs:[ {name:"April 2026", data:[...rows...]}, ... ] }
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var tabs = [];

  for (var t = 0; t < sheets.length; t++) {
    var sheet = sheets[t];
    var name = sheet.getName();
    // Skip config/meta tabs
    if (name.toLowerCase() === 'config' || name.toLowerCase() === 'template') continue;

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) continue;

    if (name.trim().toUpperCase() === 'MIS') {
      tabs.push({ name: name, rawData: data });
      continue;
    }

    var headers = data[0];
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j] !== undefined ? row[j] : "";
      }
      rows.push(obj);
    }
    tabs.push({ name: name, data: rows });
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'success', tabs: tabs }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var params;

    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      params = e.parameter;
    } else {
      return ContentService.createTextOutput(JSON.stringify({status: 'error', message: 'No data received'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    if (headers.every(function(h) { return h === ''; })) {
      var newHeaders = Object.keys(params);
      sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
      headers = newHeaders;
    }

    var row = [];
    for (var i = 0; i < headers.length; i++) {
      row.push(params[headers[i]] || '');
    }
    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({status: 'success', message: 'Row added', rowCount: sheet.getLastRow()}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: 'error', message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ═══════════════════════════════════════════════
// CELL PROTECTION SYSTEM
// ═══════════════════════════════════════════════

/**
 * Creates a custom menu in the Google Sheets UI for managing
 * the sheet lock/unlock feature.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sheet Lock')
    .addItem('Unlock Sheet (password)', 'unlockSheet')
    .addItem('Lock Filled Cells Now', 'lockFilledCells')
    .addSeparator()
    .addItem('Setup Daily 2AM Trigger', 'setupDailyLockTrigger')
    .addToUi();
}

/**
 * Locks every cell that contains data using a single sheet-level
 * protection. Empty cells and the area beyond the data range
 * are left unprotected so new data can still be entered.
 */
function lockFilledCells() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  // Remove previous AutoLock protections first
  var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var p = 0; p < existing.length; p++) {
    if (existing[p].getDescription() === 'AutoLock_FilledCells') {
      existing[p].remove();
    }
  }

  // Build list of empty-cell ranges (these stay editable)
  var unprotectedRanges = [];

  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (values[r][c] === '' || values[r][c] === null) {
        unprotectedRanges.push(sheet.getRange(r + 1, c + 1));
      }
    }
  }

  // Also unprotect everything BELOW the data
  var lastRow = dataRange.getLastRow();
  var maxRows = sheet.getMaxRows();
  if (lastRow < maxRows) {
    unprotectedRanges.push(sheet.getRange(lastRow + 1, 1, maxRows - lastRow, sheet.getMaxColumns()));
  }
  // And everything to the RIGHT of the data
  var lastCol = dataRange.getLastColumn();
  var maxCols = sheet.getMaxColumns();
  if (lastCol < maxCols) {
    unprotectedRanges.push(sheet.getRange(1, lastCol + 1, maxRows, maxCols - lastCol));
  }

  // Apply sheet-level protection
  var protection = sheet.protect().setDescription('AutoLock_FilledCells');
  protection.setWarningOnly(true);

  if (unprotectedRanges.length > 0) {
    protection.setUnprotectedRanges(unprotectedRanges);
  }

  Logger.log('Locked ' + (values.length * values[0].length) + ' cells. '
    + unprotectedRanges.length + ' empty ranges left editable.');
}

/**
 * Prompts the user for a password and removes all
 * AutoLock protections so the sheet becomes fully editable again.
 */
function unlockSheet() {
  var ui = SpreadsheetApp.getUi();

  var response = ui.prompt(
    'Unlock Sheet',
    'Enter the unlock password:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var password = response.getResponseText().trim();

  // CHANGE THIS PASSWORD BEFORE DEPLOYING
  if (password !== 'admin123') {
    ui.alert('Incorrect Password', 'The password you entered is wrong. Sheet remains locked.', ui.ButtonSet.OK);
    return;
  }

  // Password correct - remove all AutoLock protections
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var removed = 0;

  var sheetProts = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var i = 0; i < sheetProts.length; i++) {
    if (sheetProts[i].getDescription() === 'AutoLock_FilledCells') {
      sheetProts[i].remove();
      removed++;
    }
  }
  
  var rangeProts = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var j = 0; j < rangeProts.length; j++) {
    if (rangeProts[j].getDescription() === 'AutoLock_FilledCells') {
      rangeProts[j].remove();
      removed++;
    }
  }

  if (removed > 0) {
    ui.alert('Sheet Unlocked', 'Removed ' + removed + ' protection(s). You can now edit all cells freely.', ui.ButtonSet.OK);
  } else {
    ui.alert('Already Unlocked', 'No locked ranges were found. The sheet is already fully editable.', ui.ButtonSet.OK);
  }
}

/**
 * Creates a daily time-driven trigger that runs lockFilledCells() at 2:00 AM.
 */
function setupDailyLockTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'lockFilledCells') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('lockFilledCells')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .nearMinute(0)
    .create();

  SpreadsheetApp.getUi().alert(
    'Trigger Created',
    'Daily auto-lock trigger set for 2:00 AM. Filled cells will be protected automatically every night.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
