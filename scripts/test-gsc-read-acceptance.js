/** Phase 4.4 Step 2.2A 真实 GSC 只读验收入口测试。 */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
function assert(value, message) { if (!value) throw new Error(message); }

var headers = ['GSC Property', '备注', '网站URL', '游戏名称', 'Site ID'];
var rows = [
  ['', '', 'https://incomplete.example', 'Incomplete', 'incomplete-site'],
  ['https://demo.example/', '', 'https://demo.example', 'Demo Game', 'demo-site']
];
var logs = [];
var sheet = {
  getLastRow: function () { return rows.length + 1; },
  getLastColumn: function () { return headers.length; },
  getRange: function (row, column, numRows, numColumns) {
    return {
      getDisplayValues: function () {
        if (row === 1) return [headers.slice(column - 1, column - 1 + numColumns)];
        return rows.slice(row - 2, row - 2 + numRows).map(function (item) { return item.slice(column - 1, column - 1 + numColumns); });
      }
    };
  }
};
var sandbox = {
  SpreadsheetApp: {getActiveSpreadsheet: function () {
    return {getSheetByName: function (name) { return name === '项目GSC关联' ? sheet : null; }};
  }},
  Logger: {log: function (message) { logs.push(String(message)); }},
  console: console
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

var debugStart = src.indexOf('function debugRealGscReadAcceptance(');
var debugEnd = src.indexOf('\nfunction calculateSeoStage', debugStart);
var debugSource = src.slice(debugStart, debugEnd);
assert(debugStart >= 0, 'debugRealGscReadAcceptance exists');
assert(debugSource.indexOf('loadGscSnapshot(binding)') >= 0, 'debug entry calls loadGscSnapshot');
assert(debugSource.indexOf('syncProjectPoolGsc') < 0, 'debug entry does not call syncProjectPoolGsc');
assert(!/\.setValue|\.setValues|\.appendRow|\.clear|\.insertRow|\.deleteRow|\.setNumberFormat|\.setDataValidation|\.sort\(/.test(debugSource), 'debug entry has no Sheet write or mutation');

var capturedBinding = null;
sandbox.loadGscSnapshot = function (binding) {
  capturedBinding = binding;
  return {
    status: 'valid_zero', siteId: binding.siteId, clicks: 0, impressions: 0, ctr: 0,
    averagePosition: 0, lastSync: '2026-08-22', matchedSite: 'Demo Game',
    matchedPropertyURL: 'https://demo.example/', runDate: '2026-08-22'
  };
};
var result = sandbox.debugRealGscReadAcceptance();
assert(capturedBinding && capturedBinding.siteId === 'demo-site', 'selects eligible Site ID by header');
assert(capturedBinding.gameName === 'Demo Game', 'passes game name by header');
assert(capturedBinding.websiteUrl === 'https://demo.example', 'passes website URL by header');
assert(capturedBinding.gscProperty === 'https://demo.example/', 'passes GSC Property by header');
assert(result.status === 'valid_zero', 'returns reader result');
assert(logs.some(function (line) { return line.indexOf('TEST_BINDING') >= 0; }), 'logs TEST_BINDING');
assert(logs.some(function (line) { return line.indexOf('GSC_RESULT') >= 0; }), 'logs GSC_RESULT');
assert(logs.indexOf('REAL_GSC_READ_ACCEPTANCE: PASS') >= 0, 'valid_zero logs PASS');

rows = [['', '', 'https://only-url.example', 'No Property', 'no-property']];
logs = [];
capturedBinding = null;
var noBindingResult = sandbox.debugRealGscReadAcceptance();
assert(noBindingResult === null && capturedBinding === null, 'no reliable binding stops without reader call');
assert(logs.indexOf('NO_ELIGIBLE_GSC_BINDING') >= 0, 'no eligible binding is explicit');

console.log('PASS scripts/test-gsc-read-acceptance.js (header selection, read-only, result logging, no eligible binding)');
