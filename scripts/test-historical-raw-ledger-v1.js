/* Historical Raw Ledger V1: append-only identity, schema, and failure regression. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function FakeSheet(name) {
  this.name = name;
  this.rows = [];
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.getLastColumn = function () { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); };
FakeSheet.prototype.setFrozenRows = function () {};
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  const self = this;
  const height = numRows || 1;
  const width = numCols || 1;
  function values() {
    const out = [];
    for (let r = 0; r < height; r += 1) {
      const sourceRow = self.rows[row - 1 + r] || [];
      const next = [];
      for (let c = 0; c < width; c += 1) next.push(sourceRow[col - 1 + c] == null ? '' : sourceRow[col - 1 + c]);
      out.push(next);
    }
    return out;
  }
  return {
    getValues: values,
    getDisplayValues: () => values().map(line => line.map(value => String(value))),
    getDisplayValue: () => String(values()[0][0]),
    setValue: value => { this.setValues([[value]]); },
    setValues: input => {
      input.forEach((line, r) => {
        const target = self.rows[row - 1 + r] || [];
        line.forEach((value, c) => { target[col - 1 + c] = value; });
        self.rows[row - 1 + r] = target;
      });
    }
  };
};

function FakeSpreadsheet(id, name) {
  this.id = id;
  this.name = name;
  this.sheets = [new FakeSheet('Sheet1')];
}
FakeSpreadsheet.prototype.getId = function () { return this.id; };
FakeSpreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets.find(sheet => sheet.name === name) || null; };
FakeSpreadsheet.prototype.insertSheet = function (name) { const sheet = new FakeSheet(name); this.sheets.push(sheet); return sheet; };

const properties = {};
const books = {};
const HISTORICAL_ID = '1iRJCrgmUBbjvWkKkRjrOPVkoWr0LH8RQq4HH9yA_b6E';
books[HISTORICAL_ID] = new FakeSpreadsheet(HISTORICAL_ID, 'Steam Historical Raw Ledger V1');
let failLedgerOpen = false;
const sandbox = {
  console, Set, Map, Date, String, Number, Math, JSON, Object, Array,
  PropertiesService: {getScriptProperties: () => ({
    getProperty: key => properties[key] || null,
    setProperty: (key, value) => { properties[key] = String(value); }
  })},
  SpreadsheetApp: {
    create: name => { const id = 'ledger-' + (Object.keys(books).length + 1); books[id] = new FakeSpreadsheet(id, name); return books[id]; },
    openById: id => { if (failLedgerOpen) throw new Error('forced ledger write failure'); if (!books[id]) throw new Error('missing spreadsheet'); return books[id]; }
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

function record(appId, sourceName) {
  return {
    appId: String(appId), name: 'Game ' + appId, url: 'https://store.steampowered.com/app/' + appId,
    sources: [sourceName], ranks: [sourceName + '#' + appId], sourcePages: [sourceName + '#1'],
    releaseDate: '2026-10-01', releaseRaw: '1 Oct, 2026', releaseStage: '即将发售', daysToRelease: 30,
    reviews: 10, positiveReviews: 9, rating: 0.9, rawStatus: 'RAW_ONLY'
  };
}

const sourceName = 'Popular Upcoming';
const directDiscoveryRecord = {source: sourceName, sourcePage: sourceName + '#3', sourceRank: sourceName + '#101'};
assert.strictEqual(sandbox.g010HistoricalRawSourcePage_(directDiscoveryRecord, sourceName), 3, 'direct discovery source page is preserved');
assert.strictEqual(sandbox.g010HistoricalRawSourceRank_(directDiscoveryRecord, sourceName), 101, 'direct discovery source rank is preserved');
const batch = Array.from({length: 250}, (_, index) => record(index + 1, sourceName));
const first = sandbox.g010AppendHistoricalRawLedger_(batch, new Date('2026-09-01T04:00:00Z'), '20260901-130000');
assert.strictEqual(first.appended, 250, '250 observations append normally');
assert.strictEqual(first.duplicates, 0, 'first run has no duplicates');

const second = sandbox.g010AppendHistoricalRawLedger_(batch, new Date('2026-09-01T04:00:00Z'), '20260901-130000');
assert.strictEqual(second.appended, 0, 'same Run retry appends no duplicate');
assert.strictEqual(second.duplicates, 250, 'same Run retry identifies all duplicates');

const nextRun = sandbox.g010AppendHistoricalRawLedger_([record(1, sourceName)], new Date('2026-09-02T04:00:00Z'), '20260902-130000');
assert.strictEqual(nextRun.appended, 1, 'same App ID on a new Run is a new daily observation');

const ledger = books[first.spreadsheetId];
const rawSheet = ledger.getSheetByName('Raw Observations');
assert.strictEqual(rawSheet.rows[0].join('|'),
  'Observation ID|Observed At|Run ID|Run Date|Steam App ID|游戏名称|Steam URL|Source|Source Page|Source Rank|Release Date|Release Date Raw|Release Stage|Days To Release|Followers|Followers Baseline|Followers 7d Gain|Follower Growth Rate|Review Count|Positive Reviews|Rating|Data Status|Raw Observation Status|Provider|Provider Provenance|Schema Version',
  'schema is installed exactly once');
assert.strictEqual(rawSheet.rows.length, 252, 'header plus 251 append-only observations');
assert.strictEqual(rawSheet.rows[1][0], 'steam|20260901-130000|1|Popular Upcoming', 'Observation ID is stable and source-aware');

failLedgerOpen = true;
assert.throws(() => sandbox.g010AppendHistoricalRawLedger_([record(999, sourceName)], new Date(), '20260903-130000'), /forced ledger write failure/);
const completion = sandbox.g010EvaluateRunCompletion_({
  discoveryComplete: true, enrichmentCursor: 0, ledgerWriteFailures: 1,
  discoveryAudit: {sources: {
    'Popular Upcoming': {stopReason: 'max-pages', pagesFetched: 5},
    'Popular New Releases': {stopReason: 'max-pages', pagesFetched: 5}
  }}
}, {eligible: []}, false);
assert.strictEqual(completion.status, 'PARTIAL', 'ledger failure cannot be reported as SUCCESS');
assert(completion.issues.includes('RAW_LEDGER_WRITE_FAILED'), 'ledger failure has explicit run status');

assert(source.indexOf('g010AppendHistoricalRawLedger_(records, startedAt, state.runId)') < source.indexOf('g010AppendRawPage_(ss, records, startedAt, state.runId)'),
  'daily order is ledger append before compatible business raw persistence');
console.log('PASS scripts/test-historical-raw-ledger-v1.js');
