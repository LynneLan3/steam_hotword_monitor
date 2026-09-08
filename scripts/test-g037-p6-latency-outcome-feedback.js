/* G037 P6 latency and outcome feedback regression checks. */
'use strict';

var fs = require('fs');
var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');

function assert(value, label) { if (!value) throw new Error(label); }

assert(/elapsedSec: Math\.max\(0, Math\.round\(\(Date\.now\(\) - runStart\) \/ 1000\)\)/.test(source), 'run latency is measured');
assert(/rowValues\[14\] = m\.elapsedSec/.test(source), 'latency is written to existing run audit');
assert(/g010FormatCheckpointDetail_/.test(source) && /wallSec=/.test(source), 'partial continuation exposes latency checkpoint');
assert(/function appendSteamCandidateDecisionHistoryFromDecision_/.test(source), 'candidate outcome history exists');
assert(/g022FinalizeHistoricalRun_\(ss, state, runContext, metrics, completion/.test(source), 'completed run feeds existing historical outcome ledger');
assert(/machine_recommendation|machineRecommendation/.test(source), 'machine recommendation feedback is retained');
assert(/final_status|finalStatus/.test(source), 'final outcome feedback is retained');

console.log(JSON.stringify({status: 'PASS', latency: 'run audit wallSec', outcome: 'existing decision and historical ledgers'}));
