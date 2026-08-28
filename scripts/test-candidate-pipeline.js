/** Steam Candidate Pipeline V2 本地纯函数测试。 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function extract(name) {
  var m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!m) throw new Error('missing ' + name);
  return m[0];
}
var context = {
  isFiniteNumber_: function (v) { return typeof v === 'number' && isFinite(v); },
  normalizeDecisionStatus_: function (v) { var s = String(v || '').trim().toUpperCase(); return ['WATCH', 'BUILD', 'REJECT'].indexOf(s) >= 0 ? s : ''; },
  dateAtStart_: function (v) { var d = new Date(v); if (isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d; },
  deriveHumanAction_: function () { return '继续验证'; },
  Number: Number, String: String, Date: Date, Math: Math
};
vm.createContext(context);
['hasCompletedManualResearchValue_', 'candidateExternalSignalIsNew_',
  'candidateGainGrowthReached_', 'candidateWatchRecheckGate_',
  'candidateManualEvidenceNextAction_', 'candidateManualEvidenceNeedsNoProvider_',
  'isTodayActionP2Type_', 'hasNoManualResearchHistory_', 'isDirectP2TodayActionSample_']
  .forEach(function (name) { vm.runInContext(extract(name), context); });
vm.runInContext(extract('decideTodayAction_'), context);
vm.runInContext(extract('siteIdFromGameName_'), context);
var decide = context.decideTodayAction_;
var siteId = context.siteIdFromGameName_;
var rules = { RECHECK_GAIN_GROWTH_MIN: 0.30 };
var today = new Date('2026-08-21T08:00:00+08:00');
function assert(v, msg) { if (!v) throw new Error(msg); }
function action(rec, decision) { return decide(rec, decision, today, rules); }
var base = { continueNext: '是', gain7d: 1000 };

assert(action(base, null).type === 'NEW', 'NEW enters action');
assert(!action(base, { status: 'BUILD' }).include, 'BUILD suppressed');
assert(!action(base, { status: 'REJECT' }).include, 'REJECT suppressed');
assert(!action(base, { status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-25' }).include, 'WATCH not due');
assert(!action(base, { status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-21' }).include, 'WATCH due without trigger remains hidden');
assert(action(base, { status: '', researchStatus: '已完成' }).type === 'RESEARCHING', 'researching enters');
assert(siteId('Twisted Tower™') === 'twisted-tower', 'stable Site ID');
assert(siteId('Mortal Shell II') === 'mortal-shell-ii', 'stable Site ID 2');

['首次发现日期', '首次来源', '第一轮类型', '当前Steam阶段', '研究状态', 'Google Trends结果', 'Social结果', 'SERP竞争', '关键词机会', '人工备注', 'Decision', 'Decision日期', 'Next Action', '站点项目池', 'BUILD_PENDING'].forEach(function (needle) {
  assert(src.indexOf(needle) >= 0, 'source missing ' + needle);
});
console.log('PASS scripts/test-candidate-pipeline.js (NEW, BUILD, REJECT, WATCH due, researching, Site ID)');
