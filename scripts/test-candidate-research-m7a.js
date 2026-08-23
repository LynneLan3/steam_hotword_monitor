/** M7A Steam Candidate Research queue tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var writes = 0;
var spreadsheet;

var sandbox = {
  console: console,
  SpreadsheetApp: { getActiveSpreadsheet: function () { return spreadsheet; } },
  Utilities: {
    formatDate: function (date) {
      var d = new Date(date);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (text) {
      return { text: text, setMimeType: function () { return this; } };
    }
  },
  LockService: { getScriptLock: function () { return { tryLock: function () { return false; }, releaseLock: function () {} }; } },
  Session: { getScriptTimeZone: function () { return 'UTC'; } },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return ''; } }; } }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

var decisionHeaders = [
  'Steam App ID', '游戏名称', '决策状态', '上次人工检查日', '上次检查7d Gain',
  '上次检查类型', '下次复查日', '决策备注', '上次检查时决策状态', '首次发现日期', '首次来源',
  '第一轮类型', '当前Steam阶段', '研究状态', 'Google Trends结果', 'Social结果', 'SERP竞争',
  '关键词机会', '人工备注', 'Decision', 'Decision日期', 'Next Action', 'OpportunityID',
  'ResearchJobID', '自动研究状态', '自动研究时间', '自动Social摘要', '自动SERP摘要', '自动研究结果路径',
  '自动Recommendation', '自动Recommendation置信度', '自动Recommendation理由', '自动缺失证据',
  '自动Recommendation结果路径', '自动研究错误'
];
var masterHeaders = [
  '最后扫描时间', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名',
  'Steam 发布日期', '发布日原文', '发布阶段', '距发售天数', 'Steam Followers', '7d基准Followers',
  'Steam 7d Gain', '近似增长率', '增速覆盖天数', '评论数', '好评数', 'Steam评分', '1A结果',
  '1A排除原因', '第一轮类型', '第一轮优先级', '进入下一步', '下一步动作', '第一轮判定依据',
  '当前筛选阶段', '数据状态', '数据备注', '首次发现日期', '最后发现日期', '最近Run ID', '人工备注'
];

function row(length) { return new Array(length).fill(''); }
function index(headers, name) { return headers.indexOf(name); }

var master = row(masterHeaders.length);
master[index(masterHeaders, 'Steam App ID')] = '4026250';
master[index(masterHeaders, '游戏名称')] = 'Project P.I.T.T.';
master[index(masterHeaders, 'Steam URL')] = 'https://store.steampowered.com/app/4026250/';
master[index(masterHeaders, 'Steam 发布日期')] = '2026-09-01';
master[index(masterHeaders, '发布阶段')] = '即将发售';
master[index(masterHeaders, '距发售天数')] = 9;
master[index(masterHeaders, 'Steam Followers')] = 4200;
master[index(masterHeaders, 'Steam 7d Gain')] = 1100;
master[index(masterHeaders, '近似增长率')] = 0.35;
master[index(masterHeaders, '评论数')] = 0;
master[index(masterHeaders, 'Steam评分')] = '';
master[index(masterHeaders, '第一轮类型')] = '🔥 趋势候选';
master[index(masterHeaders, '第一轮优先级')] = 'P1 高';
master[index(masterHeaders, '进入下一步')] = '是';

var decision = row(decisionHeaders.length);
decision[0] = '4026250';
decision[1] = 'Project P.I.T.T.';
decision[14] = '未检查';
decision[15] = '人工Social';
decision[16] = '未检查';
decision[17] = '人工关键词';
decision[18] = '人工备注';

function candidateMaster(appId, name, continueNext) {
  var candidate = row(masterHeaders.length);
  candidate[index(masterHeaders, 'Steam App ID')] = appId;
  candidate[index(masterHeaders, '游戏名称')] = name;
  candidate[index(masterHeaders, 'Steam URL')] = 'https://store.steampowered.com/app/' + appId + '/';
  candidate[index(masterHeaders, 'Steam 发布日期')] = '2026-09-01';
  candidate[index(masterHeaders, '发布阶段')] = '即将发售';
  candidate[index(masterHeaders, '距发售天数')] = 9;
  candidate[index(masterHeaders, 'Steam Followers')] = 4200;
  candidate[index(masterHeaders, 'Steam 7d Gain')] = 1100;
  candidate[index(masterHeaders, '近似增长率')] = 0.35;
  candidate[index(masterHeaders, '第一轮类型')] = '🔥 趋势候选';
  candidate[index(masterHeaders, '第一轮优先级')] = 'P1 高';
  candidate[index(masterHeaders, '进入下一步')] = continueNext;
  return candidate;
}

function candidateDecision(appId, name, options) {
  var candidate = row(decisionHeaders.length);
  candidate[index(decisionHeaders, 'Steam App ID')] = appId;
  candidate[index(decisionHeaders, '游戏名称')] = name;
  Object.keys(options || {}).forEach(function (key) {
    candidate[index(decisionHeaders, key)] = options[key];
  });
  return candidate;
}

var excluded = candidateMaster('4026251', 'Excluded Game', '否');
var completedDecision = candidateDecision('4026252', 'Completed Game', {
  ResearchJobID: 'steam-research-4026252-20260823', '自动研究状态': 'COMPLETED'
});
var failedDecision = candidateDecision('4026253', 'Failed Game', {
  ResearchJobID: 'steam-research-4026253-20260823', '自动研究状态': 'FAILED'
});
var buildDecision = candidateDecision('4026254', 'Manual Build Game', {Decision: 'BUILD'});
var watchDecision = candidateDecision('4026255', 'Manual Watch Game', {Decision: 'WATCH'});
var rejectDecision = candidateDecision('4026256', 'Manual Reject Game', {Decision: 'REJECT'});
var pendingManualDecision = candidateDecision('4026257', 'Pending Manual Game', {
  ResearchJobID: 'steam-research-4026257-20260823', '自动研究状态': 'PENDING', Decision: 'WATCH'
});
var pendingNotNextDecision = candidateDecision('4026258', 'No Longer Eligible Game', {
  ResearchJobID: 'steam-research-4026258-20260823', '自动研究状态': 'PENDING'
});

function makeSheet(rows, headers) {
  return {
    getLastRow: function () { return rows.length + 1; },
    getLastColumn: function () { return headers.length; },
    getRange: function (rowNumber, columnNumber, rowCount, columnCount) {
      return {
        getValues: function () {
          if (rowNumber === 1) return [headers];
          return rows.slice(rowNumber - 2, rowNumber - 2 + rowCount);
        },
        getDisplayValues: function () {
          if (rowNumber === 1) return [headers];
          return rows.slice(rowNumber - 2, rowNumber - 2 + rowCount);
        },
        setValue: function (value) {
          writes += 1;
          rows[rowNumber - 2][columnNumber - 1] = value;
        },
        setValues: function () { writes += 1; throw new Error('unexpected bulk write'); }
      };
    }
  };
}

var decisionRows = [decision, completedDecision, failedDecision, buildDecision, watchDecision, rejectDecision, pendingManualDecision, pendingNotNextDecision];
var masterRows = [
  master,
  excluded,
  candidateMaster('4026252', 'Completed Game', '是'),
  candidateMaster('4026253', 'Failed Game', '是'),
  candidateMaster('4026254', 'Manual Build Game', '是'),
  candidateMaster('4026255', 'Manual Watch Game', '是'),
  candidateMaster('4026256', 'Manual Reject Game', '是'),
  candidateMaster('4026257', 'Pending Manual Game', '是'),
  candidateMaster('4026258', 'No Longer Eligible Game', '否')
];
spreadsheet = {
  getSheetByName: function (name) {
    if (name === '候选决策') return makeSheet(decisionRows, decisionHeaders);
    if (name === '候选主表') return makeSheet(masterRows, masterHeaders);
    return null;
  },
  getSpreadsheetTimeZone: function () { return 'UTC'; }
};

var first = sandbox.enqueueSteamCandidateResearchJobs_(spreadsheet, new Date('2026-08-23T01:00:00Z'));
assert(first.created === 1, 'eligible candidate creates one job');
assert(first.jobs[0].job_id === 'steam-research-4026250-20260823', 'deterministic job id');
assert(first.jobs[0].job_type === 'STEAM_CANDIDATE_RESEARCH', 'independent job type');
assert(first.jobs[0].steam_signals.followers_gain_7d === 1100, 'steam signals retained');
assert(first.jobs[0].manual_signals.trends_result === '未检查', 'manual trends copied as input only');
assert(first.jobs[0].serp_queries.join('|') === 'Project P.I.T.T.', 'brand query only');
assert(first.jobs[0].requested_checks.join('|') === 'GAME_WIDE_SOCIAL|GOOGLE_ORGANIC_SERP', 'checks');
assert(decision[14] === '未检查' && decision[15] === '人工Social' && decision[16] === '未检查' && decision[17] === '人工关键词' && decision[19] === '', 'manual fields untouched');
assert(decision[23] === 'steam-research-4026250-20260823', 'ResearchJobID stored');
assert(decision[24] === 'PENDING', 'automatic status stored');

decision[26] = 'existing social summary';
decision[27] = 'existing serp summary';
decision[28] = 'existing research path';
decision[29] = 'RECOMMEND_WATCH';
decision[30] = 'HIGH';
decision[31] = 'existing reasons';
decision[32] = 'existing missing evidence';
decision[33] = 'existing recommendation path';
decision[34] = '';

var second = sandbox.enqueueSteamCandidateResearchJobs_(spreadsheet, new Date('2026-08-23T02:00:00Z'));
assert(second.created === 0, 'same AppID does not create a second job');

var next = sandbox.enqueueSteamCandidateResearchJobs_(spreadsheet, new Date('2026-08-24T01:00:00Z'));
assert(next.created === 0, 'cross-day scan does not create a new one-shot job');
assert(decision[23] === 'steam-research-4026250-20260823', 'original job id remains across days');
assert(decision[15] === '人工Social' && decision[19] === '', 'manual fields remain unchanged');
assert(decision[26] === 'existing social summary', 'automatic Social field is preserved');
assert(decision[27] === 'existing serp summary', 'automatic SERP field is preserved');
assert(decision[29] === 'RECOMMEND_WATCH' && decision[33] === 'existing recommendation path', 'automatic recommendation fields are preserved');
assert(completedDecision[index(decisionHeaders, 'ResearchJobID')] !== '', 'completed job has ResearchJobID');
assert(failedDecision[index(decisionHeaders, 'ResearchJobID')] !== '', 'failed job has ResearchJobID');
assert(next.created === 0, 'PENDING/COMPLETED/FAILED jobs are never auto-retried');
assert(buildDecision[index(decisionHeaders, 'ResearchJobID')] === '', 'manual BUILD is not enqueued');
assert(watchDecision[index(decisionHeaders, 'ResearchJobID')] === '', 'manual WATCH is not enqueued');
assert(rejectDecision[index(decisionHeaders, 'ResearchJobID')] === '', 'manual REJECT is not enqueued');

var beforeGetWrites = writes;
var pending = sandbox.loadPendingSteamCandidateResearchJobs_();
assert(pending.length === 1, 'GET loader returns pending candidate only');
assert(pending[0].steam_app_id === '4026250', 'GET contract AppID');
assert(pending[0].steam_url.indexOf('/4026250/') >= 0, 'GET contract Steam URL');
assert(pending[0].steam_signals.steam_score === null, 'missing facts remain null');
assert(pending[0].manual_signals.keyword_opportunity === '人工关键词', 'GET preserves manual input');
var getResponse = sandbox.doGet({parameter: {action: 'pendingSteamCandidateResearchJobs'}});
assert(JSON.parse(getResponse.text).jobs.length === 1, 'GET endpoint returns the pending contract');
assert(JSON.parse(getResponse.text).jobs[0].steam_app_id === '4026250', 'GET excludes manually decided and no-longer-eligible jobs');
assert(writes === beforeGetWrites, 'GET loader is read-only');

assert(/function enqueueSteamCandidateResearchJobs_/.test(source), 'enqueue helper exists');
assert(!/RESEARCH_RECOMMENDATION/.test(source), 'does not reuse GSC recommendation enum');
console.log('PASS scripts/test-candidate-research-m7a.js');
