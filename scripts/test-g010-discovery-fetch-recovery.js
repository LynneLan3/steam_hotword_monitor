/** G010 discovery page fetch recovery across continuations. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(/G010_PAGE_RECOVERY_MAX_ATTEMPTS = 3/.test(source), 'page recovery max attempts');
assert(/G010_PAGE_RECOVERY_WINDOW_MS = 30/.test(source), 'page recovery window');
assert(/function g010DiscoveryFetchRecovery_/.test(source), 'discovery fetch recovery helper');
assert(/fetch-failure-exhausted/.test(source), 'exhausted stop reason');
assert(/g010RearmContinuationForState_/.test(source), 'state-aware continuation delay');
assert(/idempotency: 'run'/.test(source), 'run-scoped candidate snapshot idempotency');
assert(!/discovery source skipped after fetch failure/.test(source), 'removed immediate skip on retryable failure');

const sandbox = {
  G010_DISCOVERY_MAX_PAGES: 5,
  G010_PAGE_RECOVERY_MAX_ATTEMPTS: 3,
  G010_PAGE_RECOVERY_WINDOW_MS: 30 * 60 * 1000,
  G010_403_CONTINUATION_DELAY_MS: 180000,
  isSteamRetryableHttpStatus_: function (s) {
    return [403, 429, 500, 0].indexOf(Number(s)) >= 0;
  }
};

vm.createContext(sandbox);
[
  'g010DiscoveryFetchErrorRetryable_', 'g010DiscoveryRetryDelayMs_',
  'g010DiscoveryFetchRecovery_', 'g010ClearPageRetryState_', 'g010BumpSegmentCount_'
].forEach(name => {
  const match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  vm.runInContext(match[0], sandbox);
});

assert(sandbox.g010DiscoveryFetchErrorRetryable_({httpStatus: 403}), '403 retryable');
assert(sandbox.g010DiscoveryFetchErrorRetryable_({httpStatus: 404}) === false, '404 not retryable');

const now = new Date('2026-09-01T12:00:00+08:00');
let state = {nextPage: 3, pageRetryCount: 0, pageRetryStartedAt: 0, source: 'Popular New Releases'};
let recovery = sandbox.g010DiscoveryFetchRecovery_(state, now, {httpStatus: 403});
assert(recovery.action === 'YIELD', 'first failure yields');
assert(recovery.state.pageRetryCount === 1, 'retry count increments');
assert(recovery.state.nextPage === 3, 'same page preserved');

state = recovery.state;
recovery = sandbox.g010DiscoveryFetchRecovery_(state, now, {httpStatus: 403});
recovery = sandbox.g010DiscoveryFetchRecovery_(recovery.state, now, {httpStatus: 403});
recovery = sandbox.g010DiscoveryFetchRecovery_(recovery.state, now, {httpStatus: 403});
assert(recovery.action === 'PARTIAL', 'fourth attempt exhausts recovery');

let seg = {segmentCount: 0};
seg = sandbox.g010BumpSegmentCount_(seg, {forceNewRun: true});
assert(seg.segmentCount === 1, 'new run segment starts at 1');
seg = sandbox.g010BumpSegmentCount_(seg, {fromContinuation: true});
assert(seg.segmentCount === 2, 'continuation increments segment');

console.log('PASS scripts/test-g010-discovery-fetch-recovery.js');
