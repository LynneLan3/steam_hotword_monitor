/** G010 discovery segment index: no per-page full snapshot/ledger scans. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function FakeSheet(name, headers) {
  this.name = name;
  this.rows = [headers.slice()];
  this.getValuesCalls = 0;
  this.getDisplayValuesCalls = 0;
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.getLastColumn = function () {
  return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
};
FakeSheet.prototype.getMaxColumns = function () { return Math.max(40, this.getLastColumn()); };
FakeSheet.prototype.setFrozenRows = function () {};
FakeSheet.prototype.insertColumnsAfter = function () {};
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  const self = this;
  const height = arguments.length >= 3 ? numRows : 1;
  const width = arguments.length >= 4 ? numCols : 1;
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
    getValues: () => { self.getValuesCalls += 1; return values(); },
    getDisplayValues: () => { self.getDisplayValuesCalls += 1; return values().map(line => line.map(String)); },
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
  this.sheets = [];
}
FakeSpreadsheet.prototype.getId = function () { return this.id; };
FakeSpreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
FakeSpreadsheet.prototype.getSheetByName = function (name) {
  return this.sheets.find(sheet => sheet.name === name) || null;
};
FakeSpreadsheet.prototype.insertSheet = function (name) {
  const sheet = new FakeSheet(name, []);
  this.sheets.push(sheet);
  return sheet;
};

const SNAPSHOT_HEADERS = [
  '运行时间', 'Run ID', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名',
  '发布阶段', '距发售天数', 'Steam 发布日期', '评论数', '好评数', 'Steam评分',
  '机会预检状态', '机会预检原因'
];

const books = {};
const properties = {};
const histId = '1iRJCrgmUBbjvWkKkRjrOPVkoWr0LH8RQq4HH9yA_b6E';
properties.STEAM_HISTORICAL_RAW_LEDGER_V1_SPREADSHEET_ID = histId;
const hist = new FakeSpreadsheet(histId, 'Steam Historical Raw Ledger V1');
books[histId] = hist;

const ss = new FakeSpreadsheet('prod-1', 'prod');
const snap = new FakeSheet('Steam_每日快照', SNAPSHOT_HEADERS);
for (let i = 1; i <= 20000; i += 1) {
  snap.rows.push([
    new Date('2026-08-01T00:00:00Z'), '20260801-084300', String(100000 + i), 'Old ' + i,
    'https://store.steampowered.com/app/' + (100000 + i), 'Popular Upcoming', i,
    '即将发售', 30, '2026-10-01', 0, 0, '', '', ''
  ]);
}
ss.sheets.push(snap);

const sandbox = {
  console, Set, Map, Date, String, Number, Math, JSON, Object, Array, isFinite,
  PropertiesService: {getScriptProperties: () => ({
    getProperty: key => properties[key] || null,
    setProperty: (key, value) => { properties[key] = String(value); },
    deleteProperty: key => { delete properties[key]; },
    getKeys: () => Object.keys(properties)
  })},
  SpreadsheetApp: {
    openById: id => { if (!books[id]) throw new Error('missing ' + id); return books[id]; },
    create: name => {
      const id = 'ledger-' + (Object.keys(books).length + 1);
      books[id] = new FakeSpreadsheet(id, name);
      return books[id];
    },
    getUi: function () {
      const menu = {
        addItem: function () { return menu; },
        addSeparator: function () { return menu; },
        addToUi: function () {}
      };
      return {alert: function () {}, createMenu: function () { return menu; }};
    }
  },
  ScriptApp: {
    getProjectTriggers: () => [],
    newTrigger: () => ({
      timeBased: () => ({
        after: () => ({create: () => {}}),
        everyMinutes: () => ({create: () => {}}),
        everyDays: () => ({atHour: () => ({create: () => {}})})
      })
    }),
    deleteTrigger: () => {}
  },
  LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})},
  Utilities: {formatDate: () => '20260910-084335'},
  ContentService: {createTextOutput: t => ({setMimeType: () => t}), MimeType: {JSON: 'json'}},
  UrlFetchApp: {fetch: () => ({getResponseCode: () => 200, getContentText: () => ''})},
  Logger: {log: () => {}}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

assert(/const G010_EXECUTION_BUDGET_MS = 240000/.test(source), 'budget is 240000');
assert(/const G010_REMAINING_TIME_RESERVE_MS = 75000/.test(source), 'reserve is 75s');
assert.strictEqual(typeof sandbox.g010HasTimeForExpensiveOp_, 'function', 'time guard exists');
assert.strictEqual(typeof sandbox.runG010Supervisor_, 'function', 'supervisor exists');
assert.strictEqual(typeof sandbox.g010InitDiscoverySegmentIndex_, 'function', 'segment index exists');

// Seed historical ledger rows (headers must match HOTWORD_V2.historicalRawLedger).
const ledgerHeaders = [
  'Observation ID', 'Observed At', 'Run ID', 'Run Date', 'Steam App ID',
  '游戏名称', 'Steam URL', 'Source', 'Source Page', 'Source Rank',
  'Release Date', 'Release Date Raw', 'Release Stage', 'Days To Release',
  'Followers', 'Followers Baseline', 'Followers 7d Gain', 'Follower Growth Rate',
  'Review Count', 'Positive Reviews', 'Rating', 'Data Status',
  'Raw Observation Status', 'Provider', 'Provider Provenance', 'Schema Version'
];
const histSheet = new FakeSheet('Raw Observations', ledgerHeaders);
for (let i = 1; i <= 500; i += 1) {
  histSheet.rows.push([
    'steam|20260801-084300|' + (100000 + i) + '|Popular Upcoming', new Date(),
    '20260801-084300', '20260801', String(100000 + i), 'Old ' + i, '', 'Popular Upcoming', 1, i,
    '', '', '', '', '', '', '', '', '', '', '', 'RAW_CAPTURED', 'RAW_ONLY', 'Steam Store Search', '', '1'
  ]);
}
hist.sheets.push(histSheet);

assert.strictEqual(typeof sandbox.g010InitDiscoverySegmentIndex_, 'function',
  'segment index loaded (vm must successfully evaluate scanner source)');
assert.strictEqual(typeof sandbox.g010AppendRawPage_, 'function', 'append raw page loaded');
assert.strictEqual(typeof sandbox.g010AppendHistoricalRawLedger_, 'function', 'ledger append loaded');

const runId = '20260910-084335';
const index = sandbox.g010InitDiscoverySegmentIndex_(ss, runId);
assert.strictEqual(index.seenAppIds.size, 0, 'new run starts with empty seen set');
assert.strictEqual(index.snapshotFullScans, 1, 'segment init counts one current-run scan');

const beforeSnapReads = snap.getValuesCalls + snap.getDisplayValuesCalls;
const beforeLedgerReads = histSheet.getValuesCalls + histSheet.getDisplayValuesCalls;

for (let page = 1; page <= 5; page += 1) {
  const records = [];
  for (let i = 0; i < 50; i += 1) {
    const appId = String(900000 + (page - 1) * 50 + i);
    records.push({
      appId: appId, name: 'Game ' + appId,
      url: 'https://store.steampowered.com/app/' + appId,
      source: 'Popular Upcoming', sources: ['Popular Upcoming'],
      sourceRank: (page - 1) * 50 + i + 1, sourcePage: page,
      ranks: ['Popular Upcoming#' + ((page - 1) * 50 + i + 1)],
      sourcePages: ['Popular Upcoming#' + page],
      releaseDate: '2026-11-01', releaseRaw: '1 Nov, 2026',
      releaseStage: '即将发售', daysToRelease: 50,
      reviews: 0, positiveReviews: 0, rating: null, rawStatus: 'RAW_ONLY',
      dataNotes: [], observationDataNotes: [], dataStatus: 'RAW_CAPTURED'
    });
  }
  const ledger = sandbox.g010AppendHistoricalRawLedger_(records, new Date(), runId, {
    existingObservationIds: index.existingObservationIds
  });
  index.existingObservationIds = ledger.existingObservationIds;
  if (ledger.scannedLedgerForDuplicates) index.ledgerFullScans += 1;
  const appended = sandbox.g010AppendRawPage_(ss, records, new Date(), runId, {
    seenAppIds: index.seenAppIds,
    previousRawIndex: index.previousRawIndex
  });
  if (appended.scannedSnapshotForSeen) index.snapshotFullScans += 1;
  assert.strictEqual(appended.persisted, 50, 'page ' + page + ' persists 50');
  assert.strictEqual(ledger.appended, 50, 'page ' + page + ' ledger appends 50');
  assert.strictEqual(appended.scannedSnapshotForSeen, false,
    'page ' + page + ' must not full-scan Steam_每日快照 for seen index');
  if (page === 1) {
    assert.strictEqual(ledger.scannedLedgerForDuplicates, true, 'first ledger load scans once');
  } else {
    assert.strictEqual(ledger.scannedLedgerForDuplicates, false,
      'page ' + page + ' must not full-scan Historical Raw Ledger');
  }
}

const afterSnapReads = snap.getValuesCalls + snap.getDisplayValuesCalls;
const afterLedgerReads = histSheet.getValuesCalls + histSheet.getDisplayValuesCalls;
assert.strictEqual(index.ledgerFullScans, 1, 'ledger full scan at most once per segment');
assert.strictEqual(index.snapshotFullScans, 1, 'snapshot seen full scan stays at segment init');
assert.strictEqual(index.seenAppIds.size, 250, 'memory seen index tracks all appended appIds');
assert(afterSnapReads - beforeSnapReads < 40,
  'multi-page append must not re-read 20k-row snapshot each page (delta=' +
  (afterSnapReads - beforeSnapReads) + ')');
assert(afterLedgerReads - beforeLedgerReads < 20,
  'multi-page ledger append must not re-scan ledger each page (delta=' +
  (afterLedgerReads - beforeLedgerReads) + ')');

const retry = Array.from({length: 50}, (_, i) => ({
  appId: String(900000 + i), name: 'Game', url: '', source: 'Popular Upcoming',
  sources: ['Popular Upcoming'], ranks: ['Popular Upcoming#1'], sourcePages: ['Popular Upcoming#1'],
  releaseStage: '即将发售', daysToRelease: 50, rawStatus: 'RAW_ONLY',
  dataNotes: [], observationDataNotes: [], dataStatus: 'RAW_CAPTURED'
}));
const retryLedger = sandbox.g010AppendHistoricalRawLedger_(retry, new Date(), runId, {
  existingObservationIds: index.existingObservationIds
});
const retrySnap = sandbox.g010AppendRawPage_(ss, retry, new Date(), runId, {
  seenAppIds: index.seenAppIds,
  previousRawIndex: index.previousRawIndex
});
assert.strictEqual(retryLedger.appended, 0, 'retry ledger appends no duplicates');
assert.strictEqual(retrySnap.persisted, 0, 'retry snapshot appends no duplicates');
assert.strictEqual(retryLedger.scannedLedgerForDuplicates, false, 'retry still skips ledger scan');
assert.strictEqual(retrySnap.scannedSnapshotForSeen, false, 'retry still skips snapshot scan');

assert(/seenAppIds: discoveryIndex\.seenAppIds/.test(source), 'discovery reuses snapshot seen index');
assert(/existingObservationIds: discoveryIndex\.existingObservationIds/.test(source),
  'discovery reuses ledger index');
assert(!/const seenAppIds = new Set\(g010RawRecordsForRun_\(ss, state\.runId\)/.test(source),
  'discovery no longer rebuilds seen set from full raw scan each page');

console.log('PASS scripts/test-g010-discovery-segment-index.js');
