/** 历史站点项目 GSC 关联补建测试：按表头映射、保留已有字段、幂等。 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function Sheet(headers, rows) {
  this.headers = headers.slice();
  this.rows = rows.map(function (row) { return row.slice(); });
}

Sheet.prototype.getLastRow = function () { return this.rows.length + 1; };
Sheet.prototype.getLastColumn = function () { return this.headers.length; };
Sheet.prototype.getRange = function (row, column, rowCount, columnCount) {
  var self = this;
  return {
    getDisplayValues: function () {
      var values = row === 1 ? [self.headers] : self.rows.slice(row - 2, row - 2 + rowCount);
      return values.map(function (current) { return current.slice(column - 1, column - 1 + columnCount).map(String); });
    },
    getValues: function () {
      var values = row === 1 ? [self.headers] : self.rows.slice(row - 2, row - 2 + rowCount);
      return values.map(function (current) { return current.slice(column - 1, column - 1 + columnCount); });
    },
    getDisplayValue: function () {
      return row === 1 ? String(self.headers[column - 1] || '') : String(self.rows[row - 2][column - 1] || '');
    },
    setValues: function (values) {
      if (row === 1) self.headers = values[0].slice();
      else values.forEach(function (value, index) { self.rows[row - 2 + index] = value.slice(); });
    },
    setValue: function (value) { self.rows[row - 2][column - 1] = value; }
  };
};

var poolHeaders = ['游戏名称', 'Vercel URL', 'Site ID', 'Steam App ID'];
var poolRows = [
  ['Existing Game', 'https://existing.example/', 'existing-site', '100'],
  ['Twisted Tower', 'https://twisted-tower-nine.vercel.app/', 'twisted-tower', '1575990'],
  ['Twisted Tower duplicate', 'https://wrong.example/', 'twisted-tower', '1575990'],
  ['Legacy Game', '', 'legacy-site', '200']
];
var bindingHeaders = ['GSC状态', '网站URL', 'Site ID', '游戏名称', 'Steam App ID', 'GSC Property', '首次同步日期', '最近同步日期'];
var bindingRows = [['CONNECTED', 'https://existing.example/', 'existing-site', 'Existing Game', '100', 'https://existing.example/', '2026-08-01', '2026-08-22']];
var poolSheet = new Sheet(poolHeaders, poolRows);
var bindingSheet = new Sheet(bindingHeaders, bindingRows);
var spreadsheet = {
  getSheetByName: function (name) {
    return name === '站点项目池' ? poolSheet : name === '项目GSC关联' ? bindingSheet : null;
  },
  insertSheet: function () { return bindingSheet; }
};
var sandbox = {
  SpreadsheetApp: {getActiveSpreadsheet: function () { return spreadsheet; }},
  console: console
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

var first = sandbox.backfillProjectGscBindings();
assert.strictEqual(first.created, 2, 'missing historical bindings are created once');
assert.strictEqual(first.missingWebsiteUrl, 1, 'missing Vercel URL is reported');
assert.strictEqual(bindingSheet.rows.length, 3, 'existing bindings are not duplicated');
var created = bindingSheet.rows[1];
assert.strictEqual(created[bindingHeaders.indexOf('Site ID')], 'twisted-tower', 'Site ID comes from project pool');
assert.strictEqual(created[bindingHeaders.indexOf('游戏名称')], 'Twisted Tower', 'game name comes from project pool');
assert.strictEqual(created[bindingHeaders.indexOf('Steam App ID')], '1575990', 'App ID comes from project pool');
assert.strictEqual(created[bindingHeaders.indexOf('网站URL')], 'https://twisted-tower-nine.vercel.app/', 'URL comes from Vercel URL');
assert.strictEqual(created[bindingHeaders.indexOf('GSC Property')], '', 'GSC Property defaults empty');
assert.strictEqual(created[bindingHeaders.indexOf('GSC状态')], 'NOT_CONNECTED', 'GSC status defaults NOT_CONNECTED');
assert.strictEqual(created[bindingHeaders.indexOf('首次同步日期')], '', 'first sync date defaults empty');
assert.strictEqual(created[bindingHeaders.indexOf('最近同步日期')], '', 'last sync date defaults empty');
var missingUrl = bindingSheet.rows[2];
assert.strictEqual(missingUrl[bindingHeaders.indexOf('Site ID')], 'legacy-site', 'missing URL project is still created');
assert.strictEqual(missingUrl[bindingHeaders.indexOf('网站URL')], '', 'missing URL remains empty without guessing');
assert.strictEqual(missingUrl[bindingHeaders.indexOf('GSC状态')], 'NOT_CONNECTED', 'missing URL uses safe default status');

bindingSheet.rows[0][bindingHeaders.indexOf('GSC Property')] = 'sc-domain:existing.example';
bindingSheet.rows[0][bindingHeaders.indexOf('GSC状态')] = 'CONNECTED';
bindingSheet.rows[0][bindingHeaders.indexOf('首次同步日期')] = '2026-08-01';
var second = sandbox.backfillProjectGscBindings();
assert.strictEqual(second.created, 0, 'repeated backfill is idempotent');
assert.strictEqual(second.missingWebsiteUrl, 1, 'missing URL remains visible on repeated backfill');
assert.strictEqual(bindingSheet.rows.length, 3, 'Site ID remains unique after repeated backfill');
assert.strictEqual(bindingSheet.rows[0][bindingHeaders.indexOf('GSC Property')], 'sc-domain:existing.example', 'existing Property is preserved');
assert.strictEqual(bindingSheet.rows[0][bindingHeaders.indexOf('GSC状态')], 'CONNECTED', 'existing status is preserved');
assert.strictEqual(bindingSheet.rows[0][bindingHeaders.indexOf('首次同步日期')], '2026-08-01', 'existing sync date is preserved');

console.log('PASS scripts/test-gsc-binding-backfill.js (header mapping, missing binding backfill, preservation, idempotency)');
