/**
 * 玩家常用称呼发现本地测试（含真实 HTTP 检索）。
 * 运行：node scripts/test-player-alias-discovery.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var execFileSync = require('child_process').execFileSync;

var root = path.join(__dirname, '..');
var sandbox = {
  HOTWORD_V2: {
    sheets: {trendsResearch: 'Trends研究记录', action: '今日行动'},
    actionHeaders: [
      '行动类型', '优先级', '游戏名称', 'Steam App ID', '第一轮类型',
      '搜索别名', 'Google Trends链接', 'Trends结果'
    ],
    trendsExplore: {date: 'today 1-m', geo: 'US'}
  },
  HOTWORD_TRENDS_RESEARCH_HEADERS: [
    'ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game', 'OpportunityID',
    'SearchTerm', 'Geo', 'Window', 'Benchmark', 'CandidateAvg', 'BenchmarkAvg',
    'RelativeStrength', 'TrendDirection', 'Breakout', 'BrandAmbiguity',
    'EntityMatchConfidence', 'Steam1BType', 'SteamPriority', 'TrendVerdict',
    'RecommendedRoute', 'EvidenceRef', 'RecordedAt'
  ],
  QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID: 'test-sheet',
  console: console,
  Utilities: {
    formatDate: function (date, tz, fmt) {
      var d = date instanceof Date ? date : new Date(date);
      if (fmt === 'yyyy-MM-dd') {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      }
      return String(d);
    },
    DigestAlgorithm: {SHA_256: 'sha256'},
    computeDigest: function () { return [1, 2, 3, 4, 5, 6]; }
  }
};

function load(name) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), sandbox);
}

vm.createContext(sandbox);

function fetchTextSync(url) {
  try {
    return execFileSync('curl', ['-sL', '--max-time', '15', '-A',
      'Mozilla/5.0 (compatible; SteamHotwordMonitor/1.0; +player-alias-discovery-test)', url
    ], {encoding: 'utf8', maxBuffer: 10 * 1024 * 1024});
  } catch (err) {
    return '';
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

load('SteamCandidateScanner.js');
load('ExternalEvidence.gs');
load('PlayerAliasDiscovery.gs');

var REAL_CASES = [
  {name: 'Mortal Shell II', appId: '2584270', expectAlias: 'Mortal Shell 2'},
  {name: 'The Sinking City 2', appId: '2825860', expectAlias: ''},
  {name: 'Agent 64: Spies Never Die', appId: '1574480', expectAlias: ''}
];

function FakeSheet(name, headers) {
  this.name = name;
  this.headers = headers.slice();
  this.rows = [];
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.getRange = function (row, col, numRowsOrLastRow, numColsOrLastCol) {
  var self = this;
  var endRow = numRowsOrLastRow;
  var endCol = numColsOrLastCol;
  return {
    getDisplayValues: function () {
      if (row === 1) return [self.headers];
      return self.rows.slice(row - 2, endRow);
    },
    setValues: function (values) {
      values.forEach(function (valueRow) { self.rows.push(valueRow.slice()); });
    }
  };
};

function FakeSpreadsheet(sheets) {
  this.sheets = sheets;
}
FakeSpreadsheet.prototype.getSheetByName = function (name) {
  return this.sheets[name] || null;
};

function failingFetch() {
  return {text: '', httpStatus: 403, empty: true, error: 'http_403'};
}

function okFetchFactory(payloadByHost) {
  return function (url) {
    var host = String(url || '');
    var key = Object.keys(payloadByHost).find(function (part) { return host.indexOf(part) >= 0; });
    var payload = key ? payloadByHost[key] : {text: '<html>' + 'x'.repeat(600) + '</html>', httpStatus: 200};
    return {
      text: payload.text,
      httpStatus: payload.httpStatus == null ? 200 : payload.httpStatus,
      empty: !payload.text,
      error: payload.error || ''
    };
  };
}

function runUnitTests() {
  var trendsWithAlias = sandbox.buildTrendsQuery_('Mortal Shell II', 'Mortal Shell 2');
  assert(trendsWithAlias.query === 'Mortal Shell II + Mortal Shell 2', 'Trends uses official + alias');
  assert(trendsWithAlias.status === '✅ 自动', 'alias Trends stays auto');

  var trendsWithoutAlias = sandbox.buildTrendsQuery_('The Sinking City 2', '');
  assert(trendsWithoutAlias.query.indexOf('The Sinking City 2') === 0, 'empty alias keeps heuristic query');

  var headersBlock = fs.readFileSync(path.join(root, 'SteamCandidateScanner.js'), 'utf8');
  assert(headersBlock.indexOf("'搜索别名'") >= 0, 'actionHeaders includes 搜索别名');
  assert(headersBlock.indexOf("'Google Trends链接'") >= 0, 'Google Trends链接 retained');
  assert(headersBlock.indexOf("repairPlayerAliasFalseNegativesProduction") >= 0, 'doGet wires repair action');
  assert(headersBlock.indexOf("verifyPlayerAliasDiscoveryProduction") >= 0, 'doGet wires verify action');

  var row = sandbox.actionRow_({
    name: 'Mortal Shell II',
    searchAlias: 'Mortal Shell 2',
    appId: '2584270',
    priority: 'P1 高',
    firstRoundType: '🔥 趋势候选',
    followers: 1,
    gain7d: 1,
    growthRate: 0.1,
    releaseStage: '已发售',
    releaseDate: '',
    daysToRelease: 0,
    reviews: 1,
    rating: 0.9,
    currentStage: '1B完成→人工第二轮',
    url: 'https://store.steampowered.com/app/2584270/',
    firstRoundReason: 'fixture',
    todayAction: {type: 'NEW', reason: 'NEW', decision: {}}
  });
  assert(row.indexOf('Mortal Shell 2') >= 0, 'actionRow renders 搜索别名');
  assert(String(row.filter(function (cell) { return String(cell).indexOf('trends.google.com') >= 0; })).indexOf('Mortal%20Shell%202') >= 0 ||
    String(row.filter(function (cell) { return String(cell).indexOf('trends.google.com') >= 0; })).indexOf('Mortal Shell 2') >= 0,
    'Trends link includes alias term');

  assert(sandbox.playerAliasIsNumeralVariantOnly_('The Sinking City II', 'The Sinking City 2') === true, 'arabic official + roman alias rejected');
  assert(sandbox.playerAliasIsNumeralVariantOnly_('Mortal Shell 2', 'Mortal Shell II') === false, 'roman official + arabic alias kept');
  assert(sandbox.playerAliasIsWeakSubtitleOnlyAlias_('Spies Never Die', 'Agent 64: Spies Never Die') === true, 'subtitle-only alias rejected when main title is short');
  assert(sandbox.playerAliasIsSeriesOnlyAlias_('Mortal Shell', 'Mortal Shell II') === true, 'series-only alias rejected');
  assert(sandbox.playerAliasIsSeriesOnlyAlias_('Mortal Shell 2', 'Mortal Shell II') === false, 'sequel-specific alias kept');

  var trendsSheet = new FakeSheet('Trends研究记录', sandbox.HOTWORD_TRENDS_RESEARCH_HEADERS);
  var ss = new FakeSpreadsheet({'Trends研究记录': trendsSheet});
  var rec = {
    appId: '2584270',
    name: 'Mortal Shell II',
    firstRoundType: '🔥 趋势候选',
    priority: 'P1 高',
    todayAction: {type: 'NEW', decision: {}}
  };
  sandbox.writePlayerAliasResearchRecord_(ss, rec, {
    alias: 'Mortal Shell 2',
    evidence: [{source: 'reddit', title: 'Mortal Shell 2 discussion', snippet: 'steam'}],
    status: 'FOUND',
    patterns: ['Mortal Shell 2'],
    ranked: [{text: 'Mortal Shell 2', hits: 3, sources: ['reddit', 'youtube']}],
    sourceDiags: [{source: 'reddit', httpStatus: 200, empty: false, parseCount: 3, ok: true, error: ''}]
  });
  var cached = sandbox.readCachedPlayerSearchAlias_(ss, '2584270');
  assert(cached.found === true && cached.alias === 'Mortal Shell 2', 'alias cache readback');
  var duplicate = sandbox.writePlayerAliasResearchRecord_(ss, rec, {alias: 'Mortal Shell 2', evidence: [], status: 'FOUND'});
  assert(duplicate.duplicate === true, 'alias research is idempotent per app');
  assert(sandbox.readCachedPlayerSearchAlias_(ss, '999999').found === false, 'missing alias cache stays unfound');

  // Legacy false-negative: SearchTerm=(none) + patterns only must NOT be cache hit
  var noneSheet = new FakeSheet('Trends研究记录', sandbox.HOTWORD_TRENDS_RESEARCH_HEADERS);
  var noneSs = new FakeSpreadsheet({'Trends研究记录': noneSheet});
  noneSheet.rows.push(sandbox.HOTWORD_TRENDS_RESEARCH_HEADERS.map(function (name) {
    var values = {
      ResearchID: 'alias-research-legacy',
      ResearchDate: '2026-09-03',
      EvidenceID: 'alias-legacy',
      AppID: '4075620',
      Game: 'Combolands: Roguelike Citybuilder',
      SearchTerm: '(none)',
      TrendVerdict: 'ALIAS_DISCOVERY',
      EvidenceRef: 'patterns=Combolands; Combolands Roguelike Citybuilder',
      RecordedAt: '2026-09-03T01:00:00+08:00'
    };
    return values[name] === undefined ? '' : values[name];
  }));
  var noneCached = sandbox.readCachedPlayerSearchAlias_(noneSs, '4075620');
  assert(noneCached.found === false, 'SearchTerm=(none) is not a successful cache hit');
  assert(sandbox.shouldDeferPlayerAliasDiscovery_(noneSs, '4075620') === false,
    'legacy patterns-only (none) must be retried');

  var failedDiscovery = sandbox.discoverPlayerSearchAlias_(
    'Combolands: Roguelike Citybuilder', '4075620',
    'https://store.steampowered.com/app/4075620/',
    {fetchImpl: failingFetch}
  );
  assert(failedDiscovery.status === 'RETRIEVAL_FAILED', 'all-source failure is RETRIEVAL_FAILED');
  assert(!failedDiscovery.alias, 'retrieval failure has empty alias');
  assert(failedDiscovery.sourceDiags.length === 4, 'four source diags recorded');
  failedDiscovery.sourceDiags.forEach(function (diag) {
    assert(diag.ok === false, 'failed source marked not ok');
    assert(diag.httpStatus === 403 || diag.error, 'failed source has http/error');
  });

  var noEvidenceFetch = okFetchFactory({
    'reddit.com': {
      text: JSON.stringify({data: {children: [{data: {
        title: 'Unrelated steam discussion',
        selftext: 'something else',
        permalink: '/r/steam/comments/1'
      }}]}}),
      httpStatus: 200
    },
    'youtube.com': {
      text: '<html>ytInitialData' + 'y'.repeat(800) + '"title":{"runs":[{"text":"Unrelated steam news"}]},</html>',
      httpStatus: 200
    },
    'steamcommunity.com': {
      text: '<html><div class="responsive_tab">discussions</div><span class="title">General Discussion</span></html>',
      httpStatus: 200
    },
    'google.com': {text: '<html><h3>Steam Store</h3></html>', httpStatus: 200}
  });
  var noEvidence = sandbox.discoverPlayerSearchAlias_(
    'Combolands: Roguelike Citybuilder', '4075620',
    'https://store.steampowered.com/app/4075620/',
    {fetchImpl: noEvidenceFetch}
  );
  assert(noEvidence.status === 'NO_ALIAS_EVIDENCE', 'healthy sources without alias => NO_ALIAS_EVIDENCE');
  assert(noEvidence.sourceDiags.some(function (d) { return d.ok; }), 'NO_ALIAS_EVIDENCE requires some ok source');

  var evidenceSs = new FakeSpreadsheet({'Trends研究记录': new FakeSheet('Trends研究记录', sandbox.HOTWORD_TRENDS_RESEARCH_HEADERS)});
  sandbox.writePlayerAliasResearchRecord_(evidenceSs, {
    appId: '4075620',
    name: 'Combolands: Roguelike Citybuilder',
    todayAction: {type: 'NEW', decision: {}}
  }, noEvidence);
  var written = evidenceSs.sheets['Trends研究记录'].rows[0];
  var evidenceRef = String(written[sandbox.HOTWORD_TRENDS_RESEARCH_HEADERS.indexOf('EvidenceRef')] || '');
  assert(evidenceRef.indexOf('status=NO_ALIAS_EVIDENCE') >= 0, 'evidence records status');
  assert(evidenceRef.indexOf('sources=') >= 0, 'evidence records source diags');
  assert(sandbox.shouldDeferPlayerAliasDiscovery_(evidenceSs, '4075620') === true,
    'fresh NO_ALIAS_EVIDENCE can defer briefly');
  assert(sandbox.readCachedPlayerSearchAlias_(evidenceSs, '4075620').found === false,
    'NO_ALIAS_EVIDENCE is not a durable cache hit');

  var retrievalSs = new FakeSpreadsheet({'Trends研究记录': new FakeSheet('Trends研究记录', sandbox.HOTWORD_TRENDS_RESEARCH_HEADERS)});
  sandbox.writePlayerAliasResearchRecord_(retrievalSs, {
    appId: '4339280',
    name: 'ShipShaper: Falconeer Chronicles',
    todayAction: {type: 'NEW', decision: {}}
  }, failedDiscovery);
  assert(sandbox.shouldDeferPlayerAliasDiscovery_(retrievalSs, '4339280') === false,
    'RETRIEVAL_FAILED must retry next run');

  assert(sandbox.shouldRunPlayerAliasDiscovery_({
    todayAction: {type: 'WATCH_WAITING', isWaiting: true, decision: {trendsResult: '强'}}
  }) === true, 'WATCH_WAITING still runs alias discovery when uncached');
  assert(sandbox.shouldRunPlayerAliasDiscovery_({
    todayAction: {type: 'BUILD', isCompleted: true, decision: {}}
  }) === false, 'BUILD handoff skips alias discovery');

  var statusResolve = sandbox.playerAliasResolveDiscoveryStatus_('', [
    {source: 'reddit', ok: false},
    {source: 'youtube', ok: false},
    {source: 'steam_community', ok: false},
    {source: 'google', ok: false}
  ]);
  assert(statusResolve === 'RETRIEVAL_FAILED', 'resolve all-fail');
  assert(sandbox.playerAliasResolveDiscoveryStatus_('Combolands', [{ok: true}]) === 'FOUND', 'resolve found');
  assert(sandbox.playerAliasResolveDiscoveryStatus_('', [{ok: true}, {ok: false}]) === 'NO_ALIAS_EVIDENCE', 'resolve no evidence');

  console.log('PASS unit checks');
}

(async function main() {
  runUnitTests();

  var fetchImpl = fetchTextSync;

  console.log('\n=== Live alias discovery (Google / YouTube / Reddit / Steam Community) ===');
  var liveResults = [];
  for (var i = 0; i < REAL_CASES.length; i += 1) {
    var item = REAL_CASES[i];
    var discovery = sandbox.discoverPlayerSearchAlias_(item.name, item.appId,
      'https://store.steampowered.com/app/' + item.appId + '/', {fetchImpl: fetchImpl});
    liveResults.push({
      game: item.name,
      appId: item.appId,
      alias: discovery.alias,
      status: discovery.status,
      sourceHits: (discovery.ranked || []).slice(0, 3),
      snippetCount: (discovery.evidence || []).length,
      sourceDiags: discovery.sourceDiags
    });
    console.log('\n' + item.name + ' (' + item.appId + ')');
    console.log('  搜索别名: ' + (discovery.alias || '(空)'));
    console.log('  状态: ' + discovery.status + ' | 证据条数: ' + (discovery.evidence || []).length);
    if (discovery.sourceDiags && discovery.sourceDiags.length) {
      discovery.sourceDiags.forEach(function (diag) {
        console.log('  源诊断: ' + sandbox.playerAliasFormatSourceDiag_(diag));
      });
    }
    if (discovery.ranked && discovery.ranked.length) {
      discovery.ranked.slice(0, 3).forEach(function (rank) {
        console.log('  候选: ' + rank.text + ' | hits=' + rank.hits + ' | sources=' + rank.sources.join(','));
      });
    }
    var trends = sandbox.buildTrendsQuery_(item.name, discovery.alias);
    console.log('  Trends查询: ' + trends.query);
  }

  var mortal = liveResults.find(function (row) { return row.game === 'Mortal Shell II'; });
  assert(mortal && mortal.alias, 'Mortal Shell II should discover a player alias from live sources');
  assert(mortal.status === 'FOUND', 'Mortal Shell II live status FOUND');

  console.log('\nPASS scripts/test-player-alias-discovery.js');
  console.log(JSON.stringify({liveResults: liveResults}, null, 2));
})().catch(function (err) {
  console.error(err.stack || err);
  process.exit(1);
});
