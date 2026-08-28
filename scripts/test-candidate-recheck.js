/**
 * 候选人工复查 V1 纯函数测试。
 * 运行：node scripts/test-candidate-recheck.js
 */

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
  isFiniteNumber_: function (value) {
    return typeof value === 'number' && isFinite(value);
  },
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
  Number: Number
};
vm.runInNewContext(
  'var isFiniteNumber_ = this.isFiniteNumber_;\n' +
  'var normalizeDecisionStatus_ = this.normalizeDecisionStatus_;\n' +
  'var dateAtStart_ = this.dateAtStart_;\n' + helperSource + '\n' + match[0],
  context
);
var decideTodayAction_ = context.decideTodayAction_;
var rules = {RECHECK_GAIN_GROWTH_MIN: 0.30};
var today = new Date('2026-08-21T08:00:00+08:00');
var base = {continueNext: '是', gain7d: 1000};

function assert(value, label) {
  if (!value) throw new Error(label);
}
function assertType(rec, decision, expected, label) {
  var result = decideTodayAction_(rec, decision, today, rules);
  assert(result.include === (expected !== null), label + ' include');
  if (expected !== null) assert(result.type === expected, label + ' type=' + result.type);
}

assertType(base, null, 'NEW', 'NEW without manual record');
assertType(base, {status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-25'}, null, 'WATCH not due');
assertType(base, {status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-21'}, null, 'WATCH due without new signal');
assertType({continueNext: '是', gain7d: 1300}, {status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-25'}, 'GAIN_GROWTH', 'Gain growth at 30 percent');
assertType(base, {status: 'WATCH', nextRecheckDate: '2026-08-25', externalSignal: 'GOOGLE_TRENDS', trendLastChecked: '2026-08-21', lastCheckedDate: '2026-08-20'}, 'EXTERNAL_SIGNAL', 'new ExternalSignal');
assertType(base, {status: 'BUILD', lastGain: 1000}, null, 'BUILD suppressed');
assertType(base, {status: 'REJECT', lastGain: 1000}, null, 'REJECT suppressed');

[
  'decisionHeaders', 'RECHECK_GAIN_GROWTH_MIN', 'WATCH_RECHECK_DAYS_STRONG',
  'WATCH_RECHECK_DAYS_NORMAL', 'captureCandidateDecisionEdit_', '上次检查7d Gain',
  '上次人工检查日', '上次检查类型', '下次复查日'
].forEach(function (needle) {
  assert(src.indexOf(needle) >= 0, 'source missing ' + needle);
});

console.log('PASS scripts/test-candidate-recheck.js (NEW, WATCH未到期, WATCH到期, Gain增长>=30%, BUILD, REJECT)');
