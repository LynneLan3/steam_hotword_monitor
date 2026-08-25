/**
 * Hotword OS Candidate External Signal Loop v1.
 *
 * This file is deliberately isolated from the Steam scanner.  It stores
 * factual external evidence first, then interprets Google Trends evidence in
 * a separate append-only research history.  It never writes BUILD/WATCH/
 * REJECT and it never creates a trigger.
 */

const HOTWORD_EXTERNAL_EVIDENCE_HEADERS = [
  'EvidenceID', 'RecordedAt', 'ObservedAt', 'EvidenceType', 'SourceMode',
  'AppID', 'Game', 'OpportunityID', 'Source', 'EvidenceRef',
  'ObservationContext', 'RawObservation', 'NormalizedData',
  'ExtractionConfidence', 'EvidenceStatus', 'Notes'
];

const HOTWORD_TRENDS_RESEARCH_HEADERS = [
  'ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game',
  'OpportunityID', 'SearchTerm', 'Geo', 'Window', 'Benchmark',
  'CandidateAvg', 'BenchmarkAvg', 'RelativeStrength', 'TrendDirection',
  'Breakout', 'BrandAmbiguity', 'EntityMatchConfidence', 'Steam1BType',
  'SteamPriority', 'TrendVerdict', 'RecommendedRoute', 'EvidenceRef',
  'RecordedAt'
];

const HOTWORD_EXTERNAL_EVIDENCE_TYPES = {
  GOOGLE_TRENDS: true, KEYWORD_TOOL: true, COMPETITOR: true,
  SOCIAL: true, PRODUCT: true, OTHER: true
};
const HOTWORD_EXTERNAL_SOURCE_MODES = {
  SCREENSHOT: true, USER_MANUAL: true, ASSISTED: true, API: true
};
const HOTWORD_EXTERNAL_CONFIDENCES = {HIGH: true, MEDIUM: true, LOW: true};
const HOTWORD_EXTERNAL_STATUSES = {
  RAW: true, NORMALIZED: true, APPLIED: true, SUPERSEDED: true, INVALID: true
};
const HOTWORD_EXTERNAL_VERDICTS = {
  SEARCH_CONFIRMED: true,
  SEARCH_WEAK: true,
  TREND_OVERRIDE: true,
  EXTERNAL_DISCOVERY: true,
  AMBIGUOUS: true,
  INSUFFICIENT_DATA: true
};
const HOTWORD_EXTERNAL_ROUTES = {
  SERP_PROBE: true,
  KEYWORD_RESEARCH: true,
  SOCIAL_EARLY: true,
  WATCH: true,
  PROBE: true,
  ENTITY_VALIDATION: true,
  ENTITY_RESOLUTION_REQUIRED: true,
  MANUAL_REVIEW: true
};
const HOTWORD_TRENDS_STRONG_RELATIVE_MIN = 0.75;

function ensureExternalSignalSheets_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet is required');
  const evidence = ensureSheetWithHeaders_(
    ss, HOTWORD_V2.sheets.externalEvidence, HOTWORD_EXTERNAL_EVIDENCE_HEADERS
  );
  const trends = ensureSheetWithHeaders_(
    ss, HOTWORD_V2.sheets.trendsResearch, HOTWORD_TRENDS_RESEARCH_HEADERS
  );
  [evidence, trends].forEach(sheet => {
    if (!sheet) return;
    sheet.setFrozenRows(1);
    const cols = Math.max(sheet.getLastColumn(), 1);
    sheet.getRange(1, 1, 1, cols)
      .setBackground('#674EA7')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });
  return {evidence, trends};
}

/**
 * Public Apps Script entry point for ChatGPT/manual integrations.
 * The optional second argument exists only for deterministic local tests.
 */
function recordExternalEvidence(payload, spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ensureExternalSignalSheets_(ss);
  let parsed = payload;
  let parseError = '';
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      parseError = 'invalid JSON: ' + String(err && err.message || err);
      parsed = {rawObservation: payload};
    }
  }
  const inputText = typeof payload === 'string' ? payload : hotwordExternalStableJson_(payload);
  const data = hotwordExternalNormalizePayload_(parsed);
  const evidenceId = hotwordExternalEvidenceId_(data, inputText);
  const existing = hotwordExternalFindRowById_(sheets.evidence, 'EvidenceID', evidenceId);
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      evidenceId,
      status: existing.values[existing.headers.indexOf('EvidenceStatus')] || ''
    };
  }

  const errors = parseError ? [parseError] : hotwordExternalValidatePayload_(data);
  const resolution = errors.length ? {status: 'ENTITY_RESOLUTION_REQUIRED', reason: ''} :
    hotwordExternalResolveCandidate_(ss, data.appId, data.game, data.opportunityId);
  const status = errors.length ? 'INVALID' : 'NORMALIZED';
  const notes = [];
  if (errors.length) notes.push(errors.join(' | '));
  if (resolution.reason) notes.push(resolution.reason);
  const normalized = Object.assign({}, data.normalizedData, {
    entityResolutionStatus: resolution.status,
    entityResolutionReason: resolution.reason || ''
  });
  const row = hotwordExternalRow_(HOTWORD_EXTERNAL_EVIDENCE_HEADERS, {
    EvidenceID: evidenceId,
    RecordedAt: new Date(),
    ObservedAt: data.observedAt,
    EvidenceType: data.evidenceType,
    SourceMode: data.sourceMode,
    AppID: data.appId,
    Game: data.game,
    OpportunityID: resolution.opportunityId || data.opportunityId || '',
    Source: data.source,
    EvidenceRef: data.evidenceRef,
    ObservationContext: data.observationContext,
    RawObservation: data.rawObservation,
    NormalizedData: hotwordExternalStableJson_(normalized),
    ExtractionConfidence: data.extractionConfidence,
    EvidenceStatus: status,
    Notes: notes.join(' | ')
  });
  const rowNumber = sheets.evidence.getLastRow() + 1;
  sheets.evidence.getRange(rowNumber, 1, 1, HOTWORD_EXTERNAL_EVIDENCE_HEADERS.length).setValues([row]);
  if (status === 'INVALID') hotwordExternalLogInvalid_(ss, evidenceId, notes.join(' | '));
  return {
    ok: status !== 'INVALID',
    duplicate: false,
    evidenceId,
    status,
    entityResolution: resolution.status,
    rowNumber,
    errors
  };
}

/**
 * Public Apps Script entry point.  Processes only NORMALIZED Google Trends
 * evidence; other evidence types remain factual, normalized history for a
 * future processor.
 */
function processExternalEvidence(spreadsheet) {
  const ss = spreadsheet && spreadsheet.getSheetByName ? spreadsheet : SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ensureExternalSignalSheets_(ss);
  let lock = null;
  if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return {ok: false, error: 'PROCESS_LOCK_BUSY'};
  }
  const result = {ok: true, processed: 0, skipped: 0, invalid: 0, duplicates: 0, errors: []};
  try {
    const headers = HOTWORD_EXTERNAL_EVIDENCE_HEADERS;
    if (sheets.evidence.getLastRow() < 2) return result;
    const rows = sheets.evidence.getRange(2, 1, sheets.evidence.getLastRow() - 1, headers.length).getValues();
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const at = name => row[headers.indexOf(name)];
      const status = String(at('EvidenceStatus') || '').trim().toUpperCase();
      const type = String(at('EvidenceType') || '').trim().toUpperCase();
      if (status !== 'NORMALIZED' || type !== 'GOOGLE_TRENDS') {
        if (status === 'NORMALIZED') result.skipped += 1;
        return;
      }
      const evidenceId = String(at('EvidenceID') || '').trim();
      let normalized;
      try {
        normalized = JSON.parse(String(at('NormalizedData') || '{}'));
        if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) throw new Error('NormalizedData must be an object');
      } catch (err) {
        hotwordExternalMarkInvalid_(sheets.evidence, rowNumber, String(err && err.message || err));
        hotwordExternalLogInvalid_(ss, evidenceId, String(err && err.message || err));
        result.invalid += 1;
        return;
      }

      try {
        const appId = String(at('AppID') || normalized.appId || '').trim();
        const game = String(at('Game') || normalized.game || '').trim();
        const resolution = hotwordExternalResolveCandidate_(ss, appId, game, String(at('OpportunityID') || '').trim());
        const interpretation = hotwordExternalInterpretTrends_(normalized, resolution);
        const researchId = 'trend-' + evidenceId;
        const existing = hotwordExternalFindRowById_(sheets.trends, 'ResearchID', researchId);
        if (existing) {
          result.duplicates += 1;
        } else {
          const research = {
            ResearchID: researchId,
            ResearchDate: String(at('ObservedAt') || normalized.observedAt || '').trim(),
            EvidenceID: evidenceId,
            AppID: appId,
            Game: resolution.game || game,
            OpportunityID: resolution.opportunityId || String(at('OpportunityID') || '').trim(),
            SearchTerm: String(normalized.searchTerm || '').trim(),
            Geo: String(normalized.geo || '').trim(),
            Window: String(normalized.window || '').trim(),
            Benchmark: String(normalized.benchmark || '').trim(),
            CandidateAvg: hotwordExternalNumberOrBlank_(normalized.candidateAvg),
            BenchmarkAvg: hotwordExternalNumberOrBlank_(normalized.benchmarkAvg),
            RelativeStrength: interpretation.relativeStrength === null ? '' : interpretation.relativeStrength,
            TrendDirection: String(normalized.trendDirection || '').trim(),
            Breakout: hotwordExternalBooleanOrBlank_(normalized.breakout),
            BrandAmbiguity: String(normalized.brandAmbiguity || '').trim().toUpperCase(),
            EntityMatchConfidence: String(normalized.entityMatchConfidence || '').trim().toUpperCase(),
            Steam1BType: resolution.firstType || '',
            SteamPriority: resolution.priority || '',
            TrendVerdict: interpretation.verdict,
            RecommendedRoute: interpretation.route,
            EvidenceRef: String(at('EvidenceRef') || '').trim(),
            RecordedAt: new Date()
          };
          sheets.trends.getRange(sheets.trends.getLastRow() + 1, 1, 1, HOTWORD_TRENDS_RESEARCH_HEADERS.length)
            .setValues([hotwordExternalRow_(HOTWORD_TRENDS_RESEARCH_HEADERS, research)]);
        }
        if (resolution.status === 'RESOLVED') {
          hotwordExternalApplyDecisionSummary_(ss, resolution, normalized, interpretation);
          if (typeof refreshTodayActionsFromCandidateDecisions_ === 'function') {
            refreshTodayActionsFromCandidateDecisions_(ss);
          }
        }
        const note = hotwordExternalAppendNote_(String(at('Notes') || ''),
          interpretation.verdict + ' → ' + interpretation.route + (resolution.reason ? ' | ' + resolution.reason : ''));
        sheets.evidence.getRange(rowNumber, headers.indexOf('EvidenceStatus') + 1).setValue('APPLIED');
        sheets.evidence.getRange(rowNumber, headers.indexOf('Notes') + 1).setValue(note);
        result.processed += 1;
      } catch (err) {
        const message = String(err && err.message || err);
        hotwordExternalLogInvalid_(ss, evidenceId, message);
        result.errors.push({evidenceId, rowNumber, error: message});
      }
    });
    return result;
  } finally {
    if (lock) lock.releaseLock();
  }
}

function hotwordExternalNormalizePayload_(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const value = (names, fallback) => {
    for (const name of names) {
      if (source[name] !== undefined && source[name] !== null && String(source[name]).trim() !== '') return source[name];
    }
    return fallback === undefined ? '' : fallback;
  };
  const evidenceType = String(value(['evidenceType', 'EvidenceType'], '')).trim().toUpperCase();
  const sourceMode = String(value(['sourceMode', 'SourceMode'], '')).trim().toUpperCase();
  const normalizedData = {
    observedAt: String(value(['observedAt', 'ObservedAt'], '')).trim(),
    evidenceType,
    sourceMode,
    appId: String(value(['appId', 'AppID', 'Steam App ID'], '')).trim(),
    game: String(value(['game', 'Game', '游戏名称'], '')).trim(),
    searchTerm: String(value(['searchTerm'], '')).trim(),
    geo: String(value(['geo', 'Geo'], '')).trim(),
    window: String(value(['window', 'Window'], '')).trim(),
    benchmark: String(value(['benchmark', 'Benchmark'], '')).trim(),
    candidateAvg: hotwordExternalNumberOrNull_(value(['candidateAvg', 'CandidateAvg'], null)),
    benchmarkAvg: hotwordExternalNumberOrNull_(value(['benchmarkAvg', 'BenchmarkAvg'], null)),
    trendDirection: String(value(['trendDirection', 'TrendDirection'], '')).trim().toUpperCase(),
    breakout: hotwordExternalBooleanOrBlank_(value(['breakout', 'Breakout'], '')),
    brandAmbiguity: String(value(['brandAmbiguity', 'BrandAmbiguity'], '')).trim().toUpperCase(),
    entityMatchConfidence: String(value(['entityMatchConfidence', 'EntityMatchConfidence'], '')).trim().toUpperCase()
  };
  return {
    observedAt: normalizedData.observedAt,
    evidenceType,
    sourceMode,
    appId: normalizedData.appId,
    game: normalizedData.game,
    opportunityId: String(value(['opportunityId', 'OpportunityID'], '')).trim(),
    source: String(value(['source', 'Source'], '')).trim(),
    evidenceRef: String(value(['evidenceRef', 'EvidenceRef'], '')).trim(),
    observationContext: String(value(['observationContext', 'ObservationContext'], '')).trim(),
    rawObservation: String(value(['rawObservation', 'RawObservation'], '') || ''),
    extractionConfidence: String(value(['extractionConfidence', 'ExtractionConfidence'], '')).trim().toUpperCase(),
    normalizedData
  };
}

function hotwordExternalValidatePayload_(data) {
  const errors = [];
  if (!data.observedAt) errors.push('ObservedAt is required');
  if (!HOTWORD_EXTERNAL_EVIDENCE_TYPES[data.evidenceType]) errors.push('unsupported EvidenceType');
  if (!HOTWORD_EXTERNAL_SOURCE_MODES[data.sourceMode]) errors.push('unsupported SourceMode');
  if (!data.appId && !data.game) errors.push('AppID or Game is required');
  if (!data.source) errors.push('Source is required');
  if (!data.rawObservation) errors.push('RawObservation is required');
  if (data.extractionConfidence && !HOTWORD_EXTERNAL_CONFIDENCES[data.extractionConfidence]) errors.push('unsupported ExtractionConfidence');
  return errors;
}

function hotwordExternalInterpretTrends_(data, resolution) {
  const candidateAvg = hotwordExternalNumberOrNull_(data.candidateAvg);
  const benchmarkAvg = hotwordExternalNumberOrNull_(data.benchmarkAvg);
  const hasContext = Boolean(data.searchTerm && data.geo && data.window && data.benchmark);
  const confidence = String(data.extractionConfidence || '').toUpperCase();
  const ambiguity = String(data.brandAmbiguity || '').toUpperCase();
  const entityConfidence = String(data.entityMatchConfidence || '').toUpperCase();
  let relativeStrength = null;
  if (candidateAvg !== null && benchmarkAvg !== null && benchmarkAvg > 0) relativeStrength = candidateAvg / benchmarkAvg;
  if (!hasContext || candidateAvg === null || benchmarkAvg === null || benchmarkAvg <= 0 || confidence === 'LOW' || !ambiguity || !entityConfidence) {
    return {verdict: 'INSUFFICIENT_DATA', route: resolution.status === 'ENTITY_RESOLUTION_REQUIRED' ? 'ENTITY_RESOLUTION_REQUIRED' : 'MANUAL_REVIEW', relativeStrength};
  }
  if (ambiguity === 'HIGH' || entityConfidence === 'LOW') {
    return {verdict: 'AMBIGUOUS', route: 'ENTITY_VALIDATION', relativeStrength};
  }
  if (resolution.status === 'ENTITY_RESOLUTION_REQUIRED') {
    return {verdict: 'INSUFFICIENT_DATA', route: 'ENTITY_RESOLUTION_REQUIRED', relativeStrength};
  }
  if (resolution.status !== 'RESOLVED') {
    return {verdict: 'EXTERNAL_DISCOVERY', route: 'ENTITY_RESOLUTION_REQUIRED', relativeStrength};
  }
  const strong = relativeStrength >= HOTWORD_TRENDS_STRONG_RELATIVE_MIN;
  const steamP1 = /^P1\b/i.test(String(resolution.priority || '').trim()) || String(resolution.priority || '').indexOf('高') >= 0;
  if (strong) return {verdict: steamP1 ? 'SEARCH_CONFIRMED' : 'TREND_OVERRIDE', route: steamP1 ? 'SERP_PROBE' : 'PROBE', relativeStrength};
  return {verdict: 'SEARCH_WEAK', route: steamP1 ? 'SOCIAL_EARLY' : 'WATCH', relativeStrength};
}

function hotwordExternalResolveCandidate_(ss, appId, game, opportunityId) {
  const requestedAppId = String(appId || '').trim();
  const requestedGame = String(game || '').trim();
  const wantedName = hotwordExternalNameKey_(requestedGame);
  const candidates = [];
  const addCandidate = candidate => {
    if (!candidate.appId && !candidate.game) return;
    const existing = candidate.appId && candidates.find(item => item.appId === candidate.appId);
    if (!existing) {
      candidates.push(candidate);
      return;
    }
    Object.keys(candidate).forEach(key => {
      if (candidate[key] !== undefined && candidate[key] !== null && String(candidate[key]).trim() &&
          (!existing[key] || !String(existing[key]).trim())) existing[key] = candidate[key];
    });
    if (candidate.opportunityId) existing.opportunityId = candidate.opportunityId;
    if (candidate.source === '候选决策') existing.decisionSource = true;
  };
  const master = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.master) : null;
  if (master && master.getLastRow() > 1) {
    const headers = master.getRange(1, 1, 1, Math.max(master.getLastColumn(), HOTWORD_V2.masterHeaders.length)).getDisplayValues()[0];
    const index = name => headers.indexOf(name);
    master.getRange(2, 1, master.getLastRow() - 1, headers.length).getDisplayValues().forEach(row => addCandidate({
      appId: String(row[index('Steam App ID')] || '').trim(),
      game: String(row[index('游戏名称')] || '').trim(),
      firstType: String(row[index('第一轮类型')] || '').trim(),
      priority: String(row[index('第一轮优先级')] || '').trim(),
      currentStage: String(row[index('当前筛选阶段')] || '').trim(),
      source: '候选主表'
    }));
  }
  const decisions = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.decisions) : null;
  if (decisions && decisions.getLastRow() > 1) {
    const headers = decisions.getRange(1, 1, 1, Math.max(decisions.getLastColumn(), HOTWORD_V2.decisionHeaders.length)).getDisplayValues()[0];
    const index = name => headers.indexOf(name);
    decisions.getRange(2, 1, decisions.getLastRow() - 1, headers.length).getDisplayValues().forEach(row => addCandidate({
      appId: String(row[index('Steam App ID')] || '').trim(),
      game: String(row[index('游戏名称')] || '').trim(),
      firstType: String(row[index('第一轮类型')] || '').trim(),
      priority: '',
      currentStage: String(row[index('当前Steam阶段')] || '').trim(),
      opportunityId: String(row[index('OpportunityID')] || '').trim(),
      source: '候选决策'
    }));
  }
  let match = null;
  if (requestedAppId) match = candidates.find(candidate => candidate.appId === requestedAppId) || null;
  if (!match && !requestedAppId && wantedName) {
    const nameMatches = candidates.filter(candidate => hotwordExternalNameKey_(candidate.game) === wantedName);
    if (nameMatches.length === 1) match = nameMatches[0];
    else if (nameMatches.length > 1) return {status: 'ENTITY_RESOLUTION_REQUIRED', reason: 'Game matches multiple current candidates'};
  }
  if (!match && requestedAppId && wantedName) {
    const nameMatches = candidates.filter(candidate => hotwordExternalNameKey_(candidate.game) === wantedName);
    if (nameMatches.length) return {status: 'ENTITY_RESOLUTION_REQUIRED', reason: 'AppID and Game identify different current entities'};
  }
  if (!match) {
    return {status: 'EXTERNAL_DISCOVERY', reason: 'No exact AppID/Game match in current Candidate Pool', appId: requestedAppId, game: requestedGame, opportunityId: ''};
  }
  const resolvedOpportunity = match.opportunityId || String(opportunityId || '').trim() ||
    (typeof opportunityIdFromSteamCandidate_ === 'function' ? opportunityIdFromSteamCandidate_(match.game, match.appId) : '');
  let priority = match.priority || '';
  if (!priority && /趋势|Early/i.test(match.firstType)) priority = 'P1 高';
  if (!priority && /对照/i.test(match.firstType)) priority = 'P2 对照';
  return {
    status: 'RESOLVED',
    appId: match.appId,
    game: match.game,
    opportunityId: resolvedOpportunity,
    firstType: match.firstType || '',
    priority,
    currentStage: match.currentStage || '',
    reason: ''
  };
}

function hotwordExternalApplyDecisionSummary_(ss, resolution, data, interpretation) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet || sheet.getLastRow() < 2) return;
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HOTWORD_V2.decisionHeaders.length)).getDisplayValues()[0];
  const appColumn = headers.indexOf('Steam App ID');
  if (appColumn < 0) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  const rowIndex = rows.findIndex(row => String(row[appColumn] || '').trim() === resolution.appId);
  if (rowIndex < 0) return;
  const rowNumber = rowIndex + 2;
  const put = (name, value) => {
    const col = headers.indexOf(name);
    if (col >= 0) sheet.getRange(rowNumber, col + 1).setValue(value);
  };
  const legacy = {
    SEARCH_CONFIRMED: '强', SEARCH_WEAK: '弱', TREND_OVERRIDE: '强',
    AMBIGUOUS: '未检查', INSUFFICIENT_DATA: '未检查'
  }[interpretation.verdict];
  if (legacy) put('Google Trends结果', legacy);
  put('TrendRelativeStrength', interpretation.relativeStrength === null ? '' : interpretation.relativeStrength);
  put('TrendVerdict', interpretation.verdict);
  put('TrendLastChecked', data.observedAt || new Date());
  put('ExternalSignal', hotwordExternalMergeSignals_(String(rows[rowIndex][headers.indexOf('ExternalSignal')] || ''), 'GOOGLE_TRENDS'));
  put('FinalResearchStage', interpretation.route);

  const decision = String(rows[rowIndex][headers.indexOf('Decision')] || rows[rowIndex][headers.indexOf('决策状态')] || '').trim().toUpperCase();
  if (!decision) {
    const nextAction = {
      SERP_PROBE: 'SERP检查', KEYWORD_RESEARCH: 'Keyword Research', SOCIAL_EARLY: 'Social验证',
      WATCH: 'Recheck', PROBE: 'Google Trends', ENTITY_VALIDATION: 'Google Trends',
      ENTITY_RESOLUTION_REQUIRED: 'Google Trends', MANUAL_REVIEW: 'Google Trends'
    }[interpretation.route] || 'Google Trends';
    put('Next Action', nextAction);
  }
}

function hotwordExternalEvidenceId_(data, inputText) {
  const key = {
    observedAt: data.observedAt,
    evidenceType: data.evidenceType,
    sourceMode: data.sourceMode,
    appId: data.appId,
    game: data.game,
    source: data.source,
    evidenceRef: data.evidenceRef,
    normalizedData: data.normalizedData,
    rawObservation: data.rawObservation || inputText
  };
  return 'evi-' + hotwordExternalHash_(hotwordExternalStableJson_(key)).slice(0, 24);
}

function hotwordExternalFindRowById_(sheet, idHeader, id) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const column = headers.indexOf(idHeader);
  if (column < 0) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][column] || '').trim() === String(id || '').trim()) return {rowNumber: i + 2, headers, values: rows[i]};
  }
  return null;
}

function hotwordExternalRow_(headers, values) {
  return headers.map(header => values[header] === undefined || values[header] === null ? '' : values[header]);
}

function hotwordExternalMarkInvalid_(sheet, rowNumber, message) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const status = headers.indexOf('EvidenceStatus');
  const notes = headers.indexOf('Notes');
  if (status >= 0) sheet.getRange(rowNumber, status + 1).setValue('INVALID');
  if (notes >= 0) sheet.getRange(rowNumber, notes + 1).setValue(hotwordExternalAppendNote_('', message));
}

function hotwordExternalLogInvalid_(ss, evidenceId, message) {
  try {
    Logger.log('ExternalEvidence INVALID ' + evidenceId + ': ' + message);
  } catch (err) {
    // Logger is unavailable only in local tests.
  }
  try {
    const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.anomalies) : null;
    if (sheet && typeof sheet.appendRow === 'function') {
      sheet.appendRow([new Date(), 'external-evidence', '', '', 'ExternalEvidence', 'INVALID', message, 'Review evidence row', '']);
    }
  } catch (err) {
    // Invalid evidence logging must never break the Steam scanner.
  }
}

function hotwordExternalAppendNote_(oldNote, note) {
  const left = String(oldNote || '').trim();
  const right = String(note || '').trim();
  if (!right) return left;
  return left ? left + ' | ' + right : right;
}

function hotwordExternalMergeSignals_(oldSignals, signal) {
  const values = String(oldSignals || '').split(',').map(value => value.trim()).filter(Boolean);
  if (values.indexOf(signal) < 0) values.push(signal);
  return values.join(',');
}

function hotwordExternalNumberOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function hotwordExternalNumberOrBlank_(value) {
  const number = hotwordExternalNumberOrNull_(value);
  return number === null ? '' : number;
}

function hotwordExternalBooleanOrBlank_(value) {
  if (value === true || value === false) return value;
  const text = String(value || '').trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return '';
}

function hotwordExternalNameKey_(name) {
  if (typeof normalizeGameName_ === 'function') return normalizeGameName_(name);
  return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function hotwordExternalStableJson_(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(hotwordExternalStableJson_).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + hotwordExternalStableJson_(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function hotwordExternalHash_(text) {
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest && Utilities.DigestAlgorithm) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
    return bytes.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
