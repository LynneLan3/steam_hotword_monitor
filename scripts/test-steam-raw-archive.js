/* Steam Raw monthly Drive CSV archive V1 regression tests; local only. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');

function FakeSheet(rows) {
  this.rows = rows.map(row => row.slice());
  this.deleted = 0;
}
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.getLastColumn = function () { return this.rows[0].length; };
FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
  const self = this;
  const read = () => self.rows.slice(row - 1, row - 1 + numRows).map(item => item.slice(col - 1, col - 1 + numCols));
  return {getValues: read, getDisplayValues: read};
};
FakeSheet.prototype.deleteRows = function (row, count) { this.rows.splice(row - 1, count); this.deleted += count; };

function FakeSpreadsheet(sheet) {
  this.sheet = sheet;
  this.toast = function () {};
}
FakeSpreadsheet.prototype.getSheetByName = function () { return this.sheet; };
FakeSpreadsheet.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Shanghai'; };

function makeDrive(corruptWrites) {
  const files = [];
  const folder = {
    getFilesByName: function (name) {
      const matches = files.filter(file => file.name === name);
      let index = 0;
      return {hasNext: () => index < matches.length, next: () => matches[index++]};
    },
    createFile: function (name, content) {
      const body = corruptWrites ? content + 'corrupt' : content;
      const file = {name, getBlob: () => ({getDataAsString: () => body})};
      files.push(file);
      return file;
    }
  };
  return {files, folder, app: {
    getFoldersByName: function () { let used = false; return {hasNext: () => !used, next: () => { used = true; return folder; }}; },
    createFolder: function () { return folder; }
  }};
}

function buildContext(sheet, drive) {
  const context = {
    console,
    SpreadsheetApp: {getActiveSpreadsheet: () => context.__spreadsheet},
    DriveApp: drive.app,
    ScriptApp: {getProjectTriggers: () => context.__triggers || [], newTrigger: handler => ({timeBased: () => ({everyDays: () => ({atHour: () => ({create: () => { context.__triggers.push({getHandlerFunction: () => handler}); }})})})}), deleteTrigger: trigger => { context.__triggers = context.__triggers.filter(item => item !== trigger); }},
    Utilities: {formatDate: (date, tz, format) => format === 'yyyy-MM' ? date.toISOString().slice(0, 7) : date.toISOString().slice(0, 10)}
  };
  context.__spreadsheet = new FakeSpreadsheet(sheet);
  context.__triggers = [];
  vm.runInNewContext(source, context);
  return context;
}

const headers = ['运行时间', 'Run ID', 'Steam App ID', '游戏名称', '候选来源', '来源排名', '来源页码', '原始观察状态'];
const rows = [
  headers,
  [new Date('2026-06-15T04:00:00Z'), 'run-old-1', '100', 'Old A', 'source', 1, 1, 'RAW_ONLY'],
  [new Date('2026-06-30T04:00:00Z'), 'run-old-2', '101', 'Old B', 'source', 2, 1, 'ENRICHED'],
  [new Date('2026-07-01T04:00:00Z'), 'run-recent', '200', 'Recent', 'source', 1, 1, 'RAW_ONLY']
];
const now = new Date('2026-08-30T04:00:00Z');

// A complete month before the 60-day cutoff is eligible; the next month is not.
let drive = makeDrive(false);
let context = buildContext(new FakeSheet(rows), drive);
let status = context.getSteamRawArchiveStatus_(context.__spreadsheet, now);
assert.strictEqual(status.eligibleMonths.length, 1, 'only June is eligible at the cutoff');
assert.strictEqual(status.eligibleMonths[0].month, '2026-06');
assert.strictEqual(status.eligibleMonths[0].rows, 2);
assert.strictEqual(status.months.find(item => item.month === '2026-07').eligible, false, 'July is retained');

// Successful write + read-back validation is the only path that deletes rows.
const result = context.executeSteamRawMonthlyArchive(now);
assert.strictEqual(result.results[0].fileName, 'steam_raw_2026-06.csv');
assert.strictEqual(context.__spreadsheet.sheet.getLastRow(), 2, 'only the recent row remains');
assert.strictEqual(drive.files.length, 1, 'one monthly archive file is created');
assert(drive.files[0].getBlob().getDataAsString().indexOf('run-old-1') >= 0, 'archive contains key raw row');

// A second run is idempotent: no second file and no additional deletion.
context.executeSteamRawMonthlyArchive(now);
assert.strictEqual(drive.files.length, 1, 'repeat run does not create a duplicate file');
assert.strictEqual(context.__spreadsheet.sheet.getLastRow(), 2, 'repeat run does not delete recent rows');

// A write/read-back failure leaves every Sheet row intact.
drive = makeDrive(true);
context = buildContext(new FakeSheet(rows), drive);
assert.throws(() => context.executeSteamRawMonthlyArchive(now), /archive (header|row count) mismatch/);
assert.strictEqual(context.__spreadsheet.sheet.getLastRow(), 4, 'failed archive deletes zero rows');

// Trigger setup is idempotent and removes duplicate maintenance triggers.
context = buildContext(new FakeSheet([headers]), makeDrive(false));
context.setupSteamRawArchiveMaintenance();
context.setupSteamRawArchiveMaintenance();
assert.strictEqual(context.__triggers.length, 1, 'maintenance setup keeps one trigger');

console.log('PASS Steam Raw monthly archive: cutoff, CSV validation, delete safety, idempotency, trigger uniqueness');
