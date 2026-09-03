/** Candidate ID fill + decision→master backfill + Steam App ID fallback. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var context = {
  console: console, Math: Math, Date: Date, JSON: JSON, String: String, Number: Number,
  Set: Set, Map: Map, Array: Array, Object: Object,
  PropertiesService: {
    getScriptProperties: function () {
      return {getProperty: function () { return 'hist-ss'; }, setProperty: function () {}};
    }
  },
  Utilities: {formatDate: function (date) { return date.toISOString().slice(0, 10); }},
  SpreadsheetApp: null
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
  this.maxColumns = Math.max(this.headers.length, 80);
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
FakeSheet.prototype.deleteRow = function (rowNumber) {
  if (rowNumber <= 1) return;
  this.rows.splice(rowNumber - 2, 1);
};
function FakeSpreadsheet(sheets, id) {
  this.sheets = sheets;
  this.id = id || 'biz-ss';
}
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.getId = function () { return this.id; };

var masterHeaders = vm.runInContext('HOTWORD_V2.masterHeaders.slice()', context);
var decisionHeaders = vm.runInContext('HOTWORD_V2.decisionHeaders.slice()', context);
function col(headers, name) { return headers.indexOf(name); }
function masterRow(appId, name, trends, human) {
  var row = new Array(masterHeaders.length).fill('');
  row[col(masterHeaders, 'Steam App ID')] = appId;
  row[col(masterHeaders, '游戏名称')] = name;
  return row;
}
function decisionRow(appId, name, fields) {
  var row = new Array(decisionHeaders.length).fill('');
  row[col(decisionHeaders, 'Steam App ID')] = appId;
  row[col(decisionHeaders, '游戏名称')] = name;
  Object.keys(fields || {}).forEach(function (key) {
    row[col(decisionHeaders, key)] = fields[key];
  });
  return row;
}

var masterSheet = new FakeSheet('候选主表', masterHeaders, [
  masterRow('4406280', 'the cabin game'),
  masterRow('4412000', 'Zad Archery')
]);
// Pre-fill one manual Trends + human decision that must be preserved.
context.ensureUnifiedCandidateSchema_(masterSheet);
var trendsCol = masterSheet.headers.indexOf('Trends结果');
var humanCol = masterSheet.headers.indexOf('人工决定');
masterSheet.rows[0][trendsCol] = '人工强';
masterSheet.rows[0][humanCol] = 'BUILD';

var decisionSheet = new FakeSheet('候选决策', decisionHeaders, [
  decisionRow('4406280', 'the cabin game', {
    'Google Trends结果': '中',
    'Social结果': '中',
    'SERP竞争': '低',
    '自动Recommendation': 'RECOMMEND_WATCH',
    '自动Recommendation置信度': 'LOW',
    Decision: 'WATCH'
  }),
  decisionRow('4412000', 'Zad Archery', {
    'Google Trends结果': '弱',
    'Social结果': '中',
    'SERP竞争': '低',
    '自动Recommendation': 'RECOMMEND_WATCH',
    '自动Recommendation置信度': 'HIGH'
  })
]);

var historyHeaders = vm.runInContext(
  'STEAM_CANDIDATE_DECISION_HISTORY_BASE_HEADERS.concat(STEAM_CANDIDATE_DECISION_HISTORY_OUTCOME_HEADERS)',
  context
);
var historySheet = new FakeSheet('steam_candidate_decision_history', historyHeaders, [
  ['unknown|4948000|', '2026-09-03', '4948000', 'Moo Who?', '', '', '', '', '', '未检查', '', 'schema_ensure_test_write', '', '', '', '{}', '2026-09-03', 'WATCH', 'MEDIUM', '待研究']
]);
var ss = new FakeSpreadsheet({
  '候选主表': masterSheet,
  '候选决策': decisionSheet,
  steam_candidate_decision_history: historySheet
});
context.SpreadsheetApp = {
  openById: function () { return ss; },
  flush: function () {}
};

assert(context.stableSteamCandidateId_('4406280') === 'steam-4406280', 'stable steam candidate id');

var ids = context.backfillSteamCandidateIdsOnMaster_(ss);
assert(ids.filled === 2, 'fills missing Candidate IDs');
assert(masterSheet.rows[0][masterSheet.headers.indexOf('Candidate ID')] === 'steam-4406280', 'cabin candidate id');
assert(masterSheet.rows[1][masterSheet.headers.indexOf('Candidate ID')] === 'steam-4412000', 'zad candidate id');
var idsAgain = context.backfillSteamCandidateIdsOnMaster_(ss);
assert(idsAgain.filled === 0, 'second Candidate ID backfill is no-op');

var master = context.backfillCandidateDecisionsToMaster_(ss);
assert(master.updated === 2, 'both decisions synced to master');
assert(masterSheet.rows.length === 2, 'no duplicate master rows');
assert(masterSheet.rows[0][trendsCol] === '人工强', 'manual Trends结果 preserved');
assert(masterSheet.rows[0][humanCol] === 'BUILD', 'manual 人工决定 preserved');
assert(masterSheet.rows[0][masterSheet.headers.indexOf('Social结果')] === '中', 'social synced');
assert(masterSheet.rows[0][masterSheet.headers.indexOf('机器推荐')] === 'WATCH', 'machine recommendation normalized');
assert(masterSheet.rows[0][masterSheet.headers.indexOf('最终状态')] === '建站', 'final status from preserved BUILD');
assert(masterSheet.rows[1][masterSheet.headers.indexOf('Trends结果')] === '弱', 'empty Trends filled from decision');
assert(masterSheet.rows[1][masterSheet.headers.indexOf('机器置信度')] === 'HIGH', 'machine confidence synced');
assert(masterSheet.rows[1][masterSheet.headers.indexOf('最终状态')] === '待研究', 'no decision stays 待研究');

// Steam App ID fallback: clear Candidate ID and still update same row
masterSheet.rows[1][masterSheet.headers.indexOf('Candidate ID')] = '';
var fallback = context.updateCandidateMasterOutcome_(ss, {
  candidateId: 'steam-missing',
  steamAppId: '4412000'
}, {'Social结果': '高'});
assert(fallback.ok && masterSheet.rows.length === 2, 'Steam App ID fallback updates same row');
assert(masterSheet.rows[1][masterSheet.headers.indexOf('Social结果')] === '高', 'fallback write applied');

var deleted = context.deleteSchemaEnsureTestDecisionHistoryRow_();
assert(deleted.deleted === 1, 'schema ensure test row deleted');
assert(historySheet.rows.length === 0, 'only pollution row removed');

var history = context.backfillSteamCandidateDecisionHistory_(ss);
assert(history.appended === 2, 'history backfill appends real decisions');
var historyAgain = context.backfillSteamCandidateDecisionHistory_(ss);
assert(historyAgain.appended === 0 && historyAgain.deduped === 2, 'history backfill is idempotent');

var g022 = fs.readFileSync(path.join(__dirname, '..', 'HistoricalFeatureSnapshot.gs'), 'utf8');
assert(g022.indexOf('function g022FinalizeHistoricalRun_') >= 0, 'g022 finalize restored');
assert(g022.indexOf('function g022FinalizeExistingRunProduction_') >= 0, 'existing-run finalize helper present');
assert(g022.indexOf('rawObservationsRewritten: false') >= 0, 'repair promises no raw rewrite');

console.log('PASS scripts/test-candidate-outcome-backfill.js');
