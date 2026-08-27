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
  /fetchGamesPopularityFollowersBatch_\(observations, gpKey, warnings\)/.test(source),
  'follower history is requested for all observations'
);
assert(
  /appendSnapshots_\(ss, observations, startedAt, runId\)/.test(source),
  'snapshots receive the full observation collection'
);

function simulateRun(discovered, historyIds) {
  const observations = discovered.map(item => ({appId: item.appId, name: item.name}));
  const active = observations.filter(item => !historyIds.has(item.appId));
  return {observations, active, snapshot: observations.slice()};
}

const fixture = [
  {appId: 'A', name: 'Historical game'},
  {appId: 'B', name: 'Normal candidate'},
  {appId: 'C', name: '1A rejected game'}
];
const historyIds = new Set(['A']);
const first = simulateRun(fixture, historyIds);
assert.deepStrictEqual(first.snapshot.map(item => item.appId), ['A', 'B', 'C']);
assert.deepStrictEqual(first.active.map(item => item.appId), ['B', 'C']);
assert(!first.active.some(item => item.appId === 'A'), 'historical game stays out of candidate flow');

const second = simulateRun(fixture, historyIds);
const appended = first.snapshot.concat(second.snapshot);
assert.deepStrictEqual(appended.map(item => item.appId), ['A', 'B', 'C', 'A', 'B', 'C']);
assert.deepStrictEqual(first.snapshot.map(item => item.appId), ['A', 'B', 'C']);

console.log('PASS snapshot observation ledger regression: discovered > history filter > snapshot');
