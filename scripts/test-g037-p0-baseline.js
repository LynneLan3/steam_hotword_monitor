/** G037 P0: current funnel baseline and first-seen failure reproduction. */
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

function assert(value, label) {
  if (!value) throw new Error(label);
}

function rec(days, stage, rank) {
  return {daysToRelease: days, releaseStage: stage, sourceRank: 'Popular Upcoming#' + rank};
}

var now = new Date('2026-09-08T08:00:00+08:00');
var firstSeenOutsideWindow = context.evaluateQualificationEligibility_(
  rec(45, '即将发售', 300), {now: now}
);
assert(firstSeenOutsideWindow.eligible === false, 'out-of-window first sight is not active');
assert(firstSeenOutsideWindow.reason === 'UNCHANGED_SKIP', 'out-of-window first sight is skipped');

var enteredWindow = context.evaluateQualificationEligibility_(
  rec(20, '即将发售', 300), {
    now: now,
    previousRaw: rec(45, '即将发售', 300),
    qualification: {lastRank: 300}
  }
);
assert(enteredWindow.eligible === true, 'later window entry becomes active');
assert(enteredWindow.reason === 'ENTERED_SCOPE', 'later window entry has explicit reason');

var firstSeenInWindow = context.evaluateQualificationEligibility_(
  rec(20, '即将发售', 300), {now: now}
);
assert(firstSeenInWindow.eligible === true, 'in-window first sight is active');
assert(firstSeenInWindow.reason === 'NEW_IN_SCOPE', 'in-window first sight has explicit reason');

var runStart = source.indexOf('function runSteamHotword01B(');
assert(runStart >= 0, 'main funnel entrypoint exists');
function sourcePosition(needle) {
  var position = source.indexOf(needle, runStart);
  assert(position >= 0, 'missing funnel operation: ' + needle);
  return position;
}
var rawPosition = sourcePosition('appendSnapshots_(ss, observations, startedAt, runId)');
var qualificationPosition = sourcePosition('evaluateQualificationEligibility_');
var decisionPosition = sourcePosition('syncCandidateDecisions_(ss, active, startedAt, rules)');
var enqueuePosition = sourcePosition('enqueueSteamCandidateResearchJobs_(ss, startedAt)');
assert(rawPosition < qualificationPosition, 'raw observation is persisted before qualification');
assert(qualificationPosition < decisionPosition, 'qualification precedes decision sync');
assert(decisionPosition < enqueuePosition, 'research enqueue follows active-candidate funnel');

console.log(JSON.stringify({
  status: 'PASS',
  baseline: {
    first_seen_outside_window: firstSeenOutsideWindow.reason,
    first_seen_in_window: firstSeenInWindow.reason,
    later_window_entry: enteredWindow.reason,
    current_boundary: 'first-seen out-of-window candidates do not create an independent screening event before Steam qualification'
  },
  evidence: [
    'raw observation precedes qualification',
    'active candidates feed decision sync',
    'research enqueue follows active candidates'
  ]
}));
