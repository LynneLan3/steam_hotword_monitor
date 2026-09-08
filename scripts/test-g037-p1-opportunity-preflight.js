/* G037 P1 first-seen opportunity preflight regression tests. */
'use strict';

var fs = require('fs');
var vm = require('vm');
var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');

function extract(name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  return match[0];
}

var helperSource = [
  'isFiniteNumber_', 'qualificationInScopeWindow_', 'qualificationScopeStatus_',
  'firstSeenOpportunityPreflight_'
].map(extract).join('\n');
var context = {Number: Number, String: String, isFinite: isFinite};
vm.createContext(context);
vm.runInContext(helperSource, context);

function assert(value, label) { if (!value) throw new Error(label); }
function rec(days, stage) { return {daysToRelease: days, releaseStage: stage}; }

var firstOutside = context.firstSeenOpportunityPreflight_(rec(45, '即将发售'), null);
assert(firstOutside.status === 'FIRST_SEEN_OUT_OF_SCOPE', 'first-seen out-of-window status');
assert(firstOutside.reason.indexOf('outside') >= 0, 'first-seen out-of-window reason');

var firstInside = context.firstSeenOpportunityPreflight_(rec(5, '即将发售'), null);
assert(firstInside.status === 'FIRST_SEEN_IN_SCOPE', 'first-seen in-window status');

var entered = context.firstSeenOpportunityPreflight_(rec(20, '即将发售'), rec(45, '即将发售'));
assert(entered.status === 'ENTERED_SCOPE', 'later window entry status');

var unknown = context.firstSeenOpportunityPreflight_(rec(null, ''), null);
assert(unknown.status === 'SCOPE_UNKNOWN', 'missing release data status');

var previousPosition = source.indexOf('const previousRaw = readLatestRawObservationIndex_(ss);');
var preflightPosition = source.indexOf('firstSeenOpportunityPreflight_(rec, previousRaw.get(String(rec.appId)))', previousPosition);
var appendPosition = source.indexOf('const rawPersistence = appendSnapshots_(ss, observations, startedAt, runId);');
assert(previousPosition >= 0 && previousPosition < preflightPosition, 'preflight reads prior raw index');
assert(preflightPosition < appendPosition, 'preflight runs before raw append');
var g010AppendPosition = source.indexOf('function g010AppendRawPage_');
var g010PreflightPosition = source.indexOf('firstSeenOpportunityPreflight_(rec, previousRaw.get(String(rec.appId)))', g010AppendPosition);
var g010WritePosition = source.indexOf('setValues(unique.map(rec => snapshotRow_(rec, runTime, runId)))', g010AppendPosition);
assert(g010AppendPosition >= 0 && g010AppendPosition < g010PreflightPosition, 'segmented discovery runs preflight');
assert(g010PreflightPosition < g010WritePosition, 'segmented discovery persists preflight before raw write');
assert(/'机会预检状态', '机会预检原因'/.test(source), 'preflight fields are append-only snapshot columns');
assert(/rec\.opportunityPreflightStatus \|\| ''/.test(source), 'snapshot row persists preflight status');

console.log(JSON.stringify({
  status: 'PASS',
  first_seen_out_of_window: firstOutside.status,
  first_seen_in_window: firstInside.status,
  later_window_entry: entered.status,
  unknown: unknown.status,
  persistence: 'Steam_每日快照 append-only columns'
}));
