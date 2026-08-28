/** Candidate Pipeline V3 UI contracts: 本地静态/纯函数测试，不访问 Google Sheets。 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
function assert(value, label) { if (!value) throw new Error(label); }
function extract(name) {
  var m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!m) throw new Error('missing ' + name);
  return m[0];
}
var context = {
  isFiniteNumber_: function (v) { return typeof v === 'number' && isFinite(v); },
  normalizeDecisionStatus_: function (v) { var s = String(v || '').trim().toUpperCase(); return ['WATCH', 'BUILD', 'REJECT'].indexOf(s) >= 0 ? s : ''; },
  dateAtStart_: function (v) { var d = new Date(v); if (isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d; },
  Number: Number, String: String, Date: Date, Math: Math
};
vm.createContext(context);
['hasCompletedManualResearchValue_', 'candidateExternalSignalIsNew_',
  'candidateGainGrowthReached_', 'candidateWatchRecheckGate_',
  'candidateManualEvidenceNextAction_', 'candidateManualEvidenceNeedsNoProvider_',
  'isTodayActionP2Type_', 'hasNoManualResearchHistory_', 'isDirectP2TodayActionSample_']
  .forEach(function (name) { vm.runInContext(extract(name), context); });
vm.runInContext(extract('decideTodayAction_'), context);
vm.runInContext(extract('isUnfinishedResearchValue_'), context);
vm.runInContext(extract('deriveResearchStatus_'), context);
var decide = context.decideTodayAction_;
var deriveResearchStatus = context.deriveResearchStatus_;
var today = new Date('2026-08-21T08:00:00+08:00');
var rules = { RECHECK_GAIN_GROWTH_MIN: 0.30 };
function action(rec, decision) { return decide(rec, decision, today, rules); }
var base = { continueNext: '是', gain7d: 1000 };
assert(action(base, null).humanAction === '检查 Google Trends', 'NEW action');
assert(action(base, { status: 'BUILD' }).include === false, 'BUILD hidden');
assert(action(base, { status: 'REJECT' }).include === false, 'REJECT hidden');
assert(action(base, { status: 'WATCH', lastGain: 1000, nextRecheckDate: '2026-08-21' }).include === false, 'WATCH without new signal hidden');
assert(deriveResearchStatus({status: '', trendsResult: '', socialResult: '未检查', serpCompetition: '', keywordOpportunity: '未检查'}) === '待研究', 'all empty research status');
assert(deriveResearchStatus({status: '', trendsResult: '强', socialResult: '未检查', serpCompetition: '', keywordOpportunity: '未检查'}) === '研究中', 'partial research status');
assert(deriveResearchStatus({status: 'BUILD'}) === '已完成', 'decision research status');
[
  'setupCandidateDecisionUi_', 'setupTodayActionUi_', 'syncCandidateDecisionFromActionEdit_', 'clearDataValidations', 'setDataValidation', 'requireValueInList',
  'Google Trends结果', 'Social结果', 'SERP竞争', '关键词机会', 'Decision', 'Next Action',
  '研究完成度', '人工动作', 'Trends结果', 'Social结果', 'SERP竞争', '关键词机会', '人工备注', 'whenTextEqualTo', 'BUILD_PENDING', 'Steam 7d Gain', "setFormat('Steam 7d Gain', '0')",
  "setFormat('距发售天数', '0')", "setFormat('近似增长率', '0.0%')"
].forEach(function (needle) { assert(src.indexOf(needle) >= 0, 'missing UI contract: ' + needle); });
assert(src.indexOf("['待研究', '研究中', '已完成']") >= 0, 'research validation options');
assert(src.indexOf("['BUILD', 'WATCH', 'REJECT']") >= 0, 'decision validation options');
assert(src.indexOf("decision.researchStatus = isHumanStage ? deriveResearchStatus_(decision) : ''") >= 0, 'excluded candidates not marked待研究');
assert(src.indexOf("decision.nextAction = 'None'") >= 0, 'excluded candidates next action None');
assert(src.indexOf("candidateManualEvidenceNextAction_") >= 0, 'manual evidence determines next action');
assert(src.indexOf("decision.nextAction = 'Recheck'") >= 0, 'WATCH next action Recheck');
assert(src.indexOf("decision.nextAction = 'Site Build'") >= 0, 'BUILD next action Site Build');
assert(src.indexOf("decision.nextAction = 'None'") >= 0, 'REJECT next action None');
assert(src.indexOf('function deriveResearchStatus_') >= 0, 'automatic research status');
assert(src.indexOf('function deriveResearchCompletion_') >= 0, 'automatic research completion');
assert(src.indexOf('candidateDecisionRow_(decision, decisionColumnMap') >= 0, 'action edit upsert uses header map');
assert(src.indexOf('sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), sheet.getMaxColumns()).clearDataValidations()') >= 0, 'candidate decision validations cleared');
var actionBlock = src.match(/actionHeaders:\s*\[([\s\S]*?)\],\n\n\s*decisionHeaders/)[1];
assert((actionBlock.match(/'触发原因'/g) || []).length === 1, 'one trigger reason');
assert(actionBlock.indexOf("'今日动作'") < 0, 'no duplicate 今日动作');
assert(actionBlock.indexOf("'Decision状态'") < 0, 'no duplicate Decision状态');
assert(src.indexOf("row[0] || '').trim() === siteId") >= 0, 'Site ID dedupe');
assert(src.indexOf("row[2] || '').trim() === normalizedAppId") >= 0, 'App ID dedupe');
assert(src.indexOf('sheet.getRange(4, 1, Math.max(sheet.getMaxRows() - 3, 1), sheet.getMaxColumns()).clearDataValidations()') >= 0, 'old action validations cleared');
assert(src.indexOf("const decisionCol = col('Decision')") >= 0, 'Decision validation follows header');
// Simulate the reported V3.3 migration: a stale W4 rule is cleared before the current Decision rule is applied.
var actionHeaders = ['行动类型', '优先级', '游戏名称', 'Steam App ID', '第一轮类型', 'Steam Followers', 'Steam 7d Gain', '近似增长率', '发布阶段', 'Steam发布日期', '距发售天数', '评论数', 'Steam评分', 'Google Trends链接', 'Trends结果', 'Social结果', 'SERP竞争', '关键词机会', 'Decision', '人工备注'];
var validations = {23: ['BUILD', 'WATCH', 'REJECT']};
function migrateValidations(headers, old) {
  var next = {};
  Object.keys(old).forEach(function (k) { next[k] = null; });
  var c = headers.indexOf('Decision') + 1;
  next[c] = ['BUILD', 'WATCH', 'REJECT'];
  return next;
}
var migrated = migrateValidations(actionHeaders, validations);
assert(migrated[23] === null, 'stale W4 validation removed');
assert(migrated[19].join('|') === 'BUILD|WATCH|REJECT', 'Decision validation moved to current column');
assert(src.indexOf('ensureSitePoolSchema_') >= 0, 'site pool schema migration');
assert(src.indexOf("['Site ID', '游戏名称', 'Steam App ID', '当前状态', 'BUILD日期', 'Build状态', 'Repo URL', 'Vercel URL', '上线日期', '模板版本', 'GSC状态', 'GSC Site', 'GSC URL Prefix', 'GSC Last Sync', 'SEO阶段', 'Index状态', '首次曝光日期', 'Clicks', 'Impressions', 'CTR', 'Average Position', 'OpportunityID', 'ExperimentType', 'ActualLiveAt', 'LaunchPageCount']") >= 0, 'site pool final fields');
var orderBlock = src.match(/sheetUiOrder:\s*\[([\s\S]*?)\]/)[1];
['今日行动', '站点项目池', '项目GSC关联', '候选决策', '候选主表', 'Steam_每日快照', '历史游戏库', '使用说明'].forEach(function (name) {
  assert(orderBlock.indexOf("'" + name + "'") >= 0, 'sheet order missing ' + name);
});
assert(orderBlock.indexOf("'今日行动'") < orderBlock.indexOf("'站点项目池'") && orderBlock.indexOf("'站点项目池'") < orderBlock.indexOf("'候选决策'"), 'primary sheet order');
console.log('PASS scripts/test-candidate-pipeline-ui.js (sheet setup, dropdowns, colors, actions, dedupe)');
