/** G018 P5: UNIFIED_CANDIDATE_UPSERT doPost receiver tests (Steam-only). */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var token = 'test-token-never-written-to-sheet';
var properties = {'STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN': token};
var context = {console: console, Math: Math, Date: Date, JSON: JSON, String: String, Number: Number, Set: Set, Map: Map,
  PropertiesService: {getScriptProperties: function () {
    return {getProperty: function (key) { return properties[key] || ''; }, setProperty: function (key, value) { properties[key] = String(value); }};
  }},
  ContentService: {MimeType: {JSON: 'application/json'}, createTextOutput: function (text) {
    return {text: text, setMimeType: function () { return this; }};
  }}};
vm.createContext(context);
vm.runInContext(source, context);

function assert(value, message) { if (!value) throw new Error(message); }
function FakeRange(sheet, row, column, rowCount, columnCount) {
  this.sheet = sheet; this.row = row; this.column = column;
  this.rowCount = rowCount || 1; this.columnCount = columnCount || 1;
}
FakeRange.prototype.getValues = function () { return this.sheet.read(this.row, this.column, this.rowCount, this.columnCount); };
FakeRange.prototype.getDisplayValues = FakeRange.prototype.getValues;
FakeRange.prototype.setValue = function (value) { this.sheet.write(this.row, this.column, [[value]]); return this; };
FakeRange.prototype.setValues = function (values) { this.sheet.write(this.row, this.column, values); return this; };
function FakeSheet(headers, rows) {
  this.headers = headers.slice(); this.rows = rows.map(function (row) { return row.slice(); });
  this.maxColumns = Math.max(this.headers.length, 60); this.maxRows = 40;
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.getMaxColumns = function () { return this.maxColumns; };
FakeSheet.prototype.getRange = function (row, column, rowCount, columnCount) { return new FakeRange(this, row, column, rowCount, columnCount); };
FakeSheet.prototype.read = function (row, column, rowCount, columnCount) {
  var out = [];
  for (var r = 0; r < rowCount; r += 1) {
    var sourceRow = row + r === 1 ? this.headers : (this.rows[row + r - 2] || []);
    var values = [];
    for (var c = 0; c < columnCount; c += 1) values.push(sourceRow[column + c - 1] === undefined ? '' : sourceRow[column + c - 1]);
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
function FakeSpreadsheet(sheet) { this.sheet = sheet; }
FakeSpreadsheet.prototype.getSheetByName = function () { return this.sheet; };

var oldHeaders = vm.runInContext('HOTWORD_V2.masterHeaders.slice()', context);
var col = function (name) { return oldHeaders.indexOf(name); };
var sheet = new FakeSheet(oldHeaders, []);
var ss = new FakeSpreadsheet(sheet);
context.SpreadsheetApp = {getActiveSpreadsheet: function () { return ss; }};

function steamCandidate(candidateId, name, appId) {
  return {
    candidate_id: candidateId,
    canonical_name: name,
    has_steam: true,
    steam_app_ids: [appId],
    platform_listings: [{
      platform: 'STEAM',
      platform_game_id: appId,
      store_url: 'https://store.steampowered.com/app/' + appId + '/'
    }],
    signals: []
  };
}

function post(body) {
  return JSON.parse(context.doPost({postData: {contents: JSON.stringify(body)}}).text);
}

var payload = {
  token: token,
  job_type: 'UNIFIED_CANDIDATE_UPSERT',
  run_id: 'run-p5',
  observed_at: '2026-09-01T00:00:00Z',
  execution_status: 'COMPLETED',
  candidate_count: 1,
  candidates: [steamCandidate('p5-steam', 'P5 Steam Only', '3393280')]
};
var first = post(payload);
assert(first.ok === true && first.inserted === 1, 'authorized unified upsert accepted');
assert(sheet.rows[0][col('游戏名称')] === 'P5 Steam Only', 'candidate row written');
assert(sheet.rows[0][col('Steam App ID')] === '3393280', 'steam app id written');
assert(sheet.rows[0][oldHeaders.length] === 'p5-steam', 'candidate id written');

var twitchOnly = post({
  token: token,
  job_type: 'UNIFIED_CANDIDATE_UPSERT',
  run_id: 'run-p5-twitch',
  observed_at: '2026-09-01T00:00:00Z',
  execution_status: 'COMPLETED',
  candidate_count: 1,
  candidates: [{
    candidate_id: 'p5-only',
    canonical_name: 'P5 Twitch Only',
    has_steam: false,
    has_twitch: true,
    steam_app_ids: [],
    platform_listings: [{platform: 'TWITCH', platform_game_id: 'tw-p5'}],
    signals: []
  }]
});
assert(twitchOnly.ok === true && twitchOnly.inserted === 0 && twitchOnly.skippedNoSteam === 1,
  'Twitch-only payload accepted but skipped');
assert(sheet.rows.length === 1, 'Twitch-only does not write a master row');

var repeat = post(payload);
assert(repeat.ok === true && sheet.rows.length === 1, 'repeat upsert is idempotent');

assert(post({token: token, job_type: 'UNIFIED_CANDIDATE_UPSERT', run_id: 'run-p5', observed_at: '2026-09-01T00:00:00Z',
  execution_status: 'COMPLETED', candidates: []}).ok === true, 'empty candidate array accepted');

assert(post(Object.assign({}, payload, {token: 'wrong'})).ok === false, 'unauthorized callback rejected');
assert(post(Object.assign({}, payload, {job_type: 'STEAM_CANDIDATE_RESEARCH'})).ok === false, 'research job type rejected on unified route');
assert(post(Object.assign({}, payload, {candidate_count: 99})).error === 'candidate_count_mismatch', 'candidate_count mismatch rejected');
assert(post(Object.assign({}, payload, {evidence: []})).error === 'raw_evidence_not_allowed', 'raw evidence rejected');
assert(post(Object.assign({}, payload, {job_type: 'TWITCH_HISTORICAL_RAW_LEDGER_APPEND'})).ok === false,
  'retired Twitch ledger job type rejected');

var failed = post({
  token: token, job_type: 'UNIFIED_CANDIDATE_UPSERT', run_id: 'run-p5-fail',
  observed_at: '2026-09-01T00:00:00Z', execution_status: 'FAILED', error: 'provider unavailable'
});
assert(failed.ok === true && failed.execution_status === 'FAILED', 'failed callback accepted without sheet writes');
assert(sheet.rows.length === 1, 'failed callback does not append rows');
assert(JSON.stringify(sheet.rows).indexOf(token) < 0, 'token never written to sheet');

console.log('PASS scripts/test-unified-candidate-callback-p5.js');
