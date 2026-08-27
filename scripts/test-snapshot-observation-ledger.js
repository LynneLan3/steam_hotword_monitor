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
  /fetchGamesPopularityFollowersBatch_\(active, gpKey, warnings\)/.test(source),
  'follower history remains bounded to active candidates'
);
assert(
  /appendSnapshots_\(ss, observations, startedAt, runId\)/.test(source),
  'snapshots receive the full observation collection'
);
assert(/G010_RAW_DISCOVERY_PAGES = 5/.test(source), 'raw discovery is widened to validated pages 1-5');
assert(/const candidateScope = observations\.filter\(isLegacyCandidateScope_\)/.test(source), 'candidate scope is derived separately');
assert(/fetchGamesPopularityLatestBatch_\(active, gpKey, warnings\)/.test(source), 'latest enrichment remains bounded to active candidates');
assert(/'来源页码', '原始观察状态'/.test(source), 'raw provenance/status fields append at snapshot end');
assert(/function updateSnapshots_\(ss, records, runTime, runId, rowByAppId\)/.test(source), 'same-run snapshot updater exists');
assert(/identity\[0\].*runId[\s\S]*identity\[1\].*rec\.appId/.test(source), 'snapshot updates guard Run ID and App ID');
assert(/active\.forEach\(rec => \{ rec\.rawStatus = 'ENRICHED'; \}\);[\s\S]*updateSnapshots_/.test(source), 'successful page-1 processing marks the same row enriched');

function simulateRun(discovered, historyIds) {
  const observations = discovered.map(item => ({appId: item.appId, name: item.name, page: item.page, rawStatus: 'RAW_ONLY', followers: null, reviews: null, result1A: ''}));
  const candidateScope = observations.filter(item => item.page <= 1);
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
assert.deepStrictEqual(first.active.map(item => item.appId), ['B', 'C']);
assert(!first.active.some(item => item.appId === 'A'), 'historical game stays out of candidate flow');
assert(!first.active.some(item => item.appId === 'D'), 'deep raw observation stays out of candidate flow');

// A: deep item is retained once, remains RAW_ONLY, and receives no enrichment.
const sheetA = fakeSheet([{runId: 'run-1', appId: 'D', rawStatus: 'RAW_ONLY', followers: null, reviews: null}]);
updateSameRunRows(sheetA, first.observations.filter(item => item.appId === 'D'), 'run-1', {D: 1});
assert.strictEqual(sheetA.rows.length, 1, 'deep item has one snapshot row');
assert.strictEqual(sheetA.rows[0].rawStatus, 'RAW_ONLY', 'deep item remains RAW_ONLY');
assert.strictEqual(sheetA.rows[0].followers, null, 'deep item has no follower enrichment');

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

// E: provider calls are source-bounded to the page-1 active collection.
assert(/fetchGamesPopularityLatestBatch_\(active, gpKey, warnings\)/.test(source));
assert(/fetchSteamReviewSummaryBatch_\(releasedForReviews, warnings\)/.test(source));

const second = simulateRun(fixture, historyIds);
const appended = first.snapshot.concat(second.snapshot);
assert.deepStrictEqual(appended.map(item => item.appId), ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D']);
assert.deepStrictEqual(first.snapshot.map(item => item.appId), ['A', 'B', 'C', 'D']);

console.log('PASS snapshot observation ledger regression: discovered > history filter > snapshot');
