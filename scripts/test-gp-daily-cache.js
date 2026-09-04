/* GP daily cache V1 regression tests; local only, no Apps Script or network. */
var fs = require('fs');
var vm = require('vm');

var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');
var providerCallCounts = {latest: 0, followers: 0};
var providerMode = 'success';
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
          providerCallCounts.latest += 1;
          if (providerMode === '429') return response(429, 'rate limited');
          return response(200, JSON.stringify({followers: {followers: 24559}}));
        }
        providerCallCounts.followers += 1;
        if (providerMode === '429') return response(429, 'rate limited');
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
    getDisplayValue: function () {
      return this.getValue();
    },
    setValue: function (value) {
      while (self.rows.length < row) self.rows.push([]);
      while (self.rows[row - 1].length < col) self.rows[row - 1].push('');
      self.rows[row - 1][col - 1] = value;
      return this;
    },
    setValues: function (values) {
      values.forEach(function (value, r) {
        while (self.rows.length < row - 1 + r + 1) self.rows.push([]);
        self.rows[row - 1 + r] = value.slice();
      });
    }
  };
};
FakeSheet.prototype.appendRow = function (value) { this.rows.push(value.slice()); };

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
var dayOne = new Date('2026-08-28T04:00:00.000Z');
var dayTwo = new Date('2026-08-29T04:00:00.000Z');
var appId = '2825860';
var rec = {appId: appId, name: 'The Sinking City 2', sourcePage: '#1', dataNotes: [], observationDataNotes: []};
var ss = new FakeSpreadsheet({Steam_每日快照: new FakeSheet([h.snapshotHeaders])});

function runEquivalentEnrichment(runTime, runId) {
  var beforeCalls = {latest: providerCallCounts.latest, followers: providerCallCounts.followers};
  var record = {appId: rec.appId, name: rec.name, sourcePage: rec.sourcePage, dataNotes: [], observationDataNotes: []};
  var persistence = context.appendSnapshots_(ss, [record], runTime, runId);
  var cache = context.readDailyGamesPopularityCache_(ss, runTime);
  var partition = context.partitionDailyGamesPopularityCache_([record], cache);
  var stats = {realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0};

  if (partition.hits.length) {
    record._gpDailyCache = cache.get(appId);
    record.followers = record._gpDailyCache.followers;
    record.baselineFollowers = record._gpDailyCache.baselineFollowers;
    record.gain7d = record._gpDailyCache.gain7d;
    record.growthRate = record._gpDailyCache.growthRate;
    record.coverageDays = record._gpDailyCache.coverageDays;
  } else {
    var latest = context.fetchGamesPopularityLatestBatch_(partition.misses, 'key', [], stats).get(appId);
    var history = context.fetchGamesPopularityFollowersBatch_(partition.misses, 'key', [], stats).get(appId);
    assert(latest && history, 'fresh run must receive both GP responses');
    record.followers = latest.followers.followers;
    record.baselineFollowers = 24000;
    record.gain7d = 559;
    record.growthRate = 0.023;
    record.coverageDays = 7;
  }
  record._gpEnrichmentFresh = true;
  record.rawStatus = 'ENRICHED';
  context.updateSnapshots_(ss, [record], runTime, runId, persistence.rowByAppId);
  return {
    latest: providerCallCounts.latest - beforeCalls.latest,
    followers: providerCallCounts.followers - beforeCalls.followers,
    cacheHit: partition.hits.length === 1,
    stats: stats
  };
}

assertEqual(context.readDailyGamesPopularityCache_(ss, dayOne).size, 0, 'test must begin without a same-day successful cache');
var runResults = [];
for (var run = 1; run <= 5; run += 1) {
  runResults.push(runEquivalentEnrichment(dayOne, 'run-' + run));
}
assertEqual(runResults[0].latest, 1, 'Run 1 latest request');
assertEqual(runResults[0].followers, 1, 'Run 1 followers request');
assertEqual(runResults[0].stats.realtimeSuccess, 2, 'Run 1 persists two successful endpoint results');
assert(context.readDailyGamesPopularityCache_(ss, dayOne).has(appId), 'Run 1 successful result is durably persisted');
for (var sameDayRun = 1; sameDayRun < runResults.length; sameDayRun += 1) {
  assertEqual(runResults[sameDayRun].latest, 0, 'Run ' + (sameDayRun + 1) + ' latest request');
  assertEqual(runResults[sameDayRun].followers, 0, 'Run ' + (sameDayRun + 1) + ' followers request');
  assert(runResults[sameDayRun].cacheHit, 'Run ' + (sameDayRun + 1) + ' reuses persisted successful cache');
}
assertEqual(providerCallCounts.latest, 1, 'same business day latest total');
assertEqual(providerCallCounts.followers, 1, 'same business day followers total');

var runSix = runEquivalentEnrichment(dayTwo, 'run-6');
assertEqual(runSix.latest, 1, 'Run 6 next-day latest request');
assertEqual(runSix.followers, 1, 'Run 6 next-day followers request');
assert(!runSix.cacheHit, 'Run 6 refreshes because the daily policy expired');
assertEqual(providerCallCounts.latest, 2, 'two business days latest total');
assertEqual(providerCallCounts.followers, 2, 'two business days followers total');

providerMode = '429';
var later429Stats = {realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0};
context.fetchGamesPopularityLatestBatch_([rec], 'key', [], later429Stats);
context.fetchGamesPopularityFollowersBatch_([rec], 'key', [], later429Stats);
assertEqual(later429Stats.rateLimited, 2, 'later HTTP 429 is observed on both GP endpoints');

var masterRows = [h.masterHeaders, [dayOne, appId, rec.name, '', '', '', '', '', '', 0, 24559, 24000, 559, 0.023, 7, '', '', '', '', '', '', '', '', '', '', '', '', dayOne, dayOne, 'run-1', '']];
var master = new FakeSheet(masterRows);
var failed = {appId: appId, name: rec.name, url: '', source: '', sourceRank: '', releaseDate: '', releaseRaw: '', releaseStage: '', daysToRelease: 0, followers: null, baselineFollowers: null, gain7d: null, growthRate: null, coverageDays: null, reviews: null, positiveReviews: null, rating: null, result1A: '⚠ 数据异常', reason1A: 'GP 429', firstRoundType: '', priority: '', continueNext: '', nextAction: '', firstRoundReason: '', currentStage: '1A待数据', dataStatus: '⚠ 数据缺失', dataNotes: [], _gpEnrichmentFailed: true};
var failureStats = {failuresKept: 0};
context.upsertMaster_(new FakeSpreadsheet({候选主表: master}), [failed], dayTwo, 'run-7', failureStats);
assertEqual(master.rows[1][10], 24559, '429 must preserve prior master Followers');
assertEqual(failureStats.failuresKept, 1, '429 preservation diagnostic');
assertEqual(master.rows[1][h.masterHeaders.indexOf('数据状态')], '待数据', 'missing GP marks 待数据');

providerMode = '404';
var notFoundWarnings = [];
var notFoundStats = {realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0};
context.UrlFetchApp.fetchAll = function (requests) {
  return requests.map(function () {
    return response(404, 'NOT_FOUND');
  });
};
var notFoundRec = {appId: appId, name: rec.name, dataNotes: []};
context.fetchGamesPopularityLatestBatch_([notFoundRec], 'key', notFoundWarnings, notFoundStats);
context.fetchGamesPopularityFollowersBatch_([notFoundRec], 'key', notFoundWarnings, notFoundStats);
assertEqual(notFoundWarnings.length, 0, 'GP 404 must not raise run-level warnings');
assert(context.hasInfrastructureRunWarnings_(notFoundWarnings) === false, 'empty warnings are not infrastructure');
assert(context.hasInfrastructureRunWarnings_(['GP latest HTTP 429 ' + appId]) === true, '429 remains infrastructure');
assert(context.hasInfrastructureRunWarnings_(['GP数据集无此App ' + appId]) === false, 'legacy GP missing text is not infrastructure');

var raw = {appId: appId, name: rec.name, _gpEnrichmentFresh: false};
var updated = context.updateSnapshots_(ss, [raw], dayTwo, 'run-7', {});
assertEqual(updated.updated, 0, 'failed enrichment must not update a snapshot as enriched');

console.log('PASS scripts/test-gp-daily-cache.js (same-day hit, next-day miss, five-run cap, 429 preservation, GP 404 non-PARTIAL)');
