/** BUILD handoff vs Site Creation completion regression tests. */
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
FakeRange.prototype.getDisplayValue = function () { return this.getValues()[0][0]; };
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

function FakeSpreadsheet(sheets) { this.sheets = sheets; }
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Shanghai'; };
FakeSpreadsheet.prototype.insertSheet = function (name) {
  var sheet = new FakeSheet(name, [], []);
  this.sheets[name] = sheet;
  return sheet;
};

var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var sandbox = {
  console: console,
  SpreadsheetApp: {
    getActiveSpreadsheet: function () { return sandbox.__spreadsheet; },
    newDataValidation: function () {
      return {
        requireValueInList: function () { return this; },
        setAllowInvalid: function () { return this; },
        build: function () { return {}; }
      };
    }
  },
  Utilities: {formatDate: function (date) { return new Date(date).toISOString().slice(0, 10); }},
  Date: Date, String: String, Number: Number, Math: Math, Set: Set, Map: Map, Object: Object, Array: Array,
  JSON: JSON, RegExp: RegExp
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
sandbox.applyActionFormatting_ = function () {};
sandbox.setupTodayActionUi_ = function () {};
sandbox.ensureSheetWithHeaders_ = function (ss, name, headers) {
  var existing = ss.getSheetByName(name);
  if (existing) {
    if (!existing.headers.length) existing.headers = headers.slice();
    return existing;
  }
  var sheet = new FakeSheet(name, headers.slice(), []);
  ss.sheets[name] = sheet;
  return sheet;
};
sandbox.upsertGscBindingRecord_ = function () { return null; };

function extractHeaders(name) {
  var match = source.match(new RegExp('\\n  ' + name + ': \\[([\\s\\S]*?)\\],\\n\\n'));
  if (!match) throw new Error('missing header array ' + name);
  return vm.runInNewContext('[' + match[1] + ']');
}

var decisionHeaders = extractHeaders('decisionHeaders');
var masterHeaders = extractHeaders('masterHeaders');
var actionHeaders = extractHeaders('actionHeaders');
var sitePoolHeaders = vm.runInContext('HOTWORD_V2.sitePoolHeaders.slice()', sandbox);
var gscBindingHeaders = vm.runInContext('HOTWORD_V2.gscBindingHeaders.slice()', sandbox);

function row(headers, values) {
  var output = new Array(headers.length).fill('');
  Object.keys(values).forEach(function (name) { output[headers.indexOf(name)] = values[name]; });
  return output;
}

function master(appId, name) {
  return row(masterHeaders, {
    'Steam App ID': appId, '游戏名称': name,
    'Steam URL': 'https://store.steampowered.com/app/' + appId + '/',
    '第一轮类型': '🔥 趋势候选', '第一轮优先级': 'P1 高', '进入下一步': '是',
    '当前筛选阶段': '1B完成→人工第二轮', 'Steam Followers': 10000, 'Steam 7d Gain': 1000,
    '近似增长率': 0.2, '发布阶段': '已发售', '距发售天数': 0, '评论数': 100, 'Steam评分': 0.9
  });
}

function decision(appId, name, values) {
  return row(decisionHeaders, Object.assign({
    'Steam App ID': appId, '游戏名称': name, '当前Steam阶段': '1B完成→人工第二轮',
    '研究状态': '已完成', 'Google Trends结果': '强', 'Social结果': '强',
    'SERP竞争': '弱', '关键词机会': '强', Decision: 'BUILD', 'Next Action': 'Site Build'
  }, values));
}

assert(sandbox.isSitePoolSiteCreationComplete_({currentStatus: 'LIVE'}) === true, '当前状态 LIVE completes');
assert(sandbox.isSitePoolSiteCreationComplete_({buildStatus: 'LIVE'}) === true, 'Build状态 LIVE completes');
assert(sandbox.isSitePoolSiteCreationComplete_({
  vercelUrl: 'https://halloween-the-game-guide.vercel.app/',
  actualLiveAt: '2026-08-29T06:36:13.054Z'
}) === true, 'URL + launch timestamp completes');
assert(sandbox.isSitePoolSiteCreationComplete_({
  vercelUrl: 'https://example.vercel.app/',
  actualLiveAt: ''
}) === false, 'URL alone is not complete');
assert(sandbox.isSitePoolSiteCreationComplete_({
  vercelUrl: 'MISSING',
  actualLiveAt: '2026-08-29'
}) === false, 'placeholder URL rejected');
assert(sandbox.isRealPublishedSiteUrl_('https://crushlanding.wiki/') === true, 'custom domain accepted');

var livePool = row(sitePoolHeaders, {
  'Site ID': 'nba-2k27', '游戏名称': 'NBA 2K27', 'Steam App ID': '4356430',
  '当前状态': 'LIVE', 'Build状态': 'LIVE',
  'Vercel URL': 'https://nba-2k27-game.vercel.app',
  OpportunityID: 'opp-nba-2k27-steam-candidate-001',
  ActualLiveAt: '2026-09-03T00:00:00Z'
});
var pendingPool = row(sitePoolHeaders, {
  'Site ID': 'pending-build-game', '游戏名称': 'Pending Build Game', 'Steam App ID': '5000001',
  '当前状态': 'BUILD_PENDING', 'Build状态': 'BUILD_PENDING'
});
var urlCompletePool = row(sitePoolHeaders, {
  'Site ID': 'halloween-the-game', '游戏名称': 'Halloween: The Game', 'Steam App ID': '3219630',
  '当前状态': 'BUILD_PENDING', 'Build状态': 'BUILDING',
  'Vercel URL': 'https://halloween-the-game-guide.vercel.app/',
  '上线日期': '2026-08-29T06:36:13.054Z',
  OpportunityID: 'opp-halloween-the-game-steam-candidate-001'
});

var masterRows = [
  master('4356430', 'NBA 2K27'),
  master('3219630', 'Halloween: The Game'),
  master('5000001', 'Pending Build Game'),
  master('2445260', 'Tyr')
];
var decisionRows = [
  decision('4356430', 'NBA 2K27'),
  decision('3219630', 'Halloween: The Game'),
  decision('5000001', 'Pending Build Game'),
  decision('2445260', 'Tyr', {Decision: 'WATCH', 'Next Action': 'Recheck', '下次复查日': '2026-09-10'})
];

var spreadsheet = new FakeSpreadsheet({
  '候选主表': new FakeSheet('候选主表', masterHeaders, masterRows),
  '候选决策': new FakeSheet('候选决策', decisionHeaders, decisionRows),
  '站点项目池': new FakeSheet('站点项目池', sitePoolHeaders, [livePool, pendingPool, urlCompletePool]),
  '项目GSC关联': new FakeSheet('项目GSC关联', gscBindingHeaders, [
    row(gscBindingHeaders, {
      'Site ID': 'scarlet-skips',
      '游戏名称': 'Scarlet Skips',
      'Steam App ID': '4513480',
      '网站URL': 'https://scarlet-skips.vercel.app/'
    })
  ]),
  '历史游戏库': new FakeSheet('历史游戏库', ['Steam App ID', '游戏名称', 'Steam URL', '当前阶段', '备注'], []),
  'Trends研究记录': new FakeSheet('Trends研究记录', ['ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game', 'TrendVerdict'], []),
  '建站关键词规划': new FakeSheet('建站关键词规划', ['目标游戏', '关联AppID', '动作', 'Steam URL'], []),
  '规则配置': new FakeSheet('规则配置', ['规则Key', '当前值'], [
    ['RECHECK_GAIN_GROWTH_MIN', 0.30], ['WATCH_RECHECK_DAYS_STRONG', 3], ['WATCH_RECHECK_DAYS_NORMAL', 7]
  ]),
  '今日行动': new FakeSheet('今日行动', actionHeaders, [[''], actionHeaders])
});
sandbox.__spreadsheet = spreadsheet;

var index = sandbox.readSitePoolCompletionIndex_(spreadsheet);
assert(index.byAppId.has('4356430'), 'NBA LIVE indexed by App ID');
assert(index.byAppId.has('3219630'), 'Halloween URL+launch indexed by App ID');
assert(!index.byAppId.has('5000001'), 'pending BUILD not complete');
assert(index.byOpportunityId.has('opp-nba-2k27-steam-candidate-001'), 'OpportunityID secondary index');

var liveProjection = sandbox.decideTodayActionProjection_(
  {appId: '4356430', continueNext: '是', gain7d: 1000, firstRoundType: '🔥 趋势候选'},
  {status: 'BUILD', appId: '4356430', opportunityId: 'opp-nba-2k27-steam-candidate-001'},
  new Date('2026-09-05T08:00:00Z'), {}, spreadsheet, index
);
assert(liveProjection.include === false, 'LIVE site excludes BUILD from 今日行动');

var pendingProjection = sandbox.decideTodayActionProjection_(
  {appId: '5000001', continueNext: '是', gain7d: 1000, firstRoundType: '🔥 趋势候选'},
  {status: 'BUILD', appId: '5000001'},
  new Date('2026-09-05T08:00:00Z'), {}, spreadsheet, index
);
assert(pendingProjection.include === false, 'BUILD no longer enters Today Action');

masterRows.push(master('4513480', 'Scarlet Skips'));
decisionRows.push(decision('4513480', 'Scarlet Skips'));
spreadsheet.sheets['候选主表'] = new FakeSheet('候选主表', masterHeaders, masterRows);
spreadsheet.sheets['候选决策'] = new FakeSheet('候选决策', decisionHeaders, decisionRows);

var reconcile = sandbox.reconcileBuildSitePoolConsistency_(spreadsheet, {
  existingSiteRecords: [{
    siteId: 'sucker-for-love-crush-landing',
    appId: '3848900',
    gameName: 'Sucker for Love: Crush Landing',
    vercelUrl: 'https://crushlanding.wiki/',
    actualLiveAt: '2026-09-02T08:32:00+08:00',
    source: 'control_center_registry'
  }]
});
assert(reconcile.alreadyComplete >= 2, 'closes already-complete BUILD rows');
assert(reconcile.backfilled >= 1, 'backfills Scarlet from GSC binding');
assert(reconcile.exceptions.some(function (item) {
  return item.appId === '5000001';
}), 'pending BUILD stays in exception list');

var suckerDecision = decision('3848900', 'Sucker for Love: Crush Landing');
spreadsheet.sheets['候选决策'].rows.push(suckerDecision);
masterRows.push(master('3848900', 'Sucker for Love: Crush Landing'));
spreadsheet.sheets['候选主表'] = new FakeSheet('候选主表', masterHeaders, masterRows);

reconcile = sandbox.reconcileBuildSitePoolConsistency_(spreadsheet, {
  existingSiteRecords: [{
    siteId: 'sucker-for-love-crush-landing',
    appId: '3848900',
    gameName: 'Sucker for Love: Crush Landing',
    vercelUrl: 'https://crushlanding.wiki/',
    actualLiveAt: '2026-09-02T08:32:00+08:00',
    source: 'control_center_registry'
  }],
  includeGscBindings: false
});
assert(reconcile.backfilled >= 1, 'registry record backfills Sucker into site pool');
var poolSheet = spreadsheet.getSheetByName('站点项目池');
var suckerPool = poolSheet.rows.find(function (candidate) {
  return String(candidate[sitePoolHeaders.indexOf('Steam App ID')]) === '3848900';
});
assert(suckerPool, 'Sucker site pool row exists');
assert(suckerPool[sitePoolHeaders.indexOf('当前状态')] === 'LIVE', 'Sucker 当前状态 LIVE');
assert(suckerPool[sitePoolHeaders.indexOf('Vercel URL')] === 'https://crushlanding.wiki/', 'Sucker URL not invented');

var refresh = sandbox.refreshTodayActionsFromCandidateDecisions_(spreadsheet);
assert(refresh.ok, 'refresh succeeds after reconcile');
var actionRows = spreadsheet.getSheetByName('今日行动').rows.slice(2).filter(function (candidate) {
  return String(candidate[actionHeaders.indexOf('Steam App ID')] || '').trim();
});
function find(appId) {
  return actionRows.find(function (candidate) {
    return candidate[actionHeaders.indexOf('Steam App ID')] === appId;
  });
}
assert(!find('4356430'), 'NBA 2K27 disappears from 今日行动');
assert(!find('3219630'), 'Halloween: The Game disappears from 今日行动');
assert(!find('3848900'), 'Sucker disappears after backfill');
assert(!find('5000001'), 'unbuilt BUILD stays out of 今日行动');
assert(find('2445260') && find('2445260')[actionHeaders.indexOf('行动类型')] === 'WATCH_WAITING', 'Tyr stays WATCH');

var halloweenDecision = spreadsheet.getSheetByName('候选决策').rows.find(function (candidate) {
  return String(candidate[decisionHeaders.indexOf('Steam App ID')]) === '3219630';
});
assert(halloweenDecision[decisionHeaders.indexOf('Next Action')] === 'None', 'Halloween Next Action closed');
assert(halloweenDecision[decisionHeaders.indexOf('Decision')] === 'BUILD', 'Decision remains BUILD');

console.log('PASS scripts/test-build-site-creation-complete.js');
