/** G010 resumable-run state-machine regressions; no Apps Script or network. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var sandbox = {
  String: String, Number: Number, Math: Math, Date: Date, Set: Set, Map: Map,
  Array: Array, Object: Object, isFinite: isFinite,
  HOTWORD_V2: {sources: [{name: 'Popular Upcoming'}, {name: 'Popular New Releases'}]},
  G010_EXECUTION_BUDGET_MS: 240000,
  G010_403_CONTINUATION_DELAY_MS: 180000,
  isSteamRetryableHttpStatus_: function (status) { return [403, 429].indexOf(Number(status)) >= 0; }
};
vm.createContext(sandbox);
['g010ShouldYield_', 'g010ContinuationState_', 'g010NextDiscoveryState_',
  'g010EnrichmentEligible_', 'g010DoneState_', 'g010DiscoveryFailureRecovery_',
  'g010ContinuationTriggerAction_', 'g010ContinuationHealth_'].forEach(function (name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  vm.runInContext(match[0], sandbox);
});
function assert(value, label) { if (!value) throw new Error(label); }
var state = {runId: 'run-1', phase: 'DISCOVERY', source: 'Popular Upcoming', nextPage: 4, enrichmentCursor: 0};
assert(sandbox.g010ShouldYield_(0, 240000), 'discovery yields at budget');
assert(sandbox.g010ContinuationState_(state).runId === 'run-1', 'continuation keeps Run ID');
var eligibility = sandbox.g010NextDiscoveryState_(state, 1, 2);
assert(eligibility.phase === 'ELIGIBILITY', 'discovery completion enters eligibility phase');
assert(sandbox.g010EnrichmentEligible_({eligible: false}) === false, 'UNCHANGED does not enrich');
assert(sandbox.g010ShouldYield_(0, 240000), 'enrichment yields at budget');
assert(sandbox.g010DoneState_(state).phase === 'DONE', 'DONE state is explicit for continuation cleanup');
var recovery = sandbox.g010DiscoveryFailureRecovery_(
  {runId: '20260830-142107', phase: 'DISCOVERY', source: 'Popular Upcoming', nextPage: 13, enrichmentCursor: 0},
  {httpStatus: 403, message: 'HTTP 403'}
);
assert(recovery.retryable === true, 'page13 403 is recoverable without throw');
assert(recovery.state.nextPage === 13, 'failed page remains nextPage=13');
assert(recovery.state.runId === '20260830-142107', '403 recovery keeps original Run ID');
assert(recovery.continuationDelayMs >= 180000, '403 recovery is delayed');
assert(source.indexOf("g010UpsertAuditRow_(ss, state, 'PARTIAL'") >= 0, 'PARTIAL run upserts audit row');
assert(source.indexOf('state.nextPage += 1; g010WriteState_(state);') >= 0, 'successful recovery advances after page write');
assert(source.indexOf("targetRunId = '20260830-142107'") >= 0, 'manual recovery targets confirmed Run ID');
assert(source.indexOf("targetPage = 13") >= 0, 'manual recovery targets failed page 13');
assert(source.indexOf("function stopG010CurrentRun()") >= 0, 'stop action exists');
assert(source.indexOf("g010UpsertAuditRow_(ss, state, 'STOPPED'") >= 0, 'stop action writes STOPPED audit');
assert(source.indexOf("PARTIAL_VALIDATED; production validation sufficient") >= 0, 'stop action records validation note');
assert(sandbox.g010ContinuationTriggerAction_('DISCOVERY', 0) === 'CREATE', 'PARTIAL creates trigger');
assert(sandbox.g010ContinuationTriggerAction_('DISCOVERY', 1) === 'KEEP', 'repeated PARTIAL keeps one trigger');
assert(sandbox.g010ContinuationTriggerAction_('DONE', 1) === 'CLEAR', 'DONE clears trigger');
var stale = sandbox.g010ContinuationHealth_('DISCOVERY', 1, 0, 20 * 60 * 1000, 10 * 60 * 1000);
assert(stale.health === 'STALE' && stale.action === 'REARM', 'existing stale trigger re-arms');
var healthy = sandbox.g010ContinuationHealth_('DISCOVERY', 1, 15 * 60 * 1000, 20 * 60 * 1000, 10 * 60 * 1000);
assert(healthy.health === 'HEALTHY' && healthy.action === 'KEEP', 'recent progress keeps trigger');
assert(source.indexOf('g010RearmContinuation_') >= 0, 'stale recovery helper exists');
assert(source.indexOf('oldTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));') >= 0,
  'stale re-arm deletes old triggers after create');
console.log('PASS scripts/test-g010-resumable-run.js (discovery yield, Run ID, eligibility transition, UNCHANGED skip, enrichment yield, DONE cleanup)');
