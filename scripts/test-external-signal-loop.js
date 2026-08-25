/** Candidate External Signal Loop v1 deterministic acceptance fixtures. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function assert(value, label) {
  if (!value) throw new Error(label);
}

function FakeSheet(headers, rows, name) {
  this.name = name || '';
  this.headers = headers.slice();
  this.rows = rows.map(function (row) { return row.slice(); });
}

FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getLastRow = function () { return this.rows.length + 1; };
FakeSheet.prototype.getLastColumn = function () { return this.headers.length; };
FakeSheet.prototype.setFrozenRows = function () { return this; };
FakeSheet.prototype.getRange = function (row, column, numRows, numColumns) {
  var sheet = this;
  function readCell(r, c) {
    if (r === 1) return sheet.headers[c - 1] || '';
    return sheet.rows[r - 2] && sheet.rows[r - 2][c - 1] !== undefined ? sheet.rows[r - 2][c - 1] : '';
  }
  function readValues() {
    var values = [];
    for (var r = 0; r < numRows; r += 1) {
      var rowValues = [];
      for (var c = 0; c < numColumns; c += 1) rowValues.push(readCell(row + r, column + c));
      values.push(rowValues);
    }
    return values;
  }
  function ensureRow(r, c) {
    if (r === 1) {
      while (sheet.headers.length < c) sheet.headers.push('');
      return;
    }
    while (sheet.rows.length < r - 1) sheet.rows.push([]);
    while (sheet.rows[r - 2].length < Math.max(sheet.headers.length, c)) sheet.rows[r - 2].push('');
  }
  var chain = function () { return this; };
  return {
    getValues: readValues,
    getDisplayValues: function () {
      return readValues().map(function (values) {
        return values.map(function (value) {
          return value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value);
        });
      });
    },
    getValue: function () { return readCell(row, column); },
    getDisplayValue: function () {
      var value = readCell(row, column);
      return value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value);
    },
    setValue: function (value) {
      ensureRow(row, column);
      if (row === 1) sheet.headers[column - 1] = value;
      else sheet.rows[row - 2][column - 1] = value;
      return this;
    },
    setValues: function (values) {
      values.forEach(function (valuesRow, r) {
        valuesRow.forEach(function (value, c) {
          ensureRow(row + r, column + c);
          if (row + r === 1) sheet.headers[column + c - 1] = value;
          else sheet.rows[row + r - 2][column + c - 1] = value;
        });
      });
      return this;
    },
    appendRow: function (values) {
      sheet.rows.push(values.slice());
      return this;
    },
    setFrozenRows: chain,
    setBackground: chain,
    setFontColor: chain,
    setFontWeight: chain,
    setHorizontalAlignment: chain
  };
};

function FakeSpreadsheet(sheets) {
  this.sheets = sheets;
}
FakeSpreadsheet.prototype.getSheetByName = function (name) { return this.sheets[name] || null; };
FakeSpreadsheet.prototype.insertSheet = function (name) {
  var sheet = new FakeSheet([], [], name);
  this.sheets[name] = sheet;
  return sheet;
};
FakeSpreadsheet.prototype.getSheets = function () {
  return Object.keys(this.sheets).map(function (name) { return this.sheets[name]; });
};

var main = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var external = fs.readFileSync(path.join(__dirname, '..', 'ExternalEvidence.gs'), 'utf8');
var context = {
  console: console,
  Logger: {log: function () {}},
  SpreadsheetApp: {getActiveSpreadsheet: function () { return context.__spreadsheet; }}
};
vm.createContext(context);
vm.runInContext(main + '\n' + external + '\nthis.__HOTWORD_V2 = HOTWORD_V2;', context);
var config = context.__HOTWORD_V2;

function row(headers, values) {
  return headers.map(function (header) { return values[header] === undefined ? '' : values[header]; });
}

var masterRows = [
  row(config.masterHeaders, {
    'Steam App ID': '1001', '游戏名称': 'Strong Game', '第一轮类型': '🔥 趋势候选', '第一轮优先级': 'P1 高',
    '当前筛选阶段': '1B完成→人工第二轮', 'Steam Followers': 1000, 'Steam 7d Gain': 1200
  }),
  row(config.masterHeaders, {
    'Steam App ID': '1002', '游戏名称': 'Lower Priority Game', '第一轮类型': '🌱 Early候选', '第一轮优先级': 'P3 低',
    '当前筛选阶段': '1B完成→人工第二轮', 'Steam Followers': 1000, 'Steam 7d Gain': 600
  })
];
var decisionRows = [
  row(config.decisionHeaders, {
    'Steam App ID': '1001', '游戏名称': 'Strong Game', '当前Steam阶段': '1B完成→人工第二轮',
    '研究状态': '待研究', 'Google Trends结果': '未检查', 'Decision': '', 'OpportunityID': 'opp-strong-game-001'
  }),
  row(config.decisionHeaders, {
    'Steam App ID': '1002', '游戏名称': 'Lower Priority Game', '当前Steam阶段': '1B完成→人工第二轮',
    '研究状态': '待研究', 'Google Trends结果': '未检查', 'Decision': '', 'OpportunityID': 'opp-lower-priority-game-001'
  })
];
var spreadsheet = new FakeSpreadsheet({
  '候选主表': new FakeSheet(config.masterHeaders, masterRows, '候选主表'),
  '候选决策': new FakeSheet(config.decisionHeaders, decisionRows, '候选决策'),
  '数据异常': new FakeSheet(config.anomalyHeaders, [], '数据异常')
});
context.__spreadsheet = spreadsheet;

function trends(overrides) {
  var base = {
    observedAt: '2026-08-25', evidenceType: 'GOOGLE_TRENDS', sourceMode: 'SCREENSHOT',
    appId: '1001', game: 'Strong Game', source: 'Google Trends', evidenceRef: 'shot-' + Math.random(),
    observationContext: 'Worldwide / Past 7 days / benchmark comparison',
    rawObservation: 'Google Trends comparison screenshot supports the stated values.', extractionConfidence: 'HIGH',
    searchTerm: 'Strong Game', geo: 'WORLDWIDE', window: 'PAST_7_DAYS', benchmark: 'In Stars And Time',
    candidateAvg: 60, benchmarkAvg: 50, trendDirection: 'STABLE', breakout: false,
    brandAmbiguity: 'LOW', entityMatchConfidence: 'HIGH'
  };
  Object.keys(overrides || {}).forEach(function (key) { base[key] = overrides[key]; });
  return base;
}

var first = context.recordExternalEvidence(trends({evidenceRef: 'shot-a'}), spreadsheet);
assert(first.ok && first.status === 'NORMALIZED', 'Case A evidence accepted');
var duplicate = context.recordExternalEvidence(trends({evidenceRef: 'shot-a'}), spreadsheet);
assert(duplicate.duplicate && duplicate.evidenceId === first.evidenceId, 'Case F duplicate evidence is idempotent');
var processedA = context.processExternalEvidence(spreadsheet);
assert(processedA.processed === 1, 'Case A processed');
var trendsRows = spreadsheet.sheets['Trends研究记录'].rows;
assert(trendsRows.length === 1, 'Case A one history row');
assert(Object.prototype.toString.call(trendsRows[0][22]) === '[object Date]', 'Case A RecordedAt is actual write time');
assert(trendsRows[0][config.trendsResearchHeaders ? config.trendsResearchHeaders.indexOf('TrendVerdict') : 19] === 'SEARCH_CONFIRMED', 'Case A SEARCH_CONFIRMED');
var decision = spreadsheet.sheets['候选决策'].rows[0];
assert(decision[config.decisionHeaders.indexOf('TrendVerdict')] === 'SEARCH_CONFIRMED', 'Case A summary verdict');
assert(decision[config.decisionHeaders.indexOf('Decision')] === '', 'Case A no BUILD/final decision written');
assert(decision[config.decisionHeaders.indexOf('Next Action')] === 'SERP检查', 'Case A SERP route projection');

var weak = context.recordExternalEvidence(trends({observedAt: '2026-08-26', evidenceRef: 'shot-b', candidateAvg: 0}), spreadsheet);
assert(weak.ok, 'Case B evidence accepted');
context.processExternalEvidence(spreadsheet);
assert(spreadsheet.sheets['Trends研究记录'].rows[1][19] === 'SEARCH_WEAK', 'Case B SEARCH_WEAK');
assert(spreadsheet.sheets['候选决策'].rows[0][config.decisionHeaders.indexOf('Decision')] === '', 'Case B does not reject candidate');

var override = context.recordExternalEvidence(trends({observedAt: '2026-08-27', appId: '1002', game: 'Lower Priority Game', evidenceRef: 'shot-c', candidateAvg: 80, benchmarkAvg: 50}), spreadsheet);
assert(override.ok, 'Case C evidence accepted');
context.processExternalEvidence(spreadsheet);
assert(spreadsheet.sheets['Trends研究记录'].rows[2][19] === 'TREND_OVERRIDE', 'Case C TREND_OVERRIDE');
assert(spreadsheet.sheets['Trends研究记录'].rows[2][20] === 'PROBE', 'Case C PROBE route');
assert(spreadsheet.sheets['候选决策'].rows[1][config.decisionHeaders.indexOf('Decision')] === '', 'Case C no BUILD');

var discovery = context.recordExternalEvidence(trends({observedAt: '2026-08-28', appId: '9999', game: 'External Discovery Game', evidenceRef: 'shot-d'}), spreadsheet);
assert(discovery.ok && discovery.entityResolution === 'EXTERNAL_DISCOVERY', 'Case D external discovery resolution');
context.processExternalEvidence(spreadsheet);
assert(spreadsheet.sheets['Trends研究记录'].rows[3][19] === 'EXTERNAL_DISCOVERY', 'Case D EXTERNAL_DISCOVERY');
assert(spreadsheet.sheets['Trends研究记录'].rows[3][20] === 'ENTITY_RESOLUTION_REQUIRED', 'Case D entity resolution route');
assert(spreadsheet.sheets['候选决策'].rows.length === 2, 'Case D does not create candidate row');

var ambiguous = context.recordExternalEvidence(trends({observedAt: '2026-08-29', evidenceRef: 'shot-e', brandAmbiguity: 'HIGH'}), spreadsheet);
assert(ambiguous.ok, 'Case E evidence accepted');
context.processExternalEvidence(spreadsheet);
assert(spreadsheet.sheets['Trends研究记录'].rows[4][19] === 'AMBIGUOUS', 'Case E AMBIGUOUS');
assert(spreadsheet.sheets['Trends研究记录'].rows[4][20] === 'ENTITY_VALIDATION', 'Case E entity validation route');

var missing = context.recordExternalEvidence(trends({observedAt: '2026-08-30', evidenceRef: 'shot-f', candidateAvg: null}), spreadsheet);
assert(missing.ok, 'Case G raw evidence retained');
context.processExternalEvidence(spreadsheet);
var missingRow = spreadsheet.sheets['Trends研究记录'].rows[5];
assert(missingRow[19] === 'INSUFFICIENT_DATA', 'Case G INSUFFICIENT_DATA');
assert(missingRow[12] === '', 'Case G blank RelativeStrength');

var historical = context.recordExternalEvidence(trends({observedAt: '2026-09-01', evidenceRef: 'shot-g', candidateAvg: 70}), spreadsheet);
assert(historical.ok, 'Case H later observation accepted');
context.processExternalEvidence(spreadsheet);
assert(spreadsheet.sheets['Trends研究记录'].rows.length === 7, 'Case H retains historical rows');
assert(spreadsheet.sheets['外部证据记录'].rows.length === 7, 'Case H retains all evidence rows');

var invalid = context.recordExternalEvidence({observedAt: '2026-09-02', evidenceType: 'GOOGLE_TRENDS', sourceMode: 'SCREENSHOT', game: 'Bad Row'}, spreadsheet);
assert(!invalid.ok && invalid.status === 'INVALID', 'Case I invalid evidence is recorded');
var safeProcess = context.processExternalEvidence(spreadsheet);
assert(safeProcess.ok && spreadsheet.sheets['外部证据记录'].rows.length === 8, 'Case I does not break processor');

console.log('PASS scripts/test-external-signal-loop.js (A-I verdicts, append-only history, idempotency, summary routing, invalid-row isolation)');
