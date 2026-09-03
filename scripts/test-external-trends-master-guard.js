/** ExternalEvidence Trends结果: write only when master cell is empty. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var context = {
  console: console, Math: Math, Date: Date, JSON: JSON, String: String, Number: Number,
  Set: Set, Map: Map, Array: Array, Object: Object
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
function FakeSheet(headers, rows) {
  this.headers = headers.slice(); this.rows = rows.map(function (row) { return row.slice(); });
  this.maxColumns = Math.max(this.headers.length, 80); this.maxRows = 40;
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
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
FakeSheet.prototype.insertColumnsAfter = function (column, count) {
  for (var i = 0; i < count; i += 1) this.headers.push('');
  this.maxColumns += count;
};
function FakeSpreadsheet(sheet) { this.sheet = sheet; }
FakeSpreadsheet.prototype.getSheetByName = function () { return this.sheet; };

var oldHeaders = vm.runInContext('HOTWORD_V2.masterHeaders.slice()', context);
function col(headers, name) { return headers.indexOf(name); }
function cell(sheet, header) { return sheet.rows[0][col(sheet.headers, header)]; }

var base = new Array(oldHeaders.length).fill('');
base[col(oldHeaders, 'Steam App ID')] = '5555';
base[col(oldHeaders, '游戏名称')] = 'Trends Guard Demo';
var sheet = new FakeSheet(oldHeaders, [base]);
var ss = new FakeSpreadsheet(sheet);

context.upsertUnifiedCandidates_(ss, [{
  candidate_id: 'cand-5555',
  canonical_name: 'Trends Guard Demo',
  has_steam: true,
  has_twitch: false,
  steam_app_ids: ['5555'],
  platform_listings: [{platform: 'STEAM', platform_game_id: '5555', store_url: 'https://store.steampowered.com/app/5555/'}],
  signals: []
}]);
assert(sheet.rows.length === 1, 'single candidate row');
assert(!cell(sheet, 'Trends结果') || cell(sheet, 'Trends结果') === '', 'Trends结果 starts empty');

// 1) Empty Trends结果 → ExternalEvidence auto-write succeeds
var emptyWrite = context.updateCandidateMasterOutcome_(ss, {
  steamAppId: '5555',
  gameName: 'Trends Guard Demo'
}, {'Trends结果': '强'}, {trendsOnlyIfEmpty: true});
assert(emptyWrite.ok && emptyWrite.trendsWrote === true, 'empty Trends write succeeds');
assert(cell(sheet, 'Trends结果') === '强', 'empty Trends cell filled by ExternalEvidence');
assert(sheet.rows.length === 1, 'empty write does not insert a row');

// 2) Existing Trends结果 → ExternalEvidence auto-write does not overwrite
var blocked = context.updateCandidateMasterOutcome_(ss, {
  steamAppId: '5555',
  gameName: 'Trends Guard Demo'
}, {'Trends结果': '弱'}, {trendsOnlyIfEmpty: true});
assert(blocked.ok && blocked.trendsWrote === false, 'existing Trends auto-write is blocked');
assert(cell(sheet, 'Trends结果') === '强', 'existing manual Trends结果 preserved');
assert(sheet.rows.length === 1, 'blocked write does not insert a row');

// Manual path may still update Trends (not ExternalEvidence)
var manual = context.updateCandidateMasterOutcome_(ss, {
  steamAppId: '5555'
}, {'Trends结果': '中'}, {allowHumanOverwrite: true});
assert(manual.ok && cell(sheet, 'Trends结果') === '中', 'manual Trends overwrite still allowed without trendsOnlyIfEmpty');

console.log('PASS scripts/test-external-trends-master-guard.js');
