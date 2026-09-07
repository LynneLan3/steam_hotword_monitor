/** G010 enrichment throughput + checkpoint audit regressions. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function assert(value, label) { if (!value) throw new Error(label); }

assert(/const G010_ENRICHMENT_CHUNK_SIZE = 35/.test(source), 'enrichment chunk size increased');
assert(/const G010_EXECUTION_BUDGET_MS = 330000/.test(source), 'execution budget extended to 5.5 min');
assert(/function ensureSteamHotwordV2ForRun_/.test(source), 'minimal setup path exists');
assert(/ensureSteamHotwordV2ForRun_\(ss, \{fullSetup: false\}\)/.test(source), 'G010 uses minimal setup');
assert(!/setupSteamHotwordV2\(\);[\s\S]{0,120}g010UpsertAuditRow_/.test(source), 'full setup not called in G010 path');
assert(/function g010BuildRunContext_/.test(source), 'run context builder exists');
assert(/function g010FinalizeRun_/.test(source), 'single finalization helper exists');
assert(/g010WriteFinalCandidateSnapshotFromMaster_/.test(source), 'candidate snapshot deferred to finalize');
assert(!/writeDailyCandidateSnapshot_\(ss, records, runTime, runId\)/.test(
  source.slice(source.indexOf('function g010EnrichChunk_'), source.indexOf('function runSteamHotword01B'))
), 'chunk enrichment does not write daily candidate snapshot');
assert(/attemptBuffer/.test(source), 'GP attempts batched via buffer');
assert(/flushGamesPopularityAttempts_/.test(source), 'GP attempts flushed in batch');
assert(/skipIdentityCheck/.test(source), 'snapshot updates can skip per-row identity reads');
assert(/g010RearmContinuationForPhase_/.test(source), 'yield re-arms phase-aware continuation');
assert(/G010_ENRICHMENT_CONTINUATION_DELAY_MS = 45/.test(source), 'enrichment continuation delay is 45s');
assert(/rowValues\[5\] = m.enrichmentProcessed/.test(source), 'checkpoint writes enrichment processed count');
assert(/rowValues\[3\] = m.rawTotal/.test(source), 'checkpoint writes raw total');
assert(/g010FormatCheckpointDetail_/.test(source), 'checkpoint detail formatter exists');

var sandbox = {
  String: String, Number: Number, Math: Math, Date: Date, Set: Set, Map: Map,
  Array: Array, Object: Object, isFinite: isFinite,
  G010_ENRICHMENT_CONTINUATION_DELAY_MS: 45000,
  G010_403_CONTINUATION_DELAY_MS: 180000
};
vm.createContext(sandbox);
['g010ContinuationDelayMs_'].forEach(function (name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  vm.runInContext(match[0], sandbox);
});
assert(sandbox.g010ContinuationDelayMs_('ENRICHMENT') === 45000, 'enrichment delay helper');
assert(sandbox.g010ContinuationDelayMs_('DISCOVERY') === 180000, 'discovery delay helper');

console.log('PASS scripts/test-g010-enrichment-throughput.js');
