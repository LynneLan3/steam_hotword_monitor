/** Phase 4.4 Step 2 GSC → 站点项目池同步测试。 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
function assert(value, message) { if (!value) throw new Error(message); }

function makeSheet(headers, rows) {
  var writes = 0;
  return {
    getLastRow: function () { return rows.length + 1; },
    getLastColumn: function () { return headers.length; },
    getMaxRows: function () { return 100; },
    getRange: function (row, column, numRows, numColumns) {
      return {
        getDisplayValues: function () {
          if (row === 1) return [headers.slice(column - 1, column - 1 + numColumns)];
          return rows.slice(row - 2, row - 2 + numRows).map(function (item) { return item.slice(column - 1, column - 1 + numColumns); });
        },
        getValues: function () {
          if (row === 1) return [headers.slice(column - 1, column - 1 + numColumns)];
          return rows.slice(row - 2, row - 2 + numRows).map(function (item) { return item.slice(column - 1, column - 1 + numColumns); });
        },
        setValue: function (value) {
          rows[row - 2][column - 1] = value;
          writes++;
        }
      };
    },
    getWrites: function () { return writes; }
  };
}

var poolHeaders = [
  'Site ID', '游戏名称', 'Steam App ID', '当前状态', 'BUILD日期', 'Build状态', 'Repo URL', 'Vercel URL',
  '上线日期', '模板版本', 'GSC状态', 'GSC Site', 'GSC URL Prefix', 'GSC Last Sync', 'SEO阶段', 'Index状态',
  '首次曝光日期', 'Clicks', 'Impressions', 'CTR', 'Average Position'
];
var bindingHeaders = ['Site ID', '游戏名称', 'Steam App ID', '网站URL', 'GSC Property', 'GSC状态', '首次同步日期', '最近同步日期'];
var poolRows = [['demo-site', 'Demo Game', '123', 'BUILD_PENDING', '2026-08-20', 'BUILD_PENDING', '', 'https://keep.example', '', '', 'NOT_CONNECTED', '', '', '', '', 'UNKNOWN', '', 0, 0, 0, 0]];
var bindingRows = [['demo-site', 'Demo Game', '123', '', 'sc-domain:keep.example', 'CONNECTED', '', '']];
var poolSheet = makeSheet(poolHeaders, poolRows);
var bindingSheet = makeSheet(bindingHeaders, bindingRows);
var snapshot = {siteId: 'demo-site', clicks: 0, impressions: 10, ctr: 0, averagePosition: 12, lastSync: '2026-08-22', status: 'ok'};

var sandbox = {
  HOTWORD_V2: {
    sheets: {gscBinding: '项目GSC关联'},
    sitePoolHeaders: poolHeaders,
    gscBindingHeaders: bindingHeaders,
    gscSnapshotSheet: '热词站_GSC每日监控'
  },
  SpreadsheetApp: {getActiveSpreadsheet: function () {
    return {
      getSheetByName: function (name) {
        return name === '项目GSC关联' ? bindingSheet : name === '站点项目池' ? poolSheet : null;
      }
    };
  }},
  console: console
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
sandbox.ensureSitePoolSchema_ = function () { return poolSheet; };
sandbox.loadGscSnapshot = function () { return snapshot; };

var result = sandbox.syncProjectPoolGsc();
assert(result.updated === 1, 'GSC data updates one existing project');
assert(poolRows[0][13] === '2026-08-22' && poolRows[0][17] === 0 && poolRows[0][18] === 10, 'metrics update by header name');
assert(poolRows[0][7] === 'https://keep.example' && poolRows[0][10] === 'NOT_CONNECTED' && poolRows[0][11] === '', 'project identity and URLs are preserved');
assert(poolRows[0][14] === 'INDEXING', 'zero clicks with impressions enters INDEXING');

snapshot = {siteId: 'demo-site', clicks: 2, impressions: 20, ctr: 0.1, averagePosition: 8, lastSync: '2026-08-23', status: 'ok'};
assert(sandbox.syncProjectPoolGsc().updated === 1, 'second snapshot sync is idempotent');
assert(poolRows[0][14] === 'GROWING', 'increased clicks or impressions enters GROWING');
var rowCountAfterSync = poolRows.length;
assert(rowCountAfterSync === 1, 'sync never creates duplicate project rows');

var writesBeforeEmpty = poolSheet.getWrites();
poolRows[0][17] = 100;
poolRows[0][18] = 5000;
poolRows[0][14] = 'GROWING';
snapshot = {siteId: 'demo-site', clicks: 0, impressions: 0, ctr: 0, averagePosition: 0, lastSync: '', status: 'no_match'};
var emptyResult = sandbox.syncProjectPoolGsc();
assert(emptyResult.noMatch === 1 && emptyResult.skipped === 1 && poolSheet.getWrites() === writesBeforeEmpty && poolRows[0][17] === 100 && poolRows[0][18] === 5000 && poolRows[0][14] === 'GROWING', 'no_match does not overwrite existing metrics');

snapshot = {siteId: 'demo-site', clicks: 0, impressions: 0, ctr: 0, averagePosition: 0, lastSync: '', status: 'valid_zero'};
var zeroResult = sandbox.syncProjectPoolGsc();
assert(zeroResult.validZero === 1 && poolRows[0][17] === 0 && poolRows[0][18] === 0 && poolRows[0][14] === 'WAITING_INDEX', 'valid_zero writes real zero values');

var writesBeforeSourceError = poolSheet.getWrites();
snapshot = {siteId: 'demo-site', clicks: 999, impressions: 9999, ctr: 1, averagePosition: 1, lastSync: 'bad', status: 'source_error'};
var sourceErrorResult = sandbox.syncProjectPoolGsc();
assert(sourceErrorResult.sourceError === 1 && sourceErrorResult.skipped === 1 && poolSheet.getWrites() === writesBeforeSourceError, 'source_error does not overwrite metrics');

snapshot = {siteId: 'demo-site', clicks: 999, impressions: 9999, ctr: 1, averagePosition: 1, lastSync: 'bad', status: 'ambiguous'};
var ambiguousResult = sandbox.syncProjectPoolGsc();
assert(ambiguousResult.ambiguous === 1 && ambiguousResult.skipped === 1 && poolSheet.getWrites() === writesBeforeSourceError, 'ambiguous does not overwrite metrics');

poolRows[0][14] = 'FAILED';
snapshot = {siteId: 'demo-site', clicks: 3, impressions: 30, ctr: 0.1, averagePosition: 7, lastSync: '2026-08-24', status: 'ok'};
sandbox.syncProjectPoolGsc();
assert(poolRows[0][14] === 'FAILED', 'manual FAILED SEO stage is preserved');

console.log('PASS scripts/test-gsc-sync.js (update, empty-data safety, SEO stages, idempotent sync)');
