/** Candidate Decision -> 今日行动 projection regression tests. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');

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
  return display ? out.map(function (row) { return row.map(function (value) { return value instanceof Date ? value.toISOString() : String(value == null ? '' : value); }); }) : out;
};

FakeRange.prototype.getValues = function () { return this.read(false); };
FakeRange.prototype.getDisplayValues = function () { return this.read(true); };
FakeRange.prototype.setValue = function (value) { this.sheet.write(this.row, this.column, [[value]]); return this; };
FakeRange.prototype.setValues = function (values) { this.sheet.write(this.row, this.column, values); return this; };
FakeRange.prototype.clearContent = function () {
  var values = [];
  for (var r = 0; r < this.rowCount; r += 1) {
    values.push(new Array(this.columnCount).fill(''));
  }
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
  this.rows = rows.map(function (row) { return row.slice(); });
  this.maxRows = maxRows || Math.max(20, this.rows.length + 4);
  this.writeCount = 0;
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
  this.writeCount += 1;
  for (var r = 0; r < values.length; r += 1) {
    while (this.rows.length < row + r - 1) this.rows.push([]);
    var target = this.rows[row + r - 2] || (this.rows[row + r - 2] = []);
    for (var c = 0; c < values[r].length; c += 1) target[column + c - 1] = values[r][c];
  }
};

function FakeSpreadsheet(sheets) {
  this.sheets = sheets;
}
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Shanghai'; };

var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var sandbox = {
  console: console,
  SpreadsheetApp: {getActiveSpreadsheet: function () { return sandbox.__spreadsheet; }},
  Utilities: {formatDate: function (date) { return new Date(date).toISOString().slice(0, 10); }},
  Date: Date, String: String, Number: Number, Math: Math, Set: Set, Map: Map, Object: Object, Array: Array
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
sandbox.applyActionFormatting_ = function () {};
sandbox.setupTodayActionUi_ = function () {};

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

function master(appId, name, gain) {
  return row(masterHeaders, {
    'Steam App ID': appId, '游戏名称': name, 'Steam URL': 'https://store.steampowered.com/app/' + appId + '/',
    '第一轮类型': '🔥 趋势候选', '第一轮优先级': 'P1 高', '进入下一步': '是',
    '当前筛选阶段': '1B完成→人工第二轮', 'Steam Followers': 10000, 'Steam 7d Gain': gain,
    '近似增长率': 0.2, '发布阶段': '已发售', '距发售天数': 0, '评论数': 100, 'Steam评分': 0.9
  });
}

function decision(appId, name, values) {
  return row(decisionHeaders, Object.assign({
    'Steam App ID': appId, '游戏名称': name, '当前Steam阶段': '1B完成→人工第二轮',
    '研究状态': '待研究', 'Google Trends结果': '未检查', 'Social结果': '未检查',
    'SERP竞争': '未检查', '关键词机会': '未检查'
  }, values));
}

var masterRows = [
  master('1001', 'BRIGANDINE ABYSS', 1000), master('1002', "Soul's Remnant", 1000),
  master('1003', 'BOMBANANA!', 1000), master('1004', 'lovebyte.exe', 1000),
  master('1005', 'Money for Girls: Amortized', 1000), master('1006', 'New Manual Review', 1000),
  master('1007', 'Existing Trends Manual Review', 1000)
];
var decisionRows = [
  decision('1001', 'BRIGANDINE ABYSS', {Decision: 'BUILD', PreflightVerdict: 'MANUAL_REVIEW'}),
  decision('1002', "Soul's Remnant", {Decision: 'REJECT', PreflightVerdict: 'MANUAL_REVIEW'}),
  decision('1003', 'BOMBANANA!', {Decision: 'WATCH', PreflightVerdict: 'WATCH', '下次复查日': '2026-09-03', '上次检查7d Gain': 1000}),
  decision('1004', 'lovebyte.exe', {Decision: 'WATCH', PreflightVerdict: 'WATCH', '下次复查日': '2026-09-01', '上次检查7d Gain': 1000}),
  decision('1005', 'Money for Girls: Amortized', {Decision: 'WATCH', PreflightVerdict: 'WATCH', '下次复查日': '2026-08-28', '上次检查7d Gain': 1000}),
  decision('1006', 'New Manual Review', {PreflightVerdict: 'MANUAL_REVIEW', '人工备注': ''}),
  decision('1007', 'Existing Trends Manual Review', {PreflightVerdict: 'MANUAL_REVIEW', 'Google Trends结果': '强', '人工备注': ''})
];
masterRows.push(master('1008', 'Scavland', 1000));
decisionRows.push(decision('1008', 'Scavland', {Decision: 'WATCH', PreflightVerdict: 'WATCH', '下次复查日': '2026-09-04', '上次检查7d Gain': 1000, '人工备注': 'scavland note'}));
masterRows.push(row(masterHeaders, {
  'Steam App ID': '2825860', '游戏名称': 'The Sinking City 2',
  'Steam URL': 'https://store.steampowered.com/app/2825860/',
  '第一轮类型': '🟡 Trend Watch', '第一轮优先级': 'P2 观察', '进入下一步': '是',
  '下一步动作': 'Google Trends', '当前筛选阶段': '1B完成→人工第二轮',
  'Steam Followers': 12000, 'Steam 7d Gain': 800, '近似增长率': 0.08,
  '发布阶段': '已发售', '距发售天数': 0, '评论数': 100, 'Steam评分': 0.9
}));
masterRows.push(master('1575990', 'Twisted Tower', 1000));
masterRows.push(master('4026250', 'Project P.I.T.T.', 1000));
for (var genericIndex = 0; genericIndex < 140; genericIndex += 1) {
  var genericAppId = String(2000 + genericIndex);
  var genericName = 'Historical Candidate ' + genericIndex;
  var genericStatus = genericIndex % 4 === 0 ? 'BUILD' : genericIndex % 4 === 1 ? 'REJECT' : genericIndex % 4 === 2 ? 'WATCH' : '';
  masterRows.push(master(genericAppId, genericName, 1000));
  decisionRows.push(decision(genericAppId, genericName, {
    Decision: genericStatus,
    PreflightVerdict: genericStatus === 'WATCH' ? 'WATCH' : genericStatus ? 'MANUAL_REVIEW' : '',
    '下次复查日': genericStatus === 'WATCH' ? '2026-09-10' : '',
    '上次检查7d Gain': genericStatus === 'WATCH' ? 1000 : '',
    '人工备注': 'historical note ' + genericIndex
  }));
}
masterRows.push(master('4356430', 'NBA 2K27', 1000));
decisionRows.push(decision('4356430', 'NBA 2K27', {Decision: 'BUILD', PreflightVerdict: 'MANUAL_REVIEW'}));
assert(decisionRows.length === 149 && masterRows.length === 152, 'fixture includes P2 and lifecycle-only handled candidates');
masterRows.push(master('1009', 'Failed Machine Research', 1000));
decisionRows.push(decision('1009', 'Failed Machine Research', {
  autoResearchStatus: 'FAILED', autoResearchError: 'searchapi_http_429'
}));
var rules = new FakeSheet('规则配置', ['规则Key', '当前值'], [
  ['RECHECK_GAIN_GROWTH_MIN', 0.30], ['WATCH_RECHECK_DAYS_STRONG', 3], ['WATCH_RECHECK_DAYS_NORMAL', 7]
]);
var staleRows = [
  row(actionHeaders, {'行动类型': 'NEW', '游戏名称': 'BRIGANDINE ABYSS', 'Steam App ID': '1001', '人工决定': ''}),
  row(actionHeaders, {'行动类型': 'NEW', '游戏名称': "Soul's Remnant", 'Steam App ID': '1002', '人工决定': ''}),
  row(actionHeaders, {'行动类型': 'NEW', '游戏名称': 'BOMBANANA!', 'Steam App ID': '1003', '人工决定': '', '人工备注': 'keep manual note'}),
  row(actionHeaders, {'行动类型': 'NEW', '游戏名称': 'lovebyte.exe', 'Steam App ID': '1004', '人工决定': ''}),
  row(actionHeaders, {'行动类型': 'NEW', '游戏名称': 'Money for Girls: Amortized', 'Steam App ID': '1005', '人工决定': ''})
];
var spreadsheet = new FakeSpreadsheet({
  '候选主表': new FakeSheet('候选主表', masterHeaders, masterRows),
  '候选决策': new FakeSheet('候选决策', decisionHeaders, decisionRows),
  '站点项目池': new FakeSheet('站点项目池', ['Site ID', '游戏名称', 'Steam App ID', '当前状态', 'Build状态', 'Vercel URL', '上线日期', 'ActualLiveAt', 'OpportunityID'], [
    ['twisted-tower', 'Twisted Tower', '1575990', '已建站', 'DONE', '', '', '', ''],
    ['sinking-city-2', 'The Sinking City 2', '2825860', '候选', 'BUILD_PENDING', '', '', '', ''],
    ['pending-site', 'Pending Site Candidate', '999003', '候选', 'BUILDING', '', '', '', ''],
    ['nba-2k27', 'NBA 2K27', '4356430', 'LIVE', 'LIVE', 'https://nba-2k27-game.vercel.app', '2026-09-03', '2026-09-03', 'opp-nba-2k27-steam-candidate-001']
  ]),
  '历史游戏库': new FakeSheet('历史游戏库', ['Steam App ID', '游戏名称', 'Steam URL', '当前阶段', '备注'], [
    ['4026250', 'Project P.I.T.T.', '', '已进入建站', '历史建站事实'],
    ['999004', 'Old Pending Candidate', '', '候选', '尚未建站']
  ]),
  'Trends研究记录': new FakeSheet('Trends研究记录', ['ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game', 'TrendVerdict'], []),
  '建站关键词规划': new FakeSheet('建站关键词规划', ['目标游戏', '关联AppID', '动作', 'Steam URL'], [
    ['Build Plan Game', '999005', 'Build', '']
  ]),
  '规则配置': rules,
  '今日行动': new FakeSheet('今日行动', actionHeaders, [[''], actionHeaders].concat(staleRows))
});
sandbox.__spreadsheet = spreadsheet;
spreadsheet.getSheetByName('Trends研究记录').rows.push(
  ['research-1006', '2026-08-28', 'e-1006', '1006', 'New Manual Review', ''],
  ['research-999001', '2026-08-28', 'e-999001', '999001', 'Completed Research Game', 'SEARCH_WEAK']
);
var handledFixture = sandbox.buildTodayActionAlreadyHandled_(spreadsheet, sandbox.readCandidateDecisions_(spreadsheet));
assert(handledFixture.byAppId.has('1575990'), 'alreadyHandled reads 站点项目池 App ID');
assert(handledFixture.byAppId.has('4026250'), 'alreadyHandled reads 历史游戏库 App ID');
assert(!handledFixture.byAppId.has('1006'), 'empty Trends研究记录 does not become handled');
assert(handledFixture.byAppId.has('999001'), 'completed Trends研究记录 becomes handled');
assert(!handledFixture.byAppId.has('2825860'), 'non-terminal site-pool row does not become handled');
assert(!handledFixture.byAppId.has('999003'), 'pending site-pool row does not become handled');
assert(!handledFixture.byAppId.has('999004'), 'non-terminal history row does not become handled');
assert(handledFixture.byAppId.has('999005'), 'Build plan action becomes handled');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function decisionSnapshot(sheet) {
  return {
    rowCount: sheet.rows.length,
    rows: sheet.rows.map(function (row) { return row.slice(); }),
    appIds: sheet.rows.map(function (row) { return row[decisionHeaders.indexOf('Steam App ID')]; }),
    decisions: sheet.rows.map(function (row) { return [row[decisionHeaders.indexOf('Steam App ID')], row[decisionHeaders.indexOf('Decision')]]; }),
    notes: sheet.rows.map(function (row) { return [row[decisionHeaders.indexOf('Steam App ID')], row[decisionHeaders.indexOf('人工备注')]]; })
  };
}
var decisionSheet = spreadsheet.getSheetByName('候选决策');
var masterSheet = spreadsheet.getSheetByName('候选主表');
var actionSheetBefore = spreadsheet.getSheetByName('今日行动');
var beforeDecision = decisionSnapshot(decisionSheet);
var beforeDecisionHash = digest(beforeDecision);
var beforeActionHash = digest(actionSheetBefore.rows);
var beforeDecisionWrites = decisionSheet.writeCount;
var beforeMasterWrites = masterSheet.writeCount;
var runCalls = 0;
sandbox.runSteamHotword01B = function () { runCalls += 1; throw new Error('full scan must not run during refresh'); };
sandbox.syncCandidateDecisions_ = function () { throw new Error('candidate decision rebuild must not run during refresh'); };

var result = sandbox.refreshTodayActionsFromCandidateDecisions();
assert(result.ok, 'refresh succeeds');
assert(result.beforePendingCount === 5, 'stale pending count measured');
assert(result.waitingCount >= 0, 'waiting count is reported');
assert(runCalls === 0, 'manual refresh does not invoke runSteamHotword01B');
assert(decisionSheet.writeCount === beforeDecisionWrites, '候选决策 has no writes');
assert(masterSheet.writeCount === beforeMasterWrites, '候选主表 has no writes');
var afterDecision = decisionSnapshot(decisionSheet);
assert(afterDecision.rowCount === beforeDecision.rowCount, '候选决策 row count unchanged');
assert(digest(afterDecision) === beforeDecisionHash, '候选决策 snapshot unchanged');
assert(afterDecision.appIds.length === beforeDecision.appIds.length, 'all AppID rows retained');
beforeDecision.appIds.forEach(function (appId, index) {
  assert(afterDecision.appIds[index] === appId, 'AppID retained at row ' + index);
  assert(afterDecision.decisions[index][1] === beforeDecision.decisions[index][1], 'Decision retained at row ' + index);
  assert(afterDecision.notes[index][1] === beforeDecision.notes[index][1], 'manual note retained at row ' + index);
});
assert(digest(spreadsheet.getSheetByName('今日行动').rows) !== beforeActionHash, 'only 今日行动 output changed');

var actionSheet = spreadsheet.getSheetByName('今日行动');
var actionRows = actionSheet.rows.slice(2).filter(function (candidate) { return String(candidate[actionHeaders.indexOf('Steam App ID')] || '').trim(); });
function find(appId) { return actionRows.find(function (candidate) { return candidate[actionHeaders.indexOf('Steam App ID')] === appId; }); }
assert(!find('1001'), 'BUILD is absent from 今日行动');
assert(!find('4356430'), 'LIVE site-pool BUILD (NBA 2K27) is absent from 今日行动');
assert(!find('1002'), 'REJECT is absent from 今日行动');
assert(!find('1575990'), 'site-pool Twisted Tower is absent from 今日行动');
assert(!find('4026250'), 'history-library Project P.I.T.T. is absent from 今日行动');
assert(find('1006'), 'manual-mode new MANUAL_REVIEW enters Today Action');
assert(find('1007'), 'manual-mode existing Trends candidate enters Today Action');
assert(find('2825860'), 'manual-mode P2 sample enters Today Action');
['1003', '1004', '1005'].forEach(function (appId) {
  assert(find(appId), appId + ' WATCH remains visible under recheck/waiting rules');
});
var failedRowProjection = sandbox.decideTodayActionProjection_(
  {appId: '1009', continueNext: '是', firstRoundType: '🔥 趋势候选', gain7d: 1000},
  {appId: '1009', currentStage: '1B完成→人工第二轮', status: '', autoResearchStatus: 'FAILED', autoResearchError: 'searchapi_http_429'},
  new Date('2026-09-08T00:00:00Z'), {}, spreadsheet, new Map()
);
assert(failedRowProjection.include, 'manual mode does not trap FAILED history outside Today Action');
assert(!find('1001'), 'BUILD still absent after sampling');
var terminalRec = {appId: 'terminal-1', continueNext: '是', firstRoundType: '🔥 趋势候选'};
var terminalDecision = {
  appId: 'terminal-1', currentStage: '1B完成→人工第二轮', status: '', autoResearchStatus: 'COMPLETED',
  preflightVerdict: 'MANUAL_REVIEW',
  trendsResult: '强', socialResult: '中', serpCompetition: '低', keywordOpportunity: '有',
  autoRecommendation: 'RECOMMEND_BUILD', autoRecommendationConfidence: 'HIGH',
  autoResearchResultPath: 'jobs/terminal/research.json', autoRecommendationResultPath: 'jobs/terminal/recommendation.json'
};
var readyProjection = sandbox.decideTodayActionProjection_(terminalRec, terminalDecision, new Date('2026-09-08T00:00:00Z'), {}, spreadsheet, new Map());
assert(readyProjection.include && (readyProjection.type === 'READY' || readyProjection.type === 'NEW'),
  'completed research still enters Today Action in manual mode');
var manualHandoffDecision = {
  appId: 'manual-1', currentStage: '1B完成→人工第二轮', status: '', autoResearchStatus: 'COMPLETED',
  preflightVerdict: 'MANUAL_REVIEW', trendsResult: '未检查', socialResult: '中',
  serpCompetition: '未检查', keywordOpportunity: '有'
};
var manualHandoff = sandbox.decideTodayActionProjection_(
  {appId: 'manual-1', continueNext: '是', firstRoundType: '🔥 趋势候选'},
  manualHandoffDecision, new Date('2026-09-08T00:00:00Z'), {}, spreadsheet, new Map()
);
assert(manualHandoff.include && String(manualHandoff.humanAction || '').indexOf('Google Trends') >= 0,
  'manual handoff enters Today Action for Google Trends');
assert(sandbox.candidateManualEvidenceNextAction_({}, manualHandoffDecision) === 'Google Trends', 'MANUAL_REVIEW starts with Trends');
manualHandoffDecision.trendsResult = '强';
assert(sandbox.candidateManualEvidenceNextAction_({}, manualHandoffDecision) === 'Decision' ||
  sandbox.candidateManualEvidenceNextAction_({}, manualHandoffDecision) === 'SERP检查',
  'after Trends, Next Action advances in manual flow');
var failedProjection = sandbox.decideTodayActionProjection_(terminalRec, Object.assign({}, terminalDecision, {
  autoResearchStatus: 'FAILED', autoResearchError: 'searchapi_http_error', trendsResult: '未检查'
}), new Date('2026-09-08T00:00:00Z'), {}, spreadsheet, new Map());
assert(failedProjection.include, 'manual mode treats historical FAILED as audit-only and still allows human flow');
assert(sandbox.candidateInboxHumanAction_(terminalRec, {
  autoResearchStatus: 'FAILED', autoResearchError: 'searchapi_http_error', trendsResult: '未检查'
}) === '检查 Google Trends', 'FAILED history can still open Google Trends in manual mode');
assert(result.afterPendingCount >= 1, 'manual-mode refresh surfaces actionable Today Action rows');
assert(source.indexOf("today_action_refresh: refreshTodayActionsFromCandidateDecisions_()") >= 0, 'preflight callback refresh hook');
assert(source.indexOf('function candidateDecisionEditAffectsTodayAction_') >= 0, 'candidate decision edit hook');
assert(source.indexOf("refreshTodayActionsFromCandidateDecisions_(e.source)") >= 0, 'manual edit refresh hook');
assert(source.indexOf('setupTodayActionUi_(ss)') >= 0 && source.indexOf('写入 HYPERLINK 前必须按当前表头重绑人工字段验证') >= 0,
  'refreshTodayAction rebinds validations after header changes');
var refreshStart = source.indexOf('function refreshTodayActionsFromCandidateDecisions_(spreadsheet');
var refreshEnd = source.indexOf('function todayActionRefreshRunId_', refreshStart);
var refreshBody = source.slice(refreshStart, refreshEnd);
['runSteamHotword01B(', 'syncCandidateDecisions_(', 'candidateDecisionRow_('].forEach(function (needle) {
  assert(refreshBody.indexOf(needle) < 0, 'refresh body has no destructive candidate path: ' + needle);
});
var scanStart = source.indexOf('function runSteamHotword01B(');
var syncCall = source.indexOf('syncCandidateDecisions_(ss, active', scanStart);
var syncStart = source.indexOf('function syncCandidateDecisions_(');
var syncEnd = source.indexOf('function nextActionForResearch_', syncStart);
assert(syncCall > scanStart, 'full scan owns candidate decision synchronization');
assert(source.slice(syncStart, syncEnd).indexOf('clearContent()') < 0, 'candidate sync preserves unknown columns');
assert(source.slice(syncStart, syncEnd).indexOf('candidateDecisionRow_(decision, columnMap') >= 0, 'candidate sync writes through the header map');
console.log('PASS scripts/test-today-action-refresh.js');
