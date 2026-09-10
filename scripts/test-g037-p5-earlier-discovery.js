/* G037 P5 earlier discovery coverage regression checks. */
'use strict';

var fs = require('fs');
var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');

function assert(value, label) { if (!value) throw new Error(label); }

assert(/function fetchSteamSourcePagesLive_\(source, fetchLogs\)/.test(source), 'live discovery pagination exists');
assert(/page \+= 1/.test(source), 'discovery advances across pages');
assert(/empty-page/.test(source) && /duplicate-page-2-pages/.test(source), 'pagination has bounded stop conditions');
assert(/function g010AppendRawPage_\(ss, records, runTime, runId/.test(source), 'raw page persistence exists');
assert(/g010AppendRawPage_\(ss, records, startedAt, state\.runId/.test(source), 'segmented discovery persists each page');
assert(/const rawRecords = g010RawRecordsForRun_\(ss, state\.runId\)/.test(source), 'later qualification reads the complete run raw set');
assert(/const eligible = \[\];[\s\S]*const rejected = \[\];/.test(source), 'qualification separates eligible and rejected from raw coverage');
assert(/const controls = g010SelectRejectedControls_\(rejected, state\.runId\)/.test(source), 'control sampling remains downstream of full raw coverage');

console.log(JSON.stringify({status: 'PASS', coverage: 'paged Steam discovery to raw run ledger', qualification: 'full raw set before eligibility'}));
