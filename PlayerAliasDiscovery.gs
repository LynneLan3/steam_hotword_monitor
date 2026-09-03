/**
 * 玩家常用称呼发现：在进入 Google Trends 判断前，通过 Google / YouTube /
 * Reddit / Steam Community 检索玩家实际使用的简称、缩写、去副标题名、数字写法。
 * 禁止模型猜测；无明确证据则留空。
 * 证据写入现有 Trends研究记录（TrendVerdict=ALIAS_DISCOVERY）。
 *
 * 状态语义：
 * - FOUND：真实非空 alias，允许 durable cache hit
 * - NO_ALIAS_EVIDENCE：来源正常返回但证据不足；短期可跳过，到期复查（非永久 negative cache）
 * - RETRIEVAL_FAILED：全部来源抓取失败；下次运行必须重试
 */

const PLAYER_ALIAS_DISCOVERY_VERDICT_ = 'ALIAS_DISCOVERY';
const PLAYER_ALIAS_DISCOVERY_JOB_TYPE_ = 'PLAYER_ALIAS_DISCOVERY';
const PLAYER_ALIAS_MIN_SOURCE_HITS_ = 2;
const PLAYER_ALIAS_NO_EVIDENCE_RECHECK_DAYS_ = 7;
const PLAYER_ALIAS_PENDING_REQUEUE_HOURS_ = 18;
const PLAYER_ALIAS_STATUS_FOUND_ = 'FOUND';
const PLAYER_ALIAS_STATUS_NO_EVIDENCE_ = 'NO_ALIAS_EVIDENCE';
const PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_ = 'RETRIEVAL_FAILED';
const PLAYER_ALIAS_STATUS_PENDING_ = 'PENDING';
const PLAYER_ALIAS_SOURCES_ = ['reddit', 'youtube', 'steam_community', 'web', 'google'];
const PLAYER_ALIAS_ROMAN_WORDS_ = {
  II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10'
};

/**
 * 只有真实非空 alias 才算 cache hit（found=true）。
 * SearchTerm=(none) / RETRIEVAL_FAILED / NO_ALIAS_EVIDENCE 一律不算成功缓存。
 * @param {Object} ss
 * @param {string} appId
 * @return {{alias:string,found:boolean,researchId:string,status:string,recordedAt:Date|null,searchTerm:string}}
 */
function readCachedPlayerSearchAlias_(ss, appId) {
  const latest = readLatestPlayerAliasAttempt_(ss, appId);
  if (!latest) {
    return {alias: '', found: false, researchId: '', status: '', recordedAt: null, searchTerm: ''};
  }
  const alias = String(latest.alias || '').trim();
  const found = !!alias && alias !== '(none)' && latest.status === PLAYER_ALIAS_STATUS_FOUND_;
  return {
    alias: found ? alias : '',
    found: found,
    researchId: latest.researchId || '',
    status: latest.status || '',
    recordedAt: latest.recordedAt || null,
    searchTerm: latest.searchTerm || ''
  };
}

/**
 * 读取某 AppID 最新一条 ALIAS_DISCOVERY 尝试（含失败 / 无证据）。
 * @param {Object} ss
 * @param {string} appId
 * @return {Object|null}
 */
function readLatestPlayerAliasAttempt_(ss, appId) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  const normalizedAppId = String(appId || '').trim();
  if (!sheet || sheet.getLastRow() < 2 || !normalizedAppId) return null;

  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const appColumn = headers.indexOf('AppID');
  const verdictColumn = headers.indexOf('TrendVerdict');
  const searchColumn = headers.indexOf('SearchTerm');
  const researchColumn = headers.indexOf('ResearchID');
  const evidenceColumn = headers.indexOf('EvidenceRef');
  const recordedColumn = headers.indexOf('RecordedAt');
  const dateColumn = headers.indexOf('ResearchDate');
  if (appColumn < 0 || verdictColumn < 0) return null;

  let latest = null;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues().forEach(row => {
    if (String(row[appColumn] || '').trim() !== normalizedAppId) return;
    if (String(row[verdictColumn] || '').trim().toUpperCase() !== PLAYER_ALIAS_DISCOVERY_VERDICT_) return;
    const searchTerm = searchColumn >= 0 ? String(row[searchColumn] || '').trim() : '';
    const evidenceRef = evidenceColumn >= 0 ? String(row[evidenceColumn] || '') : '';
    const status = playerAliasParseStatusFromEvidence_(evidenceRef, searchTerm);
    const alias = searchTerm && searchTerm !== '(none)' ? searchTerm : '';
    const recordedAt = playerAliasParseRecordedAt_(
      recordedColumn >= 0 ? row[recordedColumn] : '',
      dateColumn >= 0 ? row[dateColumn] : ''
    );
    const candidate = {
      alias: alias,
      searchTerm: searchTerm,
      status: status,
      researchId: researchColumn >= 0 ? String(row[researchColumn] || '').trim() : '',
      evidenceRef: evidenceRef,
      recordedAt: recordedAt,
      rowIndex: 0
    };
    if (!latest || playerAliasAttemptIsNewer_(candidate, latest)) latest = candidate;
  });
  return latest;
}

/**
 * 是否应跳过本次发现 / 入队。
 * PENDING 在窗口内 defer；过期未 callback 可重新 enqueue。
 * RETRIEVAL_FAILED 与历史无状态 (none) 永不 defer。
 * @param {Object} ss
 * @param {string} appId
 * @return {boolean}
 */
function shouldDeferPlayerAliasDiscovery_(ss, appId) {
  const latest = readLatestPlayerAliasAttempt_(ss, appId);
  if (!latest) return false;
  if (latest.alias && latest.status === PLAYER_ALIAS_STATUS_FOUND_) return true;
  if (latest.status === PLAYER_ALIAS_STATUS_PENDING_) {
    return !playerAliasPendingIsStale_(latest.recordedAt);
  }
  if (latest.status === PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_) return false;
  if (latest.status !== PLAYER_ALIAS_STATUS_NO_EVIDENCE_) return false;
  return !playerAliasIsDueForRecheck_(latest.recordedAt, PLAYER_ALIAS_NO_EVIDENCE_RECHECK_DAYS_);
}

/**
 * @param {Date|null} recordedAt
 * @return {boolean} true when pending job should be re-enqueued
 */
function playerAliasPendingIsStale_(recordedAt) {
  if (!(recordedAt instanceof Date) || isNaN(recordedAt.getTime())) return true;
  const windowMs = Math.max(1, PLAYER_ALIAS_PENDING_REQUEUE_HOURS_) * 60 * 60 * 1000;
  return (Date.now() - recordedAt.getTime()) >= windowMs;
}

/**
 * 本地/测试用证据发现。生产路径请走 hotword-engine enqueue + callback，
 * 不要在 Apps Script 做主要公网 scraping。
 * @param {string} gameName
 * @param {string} appId
 * @param {string} steamUrl
 * @param {Object} [options]
 * @return {{alias:string,evidence:Array<Object>,status:string,patterns:Array<string>,ranked:Array<Object>,sourceDiags:Array<Object>,sourceUrls:Array<string>,sourceCount:number,confidence:string}}
 */
function discoverPlayerSearchAlias_(gameName, appId, steamUrl, options) {
  options = options || {};
  const officialName = String(gameName || '').trim();
  if (!officialName) {
    return {
      alias: '', evidence: [], status: 'EMPTY', patterns: [], ranked: [], sourceDiags: [],
      sourceUrls: [], sourceCount: 0, confidence: 'UNKNOWN'
    };
  }

  const patterns = playerAliasGenerateEvidencePatterns_(officialName);
  const collected = playerAliasCollectSearchSnippets_(officialName, appId, steamUrl, options.fetchImpl);
  const snippets = collected.snippets || [];
  const sourceDiags = collected.sourceDiags || [];
  const ranked = playerAliasRankCandidates_(officialName, patterns, snippets)
    .filter(entry => !playerAliasIsNumeralVariantOnly_(entry.text, officialName))
    .filter(entry => !playerAliasIsWeakSubtitleOnlyAlias_(entry.text, officialName));
  const best = ranked.length ? ranked[0] : null;
  const alias = best && best.hits >= PLAYER_ALIAS_MIN_SOURCE_HITS_ ? best.text : '';
  const status = playerAliasResolveDiscoveryStatus_(alias, sourceDiags);
  const sourceUrls = playerAliasCollectSourceUrls_(snippets);
  const confidence = alias ? 'HIGH'
    : (status === PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_ ? 'UNKNOWN' : 'LOW');

  return {
    alias: alias,
    evidence: snippets.slice(0, 40),
    status: status,
    patterns: patterns,
    ranked: ranked.slice(0, 5),
    sourceDiags: sourceDiags,
    sourceUrls: sourceUrls,
    sourceCount: (sourceDiags || []).filter(item => item && item.ok).length,
    confidence: confidence
  };
}

/**
 * @param {string} alias
 * @param {Array<Object>} sourceDiags
 * @return {string}
 */
function playerAliasResolveDiscoveryStatus_(alias, sourceDiags) {
  if (alias) return PLAYER_ALIAS_STATUS_FOUND_;
  const diags = sourceDiags || [];
  if (!diags.length) return PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_;
  const anyOk = diags.some(item => item && item.ok);
  if (!anyOk) return PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_;
  return PLAYER_ALIAS_STATUS_NO_EVIDENCE_;
}

/**
 * @param {Object} ss
 * @param {Object} rec
 * @param {{alias:string,evidence:Array<Object>,status:string,patterns:Array<string>}} discovery
 * @param {Object} [options]
 * @return {{written:boolean,researchId:string,duplicate?:boolean,deferred?:boolean}}
 */
function writePlayerAliasResearchRecord_(ss, rec, discovery, options) {
  options = options || {};
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  if (!sheet) return {written: false, researchId: ''};

  const appId = String(rec && rec.appId || '').trim();
  if (!options.force) {
    const cached = readCachedPlayerSearchAlias_(ss, appId);
    if (cached.found) return {written: false, researchId: cached.researchId, duplicate: true};
    if (shouldDeferPlayerAliasDiscovery_(ss, appId) &&
        discovery && discovery.status === PLAYER_ALIAS_STATUS_NO_EVIDENCE_) {
      const latest = readLatestPlayerAliasAttempt_(ss, appId);
      return {written: false, researchId: latest && latest.researchId || '', deferred: true};
    }
  }

  const headers = HOTWORD_TRENDS_RESEARCH_HEADERS || [
    'ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game', 'OpportunityID',
    'SearchTerm', 'Geo', 'Window', 'Benchmark', 'CandidateAvg', 'BenchmarkAvg',
    'RelativeStrength', 'TrendDirection', 'Breakout', 'BrandAmbiguity',
    'EntityMatchConfidence', 'Steam1BType', 'SteamPriority', 'TrendVerdict',
    'RecommendedRoute', 'EvidenceRef', 'RecordedAt'
  ];
  const status = discovery && discovery.status ? discovery.status : PLAYER_ALIAS_STATUS_NO_EVIDENCE_;
  const aliasText = discovery && discovery.alias ? discovery.alias : '';
  const explicitJobId = discovery && discovery.jobId ? String(discovery.jobId).trim() : '';
  const evidenceId = explicitJobId
    ? explicitJobId.replace(/^alias-research-/, '').replace(/^alias-discovery-/, 'alias-')
    : ('alias-' + appId + '-' + playerAliasHashKey_(
      rec.name + '|' + aliasText + '|' + status + '|' + playerAliasDateText_(new Date())
    ));
  const researchId = explicitJobId || ('alias-research-' + evidenceId);
  const opportunityId = rec.todayAction && rec.todayAction.decision && rec.todayAction.decision.opportunityId
    ? rec.todayAction.decision.opportunityId
    : (typeof opportunityIdFromSteamCandidate_ === 'function'
      ? opportunityIdFromSteamCandidate_(rec.name, appId) : '');

  const evidenceSummary = playerAliasEvidenceSummary_(discovery);
  const confidence = discovery && discovery.confidence
    ? discovery.confidence
    : (aliasText ? 'HIGH'
      : (status === PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_ || status === PLAYER_ALIAS_STATUS_PENDING_
        ? 'UNKNOWN' : 'LOW'));
  const searchTerm = status === PLAYER_ALIAS_STATUS_PENDING_
    ? '(pending)'
    : (aliasText || '(none)');
  const row = hotwordExternalRow_ ? hotwordExternalRow_(headers, {
    ResearchID: researchId,
    ResearchDate: playerAliasDateText_(new Date()),
    EvidenceID: evidenceId,
    AppID: appId,
    Game: rec.name,
    OpportunityID: opportunityId,
    SearchTerm: searchTerm,
    Geo: HOTWORD_V2 && HOTWORD_V2.trendsExplore ? HOTWORD_V2.trendsExplore.geo || 'US' : 'US',
    Window: HOTWORD_V2 && HOTWORD_V2.trendsExplore ? HOTWORD_V2.trendsExplore.date || 'today 1-m' : 'today 1-m',
    Benchmark: '',
    CandidateAvg: '',
    BenchmarkAvg: '',
    RelativeStrength: '',
    TrendDirection: '',
    Breakout: '',
    BrandAmbiguity: status,
    EntityMatchConfidence: confidence,
    Steam1BType: rec.firstRoundType || '',
    SteamPriority: rec.priority || '',
    TrendVerdict: PLAYER_ALIAS_DISCOVERY_VERDICT_,
    RecommendedRoute: 'Google Trends',
    EvidenceRef: evidenceSummary,
    RecordedAt: new Date()
  }) : headers.map(name => {
    const values = {
      ResearchID: researchId, ResearchDate: playerAliasDateText_(new Date()), EvidenceID: evidenceId,
      AppID: appId, Game: rec.name, OpportunityID: opportunityId,
      SearchTerm: searchTerm,
      Geo: 'US', Window: 'today 1-m', Benchmark: '',
      CandidateAvg: '', BenchmarkAvg: '', RelativeStrength: '', TrendDirection: '',
      Breakout: '', BrandAmbiguity: status,
      EntityMatchConfidence: confidence,
      Steam1BType: rec.firstRoundType || '', SteamPriority: rec.priority || '',
      TrendVerdict: PLAYER_ALIAS_DISCOVERY_VERDICT_,
      RecommendedRoute: 'Google Trends', EvidenceRef: evidenceSummary, RecordedAt: new Date()
    };
    return values[name] === undefined ? '' : values[name];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  return {written: true, researchId: researchId};
}

/**
 * 今日行动刷新前：有 FOUND cache 则回填；否则 enqueue hotword-engine，不再同步 scraping。
 * @param {Object} ss
 * @param {Array<Object>} actions
 * @return {{enqueued:number,cached:number,deferred:number,skipped:number}}
 */
function ensurePlayerSearchAliasesForTodayActions_(ss, actions) {
  let enqueued = 0;
  let cached = 0;
  let deferred = 0;
  let skipped = 0;
  (actions || []).forEach(rec => {
    const cachedAlias = readCachedPlayerSearchAlias_(ss, rec.appId);
    if (cachedAlias.found) {
      rec.searchAlias = cachedAlias.alias;
      cached += 1;
      return;
    }
    if (!shouldRunPlayerAliasDiscovery_(rec)) {
      rec.searchAlias = '';
      skipped += 1;
      return;
    }
    if (shouldDeferPlayerAliasDiscovery_(ss, rec.appId)) {
      rec.searchAlias = '';
      deferred += 1;
      return;
    }
    const queued = enqueuePlayerAliasDiscoveryJob_(ss, rec, new Date());
    rec.searchAlias = '';
    if (queued && queued.enqueued) enqueued += 1;
    else skipped += 1;
  });
  return {enqueued: enqueued, cached: cached, deferred: deferred, skipped: skipped};
}

/**
 * @param {Object} ss
 * @param {Object} rec
 * @param {Date} [createdAt]
 * @param {Object} [options]
 * @return {{enqueued:boolean,jobId:string,duplicate?:boolean,deferred?:boolean}}
 */
function enqueuePlayerAliasDiscoveryJob_(ss, rec, createdAt, options) {
  options = options || {};
  const appId = String(rec && rec.appId || '').trim();
  const name = String(rec && rec.name || '').trim();
  if (!appId || !name) return {enqueued: false, jobId: ''};
  if (!options.force) {
    const cached = readCachedPlayerSearchAlias_(ss, appId);
    if (cached.found) return {enqueued: false, jobId: cached.researchId || '', duplicate: true};
    if (shouldDeferPlayerAliasDiscovery_(ss, appId)) {
      const latest = readLatestPlayerAliasAttempt_(ss, appId);
      return {enqueued: false, jobId: latest && latest.researchId || '', deferred: true};
    }
  }
  const when = createdAt instanceof Date ? createdAt : new Date();
  const jobId = 'alias-discovery-' + appId + '-' + playerAliasHashKey_(
    name + '|' + playerAliasDateText_(when) + '|' + when.getTime()
  );
  const steamUrl = String(rec.url || '').trim() ||
    ('https://store.steampowered.com/app/' + appId + '/');
  const written = writePlayerAliasResearchRecord_(ss, {
    appId: appId,
    name: name,
    url: steamUrl,
    firstRoundType: rec.firstRoundType || '',
    priority: rec.priority || '',
    todayAction: rec.todayAction || {}
  }, {
    alias: '',
    status: PLAYER_ALIAS_STATUS_PENDING_,
    evidence: [],
    patterns: playerAliasGenerateEvidencePatterns_(name),
    ranked: [],
    sourceDiags: [],
    sourceUrls: [],
    sourceCount: 0,
    confidence: 'UNKNOWN',
    jobId: jobId,
    steamUrl: steamUrl
  }, {force: !!options.force});
  return {enqueued: !!written.written, jobId: written.researchId || jobId};
}

/**
 * @param {Object} [spreadsheet]
 * @return {Array<Object>}
 */
function loadPendingPlayerAliasDiscoveryJobs_(spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const appColumn = headers.indexOf('AppID');
  const gameColumn = headers.indexOf('Game');
  const verdictColumn = headers.indexOf('TrendVerdict');
  const searchColumn = headers.indexOf('SearchTerm');
  const researchColumn = headers.indexOf('ResearchID');
  const evidenceColumn = headers.indexOf('EvidenceRef');
  const recordedColumn = headers.indexOf('RecordedAt');
  if (appColumn < 0 || verdictColumn < 0) return [];

  const latestByApp = new Map();
  sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues().forEach(row => {
    if (String(row[verdictColumn] || '').trim().toUpperCase() !== PLAYER_ALIAS_DISCOVERY_VERDICT_) return;
    const appId = String(row[appColumn] || '').trim();
    if (!appId) return;
    const searchTerm = searchColumn >= 0 ? String(row[searchColumn] || '').trim() : '';
    const evidenceRef = evidenceColumn >= 0 ? String(row[evidenceColumn] || '') : '';
    const status = playerAliasParseStatusFromEvidence_(evidenceRef, searchTerm);
    const recordedAt = playerAliasParseRecordedAt_(
      recordedColumn >= 0 ? row[recordedColumn] : '',
      ''
    );
    const candidate = {
      appId: appId,
      game: gameColumn >= 0 ? String(row[gameColumn] || '').trim() : '',
      researchId: researchColumn >= 0 ? String(row[researchColumn] || '').trim() : '',
      status: status,
      evidenceRef: evidenceRef,
      recordedAt: recordedAt,
      searchTerm: searchTerm
    };
    if (!latestByApp.has(appId) || playerAliasAttemptIsNewer_(candidate, latestByApp.get(appId))) {
      latestByApp.set(appId, candidate);
    }
  });

  const jobs = [];
  latestByApp.forEach(item => {
    if (item.status !== PLAYER_ALIAS_STATUS_PENDING_) return;
    const steamUrl = playerAliasSteamUrlFromEvidence_(item.evidenceRef) ||
      ('https://store.steampowered.com/app/' + item.appId + '/');
    jobs.push({
      job_id: item.researchId || ('alias-discovery-' + item.appId),
      job_type: PLAYER_ALIAS_DISCOVERY_JOB_TYPE_,
      steam_app_id: item.appId,
      game_name: item.game,
      steam_url: steamUrl,
      research_cycle_date: playerAliasDateText_(item.recordedAt || new Date()),
      created_at: item.recordedAt instanceof Date
        ? item.recordedAt.toISOString()
        : new Date().toISOString()
    });
  });
  return jobs;
}

/**
 * hotword-engine PLAYER_ALIAS_DISCOVERY callback.
 * @param {Object} body
 * @return {Object}
 */
function handlePlayerAliasDiscoveryCallback_(body) {
  body = body || {};
  const jobType = String(body.job_type || '').trim().toUpperCase();
  if (jobType !== PLAYER_ALIAS_DISCOVERY_JOB_TYPE_) {
    return {ok: false, error: 'unsupported_job_type'};
  }
  const appId = String(body.steam_app_id || '').trim();
  const gameName = String(body.game_name || '').trim();
  const jobId = String(body.job_id || '').trim();
  if (!appId || !gameName || !jobId) {
    return {ok: false, error: 'missing_required_fields'};
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  if (!ss) return {ok: false, error: 'spreadsheet_unavailable'};

  const executionStatus = String(body.execution_status || '').trim().toUpperCase();
  let status = String(body.status || '').trim().toUpperCase();
  if (executionStatus === 'FAILED') status = PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_;
  if (status !== PLAYER_ALIAS_STATUS_FOUND_ &&
      status !== PLAYER_ALIAS_STATUS_NO_EVIDENCE_ &&
      status !== PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_) {
    status = PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_;
  }
  const alias = status === PLAYER_ALIAS_STATUS_FOUND_ ? String(body.alias || '').trim() : '';
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  const sourceUrls = Array.isArray(body.source_urls) ? body.source_urls :
    (Array.isArray(body.sourceUrls) ? body.sourceUrls : playerAliasCollectSourceUrls_(evidence));
  const sourceDiags = Array.isArray(body.source_diags) ? body.source_diags :
    (Array.isArray(body.sourceDiags) ? body.sourceDiags : []);
  const patterns = Array.isArray(body.patterns) ? body.patterns : [];
  const ranked = Array.isArray(body.ranked) ? body.ranked : [];
  const confidence = String(body.confidence || '').trim() ||
    (alias ? 'HIGH' : (status === PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_ ? 'UNKNOWN' : 'LOW'));

  const master = typeof readMasterRecords_ === 'function' ? readMasterRecords_(ss) : new Map();
  const decisions = typeof readCandidateDecisions_ === 'function' ? readCandidateDecisions_(ss) : new Map();
  const masterRec = master.get ? master.get(appId) : null;
  const decision = decisions.get ? decisions.get(appId) : null;

  const written = writePlayerAliasResearchRecord_(ss, {
    appId: appId,
    name: gameName,
    url: String(body.steam_url || '').trim() ||
      ('https://store.steampowered.com/app/' + appId + '/'),
    firstRoundType: masterRec && masterRec.firstRoundType || '',
    priority: masterRec && masterRec.priority || '',
    todayAction: {decision: decision || {}}
  }, {
    alias: alias,
    status: status,
    evidence: evidence,
    patterns: patterns,
    ranked: ranked,
    sourceDiags: sourceDiags,
    sourceUrls: sourceUrls,
    sourceCount: Number(body.source_count != null ? body.source_count : sourceUrls.length) || 0,
    confidence: confidence,
    jobId: jobId,
    resultPath: String(body.result_path || '').trim(),
    error: String(body.error || '').trim()
  }, {force: true});

  const refresh = typeof refreshTodayActionsFromCandidateDecisions_ === 'function'
    ? refreshTodayActionsFromCandidateDecisions_(ss)
    : {ok: false, skipped: true};

  return {
    ok: true,
    job_id: jobId,
    steam_app_id: appId,
    status: status,
    alias: alias,
    written: written.written,
    research_id: written.researchId,
    today_action_refresh: refresh
  };
}

/**
 * BUILD 交接行不做外部检索；其余今日行动行（含 WATCH_WAITING、已填 Trends）若无缓存仍补跑一次。
 * @param {Object} rec
 * @return {boolean}
 */
function shouldRunPlayerAliasDiscovery_(rec) {
  const action = rec && rec.todayAction;
  if (!action) return false;
  if (action.type === 'BUILD' || action.isCompleted) return false;
  return true;
}

/**
 * @deprecated 保留旧名供测试引用；Trends 是否已填不再阻止别名发现。
 * @param {Object} rec
 * @return {boolean}
 */
function needsPlayerAliasDiscovery_(rec) {
  return shouldRunPlayerAliasDiscovery_(rec);
}

/**
 * 生产修复：对历史 ALIAS_DISCOVERY + SearchTerm=(none)（及指定 AppID）enqueue 到 hotword-engine。
 * 不再在 Apps Script 内同步公网 scraping。
 * @param {Object} [params]
 * @return {Object}
 */
function repairPlayerAliasFalseNegativesProduction_(params) {
  params = params || {};
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const forceAppIds = (params.appIds || params.app_ids || [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
  const defaultTargets = ['4075620', '4339280', '2445260'];
  const targetSet = new Set(forceAppIds.length ? forceAppIds : defaultTargets);

  const noneCandidates = listPlayerAliasNoneCandidates_(ss);
  noneCandidates.forEach(item => targetSet.add(item.appId));

  const master = typeof readMasterRecords_ === 'function' ? readMasterRecords_(ss) : new Map();
  const decisions = typeof readCandidateDecisions_ === 'function' ? readCandidateDecisions_(ss) : new Map();
  const results = [];

  Array.from(targetSet).forEach(appId => {
    const masterRec = master.get ? master.get(appId) : null;
    const decision = decisions.get ? decisions.get(appId) : null;
    const name = (masterRec && masterRec.name) ||
      (decision && decision.name) ||
      playerAliasLookupGameNameFromTrends_(ss, appId) ||
      '';
    const url = (masterRec && masterRec.url) ||
      ('https://store.steampowered.com/app/' + appId + '/');
    if (!name) {
      results.push({appId: appId, ok: false, error: 'game_name_missing'});
      return;
    }
    const before = readLatestPlayerAliasAttempt_(ss, appId);
    const queued = enqueuePlayerAliasDiscoveryJob_(ss, {
      appId: appId,
      name: name,
      url: url,
      firstRoundType: masterRec && masterRec.firstRoundType || '',
      priority: masterRec && masterRec.priority || '',
      todayAction: {decision: decision || {}}
    }, new Date(), {force: true});
    results.push({
      appId: appId,
      game: name,
      ok: true,
      alias: '',
      status: PLAYER_ALIAS_STATUS_PENDING_,
      enqueued: queued.enqueued,
      jobId: queued.jobId,
      beforeStatus: before && before.status || '',
      beforeSearchTerm: before && before.searchTerm || ''
    });
  });

  SpreadsheetApp.flush();
  return {
    ok: true,
    repairedCount: results.filter(item => item.ok).length,
    enqueuedCount: results.filter(item => item.enqueued).length,
    results: results,
    pendingJobs: loadPendingPlayerAliasDiscoveryJobs_(ss),
    note: 'Alias discovery enqueued for hotword-engine; wait for PLAYER_ALIAS_DISCOVERY callback'
  };
}

/**
 * 生产验证：检查指定候选的最新 ALIAS_DISCOVERY 记录，禁止永久 negative cache。
 * @param {Object} [params]
 * @return {Object}
 */
function verifyPlayerAliasDiscoveryProduction_(params) {
  params = params || {};
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const appIds = (params.appIds || params.app_ids || ['4075620', '4339280', '2445260'])
    .map(id => String(id || '').trim())
    .filter(Boolean);

  const checks = appIds.map(appId => {
    const latest = readLatestPlayerAliasAttempt_(ss, appId);
    const cached = readCachedPlayerSearchAlias_(ss, appId);
    const deferred = shouldDeferPlayerAliasDiscovery_(ss, appId);
    const evidenceRef = latest && latest.evidenceRef || '';
    const hasSourceDiag = /sources=/.test(evidenceRef) || /http=/.test(evidenceRef);
    const hasRanked = /ranked=/.test(evidenceRef);
    const status = latest && latest.status || '';
    const searchTerm = latest && latest.searchTerm || '';
    const permanentNoneSkip = searchTerm === '(none)' &&
      cached.found === false &&
      deferred === true &&
      status !== PLAYER_ALIAS_STATUS_NO_EVIDENCE_;
    const legacyPatternsOnlyNone = searchTerm === '(none)' &&
      /patterns=/.test(evidenceRef) &&
      !hasSourceDiag &&
      !/status=/.test(evidenceRef);
    const okStatus = status === PLAYER_ALIAS_STATUS_FOUND_ ||
      status === PLAYER_ALIAS_STATUS_NO_EVIDENCE_ ||
      status === PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_ ||
      status === PLAYER_ALIAS_STATUS_PENDING_;
    const evidenceOk = status === PLAYER_ALIAS_STATUS_FOUND_
      ? (hasSourceDiag || hasRanked || /source_urls=/.test(evidenceRef))
      : (hasSourceDiag || status === PLAYER_ALIAS_STATUS_RETRIEVAL_FAILED_ ||
        status === PLAYER_ALIAS_STATUS_PENDING_);
    return {
      appId: appId,
      ok: !!(latest && okStatus && evidenceOk && !permanentNoneSkip && !legacyPatternsOnlyNone),
      status: status,
      searchTerm: searchTerm,
      alias: cached.alias || '',
      foundCacheHit: cached.found,
      deferred: deferred,
      hasSourceDiag: hasSourceDiag,
      hasRanked: hasRanked,
      permanentNoneSkip: permanentNoneSkip,
      legacyPatternsOnlyNone: legacyPatternsOnlyNone,
      evidenceRefPreview: evidenceRef.slice(0, 500),
      researchId: latest && latest.researchId || ''
    };
  });

  const todayAliases = readTodayActionSearchAliasesProduction_(ss, appIds);
  return {
    ok: checks.every(item => item.ok),
    checks: checks,
    todayActionAliases: todayAliases,
    rules: {
      cacheHitOnlyRealAlias: true,
      retrievalFailedAlwaysRetry: true,
      noAliasEvidenceRecheckDays: PLAYER_ALIAS_NO_EVIDENCE_RECHECK_DAYS_,
      forbidden: 'SearchTerm=(none) with only patterns=... permanently skipped'
    }
  };
}

/**
 * @param {Object} ss
 * @return {Array<{appId:string,game:string,searchTerm:string,status:string}>}
 */
function listPlayerAliasNoneCandidates_(ss) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const appColumn = headers.indexOf('AppID');
  const gameColumn = headers.indexOf('Game');
  const verdictColumn = headers.indexOf('TrendVerdict');
  const searchColumn = headers.indexOf('SearchTerm');
  const evidenceColumn = headers.indexOf('EvidenceRef');
  if (appColumn < 0 || verdictColumn < 0 || searchColumn < 0) return [];

  const byApp = new Map();
  sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues().forEach(row => {
    if (String(row[verdictColumn] || '').trim().toUpperCase() !== PLAYER_ALIAS_DISCOVERY_VERDICT_) return;
    const appId = String(row[appColumn] || '').trim();
    if (!appId) return;
    const searchTerm = String(row[searchColumn] || '').trim();
    const evidenceRef = evidenceColumn >= 0 ? String(row[evidenceColumn] || '') : '';
    const status = playerAliasParseStatusFromEvidence_(evidenceRef, searchTerm);
    byApp.set(appId, {
      appId: appId,
      game: gameColumn >= 0 ? String(row[gameColumn] || '').trim() : '',
      searchTerm: searchTerm,
      status: status
    });
  });

  return Array.from(byApp.values()).filter(item => {
    if (item.searchTerm && item.searchTerm !== '(none)') return false;
    return item.status !== PLAYER_ALIAS_STATUS_FOUND_;
  });
}

/**
 * @param {Object} ss
 * @param {Array<string>} appIds
 * @return {Array<Object>}
 */
function readTodayActionSearchAliasesProduction_(ss, appIds) {
  const sheetName = HOTWORD_V2.sheets.action || '今日行动';
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(sheetName) : null;
  if (!sheet || sheet.getLastRow() < 4) return [];
  const headerWidth = Math.max(
    sheet.getLastColumn(),
    HOTWORD_V2.actionHeaders ? HOTWORD_V2.actionHeaders.length : 1
  );
  const headers = sheet.getRange(3, 1, 3, headerWidth).getDisplayValues()[0];
  const appColumn = headers.indexOf('Steam App ID');
  const nameColumn = headers.indexOf('游戏名称');
  const aliasColumn = headers.indexOf('搜索别名');
  const trendsColumn = headers.indexOf('Google Trends链接');
  if (appColumn < 0) return [];
  const wanted = new Set((appIds || []).map(id => String(id || '').trim()).filter(Boolean));
  const rows = [];
  const dataHeight = sheet.getLastRow() - 3;
  if (dataHeight < 1) return [];
  sheet.getRange(4, 1, sheet.getLastRow(), headerWidth).getDisplayValues().forEach(row => {
    const appId = String(row[appColumn] || '').trim();
    if (!appId) return;
    if (wanted.size && !wanted.has(appId)) return;
    rows.push({
      appId: appId,
      game: nameColumn >= 0 ? String(row[nameColumn] || '').trim() : '',
      searchAlias: aliasColumn >= 0 ? String(row[aliasColumn] || '').trim() : '',
      trendsLink: trendsColumn >= 0 ? String(row[trendsColumn] || '').trim() : ''
    });
  });
  return rows;
}

function playerAliasLookupGameNameFromTrends_(ss, appId) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  if (!sheet || sheet.getLastRow() < 2) return '';
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const appColumn = headers.indexOf('AppID');
  const gameColumn = headers.indexOf('Game');
  if (appColumn < 0 || gameColumn < 0) return '';
  let name = '';
  sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues().forEach(row => {
    if (String(row[appColumn] || '').trim() !== String(appId || '').trim()) return;
    const candidate = String(row[gameColumn] || '').trim();
    if (candidate) name = candidate;
  });
  return name;
}

function playerAliasDateText_(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (isNaN(value.getTime())) return '';
  try {
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      return Utilities.formatDate(value, 'Asia/Shanghai', 'yyyy-MM-dd');
    }
  } catch (err) {
    // fall through for local tests
  }
  return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
}

function playerAliasHashKey_(text) {
  const raw = String(text || '');
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
    return digest.slice(0, 6).map(byte => {
      const hex = (byte < 0 ? byte + 256 : byte).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return String(Math.abs(hash));
}

function playerAliasEvidenceSummary_(discovery) {
  const parts = [];
  const status = discovery && discovery.status ? discovery.status : '';
  if (status) parts.push('status=' + status);
  if (discovery && discovery.jobId) parts.push('job_id=' + discovery.jobId);
  if (discovery && discovery.steamUrl) parts.push('steam_url=' + discovery.steamUrl);
  if (discovery && discovery.resultPath) parts.push('result_path=' + discovery.resultPath);
  if (discovery && discovery.error) parts.push('error=' + String(discovery.error).slice(0, 160));
  if (discovery && discovery.patterns && discovery.patterns.length) {
    parts.push('patterns=' + discovery.patterns.join('; '));
  }
  if (discovery && discovery.sourceDiags && discovery.sourceDiags.length) {
    parts.push('sources=' + discovery.sourceDiags.map(playerAliasFormatSourceDiag_).join('; '));
  }
  const sourceUrls = discovery && discovery.sourceUrls && discovery.sourceUrls.length
    ? discovery.sourceUrls
    : playerAliasCollectSourceUrls_(discovery && discovery.evidence || []);
  if (sourceUrls.length) {
    parts.push('source_urls=' + sourceUrls.slice(0, 12).join(' ; '));
    parts.push('source_count=' + (discovery && discovery.sourceCount != null
      ? discovery.sourceCount : sourceUrls.length));
  }
  (discovery && discovery.evidence || []).slice(0, 12).forEach(item => {
    const url = String(item.url || '').trim();
    parts.push(String(item.source || 'unknown') + ': ' +
      String(item.title || item.snippet || '').slice(0, 120) +
      (url ? ' <' + url + '>' : ''));
  });
  if (discovery && discovery.ranked && discovery.ranked.length) {
    parts.push('ranked=' + discovery.ranked.map(entry =>
      entry.text + '(' + entry.hits + ' hits/' + (entry.sources || []).join('+') + ')'
    ).join('; '));
  }
  return parts.join(' | ').slice(0, 4500);
}

function playerAliasCollectSourceUrls_(evidence) {
  const urls = [];
  const seen = new Set();
  (evidence || []).forEach(item => {
    const url = String(item && item.url || '').trim();
    if (!url || seen.has(url)) return;
    if (url.indexOf('http') !== 0) return;
    seen.add(url);
    urls.push(url);
  });
  return urls;
}

function playerAliasSteamUrlFromEvidence_(evidenceRef) {
  const match = /(?:^|\|\s*)steam_url=(https?:\/\/[^\s|]+)/.exec(String(evidenceRef || ''));
  return match && match[1] ? match[1].trim() : '';
}

function playerAliasFormatSourceDiag_(diag) {
  const item = diag || {};
  const httpStatus = item.httpStatus != null ? item.httpStatus
    : (item.http_status != null ? item.http_status : null);
  const parseCount = item.parseCount != null ? item.parseCount
    : (item.parse_count != null ? item.parse_count : 0);
  return String(item.source || 'unknown') +
    '(http=' + (httpStatus == null ? '?' : httpStatus) +
    ',empty=' + (item.empty ? '1' : '0') +
    ',parsed=' + parseCount +
    ',ok=' + (item.ok ? '1' : '0') +
    (item.error ? ',err=' + String(item.error).slice(0, 80) : '') +
    ')';
}

function playerAliasParseStatusFromEvidence_(evidenceRef, searchTerm) {
  const text = String(evidenceRef || '');
  const match = /(?:^|\||\s)status=([A-Z_]+)/.exec(text);
  if (match && match[1]) return match[1];
  const alias = String(searchTerm || '').trim();
  if (alias && alias !== '(none)') return PLAYER_ALIAS_STATUS_FOUND_;
  // 历史假阴性：只有 patterns=...、SearchTerm=(none)、无 status → 视为需重试，不当成功
  return '';
}

function playerAliasParseRecordedAt_(recordedRaw, dateRaw) {
  if (recordedRaw instanceof Date && !isNaN(recordedRaw.getTime())) return recordedRaw;
  const recordedText = String(recordedRaw || '').trim();
  if (recordedText) {
    const parsed = new Date(recordedText);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  const dateText = String(dateRaw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    const parsed = new Date(dateText + 'T00:00:00+08:00');
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function playerAliasAttemptIsNewer_(left, right) {
  const leftTime = left && left.recordedAt instanceof Date ? left.recordedAt.getTime() : 0;
  const rightTime = right && right.recordedAt instanceof Date ? right.recordedAt.getTime() : 0;
  return leftTime >= rightTime;
}

function playerAliasIsDueForRecheck_(recordedAt, days) {
  if (!(recordedAt instanceof Date) || isNaN(recordedAt.getTime())) return true;
  const windowMs = Math.max(1, Number(days) || PLAYER_ALIAS_NO_EVIDENCE_RECHECK_DAYS_) * 24 * 60 * 60 * 1000;
  return (Date.now() - recordedAt.getTime()) >= windowMs;
}

function playerAliasGenerateEvidencePatterns_(officialName) {
  const patterns = new Set();
  const cleaned = playerAliasCleanName_(officialName);
  if (cleaned) patterns.add(cleaned);

  const noSubtitle = playerAliasRemoveSubtitle_(cleaned);
  if (noSubtitle && noSubtitle !== cleaned) patterns.add(noSubtitle);

  playerAliasRomanVariants_(cleaned).forEach(item => patterns.add(item));

  const colonIdx = cleaned.indexOf(':');
  if (colonIdx > 0) {
    const main = playerAliasCleanName_(cleaned.slice(0, colonIdx));
    const sub = playerAliasCleanName_(cleaned.slice(colonIdx + 1));
    if (main && sub) {
      patterns.add(main + ' ' + sub);
      playerAliasRomanVariants_(main + ' ' + sub).forEach(item => patterns.add(item));
      // 主标题本身常是玩家搜索简称（如 Combolands / ShipShaper），需证据命中后才采用
      if (main.length >= 4) patterns.add(main);
      if (sub.length >= 8) patterns.add(sub);
    }
  }

  return Array.from(patterns).filter(item => item && item.length >= 3);
}

/**
 * @return {{snippets:Array<Object>,sourceDiags:Array<Object>}}
 */
function playerAliasCollectSearchSnippets_(gameName, appId, steamUrl, fetchImpl) {
  const fetchFn = fetchImpl || playerAliasFetchText_;
  const query = playerAliasCleanName_(gameName);
  const snippets = [];
  const sourceDiags = [];
  const push = (source, title, snippet, url) => {
    const text = String(title || '').trim();
    const body = String(snippet || '').trim();
    if (!text && !body) return;
    snippets.push({source: source, title: text, snippet: body, url: String(url || '').trim()});
  };

  const reddit = playerAliasSearchReddit_(query, appId, fetchFn);
  sourceDiags.push(reddit.diag);
  reddit.items.forEach(item => push('reddit', item.title, item.snippet, item.url));

  const youtube = playerAliasSearchYouTube_(query, appId, fetchFn);
  sourceDiags.push(youtube.diag);
  youtube.items.forEach(item => push('youtube', item.title, item.snippet, item.url));

  const steam = playerAliasSearchSteamCommunity_(query, appId, steamUrl, fetchFn);
  sourceDiags.push(steam.diag);
  steam.items.forEach(item => push('steam_community', item.title, item.snippet, item.url));

  const google = playerAliasSearchGoogle_(query, appId, fetchFn);
  sourceDiags.push(google.diag);
  google.items.forEach(item => push('google', item.title, item.snippet, item.url));

  return {snippets: snippets, sourceDiags: sourceDiags};
}

/**
 * 兼容旧 fetchImpl：若返回字符串则包成结果对象；新实现可直接返回 {text,httpStatus,empty,error}。
 * @param {Function} fetchFn
 * @param {string} url
 * @return {{text:string,httpStatus:number|null,empty:boolean,error:string}}
 */
function playerAliasInvokeFetch_(fetchFn, url) {
  try {
    const raw = fetchFn(url);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'text')) {
      const text = String(raw.text || '');
      return {
        text: text,
        httpStatus: raw.httpStatus == null ? (text ? 200 : null) : raw.httpStatus,
        empty: raw.empty != null ? !!raw.empty : !text,
        error: String(raw.error || '')
      };
    }
    const text = String(raw || '');
    return {
      text: text,
      httpStatus: text ? 200 : null,
      empty: !text,
      error: text ? '' : 'empty_response'
    };
  } catch (err) {
    return {
      text: '',
      httpStatus: null,
      empty: true,
      error: String(err && err.message || err || 'fetch_exception').slice(0, 160)
    };
  }
}

function playerAliasFetchText_(url, options) {
  options = options || {};
  if (typeof UrlFetchApp === 'undefined') {
    return {text: '', httpStatus: null, empty: true, error: 'UrlFetchApp_unavailable'};
  }
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SteamHotwordMonitor/1.0; +player-alias-discovery)',
        Accept: 'text/html,application/json'
      },
      validateHttpsCertificates: true
    });
    const httpStatus = resp.getResponseCode();
    const text = resp.getContentText('UTF-8') || '';
    if (httpStatus >= 400) {
      return {
        text: '',
        httpStatus: httpStatus,
        empty: true,
        error: 'http_' + httpStatus
      };
    }
    return {
      text: text,
      httpStatus: httpStatus,
      empty: !text,
      error: text ? '' : 'empty_body'
    };
  } catch (err) {
    return {
      text: '',
      httpStatus: null,
      empty: true,
      error: String(err && err.message || err || 'fetch_exception').slice(0, 160)
    };
  }
}

function playerAliasSearchReddit_(query, appId, fetchFn) {
  const q = query + ' steam';
  const urls = [
    'https://www.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance',
    'https://old.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance'
  ];
  const diag = {
    source: 'reddit',
    httpStatus: null,
    empty: true,
    parseCount: 0,
    ok: false,
    error: ''
  };
  for (let i = 0; i < urls.length; i += 1) {
    const fetched = playerAliasInvokeFetch_(fetchFn, urls[i]);
    diag.httpStatus = fetched.httpStatus;
    diag.empty = fetched.empty;
    if (fetched.error && !fetched.text) {
      diag.error = fetched.error;
      continue;
    }
    if (!fetched.text || fetched.text.charAt(0) !== '{') {
      diag.error = fetched.text ? 'non_json_body' : (fetched.error || 'empty_response');
      continue;
    }
    try {
      const data = JSON.parse(fetched.text);
      const rows = (data.data && data.data.children || []).map(child => {
        const item = child.data || {};
        return {
          title: item.title || '',
          snippet: String(item.selftext || '').slice(0, 240),
          url: item.permalink ? 'https://www.reddit.com' + item.permalink : ''
        };
      });
      diag.parseCount = rows.length;
      diag.ok = true;
      diag.error = '';
      return {items: rows, diag: diag};
    } catch (err) {
      diag.error = 'json_parse_error';
    }
  }
  return {items: [], diag: diag};
}

function playerAliasSearchYouTube_(query, appId, fetchFn) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query + ' steam game');
  const diag = {
    source: 'youtube',
    httpStatus: null,
    empty: true,
    parseCount: 0,
    ok: false,
    error: ''
  };
  const fetched = playerAliasInvokeFetch_(fetchFn, url);
  diag.httpStatus = fetched.httpStatus;
  diag.empty = fetched.empty;
  if (!fetched.text) {
    diag.error = fetched.error || 'empty_response';
    return {items: [], diag: diag};
  }
  const results = [];
  const titleRegex = /"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = titleRegex.exec(fetched.text)) && results.length < 20) {
    const title = playerAliasUnescapeJson_(match[1]);
    if (title) results.push({title: title, snippet: '', url: ''});
  }
  diag.parseCount = results.length;
  const looksLikeYouTube = fetched.text.indexOf('ytInitialData') >= 0 ||
    fetched.text.indexOf('ytd-app') >= 0 ||
    fetched.text.indexOf('ytInitialPlayerResponse') >= 0;
  // 解析到标题，或明确是 YouTube 结果页（可 0 条），才算抓取成功
  diag.ok = results.length > 0 || looksLikeYouTube;
  diag.error = diag.ok ? '' : (fetched.text.length > 500 ? 'unparseable_or_blocked_html' : 'short_or_blocked_html');
  return {items: results, diag: diag};
}

function playerAliasSearchSteamCommunity_(query, appId, steamUrl, fetchFn) {
  const app = String(appId || '').trim();
  const urls = [];
  if (app) {
    urls.push('https://steamcommunity.com/app/' + app + '/discussions/?fp=1');
    urls.push('https://steamcommunity.com/discussions/search/?q=' + encodeURIComponent(query) + '&app%5Bappid%5D=' + encodeURIComponent(app));
  } else {
    urls.push('https://steamcommunity.com/discussions/search/?q=' + encodeURIComponent(query + ' steam'));
  }
  const diag = {
    source: 'steam_community',
    httpStatus: null,
    empty: true,
    parseCount: 0,
    ok: false,
    error: ''
  };
  const results = [];
  let sawSuccessBody = false;
  let lastBody = '';
  urls.forEach(url => {
    const fetched = playerAliasInvokeFetch_(fetchFn, url);
    if (fetched.httpStatus != null) diag.httpStatus = fetched.httpStatus;
    if (fetched.httpStatus != null && fetched.httpStatus >= 400) {
      if (!diag.error) diag.error = fetched.error || ('http_' + fetched.httpStatus);
      return;
    }
    if (!fetched.text) {
      if (!diag.error) diag.error = fetched.error || 'empty_response';
      return;
    }
    diag.empty = false;
    sawSuccessBody = true;
    lastBody = fetched.text;
    const titleRegex = /<span class="title">([^<]+)<\/span>/gi;
    let match;
    while ((match = titleRegex.exec(fetched.text)) && results.length < 20) {
      results.push({title: playerAliasDecodeHtml_(match[1]), snippet: '', url: url});
    }
    const topicRegex = /data-tooltip-text="([^"]+)"/gi;
    while ((match = topicRegex.exec(fetched.text)) && results.length < 20) {
      results.push({title: playerAliasDecodeHtml_(match[1]), snippet: '', url: url});
    }
  });
  diag.parseCount = results.length;
  const looksLikeSteam = /forum_|discussion|responsive_tab|commentthread/i.test(lastBody);
  diag.ok = results.length > 0 || (sawSuccessBody && looksLikeSteam);
  diag.error = diag.ok ? '' : (diag.error || (sawSuccessBody ? 'unparseable_or_blocked_html' : 'all_requests_failed'));
  return {items: results, diag: diag};
}

function playerAliasSearchGoogle_(query, appId, fetchFn) {
  const searches = [
    query + ' steam game',
    'site:store.steampowered.com "' + query + '"'
  ];
  const diag = {
    source: 'google',
    httpStatus: null,
    empty: true,
    parseCount: 0,
    ok: false,
    error: ''
  };
  const results = [];
  let sawSuccessBody = false;
  let lastError = '';
  searches.forEach(q => {
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&num=10';
    const fetched = playerAliasInvokeFetch_(fetchFn, url);
    if (fetched.httpStatus != null) diag.httpStatus = fetched.httpStatus;
    if (fetched.error) lastError = fetched.error;
    if (fetched.httpStatus != null && fetched.httpStatus >= 400) {
      if (!diag.error) diag.error = fetched.error || ('http_' + fetched.httpStatus);
      return;
    }
    if (!fetched.text) {
      if (!diag.error) diag.error = fetched.error || 'empty_response';
      return;
    }
    diag.empty = false;
    sawSuccessBody = true;
    const blockRegex = /<(?:h3|div)[^>]*>([^<]{4,120})<\/(?:h3|div)>/gi;
    let match;
    while ((match = blockRegex.exec(fetched.text)) && results.length < 20) {
      const title = playerAliasDecodeHtml_(match[1].replace(/<[^>]+>/g, ' '));
      if (title && title.indexOf('http') < 0) results.push({title: title, snippet: '', url: ''});
    }
  });
  diag.parseCount = results.length;
  diag.ok = sawSuccessBody;
  if (diag.ok) diag.error = '';
  else if (!diag.error) diag.error = lastError || 'all_requests_failed';
  return {items: results, diag: diag};
}

function playerAliasRankCandidates_(officialName, patterns, snippets) {
  const scores = new Map();
  const officialKey = playerAliasNormalizeKey_(officialName);

  patterns.forEach(pattern => {
    if (!pattern || playerAliasNormalizeKey_(pattern) === officialKey) return;
    if (playerAliasIsSeriesOnlyAlias_(pattern, officialName)) return;
    const key = playerAliasNormalizeKey_(pattern);
    scores.set(key, {text: pattern, hits: 0, sources: new Set(), examples: []});
  });

  snippets.forEach(item => {
    const haystack = playerAliasNormalizeKey_(item.title + ' ' + item.snippet);
    if (!haystack) return;
    scores.forEach(entry => {
      const needle = playerAliasNormalizeKey_(entry.text);
      if (!needle || needle.length < 3) return;
      if (haystack.indexOf(needle) < 0) return;
      if (!playerAliasTextRefersToSameGame_(entry.text, officialName, item)) return;
      entry.hits += 1;
      entry.sources.add(item.source);
      if (entry.examples.length < 3) entry.examples.push(item);
    });
    playerAliasExtractAlternateNames_(item, officialName).forEach(name => {
      if (playerAliasIsSeriesOnlyAlias_(name, officialName)) return;
      const key = playerAliasNormalizeKey_(name);
      if (!key || key === officialKey) return;
      if (!playerAliasSharesCoreIdentity_(name, officialName)) return;
      const existing = scores.get(key);
      if (existing) {
        existing.hits += 1;
        existing.sources.add(item.source);
      } else {
        scores.set(key, {text: name, hits: 1, sources: new Set([item.source]), examples: [item]});
      }
    });
  });

  return Array.from(scores.values())
    .map(entry => ({
      text: entry.text,
      hits: entry.hits,
      sources: Array.from(entry.sources),
      examples: entry.examples
    }))
    .filter(entry => entry.hits > 0 && entry.sources.length > 0)
    .sort((left, right) => right.hits - left.hits || right.sources.length - left.sources.length || left.text.length - right.text.length);
}

function playerAliasExtractAlternateNames_(item, officialName) {
  const text = playerAliasCleanName_(item.title + ' ' + item.snippet);
  if (!text) return [];
  const out = new Set();
  const quoted = text.match(/["“]([^"”]{3,80})["”]/g) || [];
  quoted.forEach(raw => {
    const inner = playerAliasCleanName_(raw.replace(/^["“]+|["”]+$/g, ''));
    if (inner) out.add(inner);
  });
  playerAliasRomanVariants_(playerAliasCleanName_(officialName)).forEach(variant => out.add(variant));
  playerAliasGenerateEvidencePatterns_(officialName).forEach(pattern => out.add(pattern));
  return Array.from(out);
}

function playerAliasTextRefersToSameGame_(alias, officialName, item) {
  const aliasKey = playerAliasNormalizeKey_(alias);
  const officialKey = playerAliasNormalizeKey_(officialName);
  if (!aliasKey || aliasKey === officialKey) return false;
  const textKey = playerAliasNormalizeKey_(item.title + ' ' + item.snippet);
  if (textKey.indexOf(aliasKey) < 0) return false;
  const steamMarkers = ['steam', 'appid', String(item.url || '').indexOf('steampowered') >= 0 ? 'steamstore' : '', 'game'];
  const officialTokens = playerAliasCoreTokens_(officialName);
  const matchedTokens = officialTokens.filter(token => token.length > 2 && textKey.indexOf(token) >= 0);
  if (matchedTokens.length >= Math.min(2, officialTokens.length)) return true;
  return steamMarkers.some(marker => marker && textKey.indexOf(marker) >= 0) && matchedTokens.length >= 1;
}

function playerAliasSharesCoreIdentity_(alias, officialName) {
  const aliasTokens = playerAliasCoreTokens_(alias);
  const officialTokens = playerAliasCoreTokens_(officialName);
  if (!aliasTokens.length || !officialTokens.length) return false;
  const shared = aliasTokens.filter(token => officialTokens.indexOf(token) >= 0);
  return shared.length >= Math.min(2, officialTokens.length);
}

function playerAliasIsNumeralVariantOnly_(alias, officialName) {
  if (playerAliasNormalizeNumerals_(alias) !== playerAliasNormalizeNumerals_(officialName)) return false;
  const officialHasRoman = playerAliasContainsRomanNumeral_(officialName);
  const aliasHasRoman = playerAliasContainsRomanNumeral_(alias);
  const officialHasArabic = playerAliasContainsArabicSequel_(officialName);
  const aliasHasArabic = playerAliasContainsArabicSequel_(alias);
  // 官方罗马数字 → 玩家阿拉伯数字写法，保留（如 Mortal Shell II → Mortal Shell 2）
  if (officialHasRoman && aliasHasArabic && !aliasHasRoman) return false;
  // 官方已是阿拉伯数字，再换成罗马数字没有搜索价值
  if (officialHasArabic && aliasHasRoman && !aliasHasArabic) return true;
  return true;
}

function playerAliasContainsRomanNumeral_(text) {
  return /\b(I{1,3}|IV|VI{0,3}|IX|X|XI|XII)\b/i.test(playerAliasCleanName_(text));
}

function playerAliasContainsArabicSequel_(text) {
  return /\b\d{1,2}\b/.test(playerAliasCleanName_(text));
}

function playerAliasNormalizeNumerals_(text) {
  let out = playerAliasCleanName_(text);
  Object.keys(PLAYER_ALIAS_ROMAN_WORDS_).forEach(roman => {
    out = out.replace(new RegExp('\\b' + roman + '\\b', 'gi'), PLAYER_ALIAS_ROMAN_WORDS_[roman]);
  });
  return playerAliasNormalizeKey_(out);
}

/**
 * 冒号副标题单独作别名，且主标题更短更有识别度时，视为弱别名。
 * @param {string} alias
 * @param {string} officialName
 * @return {boolean}
 */
function playerAliasIsWeakSubtitleOnlyAlias_(alias, officialName) {
  const cleaned = playerAliasCleanName_(officialName);
  const idx = cleaned.indexOf(':');
  if (idx <= 0) return false;
  const main = playerAliasCleanName_(cleaned.slice(0, idx));
  const sub = playerAliasCleanName_(cleaned.slice(idx + 1));
  if (playerAliasNormalizeKey_(alias) !== playerAliasNormalizeKey_(sub)) return false;
  const mainWords = main.split(/\s+/).filter(Boolean);
  return mainWords.length > 0 && mainWords.length <= 2 && main.length <= 20;
}

function playerAliasIsSeriesOnlyAlias_(alias, officialName) {
  const officialSequel = playerAliasExtractSequelIndicator_(officialName);
  if (!officialSequel) return false;
  const aliasSequel = playerAliasExtractSequelIndicator_(alias);
  if (aliasSequel) return false;
  const officialBase = playerAliasStripSequelIndicator_(officialName);
  return playerAliasNormalizeKey_(alias) === playerAliasNormalizeKey_(officialBase);
}

function playerAliasExtractSequelIndicator_(name) {
  const text = playerAliasCleanName_(name);
  const roman = text.match(/\b(I{1,3}|IV|VI{0,3}|IX|X|XI|XII)\b/i);
  if (roman) return roman[1].toUpperCase();
  const arabic = text.match(/\b(\d{1,2})\b/);
  return arabic ? arabic[1] : '';
}

function playerAliasStripSequelIndicator_(name) {
  return playerAliasCleanName_(name)
    .replace(/\b(I{1,3}|IV|VI{0,3}|IX|X|XI|XII)\b/gi, '')
    .replace(/\b\d{1,2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function playerAliasRomanVariants_(name) {
  const out = new Set();
  const text = playerAliasCleanName_(name);
  Object.keys(PLAYER_ALIAS_ROMAN_WORDS_).forEach(roman => {
    const re = new RegExp('\\b' + roman + '\\b', 'g');
    if (re.test(text)) {
      out.add(text.replace(re, PLAYER_ALIAS_ROMAN_WORDS_[roman]).replace(/\s+/g, ' ').trim());
    }
  });
  Object.keys(PLAYER_ALIAS_ROMAN_WORDS_).forEach(roman => {
    const digit = PLAYER_ALIAS_ROMAN_WORDS_[roman];
    const re = new RegExp('\\b' + digit + '\\b', 'g');
    if (re.test(text)) {
      out.add(text.replace(re, roman).replace(/\s+/g, ' ').trim());
    }
  });
  return Array.from(out);
}

function playerAliasRemoveSubtitle_(name) {
  const text = playerAliasCleanName_(name);
  const idx = text.indexOf(':');
  if (idx <= 0) return text;
  const main = playerAliasCleanName_(text.slice(0, idx));
  const sub = playerAliasCleanName_(text.slice(idx + 1));
  return sub ? main + ' ' + sub : main;
}

function playerAliasCoreTokens_(name) {
  return playerAliasCleanName_(name).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && ['the', 'and', 'for', 'game', 'steam'].indexOf(token) < 0);
}

function playerAliasCleanName_(text) {
  return String(text || '')
    .replace(/[™®©]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[''\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function playerAliasNormalizeKey_(text) {
  return playerAliasCleanName_(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function playerAliasDecodeHtml_(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function playerAliasUnescapeJson_(text) {
  return playerAliasDecodeHtml_(String(text || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  ).replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
}
