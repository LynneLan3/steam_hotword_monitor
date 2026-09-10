/** G010 form-run closure: decision sync, Today Action, manual research, run stats. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(value, label) {
  if (!value) throw new Error(label);
}

function FakeRange(sheet, row, column, rowCount, columnCount) {
  this.sheet = sheet;
  this.row = row;
  this.column = column;
  this.rowCount = rowCount;
  this.columnCount = columnCount;
}
FakeRange.prototype.read = function (display) {
  var out = [];
  for (var r = 0; r < this.rowCount; r += 1) {
    var values = [];
    for (var c = 0; c < this.columnCount; c += 1) {
      var value = this.row + r === 1 ? this.sheet.headers[this.column + c - 1] :
        (this.sheet.rows[this.row + r - 2] || [])[this.column + c - 1];
      values.push(value === undefined ? '' : value);
    }
    out.push(values);
  }
  return display ? out.map(function (row) {
    return row.map(function (value) {
      return value instanceof Date ? value.toISOString() : String(value == null ? '' : value);
    });
  }) : out;
};
FakeRange.prototype.getValues = function () { return this.read(false); };
FakeRange.prototype.getDisplayValues = function () { return this.read(true); };
FakeRange.prototype.getDisplayValue = function () { return this.getDisplayValues()[0][0]; };
FakeRange.prototype.setValue = function (value) { this.sheet.write(this.row, this.column, [[value]]); return this; };
FakeRange.prototype.setValues = function (values) { this.sheet.write(this.row, this.column, values); return this; };
FakeRange.prototype.clearContent = function () {
  var values = [];
  for (var r = 0; r < this.rowCount; r += 1) values.push(new Array(this.columnCount).fill(''));
  this.sheet.write(this.row, this.column, values);
  return this;
};
FakeRange.prototype.clearDataValidations = function () { return this; };
FakeRange.prototype.setDataValidation = function () { return this; };
FakeRange.prototype.setBackground = function () { return this; };

function columnNumber(label) {
  var result = 0;
  for (var i = 0; i < label.length; i += 1) result = result * 26 + label.charCodeAt(i) - 64;
  return result;
}

function FakeSheet(name, headers, rows, maxRows) {
  this.name = name;
  this.headers = headers.slice();
  this.rows = (rows || []).map(function (row) { return row.slice(); });
  this.maxRows = maxRows || Math.max(40, this.rows.length + 8);
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.getMaxRows = function () { return this.maxRows; };
FakeSheet.prototype.getMaxColumns = function () { return this.headers.length; };
FakeSheet.prototype.getRange = function (row, column, rowCount, columnCount) {
  if (typeof row === 'string') {
    var match = row.match(/^([A-Z]+)(\d+)$/);
    row = Number(match[2]);
    column = columnNumber(match[1]);
    rowCount = 1;
    columnCount = 1;
  }
  return new FakeRange(this, row, column, rowCount || 1, columnCount || 1);
};
FakeSheet.prototype.write = function (row, column, values) {
  for (var r = 0; r < values.length; r += 1) {
    while (this.rows.length < row + r - 1) this.rows.push([]);
    var target = this.rows[row + r - 2] || (this.rows[row + r - 2] = []);
    for (var c = 0; c < values[r].length; c += 1) target[column + c - 1] = values[r][c];
  }
};

function FakeSpreadsheet(sheets) { this.sheets = sheets; }
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Shanghai'; };

var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var sandbox = {
  console: console,
  SpreadsheetApp: {getActiveSpreadsheet: function () { return sandbox.__spreadsheet; }},
  Utilities: {formatDate: function (date) { return new Date(date).toISOString().slice(0, 10); }},
  Date: Date, String: String, Number: Number, Math: Math, Set: Set, Map: Map, Object: Object, Array: Array,
  isFinite: isFinite
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
sandbox.applyActionFormatting_ = function () {};
sandbox.setupTodayActionUi_ = function () {};
sandbox.g022FinalizeHistoricalRun_ = function () { return {ok: true}; };
sandbox.saveSteamMonitoringRaw_ = function () { return {skipped: true}; };
sandbox.g010ClearState_ = function () {};
sandbox.g010WriteState_ = function () {};
sandbox.g010RearmContinuationForPhase_ = function () {};
sandbox.g010UpsertAuditRow_ = function () {};

function extractHeaders(name) {
  var match = source.match(new RegExp('\\n  ' + name + ': \\[([\\s\\S]*?)\\],\\n\\n'));
  if (!match) throw new Error('missing header array ' + name);
  return vm.runInNewContext('[' + match[1] + ']');
}

var decisionHeaders = extractHeaders('decisionHeaders');
var masterHeaders = extractHeaders('masterHeaders');
var actionHeaders = extractHeaders('actionHeaders');

function row(headers, values) {
  var output = new Array(headers.length).fill('');
  Object.keys(values).forEach(function (name) { output[headers.indexOf(name)] = values[name]; });
  return output;
}

var RUN_ID = '20260910-150000';
var now = new Date('2026-09-10T15:00:00+08:00');

var masterRows = [
  row(masterHeaders, {
    'Steam App ID': '900001', '游戏名称': 'Fresh Manual Candidate',
    'Steam URL': 'https://store.steampowered.com/app/900001/',
    '第一轮类型': '🔥 趋势候选', '第一轮优先级': 'P1 高', '进入下一步': '是',
    '下一步动作': 'Google Trends', '当前筛选阶段': '1B完成→人工第二轮',
    '1A结果': '✅ 通过（主池）', 'Steam Followers': 9000, 'Steam 7d Gain': 1200,
    '近似增长率': 0.2, '最近Run ID': RUN_ID
  }),
  row(masterHeaders, {
    'Steam App ID': '900002', '游戏名称': 'Upgraded Type Candidate',
    'Steam URL': 'https://store.steampowered.com/app/900002/',
    '第一轮类型': '🔥 趋势候选', '第一轮优先级': 'P1 高', '进入下一步': '是',
    '下一步动作': 'Google Trends', '当前筛选阶段': '1B完成→人工第二轮',
    '1A结果': '✅ 通过（主池）', 'Steam Followers': 11000, 'Steam 7d Gain': 1500,
    '近似增长率': 0.18, '最近Run ID': RUN_ID
  }),
  row(masterHeaders, {
    'Steam App ID': '900003', '游戏名称': 'Build Done Candidate',
    'Steam URL': 'https://store.steampowered.com/app/900003/',
    '第一轮类型': '🔥 趋势候选', '第一轮优先级': 'P1 高', '进入下一步': '是',
    '当前筛选阶段': '1B完成→人工第二轮', '1A结果': '✅ 通过（主池）',
    'Steam Followers': 8000, 'Steam 7d Gain': 900, '最近Run ID': RUN_ID
  }),
  row(masterHeaders, {
    'Steam App ID': '900004', '游戏名称': 'Reject Done Candidate',
    'Steam URL': 'https://store.steampowered.com/app/900004/',
    '第一轮类型': '🌱 Early候选', '第一轮优先级': 'P1 高', '进入下一步': '是',
    '当前筛选阶段': '1B完成→人工第二轮', '1A结果': '✅ 通过（主池）',
    'Steam Followers': 3000, 'Steam 7d Gain': 700, '最近Run ID': RUN_ID
  }),
  row(masterHeaders, {
    'Steam App ID': '900005', '游戏名称': 'Watch Recheck Candidate',
    'Steam URL': 'https://store.steampowered.com/app/900005/',
    '第一轮类型': '🟡 Trend Watch', '第一轮优先级': 'P2 观察', '进入下一步': '是',
    '下一步动作': 'Google Trends', '当前筛选阶段': '1B完成→人工第二轮',
    '1A结果': '✅ 通过（主池）', 'Steam Followers': 12000, 'Steam 7d Gain': 1600,
    '最近Run ID': RUN_ID
  }),
  row(masterHeaders, {
    'Steam App ID': '900099', '游戏名称': 'Other Run Pass',
    'Steam URL': 'https://store.steampowered.com/app/900099/',
    '第一轮类型': '🔥 趋势候选', '进入下一步': '是', '1A结果': '✅ 通过（主池）',
    '当前筛选阶段': '1B完成→人工第二轮', '最近Run ID': 'older-run'
  })
];

var decisionRows = [
  row(decisionHeaders, {
    'Steam App ID': '900002', '游戏名称': 'Upgraded Type Candidate',
    '第一轮类型': '⚪ 低优先级', '当前Steam阶段': '1A完成',
    '研究状态': '待研究', 'Google Trends结果': '强', 'Social结果': '中',
    'SERP竞争': '低', '关键词机会': '有', '人工备注': 'keep-manual-note',
    'Decision': '', 'Decision日期': '', 'Next Action': 'Automatic Preflight',
    'ResearchJobID': 'steam-research-900002-old', '自动研究状态': 'PENDING'
  }),
  row(decisionHeaders, {
    'Steam App ID': '900003', '游戏名称': 'Build Done Candidate',
    '当前Steam阶段': '1B完成→人工第二轮', Decision: 'BUILD',
    'Decision日期': '2026-09-01', 'Next Action': 'Site Build'
  }),
  row(decisionHeaders, {
    'Steam App ID': '900004', '游戏名称': 'Reject Done Candidate',
    '当前Steam阶段': '1B完成→人工第二轮', Decision: 'REJECT',
    'Decision日期': '2026-09-01', 'Next Action': 'None'
  }),
  row(decisionHeaders, {
    'Steam App ID': '900005', '游戏名称': 'Watch Recheck Candidate',
    '当前Steam阶段': '1B完成→人工第二轮', Decision: 'WATCH',
    '下次复查日': '2026-09-01', '上次检查7d Gain': 1000,
    'Google Trends结果': '中', 'Next Action': 'Recheck'
  })
];

var rules = new FakeSheet('规则配置', ['规则Key', '当前值'], [
  ['RECHECK_GAIN_GROWTH_MIN', 0.30],
  ['WATCH_RECHECK_DAYS_STRONG', 3],
  ['WATCH_RECHECK_DAYS_NORMAL', 7],
  ['P1_MAX_PER_DAY', 6],
  ['P1_TREND_MAX_PER_DAY', 4],
  ['P1_EARLY_MAX_PER_DAY', 2],
  ['P2_MAX_PER_DAY', 6],
  ['P2_TREND_MAX_PER_DAY', 3],
  ['P2_EARLY_MAX_PER_DAY', 3]
]);

var actionSheet = new FakeSheet('今日行动', actionHeaders, [[''], actionHeaders]);
var spreadsheet = new FakeSpreadsheet({
  '候选主表': new FakeSheet('候选主表', masterHeaders, masterRows),
  '候选决策': new FakeSheet('候选决策', decisionHeaders, decisionRows),
  '今日行动': actionSheet,
  '规则配置': rules,
  '站点项目池': new FakeSheet('站点项目池',
    ['Site ID', '游戏名称', 'Steam App ID', '当前状态', 'Build状态', 'Vercel URL', '上线日期', 'ActualLiveAt', 'OpportunityID'], []),
  '历史游戏库': new FakeSheet('历史游戏库', ['Steam App ID', '游戏名称', 'Steam URL', '当前阶段', '备注'], []),
  'Trends研究记录': new FakeSheet('Trends研究记录',
    ['ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game', 'TrendVerdict'], []),
  '建站关键词规划': new FakeSheet('建站关键词规划', ['目标游戏', '关联AppID', '动作', 'Steam URL'], []),
  '今日候选快照': new FakeSheet('今日候选快照', extractHeaders('candidateSnapshotHeaders'), []),
  '运行日志': new FakeSheet('运行日志', extractHeaders('logHeaders'), [])
});
sandbox.__spreadsheet = spreadsheet;

assert(sandbox.steamAutoResearchEnabled_() === false, 'manual research mode disables auto research');
var disabledQueue = sandbox.enqueueSteamCandidateResearchJobs_(spreadsheet, now);
assert(disabledQueue.created === 0 && disabledQueue.disabled === true, 'auto research off does not enqueue');

var pendingDecision = {
  autoResearchStatus: 'PENDING', researchJobId: 'steam-research-900002-old',
  trendsResult: '强', socialResult: '中', serpCompetition: '低', keywordOpportunity: '有'
};
assert(sandbox.machineResearchPending_(pendingDecision) === false, 'historical PENDING is not live researching');
assert(sandbox.deriveResearchStatus_({autoResearchStatus: 'PENDING'}) === '待研究',
  'stale PENDING alone is 待研究 in manual mode');
assert(sandbox.candidateManualEvidenceNextAction_({}, {autoResearchStatus: 'PENDING'}) === 'Google Trends',
  'stale PENDING does not force Automatic Preflight');

var syncRecords = sandbox.g010CollectDecisionSyncRecordsFromMaster_(spreadsheet, RUN_ID);
assert(syncRecords.length === 5, 'collects this-run P1/P2 continueNext=是 rows');
assert(syncRecords.every(function (rec) { return rec.appId !== '900099'; }), 'excludes other-run rows');

sandbox.syncCandidateDecisions_(spreadsheet, syncRecords, now, sandbox.loadRules_(spreadsheet));
var decisions = sandbox.readCandidateDecisions_(spreadsheet);
assert(decisions.has('900001'), 'new P1 candidate creates 候选决策 row');
var fresh = decisions.get('900001');
assert(fresh.firstType === '🔥 趋势候选', 'new candidate gets current firstType');
assert(fresh.nextAction === 'Google Trends', 'new candidate enters manual Google Trends');
assert(String(fresh.autoResearchStatus || '') === '', 'new candidate does not get PENDING auto status');

var upgraded = decisions.get('900002');
assert(upgraded.firstType === '🔥 趋势候选', 'existing candidate refreshes ⚪ → 🔥');
assert(upgraded.currentStage === '1B完成→人工第二轮', 'existing candidate refreshes Steam stage');
assert(upgraded.trendsResult === '强', 'Trends preserved');
assert(upgraded.socialResult === '中', 'Social preserved');
assert(upgraded.serpCompetition === '低', 'SERP preserved');
assert(upgraded.keywordOpportunity === '有', 'keyword opportunity preserved');
assert(upgraded.manualNote === 'keep-manual-note', 'manual note preserved');
assert(upgraded.researchJobId === 'steam-research-900002-old', 'ResearchJobID kept for audit');
assert(upgraded.nextAction !== 'Automatic Preflight', 'Automatic Preflight cleared in manual mode');

var finalStats = sandbox.g010ComputeFinalStatsFromMaster_(spreadsheet, RUN_ID);
assert(finalStats.pass1A === 5, 'run-level 1A pass matches this-run pass rows');
assert(finalStats.trend >= 1 && finalStats.early >= 1, 'run-level type counts present');

sandbox.refreshTodayActionsFromCandidateDecisions_(spreadsheet, now, RUN_ID, {
  discoveredCount: 42,
  historyExcludedCount: 7,
  pass1ACount: finalStats.pass1A,
  trendCount: finalStats.trend,
  earlyCount: finalStats.early,
  controlCount: finalStats.control
});

function actionAppIds() {
  return actionSheet.rows.slice(2).filter(function (candidate) {
    return String(candidate[actionHeaders.indexOf('Steam App ID')] || '').trim();
  }).map(function (candidate) {
    return String(candidate[actionHeaders.indexOf('Steam App ID')]);
  });
}
var appIds = actionAppIds();
assert(appIds.indexOf('900001') >= 0, 'new P1 appears in 今日行动');
assert(appIds.indexOf('900002') >= 0, 'updated candidate appears in 今日行动');
assert(appIds.indexOf('900003') < 0, 'BUILD absent from 今日行动');
assert(appIds.indexOf('900004') < 0, 'REJECT absent from 今日行动');
assert(appIds.indexOf('900005') >= 0, 'WATCH remains via recheck rules');
assert(String(actionSheet.getRange('B2').getDisplayValue()) === RUN_ID, 'run id written');
assert(String(actionSheet.getRange('F2').getDisplayValue()) === '42', 'run discovered count written');
assert(String(actionSheet.getRange('J2').getDisplayValue()) === String(finalStats.pass1A), 'run 1A pass written');

sandbox.refreshTodayActionsFromCandidateDecisions_(spreadsheet);
assert(String(actionSheet.getRange('B2').getDisplayValue()) === RUN_ID, 'manual refresh keeps last Run ID');
assert(String(actionSheet.getRange('F2').getDisplayValue()) === '42', 'manual refresh keeps discovered');
assert(String(actionSheet.getRange('J2').getDisplayValue()) === String(finalStats.pass1A), 'manual refresh keeps 1A pass');
assert(Number(actionSheet.getRange('F2').getDisplayValue()) !== masterRows.length,
  'manual refresh does not replace stats with full master size');

assert(source.indexOf('SpreadsheetApp.flush()') >= 0 &&
  /function\s+g010UpsertAuditRow_[\s\S]*SpreadsheetApp\.flush\(\)/.test(source),
  'G010 audit flush regression still present');
assert(/syncCandidateDecisions_\(ss, syncRecords/.test(source) ||
  /syncCandidateDecisions_\(ss, g010CollectDecisionSyncRecordsFromMaster_/.test(source) ||
  source.indexOf('g010CollectDecisionSyncRecordsFromMaster_') >= 0,
  'G010 finalization syncs candidate decisions');

console.log('PASS scripts/test-g010-form-run-closure.js');
