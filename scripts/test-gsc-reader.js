/** Phase 4.4 Step 1.1 GSC 独立数据源与站点匹配测试。 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
function assert(value, message) { if (!value) throw new Error(message); }

var sourceId = '15GJGvPnJlXTSbO4aM_Yxvf0GxCgXrmZr0M5b9uZGIJU';
var headers = [
  'RunDate', 'LatestGSCDataDate', 'Site', 'PropertyURL', 'Day', 'SitemapURLCount', 'IndexedURLCount', 'IndexRate',
  'Impressions', 'Clicks', 'CTR', 'AveragePosition', 'ReturnedQueryCount', 'FirstImpressionDate', 'TopQueries',
  'TopPages', 'NewQueries', 'Status', 'Error'
];
function row(runDate, latestDate, site, property, impressions, clicks, ctr, position) {
  return [runDate, latestDate, site, property, '', 1, 1, 1, impressions, clicks, ctr, position, 1, '', '', '', '', 'OK', ''];
}

var sourceRows = [
  row('2026-08-15', '2026-08-12', 'Mortal Shell II', 'https://mortal-shell-ii.vercel.app/', 20, 3, 0.15, 7.2),
  row('2026-08-16', '2026-08-11', 'Mortal Shell II', 'https://mortal-shell-ii.vercel.app/', 99, 9, 0.09, 3.1)
];
var writeAttempts = 0;
var sourceSheet = {
  getDataRange: function () {
    return {getValues: function () { return [headers].concat(sourceRows); }};
  },
  setValue: function () { writeAttempts++; }
};
var openedId = '';
var sandbox = {
  SpreadsheetApp: {
    openById: function (id) { openedId = id; return {getSheetByName: function (name) {
      return name === '每日快照' ? sourceSheet : null;
    }}; },
    getActiveSpreadsheet: function () { throw new Error('GSC reader must not use active Spreadsheet'); }
  },
  console: console
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

assert(src.indexOf("GSC_SOURCE_SPREADSHEET_ID: '" + sourceId + "'") >= 0, 'fixed GSC Spreadsheet ID');
assert(src.indexOf("GSC_SOURCE_SHEET_NAME: '每日快照'") >= 0, 'fixed GSC source sheet name');
var readerStart = src.indexOf('function loadGscSnapshot(');
var readerEnd = src.indexOf('\nfunction debugRealGscReadAcceptance', readerStart);
var readerSource = src.slice(readerStart, readerEnd);
assert(readerSource.indexOf('SpreadsheetApp.openById') >= 0, 'reader uses openById');
assert(readerSource.indexOf('getActiveSpreadsheet') < 0, 'reader does not use active Spreadsheet');
assert(!/\.setValue|\.setValues|\.clear|\.appendRow|\.insertRow|\.deleteRow|\.setNumberFormat|\.setDataValidation|sheet\.sort\(/.test(readerSource), 'reader has no GSC write or formatting operation');

var binding = {
  siteId: 'mortal-shell-ii',
  '游戏名称': 'Mortal Shell II',
  '网站URL': 'https://mortal-shell-ii.vercel.app',
  'GSC Property': 'https://mortal-shell-ii.vercel.app/'
};
var latest = sandbox.loadGscSnapshot(binding);
assert(openedId === sourceId, 'reader opened the configured GSC Spreadsheet');
assert(latest.status === 'ok', 'property match returns ok');
assert(latest.clicks === 3 && latest.impressions === 20 && latest.ctr === 0.15 && latest.averagePosition === 7.2, 'property URL match and latest data selection');
assert(latest.lastSync === '2026-08-12' && latest.runDate === '2026-08-15', 'LatestGSCDataDate takes priority over RunDate');

sourceRows[0] = row('2026-08-18', '2026-08-12', 'Mortal Shell II', 'https://mortal-shell-ii.vercel.app/', 21, 4, 0.19, 6.8);
sourceRows[1] = row('2026-08-19', '2026-08-12', 'Mortal Shell II', 'https://mortal-shell-ii.vercel.app/', 22, 5, 0.22, 6.1);
var tie = sandbox.loadGscSnapshot(binding);
assert(tie.clicks === 5 && tie.runDate === '2026-08-19', 'same LatestGSCDataDate uses newest RunDate');

var byName = sandbox.loadGscSnapshot({siteId: 'name-only', '游戏名称': 'Mortal Shell II'});
assert(byName.status === 'ok' && byName.clicks === 5, 'game name exact fallback');

var noMatch = sandbox.loadGscSnapshot({siteId: 'missing-site', '游戏名称': 'Unknown Game'});
assert(noMatch.status === 'no_match' && noMatch.clicks === 0 && noMatch.impressions === 0, 'no match is distinct from valid zero data');

sourceRows.splice(0, sourceRows.length, row('2026-08-20', '2026-08-20', 'Zero Game', 'https://zero.example/', 0, 0, 0, 0));
var zero = sandbox.loadGscSnapshot({siteId: 'zero-site', '网站URL': 'https://zero.example'});
assert(zero.status === 'valid_zero' && zero.lastSync === '2026-08-20', 'matched zero metrics remain valid data');
assert(writeAttempts === 0, 'GSC source was never written');

console.log('PASS scripts/test-gsc-reader.js (fixed source, URL/name match, latest row, no-match, valid-zero, read-only)');
