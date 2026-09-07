/** Automatic preflight gate tests for 今日行动 and persisted decisions. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var match = src.match(/function decideTodayAction_\([\s\S]*?\n\}/);
if (!match) throw new Error('decideTodayAction_ not found');
function extract(name) {
  var m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!m) throw new Error('missing ' + name);
  return m[0];
}
var helperSource = ['hasCompletedManualResearchValue_', 'candidateExternalSignalIsNew_',
  'candidateGainGrowthReached_', 'candidateWatchRecheckGate_',
  'candidateManualEvidenceNextAction_', 'candidateManualEvidenceNeedsNoProvider_',
  'isTodayActionP2Type_', 'hasNoManualResearchHistory_', 'isDirectP2TodayActionSample_']
  .map(extract).join('\n');

var context = {
  STEAM_PREFLIGHT_ENABLED: true,
  isFiniteNumber_: function (value) { return typeof value === 'number' && isFinite(value); },
  normalizeDecisionStatus_: function (value) {
    var status = String(value || '').trim().toUpperCase();
    return ['WATCH', 'BUILD', 'REJECT'].indexOf(status) >= 0 ? status : '';
  },
  dateAtStart_: function (value) {
    if (!value) return null;
    var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  },
  machineResearchPending_: function (decision) {
    return !!decision && (!decision.autoResearchStatus || decision.autoResearchStatus === 'PENDING' || decision.autoResearchStatus === 'RUNNING');
  },
  machineResearchFailed_: function (decision) { return !!decision && decision.autoResearchStatus === 'FAILED'; },
  machineResearchComplete_: function () { return false; },
  Number: Number
};
vm.runInNewContext(
  'var STEAM_PREFLIGHT_ENABLED = true;\n' +
  'var isFiniteNumber_ = this.isFiniteNumber_;\n' +
  'var normalizeDecisionStatus_ = this.normalizeDecisionStatus_;\n' +
  'var dateAtStart_ = this.dateAtStart_;\n' +
  'var machineResearchPending_ = this.machineResearchPending_;\n' +
  'var machineResearchFailed_ = this.machineResearchFailed_;\n' +
  'var machineResearchComplete_ = this.machineResearchComplete_;\n' + helperSource + '\n' + match[0],
  context
);
var decideTodayAction_ = context.decideTodayAction_;
var rules = {RECHECK_GAIN_GROWTH_MIN: 0.30};
var today = new Date('2026-08-25T08:00:00+08:00');
var base = {continueNext: '是', gain7d: 1000};

function assert(value, label) { if (!value) throw new Error(label); }
function check(decision, expected, label) {
  var result = decideTodayAction_(base, decision, today, rules);
  assert(result.include === expected, label + ' include');
  if (expected) assert(['检查 Google Trends', '重新验证趋势变化', '机器研究中'].indexOf(result.humanAction) >= 0, label + ' action');
}

check(null, false, 'missing preflight');
check({preflightVerdict: 'PENDING'}, false, 'pending preflight');
check({preflightVerdict: 'AUTO_REJECT'}, false, 'auto reject');
check({preflightVerdict: 'MANUAL_REVIEW', status: ''}, true, 'manual review');
check({preflightVerdict: 'MANUAL_REVIEW', status: '', trendsResult: '弱'}, true, 'automatic research completes remaining evidence');
check({preflightVerdict: 'WATCH', status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-24'}, false, 'due watch without new signal');
check({preflightVerdict: 'WATCH', status: 'WATCH', nextRecheckDate: '2026-08-30'}, false, 'future watch');
check({preflightVerdict: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-24'}, false, 'due automatic watch without new signal');
check({preflightVerdict: 'WATCH', nextRecheckDate: '2026-08-30'}, false, 'future automatic watch');
check({preflightVerdict: 'MANUAL_REVIEW', status: 'BUILD'}, false, 'persisted build');
check({preflightVerdict: 'MANUAL_REVIEW', status: 'REJECT'}, false, 'persisted reject');

['PreflightVerdict', 'PreflightCheckedAt', 'PreflightReason', 'PREFLIGHT_MAX_SERP_QUERIES_PER_CANDIDATE',
  "status === 'REJECT'", "status === 'BUILD'", "status === 'WATCH'"].forEach(function (needle) {
  assert(src.indexOf(needle) >= 0, 'source missing ' + needle);
});
console.log('PASS scripts/test-candidate-preflight-gate.js');
