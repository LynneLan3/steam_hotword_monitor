/** G018 P3: existing 候选主表 compatibility/upsert tests. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var context = {console: console, Math: Math, Date: Date, JSON: JSON, String: String, Number: Number, Set: Set, Map: Map};
vm.createContext(context);
vm.runInContext(source, context);

function assert(value, message) { if (!value) throw new Error(message); }
function cloneRow(row, width) {
  var next = row.slice(0, width);
  while (next.length < width) next.push('');
  return next;
}
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
FakeSheet.prototype.insertColumnsAfter = function (column, count) {
  for (var i = 0; i < count; i += 1) this.headers.push('');
  this.maxColumns += count;
};
function FakeSpreadsheet(sheet) { this.sheet = sheet; }
FakeSpreadsheet.prototype.getSheetByName = function () { return this.sheet; };

var oldHeaders = vm.runInContext('HOTWORD_V2.masterHeaders.slice()', context);
var col = function (name) { return oldHeaders.indexOf(name); };
function oldRow(appId, name, decision) {
  var row = new Array(oldHeaders.length).fill('');
  row[col('Steam App ID')] = appId || '';
  row[col('游戏名称')] = name || '';
  row[col('人工备注')] = decision || '';
  return row;
}
function steamCandidate(appId, name, candidateId) {
  return {candidate_id: candidateId || 'steam-' + appId, canonical_name: name, has_steam: true, has_twitch: false,
    steam_app_ids: [appId], platform_listings: [{platform: 'STEAM', platform_game_id: appId, store_url: 'https://store.steampowered.com/app/' + appId + '/'}], signals: []};
}
function twitchCandidate(candidateId, name, appId) {
  var listings = [{platform: 'TWITCH', platform_game_id: 'tw-' + candidateId}];
  if (appId) listings.push({platform: 'STEAM', platform_game_id: appId, store_url: 'steam://' + appId});
  return {candidate_id: candidateId, canonical_name: name, has_steam: !!appId, has_twitch: true,
    steam_app_ids: appId ? [appId] : [], platform_listings: listings,
    signals: [{source: 'TWITCH_HELIX_TOP_GAMES', raw_value: 7, observed_at: '2026-09-01T00:00:00Z',
      signal_id: 'sig-' + candidateId, metadata: {twitch_game_id: 'tw-' + candidateId, igdb_id: 'ig-' + candidateId, run_id: 'run-p3'}}]};
}

var historical = oldRow('9001', 'Historical Steam', 'WATCH');
var sheet = new FakeSheet(oldHeaders, [historical]);
var ss = new FakeSpreadsheet(sheet);
var first = context.upsertUnifiedCandidates_(ss, [steamCandidate('9001', 'Historical Steam')]);
assert(first.updated === 1 && sheet.rows.length === 1, 'historical Steam row updated in place');
assert(sheet.rows[0][oldHeaders.length] === 'steam-9001', 'Candidate ID added without moving legacy columns');
assert(sheet.rows[0][col('人工备注')] === 'WATCH', 'legacy manual field preserved');

var twitchOnly = context.upsertUnifiedCandidates_(ss, [twitchCandidate('twitch-only', 'Twitch Only')]);
assert(twitchOnly.inserted === 1, 'Twitch-only candidate inserted');
var twitchRow = sheet.rows[1];
assert(twitchRow[col('候选来源')] === 'TWITCH' && twitchRow[col('Steam App ID')] === '', 'Twitch-only has no Steam App ID and is retained');
assert(twitchRow[oldHeaders.length] === 'twitch-only', 'Candidate ID written');
assert(twitchRow[oldHeaders.length + 1] === 'tw-twitch-only', 'Twitch identity written');

var dual = context.upsertUnifiedCandidates_(ss, [twitchCandidate('shared', 'Shared Game')]);
assert(dual.inserted === 1, 'dual source initial row inserted');
var dualUpdate = context.upsertUnifiedCandidates_(ss, [twitchCandidate('shared', 'Shared Game', '7007')]);
assert(dualUpdate.updated === 1 && sheet.rows.length === 3, 'Twitch first later Steam updates same row');
var sharedRow = sheet.rows[2];
assert(sharedRow[col('候选来源')] === 'STEAM+TWITCH' && sharedRow[col('Steam App ID')] === '7007', 'dual source fields merged');
var before = JSON.stringify(sheet.rows);
context.upsertUnifiedCandidates_(ss, [twitchCandidate('shared', 'Shared Game', '7007')]);
assert(sheet.rows.length === 3 && JSON.stringify(sheet.rows).indexOf('twitch-only') >= 0, 'rerun does not append duplicate rows');
assert(JSON.stringify(sheet.rows).length >= before.length, 'rerun leaves existing data present');

var missingHeadersSheet = new FakeSheet(oldHeaders.concat(['Candidate ID']), []);
var missingHeadersResult = context.upsertUnifiedCandidates_(new FakeSpreadsheet(missingHeadersSheet), [twitchCandidate('schema', 'Schema Game')]);
assert(missingHeadersResult.schemaAppended.length === 12, 'missing additive headers auto-appended (5 Twitch + 7 outcome)');
console.log('PASS scripts/test-unified-candidate-sheet.js (Steam/Twitch source combinations, merge, idempotency, legacy compatibility)');
