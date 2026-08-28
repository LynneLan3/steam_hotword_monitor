/* GP daily cache V1 regression tests; local only, no Apps Script or network. */
var fs = require('fs');
var vm = require('vm');

var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');
var context = {
  console: console,
  Utilities: {
    formatDate: function (date) { return date.toISOString().slice(0, 10); },
    sleep: function () {}
  },
  UrlFetchApp: {
    fetchAll: function (requests) {
      return requests.map(function (request) {
        if (request.url.indexOf('/latest/') >= 0) {
          return response(200, JSON.stringify({followers: {followers: 24559}}));
        }
        return response(200, JSON.stringify({history: [
          {followers: 24000, added: 559},
          {followers: 24559, added: 559}
        ]}));
      });
    }
  }
};
vm.runInNewContext(source, context);
vm.runInNewContext('this.TEST_HOTWORD = HOTWORD_V2;', context);

function response(code, body) {
  return {
    getResponseCode: function () { return code; },
    getContentText: function () { return body; }
  };
}

function FakeSheet(rows) {
  this.rows = rows || [];
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.getLastColumn = function () { return this.rows.reduce(function (n, r) { return Math.max(n, r.length); }, 0); };
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  var self = this;
  return {
    getValues: function () { return sliceRows(self.rows, row, col, numRows, numCols); },
    getDisplayValues: function () { return sliceRows(self.rows, row, col, numRows, numCols); },
    getValue: function () {
      return self.rows[row - 1] && self.rows[row - 1][col - 1] !== undefined
        ? self.rows[row - 1][col - 1] : '';
    },
    setValues: function (values) {
      values.forEach(function (value, r) {
        while (self.rows.length < row - 1 + r + 1) self.rows.push([]);
        self.rows[row - 1 + r] = value.slice();
      });
    }
  };
};

function sliceRows(rows, row, col, numRows, numCols) {
  return rows.slice(row - 1, row - 1 + numRows).map(function (sourceRow) {
    var result = [];
    for (var i = 0; i < numCols; i += 1) result.push(sourceRow[col - 1 + i] === undefined ? '' : sourceRow[col - 1 + i]);
    return result;
  });
}

function FakeSpreadsheet(sheets) {
  this.sheets = sheets;
}
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Shanghai'; };

function assert(value, message) { if (!value) throw new Error(message); }
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ': ' + actual + ' !== ' + expected);
}

var h = context.TEST_HOTWORD;
var now = new Date('2026-08-28T04:00:00.000Z');
var tomorrow = new Date('2026-08-29T04:00:00.000Z');
var appId = '2825860';
var rec = {appId: appId, name: 'The Sinking City 2'};
var snapshotRows = [h.snapshotHeaders, [now, 'run-1', appId, rec.name, '', '', '', '', '', '', 24559, 24000, 559, 0.023, 7, '', '', '', '', '', '', '', '', '', '', '', 'ENRICHED']];
var ss = new FakeSpreadsheet({Steam_每日快照: new FakeSheet(snapshotRows)});

var cache = context.readDailyGamesPopularityCache_(ss, now);
assert(cache.has(appId), 'same-day successful snapshot must be a cache hit');
var partition = context.partitionDailyGamesPopularityCache_([rec], cache);
assertEqual(partition.hits.length, 1, 'same-day hit count');
assertEqual(partition.misses.length, 0, 'same-day miss count');

var stats = {realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0};
context.fetchGamesPopularityLatestBatch_(partition.misses, 'key', [], stats);
context.fetchGamesPopularityFollowersBatch_(partition.misses, 'key', [], stats);
assertEqual(stats.realtimeRequests, 0, 'cache hit must skip both GP endpoints');

var nextDayCache = context.readDailyGamesPopularityCache_(ss, tomorrow);
var nextDayPartition = context.partitionDailyGamesPopularityCache_([rec], nextDayCache);
assertEqual(nextDayPartition.misses.length, 1, 'next business day must be a cache miss');
var requestStats = {realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0};
context.fetchGamesPopularityLatestBatch_(nextDayPartition.misses, 'key', [], requestStats);
context.fetchGamesPopularityFollowersBatch_(nextDayPartition.misses, 'key', [], requestStats);
assertEqual(requestStats.realtimeRequests, 2, 'first run of a day requests latest and followers once');
assertEqual(requestStats.realtimeSuccess, 2, 'both GP endpoint responses succeed');

var fiveRunRequests = 0;
for (var run = 0; run < 5; run += 1) {
  var daily = context.partitionDailyGamesPopularityCache_([rec], cache);
  var runStats = {realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0};
  context.fetchGamesPopularityLatestBatch_(daily.misses, 'key', [], runStats);
  context.fetchGamesPopularityFollowersBatch_(daily.misses, 'key', [], runStats);
  fiveRunRequests += runStats.realtimeRequests;
}
assertEqual(fiveRunRequests, 0, 'five subsequent same-day runs must not refetch GP');

var masterRows = [h.masterHeaders, [now, appId, rec.name, '', '', '', '', '', '', 0, 0, 24559, 24000, 559, 0.023, 7, '', '', '', '', '', '', '', '', '', '', '', '', now, now, 'run-1', '']];
var master = new FakeSheet(masterRows);
var failed = {appId: appId, name: rec.name, url: '', source: '', sourceRank: '', releaseDate: '', releaseRaw: '', releaseStage: '', daysToRelease: 0, followers: null, baselineFollowers: null, gain7d: null, growthRate: null, coverageDays: null, reviews: null, positiveReviews: null, rating: null, result1A: '⚠ 数据异常', reason1A: 'GP 429', firstRoundType: '', priority: '', continueNext: '', nextAction: '', firstRoundReason: '', currentStage: '1A待数据', dataStatus: '⚠ 数据缺失', dataNotes: [], _gpEnrichmentFailed: true};
var failureStats = {failuresKept: 0};
context.upsertMaster_(new FakeSpreadsheet({候选主表: master}), [failed], now, 'run-2', failureStats);
assertEqual(master.rows[1][11], 24559, '429 must preserve prior master Followers');
assertEqual(failureStats.failuresKept, 1, '429 preservation diagnostic');

var raw = {appId: appId, name: rec.name, _gpEnrichmentFresh: false};
var updated = context.updateSnapshots_(ss, [raw], now, 'run-2', {});
assertEqual(updated.updated, 0, 'failed enrichment must not update a snapshot as enriched');

console.log('PASS scripts/test-gp-daily-cache.js (same-day hit, next-day miss, five-run cap, 429 preservation)');
