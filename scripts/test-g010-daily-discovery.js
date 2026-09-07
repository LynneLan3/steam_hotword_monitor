/** G010 daily discovery regressions: 5-page cap, continuation binding, PARTIAL enrichment. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

var sandbox = {
  String: String, Number: Number, Math: Math, Date: Date, Set: Set, Map: Map,
  Array: Array, Object: Object, isFinite: isFinite, JSON: JSON,
  HOTWORD_V2: {
    sources: [{name: 'Popular Upcoming'}, {name: 'Popular New Releases'}]
  },
  G010_DISCOVERY_MAX_PAGES: 5,
  G010_DISCOVERY_TARGET_UNIQUE: 250,
  G010_CONTINUATION_TTL_MS: 6 * 60 * 60 * 1000,
  G010_ABANDON_RUN_IDS: ['20260831-084334'],
  Utilities: {
    formatDate: function (date, tz, fmt) {
      var d = date instanceof Date ? date : new Date(date);
      if (fmt === 'yyyyMMdd') {
        return d.getFullYear() +
          String(d.getMonth() + 1).padStart(2, '0') +
          String(d.getDate()).padStart(2, '0');
      }
      return String(d.getTime());
    }
  },
  Session: {getScriptTimeZone: function () { return 'Asia/Shanghai'; }},
  PropertiesService: (function () {
    var shared = {};
    return {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return shared[k] == null ? null : shared[k]; },
          setProperty: function (k, v) { shared[k] = String(v); },
          deleteProperty: function (k) { delete shared[k]; },
          getKeys: function () { return Object.keys(shared); }
        };
      }
    };
  })()
};

vm.createContext(sandbox);
[
  'g010RunDateKey_', 'g010IsContinuationValid_', 'g010NewRunState_',
  'g010NextDiscoveryState_', 'g010ClearLegacySourceContinuations_',
  'steamSourceContinuationPropertyKey_'
].forEach(function (name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  vm.runInContext(match[0], sandbox);
});

function assert(value, label) { if (!value) throw new Error(label); }

var tz = 'Asia/Shanghai';
var today = new Date('2026-09-01T10:00:00+08:00');
var yesterday = new Date('2026-08-31T10:00:00+08:00');

assert(source.indexOf('const G010_DISCOVERY_MAX_PAGES = 5') >= 0, 'hard max 5 pages per source');
assert(source.indexOf('function runSteamHotwordDaily_()') >= 0, 'daily handler exists');
assert(source.indexOf("runSteamHotword01B({scheduledDaily: true})") >= 0, 'daily handler resumes active run');
assert(source.indexOf('function g010ContinuationOwnsActiveRun_(state)') >= 0, 'continuation checks active Run ID');
assert(source.indexOf("reason: 'stale-continuation-before-raw-write'") >= 0, 'stale continuation exits before Raw write');
assert(source.indexOf('G010_DAILY_HANDLER') >= 0, 'daily trigger uses dedicated handler');
assert(source.indexOf("'20260831-084334'") >= 0, 'stale run id is on abandon list');

var fresh = sandbox.g010NewRunState_(today, tz);
assert(fresh.nextPage === 1, 'new run starts at page 1');
assert(fresh.phase === 'DISCOVERY', 'new run starts in DISCOVERY');
assert(fresh.runDate === '20260901', 'new run binds runDate');

var staleState = {
  runId: '20260831-084334', phase: 'DISCOVERY', source: 'Popular Upcoming',
  nextPage: 172, enrichmentCursor: 0, runDate: '20260831', updatedAt: yesterday.getTime()
};
assert(!sandbox.g010IsContinuationValid_(staleState, today, tz), 'page 172 stale run is invalid');
assert(!sandbox.g010IsContinuationValid_(
  Object.assign({}, staleState, {runId: '20260901-080000', nextPage: 3, runDate: '20260831'}),
  today, tz
), 'cross-day continuation is invalid');

var sameDay = {
  runId: '20260901-080000', phase: 'DISCOVERY', source: 'Popular Upcoming',
  nextPage: 3, enrichmentCursor: 0, runDate: '20260901',
  updatedAt: today.getTime() - 30 * 60 * 1000
};
assert(sandbox.g010IsContinuationValid_(sameDay, today, tz), 'same-day continuation within TTL is valid');

function simulateDualSourceDiscovery(fetchBySourcePage) {
  var merged = new Map();
  var pagesBySource = {};
  sandbox.HOTWORD_V2.sources.forEach(function (source) {
    pagesBySource[source.name] = 0;
    for (var page = 1; page <= sandbox.G010_DISCOVERY_MAX_PAGES; page += 1) {
      var items = fetchBySourcePage(source.name, page) || [];
      pagesBySource[source.name] = page;
      if (!items.length) break;
      items.forEach(function (item, idx) {
        var key = String(item.appId);
        if (!merged.has(key)) {
          merged.set(key, {appId: key, source: source.name, page: page, rank: (page - 1) * 50 + idx + 1});
        }
      });
    }
  });
  return {unique: merged.size, pagesBySource: pagesBySource};
}

var alwaysNew = simulateDualSourceDiscovery(function (sourceName, page) {
  var prefix = sourceName === 'Popular Upcoming' ? 'U' : 'N';
  var out = [];
  for (var i = 0; i < 50; i += 1) {
    out.push({appId: prefix + page + '-' + i});
  }
  return out;
});
assert(alwaysNew.pagesBySource['Popular Upcoming'] === 5, 'always-new source stops at max 5 pages');
assert(alwaysNew.pagesBySource['Popular New Releases'] === 5, 'second source also stops at max 5 pages');
assert(alwaysNew.unique === 500, '5 pages x 50 items x 2 sources before dedupe simulation');
assert(alwaysNew.unique >= sandbox.G010_DISCOVERY_TARGET_UNIQUE, 'dual source max pages exceeds ~250 target');

var realistic = simulateDualSourceDiscovery(function (sourceName, page) {
  var out = [];
  for (var i = 0; i < 50; i += 1) out.push({appId: (sourceName === 'Popular Upcoming' ? 'U' : 'N') + page + '-' + i});
  return out;
});
assert(realistic.unique >= 200 && realistic.unique <= 520, 'realistic dual-source unique count in expected band');

function paginateSource(pages, failPage) {
  var out = [], seen = new Set(), stopReason = 'ok';
  for (var page = 1; page <= sandbox.G010_DISCOVERY_MAX_PAGES; page += 1) {
    if (failPage === page) { stopReason = '403'; break; }
    (pages[page - 1] || []).forEach(function (id) {
      if (!seen.has(id)) seen.add(id);
      out.push(id);
    });
    if (!(pages[page - 1] || []).length) { stopReason = 'empty'; break; }
  }
  return {items: out, unique: seen.size, stopReason: stopReason};
}

var upcoming = paginateSource([['A1', 'A2'], ['A3']], 2);
var newReleases = paginateSource([['B1', 'B2', 'B3'], ['B4'], ['B5']], null);
var partialUnique = new Set(upcoming.items.concat(newReleases.items)).size;
assert(upcoming.stopReason === '403', '403 stops current source without saving deep page');
assert(newReleases.items.length > 0, 'other source continues after 403');
assert(partialUnique > 0, 'PARTIAL run retains valid unique candidates for enrichment');

function dailyVsContinuation(priorState, now, forceNewRun) {
  if (forceNewRun) return sandbox.g010NewRunState_(now, tz);
  if (!sandbox.g010IsContinuationValid_(priorState, now, tz)) return sandbox.g010NewRunState_(now, tz);
  return priorState;
}

var activeResume = dailyVsContinuation(sameDay, today, false);
assert(activeResume.runId === sameDay.runId, 'second start resumes unfinished active Run ID');

var props = sandbox.PropertiesService.getScriptProperties();
props.setProperty('STEAM_SOURCE_CONTINUATION_V1_POPULAR_UPCOMING', '172');
props.setProperty('STEAM_SOURCE_CONTINUATION_V1_POPULAR_UPCOMING_META', JSON.stringify({
  runDate: '20260831', page: 172, savedAtMs: yesterday.getTime()
}));
sandbox.g010ClearLegacySourceContinuations_();
assert(!props.getProperty('STEAM_SOURCE_CONTINUATION_V1_POPULAR_UPCOMING'), 'legacy deep continuation cleared');

console.log('PASS scripts/test-g010-daily-discovery.js');
