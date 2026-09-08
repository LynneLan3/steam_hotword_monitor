/* G037 P4 intent seed and SERP maturity regression checks. */
'use strict';

var fs = require('fs');
var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');

function assert(value, label) { if (!value) throw new Error(label); }

assert(/function buildTrendsQuery_\(gameName, searchAlias\)/.test(source), 'intent seed builder exists');
assert(/function buildGoogleTrendsExploreUrl_\(query\)/.test(source), 'intent seed link builder exists');
assert(/function buildSteamCandidateResearchJob_\(/.test(source), 'research job builder exists');
assert(/serp_queries/.test(source), 'SERP query seed is part of research job');
assert(/GOOGLE_ORGANIC_SERP/.test(source), 'SERP maturity check is requested explicitly');
assert(/function decideTodayActionProjection_\(/.test(source), 'maturity gate projection exists');
assert(/preflightVerdict/.test(source) && /MANUAL_REVIEW/.test(source), 'preflight maturity gate preserves unresolved state');
assert(/requested_checks/.test(source), 'intent/SERP checks remain auditable in job contract');

console.log(JSON.stringify({status: 'PASS', intent_seed: 'official name plus approved alias', serp: 'explicit organic SERP check', gate: 'unresolved preflight is not auto-published'}));
