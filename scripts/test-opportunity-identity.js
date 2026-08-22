/** Phase 7C-2 Steam Candidate Opportunity identity and decision persistence tests. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var src = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function assert(value, label) {
  if (!value) throw new Error(label);
}

function FakeSheet(headers, rows) {
  this.headers = headers.slice();
  this.rows = rows.map(function (row) { return row.slice(); });
}

FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.getRange = function (row, column, numRows, numColumns) {
  var sheet = this;
  function readCell(r, c) {
    if (r === 1) return sheet.headers[c - 1] || '';
    return sheet.rows[r - 2] && sheet.rows[r - 2][c - 1] !== undefined ? sheet.rows[r - 2][c - 1] : '';
  }
  function readValues() {
    var values = [];
    for (var r = 0; r < numRows; r++) {
      var rowValues = [];
      for (var c = 0; c < numColumns; c++) rowValues.push(readCell(row + r, column + c));
      values.push(rowValues);
    }
    return values;
  }
  function ensureRow(r) {
    while (sheet.rows.length < r - 1) sheet.rows.push([]);
    while (sheet.rows[r - 2].length < sheet.headers.length) sheet.rows[r - 2].push('');
  }
  return {
    getValues: readValues,
    getDisplayValues: function () {
      return readValues().map(function (values) {
        return values.map(function (value) { return value instanceof Date ? value.toISOString() : String(value || ''); });
      });
    },
    getValue: function () { return readCell(row, column); },
    getDisplayValue: function () {
      var value = readCell(row, column);
      return value instanceof Date ? value.toISOString() : String(value || '');
    },
    setValue: function (value) { ensureRow(row); sheet.rows[row - 2][column - 1] = value; },
    setValues: function (values) {
      values.forEach(function (valuesRow, r) {
        ensureRow(row + r);
        valuesRow.forEach(function (value, c) { sheet.rows[row + r - 2][column + c - 1] = value; });
      });
    },
    clearContent: function () {
      for (var r = 0; r < numRows; r++) {
        ensureRow(row + r);
        for (var c = 0; c < numColumns; c++) sheet.rows[row + r - 2][column + c - 1] = '';
      }
    }
  };
};

var context = {console: console};
vm.createContext(context);
vm.runInContext(src + '\nthis.__HOTWORD_V2 = HOTWORD_V2;', context);
var config = context.__HOTWORD_V2;
var decisionSheet = new FakeSheet(config.decisionHeaders, []);
var masterSheet = new FakeSheet(config.masterHeaders, []);
var ss = {getSheetByName: function (name) {
  if (name === config.sheets.decisions) return decisionSheet;
  if (name === config.sheets.master) return masterSheet;
  return null;
}};
var rules = {WATCH_RECHECK_DAYS_STRONG: 3, WATCH_RECHECK_DAYS_NORMAL: 7};
var runTime = new Date('2026-08-22T08:00:00+08:00');
var titanic = {appId: '4645360', name: 'Titanic Escape Simulator™', firstRoundType: '🔥 趋势', currentStage: '1B完成→人工第二轮', gain7d: 1000};

var expected = 'opp-titanic-escape-simulator-steam-candidate-001';
assert(context.opportunityIdFromSteamCandidate_(titanic.name, titanic.appId) === expected, 'Titanic OpportunityID');
assert(context.opportunityIdFromSteamCandidate_('Titanic Escape Simulator', titanic.appId) === expected, 'normalization is stable');
assert(context.opportunityIdFromSteamCandidate_(titanic.name, '9999999') !== expected ||
  context.opportunityIdFromSteamCandidate_('Different Steam Game', '9999999') !== expected, 'different Steam App ID candidate is distinct');
assert(expected.indexOf('2026') < 0 && expected.indexOf('001') >= 0, 'OpportunityID has no date and fixed sequence');

var first = context.syncCandidateDecisions_(ss, [titanic], runTime, rules);
assert(first.get(titanic.appId).opportunityId === expected, 'decision runtime creates Opportunity before Decision');
assert(decisionSheet.rows.length === 1, 'first candidate creates one decision row');
assert(decisionSheet.rows[0][config.decisionHeaders.indexOf('OpportunityID')] === expected, 'Candidate Decision row writes OpportunityID');

var second = context.syncCandidateDecisions_(ss, [titanic], new Date('2026-08-23T08:00:00+08:00'), rules);
assert(second.get(titanic.appId).opportunityId === expected, 'repeated candidate processing preserves OpportunityID');
assert(decisionSheet.rows.length === 1, 'repeated candidate processing does not duplicate row');

var opportunityColumn = config.decisionHeaders.indexOf('OpportunityID');
var decisionColumn = config.decisionHeaders.indexOf('Decision');
decisionSheet.rows[0][decisionColumn] = 'WATCH';
var watched = context.syncCandidateDecisions_(ss, [titanic], runTime, rules);
assert(watched.get(titanic.appId).opportunityId === expected, 'OpportunityID is independent of WATCH state');
decisionSheet.rows[0][decisionColumn] = 'BUILD';
context.syncCandidateDecisions_(ss, [titanic], runTime, rules);
assert(decisionSheet.rows[0][opportunityColumn] === expected, 'OpportunityID is independent of BUILD state');
decisionSheet.rows[0][decisionColumn] = 'REJECT';
context.syncCandidateDecisions_(ss, [titanic], runTime, rules);
assert(decisionSheet.rows[0][opportunityColumn] === expected, 'OpportunityID is independent of REJECT state');

var different = {appId: '9999999', name: 'Different Steam Game', firstRoundType: '🌱 Early', currentStage: '1B完成→人工第二轮', gain7d: 900};
context.syncCandidateDecisions_(ss, [different], runTime, rules);
assert(decisionSheet.rows.length === 2, 'different Steam App ID creates a separate candidate row');
assert(decisionSheet.rows[1][opportunityColumn] !== expected, 'different Steam App ID gets a different OpportunityID');

console.log('PASS scripts/test-opportunity-identity.js (stable identity, normalization, idempotent decision persistence, status independence)');
