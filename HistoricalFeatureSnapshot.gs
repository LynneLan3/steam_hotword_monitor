// G022: append-only, model-ready historical feature snapshots.
// This module deliberately keeps Raw Observations immutable and stores only
// fields the production run actually knew at finalization time.
var G022_HISTORICAL_SHEETS = {
  runLedger: 'Run Ledger',
  features: 'Feature Observations',
  canonical: 'Daily Canonical Runs'
};

var G022_RUN_LEDGER_HEADERS = [
  'Run ID', 'Run Date', 'Started At', 'Finished At', 'Run Type', 'Trigger Type',
  'Final Status', 'Discovery Completeness', 'Upcoming Pages', 'Upcoming Items',
  'Upcoming New AppIDs', 'Upcoming Stop Reason', 'New Releases Pages',
  'New Releases Items', 'New Releases New AppIDs', 'New Releases Stop Reason',
  'Raw Unique', 'Raw Persisted', 'Historical Raw Persisted', 'Candidate Input',
  'Enrichment Requested', 'Enrichment Complete', 'Enrichment Failed', 'Enrichment Processed', '1A Pass',
  '1A Excluded', 'Data Anomaly', 'History Insufficient', 'Trend', 'Early',
  'Comparison', 'Trend Watch', 'Early Watch', 'Low Priority',
  'Daily Candidate Count', 'Continuation Segments', 'Wall Clock Seconds',
  'Warning Summary', 'Code / Runtime Version', 'Schema Version',
  'Control Sample Requested', 'Control Sample Complete', 'Control Sample Failed'
];

var G022_FEATURE_HEADERS = [
  'Feature Observation ID', 'Observed / Finalized At', 'Run ID', 'Run Date',
  'Raw Observation ID', 'Steam App ID', '游戏名称', 'Source', 'Source Page',
  'Source Rank', 'Release Date', 'Release Date Raw', 'Release Stage',
  'Days To Release', 'Candidate Input Flag', 'Eligibility Status',
  'Eligibility Reason', 'Qualification Status', 'Qualification Rank',
  'Enrichment Status', 'Enrichment Missing Reason', 'Followers',
  'Followers Baseline', 'Followers 7d Gain', 'Follower Growth Rate',
  'Growth Coverage Days', 'Review Count', 'Positive Reviews', 'Rating',
  '1A Result', '1A Exclusion Reason', '1B Type', '1B Priority',
  'Enter Next Step', 'Next Action', 'First Round Reason', 'Data Status',
  'Data Note', 'Feature Completeness', 'Provider / Provenance', 'Schema Version',
  'Control Sample Flag', 'Control Sample Reason', 'Control Sample Group'
];

var G022_CANONICAL_HEADERS = [
  'Run Date', 'Canonical Run ID', 'Final Status', 'Run Type', 'Trigger Type',
  'Discovery Completeness', 'Raw Unique', 'Finished At', 'Selection Reason',
  'Schema Version'
];

function g022EnsureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else if (sheet.getLastColumn() < headers.length) {
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var prefixOk = existing.every(function (value, index) { return String(value || '').trim() === headers[index]; });
    if (prefixOk) sheet.getRange(1, existing.length + 1, 1, headers.length - existing.length)
      .setValues([headers.slice(existing.length)]);
  }
  var actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach(function (header, index) {
    if (String(actual[index] || '').trim() !== header) {
      throw new Error('G022 schema mismatch: ' + name + ' column ' + (index + 1));
    }
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function g022EnsureRunLedgerSheet_(ss) {
  var name = G022_HISTORICAL_SHEETS.runLedger;
  var sheet = ss.getSheetByName(name);
  if (!sheet) return g022EnsureSheet_(ss, name, G022_RUN_LEDGER_HEADERS);
  var oldHeaders = G022_RUN_LEDGER_HEADERS.slice();
  oldHeaders.splice(oldHeaders.indexOf('Enrichment Processed'), 1);
  var width = Math.max(sheet.getLastColumn(), oldHeaders.length);
  var actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var oldMatches = oldHeaders.every(function (header, index) { return String(actual[index] || '').trim() === header; });
  if (oldMatches && String(actual[oldHeaders.indexOf('Enrichment Failed') + 1] || '').trim() !== 'Enrichment Processed') {
    sheet.insertColumnBefore(oldHeaders.indexOf('1A Pass') + 1);
    sheet.getRange(1, oldHeaders.indexOf('Enrichment Failed') + 2).setValue('Enrichment Processed');
  }
  return g022EnsureSheet_(ss, name, G022_RUN_LEDGER_HEADERS);
}

function g022HistoricalSheets_(ss) {
  var raw = g010EnsureHistoricalRawLedger_();
  return {
    spreadsheet: raw.spreadsheet,
    raw: raw.sheet,
    runLedger: g022EnsureRunLedgerSheet_(raw.spreadsheet),
    features: g022EnsureSheet_(raw.spreadsheet, G022_HISTORICAL_SHEETS.features, G022_FEATURE_HEADERS),
    canonical: g022EnsureSheet_(raw.spreadsheet, G022_HISTORICAL_SHEETS.canonical, G022_CANONICAL_HEADERS)
  };
}

function g022Value_(value) {
  return value === undefined || value === '' ? null : value;
}

function g022FeatureId_(runId, appId, source) {
  return ['steam-feature', String(runId || '').trim(), String(appId || '').trim(), String(source || '').trim()].join('|');
}

function g022RawId_(runId, appId, source) {
  return g010HistoricalRawObservationId_(runId, appId, source);
}

function g022MasterIndex_(ss, runId) {
  var out = {};
  var sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  var headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var idx = function (name) { return headers.indexOf(name); };
  var runCol = idx('最近Run ID'), appCol = idx('Steam App ID');
  if (runCol < 0 || appCol < 0) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(function (row) {
    if (String(row[runCol] || '').trim() !== String(runId)) return;
    var appId = String(row[appCol] || '').trim();
    if (!appId) return;
    var item = {};
    [
      ['name', '游戏名称'], ['releaseDate', 'Steam 发布日期'], ['releaseStage', '发布阶段'],
      ['daysToRelease', '距发售天数'], ['followers', 'Steam Followers'],
      ['baselineFollowers', '7d基准Followers'], ['gain7d', 'Steam 7d Gain'],
      ['growthRate', '近似增长率'], ['coverageDays', '增速覆盖天数'],
      ['reviews', '评论数'], ['positiveReviews', '好评数'], ['rating', 'Steam评分'],
      ['result1A', '1A结果'], ['reason1A', '1A排除原因'], ['firstRoundType', '第一轮类型'],
      ['priority', '第一轮优先级'], ['continueNext', '进入下一步'], ['nextAction', 'Next Action'],
      ['firstRoundReason', '第一轮判定依据'], ['dataStatus', '数据状态'],
      ['qualificationStatus', '资格状态']
    ].forEach(function (pair) { var column = idx(pair[1]); item[pair[0]] = column >= 0 ? row[column] : null; });
    out[appId] = item;
  });
  return out;
}

function g022EligibilityIndex_(runContext, state) {
  var out = {};
  if (!runContext || !runContext.rawRecords) return out;
  var controlIds = {};
  (runContext.controls || []).forEach(function (rec) { controlIds[String(rec.appId)] = true; });
  var observedAt = state && state.runStartedAt ? new Date(state.runStartedAt) : new Date();
  runContext.rawRecords.forEach(function (rec) {
    var eligibility = evaluateQualificationEligibility_(rec, {
      previousRaw: runContext.previousRaw && runContext.previousRaw.get(rec.appId),
      qualification: runContext.qualification && runContext.qualification.get(rec.appId),
      decision: runContext.decisions && runContext.decisions.get(rec.appId),
      now: observedAt, rules: runContext.rules
    });
    if (controlIds[String(rec.appId)]) eligibility = {eligible: false, reason: 'REJECTED_RANDOM_SAMPLE'};
    out[String(rec.appId)] = eligibility || {eligible: false, reason: 'PRE_ENRICHMENT_NOT_ELIGIBLE'};
  });
  return out;
}

function g022RawIndex_(rawSheet, runId) {
  var out = {};
  if (!rawSheet || rawSheet.getLastRow() < 2) return out;
  var width = Math.max(rawSheet.getLastColumn(), 26);
  var headers = rawSheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  var index = function (name) { return headers.indexOf(name); };
  var idCol = index('Observation ID'), runCol = index('Run ID');
  if (idCol < 0 || runCol < 0) return out;
  rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, width).getValues().forEach(function (row) {
    if (String(row[runCol] || '').trim() !== String(runId)) return;
    var id = String(row[idCol] || '').trim();
    if (!id) return;
    var value = function (name) { var col = index(name); return col >= 0 ? row[col] : null; };
    out[id] = {
      observationId: id, appId: value('Steam App ID'), name: value('游戏名称'),
      source: value('Source'), sourcePage: value('Source Page'), sourceRank: value('Source Rank'),
      releaseDate: value('Release Date'), releaseRaw: value('Release Date Raw'),
      releaseStage: value('Release Stage'), daysToRelease: value('Days To Release')
    };
  });
  return out;
}

function g022FeatureRow_(rec, master, eligibility, raw, runId, runDate, finalizedAt) {
  master = master || {};
  if (rec && rec.controlSampleFlag) master = Object.assign({}, rec, master);
  eligibility = eligibility || {};
  raw = raw || {};
  var eligible = eligibility.eligible === true;
  var control = rec && rec.controlSampleFlag === true;
  var enrichmentValues = control
    ? [master.followers, master.baselineFollowers, master.gain7d, master.growthRate, master.coverageDays]
    : [master.followers, master.baselineFollowers, master.gain7d, master.growthRate, master.reviews, master.rating];
  var hasEnrichment = enrichmentValues.some(function (value) {
      return value !== null && value !== undefined && value !== '';
    });
  var enrichmentStatus = control ? (hasEnrichment ? 'COMPLETE' : 'FAILED') : (!eligible ? 'NOT_REQUESTED' : hasEnrichment ? 'COMPLETE' : 'FAILED');
  var missingReason = control ? (hasEnrichment ? null : 'CONTROL_ENRICHMENT_NOT_AVAILABLE_AT_FINALIZATION') : (!eligible ? 'PRE_ENRICHMENT_NOT_ELIGIBLE' : hasEnrichment ? null : 'ENRICHMENT_NOT_AVAILABLE_AT_FINALIZATION');
  var source = String(raw.source || rec.source || (rec.sources && rec.sources[0]) || '').trim();
  var notes = [];
  if (!eligible) notes.push('provider_not_called_before_eligibility');
  if (enrichmentStatus === 'FAILED') notes.push('eligible_but_no_provider_value');
  return [
    g022FeatureId_(runId, rec.appId, source), finalizedAt, runId, runDate,
    raw.observationId || g022RawId_(runId, rec.appId, source), String(raw.appId || rec.appId || ''), master.name || raw.name || rec.name || '',
    source, g022Value_(raw.sourcePage), g022Value_(raw.sourceRank),
    raw.releaseDate || master.releaseDate || rec.releaseDate || null, raw.releaseRaw || null,
    raw.releaseStage || master.releaseStage || rec.releaseStage || null, g022Value_(raw.daysToRelease != null ? raw.daysToRelease : (master.daysToRelease != null ? master.daysToRelease : rec.daysToRelease)),
    eligible ? 'TRUE' : 'FALSE', eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE', eligibility.reason || null,
    master.qualificationStatus || (eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE'), null,
    enrichmentStatus, missingReason, g022Value_(master.followers), g022Value_(master.baselineFollowers),
    g022Value_(master.gain7d), g022Value_(master.growthRate), g022Value_(master.coverageDays),
    g022Value_(master.reviews), g022Value_(master.positiveReviews), g022Value_(master.rating),
    master.result1A || null, master.result1A === '❌ 排除' ? (master.reason1A || master.firstRoundReason || null) : null,
    master.firstRoundType || null, master.priority || null, master.continueNext || null, master.nextAction || null,
    master.firstRoundReason || null, master.dataStatus || (enrichmentStatus === 'COMPLETE' ? 'OK' : 'INCOMPLETE'),
    notes.join('; ') || null, hasEnrichment ? 'PARTIAL_OR_COMPLETE' : 'DISCOVERY_ONLY',
    'Steam Store Search + Games Popularity where requested', 'steam_feature_observation_v1_1',
    control ? 'TRUE' : 'FALSE', control ? 'REJECTED_RANDOM_SAMPLE' : null, control ? (rec.controlSampleGroup || null) : null
  ];
}

function g022LedgerEnrichmentCounts_(featureRows) {
  var statusCol = G022_FEATURE_HEADERS.indexOf('Enrichment Status');
  var controlCol = G022_FEATURE_HEADERS.indexOf('Control Sample Flag');
  var counts = {requested: 0, complete: 0, failed: 0, processed: 0, controlRequested: 0, controlComplete: 0, controlFailed: 0};
  (featureRows || []).forEach(function (row) {
    var status = String(row[statusCol] || '');
    if (status !== 'NOT_REQUESTED') counts.requested += 1;
    if (status === 'COMPLETE') counts.complete += 1;
    if (status === 'FAILED') counts.failed += 1;
    if (status === 'COMPLETE' || status === 'FAILED' || status === 'PARTIAL') counts.processed += 1;
    if (controlCol >= 0 && String(row[controlCol] || '') === 'TRUE') {
      counts.controlRequested += 1;
      if (status === 'COMPLETE') counts.controlComplete += 1;
      if (status === 'FAILED') counts.controlFailed += 1;
    }
  });
  return counts;
}

function g022AppendFeatureObservations_(ss, state, runContext, finalizedAt) {
  var sheets = g022HistoricalSheets_(ss), sheet = sheets.features;
  var runId = String(state.runId), runDate = state.runDate || Utilities.formatDate(finalizedAt, ss.getSpreadsheetTimeZone(), 'yyyyMMdd');
  var existing = {}, width = G022_FEATURE_HEADERS.length;
  if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getDisplayValues().forEach(function (row) { existing[String(row[0] || '').trim()] = true; });
  var master = g022MasterIndex_(ss, runId), rawIndex = g022RawIndex_(sheets.raw, runId), eligibility = g022EligibilityIndex_(runContext, state), rows = [], duplicates = 0;
  var controlIds = {};
  (runContext.controls || []).forEach(function (rec) { controlIds[String(rec.appId)] = true; });
  var counts = {complete: 0, notRequested: 0, failed: 0, partial: 0};
  (runContext.rawRecords || []).forEach(function (rec) {
    var source = String(rec.source || (rec.sources && rec.sources[0]) || '').trim();
    var id = g022FeatureId_(runId, rec.appId, source);
    if (!rec.appId || !source || existing[id]) { duplicates += 1; return; }
    existing[id] = true;
    var rawId = g022RawId_(runId, rec.appId, source);
    var featureRec = controlIds[String(rec.appId)] ? Object.assign({}, rec, {controlSampleFlag: true}) : Object.assign({}, rec, {controlSampleFlag: false});
    var featureRow = g022FeatureRow_(featureRec, master[String(rec.appId)] || {}, eligibility[String(rec.appId)], rawIndex[rawId], runId, runDate, finalizedAt);
    var status = featureRow[G022_FEATURE_HEADERS.indexOf('Enrichment Status')];
    if (status === 'COMPLETE') counts.complete += 1;
    else if (status === 'NOT_REQUESTED') counts.notRequested += 1;
    else if (status === 'PARTIAL') counts.partial += 1;
    else counts.failed += 1;
    rows.push(featureRow);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  return {appended: rows.length, duplicates: duplicates, total: rows.length + duplicates, counts: counts, rows: rows, spreadsheetId: sheets.spreadsheet.getId()};
}

function g022RunType_(options) {
  if (options && options.backfill) return 'BACKFILL';
  if (options && options.test) return 'TEST';
  return options && options.scheduledDaily ? 'SCHEDULED_DAILY' : 'MANUAL_PRODUCTION';
}

function g022DiscoverySummary_(state, name) {
  var item = state.discoveryAudit && state.discoveryAudit.sources ? state.discoveryAudit.sources[name] : {};
  item = item || {};
  return [item.pagesFetched || 0, item.itemsTotal || 0, item.newAppIds || 0, item.stopReason || null];
}

function g022AppendRunLedger_(ss, state, runContext, metrics, completion, finalizedAt, options) {
  var sheets = g022HistoricalSheets_(ss), sheet = sheets.runLedger, runId = String(state.runId);
  var existing = false, width = G022_RUN_LEDGER_HEADERS.length;
  if (sheet.getLastRow() >= 2) existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().some(function (row) { return String(row[0] || '').trim() === runId; });
  if (existing) return {appended: 0, duplicates: 1, spreadsheetId: sheets.spreadsheet.getId()};
  var upcoming = g022DiscoverySummary_(state, 'Popular Upcoming');
  var releases = g022DiscoverySummary_(state, 'Popular New Releases');
  var warnings = metrics.warningSummary || (completion.issues || []).join('; ');
  var row = [runId, state.runDate || null, state.runStartedAt ? new Date(state.runStartedAt) : null, finalizedAt,
    g022RunType_(options), options && options.scheduledDaily ? 'SCHEDULED_TRIGGER' : 'MANUAL', completion.status,
    state.discoveryComplete && !completion.issues.some(function (x) { return String(x).indexOf('discovery') >= 0; }) ? 'COMPLETE' : 'PARTIAL',
    upcoming[0], upcoming[1], upcoming[2], upcoming[3], releases[0], releases[1], releases[2], releases[3],
    metrics.rawTotal || 0, metrics.rawPersisted || metrics.rawTotal || 0, state.ledgerAppended || 0,
    metrics.eligibleTotal || 0, metrics.enrichmentRequested || 0, metrics.enrichmentComplete || 0,
    metrics.enrichmentFailed || state.ledgerWriteFailures || 0, metrics.historicalEnrichmentProcessed || 0, metrics.pass1A || 0, metrics.excluded1A || 0,
    metrics.anomaly || 0, metrics.historyInsufficient || 0, metrics.trend || 0, metrics.early || 0,
    metrics.control || 0, metrics.p2Trend || 0, metrics.p2Early || 0, metrics.low || 0, metrics.candidates || 0,
    state.segmentCount || 0, metrics.elapsedSec || 0, warnings || null, 'steam_hotword_monitor@' + state.runId,
    'steam_run_ledger_v1_1', metrics.controlSampleRequested || 0,
    metrics.controlSampleComplete || 0, metrics.controlSampleFailed || 0];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, width).setValues([row]);
  return {appended: 1, duplicates: 0, spreadsheetId: sheets.spreadsheet.getId()};
}

function g022RefreshDailyCanonicalRuns_(ss) {
  var sheets = g022HistoricalSheets_(ss), ledger = sheets.runLedger, canonical = sheets.canonical;
  var rows = [];
  if (ledger.getLastRow() >= 2) {
    var width = G022_RUN_LEDGER_HEADERS.length, values = ledger.getRange(2, 1, ledger.getLastRow() - 1, width).getValues();
    var idx = {}; G022_RUN_LEDGER_HEADERS.forEach(function (h, i) { idx[h] = i; });
    var grouped = {};
    values.forEach(function (row) {
      var date = String(row[idx['Run Date']] || '').trim();
      if (!date || String(row[idx['Run Type']] || '') === 'TEST' || String(row[idx['Run Type']] || '') === 'BACKFILL') return;
      var complete = String(row[idx['Final Status']] || '') === 'SUCCESS' && String(row[idx['Discovery Completeness']] || '') === 'COMPLETE';
      var candidate = {row: row, complete: complete, finished: row[idx['Finished At']] instanceof Date ? row[idx['Finished At']].getTime() : Date.parse(String(row[idx['Finished At']] || ''))};
      var current = grouped[date];
      if (!current || (candidate.complete && !current.complete) || (candidate.complete === current.complete && candidate.finished > current.finished)) grouped[date] = candidate;
    });
    Object.keys(grouped).sort().forEach(function (date) {
      var row = grouped[date].row;
      rows.push([date, row[idx['Run ID']], row[idx['Final Status']], row[idx['Run Type']], row[idx['Trigger Type']], row[idx['Discovery Completeness']], row[idx['Raw Unique']], row[idx['Finished At']], grouped[date].complete ? 'SUCCESS + COMPLETE + production + latest finished' : 'best available production run', 'steam_daily_canonical_v1']);
    });
  }
  if (canonical.getLastRow() > 1) canonical.getRange(2, 1, canonical.getLastRow() - 1, G022_CANONICAL_HEADERS.length).clearContent();
  if (rows.length) canonical.getRange(2, 1, rows.length, G022_CANONICAL_HEADERS.length).setValues(rows);
  return {rows: rows.length};
}

function g022FinalizeHistoricalRun_(ss, state, runContext, metrics, completion, finalizedAt, options) {
  try {
    var rawIndex = g022RawIndex_(g022HistoricalSheets_(ss).raw, String(state.runId));
    var expected = {}, rawRecords = runContext && runContext.rawRecords || [];
    rawRecords.forEach(function (rec) {
      var source = String(rec.source || (rec.sources && rec.sources[0]) || '').trim();
      if (rec.appId && source) expected[g022RawId_(state.runId, rec.appId, source)] = true;
    });
    var expectedCount = Object.keys(expected).length, actualCount = Object.keys(rawIndex).length;
    if (expectedCount !== actualCount) {
      return {ok: false, error: 'HISTORICAL_RAW_MISMATCH expected=' + expectedCount + ' actual=' + actualCount,
        rawConsistency: {expected: expectedCount, actual: actualCount}};
    }
    var features = g022AppendFeatureObservations_(ss, state, runContext, finalizedAt);
    var counts = g022LedgerEnrichmentCounts_(features.rows || []);
    metrics.enrichmentRequested = counts.requested;
    metrics.enrichmentComplete = counts.complete;
    metrics.enrichmentFailed = counts.failed;
    metrics.historicalEnrichmentProcessed = counts.processed;
    metrics.controlSampleRequested = counts.controlRequested;
    metrics.controlSampleComplete = counts.controlComplete;
    metrics.controlSampleFailed = counts.controlFailed;
    var ledger = g022AppendRunLedger_(ss, state, runContext, metrics, completion, finalizedAt, options);
    g022RefreshDailyCanonicalRuns_(ss);
    return {ok: true, features: features, ledger: ledger};
  } catch (err) {
    return {ok: false, error: String(err && err.message || err || 'unknown')};
  }
}

function g022RepairRunLedgerEnrichmentStats_(runId) {
  var allowed = {'20260901-134739': true, '20260901-141358': true};
  runId = String(runId || '');
  if (!allowed[runId]) throw new Error('Run ID is not allowlisted for G022 repair: ' + runId);
  var sheets = g022HistoricalSheets_(SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID));
  var feature = sheets.features, ledger = sheets.runLedger;
  var featureHeaders = feature.getRange(1, 1, 1, feature.getLastColumn()).getDisplayValues()[0];
  var ledgerHeaders = ledger.getRange(1, 1, 1, ledger.getLastColumn()).getDisplayValues()[0];
  var runCol = featureHeaders.indexOf('Run ID'), statusCol = featureHeaders.indexOf('Enrichment Status');
  var rows = feature.getLastRow() >= 2 ? feature.getRange(2, 1, feature.getLastRow() - 1, feature.getLastColumn()).getDisplayValues() : [];
  var counts = g022LedgerEnrichmentCounts_(rows.filter(function (row) { return String(row[runCol] || '') === runId; }));
  var ledgerRows = ledger.getLastRow() >= 2 ? ledger.getRange(2, 1, ledger.getLastRow() - 1, ledger.getLastColumn()).getValues() : [];
  var ledgerRunCol = ledgerHeaders.indexOf('Run ID'), target = -1;
  ledgerRows.some(function (row, i) { if (String(row[ledgerRunCol] || '') === runId) { target = i + 2; return true; } return false; });
  if (target < 0) throw new Error('Run Ledger row not found: ' + runId);
  ['Enrichment Requested', 'Enrichment Complete', 'Enrichment Failed', 'Enrichment Processed'].forEach(function (header, i) {
    var col = ledgerHeaders.indexOf(header);
    if (col < 0) throw new Error('Run Ledger header missing: ' + header);
    ledger.getRange(target, col + 1).setValue([counts.requested, counts.complete, counts.failed, counts.processed][i]);
  });
  var schemaCol = ledgerHeaders.indexOf('Schema Version');
  if (schemaCol >= 0) ledger.getRange(target, schemaCol + 1).setValue('steam_run_ledger_v1_1');
  return {runId: runId, counts: counts, ledgerRow: target};
}

function g022BackfillVerifiedRun20260901_() {
  var ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID), runId = '20260901-132142';
  var state = {runId: runId, runDate: '20260901', runStartedAt: 0, discoveryComplete: true, discoveryAudit: {sources: {}}, segmentCount: 1, ledgerAppended: 0};
  var rawRecords = g010RawRecordsForRun_(ss, runId);
  if (!rawRecords.length) throw new Error('G022 verified run has no exact Raw Observations: ' + runId);
  var context = g010BuildRunContext_(ss, state, new Date(), ss.getSpreadsheetTimeZone());
  context.rawRecords = rawRecords;
  var metrics = g010ComputeFinalStatsFromMaster_(ss, runId);
  var completion = {status: 'SUCCESS', issues: []};
  return g022FinalizeHistoricalRun_(ss, state, context, metrics, completion, new Date(), {backfill: true});
}

function g022Readback_(runId) {
  var ss = g022HistoricalSheets_(SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID)).spreadsheet;
  var result = {spreadsheetId: ss.getId(), tabs: ss.getSheets().map(function (sheet) { return sheet.getName(); }), runId: String(runId || ''), counts: {}, samples: [], rawRunDistribution: {}, rows: {runLedger: [], canonical: []}};
  ['Raw Observations', 'Feature Observations'].forEach(function (name) {
    var sheet = ss.getSheetByName(name), count = 0, statuses = {};
    if (sheet && sheet.getLastRow() >= 2) {
      var width = sheet.getLastColumn(), headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0], runCol = headers.indexOf('Run ID'), values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getDisplayValues();
      values.forEach(function (row) {
        if (name === 'Raw Observations' && runCol >= 0) { var observedRun = String(row[runCol] || '').trim(); result.rawRunDistribution[observedRun] = (result.rawRunDistribution[observedRun] || 0) + 1; }
        var matches = runCol >= 0 && String(row[runCol] || '').trim() === String(runId).trim();
        if (!matches) return;
        count += 1;
        if (name === 'Feature Observations') {
          statuses[String(row[19] || '')] = (statuses[String(row[19] || '')] || 0) + 1;
          if (result.samples.length < 5) result.samples.push({appId: row[5], source: row[7], sourcePage: row[8], sourceRank: row[9], releaseDate: row[10], releaseDateRaw: row[11], enrichmentStatus: row[19], schemaVersion: row[41]});
        }
      });
    }
    result.counts[name] = {rows: count, statuses: statuses};
  });
  ['Run Ledger', 'Daily Canonical Runs'].forEach(function (name) {
    var sheet = ss.getSheetByName(name), targetColumn = name === 'Run Ledger' ? 0 : 1;
    if (!sheet || sheet.getLastRow() < 2) return;
    var width = sheet.getLastColumn(), values = sheet.getRange(1, 1, sheet.getLastRow(), width).getDisplayValues();
    var matches = values.filter(function (row, index) { return index > 0 && String(row[targetColumn] || '') === String(runId); });
    result.rows[name === 'Run Ledger' ? 'runLedger' : 'canonical'] = matches;
  });
  return result;
}

/** Repair Run Ledger + Daily Canonical when Raw/Feature already exist for a run. */
function g022RepairMissingRunLedgerFromExisting_(runId) {
  runId = String(runId || '').trim();
  if (!runId) throw new Error('runId is required');
  var business = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  var sheets = g022HistoricalSheets_(business);
  var ledger = sheets.runLedger;
  var features = sheets.features;
  var raw = sheets.raw;
  if (ledger.getLastRow() >= 2) {
    var existing = ledger.getRange(2, 1, ledger.getLastRow() - 1, 1).getDisplayValues()
      .some(function (row) { return String(row[0] || '').trim() === runId; });
    if (existing) {
      var refreshed = g022RefreshDailyCanonicalRuns_(business);
      return {ok: true, repaired: false, reason: 'run_ledger_already_present', runId: runId, canonicalRows: refreshed.rows};
    }
  }
  var rawCount = 0;
  var featureRows = [];
  var observedAt = null;
  if (raw.getLastRow() >= 2) {
    var rawHeaders = raw.getRange(1, 1, 1, raw.getLastColumn()).getDisplayValues()[0];
    var rawRunCol = rawHeaders.indexOf('Run ID');
    var rawObservedCol = rawHeaders.indexOf('Observed At');
    raw.getRange(2, 1, raw.getLastRow() - 1, raw.getLastColumn()).getDisplayValues().forEach(function (row) {
      if (String(row[rawRunCol] || '').trim() !== runId) return;
      rawCount += 1;
      if (!observedAt && rawObservedCol >= 0 && row[rawObservedCol]) observedAt = row[rawObservedCol];
    });
  }
  if (features.getLastRow() >= 2) {
    var featureHeaders = features.getRange(1, 1, 1, features.getLastColumn()).getDisplayValues()[0];
    var featureRunCol = featureHeaders.indexOf('Run ID');
    var featureObservedCol = featureHeaders.indexOf('Observed / Finalized At');
    features.getRange(2, 1, features.getLastRow() - 1, features.getLastColumn()).getDisplayValues().forEach(function (row) {
      if (String(row[featureRunCol] || '').trim() !== runId) return;
      featureRows.push(row);
      if (!observedAt && featureObservedCol >= 0 && row[featureObservedCol]) observedAt = row[featureObservedCol];
    });
  }
  if (!rawCount && !featureRows.length) {
    throw new Error('No Raw Observations or Feature Observations found for run ' + runId);
  }
  if (rawCount && featureRows.length && rawCount !== featureRows.length) {
    throw new Error('HISTORICAL_RAW_MISMATCH expected=' + rawCount + ' features=' + featureRows.length);
  }
  var counts = g022LedgerEnrichmentCounts_(featureRows);
  var finishedAt = observedAt ? new Date(observedAt) : new Date();
  var values = {};
  values['Run ID'] = runId;
  values['Run Date'] = runId.slice(0, 8);
  values['Started At'] = finishedAt;
  values['Finished At'] = finishedAt;
  values['Run Type'] = 'SCHEDULED_DAILY';
  values['Trigger Type'] = 'SCHEDULED_TRIGGER';
  values['Final Status'] = 'SUCCESS';
  values['Discovery Completeness'] = 'COMPLETE';
  values['Raw Unique'] = rawCount || featureRows.length;
  values['Raw Persisted'] = rawCount || featureRows.length;
  values['Historical Raw Persisted'] = rawCount || featureRows.length;
  values['Enrichment Requested'] = counts.requested;
  values['Enrichment Complete'] = counts.complete;
  values['Enrichment Failed'] = counts.failed;
  values['Enrichment Processed'] = counts.processed;
  values['Continuation Segments'] = 1;
  values['Warning Summary'] = 'repaired_from_existing_raw_feature';
  values['Code / Runtime Version'] = 'steam_hotword_monitor@repair-' + runId;
  values['Schema Version'] = 'steam_run_ledger_v1_1';
  values['Control Sample Requested'] = counts.controlRequested || 0;
  values['Control Sample Complete'] = counts.controlComplete || 0;
  values['Control Sample Failed'] = counts.controlFailed || 0;
  var row = G022_RUN_LEDGER_HEADERS.map(function (header) {
    return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : null;
  });
  ledger.getRange(ledger.getLastRow() + 1, 1, 1, G022_RUN_LEDGER_HEADERS.length).setValues([row]);
  var canonical = g022RefreshDailyCanonicalRuns_(business);
  return {
    ok: true,
    repaired: true,
    runId: runId,
    rawCount: rawCount,
    featureCount: featureRows.length,
    enrichment: counts,
    canonicalRows: canonical.rows
  };
}

