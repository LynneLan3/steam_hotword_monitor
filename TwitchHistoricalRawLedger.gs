// Twitch Historical Raw Ledger V1 — independent from production 候选主表.
// Append-only Run Ledger + Raw Observations, plus refreshable Daily Canonical Runs.

var TWITCH_HISTORICAL_LEDGER = {
  spreadsheetName: 'Twitch Historical Raw Ledger V1',
  propertyKey: 'TWITCH_HISTORICAL_RAW_LEDGER_V1_SPREADSHEET_ID',
  schemaVersion: 'twitch_historical_raw_ledger_v1',
  jobType: 'TWITCH_HISTORICAL_RAW_LEDGER_APPEND',
  sheets: {
    runLedger: 'Run Ledger',
    raw: 'Raw Observations',
    canonical: 'Daily Canonical Runs'
  }
};

var TWITCH_RUN_LEDGER_HEADERS = [
  'Run ID', 'Run Date', 'Started At', 'Finished At', 'Run Type', 'Trigger Type',
  'Final Status', 'Discovery Completeness', 'Pages Completed', 'Rows Returned',
  'Unique Twitch IDs', 'Duplicates', 'Missing IGDB Count', 'Requested Limit',
  'Warning Summary', 'Schema Version'
];

var TWITCH_RAW_HEADERS = [
  'Observation ID', 'Observed At', 'Run ID', 'Run Date', 'Source', 'Global Rank',
  'API Page', 'Page Rank', 'Twitch Game ID', 'Name', 'IGDB ID', 'Box Art URL',
  'Raw Status', 'Schema Version'
];

var TWITCH_CANONICAL_HEADERS = [
  'Run Date', 'Canonical Run ID', 'Final Status', 'Run Type', 'Trigger Type',
  'Discovery Completeness', 'Rows Returned', 'Finished At', 'Selection Reason',
  'Schema Version'
];

function twitchEnsureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach(function (header, index) {
    if (String(actual[index] || '').trim() !== header) {
      throw new Error('Twitch ledger schema mismatch: ' + name + ' column ' + (index + 1));
    }
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function twitchEnsureHistoricalRawLedger_() {
  var config = TWITCH_HISTORICAL_LEDGER;
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty(config.propertyKey) || '').trim();
  var ledger;
  if (id) {
    ledger = SpreadsheetApp.openById(id);
  } else {
    ledger = SpreadsheetApp.create(config.spreadsheetName);
    id = ledger.getId();
    props.setProperty(config.propertyKey, id);
    var defaultSheet = ledger.getSheets()[0];
    if (defaultSheet) ledger.rename(config.spreadsheetName);
  }
  return {
    spreadsheet: ledger,
    id: id,
    url: ledger.getUrl(),
    runLedger: twitchEnsureSheet_(ledger, config.sheets.runLedger, TWITCH_RUN_LEDGER_HEADERS),
    raw: twitchEnsureSheet_(ledger, config.sheets.raw, TWITCH_RAW_HEADERS),
    canonical: twitchEnsureSheet_(ledger, config.sheets.canonical, TWITCH_CANONICAL_HEADERS)
  };
}

function twitchRefreshDailyCanonicalRuns_(sheets) {
  var ledger = sheets.runLedger;
  var canonical = sheets.canonical;
  var rows = [];
  if (ledger.getLastRow() >= 2) {
    var width = TWITCH_RUN_LEDGER_HEADERS.length;
    var values = ledger.getRange(2, 1, ledger.getLastRow() - 1, width).getValues();
    var idx = {};
    TWITCH_RUN_LEDGER_HEADERS.forEach(function (header, index) { idx[header] = index; });
    var grouped = {};
    values.forEach(function (row) {
      var date = String(row[idx['Run Date']] || '').trim();
      var runType = String(row[idx['Run Type']] || '').trim();
      if (!date || runType === 'TEST' || runType === 'BACKFILL') return;
      var complete = String(row[idx['Final Status']] || '') === 'SUCCESS'
        && String(row[idx['Discovery Completeness']] || '') === 'COMPLETE'
        && (runType === 'SCHEDULED_DAILY' || runType === 'MANUAL_PRODUCTION');
      var finished = row[idx['Finished At']] instanceof Date
        ? row[idx['Finished At']].getTime()
        : Date.parse(String(row[idx['Finished At']] || ''));
      var candidate = {row: row, complete: complete, finished: finished || 0};
      var current = grouped[date];
      if (!current || (candidate.complete && !current.complete)
        || (candidate.complete === current.complete && candidate.finished > current.finished)) {
        grouped[date] = candidate;
      }
    });
    Object.keys(grouped).sort().forEach(function (date) {
      var row = grouped[date].row;
      rows.push([
        date,
        row[idx['Run ID']],
        row[idx['Final Status']],
        row[idx['Run Type']],
        row[idx['Trigger Type']],
        row[idx['Discovery Completeness']],
        row[idx['Rows Returned']],
        row[idx['Finished At']],
        grouped[date].complete
          ? 'SUCCESS + COMPLETE + production + latest finished'
          : 'best available production run',
        'twitch_daily_canonical_v1'
      ]);
    });
  }
  if (canonical.getLastRow() > 1) {
    canonical.getRange(2, 1, canonical.getLastRow() - 1, TWITCH_CANONICAL_HEADERS.length).clearContent();
  }
  if (rows.length) {
    canonical.getRange(2, 1, rows.length, TWITCH_CANONICAL_HEADERS.length).setValues(rows);
  }
  var latestDate = rows.length ? String(rows[rows.length - 1][0] || '') : '';
  var canonicalRunId = null;
  rows.forEach(function (row) {
    if (String(row[0]) === latestDate) canonicalRunId = row[1];
  });
  return {rows: rows.length, canonicalRunId: canonicalRunId, latestDate: latestDate};
}

function twitchAppendHistoricalRawLedger_(body) {
  var sheets = twitchEnsureHistoricalRawLedger_();
  var runId = String(body && body.run_id || '').trim();
  if (!runId) return {ok: false, error: 'missing_run_id'};
  var runRow = body.run_ledger_row;
  var rawRows = body.raw_observation_rows;
  if (Object.prototype.toString.call(runRow) !== '[object Array]') {
    return {ok: false, error: 'invalid_run_ledger_row'};
  }
  if (Object.prototype.toString.call(rawRows) !== '[object Array]') {
    return {ok: false, error: 'invalid_raw_observation_rows'};
  }
  if (runRow.length !== TWITCH_RUN_LEDGER_HEADERS.length) {
    return {ok: false, error: 'run_ledger_width_mismatch'};
  }

  var runAppended = 0;
  var runDuplicates = 0;
  if (sheets.runLedger.getLastRow() >= 2) {
    var exists = sheets.runLedger.getRange(2, 1, sheets.runLedger.getLastRow() - 1, 1).getDisplayValues()
      .some(function (row) { return String(row[0] || '').trim() === runId; });
    if (exists) runDuplicates = 1;
  }
  if (!runDuplicates) {
    sheets.runLedger.getRange(sheets.runLedger.getLastRow() + 1, 1, 1, TWITCH_RUN_LEDGER_HEADERS.length)
      .setValues([runRow]);
    runAppended = 1;
  }

  var existingIds = {};
  if (sheets.raw.getLastRow() >= 2) {
    var width = Math.max(sheets.raw.getLastColumn(), TWITCH_RAW_HEADERS.length);
    var headers = sheets.raw.getRange(1, 1, 1, width).getDisplayValues()[0];
    var idCol = headers.indexOf('Observation ID');
    var runCol = headers.indexOf('Run ID');
    sheets.raw.getRange(2, 1, sheets.raw.getLastRow() - 1, width).getDisplayValues().forEach(function (row) {
      if (String(row[runCol] || '').trim() !== runId) return;
      existingIds[String(row[idCol] || '').trim()] = true;
    });
  }
  var appendRows = [];
  var rawDuplicates = 0;
  rawRows.forEach(function (row) {
    if (Object.prototype.toString.call(row) !== '[object Array]' || row.length !== TWITCH_RAW_HEADERS.length) {
      throw new Error('raw_observation_row_width_mismatch');
    }
    var observationId = String(row[0] || '').trim();
    if (!observationId || existingIds[observationId]) {
      rawDuplicates += 1;
      return;
    }
    existingIds[observationId] = true;
    appendRows.push(row);
  });
  if (appendRows.length) {
    sheets.raw.getRange(sheets.raw.getLastRow() + 1, 1, appendRows.length, TWITCH_RAW_HEADERS.length)
      .setValues(appendRows);
  }
  var canonical = twitchRefreshDailyCanonicalRuns_(sheets);
  return {
    ok: true,
    spreadsheetId: sheets.id,
    spreadsheetUrl: sheets.url,
    spreadsheetName: TWITCH_HISTORICAL_LEDGER.spreadsheetName,
    tabs: [TWITCH_HISTORICAL_LEDGER.sheets.runLedger, TWITCH_HISTORICAL_LEDGER.sheets.raw, TWITCH_HISTORICAL_LEDGER.sheets.canonical],
    runId: runId,
    runLedgerAppended: runAppended,
    runLedgerDuplicates: runDuplicates,
    rawAppended: appendRows.length,
    rawDuplicates: rawDuplicates,
    canonicalRunId: canonical.canonicalRunId,
    canonicalRows: canonical.rows
  };
}

function validateTwitchHistoricalLedgerCallback_(body) {
  if (!body || Object.prototype.toString.call(body) !== '[object Object]') {
    return {ok: false, error: 'invalid_callback_body'};
  }
  if (String(body.job_type || '').trim() !== TWITCH_HISTORICAL_LEDGER.jobType) {
    return {ok: false, error: 'unsupported_job_type'};
  }
  if (!String(body.run_id || '').trim()) return {ok: false, error: 'missing_run_id'};
  return {ok: true};
}

function handleTwitchHistoricalLedgerCallback_(body) {
  var validation = validateTwitchHistoricalLedgerCallback_(body);
  if (!validation.ok) return validation;
  try {
    return twitchAppendHistoricalRawLedger_(body);
  } catch (err) {
    return {ok: false, error: String(err && err.message || err || 'twitch_ledger_write_failed')};
  }
}
