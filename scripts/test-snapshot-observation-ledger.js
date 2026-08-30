const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('SteamCandidateScanner.js', 'utf8');

assert(
  /const observations = discovered\.map\(createCandidateRecord_\)/.test(source),
  'discovered items become the full observation collection'
);
assert(
  /active\.push\(rec\)/.test(source),
  'active candidates are derived from observation records'
);
assert(
  /const cachePartition = partitionDailyGamesPopularityCache_\(active, dailyGpCache\)[\s\S]*?const cacheMisses = cachePartition\.misses/.test(source),
  'GP cache partition is derived from bounded active candidates'
);
assert(
  /appendSnapshots_\(ss, observations, startedAt, runId\)/.test(source),
  'snapshots receive the full observation collection'
);
assert(!/G010_RAW_DISCOVERY_PAGES\s*=/.test(source), 'no fixed raw discovery page cap remains');
assert(/const candidateScope = observations;/.test(source), 'all raw observations enter candidate qualification');
assert(/stopReason = page === 1 \? 'empty-page-1' : 'empty-page'/.test(source), 'auto pagination stops on empty page');
assert(/stopReason = duplicatePage \? 'duplicate-page-2-pages'/.test(source), 'auto pagination stops on duplicate pages after two pages');
assert(/consecutiveNoNewPages/.test(source), 'pagination tracks consecutive no-new pages');
assert(/consecutiveNoNewPages >= 2/.test(source), 'auto pagination requires two no-new pages');
assert(/continuationKey[\s\S]*?props\.setProperty\(continuationKey, String\(page\)\)/.test(source), 'partial pagination saves continuation page');
assert(/liveResult\.continuation \? false : saveSteamSourceCache_/.test(source), 'partial retrieval cannot replace successful cache');
assert(/STEAM_SOURCE_CONTINUATION_V1_/.test(source), 'continuation uses a separate property namespace');
assert(/'all-raw-observations \(auto-pagination\)'/.test(source), 'run log candidate scope is automatic pagination');
assert(/fetchGamesPopularityLatestBatch_\(cacheMisses, gpKey, warnings, gpStats, gpAttemptContext\)/.test(source), 'latest enrichment uses only cache misses');
assert(/fetchGamesPopularityFollowersBatch_\(cacheMisses, gpKey, warnings, gpStats, gpAttemptContext\)/.test(source), 'follower history uses only cache misses');
assert(/if \(rec\._gpDailyCache\)[\s\S]*?rec\._gpEnrichmentFresh = true/.test(source), 'cache hit reuses complete enrichment');
assert(/const snapshotUpdate = updateSnapshots_\(ss, active\.filter\(rec => rec\._gpEnrichmentFresh\)/.test(source), 'only successful enrichment updates snapshots');
assert(/if \(rec\._gpEnrichmentFresh\) rec\.rawStatus = 'ENRICHED'/.test(source), 'failed enrichment stays out of ENRICHED state');
assert(/'来源页码', '原始观察状态'/.test(source), 'raw provenance/status fields append at snapshot end');
assert(/function updateSnapshots_\(ss, records, runTime, runId, rowByAppId\)/.test(source), 'same-run snapshot updater exists');
assert(/identity\[0\].*runId[\s\S]*identity\[1\].*rec\.appId/.test(source), 'snapshot updates guard Run ID and App ID');

function simulateRun(discovered, historyIds) {
  const observations = discovered.map(item => ({appId: item.appId, name: item.name, page: item.page, rawStatus: 'RAW_ONLY', followers: null, reviews: null, result1A: ''}));
  const candidateScope = observations;
  const active = candidateScope.filter(item => !historyIds.has(item.appId));
  return {observations, candidateScope, active, snapshot: observations.slice()};
}

function fakeSheet(rows) {
  return {
    rows,
    getRowIdentity: function (rowNumber) { return [this.rows[rowNumber - 1].runId, this.rows[rowNumber - 1].appId]; },
    update: function (rowNumber, value) { this.rows[rowNumber - 1] = Object.assign({}, this.rows[rowNumber - 1], value); }
  };
}

function updateSameRunRows(sheet, records, runId, rowByAppId) {
  records.forEach(function (rec) {
    const rowNumber = rowByAppId[rec.appId];
    if (!rowNumber) return;
    const identity = sheet.getRowIdentity(rowNumber);
    if (identity[0] !== runId || identity[1] !== rec.appId) return;
    sheet.update(rowNumber, rec);
  });
}

const fixture = [
  {appId: 'A', name: 'Historical game', page: 1},
  {appId: 'B', name: 'Normal candidate', page: 1},
  {appId: 'C', name: '1A rejected game', page: 1},
  {appId: 'D', name: 'Deep raw only', page: 2}
];
const historyIds = new Set(['A']);
const first = simulateRun(fixture, historyIds);
assert.deepStrictEqual(first.snapshot.map(item => item.appId), ['A', 'B', 'C', 'D']);
assert.deepStrictEqual(first.active.map(item => item.appId), ['B', 'C', 'D']);
assert(!first.active.some(item => item.appId === 'A'), 'historical game stays out of candidate flow');
assert(first.active.some(item => item.appId === 'D'), 'deep raw observation enters candidate flow');

// A: deep item is retained once and remains RAW_ONLY until enrichment succeeds.
const sheetA = fakeSheet([{runId: 'run-1', appId: 'D', rawStatus: 'RAW_ONLY', followers: null, reviews: null}]);
updateSameRunRows(sheetA, first.observations.filter(item => item.appId === 'D'), 'run-1', {D: 1});
assert.strictEqual(sheetA.rows.length, 1, 'deep item has one snapshot row');
assert.strictEqual(sheetA.rows[0].rawStatus, 'RAW_ONLY', 'deep item remains RAW_ONLY');
assert.strictEqual(sheetA.rows[0].followers, null, 'failed enrichment remains absent');

// B: page-1 active item updates the existing row, preserving enriched fields.
const pageOne = first.active[0];
pageOne.rawStatus = 'ENRICHED';
pageOne.followers = 321;
pageOne.reviews = 45;
pageOne.result1A = '✅ 通过（主池）';
const sheetB = fakeSheet([{runId: 'run-1', appId: pageOne.appId, rawStatus: 'RAW_ONLY', followers: null, reviews: null}]);
updateSameRunRows(sheetB, [pageOne], 'run-1', {[pageOne.appId]: 1});
assert.strictEqual(sheetB.rows.length, 1, 'page-1 active item still has one snapshot row');
assert.strictEqual(sheetB.rows[0].rawStatus, 'ENRICHED', 'page-1 row is enriched');
assert.strictEqual(sheetB.rows[0].followers, 321, 'follower field preserved');
assert.strictEqual(sheetB.rows[0].reviews, 45, 'review field preserved');
assert.strictEqual(sheetB.rows[0].result1A, '✅ 通过（主池）', 'decision field preserved');

// C: a downstream failure after append leaves the raw row present.
const failedRows = [{runId: 'run-fail', appId: 'D', rawStatus: 'RAW_ONLY'}];
assert.strictEqual(failedRows.length, 1, 'raw row survives downstream failure');

// D: a later run has a separate row and cannot overwrite the earlier one.
const historyRows = [
  {runId: 'run-1', appId: 'B', followers: 100},
  {runId: 'run-2', appId: 'B', followers: 200}
];
const sheetD = fakeSheet(historyRows);
updateSameRunRows(sheetD, [{appId: 'B', followers: 999}], 'run-2', {B: 2});
assert.strictEqual(sheetD.rows.length, 2, 'separate runs retain two historical rows');
assert.strictEqual(sheetD.rows[0].followers, 100, 'prior run is not overwritten');
assert.strictEqual(sheetD.rows[1].followers, 999, 'later run updates only its own row');

// E: provider calls are source-bounded to cache misses from the full active collection.
assert(/fetchSteamReviewSummaryBatch_\(releasedForReviews, warnings\)/.test(source));

function partitionGp(active, cachedIds) {
  return {
    hits: active.filter(function (item) { return cachedIds.has(item.appId); }),
    misses: active.filter(function (item) { return !cachedIds.has(item.appId); })
  };
}

const gpPartition = partitionGp(first.active, new Set(['B']));
assert.deepStrictEqual(gpPartition.hits.map(item => item.appId), ['B'], 'cache hit is reused');
assert.deepStrictEqual(gpPartition.misses.map(item => item.appId), ['C', 'D'], 'only cache misses are fetched');
assert(gpPartition.misses.every(function (item) { return first.active.indexOf(item) >= 0; }), 'cache misses stay within all active candidates');

function paginate(pages, priorPage, failAt) {
  const out = [], seen = new Set(), start = priorPage || 1;
  let stopReason = 'source-exhausted', continuation = false, consecutiveNoNewPages = 0;
  for (let page = start; page <= pages.length; page += 1) {
    if (failAt === page) { stopReason = 'temporary-fetch-failure'; continuation = true; return {out, page, stopReason, continuation}; }
    const ids = pages[page - 1];
    if (!ids.length) { stopReason = 'empty-page'; break; }
    let fresh = 0;
    ids.forEach(id => { if (!seen.has(id)) { seen.add(id); fresh += 1; } out.push(id); });
    if (!fresh) {
      consecutiveNoNewPages += 1;
      if (consecutiveNoNewPages >= 2) { stopReason = 'no-new-appids-2-pages'; break; }
    } else {
      consecutiveNoNewPages = 0;
    }
  }
  return {out, stopReason, continuation};
}
const exhausted = paginate([['A', 'B'], ['C'], []]);
assert.strictEqual(exhausted.stopReason, 'empty-page', 'pagination terminates on source empty page');
const repeated = paginate([['A', 'B'], ['A', 'B'], ['A', 'B']]);
assert.strictEqual(repeated.stopReason, 'no-new-appids-2-pages', 'pagination requires two repeated pages');
const reset = paginate([['A'], ['A'], ['B'], ['B'], ['C']]);
assert.strictEqual(reset.stopReason, 'source-exhausted', 'a new App ID resets the no-new-page counter');
const partial = paginate([['A'], ['B'], ['C']], 1, 2);
assert.strictEqual(partial.continuation, true, 'temporary failure creates continuation');
assert.strictEqual(partial.page, 2, 'continuation points at failed page');

function cacheAfterRetrieval(existing, retrieval) {
  return retrieval.continuation ? existing : retrieval.items;
}
const lastKnownGood = [{appId: 'GOOD'}];
assert.deepStrictEqual(cacheAfterRetrieval(lastKnownGood, {items: [{appId: 'PARTIAL'}], continuation: true}), lastKnownGood, 'partial retrieval preserves last-known-good cache');
assert.deepStrictEqual(cacheAfterRetrieval(lastKnownGood, {items: [{appId: 'NEW'}], continuation: false}), [{appId: 'NEW'}], 'complete retrieval refreshes cache');

const successful = {rawStatus: 'RAW_ONLY', _gpEnrichmentFresh: true};
if (successful._gpEnrichmentFresh) successful.rawStatus = 'ENRICHED';
assert.strictEqual(successful.rawStatus, 'ENRICHED', 'complete enrichment is ENRICHED');
const failed = {rawStatus: 'RAW_ONLY', _gpEnrichmentFresh: false};
if (failed._gpEnrichmentFresh) failed.rawStatus = 'ENRICHED';
assert.strictEqual(failed.rawStatus, 'RAW_ONLY', 'failed enrichment remains RAW_ONLY');

const second = simulateRun(fixture, historyIds);
const appended = first.snapshot.concat(second.snapshot);
assert.deepStrictEqual(appended.map(item => item.appId), ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D']);
assert.deepStrictEqual(first.snapshot.map(item => item.appId), ['A', 'B', 'C', 'D']);

console.log('PASS snapshot observation ledger regression: discovered > history filter > snapshot');
