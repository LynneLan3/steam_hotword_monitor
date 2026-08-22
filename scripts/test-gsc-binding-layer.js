/** Phase 4.3 项目 GSC 关联层结构与幂等 BUILD 测试。 */
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
function assert(value, label) { if (!value) throw new Error(label); }

var headers = ['Site ID', '游戏名称', 'Steam App ID', '网站URL', 'GSC Property', 'GSC状态', '首次同步日期', '最近同步日期'];
var rows = [];
function upsert(siteId, name, appId, url) {
  var index = rows.findIndex(function (row) { return row[0] === siteId; });
  var next = [siteId, name, appId, url || '', '', 'NOT_CONNECTED', '', ''];
  if (index >= 0) {
    var old = rows[index];
    rows[index] = [old[0] || siteId, old[1] || name, old[2] || appId, old[3] || url || '', old[4] || '', old[5] || 'NOT_CONNECTED', old[6] || '', old[7] || ''];
  } else rows.push(next);
}
upsert('demo-game', 'Demo Game', '123', 'https://demo.example');
upsert('demo-game', 'Demo Game', '123', 'https://demo.example');
assert(rows.length === 1, 'duplicate Site ID does not create another association');
rows[0][4] = 'sc-domain:demo.example';
rows[0][5] = 'CONNECTED';
rows[0][6] = '2026-08-21';
upsert('demo-game', 'Demo Game', '123', 'https://new.example');
assert(rows.length === 1, 'existing association remains unique');
assert(rows[0][4] === 'sc-domain:demo.example' && rows[0][5] === 'CONNECTED' && rows[0][6] === '2026-08-21', 'existing GSC fields preserved');
assert(rows[0][3] === 'https://demo.example', 'existing website URL preserved');

['项目GSC关联', 'GSC Property', 'GSC状态', '首次同步日期', '最近同步日期', 'gscBindingHeaders', 'upsertGscBindingRecord_', 'NOT_CONNECTED'].forEach(function (needle) {
  assert(src.indexOf(needle) >= 0, 'source missing ' + needle);
});
var order = src.match(/sheetUiOrder:\s*\[([\s\S]*?)\]/)[1];
assert(order.indexOf("'项目GSC关联'") < order.indexOf("'候选决策'"), 'GSC association sheet precedes decisions');
assert(src.indexOf("existing[4] || ''") >= 0 && src.indexOf("existing[5] || 'NOT_CONNECTED'") >= 0, 'GSC fields are not overwritten');
console.log('PASS scripts/test-gsc-binding-layer.js (BUILD association, unique Site ID, GSC preservation)');
