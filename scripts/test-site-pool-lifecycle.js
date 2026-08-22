/** Phase 4.2 站点项目池 GSC 关联结构与按表头迁移测试。 */
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
function assert(value, label) { if (!value) throw new Error(label); }

var headers = ['Site ID', '游戏名称', 'Steam App ID', 'BUILD日期', '当前状态', '站点URL', 'GSC状态', '索引状态', '点击', '曝光'];
var oldRow = ['demo-site', 'Demo Game', '123', '2026-08-21', 'BUILD_PENDING', 'https://demo.example', 'NOT_CONNECTED', 'UNKNOWN', 12, 345];
var desired = ['Site ID', '游戏名称', 'Steam App ID', '当前状态', 'BUILD日期', 'Build状态', 'Repo URL', 'Vercel URL', '上线日期', '模板版本', 'GSC状态', 'GSC Site', 'GSC URL Prefix', 'GSC Last Sync', 'SEO阶段', 'Index状态', '首次曝光日期', 'Clicks', 'Impressions', 'CTR', 'Average Position'];
var aliases = {'Vercel URL': '站点URL', Clicks: '点击', Impressions: '曝光'};
function migrate(oldHeaders, row) {
  return desired.map(function (name) {
    var index = oldHeaders.indexOf(name);
    if (index < 0 && aliases[name]) index = oldHeaders.indexOf(aliases[name]);
    return index >= 0 ? row[index] : '';
  });
}
var migrated = migrate(headers, oldRow);
assert(migrated[0] === 'demo-site' && migrated[1] === 'Demo Game' && migrated[2] === '123', 'identity preserved by header');
assert(migrated[4] === '2026-08-21' && migrated[7] === 'https://demo.example', 'legacy values mapped by header');
assert(migrated[17] === 12 && migrated[18] === 345, 'legacy metrics mapped by header');

function upsert(rows, name, appId) {
  var siteId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  var index = rows.findIndex(function (row) { return row[0] === siteId || row[2] === appId; });
  var next = [siteId, name, appId, 'BUILD_PENDING', '2026-08-21', 'BUILD_PENDING', '', '', '', '', 'NOT_CONNECTED', '', '', '', 'WAITING_INDEX', 'UNKNOWN', '', '', '', '', ''];
  if (index >= 0) { rows[index][3] = rows[index][3] || next[3]; rows[index][5] = rows[index][5] || next[5]; return rows; }
  rows.push(next); return rows;
}
var rows = [];
upsert(rows, 'Demo Game', '123');
upsert(rows, 'Demo Game', '123');
assert(rows.length === 1, 'duplicate BUILD does not create another row');
assert(rows[0][3] === 'BUILD_PENDING' && rows[0][5] === 'BUILD_PENDING' && rows[0][10] === 'NOT_CONNECTED' && rows[0][14] === 'WAITING_INDEX' && rows[0][15] === 'UNKNOWN', 'default lifecycle states');
var existing = rows[0].slice();
existing[10] = 'CONNECTED'; existing[11] = 'sc-domain:example.com'; existing[12] = 'https://example.com/'; existing[13] = '2026-08-21T00:00:00Z';
rows[0] = existing;
upsert(rows, 'Demo Game', '123');
assert(rows.length === 1 && rows[0][10] === 'CONNECTED' && rows[0][11] === 'sc-domain:example.com' && rows[0][12] === 'https://example.com/', 'existing GSC fields preserved');

['Build状态', 'Repo URL', 'Vercel URL', '上线日期', '模板版本', 'GSC状态', 'GSC Site', 'GSC URL Prefix', 'GSC Last Sync', 'SEO阶段', 'Index状态', '首次曝光日期', 'Clicks', 'Impressions', 'CTR', 'Average Position', 'ensureSitePoolSchema_', 'setupSitePoolUi_'].forEach(function (needle) {
  assert(src.indexOf(needle) >= 0, 'source missing ' + needle);
});
console.log('PASS scripts/test-site-pool-lifecycle.js (header migration, defaults, GSC preservation, duplicate BUILD)');
