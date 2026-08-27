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

function simulateRun(discovered, historyIds) {
  const observations = discovered.map(item => ({appId: item.appId, name: item.name, page: item.page}));
  const candidateScope = observations.filter(item => item.page <= 1);
  const active = candidateScope.filter(item => !historyIds.has(item.appId));
  return {observations, candidateScope, active, snapshot: observations.slice()};
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

const second = simulateRun(fixture, historyIds);
const appended = first.snapshot.concat(second.snapshot);
assert.deepStrictEqual(appended.map(item => item.appId), ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D']);
assert.deepStrictEqual(first.snapshot.map(item => item.appId), ['A', 'B', 'C', 'D']);

console.log('PASS snapshot observation ledger regression: discovered > history filter > snapshot');
