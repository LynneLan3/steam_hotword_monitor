/** Daily source-side RAW export. Existing History Spreadsheet is not required. */
var STEAM_HISTORY_SOURCE_SHEETS = ['Steam_每日快照', '候选决策', '候选主表', '外部证据记录', '历史游戏库'];
var STEAM_RAW_ROOT = '热词站监控RAW';
var STEAM_RAW_SOURCE = 'steam';
var STEAM_RAW_ROOT_PROPERTY = 'STEAM_MONITORING_RAW_ROOT_FOLDER_ID';
var STEAM_RAW_PRODUCTION_SHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';

function steamDateText_(v) {
  var s = v instanceof Date ? Utilities.formatDate(v, 'Asia/Shanghai', 'yyyy-MM-dd') : String(v || '').substring(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function steamRawSpreadsheet_(spreadsheetId) {
  if (spreadsheetId) return SpreadsheetApp.openById(String(spreadsheetId));
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  return SpreadsheetApp.openById(STEAM_RAW_PRODUCTION_SHEET_ID);
}

function steamRawRootFolder_(create) {
  var p = PropertiesService.getScriptProperties();
  var f = null;
  var id = p.getProperty(STEAM_RAW_ROOT_PROPERTY);
  if (id) {
    try { f = DriveApp.getFolderById(id); } catch (e) { p.deleteProperty(STEAM_RAW_ROOT_PROPERTY); }
  }
  if (!f) {
    try {
      var q = DriveApp.getFoldersByName(STEAM_RAW_ROOT);
      if (q.hasNext()) f = q.next();
    } catch (lookupErr) {
      if (!create) return null;
    }
  }
  if (!f && create) {
    try { f = DriveApp.createFolder(STEAM_RAW_ROOT); } catch (createErr) { return null; }
  }
  if (f) p.setProperty(STEAM_RAW_ROOT_PROPERTY, f.getId());
  return f;
}

function steamRawDateFolder_(date, create) {
  var f = steamRawRootFolder_(create);
  if (!f) return null;
  try {
    [STEAM_RAW_SOURCE, date.substring(0, 4), date.substring(5, 7), date].forEach(function (n) {
      var q = f.getFoldersByName(n);
      f = q.hasNext() ? q.next() : (create ? f.createFolder(n) : null);
    });
  } catch (folderErr) {
    return null;
  }
  return f;
}

function steamRawSheet_(name, spreadsheetId) {
  var s = steamRawSpreadsheet_(spreadsheetId).getSheetByName(name);
  if (!s || s.getLastRow() < 1 || s.getLastColumn() < 1) return null;
  return {
    headers: s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0],
    rows: s.getLastRow() > 1 ? s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues() : []
  };
}

function saveSteamMonitoringRaw_(runId, date, spreadsheetId) {
  try {
    var d = steamDateText_(date) || steamDateText_(new Date());
    var id = String(runId || '').trim() || Utilities.formatDate(new Date(), 'Asia/Shanghai', 'yyyyMMdd-HHmmss');
    var f = steamRawDateFolder_(d, true);
    if (!f) return {saved: false, skipped: true, reason: 'drive_folder_unavailable'};
    var name = id + '.json.gz';
    var q = f.getFilesByName(name);
    if (q.hasNext()) return {saved: false, alreadyExists: true, path: 'steam/' + d + '/' + name};
    var sheets = {};
    STEAM_HISTORY_SOURCE_SHEETS.forEach(function (n) {
      var t = steamRawSheet_(n, spreadsheetId);
      if (t) sheets[n] = t;
    });
    var payload = {source: 'steam', run_id: id, observed_date: d, exported_at: new Date().toISOString(), sheets: sheets};
    f.createFile(Utilities.gzip(Utilities.newBlob(JSON.stringify(payload), 'application/json', name)));
    var mf = f.getFilesByName('manifest.json');
    var m = {source: 'steam', date: d, files: []};
    var file = null;
    if (mf.hasNext()) {
      file = mf.next();
      try { m = JSON.parse(file.getBlob().getDataAsString()); } catch (e) { /* keep default manifest */ }
    }
    if (!m.files.some(function (x) { return x.name === name; })) {
      m.files.push({name: name, run_id: id, sheet_names: Object.keys(sheets)});
      if (file) file.setContent(JSON.stringify(m, null, 2));
      else f.createFile('manifest.json', JSON.stringify(m, null, 2), 'application/json');
    }
    return {saved: true, path: 'steam/' + d + '/' + name, sheets: Object.keys(sheets)};
  } catch (err) {
    return {
      saved: false,
      skipped: true,
      reason: 'drive_export_failed',
      error: String(err && err.message || err || 'unknown')
    };
  }
}

function runSteamRawArchiveMaintenance() {
  return {enabled: false, reason: 'retention_disabled'};
}

function setupSteamRawArchiveMaintenance() {
  return {enabled: false, reason: 'retention_disabled'};
}
