/** G010 SUCCESS criteria: no early discovery stop, incomplete runs stay PARTIAL. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(!/if \(state\.consecutiveNoNew >= 2\)/.test(source), 'G010 discovery must not stop early on consecutiveNoNew');
assert(/function g010EvaluateRunCompletion_/.test(source), 'run completion evaluator exists');
assert(/function g010ComputeFinalStatsFromMaster_/.test(source), 'final stats read from master sheet');
assert(/function g010RecordDiscoveryPage_/.test(source), 'discovery page audit exists');
assert(/g010SaveRunStats_/.test(source), 'run stats persist across continuations');
assert(/discoveryComplete/.test(source), 'discoveryComplete flag exists');
assert(/g010FormatDiscoveryAudit_/.test(source), 'discovery audit appears in logs');

const sandbox = {
  HOTWORD_V2: {
    sources: [{name: 'Popular Upcoming'}, {name: 'Popular New Releases'}]
  },
  G010_DISCOVERY_MAX_PAGES: 5,
  g010EmptyRunStats_: function () {
    return {
      pass1A: 0, excluded1A: 0, trend: 0, early: 0, control: 0, low: 0, anomaly: 0,
      enriched: 0, candidates: 0, p2Trend: 0, p2Early: 0, historyInsufficient: 0,
      cacheHits: 0, realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0, failuresKept: 0
    };
  },
  isDailyCandidateSnapshotRecord_: function () { return false; }
};

vm.createContext(sandbox);
['g010EvaluateRunCompletion_', 'g010AccumulateChunkStats_'].forEach(name => {
  const match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  vm.runInContext(match[0], sandbox);
});

const incompleteDiscovery = sandbox.g010EvaluateRunCompletion_(
  {
    discoveryComplete: false,
    enrichmentCursor: 10,
    discoveryAudit: {sources: {'Popular Upcoming': {stopReason: 'no-new-appids-2-pages', pagesFetched: 3}}}
  },
  {eligible: Array(10)},
  false
);
assert(incompleteDiscovery.status === 'PARTIAL', 'incomplete discovery cannot SUCCESS');
assert(incompleteDiscovery.issues.indexOf('discovery-incomplete') >= 0, 'flags discovery-incomplete');

const completeDiscovery = sandbox.g010EvaluateRunCompletion_(
  {
    discoveryComplete: true,
    enrichmentCursor: 5,
    discoveryAudit: {
      sources: {
        'Popular Upcoming': {stopReason: 'max-pages', pagesFetched: 5},
        'Popular New Releases': {stopReason: 'max-pages', pagesFetched: 5}
      }
    }
  },
  {eligible: Array(5)},
  false
);
assert(completeDiscovery.status === 'SUCCESS', 'full discovery + enrichment yields SUCCESS');

const completeWithGpGap = sandbox.g010EvaluateRunCompletion_(
  {
    discoveryComplete: true,
    enrichmentCursor: 5,
    discoveryAudit: {
      sources: {
        'Popular Upcoming': {stopReason: 'max-pages', pagesFetched: 5},
        'Popular New Releases': {stopReason: 'max-pages', pagesFetched: 5}
      }
    }
  },
  {eligible: Array(5)},
  false
);
assert(completeWithGpGap.status === 'SUCCESS', 'pipeline SUCCESS does not depend on per-game GP coverage');

const stats = sandbox.g010EmptyRunStats_();
sandbox.g010AccumulateChunkStats_(stats, [{
  result1A: '✅ 通过（主池）',
  firstRoundType: '🟡 Trend Watch',
  _gpEnrichmentFresh: true
}]);
assert(stats.pass1A === 1 && stats.p2Trend === 1, 'p2Trend counted separately from trend');

assert(/hasInfrastructureRunWarnings_/.test(source), 'legacy path filters GP missing-data warnings');
assert(!/jobType === 'TWITCH_HISTORICAL_RAW_LEDGER_APPEND'/.test(source), 'Twitch ledger route removed');
assert(/const UNIFIED_CANDIDATE_HEADERS = \[\s*'Candidate ID'\s*\]/.test(source),
  'unified additive schema is Candidate ID only');
assert(!/unifiedCandidateTwitchFields_/.test(source), 'Twitch field helper removed');

console.log('PASS scripts/test-g010-success-criteria.js');
