/** 今日候选快照：同日幂等、历史保留、与实时队列解耦。 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(value, label) { if (!value) throw new Error(label); }

function FakeRange(sheet, row, column, rowCount, columnCount) {
  this.sheet = sheet; this.row = row; this.column = column;
  this.rowCount = rowCount; this.columnCount = columnCount;
}
FakeRange.prototype.getValues = function () { return this.read(false); };
FakeRange.prototype.getDisplayValues = function () { return this.read(true); };
FakeRange.prototype.read = function (display) {
  var out = [];
  for (var r = 0; r < this.rowCount; r += 1) {
    var source = this.row + r === 1 ? this.sheet.headers : (this.sheet.rows[this.row + r - 2] || []);
    var startColumn = this.column;
    out.push(Array.from({length: this.columnCount}, function (_, c) {
      var value = source[startColumn + c - 1];
      return display ? String(value == null ? '' : value) : (value === undefined ? '' : value);
    }));
  }
  return out;
};
FakeRange.prototype.setValues = function (values) {
  for (var r = 0; r < values.length; r += 1) {
    while (this.sheet.rows.length < this.row + r - 1) this.sheet.rows.push([]);
    var target = this.sheet.rows[this.row + r - 2] || (this.sheet.rows[this.row + r - 2] = []);
    for (var c = 0; c < values[r].length; c += 1) target[this.column + c - 1] = values[r][c];
  }
  return this;
};

function FakeSheet(headers, rows) { this.headers = headers.slice(); this.rows = rows || []; }
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getRange = function (row, column, rowCount, columnCount) {
  return new FakeRange(this, row, column, rowCount || 1, columnCount || 1);
};
FakeSheet.prototype.insertRowsAfter = function (row, count) {
  this.rows.splice(row - 1, 0, ...Array.from({length: count}, function () { return []; }));
};

function FakeSpreadsheet(sheet) {
  this.sheet = sheet;
}
FakeSpreadsheet.prototype.getSheetByName = function () { return this.sheet; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Shanghai'; };

var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var sandbox = {
  console: console,
  Date: Date, String: String, Number: Number, Math: Math, Set: Set, Map: Map,
  Array: Array, Object: Object,
  Utilities: {formatDate: function (date) { return new Date(date).toISOString().slice(0, 10); }}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

var headers = ['日期', 'Run ID', '游戏名称', 'Steam App ID', '优先级', '第一轮类型',
  'Steam Followers', 'Steam 7d Gain', '近似增长率', '发布阶段', 'Steam 发布日期', '距发售天数', '触发原因'];
var old = ['2026-08-28', 'old-run', 'Old Candidate', '9001', 'P1 高', '🔥 趋势候选', 1000, 700, 0.2, '已发售', '2026-08-20', 8, 'old reason'];
var sheet = new FakeSheet(headers, [old]);
var spreadsheet = new FakeSpreadsheet(sheet);
var first = {
  appId: '9002', name: 'Today Candidate', priority: 'P1 高', firstRoundType: '🔥 趋势候选',
  continueNext: '是', followers: 1200, gain7d: 800, growthRate: 0.3,
  releaseStage: '即将发售', releaseDate: '2026-09-01', daysToRelease: 3, firstRoundReason: 'today reason'
};
var firstResult = sandbox.writeDailyCandidateSnapshot_(spreadsheet, [first], '2026-08-29', 'run-20260829');
assert(firstResult.persisted === 1, 'today candidate persisted');
assert(sheet.rows[0][0] === '2026-08-29' && sheet.rows[1][0] === '2026-08-28', 'today rows are displayed first');
var frozen = JSON.stringify(sheet.rows[0]);

var changed = Object.assign({}, first, {name: 'Changed Name', gain7d: 9999, firstRoundReason: 'changed after scan'});
var secondResult = sandbox.writeDailyCandidateSnapshot_(spreadsheet, [changed], '2026-08-29', 'run-20260829-second');
assert(secondResult.persisted === 0 && secondResult.skipped === 1, 'same day and App ID is deduplicated');
assert(JSON.stringify(sheet.rows[0]) === frozen, 'today snapshot remains immutable');
assert(sheet.rows.length === 2, 'historical row remains');

var rec = {continueNext: '是', gain7d: 800};
var build = sandbox.decideTodayActionProjection_(rec, {status: 'BUILD', currentStage: '1B完成→人工第二轮'}, new Date('2026-08-29T08:00:00Z'), {}, spreadsheet);
var pending = sandbox.decideTodayActionProjection_(rec, {status: '', currentStage: '1B完成→人工第二轮', preflightVerdict: 'MANUAL_REVIEW'}, new Date('2026-08-29T08:00:00Z'), {}, spreadsheet);
assert(build.include === false && pending.include === true, 'Today Action changes with Decision while snapshot stays fixed');
console.log('PASS scripts/test-candidate-snapshot.js (immutable daily snapshot, today-first display, live queue separation)');
