/**
 * Google Trends 查询词生成本地测试。
 * 运行：node scripts/test-build-trends-query.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var srcPath = path.join(__dirname, '..', 'SteamCandidateScanner.js');
var src = fs.readFileSync(srcPath, 'utf8');

var sandbox = {
  HOTWORD_V2: {
    trendsExplore: {date: 'today 3-m', geo: ''}
  },
  console: console
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + '\n expected: ' + expected + '\n actual:   ' + actual);
  }
}

function assertIncludes(actual, needle, label) {
  if (String(actual).indexOf(needle) < 0) {
    throw new Error(label + ' | missing ' + needle + ' in ' + actual);
  }
}

function assertTrends(name, expectedQuery, expectedStatus) {
  var out = sandbox.buildTrendsQuery_(name);
  assertEqual(out.query, expectedQuery, name + ' query');
  assertEqual(out.status, expectedStatus, name + ' status');
}

assertTrends('Titanic Escape Simulator™', 'Titanic Escape Simulator', '✅ 自动');
assertTrends('Agent 64: Spies Never Die', 'Agent 64 Spies Never Die + Agent 64', '✅ 自动');
assertTrends(
  'The Lord of the Rings: War in the North™ - Legacy Edition',
  'The Lord of the Rings War in the North + War in the North + LOTR War in the North',
  '⚠️ Alias需确认'
);
assertTrends('Aliens: Fireteam Elite 2', 'Aliens Fireteam Elite 2', '⚠️ Alias需确认');
assertTrends('Pizza House Simulator🍕', 'Pizza House Simulator', '✅ 自动');
assertTrends('Soul\'s Remnant', 'Souls Remnant', '✅ 自动');

['BeastLink', 'Warhounds', 'Crimson Moon', 'ShipShaper'].forEach(function (name) {
  var out = sandbox.buildTrendsQuery_(name);
  var clean = sandbox.cleanTrendsDisplayName_(name);
  assertEqual(out.query, clean, name + ' should stay uncut');
  assertEqual(out.status, '✅ 自动', name + ' should stay auto');
});

var url = sandbox.buildGoogleTrendsExploreUrl_('Agent 64 Spies Never Die + Agent 64');
assertIncludes(url, 'q=Agent%2064%20Spies%20Never%20Die%20%2B%20Agent%2064', 'Trends URL keeps OR plus');
assertIncludes(url, 'date=today%203-m', 'Trends URL date param');

var headerBlock = src.match(/actionHeaders:\s*\[([\s\S]*?)\]\s*,\s*\n\s*\/\*\* 人工 Google Trends/);
if (!headerBlock) throw new Error('actionHeaders block missing');
['游戏名称', 'Trends 查询词', 'Trends 名称状态', 'Google Trends', 'Steam App ID'].forEach(function (h) {
  if (headerBlock[0].indexOf("'" + h + "'") < 0) throw new Error('actionHeaders missing ' + h);
});

console.log('PASS scripts/test-build-trends-query.js');
