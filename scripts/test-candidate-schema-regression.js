/** Focused Candidate Decision schema/runtime regression tests. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function assert(value, label) {
  if (!value) throw new Error(label);
}

function cloneRow(row, width) {
  var next = row.slice(0, width);
  while (next.length < width) next.push('');
  return next;
}

function FakeRange(sheet, row, column, rowCount, columnCount) {
  this.sheet = sheet;
  this.row = row;
  this.column = column;
  this.rowCount = rowCount || 1;
  this.columnCount = columnCount || 1;
}

FakeRange.prototype.getValues = function () {
  return this.sheet.read(this.row, this.column, this.rowCount, this.columnCount, false);
};
FakeRange.prototype.getDisplayValues = function () {
  return this.sheet.read(this.row, this.column, this.rowCount, this.columnCount, true);
};
FakeRange.prototype.getDisplayValue = function () {
  return this.getDisplayValues()[0][0];
};
FakeRange.prototype.setValue = function (value) {
  this.sheet.write(this.row, this.column, [[value]]);
  return this;
};
FakeRange.prototype.setValues = function (values) {
  this.sheet.write(this.row, this.column, values);
  return this;
};
FakeRange.prototype.clearContent = function () {
  var values = [];
  for (var r = 0; r < this.rowCount; r += 1) {
    values.push(new Array(this.columnCount).fill(''));
  }
  this.sheet.write(this.row, this.column, values);
  return this;
};
FakeRange.prototype.clearDataValidations = function () {
  for (var r = this.row; r < this.row + this.rowCount; r += 1) {
    for (var c = this.column; c < this.column + this.columnCount; c += 1) {
      delete this.sheet.validations[r + ':' + c];
    }
  }
  return this;
};
FakeRange.prototype.setDataValidation = function (rule) {
  for (var r = this.row; r < this.row + this.rowCount; r += 1) {
    for (var c = this.column; c < this.column + this.columnCount; c += 1) {
      this.sheet.validations[r + ':' + c] = rule;
    }
  }
  return this;
};
['setBackground', 'setFontColor', 'setFontWeight', 'setHorizontalAlignment', 'setNumberFormat']
  .forEach(function (name) {
    FakeRange.prototype[name] = function () { return this; };
  });

function FakeSheet(name, headers, rows) {
  this.name = name;
  this.headers = headers.slice();
  this.rows = rows.map(function (row) { return row.slice(); });
  this.validations = {};
  this.rules = [];
  this.maxRows = Math.max(this.rows.length + 1, 20);
  this.maxColumns = Math.max(this.headers.length, 60);
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.getMaxRows = function () { return this.maxRows; };
FakeSheet.prototype.getMaxColumns = function () { return this.maxColumns; };
FakeSheet.prototype.getRange = function (row, column, rowCount, columnCount) {
  if (typeof row === 'string') throw new Error('A1 ranges are not needed in this focused fixture');
  return new FakeRange(this, row, column, rowCount, columnCount);
};
FakeSheet.prototype.read = function (row, column, rowCount, columnCount) {
  var output = [];
  for (var r = 0; r < rowCount; r += 1) {
    var source = row + r === 1 ? this.headers : (this.rows[row + r - 2] || []);
    var values = [];
    for (var c = 0; c < columnCount; c += 1) values.push(source[column + c - 1] === undefined ? '' : source[column + c - 1]);
    output.push(values);
  }
  return output;
};
FakeSheet.prototype.write = function (row, column, values) {
  for (var r = 0; r < values.length; r += 1) {
    var target = row + r === 1 ? this.headers : (this.rows[row + r - 2] || (this.rows[row + r - 2] = []));
    for (var c = 0; c < values[r].length; c += 1) target[column + c - 1] = values[r][c];
  }
};
FakeSheet.prototype.getConditionalFormatRules = function () { return this.rules.slice(); };
FakeSheet.prototype.setConditionalFormatRules = function (rules) { this.rules = rules.slice(); };

function FakeSpreadsheet(sheets) {
  this.sheets = sheets;
}
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'UTC'; };

var canonicalHeaders = [
  'Steam App ID', '游戏名称', '决策状态', '上次人工检查日', '上次检查7d Gain',
  '上次检查类型', '下次复查日', '决策备注', '上次检查时决策状态', '首次发现日期', '首次来源',
  '第一轮类型', '当前Steam阶段', '研究状态', 'Google Trends结果', 'Social结果', 'SERP竞争',
  '关键词机会', '人工备注', 'Decision', 'Decision日期', 'Next Action', 'OpportunityID',
  'ResearchJobID', '自动研究状态', '自动研究时间', '自动Social摘要', '自动SERP摘要', '自动研究结果路径',
  '自动Recommendation', '自动Recommendation置信度', '自动Recommendation理由', '自动缺失证据',
  '自动Recommendation结果路径', '自动研究错误', 'TrendRelativeStrength', 'TrendVerdict', 'TrendLastChecked',
  'ExternalSignal', 'FinalResearchStage', 'PreflightVerdict', 'PreflightCheckedAt', 'PreflightReason'
];
var masterHeaders = [
  '最后扫描时间', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名', 'Steam 发布日期',
  '发布日原文', '发布阶段', '距发售天数', 'Steam Followers', '7d基准Followers', 'Steam 7d Gain',
  '近似增长率', '增速覆盖天数', '评论数', '好评数', 'Steam评分', '1A结果', '1A排除原因',
  '第一轮类型', '第一轮优先级', '进入下一步', '下一步动作', '第一轮判定依据', '当前筛选阶段',
  '数据状态', '数据备注', '首次发现日期', '最后发现日期', '最近Run ID', '人工备注'
];
var rulesHeaders = ['规则Key', '当前值'];
var rulesRows = [['RECHECK_GAIN_GROWTH_MIN', 0.30], ['WATCH_RECHECK_DAYS_STRONG', 3], ['WATCH_RECHECK_DAYS_NORMAL', 7]];

function blankRow(width) { return new Array(width).fill(''); }
function at(headers, row, name) { return row[headers.indexOf(name)]; }
function setAt(headers, row, name, value) { row[headers.indexOf(name)] = value; }

var oldHeaders = canonicalHeaders.slice();
var nextActionIndex = oldHeaders.indexOf('Next Action');
var researchJobIndex = oldHeaders.indexOf('ResearchJobID');
oldHeaders[nextActionIndex] = 'ResearchJobID';
oldHeaders[researchJobIndex] = 'Next Action';
oldHeaders.push('Legacy Tail');
var decisionRow = blankRow(oldHeaders.length);
setAt(oldHeaders, decisionRow, 'Steam App ID', '4948000');
setAt(oldHeaders, decisionRow, '游戏名称', 'Moo Who?');
setAt(oldHeaders, decisionRow, 'Decision', 'WATCH');
setAt(oldHeaders, decisionRow, '人工备注', '人工备注不可丢');
setAt(oldHeaders, decisionRow, '决策备注', '决策备注不可丢');
setAt(oldHeaders, decisionRow, 'Next Action', '合法旧动作');
setAt(oldHeaders, decisionRow, 'Legacy Tail', 'unknown data stays');
setAt(oldHeaders, decisionRow, 'TrendRelativeStrength', 'SOCIAL_EARLY');
setAt(oldHeaders, decisionRow, 'FinalResearchStage', '');
var masterRow = blankRow(masterHeaders.length);
setAt(masterHeaders, masterRow, 'Steam App ID', '4948000');
setAt(masterHeaders, masterRow, '游戏名称', 'Moo Who?');
setAt(masterHeaders, masterRow, 'Steam URL', 'https://store.steampowered.com/app/4948000/');
setAt(masterHeaders, masterRow, '第一轮类型', '🔥 趋势候选');
setAt(masterHeaders, masterRow, '进入下一步', '是');
setAt(masterHeaders, masterRow, 'Steam 7d Gain', 1200);
var eligibleDecisionRow = blankRow(oldHeaders.length);
setAt(oldHeaders, eligibleDecisionRow, 'Steam App ID', '4948001');
setAt(oldHeaders, eligibleDecisionRow, '游戏名称', 'Eligible Candidate');
var eligibleMasterRow = blankRow(masterHeaders.length);
setAt(masterHeaders, eligibleMasterRow, 'Steam App ID', '4948001');
setAt(masterHeaders, eligibleMasterRow, '游戏名称', 'Eligible Candidate');
setAt(masterHeaders, eligibleMasterRow, 'Steam URL', 'https://store.steampowered.com/app/4948001/');
setAt(masterHeaders, eligibleMasterRow, '第一轮类型', '🔥 趋势候选');
setAt(masterHeaders, eligibleMasterRow, '进入下一步', '是');
setAt(masterHeaders, eligibleMasterRow, 'Steam 7d Gain', 900);

var decisionSheet = new FakeSheet('候选决策', oldHeaders, [decisionRow, eligibleDecisionRow]);
var masterSheet = new FakeSheet('候选主表', masterHeaders, [masterRow, eligibleMasterRow]);
var rulesSheet = new FakeSheet('规则配置', rulesHeaders, rulesRows);
var spreadsheet = new FakeSpreadsheet({候选决策: decisionSheet, 候选主表: masterSheet, 规则配置: rulesSheet});
var sandbox = {
  console: console,
  SpreadsheetApp: {
    getActiveSpreadsheet: function () { return spreadsheet; },
    newDataValidation: function () {
      return {
        requireValueInList: function (values) { this.values = values; return this; },
        setAllowInvalid: function (value) { this.allowInvalid = value; return this; },
        build: function () { return this; }
      };
    },
    newConditionalFormatRule: function () {
      return {
        whenTextEqualTo: function () { return this; },
        setBackground: function () { return this; },
        setRanges: function () { return this; },
        build: function () { return this; }
      };
    }
  },
  Utilities: {
    formatDate: function (date) { return new Date(date).toISOString().slice(0, 10); }
  },
  PropertiesService: {getScriptProperties: function () { return {getProperty: function () { return 'token'; }};}},
  ContentService: {MimeType: {JSON: 'application/json'}},
  LockService: {getScriptLock: function () { return {tryLock: function () { return false; }, releaseLock: function () {}}; }},
  Date: Date, Number: Number, String: String, Math: Math
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
sandbox.refreshTodayActionsFromCandidateDecisions_ = function () { return {ok: true}; };

var migrated = sandbox.ensureCandidateDecisionSchema_(spreadsheet);
var migratedHeaders = decisionSheet.headers;
assert(migrated.ok === true, 'schema migration returns ok');
assert(migratedHeaders[21] === 'Next Action' && migratedHeaders[23] === 'ResearchJobID', 'canonical V/X physical columns restored');
assert(at(migratedHeaders, decisionSheet.rows[0], 'Decision') === 'WATCH', 'Decision preserved');
assert(at(migratedHeaders, decisionSheet.rows[0], '人工备注') === '人工备注不可丢', 'manual note preserved');
assert(at(migratedHeaders, decisionSheet.rows[0], '决策备注') === '决策备注不可丢', 'decision note preserved');
assert(at(migratedHeaders, decisionSheet.rows[0], 'Legacy Tail') === 'unknown data stays', 'unknown data preserved');

decisionSheet.validations['2:24'] = {values: ['old validation']};
sandbox.setupCandidateDecisionUi_(spreadsheet);
assert(!decisionSheet.validations['2:24'], 'stale ResearchJobID validation cleared');

var queued = sandbox.enqueueSteamCandidateResearchJobs_(spreadsheet, new Date('2026-08-26T01:00:00Z'));
assert(queued.created === 1, 'eligible candidate enqueued');
assert(at(migratedHeaders, decisionSheet.rows[0], 'Next Action') === '合法旧动作', 'Next Action unchanged');
assert(at(migratedHeaders, decisionSheet.rows[1], 'ResearchJobID') === 'steam-research-4948001-20260826', 'ResearchJobID written by header');
assert(at(migratedHeaders, decisionSheet.rows[1], '自动研究状态') === 'PENDING', 'automatic status written by header');
var rerun = sandbox.enqueueSteamCandidateResearchJobs_(spreadsheet, new Date('2026-08-26T02:00:00Z'));
assert(rerun.created === 0, 'same AppID and cycle does not duplicate job');

var repaired = sandbox.repairCandidateDecisionSchemaData_(spreadsheet);
assert(repaired.repaired >= 1, 'corrupt tail repaired');
assert(at(migratedHeaders, decisionSheet.rows[0], 'TrendRelativeStrength') === '', 'corrupt TrendRelativeStrength cleared');
assert(at(migratedHeaders, decisionSheet.rows[0], 'FinalResearchStage') === 'SOCIAL_EARLY', 'unique route moved to FinalResearchStage');
assert(repaired.appIds.indexOf('4948000') >= 0, 'repair reports Moo Who AppID');

var callback = {
  job_id: 'steam-research-4948001-20260826', job_type: 'STEAM_CANDIDATE_RESEARCH', steam_app_id: '4948001',
  game_name: 'Eligible Candidate', research_cycle_date: '2026-08-26', execution_status: 'COMPLETED',
  preflight_verdict: 'MANUAL_REVIEW', preflight_checked_at: '2026-08-26T02:30:00Z',
  preflight_reason: 'SERP requires manual review'
};
var callbackResult = sandbox.handleSteamCandidateResearchCallback_(callback);
assert(callbackResult.ok === true, 'callback accepted');
assert(at(migratedHeaders, decisionSheet.rows[1], '自动研究状态') === 'COMPLETED', 'callback status header write');
assert(at(migratedHeaders, decisionSheet.rows[1], 'PreflightVerdict') === 'MANUAL_REVIEW', 'callback verdict header write');
assert(at(migratedHeaders, decisionSheet.rows[1], 'PreflightCheckedAt') === '2026-08-26T02:30:00Z', 'callback checked-at header write');
assert(at(migratedHeaders, decisionSheet.rows[1], 'PreflightReason') === 'SERP requires manual review', 'callback reason header write');

var rules = {RECHECK_GAIN_GROWTH_MIN: 0.30};
var rec = {continueNext: '是', gain7d: 1000};
assert(sandbox.decideTodayActionProjection_(rec, {status: 'BUILD'}, new Date('2026-08-26'), rules, spreadsheet).include === false, 'BUILD absent from Today Action');
assert(sandbox.decideTodayActionProjection_(rec, {status: 'REJECT'}, new Date('2026-08-26'), rules, spreadsheet).include === false, 'REJECT absent from Today Action');
assert(sandbox.decideTodayActionProjection_(rec, {status: 'WATCH', nextRecheckDate: '2026-09-01'}, new Date('2026-08-26'), rules, spreadsheet).type === 'WATCH_WAITING', 'WATCH_WAITING retained');

console.log('PASS scripts/test-candidate-schema-regression.js (migration, validation, header writes, repair, projection, idempotency)');
