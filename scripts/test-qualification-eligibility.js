/** Raw Observation -> Qualification Eligibility V1 pure-function regressions. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function extract(name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  return match[0];
}

var helperSource = [
  'isFiniteNumber_', 'dateAtStart_', 'qualificationRankValue_',
  'qualificationRankBucket_', 'qualificationInScopeWindow_', 'qualificationScopeStatus_',
  'qualificationRecheckDue_', 'evaluateQualificationEligibility_'
].map(extract).join('\n');
var context = {Number: Number, String: String, Date: Date, isFinite: isFinite, Math: Math};
vm.createContext(context);
vm.runInContext(helperSource, context);

function assert(value, label) { if (!value) throw new Error(label); }
function check(rec, ctx, expected, label) {
  var result = context.evaluateQualificationEligibility_(rec, ctx);
  var eligibleReasons = ['NEW_IN_SCOPE', 'ENTERED_SCOPE', 'STAGE_CHANGED', 'RANK_RISING', 'RECHECK'];
  assert(result.eligible === eligibleReasons.indexOf(expected) >= 0, label + ' eligible');
  assert(result.reason === expected, label + ' reason=' + result.reason);
}
function rec(days, stage, rank) {
  return {daysToRelease: days, releaseStage: stage, sourceRank: 'Popular Upcoming#' + rank};
}
var now = new Date('2026-08-30T08:00:00+08:00');

check(rec(5, '即将发售', 300), {now: now}, 'NEW_IN_SCOPE', 'first discovery in window');
check(rec(20, '即将发售', 300), {
  now: now,
  previousRaw: rec(45, '即将发售', 300),
  qualification: {lastRank: 300}
}, 'ENTERED_SCOPE', 'first entered 30-day window');
check(rec(20, '即将发售', 200), {
  now: now,
  previousRaw: rec(20, '即将发售', 300),
  qualification: {lastRank: 300}
}, 'RANK_RISING', 'rank 300 to 200');
check(rec(20, '即将发售', 280), {
  now: now,
  previousRaw: rec(20, '即将发售', 300),
  qualification: {lastRank: 300}
}, 'UNCHANGED_SKIP', 'rank 300 to 280');
check(rec(-1, '已发售', 300), {
  now: now,
  previousRaw: rec(1, '即将发售', 300),
  qualification: {lastRank: 300}
}, 'STAGE_CHANGED', 'upcoming to released');
check({sourceRank: 'Popular Upcoming#300', releaseStage: '', daysToRelease: null}, {
  now: now,
  qualification: {lastRank: 300}
}, 'SCOPE_UNKNOWN', 'missing release date');
check(rec(40, '即将发售', 300), {
  now: now,
  previousRaw: rec(40, '即将发售', 300),
  qualification: {lastRank: 300, lastStatus: 'INCOMPLETE'},
  decision: {status: 'WATCH', nextRecheckDate: '2026-08-30'}
}, 'RECHECK', 'incomplete and WATCH due');

console.log('PASS scripts/test-qualification-eligibility.js (NEW, ENTERED_SCOPE, RANK_RISING, unchanged rank, STAGE_CHANGED, RECHECK)');
