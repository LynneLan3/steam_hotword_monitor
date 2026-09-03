/** steam_candidate_decision_history: append-only outcome columns + snapshot write. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var context = {
  console: console, Math: Math, Date: Date, JSON: JSON, String: String, Number: Number,
  Set: Set, Map: Map, Array: Array, Object: Object,
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function () { return 'hist-ss'; },
        setProperty: function () {}
      };
    }
  },
  Utilities: {
    formatDate: function (date) { return date.toISOString().slice(0, 10); }
  }
};
vm.createContext(context);
vm.runInContext(source, context);

function assert(value, message) { if (!value) throw new Error(message); }
function FakeRange(sheet, row, column, rowCount, columnCount) {
  this.sheet = sheet; this.row = row; this.column = column;
  this.rowCount = rowCount || 1; this.columnCount = columnCount || 1;
}
FakeRange.prototype.getValues = function () { return this.sheet.read(this.row, this.column, this.rowCount, this.columnCount); };
FakeRange.prototype.getDisplayValues = FakeRange.prototype.getValues;
FakeRange.prototype.getDisplayValue = function () { return this.getValues()[0][0]; };
FakeRange.prototype.setValue = function (value) { this.sheet.write(this.row, this.column, [[value]]); return this; };
FakeRange.prototype.setValues = function (values) { this.sheet.write(this.row, this.column, values); return this; };
function FakeSheet(name, headers, rows) {
  this.name = name;
  this.headers = headers.slice();
  this.rows = (rows || []).map(function (row) { return row.slice(); });
  this.maxColumns = Math.max(this.headers.length, 40);
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return Math.max(this.headers.length, 1); };
FakeSheet.prototype.getMaxColumns = function () { return this.maxColumns; };
FakeSheet.prototype.getRange = function (row, column, rowCount, columnCount) {
  return new FakeRange(this, row, column, rowCount, columnCount);
};
FakeSheet.prototype.read = function (row, column, rowCount, columnCount) {
  var out = [];
  for (var r = 0; r < rowCount; r += 1) {
    var sourceRow = row + r === 1 ? this.headers : (this.rows[row + r - 2] || []);
    var values = [];
    for (var c = 0; c < columnCount; c += 1) {
      values.push(sourceRow[column + c - 1] === undefined ? '' : sourceRow[column + c - 1]);
    }
    out.push(values);
  }
  return out;
};
FakeSheet.prototype.write = function (row, column, values) {
  for (var r = 0; r < values.length; r += 1) {
    var target = row + r === 1 ? this.headers : (this.rows[row + r - 2] || (this.rows[row + r - 2] = []));
    for (var c = 0; c < values[r].length; c += 1) target[column + c - 1] = values[r][c];
  }
};
FakeSheet.prototype.insertColumnsAfter = function () { this.maxColumns += 1; };
function FakeSpreadsheet(sheets, id) {
  this.sheets = sheets;
  this.id = id || 'hist-ss';
}
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.insertSheet = function (name) {
  var sheet = new FakeSheet(name, [], []);
  this.sheets[name] = sheet;
  return sheet;
};
FakeSpreadsheet.prototype.getId = function () { return this.id; };

var BASE = vm.runInContext('STEAM_CANDIDATE_DECISION_HISTORY_BASE_HEADERS.slice()', context);
var OUTCOME = vm.runInContext('STEAM_CANDIDATE_DECISION_HISTORY_OUTCOME_HEADERS.slice()', context);
assert(OUTCOME.join(',') === 'machine_recommendation,machine_confidence,final_status', 'exact 3 outcome headers');

var legacySheet = new FakeSheet('steam_candidate_decision_history', BASE, [
  ['old|1|', '2026-08-31', '111', 'Legacy Game', 'WATCH', '', '待研究', '强', '', '低', '', '', '', '', '', '{}', '2026-08-31']
]);
var legacySs = new FakeSpreadsheet({steam_candidate_decision_history: legacySheet});
var schema = context.ensureSteamCandidateDecisionHistorySchema_(legacySheet);
assert(schema.appended.join(',') === OUTCOME.join(','), 'only appends 3 new columns');
assert(legacySheet.headers.slice(0, BASE.length).join('|') === BASE.join('|'), 'legacy columns stay in place');
assert(legacySheet.rows.length === 1 && legacySheet.rows[0][4] === 'WATCH', 'existing history row untouched');

context.SpreadsheetApp = {
  openById: function () { return legacySs; }
};
var snapshot = context.buildSteamCandidateDecisionHistorySnapshot_({
  appId: '9001',
  name: 'Snapshot Game',
  status: 'BUILD',
  decisionDate: '2026-09-03',
  researchStatus: '已完成',
  trendsResult: '强',
  socialResult: '中',
  serpCompetition: '低',
  machineDecision: 'WATCH',
  autoRecommendationConfidence: 'HIGH',
  decisionId: 'BUILD|9001|2026-09-03'
}, {
  machine_recommendation: 'WATCH',
  machine_confidence: 'HIGH',
  final_status: '建站',
  reason: 'unit_test'
});
assert(snapshot.machine_recommendation === 'WATCH', 'maps machine_recommendation');
assert(snapshot.machine_confidence === 'HIGH', 'maps machine_confidence');
assert(snapshot.final_status === '建站', 'maps final_status');
assert(snapshot.trends_result === '强' && snapshot.decision === 'BUILD', 'reuses existing decision fields');

var beforeRows = legacySheet.rows.length;
var write = context.appendSteamCandidateDecisionHistorySnapshot_(snapshot, {spreadsheet: legacySs});
assert(write.ok && write.appended === 1, 'append succeeds');
assert(legacySheet.rows.length === beforeRows + 1, 'append-only adds one row');
assert(legacySheet.rows[0][4] === 'WATCH', 'old row still WATCH');
var newRow = legacySheet.rows[1];
var col = function (name) { return legacySheet.headers.indexOf(name); };
assert(newRow[col('machine_recommendation')] === 'WATCH', 'new row has machine_recommendation');
assert(newRow[col('machine_confidence')] === 'HIGH', 'new row has machine_confidence');
assert(newRow[col('final_status')] === '建站', 'new row has final_status');
assert(newRow[col('decision')] === 'BUILD', 'new row reuses decision');

// Idempotent schema ensure does not duplicate columns
var again = context.ensureSteamCandidateDecisionHistorySchema_(legacySheet);
assert(again.appended.length === 0, 'second ensure appends nothing');
assert(legacySheet.headers.filter(function (h) { return h === 'machine_recommendation'; }).length === 1, 'no duplicate headers');

console.log('PASS scripts/test-candidate-decision-history.js');
