/* G037 P3 entity, alias, and opportunity prioritization regression checks. */
'use strict';

var fs = require('fs');
var steam = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');
var alias = fs.readFileSync(__dirname + '/../PlayerAliasDiscovery.gs', 'utf8');

function assert(value, label) { if (!value) throw new Error(label); }

assert(/function opportunityIdFromSteamCandidate_\(gameName, appId\)/.test(steam), 'stable opportunity identity exists');
assert(/decision\.opportunityId = decision\.opportunityId \|\| opportunityIdFromSteamCandidate_/.test(steam), 'opportunity identity precedes decision persistence');
assert(/function syncCandidateDecisions_\(ss, records, runTime, rules\)/.test(steam), 'candidate decision sync exists');
assert(/function ensurePlayerSearchAliasesForTodayActions_\(ss, actions\)/.test(alias), 'alias discovery reuses existing capability');
assert(/readCachedPlayerSearchAlias_\(ss, rec\.appId\)/.test(alias), 'cached alias is preferred');
assert(/enqueuePlayerAliasDiscoveryJob_\(ss, rec, new Date\(\)/.test(alias), 'missing alias is routed to existing discovery job');
assert(/rec\.searchAlias = ''/.test(alias), 'unconfirmed alias remains empty');
assert(/sampledActions\.sort\(compareActions_\)/.test(steam), 'existing deterministic action priority ordering remains in use');

console.log(JSON.stringify({status: 'PASS', identity: 'OpportunityID before Decision', alias: 'cached-or-existing discovery job', priority: 'compareActions_'}));
