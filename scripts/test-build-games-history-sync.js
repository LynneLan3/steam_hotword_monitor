/**
 * 建站关键词规划 Build → 历史游戏库同步 / 1337 占位 / 去重顺序 本地测试。
 * 运行：node scripts/test-build-games-history-sync.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var srcPath = path.join(__dirname, '..', 'SteamCandidateScanner.js');
var src = fs.readFileSync(srcPath, 'utf8');

var sandbox = {
  SpreadsheetApp: {},
  LockService: {},
  PropertiesService: {},
  UrlFetchApp: {},
  Utilities: { formatDate: function () { return ''; }, sleep: function () {} },
  ScriptApp: {},
  Logger: { log: function () {} },
  console: console,
  Math: Math,
  Date: Date,
  Number: Number,
  String: String,
  Object: Object,
  Array: Array,
  JSON: JSON,
  Map: Map,
  Set: Set,
  isFinite: isFinite,
  isNaN: isNaN,
  parseInt: parseInt,
  parseFloat: parseFloat,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ' | expected=' + expected + ' actual=' + actual);
  }
}

function findByName(rows, name) {
  var key = sandbox.normalizeGameName_(name);
  for (var i = 0; i < rows.length; i++) {
    if (sandbox.normalizeGameName_(rows[i].name) === key) return rows[i];
  }
  return null;
}

function countByName(rows, name) {
  var key = sandbox.normalizeGameName_(name);
  var n = 0;
  rows.forEach(function (row) {
    if (sandbox.normalizeGameName_(row.name) === key) n += 1;
  });
  return n;
}

function simulateScanRound_(planValues, historyRows, discovered) {
  var parsed = sandbox.parseKeywordPlanValues_(planValues);
  var sync = sandbox.applyBuildGamesHistorySync_(
    historyRows,
    parsed.buildGames,
    parsed.games
  );
  var keys = sandbox.buildHistoryKeysFromRows_(sync.rows);
  var active = [];
  var historyExcludedCount = 0;
  (discovered || []).forEach(function (item) {
    if (sandbox.isInHistoryIndex_(item, keys)) {
      historyExcludedCount += 1;
      return;
    }
    active.push(item);
  });
  var actions = active.filter(function (rec) {
    return rec.continueNext === '是';
  });
  return {
    parsed: parsed,
    sync: sync,
    keys: keys,
    historyExcludedCount: historyExcludedCount,
    active: active,
    actions: actions
  };
}

var PLAN_HEADERS = ['目标游戏', '关联AppID', '动作', 'Steam URL'];

var AGENT64 = 'Agent 64: Spies Never Die';
var AGEFIELD = 'Agefield High: Rock the School';
var MORTAL = 'Mortal Shell II';
var WATCH_ONLY = 'Only Watch Game';

var planWithBuilds = [
  PLAN_HEADERS,
  [AGEFIELD, '3562580', 'Build', ''],
  [MORTAL, '2584270', 'Build', ''],
  [AGENT64, '1574480', 'Build', ''],
  ['', '', 'Build', ''],
  [WATCH_ONLY, '999001', 'Watch', '']
];

// --------------------------------------------------------------------------
// 占位 ID 不能再用于去重
// --------------------------------------------------------------------------
(function testPlaceholderNotReliable() {
  assert(sandbox.isReliableSteamAppId_('1574480') === true, 'real app id');
  assert(sandbox.isReliableSteamAppId_('1337') === false, '1337 not reliable');
  assert(sandbox.isReliableSteamAppId_(1337) === false, 'numeric 1337 not reliable');
  assert(sandbox.isReliableSteamUrl_('1337') === false, 'url 1337 not reliable');
  assert(sandbox.isReliableSteamUrl_('https://store.steampowered.com/app/1574480/') === true, 'real url');
  assert(sandbox.isReliableSteamUrl_('https://store.steampowered.com/app/1337/') === false, 'url with 1337 app');

  var keys = sandbox.buildHistoryKeysFromRows_([
    ['1337', AGEFIELD, '1337', 'GSC监控', '人工']
  ]);
  assert(keys.byAppId.has('1337') === false, '1337 must not enter byAppId');
  assert(keys.byName.has(sandbox.normalizeGameName_(AGEFIELD)) === true, 'name fallback still works');
  console.log('PASS: 1337 不作为可靠 App ID');
})();

// --------------------------------------------------------------------------
// Case A：Agent 64 有 Build、历史库没有 → 同步后进入历史排除，不进今日行动
// --------------------------------------------------------------------------
(function testCaseA() {
  var discovered = [
    {
      appId: '1574480',
      name: AGENT64,
      continueNext: '是',
      firstRoundType: '🔥 趋势候选'
    },
    {
      appId: '555000',
      name: 'Fresh Candidate',
      continueNext: '是',
      firstRoundType: '🌱 Early候选'
    }
  ];

  var round = simulateScanRound_(planWithBuilds, [], discovered);
  var agent = findByName(round.sync.rows, AGENT64);

  assert(agent, 'Agent 64 inserted into history');
  assertEqual(agent.appId, '1574480', 'Agent 64 AppID');
  assertEqual(agent.stage, '已进入建站', 'Agent 64 stage');
  assertEqual(agent.note, '由建站关键词规划自动同步', 'Agent 64 note');
  assertEqual(agent.url, '', 'Agent 64 url left empty when unknown');
  assert(round.keys.byAppId.has('1574480'), 'Agent 64 app id in history keys');
  assertEqual(round.historyExcludedCount, 1, 'Agent 64 counted as 历史排除');
  assertEqual(round.active.length, 1, 'only fresh candidate remains active');
  assertEqual(round.active[0].name, 'Fresh Candidate', 'fresh candidate not excluded');
  assert(
    round.actions.every(function (a) { return a.name !== AGENT64; }),
    'Agent 64 must not enter 今日行动'
  );
  assertEqual(countByName(round.sync.rows, WATCH_ONLY), 0, 'mixed Watch game not inserted');
  console.log('PASS Case A: Agent 64 同步后被历史排除，不进今日行动');
})();

// --------------------------------------------------------------------------
// Case B：已有历史游戏 AppID=1337，不重复插入，补真实 ID，GSC监控不降级
// --------------------------------------------------------------------------
(function testCaseB() {
  var history = [
    {
      rowNumber: 2,
      appId: '1337',
      name: AGEFIELD,
      url: '1337',
      stage: 'GSC监控',
      note: '人工备注-Agefield'
    },
    {
      rowNumber: 3,
      appId: '1337',
      name: MORTAL,
      url: '1337',
      stage: 'GSC监控',
      note: '人工备注-MS2'
    }
  ];

  var round = simulateScanRound_(planWithBuilds, history, [
    { appId: '3562580', name: AGEFIELD, continueNext: '是' },
    { appId: '2584270', name: MORTAL, continueNext: '是' }
  ]);

  assertEqual(countByName(round.sync.rows, AGEFIELD), 1, 'Agefield no duplicate');
  assertEqual(countByName(round.sync.rows, MORTAL), 1, 'Mortal Shell II no duplicate');

  var agefield = findByName(round.sync.rows, AGEFIELD);
  var mortal = findByName(round.sync.rows, MORTAL);

  assertEqual(agefield.appId, '3562580', 'Agefield real AppID');
  assertEqual(mortal.appId, '2584270', 'Mortal Shell II real AppID');
  assertEqual(agefield.stage, 'GSC监控', 'Agefield stage not downgraded');
  assertEqual(mortal.stage, 'GSC监控', 'Mortal Shell II stage not downgraded');
  assertEqual(agefield.note, '人工备注-Agefield', 'Agefield note preserved');
  assertEqual(mortal.note, '人工备注-MS2', 'Mortal Shell II note preserved');
  assert(agefield.url !== '1337', 'Agefield placeholder URL cleared');
  assert(mortal.url !== '1337', 'Mortal Shell II placeholder URL cleared');
  assertEqual(round.historyExcludedCount, 2, 'both existing games excluded');
  console.log('PASS Case B: 1337 补真实 AppID，不重复，GSC监控不降级');
})();

// --------------------------------------------------------------------------
// Case C：全部 Watch 的游戏不自动进入历史库
// --------------------------------------------------------------------------
(function testCaseC() {
  var plan = [
    PLAN_HEADERS,
    [WATCH_ONLY, '999001', 'Watch', ''],
    ['', '', 'Watch', '']
  ];
  var round = simulateScanRound_(plan, [], [
    { appId: '999001', name: WATCH_ONLY, continueNext: '是' }
  ]);

  assertEqual(round.parsed.buildGames.length, 0, 'no Build games');
  assertEqual(round.sync.rows.length, 0, 'Watch-only not inserted');
  assertEqual(round.historyExcludedCount, 0, 'Watch-only not historically excluded');
  assertEqual(round.active.length, 1, 'Watch-only can still be a new candidate');
  console.log('PASS Case C: 只有 Watch 不进入历史库');
})();

// --------------------------------------------------------------------------
// Case D：连续同步两次，行数不增长，Agent 64 只有一行
// --------------------------------------------------------------------------
(function testCaseD() {
  var first = sandbox.applyBuildGamesHistorySync_(
    [],
    sandbox.parseKeywordPlanValues_(planWithBuilds).buildGames,
    sandbox.parseKeywordPlanValues_(planWithBuilds).games
  );
  var second = sandbox.applyBuildGamesHistorySync_(
    first.rows,
    sandbox.parseKeywordPlanValues_(planWithBuilds).buildGames,
    sandbox.parseKeywordPlanValues_(planWithBuilds).games
  );

  assertEqual(first.rows.length, second.rows.length, 'row count stable');
  assertEqual(countByName(second.rows, AGENT64), 1, 'Agent 64 only one row');
  assertEqual(countByName(second.rows, AGEFIELD), 1, 'Agefield only one row');
  assertEqual(countByName(second.rows, MORTAL), 1, 'Mortal Shell II only one row');
  assertEqual(second.inserted, 0, 'second sync inserts nothing');
  console.log('PASS Case D: 同步幂等，Agent 64 只有一行');
})();

// --------------------------------------------------------------------------
// 无法从规划表确认的 1337 占位 → App ID / URL 留空，仍靠名称兜底
// --------------------------------------------------------------------------
(function testUnknownPlaceholderCleared() {
  var history = [
    {
      rowNumber: 2,
      appId: '1337',
      name: 'Unknown Old Game',
      url: '1337',
      stage: 'GSC监控',
      note: '保留备注'
    }
  ];
  var parsed = sandbox.parseKeywordPlanValues_(planWithBuilds);
  var sync = sandbox.applyBuildGamesHistorySync_(
    history,
    parsed.buildGames,
    parsed.games
  );
  var row = findByName(sync.rows, 'Unknown Old Game');
  assert(row, 'unknown game remains in history');
  assertEqual(row.appId, '', 'unconfirmed 1337 AppID cleared');
  assertEqual(row.url, '', 'unconfirmed 1337 URL cleared');
  assertEqual(row.stage, 'GSC监控', 'unknown game stage kept');
  assertEqual(row.note, '保留备注', 'unknown game note kept');
  var keys = sandbox.buildHistoryKeysFromRows_(sync.rows);
  assert(keys.byAppId.has('1337') === false, 'cleared placeholder not in byAppId');
  assert(keys.byName.has(sandbox.normalizeGameName_('Unknown Old Game')), 'name fallback remains');
  console.log('PASS: 无法确认的 1337 留空，名称兜底仍有效');
})();

// --------------------------------------------------------------------------
// 顺序：必须先 sync 再 load keys，否则本轮排除不到刚同步的游戏
// --------------------------------------------------------------------------
(function testSyncBeforeKeys() {
  assert(
    /syncBuildGamesToHistory_\(ss\)[\s\S]*buildHistoryIndex_\(ss\)[\s\S]*discoverSteamCandidates_/.test(src),
    'daily order must be sync → loadHistory → discovery'
  );
  assert(
    /const historyIndex = buildHistoryIndex_\(ss\)[\s\S]*discoverSteamCandidates_/.test(src),
    'history keys loaded before discovery'
  );
  assert(
    /isInHistoryIndex_\(item, historyIndex\)/.test(src),
    'exclusion uses synced history index'
  );
  console.log('PASS: 每日运行顺序 sync → history keys → discovery → 排除');
})();

// --------------------------------------------------------------------------
// 不删除候选主表；不改 1A/1B 规则函数
// --------------------------------------------------------------------------
(function testNoScopeCreep() {
  assert(/function classify1A_/.test(src), 'classify1A_ kept');
  assert(/function classify1BRaw_/.test(src), 'classify1BRaw_ kept');
  assert(!/deleteRow|clearContents\(\).*master|候选主表.*删除/.test(src), 'no master-table wipe helper');
  console.log('PASS: 未改 1A/1B，未删除候选主表');
})();

console.log('\nAll Build→history sync tests passed.');
