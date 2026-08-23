/** M7C Steam Candidate Research callback receiver tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var token = 'test-token-never-written-to-sheet';
var writes = 0;
var properties = {};
var spreadsheet;

var sandbox = {
  console: console,
  SpreadsheetApp: { getActiveSpreadsheet: function () { return spreadsheet; } },
  Utilities: {
    getUuid: function () { return 'generated-token'; },
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
  PropertiesService: {
    getScriptProperties: function () {
      return {
        getProperty: function (key) { return properties[key] || ''; },
        setProperty: function (key, value) { properties[key] = String(value); }
      };
    }
  }
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
        setValues: function (values) {
          writes += 1;
          values.forEach(function (valueRow, rowIndex) {
            rows[rowNumber - 2 + rowIndex] = valueRow.slice();
          });
        }
      };
    }
  };
}

var decision = row(decisionHeaders.length);
decision[index(decisionHeaders, 'Steam App ID')] = '4026250';
decision[index(decisionHeaders, '游戏名称')] = 'Example Game';
decision[index(decisionHeaders, 'Google Trends结果')] = '强';
decision[index(decisionHeaders, 'Social结果')] = '人工Social';
decision[index(decisionHeaders, 'SERP竞争')] = '低';
decision[index(decisionHeaders, '关键词机会')] = '有';
decision[index(decisionHeaders, '人工备注')] = '人工备注';
decision[index(decisionHeaders, 'Decision')] = 'WATCH';
decision[index(decisionHeaders, 'ResearchJobID')] = 'steam-research-4026250-20260823';
decision[index(decisionHeaders, '自动研究状态')] = 'PENDING';

var master = row(masterHeaders.length);
master[index(masterHeaders, 'Steam App ID')] = '4026250';
master[index(masterHeaders, '游戏名称')] = 'Example Game';
master[index(masterHeaders, 'Steam URL')] = 'https://store.steampowered.com/app/4026250/';
master[index(masterHeaders, '第一轮类型')] = '🔥 趋势候选';
master[index(masterHeaders, '第一轮优先级')] = 'P1 高';
master[index(masterHeaders, '进入下一步')] = '是';

var decisionRows = [decision];
var masterRows = [master];
spreadsheet = {
  getSheetByName: function (name) {
    if (name === '候选决策') return makeSheet(decisionRows, decisionHeaders);
    if (name === '候选主表') return makeSheet(masterRows, masterHeaders);
    return null;
  },
  getSpreadsheetTimeZone: function () { return 'UTC'; }
};
properties.STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN = token;

function completedPayload() {
  return {
    token: token,
    job_id: 'steam-research-4026250-20260823',
    job_type: 'STEAM_CANDIDATE_RESEARCH',
    steam_app_id: '4026250',
    game_name: 'Example Game',
    research_cycle_date: '2026-08-23',
    execution_status: 'COMPLETED',
    recommendation: 'RECOMMEND_BUILD',
    confidence: 'HIGH',
    reasons: ['STEAM_STRONG_EARLY_SIGNAL', 'LOW_GUIDE_DENSITY'],
    blocking_reasons: [],
    missing_evidence: [],
    social_summary: {
      status: 'AVAILABLE', evidence_count: 10, cluster_count: 4,
      actionable_cluster_count: 2, watch_cluster_count: 1, top_topics: ['automation', 'upgrades']
    },
    serp_summary: {
      status: 'AVAILABLE', query: 'Example Game', organic_count: 10,
      guide_density: 'LOW', high_video_ugc: true, contamination: true
    },
    research_result_path: 'jobs/steam-research-4026250-20260823/steam_candidate_research_result.json',
    recommendation_result_path: 'jobs/steam-research-4026250-20260823/steam_candidate_recommendation.json',
    completed_at: '2026-08-23T02:00:00Z'
  };
}

function post(body) {
  return JSON.parse(sandbox.doPost({postData: {contents: JSON.stringify(body)}}).text);
}

var first = post(completedPayload());
assert(first.ok === true, 'authorized completed callback accepted');
assert(decision[index(decisionHeaders, '自动研究状态')] === 'COMPLETED', 'automatic status written');
assert(decision[index(decisionHeaders, '自动Recommendation')] === 'RECOMMEND_BUILD', 'recommendation written');
assert(decision[index(decisionHeaders, '自动Recommendation置信度')] === 'HIGH', 'confidence written');
assert(decision[index(decisionHeaders, '自动Social摘要')].indexOf('AVAILABLE | evidence=10 | clusters=4 | actionable=2 | automation / upgrades') === 0, 'social summary written');
assert(decision[index(decisionHeaders, '自动SERP摘要')] === 'AVAILABLE | organic=10 | guide=LOW | video_ugc=yes | contamination=yes', 'SERP summary written');
assert(decision[index(decisionHeaders, 'Google Trends结果')] === '强' && decision[index(decisionHeaders, 'Social结果')] === '人工Social' && decision[index(decisionHeaders, 'SERP竞争')] === '低' && decision[index(decisionHeaders, '关键词机会')] === '有' && decision[index(decisionHeaders, 'Decision')] === 'WATCH' && decision[index(decisionHeaders, '人工备注')] === '人工备注', 'manual fields preserved');

var beforeRepeat = JSON.stringify(decision);
var repeat = post(completedPayload());
assert(repeat.ok === true && JSON.stringify(decision) === beforeRepeat, 'repeated completed callback is idempotent');
assert(decisionRows.length === 1, 'callback never creates a row');

var wrongJob = completedPayload();
wrongJob.job_id = 'other-job';
assert(post(wrongJob).ok === false, 'wrong job id rejected');
var wrongApp = completedPayload();
wrongApp.steam_app_id = '9999999';
assert(post(wrongApp).ok === false, 'wrong app id rejected');
var invalidRecommendation = completedPayload();
invalidRecommendation.recommendation = 'BUILD';
assert(post(invalidRecommendation).ok === false, 'invalid recommendation rejected');
var unauthorized = completedPayload();
unauthorized.token = 'wrong-token';
assert(post(unauthorized).ok === false, 'unauthorized callback rejected');
var otherType = completedPayload();
otherType.job_type = 'SEARCH_DEMAND';
assert(post(otherType).ok === false, 'other callback type rejected');

var failed = {
  token: token, job_id: 'steam-research-4026250-20260823', job_type: 'STEAM_CANDIDATE_RESEARCH',
  steam_app_id: '4026250', game_name: 'Example Game', research_cycle_date: '2026-08-23',
  execution_status: 'FAILED', error: 'provider unavailable'
};
assert(post(failed).ok === true, 'failed callback accepted');
assert(decision[index(decisionHeaders, '自动研究状态')] === 'FAILED', 'failed status written');
assert(decision[index(decisionHeaders, '自动研究错误')] === 'provider unavailable', 'failed error written');
assert(decision[index(decisionHeaders, 'Decision')] === 'WATCH', 'failed callback does not modify Decision');
assert(JSON.stringify(decisionRows).indexOf(token) < 0, 'token never written to Sheet');

var beforeGetWrites = writes;
var getResponse = sandbox.doGet({parameter: {action: 'pendingSteamCandidateResearchJobs'}});
assert(JSON.parse(getResponse.text).jobs.length === 0, 'GET does not return failed callback as pending');
assert(writes === beforeGetWrites, 'GET remains read-only');

console.log('PASS scripts/test-candidate-research-callback-m7c.js');
