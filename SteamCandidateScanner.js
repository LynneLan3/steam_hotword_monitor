/**
 * Steam 热词候选 0 → 1B 全自动化 V2.6
 *
 * 自动范围：
 * 0  Build同步：建站关键词规划中动作=Build 的游戏先 upsert 进历史游戏库
 * 0  候选发现：Steam Popular Upcoming + Popular New Releases
 * 0  历史去重：可靠 Steam App ID 优先、标准化名称兜底；占位 1337 不参与 App ID 去重
 * 0  数据补全：Followers / 7d Followers history / Steam reviews / release date
 * 1A 硬条件过滤：发售窗口、Followers、评论数、评分
 * 1B 增速分类：🔥趋势 / 🌱Early / 🏢大盘对照 / ⚪低优先级
 *
 * 1B 之后不自动处理：Google Trends / Social / Semrush / SERP / 建站判断继续人工。
 *
 * 数据源：
 * - 候选发现：Steam Store 公开搜索页
 * - Followers + 历史：Games Popularity API（免费 API Key）
 * - 评论数/评分：Steam 官方 User Reviews JSON 接口
 *
 * 说明：
 * - 不抓 SteamDB。SteamDB 官方 FAQ 明确不允许自动 scraping/crawling。
 * - Games Popularity API Key 只保存在 Apps Script Script Properties，不写入 Sheet。
 */

const HOTWORD_V2 = {
  version: '2.6.4',

  sheets: {
    usage: '使用说明',
    metrics: '指标说明',
    action: '今日行动',
    candidateSnapshot: '今日候选快照',
    decisions: '候选决策',
    master: '候选主表',
    keywordPlan: '建站关键词规划',
    snapshot: 'Steam_每日快照',
    rules: '规则配置',
    backtest: '1B规则回测',
    anomalies: '数据异常',
    log: '运行日志_V2',
    history: '历史游戏库',
    sitePool: '站点项目池',
    gscBinding: '项目GSC关联',
    externalEvidence: '外部证据记录',
  trendsResearch: 'Trends研究记录',
    externalDataAttempts: '外部数据获取尝试'
  },

  rawArchive: {
    folderName: 'Steam Raw Archive',
    filePrefix: 'steam_raw_',
    retentionDays: 60,
    triggerHandler: 'runSteamRawArchiveMaintenance'
  },
  diagnosticRetention: {
    externalDataAttemptsDays: 14,
    runLogDays: 30
  },

  monitoringHistory: {
    spreadsheetName: 'Steam_监控回测历史库',
    propertyKey: 'STEAM_MONITORING_HISTORY_SPREADSHEET_ID_V1',
    tables: {
      gameDaily: 'steam_game_daily',
      candidateDecision: 'steam_candidate_decision_history',
      build: 'steam_build_history',
      evidence: 'steam_external_evidence',
      runManifest: 'steam_run_manifest'
    }
  },

  // Canonical append-only raw history.  The ID is stored once in Script
  // Properties after first creation; the business Sheet remains a compatible
  // operational snapshot, not the sole long-term raw-data owner.
  historicalRawLedger: {
    spreadsheetName: 'Steam Historical Raw Ledger V1',
    // Known production identity; never silently create a second history file.
    spreadsheetId: '1iRJCrgmUBbjvWkKkRjrOPVkoWr0LH8RQq4HH9yA_b6E',
    propertyKey: 'STEAM_HISTORICAL_RAW_LEDGER_V1_SPREADSHEET_ID',
    sheetName: 'Raw Observations',
    schemaVersion: 'steam_historical_raw_ledger_v1',
    headers: [
      'Observation ID', 'Observed At', 'Run ID', 'Run Date', 'Steam App ID',
      '游戏名称', 'Steam URL', 'Source', 'Source Page', 'Source Rank',
      'Release Date', 'Release Date Raw', 'Release Stage', 'Days To Release',
      'Followers', 'Followers Baseline', 'Followers 7d Gain', 'Follower Growth Rate',
      'Review Count', 'Positive Reviews', 'Rating', 'Data Status',
      'Raw Observation Status', 'Provider', 'Provider Provenance', 'Schema Version'
    ]
  },

  /**
   * 旧 V1 兼容层：保留数据与兼容代码，不删除。
   * 「使用说明」已升级为 V2 正式入口，不再列入此列表。
   */
  legacySheets: [
    '概览', 'Steam_候选池', 'Steam_抓取日志', '配置'
  ],

  /**
   * 面向人的 Sheet 顺序（存在才排列；不存在不新建。
   * 「使用说明」「指标说明」由 ensure*GuideSheet_ 负责创建）。
   * 旧 V1 Tab 放在后面，再隐藏。
   */
  sheetUiOrder: [
    '今日行动',
    '今日候选快照',
    '站点项目池',
    '项目GSC关联',
    '候选决策',
    '候选主表',
    '外部证据记录',
    'Trends研究记录',
    'Steam_每日快照',
    '历史游戏库',
    '使用说明',
    '指标说明',
    '建站关键词规划',
    '规则配置',
    '1B规则回测',
    '数据异常',
    '运行日志_V2',
    '概览',
    'Steam_候选池',
    'Steam_抓取日志',
    '配置'
  ],

  /** 旧 V1 人工入口：只 hide，不删数据、不删兼容代码 */
  sheetUiHidden: [
    '概览', 'Steam_候选池', 'Steam_抓取日志', '配置'
  ],

  /** 「指标说明」表头（产品字典，不参与自动判断） */
  metricGuideHeaders: [
    '指标/字段',
    '主要出现位置',
    '类型',
    '数据来源',
    '当前口径 / 公式',
    '业务用途',
    '是否参与自动判断',
    '当前标准 / 阈值',
    '标准来源',
    '当前成熟度',
    'PM 注意事项'
  ],

  sources: [
    {
      name: 'Popular Upcoming',
      url: 'https://store.steampowered.com/search/?filter=popularcomingsoon&os=win'
    },
    {
      name: 'Popular New Releases',
      url: 'https://store.steampowered.com/search/?filter=popularnew&os=win&sort_by=Released_DESC'
    }
  ],

  /**
   * Steam 搜索页抓取可靠性（V2.6.2 最小修复）。
   * 不做代理/验证码绕过；只节流、有限重试、24h 成功缓存（分片写入 Script Properties）。
   */
  steamHttp: {
    /** 连续 Steam 页面请求之间的最小间隔（ms） */
    throttleMs: 1800,
    /** 429 最多尝试次数（含首次） */
    maxAttempts429: 4,
    /** 5xx / 网络临时错误最多尝试次数（含首次） */
    maxAttempts5xx: 3,
    /** 403 最多尝试次数（含首次；只允许一次恢复性重试） */
    maxAttempts403: 2,
    /** 403 恢复性重试前等待（ms） */
    recovery403Ms: 8000,
    /** 指数退避基数（ms）；实际等待 = base * 2^(attempt-1) + jitter */
    backoffBaseMs: 2000,
    backoffMaxMs: 60000,
    jitterMs: 800,
    /** 成功缓存最长可用时间 */
    cacheMaxAgeMs: 24 * 60 * 60 * 1000,
    /** 单片上限留余量（Script Properties 单值约 9KB） */
    cacheChunkMaxChars: 7500,
    cacheKeyPrefix: 'STEAM_SOURCE_CACHE_V262_',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  },

  gpBase: 'https://games-popularity.com/swagger/api',
  gpKeyProperty: 'GAMES_POPULARITY_API_KEY',
  gpForceRefreshProperty: 'GP_FORCE_REFRESH_ONCE_V1',

  masterHeaders: [
    '最后扫描时间', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名',
    'Steam 发布日期', '发布日原文', '发布阶段', '距发售天数',
    'Steam Followers', '7d基准Followers', 'Steam 7d Gain', '近似增长率', '增速覆盖天数',
    '评论数', '好评数', 'Steam评分',
    '1A结果', '1A排除原因', '第一轮类型', '第一轮优先级', '进入下一步', '下一步动作',
    '第一轮判定依据', '当前筛选阶段', '数据状态', '数据备注',
    '首次发现日期', '最后发现日期', '最近Run ID', '人工备注',
    '上次Qualification时间', '上次Qualification排名', 'Eligibility原因', 'Qualification状态'
  ],

  snapshotHeaders: [
    '运行时间', 'Run ID', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名',
    '发布阶段', 'Steam 发布日期', '距发售天数',
    'Steam Followers', '7d基准Followers', 'Steam 7d Gain', '近似增长率', '增速覆盖天数',
    '评论数', '好评数', 'Steam评分',
    '1A结果', '1A排除原因', '第一轮类型', '第一轮优先级', '进入下一步', '下一步动作',
    '数据状态', '数据备注',
    // G010：追加字段，不移动历史列；raw observation provenance/status。
    '来源页码', '原始观察状态'
  ],

  anomalyHeaders: [
    '运行时间', 'Run ID', 'Steam App ID', '游戏名称', '阶段', '异常类型', '异常详情', '建议动作', 'Steam URL'
  ],

  logHeaders: [
    '运行时间', 'Run ID', '运行状态', '发现唯一游戏', '历史排除', '数据补全成功',
    '1A通过', '1A排除', '🔥趋势', '🌱Early', '🏢对照', '⚪低优先级', '数据异常',
    '今日行动数', '耗时秒', '错误/警告',
    // G010 audit fields: raw coverage is separate from candidate input.
    'Raw唯一AppID', 'Raw行已持久化', 'Candidate输入数', 'Candidate范围',
    '🟡 Trend Watch', '🟢 Early Watch', '⏳1B历史不足',
    'GP缓存命中', 'GP实时请求', 'GP实时成功', 'GP429', 'GP失败保留旧值'
  ],

  // V1 contract: attempts are append-only and are not the successful
  // observation ledger. Credentials and request URLs are never persisted.
  externalDataAttemptHeaders: [
    '尝试时间', 'Run ID', 'Provider', 'Endpoint', 'Steam App ID', '游戏名称',
    '刷新原因', 'HTTP状态', '尝试结果', '错误摘要'
  ],

  candidateSnapshotHeaders: [
    '日期', 'Run ID', '游戏名称', 'Steam App ID', '优先级', '第一轮类型',
    'Steam Followers', 'Steam 7d Gain', '近似增长率', '发布阶段',
    'Steam 发布日期', '距发售天数', '触发原因'
  ],

  actionHeaders: [
    '行动类型', '优先级', '游戏名称', 'Steam App ID', '第一轮类型',
    'Steam Followers', 'Steam 7d Gain', '近似增长率',
    '发布阶段', 'Steam发布日期', '距发售天数', '评论数', 'Steam评分',
    '搜索别名', 'Google Trends链接', 'Trends结果',
    'Social结果', 'SERP竞争', '关键词机会',
    '机器推荐', '机器置信度', '机器推荐理由',
    '人工决定', '人工备注', '最终状态',
    '当前阶段', '研究状态', '研究完成度', '人工动作', '触发原因', '上次人工检查日',
    'Steam URL', '判定依据',
    '推荐域名', '首年价', '注册商', '购买域名'
  ],

  decisionHeaders: [
    'Steam App ID', '游戏名称', '决策状态', '上次人工检查日', '上次检查7d Gain',
    '上次检查类型', '下次复查日', '决策备注', '上次检查时决策状态',
    '首次发现日期', '首次来源', '第一轮类型', '当前Steam阶段', '研究状态',
    'Google Trends结果', 'Social结果', 'SERP竞争', '关键词机会', '人工备注',
    'Decision', 'Decision日期', 'Next Action',
    // Phase 7C-2：append-only Steam Opportunity identity；旧列位置不移动。
    'OpportunityID',
    // M7A：append-only automatic Candidate Research queue/result fields。
    'ResearchJobID', '自动研究状态', '自动研究时间', '自动Social摘要',
    '自动SERP摘要', '自动研究结果路径',
    // M7C：append-only callback recommendation fields；不覆盖人工字段。
    '自动Recommendation', '自动Recommendation置信度', '自动Recommendation理由',
    '自动缺失证据', '自动Recommendation结果路径', '自动研究错误',
    '自动BUILD依据', '自动BUILD Thesis', 'DecisionID',
    'MachineDecision', 'MachineDecisionReason', 'RecommendedDomain', 'DomainTLD',
    'DomainFirstYearPrice', 'DomainRegistrar', 'DomainPurchaseURL', 'DomainCheckedAt',
    'DomainAlternative1', 'DomainAlternative1Price', 'DomainAlternative1PurchaseURL',
    'DomainAlternative2', 'DomainAlternative2Price', 'DomainAlternative2PurchaseURL',
    // Candidate External Signal Loop v1：append-only structured Trends summary.
    'TrendRelativeStrength', 'TrendVerdict', 'TrendLastChecked', 'ExternalSignal', 'FinalResearchStage',
    // Steam Candidate automatic preflight; append-only and human-readable.
    'PreflightVerdict', 'PreflightCheckedAt', 'PreflightReason'
  ],

  /** Site ID is a cross-system reference; Steam runtime preserves existing values and never rewrites them. */
  sitePoolHeaders: ['Site ID', '游戏名称', 'Steam App ID', '当前状态', 'BUILD日期', 'Build状态', 'Repo URL', 'Vercel URL', '上线日期', '模板版本', 'GSC状态', 'GSC Site', 'GSC URL Prefix', 'GSC Last Sync', 'SEO阶段', 'Index状态', '首次曝光日期', 'Clicks', 'Impressions', 'CTR', 'Average Position', 'OpportunityID', 'ExperimentType', 'ActualLiveAt', 'LaunchPageCount'],
  gscBindingHeaders: ['Site ID', '游戏名称', 'Steam App ID', '网站URL', 'GSC Property', 'GSC状态', '首次同步日期', '最近同步日期'],
  /** Phase 4.4：独立 GSC 监控 Spreadsheet，只读。 */
  GSC_SOURCE_SPREADSHEET_ID: '15GJGvPnJlXTSbO4aM_Yxvf0GxCgXrmZr0M5b9uZGIJU',
  GSC_SOURCE_SHEET_NAME: '每日快照',

  /** 人工 Google Trends 研究默认环境（仅用于「今日行动」快捷链接） */
  trendsExplore: {
    date: 'today 1-m',
    geo: 'US'
  }
};

const STEAM_CANDIDATE_RESEARCH_JOB_TYPE = 'STEAM_CANDIDATE_RESEARCH';
const UNIFIED_CANDIDATE_UPSERT_JOB_TYPE = 'UNIFIED_CANDIDATE_UPSERT';
const STEAM_CANDIDATE_RESEARCH_PENDING = 'PENDING';
const STEAM_CANDIDATE_RESEARCH_CHECKS = ['GAME_WIDE_SOCIAL', 'GOOGLE_ORGANIC_SERP'];
const STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN_PROP = 'STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN';
const STEAM_CANDIDATE_RESEARCH_EXEC_COMPLETED = 'COMPLETED';
const STEAM_CANDIDATE_RESEARCH_EXEC_FAILED = 'FAILED';
const STEAM_PREFLIGHT_ENABLED = true;
const PREFLIGHT_MAX_SERP_QUERIES_PER_CANDIDATE = 3;
const PREFLIGHT_DEDICATED_DOMAIN_REJECT_MIN = 2;
const STEAM_PREFLIGHT_VERDICTS = {AUTO_REJECT: true, WATCH: true, MANUAL_REVIEW: true, PREFLIGHT_ERROR: true};
// Candidate Main's canonical 1A pass labels are explicit state values. Keep
// the historical bare label for existing rows, but do not broaden this into
// a substring/contains match that could admit exclusions or anomalies.
const STEAM_CANDIDATE_1A_PASS_RESULTS = {
  '✅ 通过（主池）': true,
  '✅ 通过（对照预留）': true,
  '通过': true
};
const STEAM_CANDIDATE_RECOMMENDATIONS = {
  RECOMMEND_BUILD: true,
  RECOMMEND_WATCH: true,
  RECOMMEND_REJECT: true,
  BUILD: true,
  WATCH: true,
  REJECT: true,
  INSUFFICIENT_EVIDENCE: true
};
const STEAM_CANDIDATE_RESEARCH_CONFIDENCES = { HIGH: true, MEDIUM: true, LOW: true };
const QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID = '1WVg2p_Vero3MB2JN4yxmtHkLQRgkWO2mz95X4ms9nLE';
// G010 daily discovery: each Steam source is hard-capped at 5 pages (~250 unique
// after merge). Continuation is same-run/same-day only; scheduled daily runs
// always start a fresh Run ID at page 1.
const STEAM_DISCOVERY_RUNTIME_BUDGET_MS = 4 * 60 * 1000;
const G010_DISCOVERY_MAX_PAGES = 5;
const G010_DISCOVERY_TARGET_UNIQUE = 250;
const G010_PAGE_RECOVERY_MAX_ATTEMPTS = 3;
const G010_PAGE_RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const G010_ENRICHMENT_CHUNK_SIZE = 35;
const G010_EXECUTION_BUDGET_MS = 330000;
const G010_STATE_KEYS = {
  runId: 'G010_RUN_ID', phase: 'G010_PHASE', source: 'G010_SOURCE',
  nextPage: 'G010_NEXT_PAGE', enrichmentCursor: 'G010_ENRICHMENT_CURSOR',
  controlCursor: 'G010_CONTROL_CURSOR',
  controlData: 'G010_CONTROL_DATA',
  runDate: 'G010_RUN_DATE', updatedAt: 'G010_UPDATED_AT',
  consecutiveNoNew: 'G010_CONSECUTIVE_NO_NEW', runStartedAt: 'G010_RUN_STARTED_AT',
  discoveryAudit: 'G010_DISCOVERY_AUDIT', discoveryComplete: 'G010_DISCOVERY_COMPLETE',
  runStats: 'G010_RUN_STATS', segmentCount: 'G010_SEGMENT_COUNT',
  pageRetryCount: 'G010_PAGE_RETRY_COUNT', pageRetryStartedAt: 'G010_PAGE_RETRY_STARTED_AT',
  nextRetryAt: 'G010_NEXT_RETRY_AT', ledgerWriteFailures: 'G010_RAW_LEDGER_WRITE_FAILURES',
  ledgerAppended: 'G010_RAW_LEDGER_APPENDED', ledgerDuplicates: 'G010_RAW_LEDGER_DUPLICATES'
};
const G010_CONTINUATION_HANDLER = 'runG010Continuation_';
const G010_DAILY_HANDLER = 'runSteamHotwordDaily_';
const G010_403_CONTINUATION_DELAY_MS = 3 * 60 * 1000;
const G010_ENRICHMENT_CONTINUATION_DELAY_MS = 45 * 1000;
const G010_CONTINUATION_STALE_MS = 10 * 60 * 1000;
const G010_CONTINUATION_TTL_MS = 12 * 60 * 60 * 1000;
const G010_ABANDON_RUN_IDS = ['20260831-084334'];


// ============================================================================
// 菜单 + 兼容入口
// ============================================================================

function onOpen() {
  try { g010MaybeKickPartialRun_(); } catch (kickErr) { /* non-blocking */ }
  SpreadsheetApp.getUi()
    .createMenu('Steam 0→1B')
    .addItem('立即运行 0→1B', 'runSteamHotword01B')
    .addItem('刷新今日行动', 'refreshTodayActionsFromCandidateDecisions')
    .addSeparator()
    .addItem('系统状态', 'showSteamSystemStatus')
    .addSeparator()
    .addItem('管理员：API Key', 'checkGamesPopularityApiKey')
    .addItem('管理员：重装自动触发器', 'installDailyHotwordTrigger')
    .addToUi();
}

/** Web App POST: accepts only the Steam Candidate Research callback contract. */
function doGet(e) {
  const action = e && e.parameter ? String(e.parameter.action || '').trim() : '';
  if (action === 'g010StartNewDailyRun') {
    return ContentService.createTextOutput(JSON.stringify(runSteamHotwordDaily_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'g010KickContinuation') {
    return ContentService.createTextOutput(JSON.stringify(g010MaybeKickPartialRun_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'g010ContinueSegment') {
    return ContentService.createTextOutput(JSON.stringify(g010ContinueActiveRunOnce_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'g022Readback') {
    return ContentService.createTextOutput(JSON.stringify(g022Readback_(e.parameter.runId || '')))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'g022RepairRunLedger') {
    const requestedRunId = String(e.parameter.runId || '');
    const repairResult = requestedRunId === 'all'
      ? ['20260901-134739', '20260901-141358'].map(g022RepairRunLedgerEnrichmentStats_)
      : g022RepairRunLedgerEnrichmentStats_(requestedRunId);
    return ContentService.createTextOutput(JSON.stringify(repairResult))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'pendingSteamCandidateResearchJobs') {
    const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
    return ContentService
      .createTextOutput(JSON.stringify({ jobs: loadPendingSteamCandidateResearchJobs_(ss) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'inspectSteamCandidateInboxProduction') {
    return ContentService
      .createTextOutput(JSON.stringify(inspectSteamCandidateInboxProduction_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'refreshTodayActionsProduction') {
    const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
    return ContentService
      .createTextOutput(JSON.stringify(refreshTodayActionsFromCandidateDecisions_(ss)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'recoverSteamCandidateResearchProduction') {
    const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      return ContentService.createTextOutput(JSON.stringify({ok: false, error: 'RECOVERY_LOCK_BUSY'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    try {
      const masterRepair = repairMasterAppIdsFromSteamUrl_(ss);
      const snapshotRepair = repairProductionCandidatesFromSnapshot_(ss, ['Anime Shop Simulator']);
      const staleRepair = repairStalePendingResearchJobs_(ss);
      const reasonBackfill = backfillMachineRecommendationReasons_(ss);
      const queue = enqueueSteamCandidateResearchJobs_(ss, new Date());
      const forceQueue = forceEnqueueProductionResearch_(ss, ['3393280'], new Date());
      const refresh = refreshTodayActionsFromCandidateDecisions_(ss);
      SpreadsheetApp.flush();
      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        masterRepair: masterRepair,
        snapshotRepair: snapshotRepair,
        staleRepair: staleRepair,
        reasonBackfill: reasonBackfill,
        queue: queue,
        forceQueue: forceQueue,
        refresh: refresh
      }))
        .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  }
  if (action === 'verifyTrendsRecalcProduction') {
    return ContentService
      .createTextOutput(JSON.stringify(verifyTrendsRecalcProduction_(e && e.parameter || {})))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'repairPlayerAliasFalseNegativesProduction') {
    const rawAppIds = e && e.parameter ? String(e.parameter.app_ids || e.parameter.appIds || '').trim() : '';
    const appIds = rawAppIds
      ? rawAppIds.split(/[,\s]+/).map(id => String(id || '').trim()).filter(Boolean)
      : [];
    return ContentService
      .createTextOutput(JSON.stringify(repairPlayerAliasFalseNegativesProduction_({appIds: appIds})))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'verifyPlayerAliasDiscoveryProduction') {
    const rawAppIds = e && e.parameter ? String(e.parameter.app_ids || e.parameter.appIds || '').trim() : '';
    const appIds = rawAppIds
      ? rawAppIds.split(/[,\s]+/).map(id => String(id || '').trim()).filter(Boolean)
      : ['4075620', '4339280', '2445260'];
    return ContentService
      .createTextOutput(JSON.stringify(verifyPlayerAliasDiscoveryProduction_({appIds: appIds})))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'searchProductionCandidateSources') {
    const query = e && e.parameter ? String(e.parameter.name || e.parameter.q || '').trim() : '';
    return ContentService
      .createTextOutput(JSON.stringify(searchProductionCandidateSources_(query)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'diagnoseEnqueueEligibility') {
    const appId = e && e.parameter ? String(e.parameter.steam_app_id || '').trim() : '';
    const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
    return ContentService
      .createTextOutput(JSON.stringify(diagnoseEnqueueEligibility_(ss, appId)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ error: 'unknown_action', jobs: [] }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Web App POST: Steam Candidate Research and unified-candidate upsert callbacks. */
function doPost(e) {
  try {
    const body = steamCandidateResearchParsePostJson_(e);
    if (!body) return steamCandidateResearchJsonOutput_({ok: false, error: 'invalid_json'});
    if (!checkSteamCandidateResearchWriteToken_(e, body)) {
      return steamCandidateResearchJsonOutput_({ok: false, error: 'unauthorized'});
    }
    const jobType = String(body.job_type || '').trim().toUpperCase();
    if (jobType === UNIFIED_CANDIDATE_UPSERT_JOB_TYPE) {
      return steamCandidateResearchJsonOutput_(handleUnifiedCandidateUpsertCallback_(body));
    }
    if (jobType !== STEAM_CANDIDATE_RESEARCH_JOB_TYPE) {
      return steamCandidateResearchJsonOutput_({ok: false, error: 'unsupported_job_type'});
    }
    return steamCandidateResearchJsonOutput_(handleSteamCandidateResearchCallback_(body));
  } catch (err) {
    return steamCandidateResearchJsonOutput_({
      ok: false,
      error: String((err && err.message) || err || 'unknown_error')
    });
  }
}

function steamCandidateResearchJsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function steamCandidateResearchParsePostJson_(e) {
  if (!e || !e.postData || e.postData.contents == null) return null;
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

function checkSteamCandidateResearchWriteToken_(e, body) {
  const expected = PropertiesService.getScriptProperties().getProperty(
    STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN_PROP
  );
  if (!expected) return false;
  let provided = body && body.token != null ? String(body.token).trim() : '';
  if (!provided && e && e.parameter && e.parameter.token != null) {
    provided = String(e.parameter.token).trim();
  }
  return provided !== '' && provided === expected;
}

/** Set once through Apps Script execution; token is never written to a Sheet or repository. */
function initSteamCandidateResearchWriteToken_() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN_PROP);
  if (existing) return {ok: false, error: 'already_configured'};
  const token = Utilities.getUuid().replace(/-/g, '');
  props.setProperty(STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN_PROP, token);
  return {ok: true, token: token};
}

function rotateSteamCandidateResearchWriteToken(token) {
  token = String(token || '').trim();
  if (!token) return {ok: false, error: 'empty_token'};
  PropertiesService.getScriptProperties().setProperty(
    STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN_PROP,
    token
  );
  return {ok: true, key: STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN_PROP};
}

function steamCandidateResearchCallbackString_(value) {
  return String(value == null ? '' : value).trim();
}

function steamCandidateResearchCallbackArray_(value) {
  if (Object.prototype.toString.call(value) !== '[object Array]') return [];
  return value.map(function (item) { return steamCandidateResearchCallbackString_(item); })
    .filter(function (item) { return item !== ''; });
}

function steamCandidateResearchCallbackNonNegativeNumber_(value, field) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) {
    return {ok: false, error: 'invalid_' + field};
  }
  return {ok: true, value: value};
}

function validateSteamCandidateResearchCallback_(body) {
  if (!body || Object.prototype.toString.call(body) !== '[object Object]') {
    return {ok: false, error: 'invalid_callback_body'};
  }
  const required = ['job_id', 'job_type', 'steam_app_id', 'game_name', 'research_cycle_date', 'execution_status'];
  for (let i = 0; i < required.length; i++) {
    if (!steamCandidateResearchCallbackString_(body[required[i]])) {
      return {ok: false, error: 'missing_' + required[i]};
    }
  }
  if (steamCandidateResearchCallbackString_(body.job_type).toUpperCase() !== STEAM_CANDIDATE_RESEARCH_JOB_TYPE) {
    return {ok: false, error: 'unsupported_job_type'};
  }
  const executionStatus = steamCandidateResearchCallbackString_(body.execution_status).toUpperCase();
  if (Object.prototype.hasOwnProperty.call(body, 'evidence') ||
      Object.prototype.hasOwnProperty.call(body, 'results') ||
      Object.prototype.hasOwnProperty.call(body, 'organic_results')) {
    return {ok: false, error: 'raw_evidence_not_allowed'};
  }
  // V1 preflight callback: deterministic queue verdict only. It intentionally
  // does not require the older M7B recommendation/social contract.
  if (steamCandidateResearchCallbackString_(body.preflight_verdict) &&
      !steamCandidateResearchCallbackString_(body.recommendation)) {
    const verdict = steamCandidateResearchCallbackString_(body.preflight_verdict).toUpperCase();
    if (!STEAM_PREFLIGHT_VERDICTS[verdict]) return {ok: false, error: 'invalid_preflight_verdict'};
    if (!steamCandidateResearchCallbackString_(body.preflight_checked_at)) return {ok: false, error: 'missing_preflight_checked_at'};
    if (!steamCandidateResearchCallbackString_(body.preflight_reason)) return {ok: false, error: 'missing_preflight_reason'};
    if (verdict === 'WATCH' && !steamCandidateResearchCallbackString_(body.next_review_date)) return {ok: false, error: 'missing_next_review_date'};
    if (executionStatus === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED && !steamCandidateResearchCallbackString_(body.error)) {
      return {ok: false, error: 'missing_error'};
    }
    if (executionStatus !== STEAM_CANDIDATE_RESEARCH_EXEC_COMPLETED && executionStatus !== STEAM_CANDIDATE_RESEARCH_EXEC_FAILED) {
      return {ok: false, error: 'invalid_execution_status'};
    }
    return {ok: true, executionStatus: executionStatus, preflight: true, verdict: verdict};
  }
  if (executionStatus === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED) {
    if (!steamCandidateResearchCallbackString_(body.error)) return {ok: false, error: 'missing_error'};
    if (Object.prototype.hasOwnProperty.call(body, 'recommendation')) {
      return {ok: false, error: 'failed_callback_must_not_include_recommendation'};
    }
    return {ok: true, executionStatus: executionStatus};
  }
  if (executionStatus !== STEAM_CANDIDATE_RESEARCH_EXEC_COMPLETED) {
    return {ok: false, error: 'invalid_execution_status'};
  }
  const recommendation = steamCandidateResearchCallbackString_(body.recommendation);
  const confidence = steamCandidateResearchCallbackString_(body.confidence);
  if (!STEAM_CANDIDATE_RECOMMENDATIONS[recommendation]) return {ok: false, error: 'invalid_recommendation'};
  if (!STEAM_CANDIDATE_RESEARCH_CONFIDENCES[confidence]) return {ok: false, error: 'invalid_confidence'};
  if (!steamCandidateResearchCallbackString_(body.completed_at)) return {ok: false, error: 'missing_completed_at'};
  if (!steamCandidateResearchCallbackString_(body.research_result_path) ||
      !steamCandidateResearchCallbackString_(body.recommendation_result_path)) {
    return {ok: false, error: 'missing_result_path'};
  }
  if (Object.prototype.toString.call(body.reasons) !== '[object Array]' ||
      Object.prototype.toString.call(body.blocking_reasons) !== '[object Array]' ||
      Object.prototype.toString.call(body.missing_evidence) !== '[object Array]') {
    return {ok: false, error: 'invalid_recommendation_arrays'};
  }
  const social = body.social_summary;
  const serp = body.serp_summary;
  if (!social || Object.prototype.toString.call(social) !== '[object Object]') {
    return {ok: false, error: 'missing_social_summary'};
  }
  if (!serp || Object.prototype.toString.call(serp) !== '[object Object]') {
    return {ok: false, error: 'missing_serp_summary'};
  }
  const socialStatus = steamCandidateResearchCallbackString_(social.status).toUpperCase();
  const serpStatus = steamCandidateResearchCallbackString_(serp.status).toUpperCase();
  if (['AVAILABLE', 'UNAVAILABLE'].indexOf(socialStatus) < 0) return {ok: false, error: 'invalid_social_status'};
  if (['AVAILABLE', 'UNAVAILABLE'].indexOf(serpStatus) < 0) return {ok: false, error: 'invalid_serp_status'};
  const socialFields = ['evidence_count', 'cluster_count', 'actionable_cluster_count', 'watch_cluster_count'];
  for (let j = 0; j < socialFields.length; j++) {
    const checked = steamCandidateResearchCallbackNonNegativeNumber_(social[socialFields[j]], socialFields[j]);
    if (!checked.ok) return checked;
  }
  const organic = steamCandidateResearchCallbackNonNegativeNumber_(serp.organic_count, 'organic_count');
  if (!organic.ok) return organic;
  const topics = social.top_topics;
  if (Object.prototype.toString.call(topics) !== '[object Array]' || topics.length > 10) {
    return {ok: false, error: 'invalid_top_topics'};
  }
  if (topics.some(function (topic) {
    const text = steamCandidateResearchCallbackString_(topic);
    return !text || /^https?:\/\//i.test(text);
  })) return {ok: false, error: 'invalid_top_topics'};
  return {ok: true, executionStatus: executionStatus};
}

function validateUnifiedCandidateUpsertCallback_(body) {
  if (!body || Object.prototype.toString.call(body) !== '[object Object]') {
    return {ok: false, error: 'invalid_callback_body'};
  }
  if (steamCandidateResearchCallbackString_(body.job_type).toUpperCase() !== UNIFIED_CANDIDATE_UPSERT_JOB_TYPE) {
    return {ok: false, error: 'unsupported_job_type'};
  }
  const required = ['run_id', 'observed_at', 'execution_status'];
  for (let i = 0; i < required.length; i++) {
    if (!steamCandidateResearchCallbackString_(body[required[i]])) {
      return {ok: false, error: 'missing_' + required[i]};
    }
  }
  const executionStatus = steamCandidateResearchCallbackString_(body.execution_status).toUpperCase();
  if (executionStatus !== STEAM_CANDIDATE_RESEARCH_EXEC_COMPLETED &&
      executionStatus !== STEAM_CANDIDATE_RESEARCH_EXEC_FAILED) {
    return {ok: false, error: 'invalid_execution_status'};
  }
  if (executionStatus === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED) {
    if (!steamCandidateResearchCallbackString_(body.error)) return {ok: false, error: 'missing_error'};
    return {ok: true, executionStatus: executionStatus};
  }
  if (Object.prototype.toString.call(body.candidates) !== '[object Array]') {
    return {ok: false, error: 'invalid_candidates'};
  }
  if (body.candidate_count != null) {
    const countCheck = steamCandidateResearchCallbackNonNegativeNumber_(body.candidate_count, 'candidate_count');
    if (!countCheck.ok) return countCheck;
    if (countCheck.value !== body.candidates.length) return {ok: false, error: 'candidate_count_mismatch'};
  }
  if (Object.prototype.hasOwnProperty.call(body, 'evidence') ||
      Object.prototype.hasOwnProperty.call(body, 'results') ||
      Object.prototype.hasOwnProperty.call(body, 'organic_results')) {
    return {ok: false, error: 'raw_evidence_not_allowed'};
  }
  return {ok: true, executionStatus: executionStatus};
}

function handleUnifiedCandidateUpsertCallback_(body) {
  const validation = validateUnifiedCandidateUpsertCallback_(body);
  if (!validation.ok) return validation;
  if (validation.executionStatus === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED) {
    return {
      ok: true,
      run_id: steamCandidateResearchCallbackString_(body.run_id),
      execution_status: validation.executionStatus,
      error: steamCandidateResearchCallbackString_(body.error)
    };
  }
  const result = upsertUnifiedCandidates_(SpreadsheetApp.getActiveSpreadsheet(), body.candidates);
  return Object.assign({
    ok: true,
    run_id: steamCandidateResearchCallbackString_(body.run_id),
    execution_status: validation.executionStatus
  }, result);
}

function steamCandidateResearchNameKey_(value) {
  return steamCandidateResearchCallbackString_(value).toLowerCase().replace(/\s+/g, ' ');
}

function steamCandidateResearchSetAutomaticField_(sheet, rowNumber, field, value) {
  candidateDecisionSetField_(sheet, rowNumber, field, value);
}

function steamCandidateResearchJoin_(value) {
  return steamCandidateResearchCallbackArray_(value).join(' | ');
}

function steamCandidateResearchSocialSummary_(summary) {
  const topics = steamCandidateResearchCallbackArray_(summary.top_topics);
  const verdict = steamCandidateResearchCallbackString_(summary.verdict);
  const oneLiner = steamCandidateResearchCallbackString_(summary.one_liner);
  if (verdict && oneLiner) return verdict + ' | ' + oneLiner;
  let text = steamCandidateResearchCallbackString_(summary.status).toUpperCase() +
    ' | evidence=' + summary.evidence_count +
    ' | clusters=' + summary.cluster_count +
    ' | actionable=' + summary.actionable_cluster_count;
  if (topics.length) text += ' | ' + topics.join(' / ');
  return text;
}

function normalizeMachineRecommendationDisplay_(value) {
  const normalized = steamCandidateResearchCallbackString_(value).toUpperCase();
  if (normalized === 'RECOMMEND_BUILD' || normalized === 'BUILD') return 'BUILD';
  if (normalized === 'RECOMMEND_WATCH' || normalized === 'WATCH') return 'WATCH';
  if (normalized === 'RECOMMEND_REJECT' || normalized === 'REJECT' || normalized === 'INSUFFICIENT_EVIDENCE') return 'REJECT';
  return '';
}

function deriveFinalStatus_(decision) {
  const human = normalizeDecisionStatus_(decision && (decision.status || decision.humanDecision));
  if (human) return human;
  return '待人工确认';
}

function machineResearchPending_(decision) {
  const status = steamCandidateResearchCallbackString_(decision && decision.autoResearchStatus).toUpperCase();
  return !status || status === 'PENDING' || status === 'RUNNING';
}

function machineResearchFailed_(decision) {
  return steamCandidateResearchCallbackString_(decision && decision.autoResearchStatus).toUpperCase() === 'FAILED';
}

function machineResearchComplete_(decision) {
  return steamCandidateResearchCallbackString_(decision && decision.autoResearchStatus).toUpperCase() === 'COMPLETED';
}

function formatMachineSocialDisplay_(decision) {
  const verdict = steamCandidateResearchCallbackString_(decision && decision.socialResult);
  const summary = steamCandidateResearchCallbackString_(decision && decision.autoSocialSummary);
  if (!verdict || verdict === '未检查') return summary || verdict || '';
  if (summary && summary.indexOf(' | ') >= 0) return summary;
  const oneLiner = summary && summary.indexOf(verdict + ' | ') === 0
    ? summary.slice(verdict.length + 3)
    : (summary || '');
  return oneLiner ? verdict + ' | ' + oneLiner : verdict;
}

function candidateInboxHumanAction_(rec, decision) {
  if (machineResearchPending_(decision)) return '机器研究中';
  if (machineResearchFailed_(decision)) return '机器研究失败，待复查';
  if (!hasCompletedManualResearchValue_(decision && decision.trendsResult)) return '检查 Google Trends';
  if (!normalizeDecisionStatus_(decision && decision.status)) return '选择 BUILD / WATCH / REJECT';
  return '';
}

function parseSteamCandidateRecalcEvidence_(decision) {
  const raw = String(decision && decision.autoBuildEvidence || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.recalc_evidence) return parsed.recalc_evidence;
    if (parsed && parsed.first_round_type) return parsed;
  } catch (err) {
    return null;
  }
  return null;
}

function normalizeSteamCandidateTrendsSignal_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === '强' || normalized === 'STRONG') return 'STRONG';
  if (normalized === '中' || normalized === 'MEDIUM') return 'MEDIUM';
  if (normalized === '弱' || normalized === '无' || normalized === 'WEAK' || normalized === 'NONE') return 'WEAK_OR_NONE';
  return 'UNKNOWN';
}

function normalizeSteamCandidateKeywordSignal_(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === '有' || normalized === 'YES' || normalized === 'PRESENT') return 'PRESENT';
  if (normalized === '无' || normalized === 'NO' || normalized === 'NOT_FOUND') return 'NOT_FOUND';
  return 'UNKNOWN';
}

function normalizeSteamCandidateFirstRoundSignal_(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (compact.indexOf('🔥') === 0 || compact.indexOf('趋势') >= 0 || compact.indexOf('Early') >= 0 || compact.indexOf('🌱') === 0) return 'STRONG';
  if (compact.indexOf('⚪') === 0 || compact.indexOf('低优先级') >= 0) return 'WEAK';
  return 'UNKNOWN';
}

function buildSteamCandidateRecommendationFromEvidence_(evidence, manualSignals) {
  const snapshot = evidence || {};
  const manual = manualSignals || {};
  const steamType = normalizeSteamCandidateFirstRoundSignal_(snapshot.first_round_type || manual.first_round_type);
  const trends = normalizeSteamCandidateTrendsSignal_(manual.trends_result || manual.trendsResult || snapshot.trends_result);
  const keyword = normalizeSteamCandidateKeywordSignal_(manual.keyword_opportunity || manual.keywordOpportunity || snapshot.keyword_opportunity);
  const actionableSocial = Number(snapshot.actionable_social_cluster_count || 0) >= 1;
  const highVideoUgc = !!snapshot.serp_high_video_ugc;
  const guideDensity = String(snapshot.serp_guide_density || 'UNKNOWN').toUpperCase();
  const highGuideDensity = guideDensity === 'HIGH';
  const lowGuideDensity = guideDensity === 'LOW';
  const reasons = [];
  const blockingReasons = [];
  const missingEvidence = [];
  if (!snapshot.social_available) missingEvidence.push('SOCIAL_EVIDENCE_NOT_AVAILABLE');
  if (!snapshot.serp_available) missingEvidence.push('SERP_EVIDENCE_NOT_AVAILABLE');
  if (trends === 'UNKNOWN') missingEvidence.push('TRENDS_NOT_AVAILABLE');
  if (keyword === 'UNKNOWN') missingEvidence.push('KEYWORD_OPPORTUNITY_NOT_AVAILABLE');

  const build = steamType === 'STRONG' && lowGuideDensity && (actionableSocial || highVideoUgc) && !highGuideDensity;
  const rejectWeakSteam = steamType === 'WEAK' && highGuideDensity && !actionableSocial;
  const rejectManual = trends === 'WEAK_OR_NONE' && keyword === 'NOT_FOUND' && highGuideDensity && !actionableSocial;
  let recommendation = 'RECOMMEND_WATCH';
  if (build) {
    recommendation = 'RECOMMEND_BUILD';
    reasons.push('STEAM_STRONG_EARLY_SIGNAL');
    if (lowGuideDensity) reasons.push('LOW_GUIDE_DENSITY');
    if (actionableSocial) reasons.push('ACTIONABLE_SOCIAL_PROBLEMS');
    if (highVideoUgc) reasons.push('HIGH_VIDEO_UGC_PRESENCE');
    if (trends === 'STRONG') reasons.push('TRENDS_STRONG');
    if (keyword === 'PRESENT') reasons.push('KEYWORD_OPPORTUNITY_PRESENT');
  } else if (rejectWeakSteam || rejectManual) {
    recommendation = 'RECOMMEND_REJECT';
    if (rejectWeakSteam) reasons.push('STEAM_WEAK_SIGNAL', 'HIGH_GUIDE_DENSITY');
    else reasons.push('TRENDS_WEAK_OR_NONE', 'KEYWORD_OPPORTUNITY_NOT_FOUND', 'HIGH_GUIDE_DENSITY');
    reasons.push('NO_ACTIONABLE_SOCIAL_PROBLEMS');
  } else {
    if (steamType !== 'STRONG') blockingReasons.push('STEAM_SIGNAL_NOT_STRONG');
    if (highGuideDensity) blockingReasons.push('HIGH_GUIDE_DENSITY');
    if (!actionableSocial && !highVideoUgc) blockingReasons.push('NO_ACTIONABLE_SOCIAL_PROBLEMS');
  }

  let confidence = 'LOW';
  if (steamType !== 'UNKNOWN') {
    if (snapshot.serp_available && snapshot.social_available) confidence = 'HIGH';
    else if (snapshot.serp_available || snapshot.social_available) confidence = 'MEDIUM';
  }
  return {
    recommendation: recommendation,
    confidence: confidence,
    reasons: reasons,
    blocking_reasons: blockingReasons,
    missing_evidence: missingEvidence
  };
}

function applySteamCandidateRecommendationToDecision_(decision, recommendation) {
  if (!decision || !recommendation) return decision;
  decision.autoRecommendation = recommendation.recommendation || '';
  decision.autoRecommendationConfidence = recommendation.confidence || '';
  decision.autoRecommendationReasons = steamCandidateResearchJoin_(recommendation.reasons) ||
    steamCandidateResearchJoin_(recommendation.blocking_reasons);
  decision.autoMissingEvidence = steamCandidateResearchJoin_(recommendation.missing_evidence);
  decision.machineDecision = normalizeMachineRecommendationDisplay_(recommendation.recommendation);
  decision.machineDecisionReason = steamCandidateResearchJoin_(recommendation.reasons) ||
    steamCandidateResearchJoin_(recommendation.blocking_reasons);
  return decision;
}

function recalculateSteamCandidateRecommendationFromTrends_(decision) {
  const evidence = parseSteamCandidateRecalcEvidence_(decision);
  if (!evidence || !machineResearchComplete_(decision)) return null;
  const recommendation = buildSteamCandidateRecommendationFromEvidence_(evidence, {
    trends_result: decision.trendsResult,
    keyword_opportunity: decision.keywordOpportunity
  });
  return applySteamCandidateRecommendationToDecision_(decision, recommendation);
}

function steamCandidateResearchSerpSummary_(summary) {
  return steamCandidateResearchCallbackString_(summary.status).toUpperCase() +
    ' | organic=' + summary.organic_count +
    ' | guide=' + steamCandidateResearchCallbackString_(summary.guide_density).toUpperCase() +
    ' | video_ugc=' + (summary.high_video_ugc ? 'yes' : 'no') +
    ' | contamination=' + (summary.contamination ? 'yes' : 'no');
}

function handleSteamCandidateResearchCallback_(body) {
  const validation = validateSteamCandidateResearchCallback_(body);
  if (!validation.ok) return validation;
  const appId = steamCandidateResearchCallbackString_(body.steam_app_id);
  const decisions = readCandidateDecisions_(SpreadsheetApp.getActiveSpreadsheet());
  const decision = decisions.get(appId);
  if (!decision) return {ok: false, error: 'candidate_not_found'};
  if (steamCandidateResearchCallbackString_(decision.researchJobId) !== steamCandidateResearchCallbackString_(body.job_id)) {
    return {ok: false, error: 'job_id_mismatch'};
  }
  if (steamCandidateResearchNameKey_(decision.name) !== steamCandidateResearchNameKey_(body.game_name)) {
    return {ok: false, error: 'game_name_mismatch'};
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet) return {ok: false, error: 'candidate_sheet_missing'};
  const status = validation.executionStatus;
  if (validation.preflight) {
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究状态', status === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED ? status : 'COMPLETED');
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究时间', body.preflight_checked_at);
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'PreflightVerdict', validation.verdict);
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'PreflightCheckedAt', body.preflight_checked_at);
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'PreflightReason', body.preflight_reason);
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究错误', status === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED ? body.error : '');
    if (validation.verdict === 'WATCH' && steamCandidateResearchCallbackString_(body.next_review_date)) {
      steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '下次复查日', body.next_review_date);
    }
    return {
      ok: true,
      job_id: body.job_id,
      execution_status: status,
      preflight_verdict: validation.verdict,
      today_action_refresh: refreshTodayActionsFromCandidateDecisions_()
    };
  }
  if (status === STEAM_CANDIDATE_RESEARCH_EXEC_FAILED) {
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究状态', status);
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究错误', steamCandidateResearchCallbackString_(body.error));
    ['自动Social摘要', '自动SERP摘要', '自动Recommendation', '自动Recommendation置信度',
      '自动Recommendation理由', '自动缺失证据', '自动Recommendation结果路径', '自动BUILD依据', '自动BUILD Thesis',
      'MachineDecision', 'MachineDecisionReason', 'RecommendedDomain', 'DomainTLD', 'DomainFirstYearPrice',
      'DomainRegistrar', 'DomainPurchaseURL', 'DomainCheckedAt', 'DomainAlternative1', 'DomainAlternative1Price',
      'DomainAlternative1PurchaseURL', 'DomainAlternative2', 'DomainAlternative2Price', 'DomainAlternative2PurchaseURL'].forEach(function (field) {
        steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, field, '');
      });
    return {
      ok: true,
      job_id: body.job_id,
      execution_status: status,
      today_action_refresh: refreshTodayActionsFromCandidateDecisions_()
    };
  }
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究状态', status);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究时间', body.completed_at);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'PreflightVerdict', body.preflight_verdict || '');
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'PreflightCheckedAt', body.preflight_checked_at || body.completed_at);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'PreflightReason', body.preflight_reason || '');
  const machine = body.machine_fields && Object.prototype.toString.call(body.machine_fields) === '[object Object]'
    ? body.machine_fields : {};
  if (machine.social_result) {
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'Social结果', machine.social_result);
  }
  if (machine.serp_competition) {
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'SERP竞争', machine.serp_competition);
  }
  if (machine.keyword_opportunity) {
    steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '关键词机会', machine.keyword_opportunity);
  }
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Social摘要', steamCandidateResearchSocialSummary_(body.social_summary));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动SERP摘要', steamCandidateResearchSerpSummary_(body.serp_summary));
  const machineRecommendation = normalizeMachineRecommendationDisplay_(body.machine_recommendation || body.recommendation);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation', body.recommendation);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation置信度', body.confidence);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation理由',
    steamCandidateResearchJoin_(body.reasons) || steamCandidateResearchJoin_(body.blocking_reasons));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动缺失证据', steamCandidateResearchJoin_(body.missing_evidence));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动BUILD依据', JSON.stringify({
    recalc_evidence: body.recalc_evidence || {},
    machine_fields: body.machine_fields || {}
  }));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动BUILD Thesis', body.decision_evidence && body.decision_evidence.buildThesis || '');
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation结果路径', body.recommendation_result_path);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究错误', '');
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'MachineDecision', machineRecommendation || body.MachineDecision || body.recommendation);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, 'MachineDecisionReason',
    body.MachineDecisionReason ||
    steamCandidateResearchJoin_(body.reasons) ||
    steamCandidateResearchJoin_(body.blocking_reasons));
  ['RecommendedDomain', 'DomainTLD', 'DomainFirstYearPrice', 'DomainRegistrar', 'DomainPurchaseURL', 'DomainCheckedAt',
    'DomainAlternative1', 'DomainAlternative1Price', 'DomainAlternative1PurchaseURL', 'DomainAlternative2',
    'DomainAlternative2Price', 'DomainAlternative2PurchaseURL'].forEach(function (field) {
      steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, field, body[field] == null ? '' : body[field]);
    });
  return {
    ok: true,
    job_id: body.job_id,
    execution_status: status,
    today_action_refresh: refreshTodayActionsFromCandidateDecisions_()
  };
}

// 兼容 V1 的旧函数名：如果你已经安装过旧 trigger，不会突然失效。
function runSteamCandidateScan() {
  return runSteamHotword01B();
}

function setupSteamScanner() {
  return setupSteamHotwordV2();
}

function formatSteamDateSmokeValue_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

/** Read-only production HTML check; deliberately does not save cache or Sheet rows. */
function steamReleaseDateParserSmokeTest() {
  const summaries = [];
  const logs = [];
  HOTWORD_V2.sources.forEach(source => {
    const summary = {source: source.name, rowsParsed: 0, explicitDates: 0, tbaComingSoon: 0, missingDates: 0, samples: [], error: ''};
    try {
      const fetched = fetchSteamSearchPageReliable_(source.name, source.url, 1, logs);
      const rows = parseSteamSearchResults_(fetched.body);
      summary.rowsParsed = rows.length;
      rows.forEach(item => {
        const raw = String(item.releaseDate || '').trim();
        const parsed = parseExactSteamDate_(raw);
        if (parsed) summary.explicitDates += 1;
        else if (/coming soon|to be announced|\btba\b/i.test(raw)) summary.tbaComingSoon += 1;
        else summary.missingDates += 1;
      });
      const shuffled = rows.slice();
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
      }
      summary.samples = shuffled.slice(0, 3).map(item => ({
        game: item.name,
        rawReleaseText: item.releaseDate || '',
        parsedDate: formatSteamDateSmokeValue_(parseExactSteamDate_(item.releaseDate))
      }));
    } catch (err) {
      summary.error = String(err && err.message || err);
    }
    summaries.push(summary);
  });

  const lines = ['Steam 日期解析 Smoke Test'];
  summaries.forEach(summary => {
    lines.push('', summary.source);
    if (summary.error) {
      lines.push('fetch error: ' + summary.error);
      return;
    }
    lines.push(
      'rows parsed: ' + summary.rowsParsed,
      'release date 可明确解析: ' + summary.explicitDates,
      'TBA / Coming soon: ' + summary.tbaComingSoon,
      '日期缺失: ' + summary.missingDates,
      '随机样本:'
    );
    summary.samples.forEach(sample => {
      lines.push('  ' + sample.game + ' | raw=' + sample.rawReleaseText + ' | parsed=' + (sample.parsedDate || ''));
    });
  });
  SpreadsheetApp.getUi().alert(lines.join('\n'));
  return summaries;
}

/** Append-only schema migration; does not initialize any other Sheet. */
function ensureQualificationEligibilityColumns_(sheet) {
  const fields = ['上次Qualification时间', '上次Qualification排名', 'Eligibility原因', 'Qualification状态'];
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  let lastColumn = width;
  let appended = 0;
  fields.forEach(field => {
    if (headers.indexOf(field) >= 0) return;
    lastColumn += 1;
    if (sheet.getMaxColumns && lastColumn > sheet.getMaxColumns() && sheet.insertColumnsAfter) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), 1);
    }
    sheet.getRange(1, lastColumn).setValue(field);
    headers.push(field);
    appended += 1;
  });
  return {fields: fields, headers: headers, width: lastColumn, appended: appended};
}

function qualificationMasterSheet_() {
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const sheet = ss && ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet) throw new Error('候选主表不存在');
  return sheet;
}

function initializeQualificationEligibilityV1() {
  const sheet = qualificationMasterSheet_();
  const schema = ensureQualificationEligibilityColumns_(sheet);
  return {ok: true, appended: schema.appended, width: schema.width};
}

function backfillQualificationEligibilityBaselineV1() {
  const sheet = qualificationMasterSheet_();
  const schema = ensureQualificationEligibilityColumns_(sheet);
  const headers = schema.headers;
  const col = name => headers.indexOf(name);
  const appIdCol = col('Steam App ID');
  const result1ACol = col('1A结果');
  const firstRoundCol = col('第一轮类型');
  const lastScanCol = col('最后扫描时间');
  const rankCol = col('来源排名');
  const lastTimeCol = col('上次Qualification时间');
  const lastRankCol = col('上次Qualification排名');
  const reasonCol = col('Eligibility原因');
  const statusCol = col('Qualification状态');
  if (appIdCol < 0 || result1ACol < 0 || firstRoundCol < 0) throw new Error('候选主表缺少 baseline 所需旧字段');
  if (sheet.getLastRow() < 2) return {ok: true, scanned: 0, backfilled: 0};

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.width).getValues();
  let scanned = 0;
  let backfilled = 0;
  rows.forEach((row, index) => {
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    scanned += 1;
    const hasQualification = STEAM_CANDIDATE_1A_PASS_RESULTS[String(row[result1ACol] || '').trim()] ||
      !!String(row[firstRoundCol] || '').trim();
    if (!hasQualification) return;
    const time = lastScanCol >= 0 ? row[lastScanCol] : '';
    const rank = rankCol >= 0 ? qualificationRankValue_(row[rankCol]) : null;
    const alreadySet = lastTimeCol >= 0 && lastRankCol >= 0 &&
      (row[lastTimeCol] !== '' || row[lastRankCol] !== '');
    if (alreadySet) return;
    const rowNumber = index + 2;
    if (lastTimeCol >= 0) sheet.getRange(rowNumber, lastTimeCol + 1).setValue(time || '');
    if (lastRankCol >= 0) sheet.getRange(rowNumber, lastRankCol + 1).setValue(rank || '');
    if (reasonCol >= 0) sheet.getRange(rowNumber, reasonCol + 1).setValue('BASELINE');
    if (statusCol >= 0) sheet.getRange(rowNumber, statusCol + 1).setValue('COMPLETE');
    backfilled += 1;
  });
  return {ok: true, scanned: scanned, backfilled: backfilled};
}

function qualificationDateKey_(value, ss) {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  const timezone = ss && ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Shanghai';
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(date, timezone, 'yyyy-MM-dd');
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function readQualificationDryRunObservations_(ss, today) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  const todayKey = qualificationDateKey_(today, ss);
  const todayByAppId = new Map();
  const previousByAppId = new Map();
  if (!sheet || sheet.getLastRow() < 2) return {todayKey: todayKey, today: todayByAppId, previous: previousByAppId};
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const appIdCol = index('Steam App ID');
  const timeCol = index('运行时间');
  const rankCol = index('来源排名');
  const stageCol = index('发布阶段');
  const daysCol = index('距发售天数');
  const nameCol = index('游戏名称');
  if (appIdCol < 0 || timeCol < 0) return {todayKey: todayKey, today: todayByAppId, previous: previousByAppId};
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    const rowKey = qualificationDateKey_(row[timeCol], ss);
    const item = {
      appId: appId,
      name: nameCol >= 0 ? row[nameCol] : '',
      sourceRank: rankCol >= 0 ? row[rankCol] : '',
      releaseStage: stageCol >= 0 ? String(row[stageCol] || '').trim() : '',
      daysToRelease: daysCol >= 0 ? row[daysCol] : null
    };
    if (rowKey === todayKey) todayByAppId.set(appId, item);
    else if (rowKey && rowKey < todayKey) previousByAppId.set(appId, item);
  });
  return {todayKey: todayKey, today: todayByAppId, previous: previousByAppId};
}

function dryRunQualificationEligibilityV1() {
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const now = arguments.length && arguments[0] ? new Date(arguments[0]) : new Date();
  const observations = readQualificationDryRunObservations_(ss, now);
  const state = readQualificationStateIndex_(ss);
  const decisions = readCandidateDecisions_(ss);
  const historyIndex = buildHistoryIndex_(ss);
  const masterScope = readQualificationMasterScopeIndex_(ss);
  const counts = {
    rawUniqueAppIds: observations.today.size,
    NEW_IN_SCOPE: 0, ENTERED_SCOPE: 0, STAGE_CHANGED: 0, RANK_RISING: 0,
    RECHECK: 0, UNCHANGED_SKIP: 0, OUT_OF_SCOPE: 0, SCOPE_UNKNOWN: 0, REJECT: 0, BUILD: 0,
    eligibleTotal: 0
  };
  observations.today.forEach(rec => {
    const master = masterScope.get(rec.appId);
    if (master) {
      if (!rec.releaseStage) rec.releaseStage = master.releaseStage;
      if (!isFiniteNumber_(Number(rec.daysToRelease))) rec.daysToRelease = master.daysToRelease;
    }
    const decision = decisions.get(rec.appId);
    const decisionStatus = String(decision && decision.status || '').trim().toUpperCase();
    if (decisionStatus === 'REJECT') {
      counts.REJECT += 1;
      return;
    }
    if (decisionStatus === 'BUILD' || isInHistoryIndex_(rec, historyIndex)) {
      counts.BUILD += 1;
      return;
    }
    const scopeStatus = qualificationScopeStatus_(rec);
    if (scopeStatus === 'SCOPE_UNKNOWN') {
      counts.SCOPE_UNKNOWN += 1;
      return;
    }
    const eligibility = evaluateQualificationEligibility_(rec, {
      previousRaw: observations.previous.get(rec.appId),
      qualification: state.get(rec.appId),
      decision: decision,
      now: now,
      rules: {}
    });
    if (eligibility.reason === 'UNCHANGED_SKIP' && scopeStatus === 'OUT_OF_SCOPE') {
      counts.OUT_OF_SCOPE += 1;
    } else {
      counts[eligibility.reason] = (counts[eligibility.reason] || 0) + 1;
    }
    if (eligibility.eligible) counts.eligibleTotal += 1;
  });
  Logger.log(JSON.stringify(counts));
  return counts;
}

function readQualificationMasterScopeIndex_(ss) {
  const result = new Map();
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet || sheet.getLastRow() < 2) return result;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const appIdCol = index('Steam App ID');
  if (appIdCol < 0) return result;
  const stageCol = index('发布阶段');
  const daysCol = index('距发售天数');
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    result.set(appId, {
      releaseStage: stageCol >= 0 ? String(row[stageCol] || '').trim() : '',
      daysToRelease: daysCol >= 0 ? row[daysCol] : null
    });
  });
  return result;
}

/** Temporary operator menu action for this rollout; no scan or enrichment. */
function runQualificationEligibilityV1InitAndDryRun() {
  const baseline = backfillQualificationEligibilityBaselineV1();
  const counts = dryRunQualificationEligibilityV1(new Date('2026-08-30T12:00:00+08:00'));
  const message = [
    'Qualification Eligibility V1 初始化 + Dry Run 完成',
    '',
    'baseline 回填数: ' + Number(baseline.backfilled || 0),
    'Raw unique AppIDs: ' + Number(counts.rawUniqueAppIds || 0),
    'NEW_IN_SCOPE: ' + Number(counts.NEW_IN_SCOPE || 0),
    'ENTERED_SCOPE: ' + Number(counts.ENTERED_SCOPE || 0),
    'STAGE_CHANGED: ' + Number(counts.STAGE_CHANGED || 0),
    'RANK_RISING: ' + Number(counts.RANK_RISING || 0),
    'RECHECK: ' + Number(counts.RECHECK || 0),
    'UNCHANGED_SKIP: ' + Number(counts.UNCHANGED_SKIP || 0),
    'OUT_OF_SCOPE: ' + Number(counts.OUT_OF_SCOPE || 0),
    'SCOPE_UNKNOWN: ' + Number(counts.SCOPE_UNKNOWN || 0),
    'REJECT: ' + Number(counts.REJECT || 0),
    'BUILD: ' + Number(counts.BUILD || 0),
    'eligibility=true 总数: ' + Number(counts.eligibleTotal || 0)
  ].join('\n');
  SpreadsheetApp.getUi().alert(message);
  return {baseline: baseline, counts: counts};
}

function installDailySteamTrigger() {
  return installDailyHotwordTrigger();
}

function removeDailySteamTriggers() {
  return removeDailyHotwordTriggers();
}


// ============================================================================
// 初始化
// ============================================================================

function candidateDecisionColumnMap_(sheet) {
  const width = Math.max(
    sheet.getLastColumn(),
    HOTWORD_V2.decisionHeaders.length
  );
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const byName = {};
  headers.forEach((header, index) => {
    const name = String(header || '').trim();
    if (name && byName[name] === undefined) byName[name] = index + 1;
  });
  return {headers, byName, width};
}

function reportCandidateDecisionSchemaIssue_(message) {
  if (typeof console !== 'undefined' && console.log) console.log(message);
}

function ensureCandidateDecisionGridWidth_(sheet, width) {
  const current = sheet.getMaxColumns ? sheet.getMaxColumns() : sheet.getLastColumn();
  if (current < width && sheet.insertColumnsAfter) {
    sheet.insertColumnsAfter(current, width - current);
  }
}

/**
 * Candidate Decision is a header-authoritative ledger.  Existing columns are
 * mapped by their names; unknown columns remain after the canonical schema.
 */
function ensureCandidateDecisionSchema_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet is required');
  let sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet) sheet = ss.insertSheet(HOTWORD_V2.sheets.decisions);

  const canonical = HOTWORD_V2.decisionHeaders.slice();
  const oldWidth = Math.max(sheet.getLastColumn(), canonical.length);
  ensureCandidateDecisionGridWidth_(sheet, oldWidth);
  const oldHeaders = sheet.getRange(1, 1, 1, oldWidth).getDisplayValues()[0];
  const oldRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, oldWidth).getValues()
    : [];
  const sourceByName = {};
  const extras = [];
  const extraPositions = [];
  const usedExtraNames = new Set(canonical);
  const hasData = position => oldRows.some(row => row[position] !== '' && row[position] !== null);

  oldHeaders.forEach((rawHeader, position) => {
    const header = String(rawHeader || '').trim();
    if (header && canonical.indexOf(header) >= 0 && sourceByName[header] === undefined) {
      sourceByName[header] = position;
      return;
    }
    if (!header && !hasData(position)) return;
    let extraName = header || ('LegacyColumn_' + (position + 1));
    if (usedExtraNames.has(extraName)) extraName = 'LegacyColumn_' + (position + 1) + '_' + extraName;
    while (usedExtraNames.has(extraName)) extraName += '_';
    usedExtraNames.add(extraName);
    extras.push(extraName);
    extraPositions.push(position);
  });

  const finalHeaders = canonical.concat(extras);
  const rows = oldRows.map(oldRow => canonical.map(name =>
    sourceByName[name] === undefined ? '' : oldRow[sourceByName[name]]
  ).concat(extraPositions.map(position => oldRow[position])));
  ensureCandidateDecisionGridWidth_(sheet, finalHeaders.length);

  const headersChanged = oldHeaders.length !== finalHeaders.length || oldHeaders.some((header, index) => header !== finalHeaders[index]);
  if (headersChanged) sheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  if (rows.length && (headersChanged || oldRows.some((row, index) => {
    const next = rows[index];
    return next.some((value, col) => value !== row[col]);
  }))) {
    sheet.getRange(2, 1, rows.length, finalHeaders.length).setValues(rows);
  }
  if (extras.length) {
    reportCandidateDecisionSchemaIssue_(
      'Candidate Decision schema preserved unknown columns: ' + extras.join(', ')
    );
  }
  return {
    ok: true,
    sheet,
    migrated: headersChanged,
    canonicalHeaders: canonical,
    preservedExtraHeaders: extras
  };
}

function candidateDecisionSetField_(sheet, rowNumber, field, value, columnMap) {
  const map = columnMap || candidateDecisionColumnMap_(sheet);
  const column = map.byName[field];
  if (column) sheet.getRange(rowNumber, column).setValue(value);
}

function candidateDecisionFieldValues_(decision) {
  return {
    'Steam App ID': decision.appId,
    '游戏名称': decision.name,
    '决策状态': decision.status,
    '上次人工检查日': decision.lastCheckedDate,
    '上次检查7d Gain': decision.lastGain,
    '上次检查类型': decision.lastType,
    '下次复查日': decision.nextRecheckDate,
    '决策备注': decision.note,
    '上次检查时决策状态': decision.lastCheckedStatus,
    '首次发现日期': decision.firstSeen,
    '首次来源': decision.source,
    '第一轮类型': decision.firstType,
    '当前Steam阶段': decision.currentStage,
    '研究状态': decision.researchStatus,
    'Google Trends结果': candidateDecisionEnumValue_('Google Trends结果', decision.trendsResult),
    'Social结果': candidateDecisionEnumValue_('Social结果', decision.socialResult),
    'SERP竞争': candidateDecisionEnumValue_('SERP竞争', decision.serpCompetition),
    '关键词机会': candidateDecisionEnumValue_('关键词机会', decision.keywordOpportunity),
    '人工备注': decision.manualNote,
    'Decision': candidateDecisionEnumValue_('Decision', decision.status),
    'Decision日期': decision.decisionDate,
    'Next Action': candidateDecisionEnumValue_('Next Action', decision.nextAction),
    'OpportunityID': decision.opportunityId || '',
    'ResearchJobID': decision.researchJobId || '',
    '自动研究状态': decision.autoResearchStatus || '',
    '自动研究时间': decision.autoResearchTime || '',
    '自动Social摘要': decision.autoSocialSummary || '',
    '自动SERP摘要': decision.autoSerpSummary || '',
    '自动研究结果路径': decision.autoResearchResultPath || '',
    '自动Recommendation': decision.autoRecommendation || '',
    '自动Recommendation置信度': decision.autoRecommendationConfidence || '',
    '自动Recommendation理由': decision.autoRecommendationReasons || '',
    '自动缺失证据': decision.autoMissingEvidence || '',
    '自动Recommendation结果路径': decision.autoRecommendationResultPath || '',
    '自动研究错误': decision.autoResearchError || '',
    '自动BUILD依据': decision.autoBuildEvidence || '',
    '自动BUILD Thesis': decision.autoBuildThesis || '',
    'DecisionID': decision.decisionId || '',
    'MachineDecision': decision.machineDecision || '',
    'MachineDecisionReason': decision.machineDecisionReason || '',
    'RecommendedDomain': decision.recommendedDomain || '',
    'DomainTLD': decision.domainTld || '',
    'DomainFirstYearPrice': decision.domainFirstYearPrice == null ? '' : decision.domainFirstYearPrice,
    'DomainRegistrar': decision.domainRegistrar || '',
    'DomainPurchaseURL': decision.domainPurchaseUrl || '',
    'DomainCheckedAt': decision.domainCheckedAt || '',
    'DomainAlternative1': decision.domainAlternative1 || '',
    'DomainAlternative1Price': decision.domainAlternative1Price == null ? '' : decision.domainAlternative1Price,
    'DomainAlternative1PurchaseURL': decision.domainAlternative1PurchaseUrl || '',
    'DomainAlternative2': decision.domainAlternative2 || '',
    'DomainAlternative2Price': decision.domainAlternative2Price == null ? '' : decision.domainAlternative2Price,
    'DomainAlternative2PurchaseURL': decision.domainAlternative2PurchaseUrl || '',
    'TrendRelativeStrength': decision.trendRelativeStrength || '',
    'TrendVerdict': decision.trendVerdict || '',
    'TrendLastChecked': decision.trendLastChecked || '',
    'ExternalSignal': decision.externalSignal || '',
    'FinalResearchStage': decision.finalResearchStage || '',
    'PreflightVerdict': decision.preflightVerdict || '',
    'PreflightCheckedAt': decision.preflightCheckedAt || '',
    'PreflightReason': decision.preflightReason || ''
  };
}

function candidateDecisionAllowedExternalSignal_(value) {
  const allowed = {
    GOOGLE_TRENDS: true, KEYWORD_TOOL: true, COMPETITOR: true,
    SOCIAL: true, PRODUCT: true, OTHER: true
  };
  const tokens = String(value || '').split(',').map(token => token.trim()).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => allowed[token]);
}

function candidateDecisionAllowedFinalResearchStage_(value) {
  return [
    'SERP_PROBE', 'KEYWORD_RESEARCH', 'SOCIAL_EARLY', 'WATCH', 'PROBE',
    'ENTITY_VALIDATION', 'ENTITY_RESOLUTION_REQUIRED', 'MANUAL_REVIEW'
  ].indexOf(String(value || '').trim()) >= 0;
}

function candidateDecisionAllowedTrendVerdict_(value) {
  return [
    'SEARCH_CONFIRMED', 'SEARCH_WEAK', 'TREND_OVERRIDE', 'EXTERNAL_DISCOVERY',
    'AMBIGUOUS', 'INSUFFICIENT_DATA'
  ].indexOf(String(value || '').trim()) >= 0;
}

const CANDIDATE_DECISION_ENUMS_ = {
  '研究状态': {allowed: ['待研究', '研究中', '已完成'], fallback: ''},
  'Google Trends结果': {allowed: ['强', '中', '弱', '无', '未检查'], fallback: '未检查'},
  'Social结果': {allowed: ['强', '中', '弱', '无', '未检查'], fallback: '未检查'},
  'SERP竞争': {allowed: ['低', '中', '高', '未检查'], fallback: '未检查'},
  '关键词机会': {allowed: ['有', '无', '未检查'], fallback: '未检查'},
  'Decision': {allowed: ['BUILD', 'WATCH', 'REJECT'], fallback: ''},
  'Next Action': {allowed: ['Google Trends', 'Social验证', 'SERP检查', 'Keyword Research', 'Decision', 'Site Build', 'Recheck', 'None', 'Automatic Preflight'], fallback: ''}
};

function candidateDecisionEnumValue_(field, value) {
  const rule = CANDIDATE_DECISION_ENUMS_[field];
  if (!rule) return value;
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return '';
  return rule.allowed.indexOf(text) >= 0 ? text : rule.fallback;
}

function repairCandidateDecisionEnumData_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.decisions) : null;
  const result = {ok: true, rowsScanned: 0, repaired: 0, repairs: []};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const map = candidateDecisionColumnMap_(sheet);
  const names = Object.keys(CANDIDATE_DECISION_ENUMS_);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, map.width).getValues();
  rows.forEach((row, index) => {
    result.rowsScanned += 1;
    const appId = String(map.byName['Steam App ID'] ? row[map.byName['Steam App ID'] - 1] : '').trim();
    names.forEach(field => {
      const column = map.byName[field];
      if (!column) return;
      const current = row[column - 1];
      const next = candidateDecisionEnumValue_(field, current);
      const currentText = String(current === null || current === undefined ? '' : current).trim();
      if (currentText === next) return;
      candidateDecisionSetField_(sheet, index + 2, field, next, map);
      row[column - 1] = next;
      result.repaired += 1;
      result.repairs.push({appId, field, from: currentText, to: next});
    });
  });
  return result;
}

function candidateDecisionAllowedDate_(value) {
  if (value === '' || value === null || value === undefined) return true;
  if (Object.prototype.toString.call(value) === '[object Date]') return !isNaN(value.getTime());
  return !isNaN(new Date(String(value).trim()).getTime());
}

function repairCandidateDecisionSchemaData_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.decisions) : null;
  const result = {ok: true, rowsScanned: 0, repaired: 0, cleared: 0, appIds: [], repairs: []};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const map = candidateDecisionColumnMap_(sheet);
  const fields = {
    TrendRelativeStrength: value => value === '' || isFiniteNumber_(Number(value)),
    TrendVerdict: value => value === '' || candidateDecisionAllowedTrendVerdict_(value),
    TrendLastChecked: candidateDecisionAllowedDate_,
    ExternalSignal: value => value === '' || candidateDecisionAllowedExternalSignal_(value),
    FinalResearchStage: value => value === '' || candidateDecisionAllowedFinalResearchStage_(value),
    PreflightVerdict: value => ['', 'PENDING', 'AUTO_REJECT', 'WATCH', 'MANUAL_REVIEW', 'PREFLIGHT_ERROR'].indexOf(String(value || '').trim()) >= 0,
    PreflightCheckedAt: candidateDecisionAllowedDate_,
    PreflightReason: value => true
  };
  const names = Object.keys(fields);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, map.width).getValues();
  rows.forEach((row, index) => {
    result.rowsScanned += 1;
    const appId = String(map.byName['Steam App ID'] ? row[map.byName['Steam App ID'] - 1] : '').trim();
    if (appId) result.appIds.push(appId);
    names.forEach(sourceName => {
      const sourceColumn = map.byName[sourceName];
      if (!sourceColumn) return;
      const value = row[sourceColumn - 1];
      if (fields[sourceName](value)) return;
      const targets = names.filter(targetName => {
        if (targetName === sourceName || targetName === 'PreflightReason' || !map.byName[targetName]) return false;
        const targetValue = row[map.byName[targetName] - 1];
        return (targetValue === '' || targetValue === null) && fields[targetName](value);
      });
      if (targets.length === 1) {
        const targetName = targets[0];
        candidateDecisionSetField_(sheet, index + 2, sourceName, '', map);
        candidateDecisionSetField_(sheet, index + 2, targetName, value, map);
        row[sourceColumn - 1] = '';
        row[map.byName[targetName] - 1] = value;
        result.repaired += 1;
        result.repairs.push({appId, from: sourceName, to: targetName});
      } else {
        candidateDecisionSetField_(sheet, index + 2, sourceName, '', map);
        row[sourceColumn - 1] = '';
        result.cleared += 1;
        result.repairs.push({appId, cleared: sourceName});
      }
    });
  });
  return result;
}

/** One-time repair for rows written with the former physical 44-column layout. */
function migrateCandidateDecisionHistoricalSchema() {
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet || sheet.getLastRow() < 2) return {ok: true, rowsMigrated: 0, cellsMigrated: 0};
  const map = candidateDecisionColumnMap_(sheet);
  const migrations = [
    {from: 36, to: map.byName.TrendRelativeStrength || 53, target: 'TrendRelativeStrength'},
    {from: 37, to: map.byName.TrendVerdict || 54, target: 'TrendVerdict'},
    {from: 38, to: map.byName.TrendLastChecked || 55, target: 'TrendLastChecked'},
    {from: 39, to: map.byName.ExternalSignal || 56, target: 'ExternalSignal'},
    {from: 40, to: map.byName.FinalResearchStage || 57, target: 'FinalResearchStage'},
    {from: 41, to: map.byName.PreflightVerdict || 58, target: 'PreflightVerdict'},
    {from: 42, to: map.byName.PreflightCheckedAt || 59, target: 'PreflightCheckedAt'},
    {from: 43, to: map.byName.PreflightReason || 60, target: 'PreflightReason'},
    {from: 44, to: map.byName.DecisionID || 38, target: 'DecisionID'}
  ];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 60)).getValues();
  const validTarget = (target, value) => {
    if (value === '' || value === null || value === undefined) return false;
    if (target === 'TrendRelativeStrength') return isFiniteNumber_(Number(value));
    if (target === 'TrendVerdict') return candidateDecisionAllowedTrendVerdict_(value);
    if (target === 'TrendLastChecked' || target === 'PreflightCheckedAt') return candidateDecisionAllowedDate_(value);
    if (target === 'ExternalSignal') return candidateDecisionAllowedExternalSignal_(value);
    if (target === 'FinalResearchStage') return candidateDecisionAllowedFinalResearchStage_(value);
    if (target === 'PreflightVerdict') return ['', 'PENDING', 'AUTO_REJECT', 'WATCH', 'MANUAL_REVIEW', 'PREFLIGHT_ERROR'].indexOf(String(value).trim()) >= 0;
    if (target === 'DecisionID') return /^steam-decision-/i.test(String(value).trim());
    return true;
  };
  let rowsMigrated = 0;
  let cellsMigrated = 0;
  rows.forEach((row, index) => {
    let rowChanged = false;
    migrations.forEach(item => {
      const source = row[item.from - 1];
      if (source === '' || source === null || source === undefined) return;
      const existingTarget = row[item.to - 1];
      if (!validTarget(item.target, existingTarget)) {
        row[item.to - 1] = source;
        cellsMigrated += 1;
      }
      // The old physical columns are no longer part of the canonical schema.
      if (item.from !== item.to) row[item.from - 1] = '';
      rowChanged = true;
    });
    if (rowChanged) rowsMigrated += 1;
  });
  if (rowsMigrated) sheet.getRange(2, 1, rows.length, Math.max(sheet.getLastColumn(), 60)).setValues(rows);
  SpreadsheetApp.flush();
  return {ok: true, rowsMigrated, cellsMigrated};
}

function setupSteamHotwordV2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return setupSteamHotwordV2On_(ss, {fullSetup: true});
}

/** G010 production runs use minimal setup; full UI repair only on explicit init. */
function ensureSteamHotwordV2ForRun_(ss, options) {
  return setupSteamHotwordV2On_(ss, Object.assign({fullSetup: false}, options || {}));
}

function setupSteamHotwordV2On_(ss, options) {
  options = options || {};
  if (!ss) throw new Error('setupSteamHotwordV2On_: spreadsheet required');

  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.master, HOTWORD_V2.masterHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.candidateSnapshot, HOTWORD_V2.candidateSnapshotHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.snapshot, HOTWORD_V2.snapshotHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.anomalies, HOTWORD_V2.anomalyHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.log, HOTWORD_V2.logHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.externalDataAttempts, HOTWORD_V2.externalDataAttemptHeaders);
  if (!options.fullSetup) return {ok: true, minimal: true};

  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.history, ['Steam App ID', '游戏名称', 'Steam URL', '当前阶段', '备注']);
  ensureCandidateDecisionSchema_(ss);
  ensureSitePoolSchema_(ss);
  setupSitePoolUi_(ss);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.gscBinding, HOTWORD_V2.gscBindingHeaders);
  setupGscBindingUi_(ss);
  ensureExternalSignalSheets_(ss);
  repairCandidateDecisionSchemaData_(ss);
  const enumRepair = repairCandidateDecisionEnumData_(ss);
  if (typeof Logger !== 'undefined' && Logger.log && enumRepair.repaired) {
    Logger.log(JSON.stringify({candidateDecisionEnumRepair: enumRepair}));
  }
  setupCandidateDecisionUi_(ss);
  setupCandidateDecisionBackendView_(ss);

  setupRulesSheet_(ss);
  setupActionSheet_(ss);
  setupBacktestSheet_(ss);
  applyBasicFormatting_(ss);

  // M0-2 / M1-1：信息架构与指标字典（不改 1A/1B 规则与数据）。
  ensureUsageGuideSheet_(ss);
  ensureMetricGuideSheet_(ss);
  organizeSheetUi_(ss);

  safeToast_('V2.5 表结构已初始化。下一步设置免费 Games Popularity API Key。', 'Steam 0→1B', 8);
  return {ok: true, candidateDecisionEnumRepair: enumRepair};
}

// ============================================================================
// Steam Raw 月度 Drive CSV 归档 V1
// ============================================================================

function steamRawArchiveFolder_(createIfMissing) {
  if (typeof DriveApp === 'undefined') throw new Error('DriveApp unavailable');
  const folders = DriveApp.getFoldersByName(HOTWORD_V2.rawArchive.folderName);
  if (folders.hasNext()) return folders.next();
  if (createIfMissing) return DriveApp.createFolder(HOTWORD_V2.rawArchive.folderName);
  return null;
}

function steamRawArchiveCsvEscape_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function steamRawArchiveCsv_(headers, rows) {
  return [headers, ...(rows || [])]
    .map(row => row.map(steamRawArchiveCsvEscape_).join(','))
    .join('\r\n') + '\r\n';
}

function steamRawArchiveDate_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value.getTime());
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;
  const date = new Date(text);
  return isNaN(date.getTime()) ? null : date;
}

function steamRawArchiveMonthKey_(date, timezone) {
  if (!date) return '';
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(date, timezone || 'Asia/Shanghai', 'yyyy-MM');
  }
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function steamRawArchiveMonthEnd_(monthKey, timezone) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  // A month is eligible only when its final calendar day is before cutoff.
  return new Date(Number(match[1]), Number(match[2]), 0, 23, 59, 59, 999);
}

function steamRawArchiveCutoff_(now, retentionDays) {
  return new Date(new Date(now || new Date()).getTime() - Number(retentionDays || 60) * 24 * 60 * 60 * 1000);
}

function steamRawArchiveSchema_(sheet) {
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const firstIndex = names => names.reduce((found, name) => found >= 0 ? found : index(name), -1);
  const observation = firstIndex(['运行时间', 'observation time', '日期']);
  const required = ['来源页码', '原始观察状态'];
  if (observation < 0) throw new Error('Steam_每日快照 缺少 observation time/运行时间/日期 表头');
  required.forEach(name => { if (index(name) < 0) throw new Error('Steam_每日快照 缺少表头: ' + name); });
  const runId = firstIndex(['Run ID', 'run_id']);
  const appId = firstIndex(['Steam App ID', 'steam_app_id']);
  const source = firstIndex(['候选来源', 'source']);
  const rank = firstIndex(['来源排名', 'rank']);
  if (runId < 0 || appId < 0 || source < 0 || rank < 0) throw new Error('Steam_每日快照 缺少 Raw identity 表头');
  return {width, headers, observation, runId, appId, source, rank};
}

function steamRawArchiveExistingFile_(folder, name) {
  const files = folder.getFilesByName(name);
  if (!files.hasNext()) return null;
  const file = files.next();
  if (files.hasNext()) throw new Error('Drive 中存在重复 archive 文件: ' + name);
  return file;
}

function steamRawArchiveValidateCsv_(csv, headers, expectedRows, keyRows) {
  const lines = String(csv || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (!lines.length || lines[0] !== headers.map(steamRawArchiveCsvEscape_).join(',')) throw new Error('archive header mismatch');
  if (lines.length - 1 !== expectedRows.length) throw new Error('archive row count mismatch');
  const expectedKeys = new Set(keyRows.map(row => String(row[0]) + '|' + String(row[1])));
  const runIdIndex = headers.indexOf('Run ID');
  const appIdIndex = headers.indexOf('Steam App ID');
  if (runIdIndex < 0 || appIdIndex < 0) throw new Error('archive key columns missing');
  const actualKeys = new Set();
  expectedRows.forEach(row => {
    actualKeys.add(String(row[runIdIndex]) + '|' + String(row[appIdIndex]));
  });
  if (actualKeys.size !== expectedKeys.size || Array.from(expectedKeys).some(key => !actualKeys.has(key))) {
    throw new Error('archive key rows mismatch');
  }
  return {header: true, rowCount: expectedRows.length, keyRows: actualKeys.size};
}

function steamRawArchivePlan_(ss, now) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  if (!sheet) throw new Error('Steam_每日快照 不存在');
  const schema = steamRawArchiveSchema_(sheet);
  const timezone = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Shanghai';
  const values = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.width).getValues() : [];
  const display = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.width).getDisplayValues() : [];
  const cutoff = steamRawArchiveCutoff_(now, HOTWORD_V2.rawArchive.retentionDays);
  const months = {};
  values.forEach((row, i) => {
    const date = steamRawArchiveDate_(row[schema.observation]);
    if (!date) return;
    const month = steamRawArchiveMonthKey_(date, timezone);
    if (!months[month]) months[month] = {month, rows: [], displayRows: [], rowNumbers: []};
    months[month].rows.push(row);
    months[month].displayRows.push(display[i]);
    months[month].rowNumbers.push(i + 2);
  });
  Object.keys(months).forEach(month => {
    months[month].eligible = steamRawArchiveMonthEnd_(month, timezone).getTime() < cutoff.getTime();
  });
  const dates = values.map(row => steamRawArchiveDate_(row[schema.observation])).filter(Boolean).sort((a, b) => a - b);
  Object.keys(months).forEach(month => {
    months[month] = steamRawArchiveDedupeMonth_(ss, months[month], schema);
  });
  return {sheet, schema, cutoff, earliest: dates.length ? dates[0] : null, latest: dates.length ? dates[dates.length - 1] : null, months: months};
}

/**
 * Before archiving, remove only provable duplicate non-canonical runs:
 * same local day + App ID, with a SUCCESS run available as the replacement.
 * Unknown or non-success-only history is retained.
 */
function steamRawArchiveDedupeMonth_(ss, item, schema) {
  const logSheet = ss.getSheetByName(HOTWORD_V2.sheets.log);
  const runStatus = new Map();
  if (logSheet && logSheet.getLastRow() >= 2) {
    const logWidth = Math.max(logSheet.getLastColumn(), HOTWORD_V2.logHeaders.length);
    const logHeaders = logSheet.getRange(1, 1, 1, logWidth).getDisplayValues()[0];
    const runCol = logHeaders.indexOf('Run ID');
    const statusCol = logHeaders.indexOf('运行状态');
    if (runCol >= 0 && statusCol >= 0) {
      logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logWidth).getValues().forEach(row => {
        const runId = String(row[runCol] || '').trim();
        if (runId) runStatus.set(runId, String(row[statusCol] || '').trim().toUpperCase());
      });
    }
  }

  const groups = new Map();
  item.rows.forEach((row, index) => {
    const date = steamRawArchiveDate_(row[schema.observation]);
    const dateKey = date ? steamRawArchiveMonthKey_(date, 'Asia/Shanghai') + '-' + String(date.getDate()).padStart(2, '0') : '';
    const appId = String(row[schema.appId] || '').trim();
    const key = dateKey + '|' + appId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({index, runId: String(row[schema.runId] || '').trim(), status: runStatus.get(String(row[schema.runId] || '').trim()) || ''});
  });

  const removed = new Set();
  groups.forEach(group => {
    if (group.length < 2 || !group.some(entry => entry.status === 'SUCCESS')) return;
    group.forEach(entry => {
      if (entry.status && entry.status !== 'SUCCESS') removed.add(entry.index);
    });
  });

  return {
    month: item.month,
    rows: item.rows.filter((row, index) => !removed.has(index)),
    displayRows: item.displayRows.filter((row, index) => !removed.has(index)),
    // Delete the complete old group after the canonical replacement has been
    // included in the archive; otherwise a discarded duplicate would stay hot.
    rowNumbers: item.rowNumbers,
    eligible: item.eligible,
    dedupedRows: removed.size
  };
}

function getSteamRawArchiveStatus_(ss, now) {
  const plan = steamRawArchivePlan_(ss || SpreadsheetApp.getActiveSpreadsheet(), now || new Date());
  const folder = steamRawArchiveFolder_(false);
  const months = Object.keys(plan.months).sort().map(month => {
    const item = plan.months[month];
    const name = HOTWORD_V2.rawArchive.filePrefix + month + '.csv';
    return {month, rows: item.rows.length, eligible: item.eligible, archiveExists: !!(folder && steamRawArchiveExistingFile_(folder, name)), fileName: name};
  });
  return {rowCount: plan.sheet.getLastRow() >= 2 ? plan.sheet.getLastRow() - 1 : 0, earliest: plan.earliest, latest: plan.latest, cutoff: plan.cutoff, eligibleMonths: months.filter(item => item.eligible), months};
}

function showSteamRawArchiveStatus() {
  const status = getSteamRawArchiveStatus_();
  const lines = ['Steam Raw 归档状态', '', 'Steam_每日快照 当前行数: ' + status.rowCount, '最早 observation date: ' + (status.earliest ? status.earliest.toISOString() : '无'), '最新 observation date: ' + (status.latest ? status.latest.toISOString() : '无'), '当前 cutoff: ' + status.cutoff.toISOString(), '', '月份 | 行数 | 可归档 | Drive archive'];
  status.months.forEach(item => lines.push(item.month + ' | ' + item.rows + ' | ' + (item.eligible ? '是' : '否') + ' | ' + (item.archiveExists ? '已有' : '无')));
  SpreadsheetApp.getUi().alert(lines.join('\n'));
  return status;
}

function executeSteamRawMonthlyArchive(now) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const plan = steamRawArchivePlan_(ss, now || new Date());
  const folder = steamRawArchiveFolder_(true);
  const results = [];
  Object.keys(plan.months).sort().forEach(month => {
    const item = plan.months[month];
    if (!item.eligible) return;
    const fileName = HOTWORD_V2.rawArchive.filePrefix + month + '.csv';
    const csv = steamRawArchiveCsv_(plan.schema.headers, item.displayRows);
    const keyRows = item.displayRows.map(row => [row[plan.schema.runId], row[plan.schema.appId]]);
    let file = steamRawArchiveExistingFile_(folder, fileName);
    if (file) {
      if (file.getBlob().getDataAsString() !== csv) throw new Error('已有 archive 内容不一致，禁止删除 Sheet 行: ' + fileName);
    } else {
      file = folder.createFile(fileName, csv, 'text/csv');
    }
    steamRawArchiveValidateCsv_(file.getBlob().getDataAsString(), plan.schema.headers, item.displayRows, keyRows);
    const proof = steamRawArchiveProofDates_();
    const canDelete = item.displayRows.every(row => proof.has(String(row[plan.schema.observation] || '').substring(0, 10)));
    if (canDelete) item.rowNumbers.slice().sort((a, b) => b - a).forEach(rowNumber => plan.sheet.deleteRows(rowNumber, 1));
    results.push({month, rows: item.rows.length, fileName, deleted: canDelete ? item.rows.length : 0, awaitingLocalRawProof: !canDelete});
  });
  const diagnostics = steamCleanupDiagnosticRows_(ss, now || new Date());
  safeToast_('Steam Raw 月度归档完成：' + results.length + ' 个月份。', 'Steam Raw Archive', 7);
  return {ok: true, results, diagnostics};
}

function steamRawArchiveProofDates_() {
  if (typeof PropertiesService === 'undefined') return new Set();
  const raw = PropertiesService.getScriptProperties().getProperty('STEAM_RAW_ARCHIVE_PROOF_DATES_V1');
  try { return new Set(JSON.parse(raw || '[]')); } catch (e) { return new Set(); }
}

function markSteamRawArchiveProof(dates) {
  const current = steamRawArchiveProofDates_();
  (dates || []).forEach(date => { if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) current.add(String(date)); });
  PropertiesService.getScriptProperties().setProperty('STEAM_RAW_ARCHIVE_PROOF_DATES_V1', JSON.stringify(Array.from(current).sort()));
  return Array.from(current).sort();
}

function steamCleanupDiagnosticRows_(ss, now) {
  const external = deleteSteamRowsOlderThan_(ss, HOTWORD_V2.sheets.externalDataAttempts, '尝试时间', now, HOTWORD_V2.diagnosticRetention.externalDataAttemptsDays);
  const logs = deleteSteamRowsOlderThan_(ss, HOTWORD_V2.sheets.log, '运行时间', now, HOTWORD_V2.diagnosticRetention.runLogDays);
  return {externalDataAttempts: external, runLog: logs};
}

function deleteSteamRowsOlderThan_(ss, sheetName, dateHeader, now, days) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const dateCol = headers.indexOf(dateHeader);
  if (dateCol < 0) return 0;
  const cutoff = new Date(new Date(now || new Date()).getTime() - Number(days) * 24 * 60 * 60 * 1000);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  const rows = [];
  values.forEach((row, index) => {
    const date = row[dateCol] instanceof Date ? row[dateCol] : new Date(row[dateCol]);
    if (date instanceof Date && !isNaN(date.getTime()) && date < cutoff) rows.push(index + 2);
  });
  rows.reverse().forEach(rowNumber => sheet.deleteRow(rowNumber));
  return rows.length;
}

function runSteamRawArchiveMaintenance() {
  return {enabled: false, reason: 'retention_disabled'};
}

function setupSteamRawArchiveMaintenance() {
  return {enabled: false, reason: 'retention_disabled'};
}

function setupRulesSheet_(ss) {
  let sheet = ss.getSheetByName(HOTWORD_V2.sheets.rules);
  if (!sheet) sheet = ss.insertSheet(HOTWORD_V2.sheets.rules);

  const headers = ['规则Key', '当前值', '单位/格式', '作用', '来源/说明'];
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.every(v => !String(v).trim())) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // 只在规则不存在时补默认值；用户后续修改不会被 setup 覆盖。
  const defaults = [
    ['UPCOMING_DAYS_MIN', 0, '天', '即将发售池：最小距发售天数', '历史规则'],
    ['UPCOMING_DAYS_MAX', 30, '天', '即将发售池：最大距发售天数', '历史规则：未来0–30天'],
    ['UPCOMING_FOLLOWERS_MIN', 200, '人', '即将发售池：Followers下限', '历史规则'],
    ['UPCOMING_FOLLOWERS_MAX', 30000, '人', '即将发售池：Followers上限', '历史规则'],

    ['RELEASED_DAYS_MAX', 14, '天', '已发售池：最多发售后多少天', 'V2默认值，可配置；原表未写死天数'],
    ['RELEASED_FOLLOWERS_MIN', 200, '人', '已发售池：Followers下限', '历史规则'],
    ['RELEASED_FOLLOWERS_MAX', 50000, '人', '已发售池：Followers上限', '历史规则'],
    ['RELEASED_REVIEWS_MIN', 20, '条', '已发售池：评论数下限', '历史规则'],
    ['RELEASED_REVIEWS_MAX', 2000, '条', '已发售池：评论数上限', '历史规则'],
    ['RELEASED_RATING_MIN', 70, '%', '已发售池：Steam评分下限', '历史规则'],

    ['TREND_GAIN_MIN', 1000, '人/7d', '🔥趋势：7d Gain下限', '历史规则'],
    ['TREND_GROWTH_MIN', 0.10, '比例', '🔥趋势：近似增长率下限', '历史规则：10%'],

    ['EARLY_FOLLOWERS_MAX', 5000, '人', '🌱Early：小基数上限', '由历史样本数字化'],
    ['EARLY_GAIN_MIN', 600, '人/7d', '🌱Early：7d Gain下限', '校准 BeastLink/ShipShaper/Defender/Survival Log'],
    ['EARLY_GROWTH_MIN', 0.175, '比例', '🌱Early：近似增长率下限', '校准最低约17.9%的历史Early样本'],

    ['CONTROL_FOLLOWERS_MIN', 30000, '人', '🏢对照：大盘Followers下限', '由历史对照样本数字化'],
    ['CONTROL_FOLLOWERS_MAX', 60000, '人', '🏢对照预留：Followers上限', '覆盖既有 Pax/Mortal Shell II/Zero Company 等对照样本'],
    ['CONTROL_GAIN_MIN', 1500, '人/7d', '🏢对照：7d Gain下限', '由历史对照样本数字化'],
    ['CONTROL_GROWTH_MAX', 0.10, '比例', '🏢对照：增长率上限（低于趋势线）', '历史逻辑：绝对量大但增速偏低'],
    ['CONTROL_MAX_PER_RUN', 3, '个', '每轮最多保留多少大盘对照', '历史逻辑：只保留少量样本'],

    ['TREND_WATCH_GAIN_MIN', 600, '人/7d', '🟡 Trend Watch：第一条7d Gain下限', 'P2边界实验：14天人工研究样本'],
    ['TREND_WATCH_GROWTH_MIN', 0.07, '比例', '🟡 Trend Watch：第一条增长率下限', 'P2边界实验：14天人工研究样本'],
    ['TREND_WATCH_HIGH_GAIN_MIN', 1000, '人/7d', '🟡 Trend Watch：第二条7d Gain下限', 'P2边界实验：高Gain放宽增长率'],
    ['TREND_WATCH_HIGH_GAIN_GROWTH_MIN', 0.05, '比例', '🟡 Trend Watch：第二条增长率下限', 'P2边界实验：14天人工研究样本'],
    ['EARLY_WATCH_FOLLOWERS_MAX', 8000, '人', '🟢 Early Watch：Followers上限', 'P2边界实验：14天人工研究样本'],
    ['EARLY_WATCH_GAIN_MIN', 300, '人/7d', '🟢 Early Watch：7d Gain下限', 'P2边界实验：14天人工研究样本'],
    ['EARLY_WATCH_GROWTH_MIN', 0.10, '比例', '🟢 Early Watch：增长率下限', 'P2边界实验：14天人工研究样本'],
    ['P1_MAX_PER_DAY', 6, '个', '今日行动：P1每日采样上限', 'P2边界实验：人工研究负载上限'],
    ['P1_TREND_MAX_PER_DAY', 4, '个', '今日行动：P1 Trend优先配额', 'P2边界实验：人工研究负载上限'],
    ['P1_EARLY_MAX_PER_DAY', 2, '个', '今日行动：P1 Early优先配额', 'P2边界实验：人工研究负载上限'],
    ['P2_MAX_PER_DAY', 6, '个', '今日行动：P2每日采样上限', 'P2边界实验：14天人工研究样本'],
    ['P2_TREND_MAX_PER_DAY', 3, '个', '今日行动：P2 Trend Watch优先配额', 'P2边界实验：14天人工研究样本'],
    ['P2_EARLY_MAX_PER_DAY', 3, '个', '今日行动：P2 Early Watch优先配额', 'P2边界实验：14天人工研究样本'],

    ['FOLLOWER_HISTORY_MIN_DAYS', 5, '天', '至少需要多少天Followers历史才做1B', '防止把1–2天增长误当7d Gain'],
    ['RECHECK_GAIN_GROWTH_MIN', 0.30, '比例', 'WATCH候选重新进入今日行动所需的7d Gain增长', '候选人工复查 V1'],
    ['WATCH_RECHECK_DAYS_STRONG', 3, '天', '强信号 WATCH 的默认复查间隔', '候选人工复查 V1'],
    ['WATCH_RECHECK_DAYS_NORMAL', 7, '天', '普通 WATCH 的默认复查间隔', '候选人工复查 V1'],
    ['DISCOVERY_PAGES', '5', '页/来源', '每个Steam来源最多抓取5页；空页、连续2页无新App ID可提前停止', 'G010：双来源合并目标约250 unique App ID'],
    ['DAILY_HOUR', 8, '小时', '自动触发器运行小时', '表格/脚本时区下08:00–09:00窗口']
  ];

  const lastRow = sheet.getLastRow();
  const existing = new Set();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().forEach(r => {
      const k = String(r[0] || '').trim();
      if (k) existing.add(k);
    });
  }

  const toAppend = defaults.filter(r => !existing.has(r[0]));
  if (toAppend.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 5).setValues(toAppend);
  }
  const discoveryRow = sheet.getRange(2, 1, Math.max(0, sheet.getLastRow() - 1), 1)
    .getDisplayValues().findIndex(r => String(r[0] || '').trim() === 'DISCOVERY_PAGES');
  if (discoveryRow >= 0) {
    const rowNumber = discoveryRow + 2;
    const discoveryDefault = defaults.find(r => r[0] === 'DISCOVERY_PAGES');
    sheet.getRange(rowNumber, 2, 1, 4).setValues([discoveryDefault.slice(1)]);
  }
}

function setupActionSheet_(ss) {
  let sheet = ss.getSheetByName(HOTWORD_V2.sheets.action);
  if (!sheet) sheet = ss.insertSheet(HOTWORD_V2.sheets.action, 0);

  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).breakApart();
  sheet.getRange('A1').setValue('今日行动：实时待办队列；只显示当前仍需人工处理的任务，完成研究或 BUILD / REJECT 后会移出');
  sheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).setValues([HOTWORD_V2.actionHeaders]);
  const oldLastColumn = sheet.getLastColumn();
  if (oldLastColumn > HOTWORD_V2.actionHeaders.length) {
    sheet.getRange(1, HOTWORD_V2.actionHeaders.length + 1, sheet.getMaxRows(), oldLastColumn - HOTWORD_V2.actionHeaders.length).clearContent();
  }
  setupTodayActionUi_(ss);
}

function setupTodayActionUi_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.action);
  if (!sheet) return;
  const headers = sheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).getDisplayValues()[0];
  const col = name => headers.indexOf(name) + 1;
  const actionCol = col('行动类型');
  const decisionCol = col('人工决定') || col('Decision');
  // V3.3 列重排迁移：旧列（例如 W 列）的验证规则不能继续作用于新列。
  // 先清空今日行动数据区的全部验证，再按当前表头重新绑定人工字段。
  const validationRange = sheet.getRange(4, 1, Math.max(sheet.getMaxRows() - 3, 1), sheet.getMaxColumns());
  if (validationRange.clearDataValidations) validationRange.clearDataValidations();
  if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.newDataValidation) return;
  const editableOptions = {
    'Trends结果': ['强', '中', '弱', '无', '未检查'],
    '人工决定': ['BUILD', 'WATCH', 'REJECT'],
    'Decision': ['BUILD', 'WATCH', 'REJECT']
  };
  Object.keys(editableOptions).forEach(name => {
    const c = col(name);
    if (c > 0) sheet.getRange(4, c, Math.max(sheet.getMaxRows() - 3, 1), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(editableOptions[name], true).setAllowInvalid(false).build())
      .setBackground('#FFF2CC');
  });
  const noteCol = col('人工备注');
  if (noteCol > 0) sheet.getRange(4, noteCol, Math.max(sheet.getMaxRows() - 3, 1), 1).setBackground('#FFF2CC');
  const rangeFor = c => sheet.getRange(4, c, Math.max(sheet.getMaxRows() - 3, 1), 1);
  let rules = sheet.getConditionalFormatRules();
  const removeColumns = [actionCol, decisionCol];
  rules = rules.filter(rule => !rule.getRanges().some(r =>
    r.getSheet().getSheetId() === sheet.getSheetId() &&
    (removeColumns.indexOf(r.getColumn()) >= 0 || r.getColumn() > HOTWORD_V2.actionHeaders.length)
  ));
  if (actionCol > 0) {
    const actionRange = rangeFor(actionCol);
    ['NEW', 'RESEARCHING', 'RECHECK_DUE', 'GAIN_GROWTH', 'WATCH_WAITING', 'COMPLETED'].forEach(value => {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(value).setBackground('#FFF2CC').setRanges([actionRange]).build());
    });
  }
  if (decisionCol > 0) {
    const decisionRange = rangeFor(decisionCol);
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BUILD').setBackground('#D9EAD3').setRanges([decisionRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('WATCH').setBackground('#CFE2F3').setRanges([decisionRange]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('REJECT').setBackground('#D9D9D9').setRanges([decisionRange]).build());
  }
  sheet.setConditionalFormatRules(rules);
}

function setupCandidateDecisionUi_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet) return;
  const columnMap = candidateDecisionColumnMap_(sheet);
  const column = name => columnMap.byName[name] || 0;
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), sheet.getMaxColumns()).clearDataValidations();
  const validation = (name, values) => {
    const col = column(name);
    if (col > 0) sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build());
  };
  validation('研究状态', ['待研究', '研究中', '已完成']);
  validation('Google Trends结果', ['强', '中', '弱', '无', '未检查']);
  validation('Social结果', ['强', '中', '弱', '无', '未检查']);
  validation('SERP竞争', ['低', '中', '高', '未检查']);
  validation('关键词机会', ['有', '无', '未检查']);
  validation('Decision', ['BUILD', 'WATCH', 'REJECT']);
  validation('Next Action', ['Google Trends', 'Social验证', 'SERP检查', 'Keyword Research', 'Site Build', 'Recheck', 'None', 'Automatic Preflight']);

  const decisionCol = column('Decision');
  if (decisionCol > 0) {
    const range = sheet.getRange(2, decisionCol, Math.max(sheet.getMaxRows() - 1, 1), 1);
    const rules = sheet.getConditionalFormatRules().filter(rule =>
      !rule.getRanges().some(r => r.getColumn() === decisionCol && r.getSheet().getSheetId() === sheet.getSheetId())
    );
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BUILD').setBackground('#D9EAD3').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('WATCH').setBackground('#CFE2F3').setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('REJECT').setBackground('#D9D9D9').setRanges([range]).build());
    sheet.setConditionalFormatRules(rules);
  }
}

function setupCandidateDecisionBackendView_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet) return;
  // 保留完整后台字段与历史数据，仅隐藏重复的系统展示列。
  [3, 8, 9, 10, 11, 12, 13, 14].forEach(col => sheet.hideColumns(col));
}

/**
 * Safe recovery entry point for a partial daily run. It never scans Steam,
 * changes triggers, or calls the external research provider.
 */
function recoverSteamCandidateResearch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return {ok: false, error: 'RECOVERY_LOCK_BUSY'};
  try {
    const schema = ensureCandidateDecisionSchema_(ss);
    const repair = repairCandidateDecisionSchemaData_(ss);
    setupCandidateDecisionUi_(ss);
    const queue = enqueueSteamCandidateResearchJobs_(ss, new Date());
    const refresh = refreshTodayActionsFromCandidateDecisions_(ss);
    SpreadsheetApp.flush();
    return {ok: true, schema, repair, queue, refresh};
  } finally {
    lock.releaseLock();
  }
}

/** Production smoke readback for inbox verification; read-only. */
function inspectSteamCandidateInboxProduction_(gameNames) {
  const names = (gameNames || ['Zad Archery', 'WheelMates', 'Anime Shop Simulator']).map(String);
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const actionSheet = ss.getSheetByName(HOTWORD_V2.sheets.action);
  const headers = actionSheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).getDisplayValues()[0];
  const col = name => headers.indexOf(name);
  const width = HOTWORD_V2.actionHeaders.length;
  const rows = actionSheet.getLastRow() >= 4
    ? actionSheet.getRange(4, 1, actionSheet.getLastRow() - 3, width).getDisplayValues()
    : [];
  const decisions = readCandidateDecisions_(ss);
  const out = {
    actionHeaderCount: headers.length,
    actionHeaders: headers,
    candidates: []
  };
  names.forEach(gameName => {
    const actionRow = rows.find(row => normalizeGameName_(row[col('游戏名称')] || '') === normalizeGameName_(gameName));
    const decision = findCandidateDecisionByGameName_(decisions, gameName);
    const master = findMasterRecordByGameName_(ss, gameName);
    out.candidates.push({
      game_name: gameName,
      steam_app_id: actionRow ? actionRow[col('Steam App ID')] : (decision && decision.appId) || '',
      master_steam_app_id: master ? master.appId : '',
      master_steam_url: master ? master.url : '',
      search_alias: actionRow ? actionRow[col('搜索别名')] : '',
      social_result: actionRow ? actionRow[col('Social结果')] : (decision && decision.socialResult) || '',
      serp_competition: actionRow ? actionRow[col('SERP竞争')] : (decision && decision.serpCompetition) || '',
      keyword_opportunity: actionRow ? actionRow[col('关键词机会')] : (decision && decision.keywordOpportunity) || '',
      machine_recommendation: actionRow ? actionRow[col('机器推荐')] : (decision && decision.machineDecision) || '',
      machine_confidence: actionRow ? actionRow[col('机器置信度')] : (decision && decision.autoRecommendationConfidence) || '',
      machine_reason: actionRow ? actionRow[col('机器推荐理由')] : (decision && decision.machineDecisionReason) || '',
      human_decision: actionRow ? actionRow[col('人工决定')] : (decision && decision.status) || '',
      final_status: actionRow ? actionRow[col('最终状态')] : deriveFinalStatus_(decision || {}),
      auto_research_status: decision && decision.autoResearchStatus || '',
      auto_social_summary: decision && decision.autoSocialSummary || ''
    });
  });
  return out;
}

function findCandidateDecisionByGameName_(decisions, gameName) {
  const key = normalizeGameName_(gameName);
  if (!key) return null;
  return Array.from(decisions.values()).find(item => normalizeGameName_(item.name) === key) || null;
}

function findMasterRecordByGameName_(ss, gameName) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.master) : null;
  if (!sheet || sheet.getLastRow() < 2) return null;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const col = {};
  HOTWORD_V2.masterHeaders.forEach(name => { col[name] = headers.indexOf(name); });
  const value = (row, name) => col[name] === undefined || col[name] < 0 ? '' : row[col[name]];
  const key = normalizeGameName_(gameName);
  if (!key) return null;
  let match = null;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    const name = String(value(row, '游戏名称') || '').trim();
    if (!name || normalizeGameName_(name) !== key) return;
    match = {
      appId: String(value(row, 'Steam App ID') || '').trim(),
      name: name,
      url: String(value(row, 'Steam URL') || '').trim(),
      continueNext: String(value(row, '进入下一步') || '').trim(),
      firstRoundType: String(value(row, '第一轮类型') || '').trim(),
      currentStage: String(value(row, '当前筛选阶段') || '').trim(),
      result1A: String(value(row, '1A结果') || '').trim()
    };
  });
  return match;
}

function searchProductionCandidateSources_(query) {
  const key = normalizeGameName_(query);
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const out = {query: query, key: key, matches: []};
  if (!key) return out;
  const push = (source, payload) => out.matches.push(Object.assign({source: source}, payload));

  const master = findMasterRecordByGameName_(ss, query);
  if (master) push('master', master);

  const decisions = readCandidateDecisions_(ss);
  const decision = findCandidateDecisionByGameName_(decisions, query);
  if (decision) {
    push('decision', {
      appId: decision.appId,
      name: decision.name,
      autoResearchStatus: decision.autoResearchStatus,
      researchJobId: decision.researchJobId,
      preflightVerdict: decision.preflightVerdict,
      status: decision.status || ''
    });
  }

  const snapSheet = ss.getSheetByName(HOTWORD_V2.sheets.candidateSnapshot);
  if (snapSheet && snapSheet.getLastRow() >= 2) {
    const width = HOTWORD_V2.candidateSnapshotHeaders.length;
    const headers = snapSheet.getRange(1, 1, 1, width).getDisplayValues()[0];
    snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, width).getDisplayValues().forEach((row, index) => {
      const name = String(row[headers.indexOf('游戏名称')] || '').trim();
      if (normalizeGameName_(name) !== key) return;
      push('snapshot', {
        row: index + 2,
        appId: String(row[headers.indexOf('Steam App ID')] || '').trim(),
        name: name,
        date: String(row[headers.indexOf('日期')] || '').trim()
      });
    });
  }

  const actionSheet = ss.getSheetByName(HOTWORD_V2.sheets.action);
  if (actionSheet && actionSheet.getLastRow() >= 4) {
    const headers = actionSheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).getDisplayValues()[0];
    actionSheet.getRange(4, 1, actionSheet.getLastRow() - 3, HOTWORD_V2.actionHeaders.length).getDisplayValues()
      .forEach((row, index) => {
        const name = String(row[headers.indexOf('游戏名称')] || '').trim();
        if (normalizeGameName_(name) !== key) return;
        push('today_action', {
          row: index + 4,
          appId: String(row[headers.indexOf('Steam App ID')] || '').trim(),
          name: name
        });
      });
  }
  return out;
}

function repairProductionCandidatesFromSnapshot_(ss, gameNames) {
  const names = (gameNames || []).map(String).filter(Boolean);
  const result = {repaired: 0, rows: [], skipped: []};
  if (!names.length) return result;
  const snapSheet = ss.getSheetByName(HOTWORD_V2.sheets.candidateSnapshot);
  if (!snapSheet || snapSheet.getLastRow() < 2) return result;
  const width = HOTWORD_V2.candidateSnapshotHeaders.length;
  const headers = snapSheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const valueAt = (row, name) => {
    const column = headers.indexOf(name);
    return column >= 0 ? row[column] : '';
  };
  const now = new Date();
  names.forEach(gameName => {
    const key = normalizeGameName_(gameName);
    const existing = findMasterRecordByGameName_(ss, gameName);
    if (existing && isReliableSteamAppId_(existing.appId)) {
      result.skipped.push({game_name: gameName, reason: 'master_exists', appId: existing.appId});
      return;
    }
    let snapshotRow = null;
    snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, width).getDisplayValues().forEach(row => {
      const name = String(valueAt(row, '游戏名称') || '').trim();
      if (normalizeGameName_(name) !== key) return;
      snapshotRow = row;
    });
    if (!snapshotRow) {
      result.skipped.push({game_name: gameName, reason: 'snapshot_missing'});
      return;
    }
    const appId = String(valueAt(snapshotRow, 'Steam App ID') || '').trim();
    if (!isReliableSteamAppId_(appId)) {
      result.skipped.push({game_name: gameName, reason: 'snapshot_app_id_missing'});
      return;
    }
    const rec = {
      appId: appId,
      name: String(valueAt(snapshotRow, '游戏名称') || gameName).trim(),
      url: 'https://store.steampowered.com/app/' + appId + '/',
      source: 'snapshot_repair',
      sourceRank: '',
      releaseDate: valueAt(snapshotRow, 'Steam 发布日期') || '',
      releaseRaw: '',
      releaseStage: valueAt(snapshotRow, '发布阶段') || '',
      daysToRelease: valueAt(snapshotRow, '距发售天数'),
      followers: valueAt(snapshotRow, 'Steam Followers'),
      baselineFollowers: '',
      gain7d: valueAt(snapshotRow, 'Steam 7d Gain'),
      growthRate: valueAt(snapshotRow, '近似增长率'),
      coverageDays: '',
      reviews: '',
      positiveReviews: '',
      rating: '',
      result1A: '通过',
      reason1A: '',
      firstRoundType: valueAt(snapshotRow, '第一轮类型') || '🌱 Early候选',
      priority: valueAt(snapshotRow, '优先级') || 'P1 高',
      continueNext: '是',
      nextAction: 'Automatic Preflight',
      firstRoundReason: String(valueAt(snapshotRow, '触发原因') || 'snapshot_repair'),
      currentStage: '1B完成→人工第二轮',
      dataStatus: 'snapshot_repair',
      dataNotes: ['snapshot_repair'],
      qualificationEligible: true,
      qualificationStatus: 'ELIGIBLE'
    };
    upsertMaster_(ss, [rec], now, 'SNAPSHOT-REPAIR', null);
    syncCandidateDecisions_(ss, [rec], now, loadRules_(ss));
    result.repaired += 1;
    result.rows.push({game_name: rec.name, steam_app_id: appId});
  });
  return result;
}

function repairMasterAppIdsFromSteamUrl_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  const result = {repaired: 0, rows: []};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const appIdCol = headers.indexOf('Steam App ID') + 1;
  const nameCol = headers.indexOf('游戏名称') + 1;
  const urlCol = headers.indexOf('Steam URL') + 1;
  if (appIdCol < 1 || urlCol < 1) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach((row, index) => {
    const appId = String(row[appIdCol - 1] || '').trim();
    if (appId) return;
    const url = String(row[urlCol - 1] || '').trim();
    const match = url.match(/\/app\/(\d+)\b/);
    if (!match) return;
    const repairedAppId = match[1];
    sheet.getRange(index + 2, appIdCol).setValue(repairedAppId);
    result.repaired += 1;
    result.rows.push({
      row: index + 2,
      game_name: nameCol > 0 ? String(row[nameCol - 1] || '').trim() : '',
      steam_app_id: repairedAppId
    });
  });
  return result;
}

function diagnoseEnqueueEligibility_(ss, appId) {
  const out = {steam_app_id: appId, eligible: true, blockers: []};
  const masterRow = findMasterRecord_(ss, appId);
  if (!masterRow) {
    out.eligible = false;
    out.blockers.push('master_row_missing');
    return out;
  }
  const masterCol = {};
  HOTWORD_V2.masterHeaders.forEach((name, index) => { masterCol[name] = index; });
  const value = name => masterRow[masterCol[name]];
  const continueNext = String(value('进入下一步') || '').trim();
  if (!isReliableSteamAppId_(appId) || continueNext !== '是') out.blockers.push('master_gate');
  const oneAResult = String(value('1A结果') || '').trim();
  if (oneAResult && !STEAM_CANDIDATE_1A_PASS_RESULTS[oneAResult]) out.blockers.push('one_a_failed:' + oneAResult);
  const decision = readCandidateDecisions_(ss).get(appId);
  if (!decision || !decision.rowNumber) out.blockers.push('decision_missing');
  if (decision) {
    out.decision = {
      status: decision.status,
      autoResearchStatus: decision.autoResearchStatus,
      researchJobId: decision.researchJobId,
      preflightVerdict: decision.preflightVerdict,
      machineResearchComplete: machineResearchComplete_(decision)
    };
    if (String(decision.researchJobId || '').trim() &&
        !(STEAM_PREFLIGHT_ENABLED && steamCandidatePreflightDue_(decision, new Date()))) {
      out.blockers.push('existing_job_id');
    }
    const persistedStatus = normalizeDecisionStatus_(decision.status);
    if (persistedStatus === 'BUILD' || persistedStatus === 'REJECT' ||
        (persistedStatus === 'WATCH' && !steamCandidatePreflightDue_(decision, new Date()) &&
          machineResearchComplete_(decision))) {
      out.blockers.push('decision_status:' + persistedStatus);
    }
    const candidateRec = {
      gain7d: value('Steam 7d Gain'),
      firstRoundType: value('第一轮类型')
    };
    if (candidateManualEvidenceNeedsNoProvider_(candidateRec, decision, candidateExternalSignalIsNew_(decision))) {
      out.blockers.push('manual_evidence_no_provider');
    }
  }
  out.eligible = out.blockers.length === 0;
  return out;
}

function forceEnqueueProductionResearch_(ss, appIds, createdAt) {
  const ids = (appIds || []).map(String).filter(isReliableSteamAppId_);
  const result = {enqueued: 0, rows: []};
  if (!ids.length) return result;
  const decisionSheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const decisionCol = candidateDecisionColumnMap_(decisionSheet);
  const masterCol = {};
  HOTWORD_V2.masterHeaders.forEach((name, index) => { masterCol[name] = index; });
  const now = createdAt || new Date();
  const cycleDate = steamCandidateResearchDateString_(now, ss);
  const decisions = readCandidateDecisions_(ss);
  ids.forEach(appId => {
    const masterRow = findMasterRecord_(ss, appId);
    const decision = decisions.get(appId);
    if (!masterRow || !decision || !decision.rowNumber || machineResearchComplete_(decision)) {
      result.rows.push({appId: appId, skipped: true});
      return;
    }
    const jobId = 'steam-research-' + appId + '-' + cycleDate.replace(/-/g, '');
    const job = buildSteamCandidateResearchJob_(
      masterRow,
      masterCol,
      Object.assign({}, decision, {researchJobId: jobId, autoResearchTime: now, status: ''}),
      ss,
      now
    );
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'ResearchJobID', job.job_id, decisionCol);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, '自动研究状态', STEAM_CANDIDATE_RESEARCH_PENDING, decisionCol);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, '自动研究时间', now, decisionCol);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'PreflightVerdict', STEAM_PREFLIGHT_ENABLED ? 'PENDING' : '', decisionCol);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'Decision', '', decisionCol);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, '决策状态', '', decisionCol);
  result.enqueued += 1;
  result.rows.push({appId: appId, job_id: job.job_id});
  });
  return result;
}

function repairStalePendingResearchJobs_(ss) {
  const result = {repaired: 0, rows: []};
  const decisionSheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!decisionSheet || decisionSheet.getLastRow() < 2) return result;
  const columnMap = candidateDecisionColumnMap_(decisionSheet);
  const cycleDate = steamCandidateResearchDateString_(new Date(), ss).replace(/-/g, '');
  readCandidateDecisions_(ss).forEach(decision => {
  const status = String(decision.autoResearchStatus || '').trim();
  if (status && status !== STEAM_CANDIDATE_RESEARCH_PENDING) return;
  const jobId = String(decision.researchJobId || '').trim();
  if (!jobId || jobId.indexOf(cycleDate) >= 0) return;
  candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'ResearchJobID', '', columnMap);
  candidateDecisionSetField_(decisionSheet, decision.rowNumber, '自动研究状态', STEAM_CANDIDATE_RESEARCH_PENDING, columnMap);
  candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'PreflightVerdict', STEAM_PREFLIGHT_ENABLED ? 'PENDING' : '', columnMap);
  result.repaired += 1;
  result.rows.push({appId: decision.appId, name: decision.name, clearedJobId: jobId});
  });
  return result;
}

function backfillMachineRecommendationReasons_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const result = {updated: 0, rows: []};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const decisions = readCandidateDecisions_(ss);
  const columnMap = candidateDecisionColumnMap_(sheet);
  decisions.forEach(decision => {
    if (!machineResearchComplete_(decision)) return;
    if (String(decision.machineDecisionReason || '').trim()) return;
    const evidence = parseSteamCandidateRecalcEvidence_(decision);
    if (!evidence) return;
    const recommendation = buildSteamCandidateRecommendationFromEvidence_(evidence, {
      trends_result: decision.trendsResult,
      keyword_opportunity: decision.keywordOpportunity
    });
    applySteamCandidateRecommendationToDecision_(decision, recommendation);
    if (!String(decision.machineDecisionReason || '').trim()) return;
    candidateDecisionSetField_(sheet, decision.rowNumber, 'MachineDecisionReason', decision.machineDecisionReason, columnMap);
    candidateDecisionSetField_(sheet, decision.rowNumber, '自动Recommendation理由', decision.autoRecommendationReasons, columnMap);
    result.updated += 1;
    result.rows.push({appId: decision.appId, machine_reason: decision.machineDecisionReason});
  });
  return result;
}

function verifyTrendsRecalcProduction_(params) {
  const appId = String(params && params.steam_app_id || '3905450').trim();
  const testTrends = String(params && params.trends || '强').trim();
  const persist = String(params && params.persist || '').trim().toLowerCase() === 'true';
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const decisions = readCandidateDecisions_(ss);
  const decision = decisions.get(appId);
  if (!decision) return {ok: false, error: 'candidate_not_found', steam_app_id: appId};
  if (!machineResearchComplete_(decision)) {
    return {ok: false, error: 'machine_research_not_complete', steam_app_id: appId};
  }
  const before = {
    trends_result: decision.trendsResult || '',
    machine_recommendation: decision.machineDecision || normalizeMachineRecommendationDisplay_(decision.autoRecommendation),
    machine_confidence: decision.autoRecommendationConfidence || '',
    machine_reason: decision.machineDecisionReason || decision.autoRecommendationReasons || ''
  };
  const working = Object.assign({}, decision, {trendsResult: testTrends});
  const recalculated = recalculateSteamCandidateRecommendationFromTrends_(working);
  if (!recalculated) return {ok: false, error: 'recalc_unavailable', steam_app_id: appId};
  const after = {
    trends_result: testTrends,
    machine_recommendation: working.machineDecision || normalizeMachineRecommendationDisplay_(working.autoRecommendation),
    machine_confidence: working.autoRecommendationConfidence || '',
    machine_reason: working.machineDecisionReason || working.autoRecommendationReasons || ''
  };
  if (persist) {
    const decisionSheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
    const columnMap = candidateDecisionColumnMap_(decisionSheet);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'Trends结果', testTrends, columnMap);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'MachineDecision', after.machine_recommendation, columnMap);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, '自动Recommendation置信度', after.machine_confidence, columnMap);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, 'MachineDecisionReason', after.machine_reason, columnMap);
    candidateDecisionSetField_(decisionSheet, decision.rowNumber, '自动Recommendation理由', after.machine_reason, columnMap);
    refreshTodayActionsFromCandidateDecisions_(ss);
    SpreadsheetApp.flush();
  }
  return {
    ok: true,
    steam_app_id: appId,
    persisted: persist,
    changed: before.machine_recommendation !== after.machine_recommendation ||
      before.machine_confidence !== after.machine_confidence ||
      before.machine_reason !== after.machine_reason,
    before: before,
    after: after
  };
}

function setupBacktestSheet_(ss) {
  const name = '1B规则回测';
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const headers = ['游戏', 'Followers', '7d Gain', '增长率', '历史预期', '当前规则结果', '是否一致', '备注'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 仅在没有样本时填入。数据来自项目既有人工判断表。
  if (sheet.getLastRow() < 2) {
    const rows = [
      ['Pax Autocratica', 33759, 2747, 0.0813708937, '🏢 大盘对照', '', '', '绝对Gain高、增长率偏低'],
      ['Crimson Moon', 12253, 1999, 0.1631437199, '🔥 趋势候选', '', '', 'Gain≥1000且增长≥10%'],
      ['Mortal Shell II', 39429, 1887, 0.0478581755, '🏢 大盘对照', '', '', '大盘低增速'],
      ['STAR WARS Zero Company™', 50320, 1773, 0.0352344992, '🏢 大盘对照', '', '', '大IP对照样本'],
      ['Agefield High: Rock the School', 14403, 1799, 0.1249045338, '🔥 趋势候选', '', '', 'Gain≥1000且增长≥10%'],
      ['Low-Budget Repairs', 53037, 1702, 0.0320908045, '⚪ 低优先级', '', '', '历史批次中未进入对照；V2 1A通常也会因规模被排除'],
      ['Warhounds', 8474, 1610, 0.1899929195, '🔥 趋势候选', '', '', 'Gain≥1000且增长≥10%'],
      ['BeastLink', 2997, 943, 0.3146479813, '🌱 Early候选', '', '', '小基数高增速'],
      ['ShipShaper', 2800, 787, 0.2810714286, '🌱 Early候选', '', '', '小基数高增速'],
      ['Defender of the Crown: The Legend Returns', 4242, 778, 0.1834040547, '🌱 Early候选', '', '', '小基数高增速'],
      ['Survival Log', 3695, 661, 0.1788903924, '🌱 Early候选', '', '', '历史最低附近Early样本'],
      ['Security 51', 5121, 639, 0.1247803163, '⚪ 低优先级', '', '', '增速尚可但Gain偏小且基数超Early阈值'],
      ['Echoes of Mystralia', 11614, 972, 0.0836920957, '⚪ 低优先级', '', '', '绝对增量和相对增速都未进优先组']
    ];
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}


// ============================================================================
// M0-2：产品信息架构（使用说明 / Tab 顺序 / 隐藏旧 V1）
// 不改 1A/1B 阈值、抓取逻辑或业务数据行。
// ============================================================================

/**
 * 产品经理可读的「使用说明」（中文；不解释代码）。
 * @return {string[]}
 */
function getUsageGuideLines_() {
  return [
    '【每天只从「今日行动」开始】',
    '',
    '这张表是 Steam 热词候选工作台。打开后先看「今日行动」，不要从规则表或旧 V1 表开始翻。',
    '如果不知道某个数据从哪里来、怎么算或是否属于实验规则，请查看「指标说明」。',
    '',
    '—— 当前完整流程 ——',
    '建站关键词规划(Build)同步到历史游戏库 → Steam 榜单发现 → 历史游戏去重 → Followers / 评论 / 评分补全 → 1A 资格筛选 → 1B 增速分类 → 今日行动 → 人工二次验证 → BUILD / WATCH / REJECT → 建站关键词规划 → 建站上线 → 后续进入 GSC 监控',
    '',
    '—— 每日 Steam SOP ——',
    '1. 打开「今日行动」',
    '2. 对候选做 Google Trends / Social / SERP 检查',
    '3. 必要时补 Semrush / KD',
    '4. 最终人工判断 BUILD / WATCH / REJECT',
    '5. 只有准备做站时才进入「建站关键词规划」',
    '6. 没有合适候选就结束，不为了建站而建站',
    '',
    '自动化边界：当前自动流程主要完成到 1B。',
    'Google Trends / Social / SERP / KD / 最终建站决定，目前仍属于 Human Gate。',
    '',
    '—— 各 Sheet 职责 ——',
    '今日行动：实时待办队列。这里只保留当前仍需人工处理的任务；研究完成、BUILD、REJECT 后会实时移出。它不是每日候选快照。',
    '今日候选快照：每天正式 Steam 扫描完成后保存当天首次筛出的完整 P1/P2 候选；按日期+Steam App ID 去重，历史日期永久保留。',
    '候选决策：后台自动同步数据库，以 Steam App ID 唯一标识；日常无需打开或人工编辑。',
    '每天操作：1.只打开今日行动；2.等待机器研究完成（Social/SERP/关键词机会自动写回）；3.点击 Google Trends 链接并填写 Trends 结果；4.必要时补充 Volume/KD 等到人工备注；5.选择 BUILD / WATCH / REJECT。其余字段自动记录。',
    '今日行动复查规则：无人工记录的1B候选标记 NEW；WATCH 仅在到期或当前7d Gain较上次检查增长至少30%时出现；BUILD / REJECT 不再出现。每天最多采样 P1 6 个、P2 6 个；未采样候选仍保留在候选主表。',
    '指标说明：数据字典。查字段来源、公式、是否实验规则；不是每日操作入口。',
    '候选主表：系统当前所有候选及自动计算结果。用来回答“为什么推荐 / 为什么过滤”，不是每天逐行浏览的工作表。',
    '建站关键词规划：只有人工二次验证确认值得 BUILD 或重点 WATCH 后才进入。把游戏机会 → 搜索意图 → 页面结构 → URL / Page Type。不是候选发现入口。',
    '规则配置：当前 1A / 1B 参数。这些是热词站项目当前实验规则，不是 Steam / Google / SEO 行业官方标准。不要为了日常候选结果随意修改。',
    '1B规则回测：观察历史样本是否仍支持当前规则。不是每日运营页。',
    '今日候选快照：每日首次完整 P1/P2 候选的静态历史查看页，今天的记录优先显示。',
    'Steam_每日快照：保存历史运行时的数据状态。主要用于看 Followers 变化、追溯某一天的分类、后续规则回测。日常不需要查看。',
    '数据异常 / 运行日志_V2：只在今天没有正常产生候选、Followers/评论/评分缺失、或 API / 自动任务异常时检查。',
    '历史游戏库：系统去重账本。每日扫描前会把「建站关键词规划」中至少有一条动作为 Build 的游戏自动同步进来。通常不要人工修改。',
    '',
    '—— 旧 V1 兼容层（已隐藏，不要当日常入口） ——',
    '概览 / Steam_候选池 / Steam_抓取日志 / 配置：旧版兼容保留。当前正式人工流程从「今日行动」开始，不再从 Steam_候选池 起步。',
    '',
    '提醒：没有合适候选时，结束今天即可；不要为了填表而建站。'
  ];
}

/**
 * 确保「使用说明」存在，并写成当前 V2 工作流（覆盖旧说明；不碰其他 Sheet 数据）。
 */
function ensureUsageGuideSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const name = HOTWORD_V2.sheets.usage;
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const lines = getUsageGuideLines_();
  const values = lines.map(line => [line]);

  sheet.clear();
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.setFrozenRows(0);
  sheet.getRange(1, 1, values.length, 1).setValues(values);
  sheet.setColumnWidth(1, 920);
  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  if (values.length > 1) {
    sheet.getRange(2, 1, values.length, 1).setFontWeight('normal').setFontSize(11);
  }
  sheet.setTabColor('0F766E');
}

/**
 * 「指标说明」核心行：数据来源 / 口径 / 标准来源 / 成熟度。
 * 只解释，不改变任何业务计算。阈值与默认「规则配置」及 computeFollowerGrowth_ 保持一致。
 * @return {Array<Array<string>>}
 */
function getMetricGuideRows_() {
  // 列：指标/字段, 主要出现位置, 类型, 数据来源, 当前口径/公式, 业务用途, 是否参与自动判断, 当前标准/阈值, 标准来源, 当前成熟度, PM注意事项
  return [
    [
      'Steam App ID',
      '候选主表 / 今日行动 / 历史游戏库',
      '原始事实',
      'Steam',
      'Steam 商店页 / 搜索结果中的应用 ID',
      '游戏唯一标识；历史去重；避免改名或同名导致重复',
      '是（去重与关联）',
      '以 App ID 为优先唯一键',
      '外部事实（Steam）',
      '稳定',
      '不要用游戏名替代 App ID 做主去重。'
    ],
    [
      '游戏名称',
      '候选主表 / 今日行动',
      '原始事实',
      'Steam',
      'Steam 搜索结果标题原文',
      '展示与人工检索；App ID 缺失时才作辅助去重',
      '是（仅辅助去重）',
      '名称标准化只是兜底，不是稳定唯一 ID',
      '外部事实（Steam）',
      '较稳定',
      '游戏可改名；不要把标准化名称当成稳定唯一 ID。'
    ],
    [
      '候选来源',
      '候选主表 / 今日行动',
      '原始事实',
      'Steam Store 榜单',
      'Popular Upcoming 或 Popular New Releases 搜索页',
      '早期候选发现池；标明游戏从哪类榜单进入',
      '是（发现入口）',
      '当前两来源各抓取规则配置中的页数（默认 1 页）',
      '外部事实（Steam）',
      '稳定',
      '进入 Steam 榜单 ≠ 存在 SEO 机会。'
    ],
    [
      'Steam 发布日期',
      '候选主表 / 今日行动',
      '原始事实',
      'Steam',
      '搜索结果发布日原文解析为精确日历日；Coming soon / 仅年月等不算精确',
      '判断即将发售 / 已发售，并参与 1A 时间窗',
      '是（1A）',
      '必须解析出精确日期，否则 1A 记为数据异常',
      '外部事实（Steam）',
      '较稳定',
      '模糊发售文案不会被当成精确日期。'
    ],
    [
      '距发售天数',
      '候选主表 / 今日行动',
      '系统计算',
      '系统公式（基于发售日期）',
      '日历日差：发售日 − 运行日（即将发售为正；已发售为负；1A 已发售用绝对值）',
      '1A 时间窗口判断；区分即将发售 / 已发售',
      '是（1A）',
      '即将发售：0–30 天；已发售：发售后 ≤14 天（见规则配置）',
      '确定性计算 + 项目规则阈值',
      '较稳定',
      '天数本身是计算值；窗口阈值是实验规则。'
    ],
    [
      'Steam Followers（当前值）',
      '候选主表 / 今日行动',
      '外部第三方数据',
      'Games Popularity API（latest）',
      '第三方返回的当前 Followers 人数',
      '衡量当前社区关注规模；进入 1A / 1B 规模判断',
      '是（1A / 1B）',
      '即将发售主池 200–30000；已发售主池 200–50000（规则配置可改）',
      '外部事实（Games Popularity）+ 项目规则阈值',
      '较稳定',
      'Followers 大 ≠ 当前正在增长；数据源不是 Steam 官方 API。'
    ],
    [
      '7d基准Followers',
      '候选主表 / Steam_每日快照',
      '外部第三方数据',
      'Games Popularity API（Followers 历史）',
      '在历史点中选取最接近“约 7 天前”的观测；优先不晚于目标时刻；若不足 7 天则用最老点并靠覆盖天数约束',
      '计算 7d Gain 与近似增长率的基准',
      '是（1B 前置）',
      '历史至少覆盖 FOLLOWER_HISTORY_MIN_DAYS（默认 5 天）才做 1B',
      '外部事实（Games Popularity）+ 系统选点规则',
      '待验证',
      '没有完整 7 天历史时，不要把它理解成严格的“刚好 7 天前同比基准”。'
    ],
    [
      'Steam 7d Gain',
      '候选主表 / 今日行动 / 1B规则回测',
      '系统计算',
      '系统公式',
      '当前 Followers − 7d 基准 Followers',
      '衡量近期绝对新增规模',
      '是（1B）',
      '🔥 Gain≥1000；🌱 Gain≥600；🏢 Gain≥1500（默认，见规则配置）',
      '确定性计算 + 项目规则阈值',
      '较稳定',
      'Gain 是绝对人数变化，不单独代表百分比热度。'
    ],
    [
      '增速覆盖天数',
      '候选主表 / Steam_每日快照',
      '系统计算',
      '系统公式',
      '（当前运行时刻 − 所选历史基准点时刻）÷ 86400000',
      '判断 Followers 历史是否足够支撑 1B',
      '是（1B 前置门槛）',
      '默认须 ≥ 5 天（FOLLOWER_HISTORY_MIN_DAYS）',
      '确定性计算 + 当前实验参数',
      '待验证',
      '覆盖天数 < 最低天数时本轮不做 1B 分类，标记为“⏳ 等待历史 / 待数据 / 1B等待历史”，不计入 P3。'
    ],
    [
      '近似增长率',
      '候选主表 / 今日行动 / 1B规则回测',
      '系统计算',
      '系统公式（computeFollowerGrowth_）',
      '(当前 Followers − 历史基准 Followers) ÷ 当前 Followers；即 Gain ÷ 当前 Followers',
      '1B 相对增速分类（与绝对 Gain 一起用）',
      '是（1B）',
      'P1：🔥 ≥10%；🌱 ≥17.5%；🏢 增长率须 <10%。P2：Trend 为（Gain≥600且增长≥7%）或（Gain≥1000且增长≥5%）；Early 为 Followers≤8000、Gain≥300且增长≥10%。',
      '确定性计算 + 历史规则 / 历史人工样本校准',
      '待验证',
      '这是热词站项目当前使用的“近似增长率”，不是通常意义上的“相较 7 天前增长率”。常见同比写法会用 Gain÷基准 Followers；当前系统不是该定义。改公式会使现有 1B 阈值整体失效，需重新校准——本轮禁止改公式。'
    ],
    [
      '评论数',
      '候选主表 / 今日行动',
      '原始事实',
      'Steam（优先搜索卡片；不足则 appreviews JSON）',
      '优先：Steam 搜索结果 review summary 中的 user reviews 总数；缺失时回退 store.steampowered.com/appreviews query_summary.total_reviews',
      '已发售池 1A 硬条件',
      '是（1A 已发售）',
      '默认 20–2000 条',
      '外部事实（Steam）+ 项目规则阈值',
      '较稳定',
      '评论数低于下限是有效淘汰，不一定是数据异常。'
    ],
    [
      '好评数',
      '候选主表',
      '原始事实',
      'Steam User Reviews JSON',
      'appreviews query_summary.total_positive；搜索卡片通常只给百分比+总数，不一定有绝对好评数',
      '用于计算 Steam 评分（JSON 路径）',
      '间接（通过评分）',
      '无独立阈值',
      '外部事实（Steam）',
      '较稳定',
      '若仅有搜索卡片摘要，可能看不到单独好评数，但仍可能已有评分百分比。'
    ],
    [
      'Steam评分',
      '候选主表 / 今日行动',
      '系统计算',
      'Steam',
      '搜索卡片：好评百分比÷100；JSON 回退：好评数÷评论数。表内存 0–1，1A 比较时×100 与百分阈值对比',
      '已发售池质量门槛',
      '是（1A 已发售，且评论数已在主池范围时）',
      '默认 ≥70%',
      '外部事实（Steam）+ 确定性计算 + 项目规则阈值',
      '较稳定',
      '评论数已因上下限淘汰时，不再因缺评分记异常。'
    ],
    [
      '1A 即将发售',
      '规则配置 / 候选主表（1A结果）',
      '实验规则',
      '热词站项目规则引擎',
      '精确发售日 + Followers 当前值；距发售天数落在窗口，且 Followers 落在主池或大盘对照预留',
      '第一层资格筛选：是否值得进入 1B',
      '是',
      '距发售 0–30 天；Followers 200–30000（主池）；更大盘可进对照预留 30000–60000',
      '历史规则 / 当前实验参数',
      '实验中',
      '不是 Steam / Google / SEO 官方标准；改阈值前先看回测与样本。'
    ],
    [
      '1A 已发售',
      '规则配置 / 候选主表（1A结果）',
      '实验规则',
      '热词站项目规则引擎',
      '发售后天数、Followers、评论数、Steam 评分同时满足主池；或规模超主池但评论/评分/时间合格进入对照预留',
      '第一层资格筛选：是否值得进入 1B',
      '是',
      '发售后 ≤14 天；Followers 200–50000；评论 20–2000；评分 ≥70%',
      '历史规则 / 当前实验参数',
      '实验中',
      '标准来源是项目实验，不是平台官方。'
    ],
    [
      '🔥 趋势候选',
      '今日行动 / 候选主表（第一轮类型）',
      '实验规则',
      '热词站 1B 分类',
      '同时满足：7d Gain ≥ TREND_GAIN_MIN 且 近似增长率 ≥ TREND_GROWTH_MIN（先于 Early 判断）',
      '标记绝对增量与相对增速都较强的候选，供人工第二轮',
      '是（1B→今日行动）',
      '默认 Gain≥1000 且 近似增长率≥10%',
      '历史规则',
      '实验中',
      '同时要绝对 Gain 和相对 Growth，是为了避免只偏向大基数游戏或极小基数百分比噪声。进入今日行动 ≠ 应建站。'
    ],
    [
      '🌱 Early候选',
      '今日行动 / 候选主表（第一轮类型）',
      '实验规则',
      '热词站 1B 分类',
      '小基数：Followers≤上限，且 Gain、近似增长率都过线',
      '发现早期高增速小盘候选，供人工用 Social / Trends 验证',
      '是（1B→今日行动）',
      '默认 Followers≤5000；Gain≥600；近似增长率≥17.5%',
      '历史人工样本校准（如 BeastLink / ShipShaper / Survival Log 等）',
      '实验中',
      'Early 更依赖后续 Social / Trends Human Gate，不要自动建站。'
    ],
    [
      '🏢 大盘对照',
      '今日行动 / 候选主表（第一轮类型）',
      '实验规则',
      '热词站 1B 分类',
      '大 Followers + 足够 Gain，但近似增长率低于趋势线；每轮最多保留少量',
      '对照样本，观察大盘绝对增量与主攻候选的差异',
      '是（1B，限量）',
      '默认 Followers≥30000；Gain≥1500；增长率<10%；每轮最多 3 个',
      '历史对照样本校准 / 当前实验参数',
      '实验中',
      '对照 ≠ 优先建站候选。'
    ],
    [
      'Google Trends',
      '人工第二轮（不在自动表字段内强制写入）',
      '人工判断',
      'Google Trends',
      '产品经理人工查看搜索热度走势',
      '验证是否已出现可感知的搜索兴趣',
      '否（不参与自动 0→1B）',
      '无自动阈值；由 PM 判断',
      '产品经理人工判断（Human Gate）',
      '人工判断',
      '当前自动化只到 1B；Trends 不能被脚本替代。'
    ],
    [
      'Social Early Signal',
      '人工第二轮',
      '人工判断',
      'YouTube / Reddit / 其它社媒（人工）',
      '人工检查是否出现早期讨论、视频或社区信号',
      '尤其用于验证 🌱 Early 候选是否“真热”',
      '否',
      '无自动阈值',
      '产品经理人工判断（Human Gate）',
      '人工判断',
      '社媒热闹 ≠ 一定有可做的 SEO 词。'
    ],
    [
      'SERP 竞争',
      '人工第二轮',
      '人工判断',
      'Google Search Results',
      '人工查看目标词真实搜索结果格局',
      '判断能否用独立站切入搜索结果',
      '否',
      '无自动阈值',
      '产品经理人工判断（Human Gate）',
      '人工判断',
      '不要只看工具分数，要看真实 SERP。'
    ],
    [
      'KD / Semrush',
      '人工第二轮 / 建站关键词规划（可选）',
      '人工判断',
      'Semrush 等外部工具（人工）',
      '人工查询关键词难度或相关指标',
      '辅助评估词的可竞争性；不决定 0→1B',
      '否',
      '不是当前 0→1B 自动规则组成部分',
      '产品经理人工判断（Human Gate）',
      '人工判断',
      'KD 低也不等于该建站；需结合 Trends / SERP。'
    ],
    [
      'BUILD / WATCH / REJECT',
      '人工结论（进入建站关键词规划前）',
      '人工判断',
      '产品经理 / Human Gate',
      '在 1B 候选基础上，综合 Trends / Social / SERP / KD 后的最终决定',
      '是否建站、继续观察或放弃',
      '否（最终人工门）',
      '无自动阈值；1B 不得替代此判断',
      '产品经理人工判断（Human Gate）',
      '人工判断',
      '进入今日行动 ≠ BUILD。'
    ],
    [
      '数据状态 / 数据备注',
      '候选主表 / 数据异常',
      '诊断字段',
      '系统运行时标注',
      '记录 Followers / 评论 / 评分 / 历史不足等原因',
      '排查为何未进入 1B 或数据不完整',
      '否（不直接定 BUILD）',
      '无业务阈值',
      '系统诊断',
      '较稳定',
      '有异常时先看「数据异常」和「运行日志_V2」，不要先改规则。'
    ]
  ];
}

/**
 * 确保「指标说明」存在并重写为当前数据字典（可重复；不碰业务数据 Sheet）。
 */
function ensureMetricGuideSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const name = HOTWORD_V2.sheets.metrics;
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const headers = HOTWORD_V2.metricGuideHeaders;
  const rows = getMetricGuideRows_();
  const values = [headers].concat(rows);

  sheet.clear();
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.setTabColor('1D4ED8');

  const widths = [160, 200, 110, 200, 320, 220, 120, 260, 180, 90, 320];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

/**
 * 纯函数：根据已有 Sheet 名计算目标顺序。
 * preferred 在前（仅保留已存在的），其余保持 existingNames 相对顺序。
 * @param {string[]} existingNames
 * @param {string[]} preferredNames
 * @return {string[]}
 */
function buildSheetUiOrder_(existingNames, preferredNames) {
  const present = {};
  existingNames.forEach(n => { present[n] = true; });

  const used = {};
  const out = [];

  (preferredNames || []).forEach(n => {
    if (!present[n] || used[n]) return;
    out.push(n);
    used[n] = true;
  });

  existingNames.forEach(n => {
    if (used[n]) return;
    out.push(n);
    used[n] = true;
  });

  return out;
}

/**
 * 调整 Tab 顺序 + 隐藏旧 V1 Sheet。
 * 不删除任何 Sheet，不改表头与业务数据行。
 */
function organizeSheetUi_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  if (!sheets || !sheets.length) return;

  const existingNames = [];
  const byName = {};
  sheets.forEach(sheet => {
    const name = sheet.getName();
    existingNames.push(name);
    byName[name] = sheet;
  });

  const orderedNames = buildSheetUiOrder_(existingNames, HOTWORD_V2.sheetUiOrder);

  orderedNames.forEach((name, pos) => {
    const sheet = byName[name];
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(pos + 1);
  });

  (HOTWORD_V2.sheetUiHidden || []).forEach(hideName => {
    const hideSheet = byName[hideName];
    if (!hideSheet) return;
    if (!hideSheet.isSheetHidden()) hideSheet.hideSheet();
  });

  let focus = byName[HOTWORD_V2.sheets.usage] || byName[HOTWORD_V2.sheets.action] || ss.getSheets()[0];
  if (focus && focus.isSheetHidden()) {
    const visible = ss.getSheets().find(s => !s.isSheetHidden());
    if (visible) focus = visible;
  }
  if (focus) ss.setActiveSheet(focus);

  Logger.log('organizeSheetUi_ order=' + JSON.stringify(orderedNames));
}

/** 菜单/手动：整理使用说明、指标说明、顺序与隐藏，不改业务数据与规则阈值 */
function organizeSheetUi() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureUsageGuideSheet_(ss);
  ensureMetricGuideSheet_(ss);
  organizeSheetUi_(ss);
  safeToast_('工作表视图已整理：使用说明 / 指标说明 / 顺序 / 旧 V1 隐藏。', 'Steam 0→1B', 6);
}


// ============================================================================
// Games Popularity API Key
// ============================================================================

function setGamesPopularityApiKey() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '设置 Games Popularity API Key',
    '粘贴免费 API Key。Key 只保存在 Apps Script Script Properties，不写入 Sheet。',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  const key = String(result.getResponseText() || '').trim();
  if (!key) {
    ui.alert('未输入 API Key。');
    return;
  }

  PropertiesService.getScriptProperties().setProperty(HOTWORD_V2.gpKeyProperty, key);
  safeToast_('API Key 已保存。现在可以点“检查 API Key”。', 'Steam 0→1B', 6);
}

function checkGamesPopularityApiKey() {
  const key = getGamesPopularityApiKey_();
  const url = HOTWORD_V2.gpBase + '/game/latest/730?apiKey=' + encodeURIComponent(key);

  const resp = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  const code = resp.getResponseCode();

  if (code === 200) {
    safeToast_('API Key 可用。', 'Steam 0→1B', 5);
    return;
  }

  throw new Error('Games Popularity API Key 检查失败，HTTP ' + code + '：' + resp.getContentText().slice(0, 300));
}

function getGamesPopularityApiKey_() {
  const key = String(
    PropertiesService.getScriptProperties().getProperty(HOTWORD_V2.gpKeyProperty) || ''
  ).trim();

  if (!key) {
    throw new Error('未设置 Games Popularity API Key。先在菜单执行“设置 Games Popularity API Key”。');
  }
  return key;
}

/** Explicit operator action; the flag is consumed by exactly one normal run. */
function forceRefreshGamesPopularity() {
  PropertiesService.getScriptProperties().setProperty(HOTWORD_V2.gpForceRefreshProperty, '1');
  return runSteamHotword01B();
}


// ============================================================================
// 主流程 0 → 1B
// ============================================================================

function g010StateProperties_() {
  return PropertiesService.getScriptProperties();
}

function g010RunDateKey_(date, tz) {
  return Utilities.formatDate(date instanceof Date ? date : new Date(date), tz, 'yyyyMMdd');
}

function g010ReadState_() {
  const props = g010StateProperties_();
  const runId = String(props.getProperty(G010_STATE_KEYS.runId) || '').trim();
  if (!runId) return null;
  let discoveryAudit = {};
  try {
    discoveryAudit = JSON.parse(String(props.getProperty(G010_STATE_KEYS.discoveryAudit) || '{}'));
  } catch (auditErr) {
    discoveryAudit = {};
  }
  let controlData = {};
  try { controlData = JSON.parse(String(props.getProperty(G010_STATE_KEYS.controlData) || '{}')); } catch (err) {}
  return {
    runId: runId,
    phase: String(props.getProperty(G010_STATE_KEYS.phase) || 'DISCOVERY').trim(),
    source: String(props.getProperty(G010_STATE_KEYS.source) || HOTWORD_V2.sources[0].name).trim(),
    nextPage: Math.max(1, Number(props.getProperty(G010_STATE_KEYS.nextPage) || 1)),
    enrichmentCursor: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.enrichmentCursor) || 0)),
    controlCursor: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.controlCursor) || 0)),
    controlData: controlData,
    runDate: String(props.getProperty(G010_STATE_KEYS.runDate) || '').trim(),
    updatedAt: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.updatedAt) || 0)),
    consecutiveNoNew: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.consecutiveNoNew) || 0)),
    runStartedAt: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.runStartedAt) || 0)),
    discoveryComplete: String(props.getProperty(G010_STATE_KEYS.discoveryComplete) || '') === 'true',
    discoveryAudit: discoveryAudit,
    segmentCount: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.segmentCount) || 0)),
    pageRetryCount: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.pageRetryCount) || 0)),
    pageRetryStartedAt: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.pageRetryStartedAt) || 0)),
    nextRetryAt: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.nextRetryAt) || 0)),
    ledgerWriteFailures: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.ledgerWriteFailures) || 0)),
    ledgerAppended: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.ledgerAppended) || 0)),
    ledgerDuplicates: Math.max(0, Number(props.getProperty(G010_STATE_KEYS.ledgerDuplicates) || 0))
  };
}

function g010WriteState_(state) {
  const props = g010StateProperties_();
  const updatedAt = Math.max(0, Number(state.updatedAt || Date.now()));
  props.setProperty(G010_STATE_KEYS.runId, String(state.runId));
  props.setProperty(G010_STATE_KEYS.phase, String(state.phase));
  props.setProperty(G010_STATE_KEYS.source, String(state.source || ''));
  props.setProperty(G010_STATE_KEYS.nextPage, String(Math.max(1, Number(state.nextPage || 1))));
  props.setProperty(G010_STATE_KEYS.enrichmentCursor, String(Math.max(0, Number(state.enrichmentCursor || 0))));
  props.setProperty(G010_STATE_KEYS.controlCursor, String(Math.max(0, Number(state.controlCursor || 0))));
  props.setProperty(G010_STATE_KEYS.controlData, JSON.stringify(state.controlData || {}));
  props.setProperty(G010_STATE_KEYS.runDate, String(state.runDate || ''));
  props.setProperty(G010_STATE_KEYS.updatedAt, String(updatedAt));
  props.setProperty(G010_STATE_KEYS.consecutiveNoNew, String(Math.max(0, Number(state.consecutiveNoNew || 0))));
  props.setProperty(G010_STATE_KEYS.runStartedAt, String(Math.max(0, Number(state.runStartedAt || 0))));
  props.setProperty(G010_STATE_KEYS.discoveryComplete, state.discoveryComplete ? 'true' : 'false');
  props.setProperty(G010_STATE_KEYS.discoveryAudit, JSON.stringify(state.discoveryAudit || {}));
  props.setProperty(G010_STATE_KEYS.segmentCount, String(Math.max(0, Number(state.segmentCount || 0))));
  props.setProperty(G010_STATE_KEYS.pageRetryCount, String(Math.max(0, Number(state.pageRetryCount || 0))));
  props.setProperty(G010_STATE_KEYS.pageRetryStartedAt, String(Math.max(0, Number(state.pageRetryStartedAt || 0))));
  props.setProperty(G010_STATE_KEYS.nextRetryAt, String(Math.max(0, Number(state.nextRetryAt || 0))));
  props.setProperty(G010_STATE_KEYS.ledgerWriteFailures, String(Math.max(0, Number(state.ledgerWriteFailures || 0))));
  props.setProperty(G010_STATE_KEYS.ledgerAppended, String(Math.max(0, Number(state.ledgerAppended || 0))));
  props.setProperty(G010_STATE_KEYS.ledgerDuplicates, String(Math.max(0, Number(state.ledgerDuplicates || 0))));
  state.updatedAt = updatedAt;
}

function g010NewRunState_(startedAt, tz) {
  const ts = startedAt.getTime();
  return {
    runId: Utilities.formatDate(startedAt, tz, 'yyyyMMdd-HHmmss'),
    phase: 'DISCOVERY',
    source: HOTWORD_V2.sources[0].name,
    nextPage: 1,
    enrichmentCursor: 0,
    controlCursor: 0,
    controlData: {},
    runDate: g010RunDateKey_(startedAt, tz),
    updatedAt: ts,
    runStartedAt: ts,
    consecutiveNoNew: 0,
    discoveryComplete: false,
    discoveryAudit: {sources: {}},
    segmentCount: 0,
    pageRetryCount: 0,
    pageRetryStartedAt: 0,
    nextRetryAt: 0,
    ledgerWriteFailures: 0,
    ledgerAppended: 0,
    ledgerDuplicates: 0
  };
}

function g010InitDiscoveryAudit_(state) {
  if (!state.discoveryAudit || typeof state.discoveryAudit !== 'object') {
    state.discoveryAudit = {sources: {}};
  }
  if (!state.discoveryAudit.sources) state.discoveryAudit.sources = {};
  return state.discoveryAudit;
}

function g010RecordDiscoveryPage_(state, sourceName, page, itemsCount, newCount) {
  const audit = g010InitDiscoveryAudit_(state);
  if (!audit.sources[sourceName]) {
    audit.sources[sourceName] = {pages: [], pagesFetched: 0, itemsTotal: 0, newAppIds: 0, stopReason: ''};
  }
  const entry = audit.sources[sourceName];
  entry.pages.push({page: page, items: itemsCount, newAppIds: newCount});
  entry.pagesFetched = entry.pages.length;
  entry.itemsTotal += Math.max(0, Number(itemsCount || 0));
  entry.newAppIds += Math.max(0, Number(newCount || 0));
}

function g010FinishDiscoverySource_(state, sourceName, stopReason) {
  const audit = g010InitDiscoveryAudit_(state);
  if (!audit.sources[sourceName]) {
    audit.sources[sourceName] = {pages: [], pagesFetched: 0, itemsTotal: 0, newAppIds: 0, stopReason: stopReason || 'unknown'};
  } else {
    audit.sources[sourceName].stopReason = stopReason || audit.sources[sourceName].stopReason || 'unknown';
  }
}

function g010FormatDiscoveryAudit_(state) {
  const audit = state && state.discoveryAudit ? state.discoveryAudit : {sources: {}};
  const parts = [];
  HOTWORD_V2.sources.forEach(source => {
    const entry = audit.sources && audit.sources[source.name];
    if (!entry) {
      parts.push(source.name + '=pending');
      return;
    }
    parts.push(source.name + ':pages=' + entry.pagesFetched + '/5 items=' + entry.itemsTotal +
      ' new=' + entry.newAppIds + ' stop=' + (entry.stopReason || ''));
  });
  return parts.join('; ');
}

function g010LoadRunStats_() {
  try {
    const raw = g010StateProperties_().getProperty(G010_STATE_KEYS.runStats);
    if (!raw) return g010EmptyRunStats_();
    return Object.assign(g010EmptyRunStats_(), JSON.parse(raw));
  } catch (err) {
    return g010EmptyRunStats_();
  }
}

function g010SaveRunStats_(stats) {
  g010StateProperties_().setProperty(G010_STATE_KEYS.runStats, JSON.stringify(stats || g010EmptyRunStats_()));
}

function g010ComputeFinalStatsFromMaster_(ss, runId) {
  const stats = g010EmptyRunStats_();
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet || sheet.getLastRow() < 2) return stats;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const runCol = index('最近Run ID');
  if (runCol < 0) return stats;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    if (String(row[runCol] || '').trim() !== String(runId)) return;
    const rec = {
      result1A: row[index('1A结果')] || '',
      firstRoundType: row[index('第一轮类型')] || '',
      continueNext: row[index('进入下一步')] || '',
      priority: row[index('第一轮优先级')] || '',
      followers: row[index('Steam Followers')],
      gain7d: row[index('Steam 7d Gain')],
      growthRate: row[index('近似增长率')],
      releaseStage: row[index('发布阶段')] || '',
      releaseDate: row[index('Steam 发布日期')] || '',
      daysToRelease: row[index('距发售天数')],
      firstRoundReason: row[index('第一轮判定依据')] || ''
    };
    if (rec.firstRoundType === '⏳ 等待历史') stats.historyInsufficient += 1;
    g010AccumulateChunkStats_(stats, [rec]);
  });
  const snap = ss.getSheetByName(HOTWORD_V2.sheets.candidateSnapshot);
  if (snap && snap.getLastRow() >= 2) {
    const snapWidth = Math.max(snap.getLastColumn(), HOTWORD_V2.candidateSnapshotHeaders.length);
    const snapHeaders = snap.getRange(1, 1, 1, snapWidth).getDisplayValues()[0];
    const snapRunCol = snapHeaders.indexOf('Run ID');
    if (snapRunCol >= 0) {
      let candidates = 0;
      snap.getRange(2, 1, snap.getLastRow() - 1, snapWidth).getValues().forEach(row => {
        if (String(row[snapRunCol] || '').trim() === String(runId)) candidates += 1;
      });
      stats.candidates = candidates;
    }
  }
  return stats;
}

function g010EvaluateRunCompletion_(state, runContext, discoveryPartial) {
  const issues = [];
  const eligibleTotal = runContext ? runContext.eligible.length : 0;
  const controlTotal = runContext && runContext.controls ? runContext.controls.length : 0;
  const enrichmentDone = Number(state.enrichmentCursor || 0) >= eligibleTotal;
  const controlDone = Number(state.controlCursor || 0) >= controlTotal;
  if (!state.discoveryComplete) issues.push('discovery-incomplete');
  if (discoveryPartial) issues.push('discovery-fetch-partial');
  if (Number(state.ledgerWriteFailures || 0) > 0) issues.push('RAW_LEDGER_WRITE_FAILED');
  if (!enrichmentDone) issues.push('enrichment-incomplete');
  if (!controlDone) issues.push('control-enrichment-incomplete');
  HOTWORD_V2.sources.forEach(source => {
    const entry = state.discoveryAudit && state.discoveryAudit.sources
      ? state.discoveryAudit.sources[source.name] : null;
    if (!entry || !entry.stopReason) {
      issues.push('source-audit-missing:' + source.name);
      return;
    }
    if (entry.stopReason === 'fetch-failure' || entry.stopReason === 'fetch-failure-exhausted') return;
    if (entry.pagesFetched < G010_DISCOVERY_MAX_PAGES &&
        entry.stopReason !== 'empty-page' && entry.stopReason !== 'empty-page-1') {
      issues.push('source-pages-incomplete:' + source.name + ':' + entry.stopReason);
    }
  });
  return {ok: !issues.length, status: issues.length ? 'PARTIAL' : 'SUCCESS', issues: issues};
}

function g010ContinuationDelayMs_(phase) {
  if (String(phase || '').toUpperCase() === 'ENRICHMENT') return G010_ENRICHMENT_CONTINUATION_DELAY_MS;
  if (String(phase || '').toUpperCase() === 'DISCOVERY') return G010_403_CONTINUATION_DELAY_MS;
  return 60 * 1000;
}

function g010DiscoveryFetchErrorRetryable_(err) {
  const httpStatus = err && err.httpStatus;
  const message = String(err && err.message || err || '');
  return isSteamRetryableHttpStatus_(httpStatus) || /HTTP\s+(403|429|5\d\d)/i.test(message) ||
    /网络错误|NETWORK|ECONNRESET|ETIMEDOUT|timeout/i.test(message);
}

function g010DiscoveryRetryDelayMs_(retryCount, err) {
  const base = err && Number(err.httpStatus) === 429 ? G010_403_CONTINUATION_DELAY_MS : 90 * 1000;
  return Math.min(5 * 60 * 1000, base * Math.max(1, Number(retryCount || 1)));
}

function g010ClearPageRetryState_(state) {
  state.pageRetryCount = 0;
  state.pageRetryStartedAt = 0;
  state.nextRetryAt = 0;
}

function g010DiscoveryFetchRecovery_(state, now, err) {
  const page = Math.max(1, Number(state.nextPage || 1));
  if (page > G010_DISCOVERY_MAX_PAGES) return {action: 'PARTIAL', state: state};
  const retryCount = Math.max(0, Number(state.pageRetryCount || 0)) + 1;
  const startedAt = Number(state.pageRetryStartedAt || now.getTime());
  const windowExpired = now.getTime() - startedAt > G010_PAGE_RECOVERY_WINDOW_MS;
  if (retryCount > G010_PAGE_RECOVERY_MAX_ATTEMPTS || windowExpired) {
    return {
      action: 'PARTIAL',
      state: Object.assign({}, state, {pageRetryCount: retryCount, pageRetryStartedAt: startedAt}),
      reason: windowExpired ? 'recovery-window-expired' : 'recovery-attempts-exhausted'
    };
  }
  const delayMs = g010DiscoveryRetryDelayMs_(retryCount, err);
  return {
    action: 'YIELD',
    delayMs: delayMs,
    state: Object.assign({}, state, {
      pageRetryCount: retryCount,
      pageRetryStartedAt: startedAt,
      nextRetryAt: now.getTime() + delayMs
    })
  };
}

function g010LoadCachedDiscoveryPage_(sourceName, page, nowMs) {
  const cached = loadSteamSourceCache_(sourceName);
  if (!cached || !cached.items || !cached.items.length) return null;
  if (!isSteamSourceCacheFresh_(cached, nowMs, HOTWORD_V2.steamHttp.cacheMaxAgeMs)) return null;
  const pageItems = cached.items.filter(item => Number(item._sourcePage || item.sourcePage || 0) === Number(page));
  if (!pageItems.length) return null;
  return {items: pageItems, cacheAgeMs: nowMs - Number(cached.savedAtMs || 0)};
}

function g010RearmContinuationForState_(state) {
  const phase = state && state.phase;
  let delayMs = g010ContinuationDelayMs_(phase);
  if (state && state.phase === 'DISCOVERY' && Number(state.nextRetryAt || 0) > Date.now()) {
    delayMs = Math.max(30 * 1000, Number(state.nextRetryAt) - Date.now());
  }
  g010RearmContinuation_(delayMs);
}

function g010BumpSegmentCount_(state, options) {
  if (options.forceNewRun) {
    state.segmentCount = 1;
    return state;
  }
  state.segmentCount = Math.max(0, Number(state.segmentCount || 0)) + 1;
  return state;
}

function g010EmptyRunStats_() {
  return {
    pass1A: 0, excluded1A: 0, trend: 0, early: 0, control: 0, low: 0, anomaly: 0,
    enriched: 0, candidates: 0, p2Trend: 0, p2Early: 0, historyInsufficient: 0,
    cacheHits: 0, realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0, failuresKept: 0
  };
}

function g010BuildRunContext_(ss, state, startedAt, tz) {
  const rawRecords = g010RawRecordsForRun_(ss, state.runId);
  const previous = g010PreviousRawIndex_(ss, state.runId);
  const qualification = readQualificationStateIndex_(ss);
  const decisions = readCandidateDecisions_(ss);
  const history = buildHistoryIndex_(ss);
  const rules = loadRules_(ss);
  const gpCache = readDailyGamesPopularityCache_(ss, startedAt);
  const eligible = [];
  const rejected = [];
  let historyExcluded = 0;
  rawRecords.forEach(rec => {
    if (isInHistoryIndex_(rec, history)) {
      historyExcluded += 1;
      return;
    }
    const eligibility = evaluateQualificationEligibility_(rec, {
      previousRaw: previous.get(rec.appId), qualification: qualification.get(rec.appId),
      decision: decisions.get(rec.appId), now: startedAt, rules: rules
    });
    if (g010EnrichmentEligible_(eligibility)) eligible.push(rec);
    else rejected.push(rec);
  });
  const controls = g010SelectRejectedControls_(rejected, state.runId);
  controls.forEach(rec => { if (state.controlData && state.controlData[String(rec.appId)]) Object.assign(rec, state.controlData[String(rec.appId)]); });
  return {
    runId: state.runId,
    rawRecords: rawRecords,
    previousRaw: previous,
    qualification: qualification,
    decisions: decisions,
    history: history,
    rules: rules,
    gpCache: gpCache,
    eligible: eligible,
    controls: controls,
    historyExcluded: historyExcluded,
    stats: g010LoadRunStats_()
  };
}

// Small, reproducible stratified sample. Hash order is stable for Run ID + App ID;
// round-robin over source/rank/stage groups gives coverage without a model.
function g010ControlHash_(value) {
  let hash = 2166136261;
  String(value || '').split('').forEach(ch => { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); });
  return hash >>> 0;
}

function g010ControlGroup_(rec) {
  const source = String(rec.source || '').trim() || 'UNKNOWN_SOURCE';
  const rank = Number(rec.sourceRank);
  const rankGroup = isFinite(rank) ? 'R' + (Math.floor((rank - 1) / 50) + 1) : 'R_UNKNOWN';
  const stage = String(rec.releaseStage || '').trim() || 'UNKNOWN_STAGE';
  return source + '|' + rankGroup + '|' + stage;
}

function g010SelectRejectedControls_(rejected, runId) {
  const groups = {};
  (rejected || []).forEach(rec => {
    const group = g010ControlGroup_(rec);
    if (!groups[group]) groups[group] = [];
    rec._controlSampleGroup = group;
    groups[group].push(rec);
  });
  Object.keys(groups).forEach(group => groups[group].sort((a, b) =>
    g010ControlHash_(runId + '|' + a.appId) - g010ControlHash_(runId + '|' + b.appId)));
  const selected = [];
  const keys = Object.keys(groups).sort();
  let index = 0;
  while (selected.length < 20) {
    let added = false;
    keys.forEach(group => {
      if (selected.length >= 20 || !groups[group][index]) return;
      selected.push(groups[group][index]); added = true;
    });
    if (!added) break;
    index += 1;
  }
  selected.forEach(rec => {
    rec.controlSampleGroup = rec._controlSampleGroup;
    rec.controlSampleReason = 'REJECTED_RANDOM_SAMPLE';
    rec.controlSampleFlag = true;
    delete rec._controlSampleGroup;
  });
  return selected;
}

function g010EnrichControlChunk_(ss, records, runId, runTime, warnings, runContext) {
  if (!records || !records.length) return;
  const gpKey = getGamesPopularityApiKey_();
  const gpStats = runContext.stats;
  const cache = runContext.gpCache || readDailyGamesPopularityCache_(ss, runTime);
  const partition = partitionDailyGamesPopularityCache_(records, cache);
  partition.hits.forEach(rec => { rec._gpDailyCache = cache.get(String(rec.appId)); });
  gpStats.cacheHits = Number(gpStats.cacheHits || 0) + partition.hits.length;
  const context = {ss: ss, runId: runId, runTime: runTime, refreshReason: 'POLICY_MISS', attemptBuffer: []};
  const latestMap = fetchGamesPopularityLatestBatch_(partition.misses, gpKey, warnings, gpStats, context);
  records.forEach(rec => {
    if (rec._gpDailyCache) Object.assign(rec, rec._gpDailyCache);
    else {
      const latest = latestMap.get(rec.appId);
      if (latest && latest.followers && isFiniteNumber_(latest.followers.followers)) {
        rec.followers = Number(latest.followers.followers);
        rec._gpLatestFresh = true;
      }
    }
  });
  const history = fetchGamesPopularityFollowersBatch_(partition.misses, gpKey, warnings, gpStats, context);
  records.forEach(rec => {
    if (rec._gpDailyCache && isFiniteNumber_(rec.gain7d) && isFiniteNumber_(rec.growthRate)) {
      rec._gpEnrichmentFresh = true;
      return;
    }
    const growth = computeFollowerGrowth_(history.get(rec.appId), rec.followers, runTime, runContext.rules.FOLLOWER_HISTORY_MIN_DAYS);
    if (growth.ok) {
      rec.baselineFollowers = growth.baselineFollowers; rec.gain7d = growth.gain;
      rec.growthRate = growth.growthRate; rec.coverageDays = growth.coverageDays;
      rec._gpEnrichmentFresh = true;
    } else rec._gpEnrichmentFailed = true;
  });
  flushGamesPopularityAttempts_(context);
  records.filter(rec => rec._gpEnrichmentFresh && !rec._gpDailyCache).forEach(rec => cache.set(String(rec.appId), {
    observedAt: runTime, followers: rec.followers, baselineFollowers: rec.baselineFollowers,
    gain7d: rec.gain7d, growthRate: rec.growthRate, coverageDays: rec.coverageDays
  }));
  runContext.gpCache = cache;
}

function g010AccumulateChunkStats_(stats, records) {
  (records || []).forEach(rec => {
    if (rec._gpEnrichmentFresh) stats.enriched += 1;
    if (rec.result1A === '✅ 通过（主池）' || rec.result1A === '✅ 通过（对照预留）') stats.pass1A += 1;
    else if (rec.result1A === '❌ 排除') stats.excluded1A += 1;
    else if (rec.result1A === '⚠ 数据异常') stats.anomaly += 1;
    const type = String(rec.firstRoundType || '');
    if (type.indexOf('🔥') >= 0) stats.trend += 1;
    else if (type === '🟡 Trend Watch') stats.p2Trend += 1;
    else if (type === '🟢 Early Watch') stats.p2Early += 1;
    else if (type.indexOf('🌱') >= 0 || type.indexOf('Early') >= 0) stats.early += 1;
    else if (type.indexOf('🏢') >= 0 || type.indexOf('对照') >= 0) stats.control += 1;
    else if (type.indexOf('⚪') >= 0 || type.indexOf('低优先级') >= 0) stats.low += 1;
    if (isDailyCandidateSnapshotRecord_(rec)) stats.candidates += 1;
  });
  return stats;
}

function g010RunMetrics_(state, runContext, startedAt, runStartedAt) {
  const stats = runContext && runContext.stats ? runContext.stats : g010LoadRunStats_();
  const rawTotal = runContext ? runContext.rawRecords.length : 0;
  const eligibleTotal = runContext ? runContext.eligible.length : 0;
  const processed = Math.max(0, Number(state.enrichmentCursor || 0));
  const runStart = Number(runStartedAt || state.runStartedAt || startedAt.getTime());
  return {
    rawTotal: rawTotal,
    rawPersisted: rawTotal,
    ledgerAppended: Math.max(0, Number(state.ledgerAppended || 0)),
    ledgerDuplicates: Math.max(0, Number(state.ledgerDuplicates || 0)),
    ledgerWriteFailures: Math.max(0, Number(state.ledgerWriteFailures || 0)),
    historyExcluded: runContext ? runContext.historyExcluded : 0,
    eligibleTotal: eligibleTotal,
    enrichmentProcessed: processed,
    enrichmentTotal: eligibleTotal,
    controlSampleRequested: runContext && runContext.controls ? runContext.controls.length : 0,
    controlSampleComplete: runContext && runContext.controls ? runContext.controls.filter(rec => rec._gpEnrichmentFresh).length : 0,
    controlSampleFailed: runContext && runContext.controls ? runContext.controls.filter(rec => rec._gpEnrichmentFailed && !rec._gpEnrichmentFresh).length : 0,
    pass1A: stats.pass1A,
    excluded1A: stats.excluded1A,
    trend: stats.trend,
    early: stats.early,
    control: stats.control,
    low: stats.low,
    anomaly: stats.anomaly,
    candidates: stats.candidates,
    p2Trend: stats.p2Trend,
    p2Early: stats.p2Early,
    historyInsufficient: stats.historyInsufficient,
    gpCacheHits: stats.cacheHits,
    gpRealtimeRequests: stats.realtimeRequests,
    gpRealtimeSuccess: stats.realtimeSuccess,
    gpRateLimited: stats.rateLimited,
    gpFailuresKept: stats.failuresKept,
    elapsedSec: Math.max(0, Math.round((Date.now() - runStart) / 1000)),
    phase: state.phase,
    cursor: processed,
    discoveryComplete: !!state.discoveryComplete,
    segmentCount: Math.max(1, Number(state.segmentCount || 1))
  };
}

function g010FormatCheckpointDetail_(state, metrics) {
  return [
    'G010 checkpoint',
    'runId=' + (state.runId || ''),
    'phase=' + (state.phase || ''),
    'runDate=' + (state.runDate || ''),
    'discovery=' + (metrics.discoveryComplete ? 'complete' : 'in-progress'),
    g010FormatDiscoveryAudit_(state),
    'raw=' + metrics.rawTotal,
    'ledgerAppended=' + metrics.ledgerAppended,
    'ledgerDuplicates=' + metrics.ledgerDuplicates,
    'ledgerWriteFailures=' + metrics.ledgerWriteFailures,
    'eligible=' + metrics.eligibleTotal,
    'enrichment=' + metrics.enrichmentProcessed + '/' + metrics.enrichmentTotal,
    'control=' + metrics.controlSampleComplete + '/' + metrics.controlSampleRequested + ' failed=' + metrics.controlSampleFailed,
    'cursor=' + metrics.cursor,
    'candidates=' + metrics.candidates,
    '1A=' + metrics.pass1A,
    'seg=' + metrics.segmentCount,
    'wallSec=' + metrics.elapsedSec
  ].join(' | ');
}

function g010FormatSuccessDetail_(state, metrics, completion) {
  return [
    completion && completion.status === 'SUCCESS' ? 'G010 DONE' : 'G010 INCOMPLETE',
    'runId=' + (state.runId || ''),
    g010FormatDiscoveryAudit_(state),
    'raw=' + metrics.rawTotal,
    'ledgerAppended=' + metrics.ledgerAppended,
    'ledgerDuplicates=' + metrics.ledgerDuplicates,
    'ledgerWriteFailures=' + metrics.ledgerWriteFailures,
    'eligible=' + metrics.eligibleTotal,
    'enriched=' + metrics.enrichmentProcessed + '/' + metrics.enrichmentTotal,
    '1A=' + metrics.pass1A,
    'excluded1A=' + metrics.excluded1A,
    'trend=' + metrics.trend,
    'early=' + metrics.early,
    'control=' + metrics.control,
    'low=' + metrics.low,
    'p2Trend=' + metrics.p2Trend,
    'p2Early=' + metrics.p2Early,
    'candidates=' + metrics.candidates,
    'seg=' + metrics.segmentCount,
    'wallSec=' + metrics.elapsedSec,
    completion && completion.issues && completion.issues.length
      ? 'issues=' + completion.issues.join(',') : ''
  ].filter(Boolean).join(' | ');
}

function g010FinalizeRun_(ss, state, runContext, startedAt, discoveryPartial) {
  const completion = g010EvaluateRunCompletion_(state, runContext, discoveryPartial);
  const finalStats = g010ComputeFinalStatsFromMaster_(ss, state.runId);
  const metrics = g010RunMetrics_(state, runContext, startedAt, state.runStartedAt);
  Object.assign(metrics, finalStats);
  metrics.enrichmentProcessed = Math.max(metrics.enrichmentProcessed, metrics.eligibleTotal);
  const snapshotResult = g010WriteFinalCandidateSnapshotFromMaster_(ss, state.runId, startedAt);
  refreshTodayActionsFromCandidateDecisions_(ss, startedAt, state.runId, {});
  metrics.candidates = Math.max(finalStats.candidates, Number(snapshotResult && snapshotResult.persisted || 0));
  const historical = g022FinalizeHistoricalRun_(ss, state, runContext, metrics, completion, new Date(), {});
  if (!historical.ok) {
    completion.issues.push('HISTORICAL_FEATURE_WRITE_FAILED');
    completion.status = 'PARTIAL';
    g010WriteState_(state);
    g010RearmContinuationForPhase_('ENRICHMENT');
  }
  const finalStatus = completion.status;
  g010UpsertAuditRow_(ss, state, finalStatus, g010FormatSuccessDetail_(state, metrics, completion), metrics);
  const driveExport = saveSteamMonitoringRaw_(state.runId, startedAt, ss.getId());
  if (driveExport && (driveExport.skipped || driveExport.error)) {
    metrics.driveExportWarning = String(driveExport.reason || driveExport.error || 'drive_export_skipped');
  }
  if (historical.ok) g010ClearState_();
  return {status: finalStatus, runId: state.runId, metrics: metrics, completion: completion,
    historical: historical, driveExport: driveExport};
}

function g010WriteFinalCandidateSnapshotFromMaster_(ss, runId, runTime) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet || sheet.getLastRow() < 2) return {persisted: 0};
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const runCol = index('最近Run ID');
  if (runCol < 0) return {persisted: 0};
  const records = [];
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    if (String(row[runCol] || '').trim() !== String(runId)) return;
    const rec = {
      appId: String(row[index('Steam App ID')] || '').trim(),
      name: row[index('游戏名称')] || '',
      priority: row[index('第一轮优先级')] || '',
      firstRoundType: row[index('第一轮类型')] || '',
      continueNext: row[index('进入下一步')] || '',
      followers: row[index('Steam Followers')],
      gain7d: row[index('Steam 7d Gain')],
      growthRate: row[index('近似增长率')],
      releaseStage: row[index('发布阶段')] || '',
      releaseDate: row[index('Steam 发布日期')] || '',
      daysToRelease: row[index('距发售天数')],
      firstRoundReason: row[index('第一轮判定依据')] || ''
    };
    if (isDailyCandidateSnapshotRecord_(rec)) records.push(rec);
  });
  return writeDailyCandidateSnapshot_(ss, records, runTime, runId, {idempotency: 'run'});
}

function g010IsContinuationValid_(state, now, tz) {
  if (!state || !state.runId) return false;
  if (G010_ABANDON_RUN_IDS.indexOf(state.runId) >= 0) return false;
  if (String(state.phase || '').toUpperCase() === 'DONE') return false;
  if (state.phase === 'DISCOVERY' && Number(state.nextPage || 1) > G010_DISCOVERY_MAX_PAGES) return false;
  const todayKey = g010RunDateKey_(now, tz);
  if (state.runDate && state.runDate !== todayKey) return false;
  const updatedAt = Number(state.updatedAt || 0);
  if (updatedAt > 0 && now.getTime() - updatedAt > G010_CONTINUATION_TTL_MS) return false;
  return true;
}

function g010ContinuationOwnsActiveRun_(state) {
  const active = g010ReadState_();
  return !!(state && state.runId && active && active.runId === state.runId);
}

function g010AbandonState_(ss, state, reason) {
  if (!state) return;
  try {
    g010UpsertAuditRow_(ss, state, 'ABANDONED',
      'G010 continuation abandoned; reason=' + reason +
      ' | runDate=' + (state.runDate || '') +
      ' | source=' + (state.source || '') +
      ' | nextPage=' + state.nextPage);
  } catch (auditErr) {
    // Abandon must still clear stale ScriptProperties even if audit write fails.
  }
  g010ClearState_();
}

function g010ClearLegacySourceContinuations_() {
  const props = PropertiesService.getScriptProperties();
  props.getKeys().forEach(key => {
    if (/^STEAM_SOURCE_CONTINUATION_V1_/i.test(String(key))) props.deleteProperty(key);
  });
}

function g010ClearStaleContinuation_(ss, tz, now) {
  g010ClearLegacySourceContinuations_();
  const state = g010ReadState_();
  if (!state) return null;
  const reasons = [];
  if (G010_ABANDON_RUN_IDS.indexOf(state.runId) >= 0) reasons.push('explicit-abandon-list');
  if (state.runDate && state.runDate !== g010RunDateKey_(now, tz)) reasons.push('cross-day');
  if (state.phase === 'DISCOVERY' && Number(state.nextPage || 1) > G010_DISCOVERY_MAX_PAGES) {
    reasons.push('deep-pagination-nextPage=' + state.nextPage);
  }
  const updatedAt = Number(state.updatedAt || 0);
  if (updatedAt > 0 && now.getTime() - updatedAt > G010_CONTINUATION_TTL_MS) reasons.push('ttl-expired');
  if (!reasons.length) return state;
  g010AbandonState_(ss, state, reasons.join(';'));
  return null;
}

function g010ClearState_() {
  const props = g010StateProperties_();
  Object.keys(G010_STATE_KEYS).forEach(key => props.deleteProperty(G010_STATE_KEYS[key]));
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
}

function g010ScheduleContinuation_(delayMs) {
  const triggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
  );
  // Keep one existing trigger when possible; deleting it before create could
  // leave a PARTIAL run without recovery if trigger creation is rejected.
  triggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
  if (!triggers.length) {
    ScriptApp.newTrigger(G010_CONTINUATION_HANDLER).timeBased()
      .after(Math.max(30 * 1000, Number(delayMs || 0))).create();
  }
}

function g010RearmContinuation_(delayMs) {
  const oldTriggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
  );
  // Create first. If Apps Script rejects creation, the old trigger remains
  // available and the PARTIAL run is still recoverable.
  ScriptApp.newTrigger(G010_CONTINUATION_HANDLER).timeBased()
      .after(Math.max(30 * 1000, Number(delayMs || 0))).create();
  oldTriggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return true;
}

function g010EnsureContinuationTrigger_(phase) {
  const triggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
  );
  const action = g010ContinuationTriggerAction_(phase || (g010ReadState_() && g010ReadState_().phase), triggers.length);
  if (action === 'CREATE') g010ScheduleContinuation_(g010ContinuationDelayMs_(phase));
  else if (action === 'REMOVE_DUPLICATES') triggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function g010RearmContinuationForPhase_(phase) {
  g010RearmContinuation_(g010ContinuationDelayMs_(phase));
}

function g010ContinuationTriggerAction_(phase, triggerCount) {
  if (['DONE', 'SUCCESS'].indexOf(String(phase || '').toUpperCase()) >= 0) return 'CLEAR';
  if (Number(triggerCount) <= 0) return 'CREATE';
  if (Number(triggerCount) > 1) return 'REMOVE_DUPLICATES';
  return 'KEEP';
}

function g010ContinuationHealth_(phase, triggerCount, lastProgressMs, nowMs, staleMs) {
  const terminal = ['DONE', 'SUCCESS'].indexOf(String(phase || '').toUpperCase()) >= 0;
  if (terminal) return {health: 'DONE', action: 'CLEAR'};
  const last = Number(lastProgressMs || 0);
  const age = last > 0 ? Math.max(0, Number(nowMs) - last) : Infinity;
  if (age > Number(staleMs || G010_CONTINUATION_STALE_MS)) {
    return {health: 'STALE', action: 'REARM', ageMs: age};
  }
  if (Number(triggerCount) <= 0) return {health: 'MISSING', action: 'CREATE', ageMs: age};
  if (Number(triggerCount) > 1) return {health: 'HEALTHY', action: 'REMOVE_DUPLICATES', ageMs: age};
  return {health: 'HEALTHY', action: 'KEEP', ageMs: age};
}

function g010LastProgressTime_(ss, runId) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.log);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.logHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const runCol = headers.indexOf('Run ID');
  const timeCol = headers.indexOf('运行时间');
  if (runCol < 0 || timeCol < 0) return null;
  let latest = 0;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    if (String(row[runCol] || '').trim() !== String(runId || '').trim()) return;
    const value = row[timeCol] instanceof Date ? row[timeCol].getTime() : Date.parse(String(row[timeCol] || ''));
    if (isFinite(value) && value > latest) latest = value;
  });
  return latest ? new Date(latest) : null;
}

/** Temporary operator action: restore the confirmed interrupted Run only. */
function restoreG010CurrentRun() {
  const targetRunId = '20260830-142107';
  const targetSource = 'Popular Upcoming';
  const targetPage = 13;
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const rawRecords = g010RawRecordsForRun_(ss, targetRunId);
  if (!rawRecords.length) {
    SpreadsheetApp.getUi().alert('未找到 Run ID ' + targetRunId + ' 的 Raw Observation，未恢复任何状态。');
    return {ok: false, runId: targetRunId, rawCount: 0};
  }
  const state = {
    runId: targetRunId,
    phase: 'DISCOVERY',
    source: targetSource,
    nextPage: targetPage,
    enrichmentCursor: 0
  };
  g010WriteState_(state);
  g010UpsertAuditRow_(ss, state, 'PARTIAL',
    'G010 manual recovery; raw=' + rawRecords.length + ' source=' + targetSource + ' nextPage=' + targetPage);
  g010ScheduleContinuation_(G010_403_CONTINUATION_DELAY_MS);
  SpreadsheetApp.getUi().alert(
    'G010 当前 Run 已恢复\nRun ID: ' + targetRunId + '\nRaw: ' + rawRecords.length +
    '\n继续位置: ' + targetSource + ' page ' + targetPage + '\n已安排唯一 continuation trigger。'
  );
  return {ok: true, runId: targetRunId, rawCount: rawRecords.length, source: targetSource, nextPage: targetPage};
}

/** Temporary operator action: stop only the confirmed stale G010 production Run. */
function stopG010CurrentRun() {
  const targetRunId = '20260831-084334';
  const state = g010ReadState_();
  if (!state || state.runId !== targetRunId) {
    const message = '未停止：当前 G010 state 不匹配目标 Run ' + targetRunId;
    SpreadsheetApp.getUi().alert(message);
    return {ok: false, runId: targetRunId, state: state};
  }
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  g010UpsertAuditRow_(ss, state, 'STOPPED',
    'PARTIAL_VALIDATED; production validation sufficient; AUTO pagination / Raw persistence / ' +
    'release-date parser / eligibility gate verified; long-running Apps Script trigger reliability deferred');
  // This clears only G010 ScriptProperties and runG010Continuation_ triggers;
  // Raw Observation rows are append-only and are deliberately untouched.
  g010ClearState_();
  SpreadsheetApp.getUi().alert(
    'G010 当前 Run 已停止\nRun ID: ' + targetRunId +
    '\n状态: STOPPED\nStale continuation 已清除；Raw Observation 已保留。'
  );
  return {ok: true, runId: targetRunId, status: 'STOPPED', validation: 'PARTIAL_VALIDATED'};
}

/** Temporary operator action: inspect state and repair a missing trigger only. */
function inspectOrRestoreG010Continuation() {
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const state = g010ReadState_();
  const triggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
  );
  const lastProgress = state ? g010LastProgressTime_(ss, state.runId) : null;
  const health = state ? g010ContinuationHealth_(state.phase, triggers.length,
    lastProgress ? lastProgress.getTime() : 0, Date.now(), G010_CONTINUATION_STALE_MS) :
    {health: 'NONE', action: 'NO_ACTION'};
  let repaired = false;
  if (state && health.action === 'REARM') {
    g010RearmContinuation_(60 * 1000);
    repaired = true;
    g010UpsertAuditRow_(ss, state, 'PARTIAL', 'G010 continuation stale; re-armed; phase=' + state.phase +
      ' source=' + state.source + ' nextPage=' + state.nextPage);
  } else if (state && health.action === 'CREATE') {
    g010EnsureContinuationTrigger_();
    g010UpsertAuditRow_(ss, state, 'PARTIAL', 'G010 continuation trigger restored; phase=' + state.phase +
      ' source=' + state.source + ' nextPage=' + state.nextPage);
    repaired = true;
  } else if (state && health.action === 'REMOVE_DUPLICATES') {
    g010EnsureContinuationTrigger_();
  }
  const currentTriggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
  );
  const message = [
    'G010 Continuation 状态',
    'state: ' + (state ? JSON.stringify(state) : 'NONE'),
    'trigger count: ' + currentTriggers.length,
    'last progress: ' + (lastProgress ? lastProgress.toISOString() : 'NONE'),
    'health: ' + health.health,
    'repair: ' + (repaired ? (health.action === 'REARM' ? 'RE-ARMED' : 'CREATED') : 'NO ACTION')
  ].join('\n');
  SpreadsheetApp.getUi().alert(message);
  return {ok: true, state: state, triggerCount: currentTriggers.length, lastProgress: lastProgress,
    health: health.health, repaired: repaired};
}

function g010UpsertAuditRow_(ss, state, status, detail, metrics) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.log);
  if (!sheet) return;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.logHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const runCol = headers.indexOf('Run ID');
  if (runCol < 0) return;
  const m = metrics || {};
  const rowValues = Array(HOTWORD_V2.logHeaders.length).fill('');
  rowValues[0] = new Date();
  rowValues[1] = state.runId;
  rowValues[2] = status;
  rowValues[3] = m.rawTotal != null ? m.rawTotal : '';
  rowValues[4] = m.historyExcluded != null ? m.historyExcluded : '';
  rowValues[5] = m.enrichmentProcessed != null ? m.enrichmentProcessed : '';
  rowValues[6] = m.pass1A != null ? m.pass1A : '';
  rowValues[7] = m.excluded1A != null ? m.excluded1A : '';
  rowValues[8] = m.trend != null ? m.trend : '';
  rowValues[9] = m.early != null ? m.early : '';
  rowValues[10] = m.control != null ? m.control : '';
  rowValues[11] = m.low != null ? m.low : '';
  rowValues[12] = m.anomaly != null ? m.anomaly : '';
  rowValues[13] = m.actionCount != null ? m.actionCount : '';
  rowValues[14] = m.elapsedSec != null ? m.elapsedSec : '';
  rowValues[15] = detail || '';
  rowValues[16] = m.rawTotal != null ? m.rawTotal : '';
  rowValues[17] = m.rawPersisted != null ? m.rawPersisted : (m.rawTotal != null ? m.rawTotal : '');
  rowValues[18] = m.eligibleTotal != null ? m.eligibleTotal : '';
  rowValues[19] = 'G010 resumable; phase=' + (state.phase || '') + '; cursor=' + (state.enrichmentCursor || 0);
  rowValues[20] = m.p2Trend != null ? m.p2Trend : '';
  rowValues[21] = m.p2Early != null ? m.p2Early : '';
  rowValues[22] = m.historyInsufficient != null ? m.historyInsufficient : '';
  rowValues[23] = m.gpCacheHits != null ? m.gpCacheHits : '';
  rowValues[24] = m.gpRealtimeRequests != null ? m.gpRealtimeRequests : '';
  rowValues[25] = m.gpRealtimeSuccess != null ? m.gpRealtimeSuccess : '';
  rowValues[26] = m.gpRateLimited != null ? m.gpRateLimited : '';
  rowValues[27] = m.gpFailuresKept != null ? m.gpFailuresKept : '';

  let rowNumber = 0;
  if (sheet.getLastRow() >= 2) {
    const rows = sheet.getRange(2, runCol + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    rows.some((row, index) => {
      if (String(row[0] || '').trim() !== String(state.runId)) return false;
      rowNumber = index + 2;
      return true;
    });
  }
  if (!rowNumber) {
    sheet.appendRow(rowValues);
    return;
  }
  sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
}

function g010ShouldYield_(startedAtMs, nowMs) {
  return Number(nowMs) - Number(startedAtMs) >= G010_EXECUTION_BUDGET_MS;
}

function g010ContinuationState_(state) {
  return Object.assign({}, state, {runId: state.runId});
}

function g010NextDiscoveryState_(state, sourceIndex, sourceCount) {
  const next = Object.assign({}, state);
  next.consecutiveNoNew = 0;
  next.updatedAt = Date.now();
  if (sourceIndex + 1 < sourceCount) {
    next.source = HOTWORD_V2.sources[sourceIndex + 1].name;
    next.nextPage = 1;
  } else {
    next.phase = 'ELIGIBILITY';
    next.source = '';
    next.nextPage = 1;
    next.enrichmentCursor = 0;
    next.discoveryComplete = true;
  }
  return next;
}

function g010EnrichmentEligible_(eligibility) {
  return !!(eligibility && eligibility.eligible === true);
}

function g010DoneState_(state) {
  return Object.assign({}, state, {phase: 'DONE'});
}

function g010DiscoveryFailureRecovery_(state, error) {
  const message = String(error && error.message || error || '');
  const retryable = isSteamRetryableHttpStatus_(error && error.httpStatus) || /HTTP\s+(403|429|5\d\d)/i.test(message);
  if (!retryable) return {retryable: false, state: state, message: message};
  return {
    retryable: true,
    state: Object.assign({}, state, {phase: 'DISCOVERY', nextPage: state.nextPage}),
    message: message,
    continuationDelayMs: G010_403_CONTINUATION_DELAY_MS
  };
}

/** Scheduled/menu entry: resume an unfinished run; otherwise start one. */
function runSteamHotwordDaily_() {
  return runSteamHotword01B({scheduledDaily: true});
}

function runG010Continuation_() {
  return runSteamHotword01B({fromContinuation: true});
}

/** Resume the active G010 run once (continuation segment). */
function g010ContinueActiveRunOnce_() {
  return runG010Continuation_();
}

function g010MaybeKickPartialRun_() {
  const state = g010ReadState_();
  if (!state || String(state.phase || '').toUpperCase() !== 'ENRICHMENT') return {kicked: false};
  const triggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
  );
  if (triggers.length) return {kicked: false, triggerCount: triggers.length};
  g010RearmContinuationForPhase_(state.phase);
  return {kicked: true, runId: state.runId, enrichmentCursor: state.enrichmentCursor};
}

function g010RawRecordsForRun_(ss, runId) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const runCol = index('Run ID');
  const appIdCol = index('Steam App ID');
  if (runCol < 0 || appIdCol < 0) return [];
  const field = (row, name) => { const i = index(name); return i >= 0 ? row[i] : ''; };
  const out = new Map();
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach((row, offset) => {
    if (String(row[runCol] || '').trim() !== String(runId)) return;
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    out.set(appId, {
      appId: appId,
      name: field(row, '游戏名称') || '',
      url: field(row, 'Steam URL') || '',
      source: field(row, '候选来源') || '',
      sourceRank: field(row, '来源排名') || '',
      releaseRaw: field(row, 'Steam 发布日期') || '',
      releaseDate: field(row, 'Steam 发布日期') || '',
      releaseStage: field(row, '发布阶段') || '',
      daysToRelease: field(row, '距发售天数'),
      followers: null, baselineFollowers: null, gain7d: null, growthRate: null, coverageDays: null,
      reviews: field(row, '评论数'), positiveReviews: field(row, '好评数'), rating: field(row, 'Steam评分'),
      result1A: '', reason1A: '', firstRoundType: '', priority: '', continueNext: '', nextAction: '',
      firstRoundReason: '', currentStage: '', dataStatus: 'OK', dataNotes: [],
      observationDataStatus: '', observationDataNotes: [], controlOnly: false,
      qualificationEligible: true, eligibilityReason: '', qualificationStatus: '',
      _g010RawRowNumber: offset + 2
    });
  });
  return Array.from(out.values());
}

function g010PreviousRawIndex_(ss, runId) {
  const result = new Map();
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  if (!sheet || sheet.getLastRow() < 2) return result;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const runCol = index('Run ID');
  const appIdCol = index('Steam App ID');
  const stageCol = index('发布阶段');
  const daysCol = index('距发售天数');
  if (runCol < 0 || appIdCol < 0) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    if (String(row[runCol] || '').trim() === String(runId)) return;
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    result.set(appId, {
      releaseStage: stageCol >= 0 ? String(row[stageCol] || '').trim() : '',
      daysToRelease: daysCol >= 0 ? row[daysCol] : null
    });
  });
  return result;
}

/** Stable raw-observation identity: one Steam source observation per Run + App ID. */
function g010HistoricalRawObservationId_(runId, appId, source) {
  return ['steam', String(runId || '').trim(), String(appId || '').trim(), String(source || '').trim()]
    .join('|');
}

function g010HistoricalRawSourcePage_(rec, source) {
  if (rec && rec.sourcePage != null && rec.sourcePage !== '') {
    const direct = String(rec.sourcePage);
    if (isFinite(Number(direct))) return Number(direct);
    const matched = direct.split(' + ').find(value => String(value).indexOf(String(source || '') + '#') === 0);
    if (matched) return Number(String(matched).slice(String(source || '').length + 1));
  }
  const prefix = String(source || '') + '#';
  const sourcePages = rec && rec.sourcePages ? rec.sourcePages : [];
  for (let i = 0; i < sourcePages.length; i += 1) {
    const value = String(sourcePages[i] || '');
    if (value.indexOf(prefix) === 0) return Number(value.slice(prefix.length));
  }
  return '';
}

function g010HistoricalRawSourceRank_(rec, source) {
  if (rec && rec.sourceRank != null && rec.sourceRank !== '') {
    const direct = String(rec.sourceRank);
    if (isFinite(Number(direct))) return Number(direct);
    const matched = direct.split(' + ').find(value => String(value).indexOf(String(source || '') + '#') === 0);
    if (matched) return Number(String(matched).slice(String(source || '').length + 1));
  }
  const prefix = String(source || '') + '#';
  const ranks = rec && rec.ranks ? rec.ranks : [];
  for (let i = 0; i < ranks.length; i += 1) {
    const value = String(ranks[i] || '');
    if (value.indexOf(prefix) === 0) return Number(value.slice(prefix.length));
  }
  return '';
}

function g010EnsureHistoricalRawLedger_() {
  const config = HOTWORD_V2.historicalRawLedger;
  const props = PropertiesService.getScriptProperties();
  let id = String(props.getProperty(config.propertyKey) || config.spreadsheetId || '').trim();
  let ledger;
  if (id) {
    ledger = SpreadsheetApp.openById(id);
  } else {
    ledger = SpreadsheetApp.create(config.spreadsheetName);
    id = ledger.getId();
    props.setProperty(config.propertyKey, id);
  }
  const sheet = ensureSheetWithHeaders_(ledger, config.sheetName, config.headers);
  const actual = sheet.getRange(1, 1, 1, config.headers.length).getDisplayValues()[0];
  config.headers.forEach((header, index) => {
    if (String(actual[index] || '').trim() !== header) {
      throw new Error('Historical Raw Ledger schema mismatch at column ' + (index + 1) + ': expected ' + header);
    }
  });
  sheet.setFrozenRows(1);
  return {spreadsheet: ledger, sheet: sheet, id: id, url: ledger.getUrl()};
}

function g010HistoricalRawLedgerRow_(rec, runTime, runId, source) {
  const config = HOTWORD_V2.historicalRawLedger;
  const sourceRank = g010HistoricalRawSourceRank_(rec, source);
  const provenance = [
    'provider=Steam Store Search',
    'source=' + String(source || ''),
    'page=' + String(g010HistoricalRawSourcePage_(rec, source) || ''),
    'rank=' + String(sourceRank || ''),
    'source_url=' + String(rec && rec.url || '')
  ].join('; ');
  return [
    g010HistoricalRawObservationId_(runId, rec.appId, source), runTime,
    runId, String(runId || '').slice(0, 8), String(rec.appId || ''), rec.name || '', rec.url || '',
    source || '', g010HistoricalRawSourcePage_(rec, source), sourceRank,
    rec.releaseDate || '', rec.releaseRaw || '', rec.releaseStage || '', rec.daysToRelease,
    rec.followers, rec.baselineFollowers, rec.gain7d, rec.growthRate,
    rec.reviews, rec.positiveReviews, rec.rating, rec.dataStatus || 'RAW_CAPTURED',
    rec.rawStatus || 'RAW_ONLY', 'Steam Store Search', provenance, config.schemaVersion
  ];
}

/** Append-only batch writer. It only examines identities from the current Run. */
function g010AppendHistoricalRawLedger_(records, runTime, runId) {
  const ledger = g010EnsureHistoricalRawLedger_();
  const headers = HOTWORD_V2.historicalRawLedger.headers;
  const idColumn = headers.indexOf('Observation ID');
  const runColumn = headers.indexOf('Run ID');
  const existing = new Set();
  const sheet = ledger.sheet;
  if (sheet.getLastRow() >= 2) {
    const rowCount = sheet.getLastRow() - 1;
    const values = sheet.getRange(2, 1, rowCount, Math.max(idColumn, runColumn) + 1).getDisplayValues();
    values.forEach(row => {
      if (String(row[runColumn] || '').trim() === String(runId)) existing.add(String(row[idColumn] || '').trim());
    });
  }
  const rows = [];
  let duplicates = 0;
  (records || []).forEach(rec => {
    const source = String(rec.source || (rec.sources && rec.sources[0]) || '').trim();
    const observationId = g010HistoricalRawObservationId_(runId, rec.appId, source);
    if (!rec.appId || !source || existing.has(observationId)) {
      duplicates += 1;
      return;
    }
    existing.add(observationId);
    rows.push(g010HistoricalRawLedgerRow_(rec, runTime, runId, source));
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return {appended: rows.length, duplicates: duplicates, spreadsheetId: ledger.id, spreadsheetUrl: ledger.url};
}

function g010AppendRawPage_(ss, records, runTime, runId) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const runCol = headers.indexOf('Run ID');
  const appIdCol = headers.indexOf('Steam App ID');
  const seen = new Set();
  if (sheet.getLastRow() >= 2 && runCol >= 0 && appIdCol >= 0) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
      if (String(row[runCol] || '').trim() === String(runId)) seen.add(String(row[appIdCol] || '').trim());
    });
  }
  const unique = (records || []).filter(rec => {
    const id = String(rec.appId || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (!unique.length) return {persisted: 0, rowByAppId: {}};
  const firstRow = sheet.getLastRow() + 1;
  sheet.getRange(firstRow, 1, unique.length, HOTWORD_V2.snapshotHeaders.length)
    .setValues(unique.map(rec => snapshotRow_(rec, runTime, runId)));
  const rowByAppId = {};
  unique.forEach((rec, index) => { rowByAppId[String(rec.appId)] = firstRow + index; });
  return {persisted: unique.length, rowByAppId: rowByAppId};
}

function g010EnrichChunk_(ss, records, runId, runTime, warnings, runContext) {
  if (!records.length) return;
  const rules = runContext && runContext.rules ? runContext.rules : loadRules_(ss);
  const gpKey = getGamesPopularityApiKey_();
  const gpStats = runContext && runContext.stats ? runContext.stats : g010EmptyRunStats_();
  const cache = runContext && runContext.gpCache ? runContext.gpCache : readDailyGamesPopularityCache_(ss, runTime);
  const partition = partitionDailyGamesPopularityCache_(records, cache);
  partition.hits.forEach(rec => { rec._gpDailyCache = cache.get(String(rec.appId)); });
  gpStats.cacheHits = Number(gpStats.cacheHits || 0) + partition.hits.length;
  const context = {ss: ss, runId: runId, runTime: runTime, refreshReason: 'POLICY_MISS', attemptBuffer: []};
  const latestMap = fetchGamesPopularityLatestBatch_(partition.misses, gpKey, warnings, gpStats, context);
  records.forEach(rec => {
    if (rec._gpDailyCache) {
      Object.assign(rec, rec._gpDailyCache);
      rec.followers = rec._gpDailyCache.followers;
      rec.baselineFollowers = rec._gpDailyCache.baselineFollowers;
      rec.gain7d = rec._gpDailyCache.gain7d;
      rec.growthRate = rec._gpDailyCache.growthRate;
      rec.coverageDays = rec._gpDailyCache.coverageDays;
      rec._gpEnrichmentFresh = true;
    } else {
      const latest = latestMap.get(rec.appId);
      if (latest && latest.followers && isFiniteNumber_(latest.followers.followers)) {
        rec.followers = Number(latest.followers.followers);
        rec._gpLatestFresh = true;
      } else rec._gpEnrichmentFailed = true;
    }
  });
  const released = records.filter(rec => rec.releaseStage === '已发售' && isFiniteNumber_(Number(rec.daysToRelease)) &&
    Math.abs(Number(rec.daysToRelease)) <= Number(rules.RELEASED_DAYS_MAX) &&
    (!isFiniteNumber_(rec.reviews) || !isFiniteNumber_(rec.rating)));
  const reviews = fetchSteamReviewSummaryBatch_(released, warnings);
  released.forEach(rec => {
    const summary = reviews.get(rec.appId);
    if (!summary) return;
    rec.reviews = summary.totalReviews;
    rec.positiveReviews = summary.totalPositive;
    rec.rating = summary.totalReviews > 0 ? summary.totalPositive / summary.totalReviews : null;
  });
  const history = fetchGamesPopularityFollowersBatch_(partition.misses, gpKey, warnings, gpStats, context);
  flushGamesPopularityAttempts_(context);
  const pass1A = [];
  records.forEach(rec => {
    const result = classify1A_(rec, rules);
    rec.result1A = result.pass ? (result.controlOnly ? '✅ 通过（对照预留）' : '✅ 通过（主池）') :
      (result.dataIssue ? '⚠ 数据异常' : '❌ 排除');
    rec.reason1A = result.reason; rec.controlOnly = Boolean(result.controlOnly);
    if (result.pass) pass1A.push(rec);
  });
  const passSet = new Set(pass1A);
  records.forEach(rec => {
    if (rec._gpDailyCache && isFiniteNumber_(rec.gain7d) && isFiniteNumber_(rec.growthRate)) return;
    const growth = computeFollowerGrowth_(history.get(rec.appId), rec.followers, runTime, rules.FOLLOWER_HISTORY_MIN_DAYS);
    if (!growth.ok) {
      rec.dataStatus = '待数据'; rec.firstRoundType = '⏳ 等待历史'; rec.currentStage = '1B等待历史';
      rec._gpEnrichmentFailed = true; return;
    }
    Object.assign(rec, {baselineFollowers: growth.baselineFollowers, gain7d: growth.gain,
      growthRate: growth.growthRate, coverageDays: growth.coverageDays, _gpEnrichmentFresh: true});
  });
  records.filter(rec => passSet.has(rec) && rec._gpEnrichmentFresh).forEach(rec => {
    const raw = classify1BRaw_(rec, rules);
    applyFirstRoundDecision_(rec, raw.type === '🏢 对照候选' ? '🏢 大盘对照' : raw.type,
      raw.type === '⚪ 低优先级' ? 'P3 暂缓' : raw.type.indexOf('Watch') >= 0 ? 'P2 观察' : 'P1 高',
      raw.type === '⚪ 低优先级' ? '否（本轮）' : '是', 'Google Trends', raw.reason);
  });
  records.forEach(rec => {
    if (!rec.firstRoundType && rec.result1A === '❌ 排除') {
      rec.firstRoundType = '❌ 1A排除'; rec.priority = '不进入1B'; rec.continueNext = '否';
      rec.currentStage = '1A排除'; rec.firstRoundReason = rec.reason1A;
    }
    rec.qualificationStatus = rec._gpEnrichmentFresh ? 'COMPLETE' : 'INCOMPLETE';
    if (rec._gpEnrichmentFresh) rec.rawStatus = 'ENRICHED';
  });
  upsertMaster_(ss, records, runTime, runId, gpStats);
  const refs = {}; records.forEach(rec => { refs[rec.appId] = rec._g010RawRowNumber; });
  updateSnapshots_(ss, records.filter(rec => rec._gpEnrichmentFresh), runTime, runId, refs, true);
  if (runContext) {
    runContext.stats = gpStats;
    g010AccumulateChunkStats_(runContext.stats, records);
    partition.hits.forEach(rec => {
      if (rec._gpEnrichmentFresh && rec.appId) {
        cache.set(String(rec.appId), {
          observedAt: runTime,
          followers: rec.followers,
          baselineFollowers: rec.baselineFollowers,
          gain7d: rec.gain7d,
          growthRate: rec.growthRate,
          coverageDays: rec.coverageDays
        });
      }
    });
    runContext.gpCache = cache;
  }
}

function runSteamHotword01B(options) {
  options = options || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    const lockedState = g010ReadState_();
    if (lockedState) {
      try {
        const lockedSheet = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
        g010EnsureContinuationTrigger_(lockedState.phase);
        g010UpsertAuditRow_(lockedSheet, lockedState, 'PARTIAL', 'G010 lock busy; continuation rechecked');
      } catch (lockErr) {
        // The owner execution remains responsible for its PARTIAL audit.
      }
      return {status: 'PARTIAL', runId: lockedState.runId, phase: lockedState.phase,
        source: lockedState.source, nextPage: lockedState.nextPage,
        enrichmentCursor: lockedState.enrichmentCursor};
    }
    return {status: 'SKIPPED', reason: 'LOCKED'};
  }
  const startedAt = new Date();
  const deadline = startedAt.getTime() + G010_EXECUTION_BUDGET_MS;
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  const warnings = [];
  let discoveryPartial = false;
  let state = null;
  let runContext = null;
  let auditMetrics = function () {
    return {rawTotal: 0, eligibleTotal: 0, enrichmentProcessed: 0, enrichmentTotal: 0, candidates: 0, elapsedSec: 0, cursor: 0, phase: ''};
  };
  try {
    if (options.forceNewRun) {
      const stale = g010ReadState_();
      if (stale) g010AbandonState_(ss, stale, options.scheduledDaily ? 'scheduled-daily-new-run' : 'forced-new-run');
      g010ClearLegacySourceContinuations_();
    } else if (options.fromContinuation) {
      state = g010ReadState_();
      if (state && !g010IsContinuationValid_(state, startedAt, tz)) {
        g010AbandonState_(ss, state, 'continuation-invalid-on-resume');
        state = null;
      }
    } else {
      state = g010ClearStaleContinuation_(ss, tz, startedAt);
      if (!state) state = g010ReadState_();
      if (state && !g010IsContinuationValid_(state, startedAt, tz)) {
        g010AbandonState_(ss, state, 'stale-on-manual-run');
        state = null;
      }
    }
    if (!state) {
      state = g010NewRunState_(startedAt, tz);
      state = g010BumpSegmentCount_(state, {forceNewRun: true});
      g010WriteState_(state);
      g010SaveRunStats_(g010EmptyRunStats_());
    } else {
      state = g010BumpSegmentCount_(state, options);
      if (!state.runStartedAt) state.runStartedAt = startedAt.getTime();
      g010WriteState_(state);
    }
    ensureSteamHotwordV2ForRun_(ss, {fullSetup: false});
    if (state && !options.forceNewRun && (state.phase === 'ENRICHMENT' || Number(state.enrichmentCursor) > 0)) {
      const pendingTriggers = ScriptApp.getProjectTriggers().filter(trigger =>
        trigger.getHandlerFunction() === G010_CONTINUATION_HANDLER
      );
      if (!pendingTriggers.length) g010RearmContinuationForPhase_(state.phase);
    }
    auditMetrics = function () {
      if (!runContext && (state.phase === 'ENRICHMENT' || state.enrichmentCursor > 0 || state.controlCursor > 0 || state.phase === 'ELIGIBILITY')) {
        runContext = g010BuildRunContext_(ss, state, startedAt, tz);
      } else if (!runContext && state.phase === 'DISCOVERY' && state.nextPage > 1) {
        const rawOnly = g010RawRecordsForRun_(ss, state.runId);
        return g010RunMetrics_(state, {
          rawRecords: rawOnly, eligible: [], historyExcluded: 0, stats: g010EmptyRunStats_()
        }, startedAt, state.runStartedAt);
      }
      return g010RunMetrics_(state, runContext, startedAt, state.runStartedAt);
    };
    const checkpointStatus = state.enrichmentCursor || state.nextPage > 1 || state.phase !== 'DISCOVERY' ? 'PARTIAL' : 'RUNNING';
    g010UpsertAuditRow_(ss, state, checkpointStatus, g010FormatCheckpointDetail_(state, auditMetrics()), auditMetrics());
    while (!g010ShouldYield_(startedAt.getTime(), Date.now()) && Date.now() < deadline) {
      if (options.fromContinuation && !g010ContinuationOwnsActiveRun_(state)) {
        return {status: 'SKIPPED', runId: state.runId, reason: 'stale-continuation-not-active-run'};
      }
      if (state.phase === 'DISCOVERY') {
        const sourceIndex = HOTWORD_V2.sources.findIndex(source => source.name === state.source);
        if (sourceIndex < 0) throw new Error('Unknown G010 source: ' + state.source);
        const source = HOTWORD_V2.sources[sourceIndex];
        if (state.nextPage > G010_DISCOVERY_MAX_PAGES) {
          g010FinishDiscoverySource_(state, state.source, 'max-pages');
          g010ClearPageRetryState_(state);
          state = g010NextDiscoveryState_(state, sourceIndex, HOTWORD_V2.sources.length);
          g010WriteState_(state);
          continue;
        }
        if (Number(state.nextRetryAt || 0) > Date.now()) break;
        const url = state.nextPage === 1
          ? source.url
          : source.url + (source.url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + state.nextPage;
        let fetched;
        if (options.fromContinuation && !g010ContinuationOwnsActiveRun_(state)) {
          return {status: 'SKIPPED', runId: state.runId, reason: 'stale-continuation-before-fetch'};
        }
        let usedCacheFallback = false;
        let ledgerErrorMessage = '';
        try {
          fetched = fetchSteamSearchPageReliable_(source.name, url, state.nextPage, warnings);
        } catch (err) {
          const message = String(err && err.message || err || '');
          if (g010DiscoveryFetchErrorRetryable_(err)) {
            const cachedPage = g010LoadCachedDiscoveryPage_(source.name, state.nextPage, Date.now());
            if (cachedPage && cachedPage.items.length) {
              fetched = {body: '', cachedItems: cachedPage.items, fromCache: true};
              usedCacheFallback = true;
              discoveryPartial = true;
              warnings.push('G010 discovery cache fallback; source=' + state.source +
                ' page=' + state.nextPage + ' cacheAgeMs=' + cachedPage.cacheAgeMs);
            } else {
              const recovery = g010DiscoveryFetchRecovery_(state, startedAt, err);
              state = recovery.state;
              g010WriteState_(state);
              if (recovery.action === 'YIELD') {
                g010UpsertAuditRow_(ss, state, 'PARTIAL',
                  'G010 discovery page retry scheduled; source=' + state.source +
                  ' page=' + state.nextPage + ' attempt=' + state.pageRetryCount +
                  ' | ' + message + ' | ' + g010FormatDiscoveryAudit_(state));
                break;
              }
              discoveryPartial = true;
              g010FinishDiscoverySource_(state, state.source, 'fetch-failure-exhausted');
              g010ClearPageRetryState_(state);
              g010UpsertAuditRow_(ss, state, 'PARTIAL',
                'G010 discovery fetch recovery exhausted; source=' + state.source +
                ' page=' + state.nextPage + ' reason=' + (recovery.reason || 'exhausted') +
                ' | ' + message + ' | ' + g010FormatDiscoveryAudit_(state));
              state = g010NextDiscoveryState_(state, sourceIndex, HOTWORD_V2.sources.length);
              g010WriteState_(state);
              continue;
            }
          } else {
            discoveryPartial = true;
            g010FinishDiscoverySource_(state, state.source, 'fetch-failure');
            g010ClearPageRetryState_(state);
            g010UpsertAuditRow_(ss, state, 'PARTIAL',
              'G010 discovery non-retryable fetch failure; source=' + state.source +
              ' page=' + state.nextPage + ' | ' + message + ' | ' + g010FormatDiscoveryAudit_(state));
            state = g010NextDiscoveryState_(state, sourceIndex, HOTWORD_V2.sources.length);
            g010WriteState_(state);
            continue;
          }
        }
        const items = usedCacheFallback && fetched.cachedItems
          ? fetched.cachedItems
          : parseSteamSearchResults_(fetched.body);
        if (options.fromContinuation && !g010ContinuationOwnsActiveRun_(state)) {
          return {status: 'SKIPPED', runId: state.runId, reason: 'stale-continuation-after-fetch'};
        }
        if (!items.length) {
          g010FinishDiscoverySource_(state, state.source, state.nextPage === 1 ? 'empty-page-1' : 'empty-page');
          g010ClearPageRetryState_(state);
          state = g010NextDiscoveryState_(state, sourceIndex, HOTWORD_V2.sources.length);
          g010WriteState_(state);
          continue;
        }
        const seenAppIds = new Set(g010RawRecordsForRun_(ss, state.runId).map(rec => String(rec.appId)));
        const records = items.map((item, idx) => {
          item._sourceRank = (state.nextPage - 1) * 50 + idx + 1; item._sourcePage = state.nextPage;
          const rec = createCandidateRecord_({appId: String(item.appId), name: item.name, url: item.url,
            releaseRaw: item.releaseDate || '', sources: [source.name],
            ranks: [source.name + '#' + item._sourceRank], sourcePages: [source.name + '#' + state.nextPage],
            reviewCount: item.reviewCount, reviewRating: item.reviewRating});
          fillReleaseStage_(rec, startedAt, tz); return rec;
        });
        let newCount = 0;
        records.forEach(rec => {
          if (!seenAppIds.has(String(rec.appId))) newCount += 1;
        });
        // Canonical raw-history ownership is written before the compatible
        // business snapshot.  If this external write fails, still persist the
        // fetched page locally, advance the cursor, and make the failure
        // authoritative in the run log rather than re-fetching discovery.
        try {
          if (options.fromContinuation && !g010ContinuationOwnsActiveRun_(state)) {
            return {status: 'SKIPPED', runId: state.runId, reason: 'stale-continuation-before-raw-write'};
          }
          const ledgerResult = g010AppendHistoricalRawLedger_(records, startedAt, state.runId);
          state.ledgerAppended = Math.max(0, Number(state.ledgerAppended || 0)) + ledgerResult.appended;
          state.ledgerDuplicates = Math.max(0, Number(state.ledgerDuplicates || 0)) + ledgerResult.duplicates;
        } catch (ledgerErr) {
          state.ledgerWriteFailures = Math.max(0, Number(state.ledgerWriteFailures || 0)) + 1;
          ledgerErrorMessage = String(ledgerErr && ledgerErr.message || ledgerErr || 'unknown');
          warnings.push('RAW_LEDGER_WRITE_FAILED source=' + state.source +
            ' page=' + state.nextPage + ' error=' + ledgerErrorMessage);
        }
        if (options.fromContinuation && !g010ContinuationOwnsActiveRun_(state)) {
          return {status: 'SKIPPED', runId: state.runId, reason: 'stale-continuation-before-snapshot-write'};
        }
        g010AppendRawPage_(ss, records, startedAt, state.runId);
        if (ledgerErrorMessage) {
          const rawAfterFailure = g010RawRecordsForRun_(ss, state.runId);
          g010UpsertAuditRow_(ss, state, 'PARTIAL',
            'RAW_LEDGER_WRITE_FAILED source=' + state.source + ' page=' + state.nextPage +
            ' (business raw persisted; discovery will not be repeated) | ' + ledgerErrorMessage,
            g010RunMetrics_(state, {
              rawRecords: rawAfterFailure, eligible: [], historyExcluded: 0, stats: g010EmptyRunStats_()
            }, startedAt, state.runStartedAt));
        }
        g010RecordDiscoveryPage_(state, source.name, state.nextPage, items.length, newCount);
        if (usedCacheFallback) {
          const audit = g010InitDiscoveryAudit_(state);
          if (audit.sources[source.name]) {
            audit.sources[source.name].stopReason = 'cache-fallback-page-' + state.nextPage;
          }
        }
        g010ClearPageRetryState_(state);
        if (newCount === 0) {
          state.consecutiveNoNew = Math.max(0, Number(state.consecutiveNoNew || 0)) + 1;
        } else {
          state.consecutiveNoNew = 0;
        }
        state.nextPage += 1;
        state.updatedAt = Date.now();
        g010WriteState_(state);
        continue;
      }
      if (state.phase === 'ELIGIBILITY') {
        state.phase = 'ENRICHMENT';
        state.enrichmentCursor = 0;
        state.controlCursor = 0;
        state.updatedAt = Date.now();
        g010WriteState_(state);
        continue;
      }
      if (state.phase === 'ENRICHMENT') {
        if (!runContext) runContext = g010BuildRunContext_(ss, state, startedAt, tz);
        const eligible = runContext.eligible;
        const controls = runContext.controls;
        if (state.enrichmentCursor >= eligible.length && state.controlCursor >= controls.length) {
          if (options.fromContinuation && !g010ContinuationOwnsActiveRun_(state)) {
            return {status: 'SKIPPED', runId: state.runId, reason: 'stale-continuation-before-finalization'};
          }
          const result = g010FinalizeRun_(ss, state, runContext, startedAt, discoveryPartial);
          return Object.assign({eligible: eligible.length, rawUnique: runContext.rawRecords.length, discoveryPartial: discoveryPartial}, result);
        }
        if (state.enrichmentCursor < eligible.length) {
          const chunk = eligible.slice(state.enrichmentCursor, state.enrichmentCursor + G010_ENRICHMENT_CHUNK_SIZE);
          g010EnrichChunk_(ss, chunk, state.runId, startedAt, warnings, runContext);
          state.enrichmentCursor += chunk.length;
        } else {
          const chunk = controls.slice(state.controlCursor, state.controlCursor + G010_ENRICHMENT_CHUNK_SIZE);
          g010EnrichControlChunk_(ss, chunk, state.runId, startedAt, warnings, runContext);
          state.controlCursor += chunk.length;
          state.controlData = state.controlData || {};
          chunk.forEach(rec => { state.controlData[String(rec.appId)] = {
            followers: rec.followers, baselineFollowers: rec.baselineFollowers, gain7d: rec.gain7d,
            growthRate: rec.growthRate, coverageDays: rec.coverageDays,
            _gpEnrichmentFresh: rec._gpEnrichmentFresh, _gpEnrichmentFailed: rec._gpEnrichmentFailed
          }; });
        }
        state.updatedAt = Date.now();
        g010WriteState_(state);
        g010SaveRunStats_(runContext.stats);
        g010UpsertAuditRow_(ss, state, 'PARTIAL', g010FormatCheckpointDetail_(state, g010RunMetrics_(state, runContext, startedAt, state.runStartedAt)),
          g010RunMetrics_(state, runContext, startedAt, state.runStartedAt));
        continue;
      }
      throw new Error('Unknown G010 phase: ' + state.phase);
    }
    state = g010ContinuationState_(state);
    state.updatedAt = Date.now();
    g010WriteState_(state);
    g010RearmContinuationForState_(state);
    const yieldMetrics = auditMetrics();
    g010UpsertAuditRow_(ss, state, 'PARTIAL', g010FormatCheckpointDetail_(state, yieldMetrics), yieldMetrics);
    return {status: 'PARTIAL', runId: state.runId, phase: state.phase, source: state.source, nextPage: state.nextPage, enrichmentCursor: state.enrichmentCursor};
  } catch (err) {
    const message = String(err && err.message || err || '');
    if (state) {
      state.updatedAt = Date.now();
      g010WriteState_(state);
      const metrics = auditMetrics();
      g010UpsertAuditRow_(ss, state, 'PARTIAL',
        'G010 paused: ' + message + ' | ' + g010FormatCheckpointDetail_(state, metrics), metrics);
      if (g010IsContinuationValid_(state, startedAt, tz)) {
        g010RearmContinuationForState_(state);
        return {status: 'PARTIAL', runId: state.runId, phase: state.phase, source: state.source,
          nextPage: state.nextPage, enrichmentCursor: state.enrichmentCursor, error: message};
      }
    }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function runSteamHotword01BLegacy_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    const startedAt = new Date();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();
    const runId = Utilities.formatDate(startedAt, tz, 'yyyyMMdd-HHmmss');
    try {
      setupSteamHotwordV2();
      appendRunLog_(ss, [
        startedAt,
        runId,
        'SKIPPED',
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        'LockService：已有完整抓取 run 在执行，本轮被阻止（防止手动与定时重叠）',
        0, 0, 0, 'all-raw-observations (auto-pagination; skipped)', 0, 0, 0, 0, 0, 0, 0, 0
      ]);
    } catch (logErr) {
      // 锁冲突日志失败也不再抛出，避免叠加重试压力。
    }
    safeToast_('已有一轮 Steam 0→1B 正在运行，本轮已跳过。', '0→1B 跳过', 6);
    return;
  }

  const startedAt = new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const runId = Utilities.formatDate(startedAt, tz, 'yyyyMMdd-HHmmss');
  const warnings = [];
  const forceGpRefresh = PropertiesService.getScriptProperties()
    .getProperty(HOTWORD_V2.gpForceRefreshProperty) === '1';
  if (forceGpRefresh) PropertiesService.getScriptProperties().deleteProperty(HOTWORD_V2.gpForceRefreshProperty);

  let status = 'SUCCESS';
  let discoveredCount = 0;
  let rawUniqueAppIdCount = 0;
  let rawPersistedCount = 0;
  let candidateInputCount = 0;
  let historyExcludedCount = 0;
  let enrichedSuccessCount = 0;
  let pass1ACount = 0;
  let excluded1ACount = 0;
  let trendCount = 0;
  let earlyCount = 0;
  let controlCount = 0;
  let lowCount = 0;
  let p2TrendCount = 0;
  let p2EarlyCount = 0;
  let historyInsufficientCount = 0;
  const gpStats = {cacheHits: 0, realtimeRequests: 0, realtimeSuccess: 0, rateLimited: 0, failuresKept: 0};
  let anomalyCount = 0;
  let actionCount = 0;
  const discoveryNotes = [];

  try {
    setupSteamHotwordV2();
    const rules = loadRules_(ss);

    // ------------------------------------------------------------------------
    // 0. 先把建站关键词规划中的 Build 游戏同步进历史库，再加载去重集合
    // 必须先同步再 loadHistory，否则本轮仍排除不了刚进入建站的游戏。
    // ------------------------------------------------------------------------
    const syncResult = syncBuildGamesToHistory_(ss);
    if (syncResult && (Number(syncResult.inserted) || Number(syncResult.updated))) {
      discoveryNotes.push(
        'Build→历史库同步 新增' + syncResult.inserted + ' 更新' + syncResult.updated
      );
    }
    const historyIndex = buildHistoryIndex_(ss);

    // ------------------------------------------------------------------------
    // 0A. 发现候选
    // ------------------------------------------------------------------------
    const discovery = discoverSteamCandidates_(warnings, discoveryNotes);
    const discovered = discovery.items;
    discoveredCount = discovered.length;

    if (discovery.usedCache || discovery.partial) {
      status = 'PARTIAL';
    }

    if (discoveredCount === 0 && !discovery.partial) {
      throw new Error('两个 Steam 发现来源都没有解析到游戏，停止本轮。');
    }

    // ------------------------------------------------------------------------
    // 0B. 先建立全量 observation 集合；历史去重只派生候选 active 集合。
    // Steam_每日快照是 raw discovery observation ledger，不能因历史排除丢失观察。
    // ------------------------------------------------------------------------
    const observations = discovered.map(createCandidateRecord_);
    observations.forEach(rec => fillReleaseStage_(rec, startedAt, tz));
    // Read the prior ledger before appending this run, otherwise every item
    // would look historical and NEW_IN_SCOPE could never fire.
    const previousRaw = readLatestRawObservationIndex_(ss);
    const rawPersistence = appendSnapshots_(ss, observations, startedAt, runId);
    rawUniqueAppIdCount = rawPersistence.uniqueAppIds;
    rawPersistedCount = rawPersistence.persisted;
    discoveryNotes.push(
      'G010 raw persisted=' + rawPersistence.persisted +
      ' unique=' + rawPersistence.uniqueAppIds +
      ' bySourcePage=' + rawPersistence.bySourcePage
    );

    // Eligibility is deliberately computed from the pre-run raw ledger and
    // local candidate/decision state. It must run before any paid/external
    // enrichment request; Raw Observation remains append-only for every item.
    const qualificationState = readQualificationStateIndex_(ss);
    const eligibilityDecisions = readCandidateDecisions_(ss);
    const candidateScope = observations;
    candidateInputCount = candidateScope.length;
    const active = [];
    const skipped = [];

    for (let i = 0; i < candidateScope.length; i += 1) {
      const rec = candidateScope[i];
      if (isInHistoryIndex_(rec, historyIndex)) {
        historyExcludedCount += 1;
        continue;
      }

      const eligibility = evaluateQualificationEligibility_(rec, {
        previousRaw: previousRaw.get(String(rec.appId)),
        qualification: qualificationState.get(String(rec.appId)),
        decision: eligibilityDecisions.get(String(rec.appId)),
        now: startedAt,
        rules: rules
      });
      rec.eligibilityReason = eligibility.reason;
      rec.qualificationEligible = eligibility.eligible;
      if (eligibility.eligible) {
        rec.eligibilityReason = eligibility.reason;
        active.push(rec);
      } else {
        skipped.push(rec);
      }
    }
    discoveryNotes.push('eligibility eligible=' + active.length + ' skipped=' + skipped.length);
    const gpKey = active.length ? getGamesPopularityApiKey_() : '';

    // ------------------------------------------------------------------------
    // 0C. Followers 当前值（Games Popularity latest）
    // 同一业务日内复用 Steam_每日快照的成功 enrichment，只请求 cache miss。
    // ------------------------------------------------------------------------
    const dailyGpCache = forceGpRefresh ? new Map() : readDailyGamesPopularityCache_(ss, startedAt);
    const cachePartition = partitionDailyGamesPopularityCache_(active, dailyGpCache);
    const cacheHits = cachePartition.hits;
    const cacheMisses = cachePartition.misses;
    cacheHits.forEach(rec => { rec._gpDailyCache = dailyGpCache.get(String(rec.appId)); });
    gpStats.cacheHits = cacheHits.length;
    const gpAttemptContext = {ss: ss, runId: runId, runTime: startedAt, refreshReason: forceGpRefresh ? 'EXPLICIT_FORCE' : 'POLICY_MISS'};
    const latestMap = fetchGamesPopularityLatestBatch_(cacheMisses, gpKey, warnings, gpStats, gpAttemptContext);

    for (const rec of active) {
      if (rec._gpDailyCache) {
        rec.followers = rec._gpDailyCache.followers;
        rec.baselineFollowers = rec._gpDailyCache.baselineFollowers;
        rec.gain7d = rec._gpDailyCache.gain7d;
        rec.growthRate = rec._gpDailyCache.growthRate;
        rec.coverageDays = rec._gpDailyCache.coverageDays;
        rec._gpEnrichmentFresh = true;
        continue;
      }
      const latest = latestMap.get(rec.appId);
      if (!latest) {
        rec.dataStatus = '⚠ 数据缺失';
        addDataNote_(rec, 'Games Popularity latest 无数据');
        rec._gpEnrichmentFailed = true;
        continue;
      }

      if (latest.followers && isFiniteNumber_(latest.followers.followers)) {
        rec.followers = Number(latest.followers.followers);
        rec._gpLatestFresh = true;
      } else {
        rec.dataStatus = '⚠ 数据缺失';
        addDataNote_(rec, '缺少 Followers 当前值');
        rec._gpEnrichmentFailed = true;
      }
    }

    // ------------------------------------------------------------------------
    // 0E. 已发售窗口中的评论数/评分（Steam 官方 Reviews）
    // 只请求“有机会进入已发售池”的对象，减少请求量。
    // ------------------------------------------------------------------------
    const releasedForReviews = active.filter(rec => {
      if (rec.releaseStage !== '已发售') return false;
      if (!isFiniteNumber_(rec.daysToRelease)) return false;

      const daysSince = Math.abs(Number(rec.daysToRelease));
      if (daysSince > Number(rules.RELEASED_DAYS_MAX)) return false;

      // V2.6：搜索结果卡片已拿到评论数+评分时，不再重复请求 Reviews JSON。
      return !isFiniteNumber_(rec.reviews) || !isFiniteNumber_(rec.rating);
    });

    const reviewsMap = fetchSteamReviewSummaryBatch_(releasedForReviews, warnings);

    for (const rec of releasedForReviews) {
      const summary = reviewsMap.get(rec.appId);
      if (!summary) {
        // V2.6：不在这里提前定性。
        // 1A 会区分“评论数明确低于20”和“评论数确实拿不到”。
        addDataNote_(rec, 'Steam Reviews JSON未返回汇总；已尝试使用搜索卡片评论摘要');
        continue;
      }

      rec.reviews = summary.totalReviews;
      rec.positiveReviews = summary.totalPositive;
      rec.rating = summary.totalReviews > 0
        ? summary.totalPositive / summary.totalReviews
        : null;
    }

    // ------------------------------------------------------------------------
    // 1A. 硬条件过滤
    // ------------------------------------------------------------------------
    const pass1A = [];

    for (const rec of active) {
      const result = classify1A_(rec, rules);
      rec.result1A = result.pass
        ? (result.controlOnly ? '✅ 通过（对照预留）' : '✅ 通过（主池）')
        : (result.dataIssue ? '⚠ 数据异常' : '❌ 排除');
      rec.reason1A = result.reason;
      rec.controlOnly = Boolean(result.controlOnly);

      if (result.pass) {
        pass1A.push(rec);
        pass1ACount += 1;
      } else if (result.dataIssue) {
        anomalyCount += 1;
        rec.dataStatus = '⚠ 数据缺失';
        addDataNote_(rec, result.reason);
        appendAnomalyRecord_(ss, startedAt, runId, rec, '1A', '核心数据缺失', result.reason, '检查数据源；本轮不自动进入1B');
      } else {
        excluded1ACount += 1;
      }
    }

    // ------------------------------------------------------------------------
    // 1B 前置：对全部 active candidates 拉 Followers 历史；
    // 只有 active 中的 1A 通过对象才继续进入 1B 分类。
    // ------------------------------------------------------------------------
    const followerHistoryMap = fetchGamesPopularityFollowersBatch_(cacheMisses, gpKey, warnings, gpStats, gpAttemptContext);

    const eligibleFor1B = [];
    const pass1ASet = new Set(pass1A);

    for (const rec of active) {
      if (rec._gpDailyCache && isFiniteNumber_(rec.gain7d) && isFiniteNumber_(rec.growthRate)) {
        eligibleFor1B.push(rec);
        enrichedSuccessCount += 1;
        continue;
      }
      const payload = followerHistoryMap.get(rec.appId);
      const growth = computeFollowerGrowth_(payload, rec.followers, startedAt, rules.FOLLOWER_HISTORY_MIN_DAYS);

      // Non-1A candidates retain observation-level history semantics without
      // entering the existing 1B anomaly/counter path.
      if (!pass1ASet.has(rec)) {
        if (growth.ok) {
          rec.baselineFollowers = growth.baselineFollowers;
          rec.gain7d = growth.gain;
          rec.growthRate = growth.growthRate;
          rec.coverageDays = growth.coverageDays;
        } else {
          rec.observationDataStatus = '⚠ 增速数据不足';
          rec.observationDataNotes.push(growth.reason);
        }
        continue;
      }

      if (!growth.ok) {
        if (!rec._gpDailyCache) rec._gpEnrichmentFailed = true;
        rec.dataStatus = '待数据';
        addDataNote_(rec, growth.reason);
        rec.firstRoundType = '⏳ 等待历史';
        rec.priority = '待数据';
        rec.continueNext = '否（本轮）';
        rec.nextAction = '等待 Followers 历史达到最少天数后自动重算';
        rec.currentStage = '1B等待历史';

        historyInsufficientCount += 1;
        appendAnomalyRecord_(ss, startedAt, runId, rec, '1B', 'Followers历史不足', growth.reason, rec.nextAction);
        continue;
      }

      rec.baselineFollowers = growth.baselineFollowers;
      rec.gain7d = growth.gain;
      rec.growthRate = growth.growthRate;
      rec.coverageDays = growth.coverageDays;
      rec._gpEnrichmentFresh = true;
      rec.dataStatus = rec.dataStatus === '⚠ 数据缺失' ? rec.dataStatus : 'OK';
      eligibleFor1B.push(rec);
      enrichedSuccessCount += 1;
    }

    // ------------------------------------------------------------------------
    // 1B. 先分 P1 Trend / P1 Early / Control / P2 Watch / P3。
    // 对照候选要“只保留少量”，所以最后统一取 top N。
    // ------------------------------------------------------------------------
    const controlCandidates = [];

    for (const rec of eligibleFor1B) {
      const raw = classify1BRaw_(rec, rules);

      if (raw.type === '🔥 趋势候选') {
        applyFirstRoundDecision_(rec, raw.type, 'P1 高', '是', 'Google Trends', raw.reason);
        trendCount += 1;
      } else if (raw.type === '🌱 Early候选') {
        applyFirstRoundDecision_(rec, raw.type, 'P1 高', '是', 'Google Trends；若Google弱则手动做Social Early', raw.reason);
        earlyCount += 1;
      } else if (raw.type === '🏢 对照候选') {
        rec._controlReason = raw.reason;
        controlCandidates.push(rec);
      } else if (raw.type === '🟡 Trend Watch') {
        applyFirstRoundDecision_(rec, raw.type, 'P2 观察', '是', 'Google Trends', raw.reason);
        p2TrendCount += 1;
      } else if (raw.type === '🟢 Early Watch') {
        applyFirstRoundDecision_(rec, raw.type, 'P2 观察', '是', 'Google Trends；若Google弱则手动做Social Early', raw.reason);
        p2EarlyCount += 1;
      } else {
        applyFirstRoundDecision_(rec, '⚪ 低优先级', 'P3 暂缓', '否（本轮）', '本轮暂缓', raw.reason);
        lowCount += 1;
      }
    }

    // 只保留 Gain 最高的 N 个大盘对照。
    controlCandidates.sort((a, b) => Number(b.gain7d || 0) - Number(a.gain7d || 0));
    const maxControls = Math.max(0, Math.floor(Number(rules.CONTROL_MAX_PER_RUN)));

    controlCandidates.forEach((rec, idx) => {
      if (idx < maxControls) {
        applyFirstRoundDecision_(rec, '🏢 大盘对照', 'P2 对照', '是', 'Google Trends（对照）', rec._controlReason);
        controlCount += 1;
      } else {
        applyFirstRoundDecision_(
          rec,
          '⚪ 低优先级',
          'P3 暂缓',
          '否（本轮）',
          '本轮暂缓',
          rec._controlReason + '；但本轮对照样本已达上限，只保留Gain更高者'
        );
        lowCount += 1;
      }
      delete rec._controlReason;
    });

    // 1A 排除对象也写明当前阶段。
    for (const rec of active) {
      if (rec.result1A === '❌ 排除') {
        rec.firstRoundType = '❌ 1A排除';
        rec.priority = '不进入1B';
        rec.continueNext = '否';
        rec.nextAction = '等待发售窗口/规模条件变化后由每日任务自动重评';
        rec.firstRoundReason = rec.reason1A;
        rec.currentStage = '1A排除';
      } else if (rec.result1A === '⚠ 数据异常' && !rec.firstRoundType) {
        rec.firstRoundType = '⚠ 数据异常';
        rec.priority = '待补数据';
        rec.continueNext = '否（本轮）';
        rec.nextAction = '修复数据后自动重评';
        rec.firstRoundReason = rec.reason1A;
        rec.currentStage = '1A待数据';
      }
    }

    // Enrich the already-persisted rows for this run. Deep observations stay
    // RAW_ONLY; the row identity prevents appending a second snapshot row.
    active.forEach(rec => { if (rec._gpEnrichmentFresh) rec.rawStatus = 'ENRICHED'; });
    active.forEach(rec => {
      rec.qualificationStatus = rec._gpEnrichmentFresh ? 'COMPLETE' : 'INCOMPLETE';
    });
    skipped.forEach(rec => { rec.qualificationStatus = 'SKIPPED'; });
    const snapshotUpdate = updateSnapshots_(ss, active.filter(rec => rec._gpEnrichmentFresh), startedAt, runId, rawPersistence.rowByAppId);
    discoveryNotes.push('G010 snapshot enriched=' + snapshotUpdate.updated + ' same-run rows');

    // ------------------------------------------------------------------------
    // 输出
    // ------------------------------------------------------------------------
    upsertMaster_(ss, active.concat(skipped), startedAt, runId, gpStats);
    const candidateSnapshot = writeDailyCandidateSnapshot_(
      ss,
      active,
      startedAt,
      runId
    );
    discoveryNotes.push('今日候选快照新增=' + candidateSnapshot.persisted + '，跳过重复=' + candidateSnapshot.skipped);
    const decisions = syncCandidateDecisions_(ss, active, startedAt, rules);
    try {
      const queueResult = enqueueSteamCandidateResearchJobs_(ss, startedAt);
      if (queueResult && Number(queueResult.created)) {
        discoveryNotes.push('M7A Candidate Research enqueue ' + queueResult.created);
      }
    } catch (queueErr) {
      warnings.push('M7A Candidate Research enqueue failed: ' + String(queueErr && queueErr.message || queueErr));
    }
    const actionRefresh = refreshTodayActionsFromCandidateDecisions_(ss, startedAt, runId, {
      discoveredCount,
      historyExcludedCount,
      pass1ACount,
      trendCount,
      earlyCount,
      controlCount,
      p2TrendCount,
      p2EarlyCount,
      historyInsufficientCount,
      anomalyCount
    });
    actionCount = actionRefresh && actionRefresh.afterPendingCount || 0;

    // 使用了 source cache，或有 warnings，但主链路能完成 → PARTIAL（不可伪装 SUCCESS）。
    if (discovery.usedCache || discovery.partial || warnings.length > 0) status = 'PARTIAL';

    const logMessage = discoveryNotes.concat(warnings).join(' | ');

    appendRunLog_(ss, [
      startedAt,
      runId,
      status,
      discoveredCount,
      historyExcludedCount,
      enrichedSuccessCount,
      pass1ACount,
      excluded1ACount,
      trendCount,
      earlyCount,
      controlCount,
      lowCount,
      anomalyCount,
      actionCount,
      Math.round((new Date().getTime() - startedAt.getTime()) / 1000),
      logMessage,
      rawUniqueAppIdCount,
      rawPersistedCount,
      candidateInputCount,
      'all-raw-observations (auto-pagination)',
      p2TrendCount,
      p2EarlyCount,
      historyInsufficientCount,
      gpStats.cacheHits,
      gpStats.realtimeRequests,
      gpStats.realtimeSuccess,
      gpStats.rateLimited,
      gpStats.failuresKept
    ]);

    SpreadsheetApp.flush();

    safeToast_(
      '完成：发现' + discoveredCount + '；1A通过' + pass1ACount +
      '；🔥' + trendCount + ' / 🌱' + earlyCount + ' / 🏢' + controlCount +
      '；今日手动处理' + actionCount + '个' +
      (discovery.usedCache ? '（含缓存 source）' : ''),
      status === 'SUCCESS' ? '0→1B 完成' : '0→1B 部分完成',
      10
    );

  } catch (err) {
    status = 'FAILED';

    try {
      const failMsg = discoveryNotes.concat([
        String(err && err.message ? err.message : err)
      ]).join(' | ');
      appendRunLog_(ss, [
        startedAt,
        runId,
        status,
        discoveredCount,
        historyExcludedCount,
        enrichedSuccessCount,
        pass1ACount,
        excluded1ACount,
        trendCount,
        earlyCount,
        controlCount,
        lowCount,
        anomalyCount,
        actionCount,
        Math.round((new Date().getTime() - startedAt.getTime()) / 1000),
        failMsg,
        rawUniqueAppIdCount,
        rawPersistedCount,
        candidateInputCount,
        'all-raw-observations (auto-pagination; run failed)',
        p2TrendCount,
        p2EarlyCount,
        historyInsufficientCount,
        gpStats.cacheHits,
        gpStats.realtimeRequests,
        gpStats.realtimeSuccess,
        gpStats.rateLimited,
        gpStats.failuresKept
      ]);
    } catch (logErr) {
      // 不让日志错误覆盖真实错误。
    }

    throw err;
  } finally {
    lock.releaseLock();
  }
}


// ============================================================================
// 0：Steam 候选发现（含节流 / 有限重试 / 24h 成功缓存）
// ============================================================================

function discoverSteamCandidates_(warnings, fetchLogs) {
  const merged = new Map();
  let usedCache = false;
  const degradeNotes = Array.isArray(warnings) ? warnings : [];
  const logs = Array.isArray(fetchLogs) ? fetchLogs : degradeNotes;

  for (const source of HOTWORD_V2.sources) {
    const sourceResult = fetchSteamSourceWithFallback_(source, degradeNotes, logs);
    if (sourceResult.fromCache) usedCache = true;
    logs.push(
      'source=' + source.name +
      ' | pagesFetched=' + sourceResult.pagesFetched +
      ' | stopReason=' + sourceResult.stopReason +
      ' | continuation=' + (sourceResult.continuation ? 'saved' : 'none') +
      ' | rawItems=' + sourceResult.items.length
    );

    sourceResult.items.forEach((item, idx) => {
      const key = String(item.appId);
      // 缓存回放时保留首次发现时的 sourceRank；实时抓取按页序重算。
      const sourceRank = item._sourceRank || idx + 1;

      if (!merged.has(key)) {
        merged.set(key, {
          appId: key,
          name: item.name,
          url: item.url,
          releaseRaw: item.releaseDate || item.releaseRaw || '',
          reviewCount: isFiniteNumber_(item.reviewCount) ? Number(item.reviewCount) : null,
          reviewRating: isFiniteNumber_(item.reviewRating) ? Number(item.reviewRating) : null,
          sources: [source.name],
          ranks: [source.name + '#' + sourceRank],
          sourcePages: [source.name + '#' + (item._sourcePage || Math.ceil(sourceRank / 50))]
        });
      } else {
        const existing = merged.get(key);
        if (!existing.sources.includes(source.name)) existing.sources.push(source.name);
        existing.ranks.push(source.name + '#' + sourceRank);
        existing.sourcePages.push(source.name + '#' + (item._sourcePage || Math.ceil(sourceRank / 50)));
        if (!existing.releaseRaw && (item.releaseDate || item.releaseRaw)) {
          existing.releaseRaw = item.releaseDate || item.releaseRaw;
        }
        if (!isFiniteNumber_(existing.reviewCount) && isFiniteNumber_(item.reviewCount)) {
          existing.reviewCount = Number(item.reviewCount);
        }
        if (!isFiniteNumber_(existing.reviewRating) && isFiniteNumber_(item.reviewRating)) {
          existing.reviewRating = Number(item.reviewRating);
        }
      }
    });
  }

  return {
    items: Array.from(merged.values()),
    usedCache: usedCache,
    partial: HOTWORD_V2.sources.some(source => {
      const key = steamSourceContinuationPropertyKey_(source.name);
      return !!PropertiesService.getScriptProperties().getProperty(key);
    })
  };
}

/**
 * 抓取单个 Steam source；403/429 最终失败时尝试 <24h 缓存。
 */
function fetchSteamSourceWithFallback_(source, warnings, fetchLogs) {
  let lastHttpStatus = null;
  let lastErrorMessage = '';
  const logs = Array.isArray(fetchLogs) ? fetchLogs : warnings;

  try {
    const liveResult = fetchSteamSourcePagesLive_(source, logs);
    const liveItems = liveResult.items;
    // A partial retrieval must never replace the last-known-good complete
    // source cache. Continuation is persisted under a separate key.
    const cacheSaved = liveResult.continuation ? false : saveSteamSourceCache_(source.name, liveItems);
    logs.push(
      'source=' + source.name +
      ' | result=' + (liveResult.continuation ? 'LIVE_PARTIAL' : 'LIVE_OK') +
      ' | pagesFetched=' + liveResult.pagesFetched +
      ' | stopReason=' + liveResult.stopReason +
      ' | items=' + liveItems.length +
      ' | cache=false' +
      ' | cacheSaved=' + cacheSaved
    );
    return { items: liveItems, fromCache: false, pagesFetched: liveResult.pagesFetched, stopReason: liveResult.stopReason, continuation: liveResult.continuation };
  } catch (err) {
    lastHttpStatus = err && err.httpStatus ? err.httpStatus : null;
    lastErrorMessage = String(err && err.message ? err.message : err);
    const retryable = isSteamRetryableHttpStatus_(lastHttpStatus) ||
      /HTTP\s+(403|429|5\d\d)/i.test(lastErrorMessage);

    if (!retryable) throw err;

    const cached = loadSteamSourceCache_(source.name);
    const nowMs = Date.now();
    if (!cached || !cached.items || !cached.items.length) {
      throw new Error(
        source.name + ' 抓取失败且无可用缓存；HTTP ' +
        (lastHttpStatus || '?') + '；' + lastErrorMessage
      );
    }

    const ageMs = nowMs - Number(cached.savedAtMs || 0);
    const ageHours = (ageMs / 3600000).toFixed(2);

    if (!isSteamSourceCacheFresh_(cached, nowMs, HOTWORD_V2.steamHttp.cacheMaxAgeMs)) {
      throw new Error(
        source.name + ' 抓取失败且缓存过期（cache age ' + ageHours +
        'h > 24h）；原始 HTTP ' + (lastHttpStatus || '?') + '；' + lastErrorMessage
      );
    }

    // 缓存回退是真实降级：写入 warnings，强制 PARTIAL。
    const cacheNote =
      'source=' + source.name +
      ' | result=CACHE_FALLBACK' +
      ' | cache=true' +
      ' | cacheAgeHours=' + ageHours +
      ' | cacheSavedAt=' + (cached.savedAtIso || '') +
      ' | originalHttpStatus=' + (lastHttpStatus || '?') +
      ' | items=' + cached.items.length +
      ' | detail=' + lastErrorMessage;
    warnings.push(cacheNote);
    logs.push(cacheNote);

    return { items: cached.items, fromCache: true, pagesFetched: 0, stopReason: 'cache-fallback-after-' + (lastHttpStatus || 'error'), continuation: false };
  }
}

function fetchSteamSourcePagesLive_(source, fetchLogs) {
  const allItems = [];
  const logs = Array.isArray(fetchLogs) ? fetchLogs : [];
  const props = PropertiesService.getScriptProperties();
  const continuationKey = steamSourceContinuationPropertyKey_(source.name);
  const metaKey = continuationKey + '_META';
  const metaRaw = props.getProperty(metaKey);
  let page = 1;
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      const todayKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
      if (meta && meta.runDate === todayKey && Number(meta.page) > 0 && Number(meta.page) <= G010_DISCOVERY_MAX_PAGES) {
        page = Math.floor(Number(meta.page));
      } else {
        props.deleteProperty(continuationKey);
        props.deleteProperty(metaKey);
      }
    } catch (metaErr) {
      props.deleteProperty(continuationKey);
      props.deleteProperty(metaKey);
    }
  } else {
    const saved = Number(props.getProperty(continuationKey) || 1);
    page = Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 1;
    if (page > G010_DISCOVERY_MAX_PAGES) page = 1;
  }
  const seenPageSignatures = new Set();
  const seenAppIds = new Set();
  const startedAtMs = Date.now();
  let stopReason = 'source-exhausted';
  let continuation = false;
  let pagesFetched = 0;
  let consecutiveNoNewPages = 0;

  while (true) {
    if (page > G010_DISCOVERY_MAX_PAGES) {
      stopReason = 'max-pages';
      props.deleteProperty(continuationKey);
      props.deleteProperty(metaKey);
      break;
    }
    if (Date.now() - startedAtMs >= STEAM_DISCOVERY_RUNTIME_BUDGET_MS) {
      stopReason = 'runtime-budget';
      continuation = true;
      props.setProperty(continuationKey, String(page));
      props.setProperty(metaKey, JSON.stringify({
        runDate: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'),
        page: page,
        savedAtMs: Date.now()
      }));
      break;
    }
    // The base URL is used for page 1; later pages use the explicit cursor.
    const url = page === 1
      ? source.url
      : source.url + (source.url.includes('?') ? '&' : '?') + 'page=' + page;

    let fetched;
    try {
      fetched = fetchSteamSearchPageReliable_(source.name, url, page, fetchLogs);
    } catch (err) {
      const retryable = isSteamRetryableHttpStatus_(err && err.httpStatus) ||
        /HTTP\s+(403|429|5\d\d)/i.test(String(err && err.message || err));
      if (!retryable) throw err;
      stopReason = 'temporary-fetch-failure:' + (err && err.httpStatus ? err.httpStatus : 'error');
      props.deleteProperty(continuationKey);
      props.deleteProperty(metaKey);
      break;
    }
    const items = parseSteamSearchResults_(fetched.body);
    pagesFetched += 1;
    if (items.length === 0) {
      stopReason = page === 1 ? 'empty-page-1' : 'empty-page';
      if (page === 1) throw new Error(source.name + ' 第1页解析结果为0');
      props.deleteProperty(continuationKey);
      props.deleteProperty(metaKey);
      break;
    }

    const signature = items.map(item => String(item.appId)).join(',');
    const duplicatePage = seenPageSignatures.has(signature);
    seenPageSignatures.add(signature);

    let newCount = 0;
    items.forEach((item, idx) => {
      item._sourceRank = (page - 1) * 50 + idx + 1;
      item._sourcePage = page;
      if (!seenAppIds.has(String(item.appId))) {
        seenAppIds.add(String(item.appId));
        newCount += 1;
      }
      allItems.push(item);
    });
    if (newCount === 0) {
      consecutiveNoNewPages += 1;
      if (consecutiveNoNewPages >= 2) {
        stopReason = duplicatePage ? 'duplicate-page-2-pages' : 'no-new-appids-2-pages';
        props.deleteProperty(continuationKey);
        props.deleteProperty(metaKey);
        break;
      }
    } else {
      consecutiveNoNewPages = 0;
    }
    page += 1;
  }

  logs.push('source=' + source.name + ' | pagesFetched=' + pagesFetched + ' | stopReason=' + stopReason);
  return {items: allItems, pagesFetched: pagesFetched, stopReason: stopReason, continuation: continuation};
}

function steamSourceContinuationPropertyKey_(sourceName) {
  return 'STEAM_SOURCE_CONTINUATION_V1_' + String(sourceName || '')
    .replace(/\s+/g, '_').toUpperCase();
}

/**
 * 带节流 + 有限重试的 Steam 搜索页请求。
 * 禁止对 403/429 短时间高频死循环。
 */
function fetchSteamSearchPageReliable_(sourceName, url, page, fetchLogs) {
  const cfg = HOTWORD_V2.steamHttp;
  const logs = Array.isArray(fetchLogs) ? fetchLogs : [];
  throttleSteamHttp_(cfg.throttleMs);

  let attempt = 0;

  while (true) {
    attempt += 1;
    let response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        followRedirects: true,
        muteHttpExceptions: true,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': cfg.userAgent
        }
      });
    } catch (netErr) {
      const decision = decideSteamHttpRetry_({
        statusCode: 0,
        attempt: attempt,
        maxAttempts429: cfg.maxAttempts429,
        maxAttempts403: cfg.maxAttempts403,
        maxAttempts5xx: cfg.maxAttempts5xx,
        retryAfterHeader: '',
        backoffBaseMs: cfg.backoffBaseMs,
        backoffMaxMs: cfg.backoffMaxMs,
        jitterMs: cfg.jitterMs,
        recovery403Ms: cfg.recovery403Ms,
        networkError: true
      });

      logs.push(
        'source=' + sourceName +
        ' | url=' + url +
        ' | page=' + page +
        ' | HTTP=NETWORK' +
        ' | attempt=' + attempt +
        ' | backoff=' + (decision.action === 'retry') +
        ' | sleepMs=' + (decision.sleepMs || 0) +
        ' | cache=false' +
        ' | reason=' + decision.reason
      );

      if (decision.action !== 'retry') {
        const err = new Error(
          sourceName + ' 网络错误（page=' + page + ', attempt=' + attempt + '）：' +
          String(netErr && netErr.message ? netErr.message : netErr)
        );
        err.httpStatus = 0;
        throw err;
      }

      Utilities.sleep(decision.sleepMs);
      continue;
    }

    const code = response.getResponseCode();
    const headers = response.getAllHeaders ? response.getAllHeaders() : {};
    const retryAfter = extractRetryAfterHeader_(headers);

    if (code >= 200 && code < 300) {
      logs.push(
        'source=' + sourceName +
        ' | url=' + url +
        ' | page=' + page +
        ' | HTTP=' + code +
        ' | attempt=' + attempt +
        ' | backoff=false' +
        ' | cache=false'
      );
      return { body: response.getContentText('UTF-8'), status: code, attempt: attempt };
    }

    const decision = decideSteamHttpRetry_({
      statusCode: code,
      attempt: attempt,
      maxAttempts429: cfg.maxAttempts429,
      maxAttempts403: cfg.maxAttempts403,
      maxAttempts5xx: cfg.maxAttempts5xx,
      retryAfterHeader: retryAfter,
      backoffBaseMs: cfg.backoffBaseMs,
      backoffMaxMs: cfg.backoffMaxMs,
      jitterMs: cfg.jitterMs,
      recovery403Ms: cfg.recovery403Ms,
      networkError: false
    });

    logs.push(
      'source=' + sourceName +
      ' | url=' + url +
      ' | page=' + page +
      ' | HTTP=' + code +
      ' | attempt=' + attempt +
      ' | backoff=' + (decision.action === 'retry') +
      ' | sleepMs=' + (decision.sleepMs || 0) +
      ' | retryAfter=' + (retryAfter || '') +
      ' | cache=false' +
      ' | reason=' + decision.reason
    );

    if (decision.action !== 'retry') {
      const err = new Error(sourceName + ' HTTP ' + code + ' (page=' + page + ', attempt=' + attempt + ')');
      err.httpStatus = code;
      throw err;
    }

    Utilities.sleep(decision.sleepMs);
  }
}

/** 纯函数：决定是否重试及等待多久（供 mock 测试）。 */
function decideSteamHttpRetry_(input) {
  const status = Number(input.statusCode);
  const attempt = Math.max(1, Number(input.attempt || 1));
  const networkError = !!input.networkError;

  if (!networkError && status >= 200 && status < 300) {
    return { action: 'ok', sleepMs: 0, reason: 'success' };
  }

  // 确定性客户端错误：不反复重试（404 等）；403 单独处理。
  if (!networkError && status === 404) {
    return { action: 'fail', sleepMs: 0, reason: 'deterministic_404' };
  }
  if (!networkError && status >= 400 && status < 500 && status !== 403 && status !== 429) {
    return { action: 'fail', sleepMs: 0, reason: 'deterministic_4xx_' + status };
  }

  if (!networkError && status === 403) {
    if (attempt >= Number(input.maxAttempts403 || 2)) {
      return { action: 'fail', sleepMs: 0, reason: '403_exhausted' };
    }
    return {
      action: 'retry',
      sleepMs: Math.max(1000, Number(input.recovery403Ms || 8000)),
      reason: '403_single_recovery'
    };
  }

  if (!networkError && status === 429) {
    if (attempt >= Number(input.maxAttempts429 || 4)) {
      return { action: 'fail', sleepMs: 0, reason: '429_exhausted' };
    }
    const fromHeader = parseRetryAfterMs_(input.retryAfterHeader);
    if (fromHeader != null) {
      return {
        action: 'retry',
        sleepMs: Math.min(Number(input.backoffMaxMs || 60000), fromHeader),
        reason: '429_retry_after'
      };
    }
    return {
      action: 'retry',
      sleepMs: computeExponentialBackoffMs_(
        attempt,
        input.backoffBaseMs,
        input.backoffMaxMs,
        input.jitterMs,
        input.randomFn
      ),
      reason: '429_exponential_backoff'
    };
  }

  // 5xx 或网络临时错误
  if (networkError || status >= 500) {
    const maxA = Number(input.maxAttempts5xx || 3);
    if (attempt >= maxA) {
      return { action: 'fail', sleepMs: 0, reason: networkError ? 'network_exhausted' : '5xx_exhausted' };
    }
    return {
      action: 'retry',
      sleepMs: computeExponentialBackoffMs_(
        attempt,
        input.backoffBaseMs,
        input.backoffMaxMs,
        input.jitterMs,
        input.randomFn
      ),
      reason: networkError ? 'network_backoff' : '5xx_backoff'
    };
  }

  return { action: 'fail', sleepMs: 0, reason: 'unhandled_status_' + status };
}

function computeExponentialBackoffMs_(attempt, baseMs, maxMs, jitterMs, randomFn) {
  const base = Math.max(200, Number(baseMs || 2000));
  const max = Math.max(base, Number(maxMs || 60000));
  const jitterMax = Math.max(0, Number(jitterMs || 0));
  const exp = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
  const rand = typeof randomFn === 'function' ? randomFn() : Math.random();
  const jitter = jitterMax > 0 ? Math.floor(rand * (jitterMax + 1)) : 0;
  return Math.min(max, exp + jitter);
}

function parseRetryAfterMs_(retryAfterHeader) {
  if (retryAfterHeader == null || retryAfterHeader === '') return null;
  const raw = String(retryAfterHeader).trim();
  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }
  const when = Date.parse(raw);
  if (!isNaN(when)) {
    return Math.max(0, when - Date.now());
  }
  return null;
}

function extractRetryAfterHeader_(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get('Retry-After') || headers.get('retry-after') || '';
  }
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() === 'retry-after') {
      const v = headers[keys[i]];
      return Array.isArray(v) ? String(v[0] || '') : String(v || '');
    }
  }
  return '';
}

function isSteamRetryableHttpStatus_(status) {
  const code = Number(status);
  return code === 403 || code === 429 || code >= 500 || code === 0;
}

function isSteamSourceCacheFresh_(cached, nowMs, maxAgeMs) {
  if (!cached || !cached.savedAtMs) return false;
  const age = Number(nowMs) - Number(cached.savedAtMs);
  return age >= 0 && age <= Number(maxAgeMs || 0);
}

var _steamLastFetchAtMs_ = 0;

function throttleSteamHttp_(throttleMs) {
  const minGap = Math.max(0, Number(throttleMs || 0));
  if (!minGap) return;
  const now = Date.now();
  const elapsed = now - Number(_steamLastFetchAtMs_ || 0);
  if (_steamLastFetchAtMs_ && elapsed < minGap) {
    Utilities.sleep(minGap - elapsed);
  }
  _steamLastFetchAtMs_ = Date.now();
}

function steamSourceCachePropertyKey_(sourceName, suffix) {
  const base = HOTWORD_V2.steamHttp.cacheKeyPrefix + String(sourceName || '')
    .replace(/\s+/g, '_')
    .toUpperCase();
  return suffix ? (base + '_' + suffix) : base;
}

/** 将紧凑条目拆成不超过 maxChars 的 JSON 分片（纯函数，供测试）。 */
function splitSteamCacheChunks_(compactRows, maxChars) {
  const limit = Math.max(1000, Number(maxChars || 7500));
  const chunks = [];
  let current = [];

  for (let i = 0; i < compactRows.length; i++) {
    current.push(compactRows[i]);
    const probe = JSON.stringify(current);
    if (probe.length > limit) {
      current.pop();
      if (!current.length) {
        // 单条仍超限：硬切该条，避免整缓存失败。
        chunks.push([compactRows[i]]);
        current = [];
      } else {
        chunks.push(current);
        current = [compactRows[i]];
      }
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function compactSteamCacheItems_(items) {
  return (items || []).map(item => ({
    a: String(item.appId),
    n: item.name,
    r: item.releaseDate || item.releaseRaw || '',
    c: isFiniteNumber_(item.reviewCount) ? Number(item.reviewCount) : null,
    p: isFiniteNumber_(item.reviewRating) ? Number(item.reviewRating) : null,
    k: item._sourceRank || null,
    q: item._sourcePage || null
  }));
}

function expandSteamCacheRows_(rows) {
  return (rows || []).map(row => {
    const appId = String(row.a || row.appId || '');
    return {
      appId: appId,
      name: row.n || row.name || '',
      url: row.u || ('https://store.steampowered.com/app/' + appId + '/'),
      releaseDate: row.r || row.releaseDate || '',
      reviewCount: row.c != null ? row.c : row.reviewCount,
      reviewRating: row.p != null ? row.p : row.reviewRating,
      _sourceRank: row.k || row._sourceRank || null,
      _sourcePage: row.q || row._sourcePage || null
    };
  }).filter(item => item.appId && item.name);
}

function saveSteamSourceCache_(sourceName, items) {
  const compact = compactSteamCacheItems_(items);
  const savedAtMs = Date.now();
  const savedAtIso = new Date().toISOString();
  const maxChars = HOTWORD_V2.steamHttp.cacheChunkMaxChars;
  const chunks = splitSteamCacheChunks_(compact, maxChars);
  const props = PropertiesService.getScriptProperties();
  const metaKey = steamSourceCachePropertyKey_(sourceName, 'META');

  try {
    // 先清旧分片（含 V2.6.1 单 key），避免读到半新半旧。
    clearSteamSourceCacheKeys_(sourceName, props);

    const meta = {
      t: savedAtMs,
      i: savedAtIso,
      s: sourceName,
      n: chunks.length,
      c: compact.length
    };
    props.setProperty(metaKey, JSON.stringify(meta));

    for (let i = 0; i < chunks.length; i++) {
      props.setProperty(
        steamSourceCachePropertyKey_(sourceName, 'P' + i),
        JSON.stringify(chunks[i])
      );
    }
    return true;
  } catch (e) {
    try {
      clearSteamSourceCacheKeys_(sourceName, props);
    } catch (clearErr) {
      // ignore
    }
    return false;
  }
}

function clearSteamSourceCacheKeys_(sourceName, propsService) {
  const props = propsService || PropertiesService.getScriptProperties();
  const keys = [
    steamSourceCachePropertyKey_(sourceName),
    steamSourceCachePropertyKey_(sourceName, 'META')
  ];
  for (let i = 0; i < 20; i++) {
    keys.push(steamSourceCachePropertyKey_(sourceName, 'P' + i));
  }
  // 兼容 V2.6.1 单片 key 前缀
  keys.push(
    'STEAM_SOURCE_CACHE_V261_' + String(sourceName || '').replace(/\s+/g, '_').toUpperCase()
  );
  for (let k = 0; k < keys.length; k++) {
    try {
      props.deleteProperty(keys[k]);
    } catch (e) {
      // ignore missing keys
    }
  }
}

function loadSteamSourceCache_(sourceName) {
  try {
    const props = PropertiesService.getScriptProperties();
    const metaRaw = props.getProperty(steamSourceCachePropertyKey_(sourceName, 'META'));

    // V2.6.2 分片格式
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      const partCount = Math.max(0, Number(meta.n || 0));
      const rows = [];
      for (let i = 0; i < partCount; i++) {
        const partRaw = props.getProperty(steamSourceCachePropertyKey_(sourceName, 'P' + i));
        if (!partRaw) return null;
        const part = JSON.parse(partRaw);
        if (!Array.isArray(part)) return null;
        Array.prototype.push.apply(rows, part);
      }
      return {
        savedAtMs: Number(meta.t || 0),
        savedAtIso: meta.i || '',
        source: meta.s || sourceName,
        items: expandSteamCacheRows_(rows)
      };
    }

    // 兼容 V2.6.1 单片（若仍存在）
    const legacyRaw = props.getProperty(
      'STEAM_SOURCE_CACHE_V261_' + String(sourceName || '').replace(/\s+/g, '_').toUpperCase()
    ) || props.getProperty(steamSourceCachePropertyKey_(sourceName));
    if (!legacyRaw) return null;

    const parsed = JSON.parse(legacyRaw);
    const rows = parsed && (parsed.g || parsed.items);
    if (!parsed || !Array.isArray(rows)) return null;

    return {
      savedAtMs: Number(parsed.t || parsed.savedAtMs || 0),
      savedAtIso: parsed.i || parsed.savedAtIso || '',
      source: parsed.s || parsed.source || sourceName,
      items: expandSteamCacheRows_(rows)
    };
  } catch (e) {
    return null;
  }
}

function parseSteamSearchResults_(html) {
  const results = [];
  const rowRegex = /<a\b[^>]*class=["'][^"']*\bsearch_result_row\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  const rows = html.match(rowRegex) || [];

  for (const row of rows) {
    const hrefMatch = row.match(/\bhref=["']([^"']*store\.steampowered\.com\/app\/\d+\/?[^"']*)["']/i);
    const appIdAttr = row.match(/\bdata-ds-appid=["'](\d+)["']/i);
    const appIdUrl = hrefMatch && hrefMatch[1].match(/\/app\/(\d+)(?:\/|$)/i);
    const appId = appIdAttr ? appIdAttr[1] : (appIdUrl ? appIdUrl[1] : '');
    if (!hrefMatch || !appId) continue;

    const titleMatch = row.match(/<span\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!titleMatch) continue;

    const name = decodeHtml_(stripTags_(titleMatch[1])).trim();
    const releaseDate = extractSteamSearchReleaseText_(row);
    const cleanUrl = hrefMatch[1].replace(/&amp;/g, '&').split('?')[0];

    // V2.6：
    // Steam 搜索结果卡片本身通常就带评论摘要，例如：
    // "95% of the 123 user reviews for this game are positive."
    // 直接在发现阶段提取，避免对每个已发售游戏额外依赖 appreviews JSON。
    let reviewCount = null;
    let reviewRating = null;

    const reviewSpanMatch = row.match(
      /<span\b[^>]*class=["'][^"']*\bsearch_review_summary\b[^"']*["'][^>]*>/i
    );

    if (reviewSpanMatch) {
      const tooltipMatch = reviewSpanMatch[0].match(
        /\bdata-tooltip-html=["']([\s\S]*?)["']/i
      );

      if (tooltipMatch) {
        const tooltip = decodeHtml_(stripTags_(tooltipMatch[1]))
          .replace(/\s+/g, ' ')
          .trim();

        const summaryMatch = tooltip.match(
          /(\d{1,3})%\s+of\s+the\s+([\d,]+)\s+user reviews?/i
        );

        if (summaryMatch) {
          reviewRating = Number(summaryMatch[1]) / 100;
          reviewCount = Number(summaryMatch[2].replace(/,/g, ''));
        }
      }
    }

    if (!name) continue;

    results.push({
      appId,
      name,
      url: cleanUrl,
      releaseDate,
      reviewCount,
      reviewRating
    });
  }

  const unique = new Map();
  results.forEach(item => {
    if (!unique.has(item.appId)) unique.set(item.appId, item);
  });
  return Array.from(unique.values());
}

/** Steam search card release field: <div class="search_released">...</div>. */
function extractSteamSearchReleaseText_(row) {
  const releaseMatch = String(row || '').match(
    /<div\b[^>]*class=["'][^"']*\bsearch_released\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  return releaseMatch ? decodeHtml_(stripTags_(releaseMatch[1])).replace(/\s+/g, ' ').trim() : '';
}

function createCandidateRecord_(item) {
  return {
    appId: String(item.appId),
    name: item.name,
    url: item.url,
    source: item.sources.join(' + '),
    sourceRank: item.ranks.join(' + '),
    sourcePage: item.sourcePages.join(' + '),
    releaseRaw: item.releaseRaw || '',
    releaseDate: null,
    releaseStage: '',
    daysToRelease: null,

    followers: null,
    baselineFollowers: null,
    gain7d: null,
    growthRate: null,
    coverageDays: null,

    reviews: isFiniteNumber_(item.reviewCount) ? Number(item.reviewCount) : null,
    positiveReviews:
      isFiniteNumber_(item.reviewCount) && isFiniteNumber_(item.reviewRating)
        ? Math.round(Number(item.reviewCount) * Number(item.reviewRating))
        : null,
    rating: isFiniteNumber_(item.reviewRating) ? Number(item.reviewRating) : null,

    result1A: '',
    reason1A: '',
    firstRoundType: '',
    priority: '',
    continueNext: '',
    nextAction: '',
    firstRoundReason: '',
    currentStage: '',
    dataStatus: 'OK',
    dataNotes: [],
    observationDataStatus: '',
    observationDataNotes: [],
    controlOnly: false,
    qualificationEligible: false,
    eligibilityReason: '',
    qualificationStatus: ''
  };
}

// ============================================================================
// Raw Observation -> Qualification Eligibility V1
// ============================================================================

function qualificationRankValue_(value) {
  const matches = String(value || '').match(/#(\d+)/g) || [];
  const ranks = matches.map(value => Number(value.slice(1))).filter(isFiniteNumber_);
  return ranks.length ? Math.min.apply(null, ranks) : null;
}

function qualificationRankBucket_(rank) {
  const value = Number(rank);
  if (!isFiniteNumber_(value) || value <= 0) return -1;
  if (value <= 50) return 5;
  if (value <= 100) return 4;
  if (value <= 250) return 3;
  if (value <= 500) return 2;
  if (value <= 1000) return 1;
  return 0;
}

function qualificationInScopeWindow_(rec) {
  const days = Number(rec && rec.daysToRelease);
  if (rec && rec.releaseStage === '即将发售' && isFiniteNumber_(days)) return days >= 0 && days <= 30;
  if (rec && rec.releaseStage === '已发售' && isFiniteNumber_(days)) return days <= 0 && days >= -14;
  return false;
}

function qualificationScopeStatus_(rec) {
  const days = Number(rec && rec.daysToRelease);
  const stage = String(rec && rec.releaseStage || '').trim();
  if (!stage || !isFiniteNumber_(days) || (stage !== '即将发售' && stage !== '已发售')) return 'SCOPE_UNKNOWN';
  return qualificationInScopeWindow_(rec) ? 'IN_SCOPE' : 'OUT_OF_SCOPE';
}

function qualificationRecheckDue_(decision, now) {
  if (!decision || String(decision.status || '').trim().toUpperCase() !== 'WATCH') return false;
  const due = dateAtStart_(decision.nextRecheckDate);
  const today = dateAtStart_(now);
  return !!due && !!today && due.getTime() <= today.getTime();
}

function evaluateQualificationEligibility_(rec, context) {
  const ctx = context || {};
  const previous = ctx.previousRaw || null;
  const state = ctx.qualification || null;
  const decision = ctx.decision || null;
  const inScope = qualificationInScopeWindow_(rec);
  const currentRank = qualificationRankValue_(rec && rec.sourceRank);
  const previousRank = state && state.lastRank;
  const previousBucket = qualificationRankBucket_(previousRank);
  const currentBucket = qualificationRankBucket_(currentRank);

  if (qualificationScopeStatus_(rec) === 'SCOPE_UNKNOWN') {
    return {eligible: false, reason: 'SCOPE_UNKNOWN'};
  }
  if (!previous && inScope) return {eligible: true, reason: 'NEW_IN_SCOPE'};
  if (previous && inScope && !qualificationInScopeWindow_(previous)) {
    return {eligible: true, reason: 'ENTERED_SCOPE'};
  }
  if (previous && previous.releaseStage === '即将发售' && rec.releaseStage === '已发售') {
    return {eligible: true, reason: 'STAGE_CHANGED'};
  }
  if (currentBucket >= 0 && previousBucket >= 0 && currentBucket > previousBucket) {
    return {eligible: true, reason: 'RANK_RISING'};
  }
  if (qualificationRecheckDue_(decision, ctx.now) ||
      String(state && state.lastStatus || '').trim() === 'INCOMPLETE' ||
      String(state && state.currentStage || '').trim() === '1B等待历史') {
    return {eligible: true, reason: 'RECHECK'};
  }
  return {eligible: false, reason: 'UNCHANGED_SKIP'};
}

function readLatestRawObservationIndex_(ss) {
  const result = new Map();
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.snapshot) : null;
  if (!sheet || sheet.getLastRow() < 2) return result;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const col = name => headers.indexOf(name);
  const appIdCol = col('Steam App ID');
  if (appIdCol < 0) return result;
  const stageCol = col('发布阶段');
  const daysCol = col('距发售天数');
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    result.set(appId, {
      releaseStage: stageCol >= 0 ? String(row[stageCol] || '').trim() : '',
      daysToRelease: daysCol >= 0 ? row[daysCol] : null
    });
  });
  return result;
}

function readQualificationStateIndex_(ss) {
  const result = new Map();
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.master) : null;
  if (!sheet || sheet.getLastRow() < 2) return result;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const index = name => headers.indexOf(name);
  const appIdCol = index('Steam App ID');
  if (appIdCol < 0) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    const appId = String(row[appIdCol] || '').trim();
    if (!appId) return;
    const value = name => { const i = index(name); return i >= 0 ? row[i] : ''; };
    result.set(appId, {
      lastTime: value('上次Qualification时间'),
      lastRank: qualificationRankValue_(value('上次Qualification排名')),
      lastStatus: String(value('Qualification状态') || '').trim(),
      currentStage: String(value('当前筛选阶段') || '').trim()
    });
  });
  return result;
}

// ============================================================================
// 0：Games Popularity + Steam Reviews 数据补全
// ============================================================================

function partitionDailyGamesPopularityCache_(records, cache) {
  const hits = [];
  const misses = [];
  (records || []).forEach(rec => {
    if (cache && cache.has(String(rec.appId))) hits.push(rec);
    else misses.push(rec);
  });
  return {hits: hits, misses: misses};
}

function readDailyGamesPopularityCache_(ss, runTime) {
  const out = new Map();
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.snapshot) : null;
  if (!sheet || sheet.getLastRow() < 2) return out;

  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.snapshotHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const col = {};
  HOTWORD_V2.snapshotHeaders.forEach(name => { col[name] = headers.indexOf(name); });
  const timeCol = col['运行时间'];
  const appIdCol = col['Steam App ID'];
  const followersCol = col['Steam Followers'];
  if (timeCol < 0 || appIdCol < 0 || followersCol < 0) return out;

  const dateKey = todayActionDateText_(runTime, ss);
  const numericCell = value => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return isFiniteNumber_(number) ? number : null;
  };
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    if (todayActionDateText_(row[timeCol], ss) !== dateKey) return;
    const appId = String(row[appIdCol] || '').trim();
    const followersText = String(row[followersCol] === null || row[followersCol] === undefined ? '' : row[followersCol]).trim();
    const followers = Number(followersText);
    // A cache hit is a complete successful GP observation, not merely a
    // latest-followers response. Incomplete history must remain a miss.
    if (!appId || !followersText || !isFiniteNumber_(followers) || followers < 0 ||
        numericCell(row[col['Steam 7d Gain']]) === null ||
        numericCell(row[col['近似增长率']]) === null ||
        numericCell(row[col['增速覆盖天数']]) === null) return;

    const observedAt = row[timeCol];
    const previous = out.get(appId);
    const observedTimestamp = new Date(observedAt).getTime();
    const previousTimestamp = previous ? new Date(previous.observedAt).getTime() : NaN;
    if (previous && isFinite(previousTimestamp) && isFinite(observedTimestamp) && previousTimestamp >= observedTimestamp) return;
    out.set(appId, {
      observedAt: observedAt,
      followers: followers,
      baselineFollowers: numericCell(row[col['7d基准Followers']]),
      gain7d: numericCell(row[col['Steam 7d Gain']]),
      growthRate: numericCell(row[col['近似增长率']]),
      coverageDays: numericCell(row[col['增速覆盖天数']])
    });
  });
  return out;
}

function fetchGamesPopularityLatestBatch_(records, apiKey, warnings, stats, attemptContext) {
  const map = new Map();
  const requests = records.map(rec => ({
    url: HOTWORD_V2.gpBase + '/game/latest/' + encodeURIComponent(rec.appId) + '?apiKey=' + encodeURIComponent(apiKey),
    muteHttpExceptions: true,
    method: 'get'
  }));

  if (stats) stats.realtimeRequests += requests.length;
  const responses = fetchAllInChunks_(requests, 40, 150);

  responses.forEach((resp, idx) => {
    const rec = records[idx];
    const code = resp.getResponseCode();

    if (code === 200) {
      try {
        map.set(rec.appId, JSON.parse(resp.getContentText()));
        if (stats) stats.realtimeSuccess += 1;
        appendGamesPopularityAttempt_(attemptContext, rec, 'latest', code, 'SUCCESS', '');
      } catch (e) {
        warnings.push('GP latest JSON异常 ' + rec.appId + ' ' + rec.name);
        appendGamesPopularityAttempt_(attemptContext, rec, 'latest', code, 'FAILED', 'JSON_PARSE');
      }
    } else if (code === 404) {
      warnings.push('GP数据集无此App ' + rec.appId + ' ' + rec.name);
      appendGamesPopularityAttempt_(attemptContext, rec, 'latest', code, 'FAILED', 'NOT_FOUND');
    } else {
      if (stats && code === 429) stats.rateLimited += 1;
      warnings.push('GP latest HTTP ' + code + ' ' + rec.appId + ' ' + rec.name);
      appendGamesPopularityAttempt_(attemptContext, rec, 'latest', code, 'FAILED', 'HTTP_' + code);
    }
  });

  return map;
}

function fetchGamesPopularityFollowersBatch_(records, apiKey, warnings, stats, attemptContext) {
  const map = new Map();
  const requests = records.map(rec => ({
    url: HOTWORD_V2.gpBase + '/game/followers/' + encodeURIComponent(rec.appId) + '?apiKey=' + encodeURIComponent(apiKey),
    muteHttpExceptions: true,
    method: 'get'
  }));

  if (stats) stats.realtimeRequests += requests.length;
  const responses = fetchAllInChunks_(requests, 40, 150);

  responses.forEach((resp, idx) => {
    const rec = records[idx];
    const code = resp.getResponseCode();

    if (code === 200) {
      try {
        map.set(rec.appId, JSON.parse(resp.getContentText()));
        if (stats) stats.realtimeSuccess += 1;
        appendGamesPopularityAttempt_(attemptContext, rec, 'followers', code, 'SUCCESS', '');
      } catch (e) {
        warnings.push('GP followers JSON异常 ' + rec.appId + ' ' + rec.name);
        appendGamesPopularityAttempt_(attemptContext, rec, 'followers', code, 'FAILED', 'JSON_PARSE');
      }
    } else if (code === 404) {
      warnings.push('GP followers无历史 ' + rec.appId + ' ' + rec.name);
      appendGamesPopularityAttempt_(attemptContext, rec, 'followers', code, 'FAILED', 'NOT_FOUND');
    } else {
      if (stats && code === 429) stats.rateLimited += 1;
      warnings.push('GP followers HTTP ' + code + ' ' + rec.appId + ' ' + rec.name);
      appendGamesPopularityAttempt_(attemptContext, rec, 'followers', code, 'FAILED', 'HTTP_' + code);
    }
  });

  return map;
}

function appendGamesPopularityAttempt_(context, rec, endpoint, code, result, errorSummary) {
  if (!context || !context.runId) return;
  const row = [
    context.runTime || new Date(), context.runId, 'Games Popularity', endpoint,
    String(rec && rec.appId || ''), String(rec && rec.name || ''),
    context.refreshReason || 'POLICY_MISS', Number(code || 0), result, errorSummary || ''
  ];
  if (context.attemptBuffer) {
    context.attemptBuffer.push(row);
    return;
  }
  if (!context.ss) return;
  const sheet = context.ss.getSheetByName(HOTWORD_V2.sheets.externalDataAttempts);
  if (!sheet) return;
  sheet.appendRow(row);
}

function flushGamesPopularityAttempts_(context) {
  if (!context || !context.ss || !context.attemptBuffer || !context.attemptBuffer.length) return 0;
  const sheet = context.ss.getSheetByName(HOTWORD_V2.sheets.externalDataAttempts);
  if (!sheet) return 0;
  const rows = context.attemptBuffer.splice(0, context.attemptBuffer.length);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}

function fetchSteamReviewSummaryBatch_(records, warnings) {
  const map = new Map();
  const requests = records.map(rec => ({
    // V2.5：
    // Steam 官方 Reviews 文档要求 cursor 参数；
    // query_summary 只在第一请求返回，因此显式使用 cursor=*。
    url: 'https://store.steampowered.com/appreviews/' + encodeURIComponent(rec.appId) +
      '?json=1&filter=all&language=all&day_range=365&cursor=%2A' +
      '&review_type=all&purchase_type=all&num_per_page=1',
    muteHttpExceptions: true,
    method: 'get',
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (compatible; SteamHotwordPipeline/2.6)'
    }
  }));

  const responses = fetchAllInChunks_(requests, 30, 120);

  responses.forEach((resp, idx) => {
    const rec = records[idx];
    const code = resp.getResponseCode();

    if (code !== 200) {
      warnings.push('Steam Reviews HTTP ' + code + ' ' + rec.appId + ' ' + rec.name);
      return;
    }

    try {
      const json = JSON.parse(resp.getContentText());
      const q = json && json.query_summary ? json.query_summary : null;
      if (!q) {
        warnings.push('Steam Reviews无query_summary ' + rec.appId + ' ' + rec.name);
        return;
      }

      map.set(rec.appId, {
        totalReviews: Number(q.total_reviews || 0),
        totalPositive: Number(q.total_positive || 0),
        totalNegative: Number(q.total_negative || 0)
      });
    } catch (e) {
      warnings.push('Steam Reviews JSON异常 ' + rec.appId + ' ' + rec.name);
    }
  });

  return map;
}

function fetchAllInChunks_(requests, chunkSize, sleepMs) {
  const out = [];
  for (let i = 0; i < requests.length; i += chunkSize) {
    const chunk = requests.slice(i, i + chunkSize);
    const responses = UrlFetchApp.fetchAll(chunk);
    responses.forEach(r => out.push(r));
    if (sleepMs && i + chunkSize < requests.length) Utilities.sleep(sleepMs);
  }
  return out;
}


// ============================================================================
// 发售日解析 + 1A
// ============================================================================

function fillReleaseStage_(rec, now, timeZone) {
  const parsed = parseExactSteamDate_(rec.releaseRaw);

  if (!parsed) {
    rec.releaseDate = null;
    rec.releaseStage = '发售日不确定';
    rec.daysToRelease = null;
    rec.dataStatus = '⚠ 数据缺失';
    addDataNote_(rec, '发布日原文无法解析为精确日期：' + (rec.releaseRaw || '空'));
    return;
  }

  rec.releaseDate = parsed;
  rec.daysToRelease = calendarDayDiff_(now, parsed, timeZone);

  // Steam搜索来源能帮助同一天判断“已发售/即将发售”。
  if (rec.daysToRelease > 0) {
    rec.releaseStage = '即将发售';
  } else if (rec.daysToRelease < 0) {
    rec.releaseStage = '已发售';
  } else {
    rec.releaseStage = rec.source.includes('Popular New Releases') ? '已发售' : '即将发售';
  }
}

function parseExactSteamDate_(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // 只有月/年、Coming soon、TBA 等不算精确日期。
  if (/coming soon|to be announced|tba/i.test(s)) return null;
  if (/^[A-Za-z]+\s+\d{4}$/.test(s)) return null;
  if (/^\d{4}$/.test(s)) return null;

  const months = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  let m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = months[m[1].toLowerCase()];
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[2]));
  }

  m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (m) {
    const month = months[m[2].toLowerCase()];
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[1]));
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // 最后兜底：必须同时包含 4位年、月份单词、1-2位日。
  if (/\d{4}/.test(s) && /[A-Za-z]{3,}/.test(s) && /\b\d{1,2}\b/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  return null;
}

function calendarDayDiff_(fromDate, toDate, timeZone) {
  const fromKey = Utilities.formatDate(fromDate, timeZone, 'yyyy-MM-dd');
  const toKey = Utilities.formatDate(toDate, timeZone, 'yyyy-MM-dd');
  const a = parseYmdToUtc_(fromKey);
  const b = parseYmdToUtc_(toKey);
  return Math.round((b - a) / 86400000);
}

function parseYmdToUtc_(ymd) {
  const p = String(ymd).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

function classify1A_(rec, rules) {
  if (!rec.releaseDate || !rec.releaseStage || !isFiniteNumber_(rec.daysToRelease)) {
    return {pass: false, dataIssue: true, controlOnly: false, reason: '精确发售日期缺失'};
  }

  if (!isFiniteNumber_(rec.followers)) {
    return {pass: false, dataIssue: true, controlOnly: false, reason: 'Followers当前值缺失'};
  }

  const followers = Number(rec.followers);
  const controlFollowerMin = Number(rules.CONTROL_FOLLOWERS_MIN);
  const controlFollowerMax = Number(rules.CONTROL_FOLLOWERS_MAX);

  if (rec.releaseStage === '即将发售') {
    const days = Number(rec.daysToRelease);
    const timeOk = days >= Number(rules.UPCOMING_DAYS_MIN) && days <= Number(rules.UPCOMING_DAYS_MAX);

    if (!timeOk) {
      return {
        pass: false,
        dataIssue: false,
        controlOnly: false,
        reason: '距发售' + days + '天，不在' + rules.UPCOMING_DAYS_MIN + '–' + rules.UPCOMING_DAYS_MAX + '天窗口'
      };
    }

    const inPrimaryFollowers =
      followers >= Number(rules.UPCOMING_FOLLOWERS_MIN) &&
      followers <= Number(rules.UPCOMING_FOLLOWERS_MAX);

    if (inPrimaryFollowers) {
      return {
        pass: true,
        dataIssue: false,
        controlOnly: false,
        reason: '即将发售主池通过：未来' + days + '天；Followers=' + followers +
          '（要求' + rules.UPCOMING_FOLLOWERS_MIN + '–' + rules.UPCOMING_FOLLOWERS_MAX + '）'
      };
    }

    // 大盘对照例外：不进入主攻池，只允许到1B后竞争“少量对照位”。
    if (
      followers > Number(rules.UPCOMING_FOLLOWERS_MAX) &&
      followers >= controlFollowerMin &&
      followers <= controlFollowerMax
    ) {
      return {
        pass: true,
        dataIssue: false,
        controlOnly: true,
        reason: '即将发售规模超主池，但进入大盘对照预留：Followers=' + followers
      };
    }

    return {
      pass: false,
      dataIssue: false,
      controlOnly: false,
      reason: followers < Number(rules.UPCOMING_FOLLOWERS_MIN)
        ? 'Followers ' + followers + ' < ' + rules.UPCOMING_FOLLOWERS_MIN
        : 'Followers ' + followers + ' > 主池上限' + rules.UPCOMING_FOLLOWERS_MAX + '，且不在对照预留范围'
    };
  }

  if (rec.releaseStage === '已发售') {
    const daysSince = Math.abs(Number(rec.daysToRelease));

    // V2.3：
    // 评论数是第一层硬条件。0 条/少于下限是“有效的淘汰数据”，不是数据异常。
    // 只有当评论数本身拿不到，或者评论数已经达到主池下限但评分仍拿不到时，
    // 才视为真正的数据缺失。
    if (!isFiniteNumber_(rec.reviews)) {
      return {
        pass: false,
        dataIssue: true,
        controlOnly: false,
        reason: '已发售游戏评论数缺失'
      };
    }

    const reviews = Number(rec.reviews);
    const hardReasons = [];

    // V2.4：提前声明，避免后续通过分支引用块级 const 导致 ReferenceError。
    let ratingPct = null;

    if (daysSince > Number(rules.RELEASED_DAYS_MAX)) {
      hardReasons.push('已发售' + daysSince + '天 > ' + rules.RELEASED_DAYS_MAX + '天');
    }

    if (reviews < Number(rules.RELEASED_REVIEWS_MIN)) {
      hardReasons.push('评论数 ' + reviews + ' < ' + rules.RELEASED_REVIEWS_MIN);
    }

    if (reviews > Number(rules.RELEASED_REVIEWS_MAX)) {
      hardReasons.push('评论数 ' + reviews + ' > ' + rules.RELEASED_REVIEWS_MAX);
    }

    // 如果评论数已经因为上下限明确淘汰，就不需要评分参与，也不把“无评分”记成异常。
    const reviewCountAlreadyExcludes =
      reviews < Number(rules.RELEASED_REVIEWS_MIN) ||
      reviews > Number(rules.RELEASED_REVIEWS_MAX);

    if (!reviewCountAlreadyExcludes) {
      if (!isFiniteNumber_(rec.rating)) {
        return {
          pass: false,
          dataIssue: true,
          controlOnly: false,
          reason: '评论数已进入主池范围，但Steam评分缺失'
        };
      }

      ratingPct = Number(rec.rating) * 100;
      if (ratingPct < Number(rules.RELEASED_RATING_MIN)) {
        hardReasons.push(
          '评分 ' + ratingPct.toFixed(1) + '% < ' + rules.RELEASED_RATING_MIN + '%'
        );
      }
    }

    if (hardReasons.length) {
      return {pass: false, dataIssue: false, controlOnly: false, reason: hardReasons.join('；')};
    }

    // 走到这里时，评论数已在主池范围内，因此评分必须已经成功计算。
    // 额外防守，避免未来规则改动后再次出现未定义/空评分进入通过分支。
    if (!isFiniteNumber_(ratingPct)) {
      return {
        pass: false,
        dataIssue: true,
        controlOnly: false,
        reason: '已发售游戏评分计算失败'
      };
    }

    const inPrimaryFollowers =
      followers >= Number(rules.RELEASED_FOLLOWERS_MIN) &&
      followers <= Number(rules.RELEASED_FOLLOWERS_MAX);

    if (inPrimaryFollowers) {
      return {
        pass: true,
        dataIssue: false,
        controlOnly: false,
        reason: '已发售主池通过：发售后' + daysSince + '天；Followers=' + followers +
          '；评论=' + reviews + '；评分=' + ratingPct.toFixed(1) + '%'
      };
    }

    if (
      followers > Number(rules.RELEASED_FOLLOWERS_MAX) &&
      followers >= controlFollowerMin &&
      followers <= controlFollowerMax
    ) {
      return {
        pass: true,
        dataIssue: false,
        controlOnly: true,
        reason: '已发售规模超主池，但评论/评分/时间合格，进入大盘对照预留：Followers=' + followers
      };
    }

    return {
      pass: false,
      dataIssue: false,
      controlOnly: false,
      reason: followers < Number(rules.RELEASED_FOLLOWERS_MIN)
        ? 'Followers ' + followers + ' < ' + rules.RELEASED_FOLLOWERS_MIN
        : 'Followers ' + followers + ' > 主池上限' + rules.RELEASED_FOLLOWERS_MAX + '，且不在对照预留范围'
    };
  }

  return {pass: false, dataIssue: true, controlOnly: false, reason: '无法判断发布阶段'};
}


// ============================================================================
// 1B：Followers 7d 增速 + 分类
// ============================================================================

function computeFollowerGrowth_(payload, currentFollowers, now, minHistoryDays) {
  if (!payload || !Array.isArray(payload.history) || payload.history.length === 0) {
    return {ok: false, reason: '没有 Followers 历史记录'};
  }

  if (!isFiniteNumber_(currentFollowers)) {
    return {ok: false, reason: '当前 Followers 缺失'};
  }

  const points = payload.history
    .map(x => ({
      followers: Number(x.followers),
      added: new Date(x.added)
    }))
    .filter(x => isFiniteNumber_(x.followers) && !isNaN(x.added.getTime()))
    .sort((a, b) => b.added.getTime() - a.added.getTime());

  if (points.length === 0) {
    return {ok: false, reason: 'Followers 历史记录无法解析'};
  }

  const target = now.getTime() - 7 * 86400000;

  // 选择“最接近7天前”的日度观测；优先不晚于目标时刻。
  let baseline = null;
  for (const p of points) {
    if (p.added.getTime() <= target) {
      baseline = p;
      break;
    }
  }

  if (!baseline) {
    // 数据历史不足7天时，使用最老点判断覆盖天数，但不贸然按7d分类。
    baseline = points[points.length - 1];
  }

  const coverageDays = (now.getTime() - baseline.added.getTime()) / 86400000;
  if (coverageDays < Number(minHistoryDays)) {
    return {
      ok: false,
      reason: 'Followers 历史仅覆盖约' + coverageDays.toFixed(1) + '天，小于最低' + minHistoryDays + '天'
    };
  }

  const current = Number(currentFollowers);
  const gain = current - Number(baseline.followers);
  const growthRate = current > 0 ? gain / current : null;

  if (!isFiniteNumber_(growthRate)) {
    return {ok: false, reason: '增长率无法计算'};
  }

  return {
    ok: true,
    baselineFollowers: Number(baseline.followers),
    gain: gain,
    growthRate: growthRate,
    coverageDays: coverageDays
  };
}

function classify1BRaw_(rec, rules) {
  const followers = Number(rec.followers);
  const gain = Number(rec.gain7d);
  const growth = Number(rec.growthRate);

  // 超出主池规模、仅作为大盘对照预留的对象：不允许转成主攻 Trend/Early。
  if (rec.controlOnly) {
    if (
      followers >= Number(rules.CONTROL_FOLLOWERS_MIN) &&
      followers <= Number(rules.CONTROL_FOLLOWERS_MAX) &&
      gain >= Number(rules.CONTROL_GAIN_MIN) &&
      growth < Number(rules.CONTROL_GROWTH_MAX)
    ) {
      return {
        type: '🏢 对照候选',
        reason: '1A仅作大盘对照预留；Followers=' + followers +
          '；Gain=' + gain + '；增长率=' + formatPercentText_(growth)
      };
    }

    return {
      type: '⚪ 低优先级',
      reason: '规模超出主池，仅允许进入少量大盘对照；当前Gain/增长率未满足对照规则'
    };
  }

  // 主池规则顺序很重要：Trend 优先于 Early。
  if (gain >= Number(rules.TREND_GAIN_MIN) && growth >= Number(rules.TREND_GROWTH_MIN)) {
    return {
      type: '🔥 趋势候选',
      reason: '7d Gain=' + gain + '≥' + rules.TREND_GAIN_MIN +
        '，增长率=' + formatPercentText_(growth) + '≥' + formatPercentText_(rules.TREND_GROWTH_MIN)
    };
  }

  if (
    followers <= Number(rules.EARLY_FOLLOWERS_MAX) &&
    gain >= Number(rules.EARLY_GAIN_MIN) &&
    growth >= Number(rules.EARLY_GROWTH_MIN)
  ) {
    return {
      type: '🌱 Early候选',
      reason: '小基数 Followers=' + followers + '≤' + rules.EARLY_FOLLOWERS_MAX +
        '；7d Gain=' + gain + '≥' + rules.EARLY_GAIN_MIN +
        '；增长率=' + formatPercentText_(growth) + '≥' + formatPercentText_(rules.EARLY_GROWTH_MIN)
    };
  }

  if (
    followers >= Number(rules.CONTROL_FOLLOWERS_MIN) &&
    gain >= Number(rules.CONTROL_GAIN_MIN) &&
    growth < Number(rules.CONTROL_GROWTH_MAX)
  ) {
    return {
      type: '🏢 对照候选',
      reason: 'Followers=' + followers + '≥' + rules.CONTROL_FOLLOWERS_MIN +
        '且Gain=' + gain + '≥' + rules.CONTROL_GAIN_MIN +
        '，但增长率=' + formatPercentText_(growth) + '<' + formatPercentText_(rules.CONTROL_GROWTH_MAX)
    };
  }

  if (
    (gain >= Number(rules.TREND_WATCH_GAIN_MIN) && growth >= Number(rules.TREND_WATCH_GROWTH_MIN)) ||
    (gain >= Number(rules.TREND_WATCH_HIGH_GAIN_MIN) && growth >= Number(rules.TREND_WATCH_HIGH_GAIN_GROWTH_MIN))
  ) {
    return {
      type: '🟡 Trend Watch',
      reason: 'P2 Trend Watch：7d Gain=' + gain + '，增长率=' + formatPercentText_(growth) +
        '；满足（Gain≥' + rules.TREND_WATCH_GAIN_MIN + '且增长≥' + formatPercentText_(rules.TREND_WATCH_GROWTH_MIN) +
        '）或（Gain≥' + rules.TREND_WATCH_HIGH_GAIN_MIN + '且增长≥' + formatPercentText_(rules.TREND_WATCH_HIGH_GAIN_GROWTH_MIN) + '）'
    };
  }

  if (
    followers <= Number(rules.EARLY_WATCH_FOLLOWERS_MAX) &&
    gain >= Number(rules.EARLY_WATCH_GAIN_MIN) &&
    growth >= Number(rules.EARLY_WATCH_GROWTH_MIN)
  ) {
    return {
      type: '🟢 Early Watch',
      reason: 'P2 Early Watch：Followers=' + followers + '≤' + rules.EARLY_WATCH_FOLLOWERS_MAX +
        '；7d Gain=' + gain + '≥' + rules.EARLY_WATCH_GAIN_MIN +
        '；增长率=' + formatPercentText_(growth) + '≥' + formatPercentText_(rules.EARLY_WATCH_GROWTH_MIN)
    };
  }

  return {
    type: '⚪ 低优先级',
    reason: '未同时满足趋势、Early、大盘对照或P2观察规则；7d Gain=' + gain +
      '，增长率=' + formatPercentText_(growth) + '，Followers=' + followers
  };
}

function applyFirstRoundDecision_(rec, type, priority, continueNext, nextAction, reason) {
  rec.firstRoundType = type;
  rec.priority = priority;
  rec.continueNext = continueNext;
  rec.nextAction = nextAction;
  rec.firstRoundReason = reason;
  rec.currentStage = continueNext === '是' ? '1B完成→人工第二轮' : '1B暂缓';
}

function runFirstRoundBacktest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSteamHotwordV2();
  const rules = loadRules_(ss);
  const sheet = ss.getSheetByName('1B规则回测');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const temp = rows.map((r, idx) => ({
    idx,
    followers: Number(r[1]),
    gain7d: Number(r[2]),
    growthRate: Number(r[3]),
    expected: String(r[4] || '')
  }));

  const controls = [];
  temp.forEach(x => {
    const raw = classify1BRaw_(x, rules);
    x.raw = raw;
    if (raw.type === '🏢 对照候选') controls.push(x);
  });

  controls.sort((a, b) => b.gain7d - a.gain7d);
  const allowedControlRows = new Set(
    controls.slice(0, Math.max(0, Math.floor(Number(rules.CONTROL_MAX_PER_RUN)))).map(x => x.idx)
  );

  const output = [];
  temp.forEach(x => {
    let actual = x.raw.type;
    if (actual === '🏢 对照候选') {
      actual = allowedControlRows.has(x.idx) ? '🏢 大盘对照' : '⚪ 低优先级';
    }
    const expectedNormalized = x.expected;
    const pass = expectedNormalized === actual;
    output.push([actual, pass ? 'PASS' : 'CHECK']);
  });

  sheet.getRange(2, 6, output.length, 2).setValues(output);
  safeToast_('1B规则回测完成。请看“1B规则回测”Sheet 的 PASS/CHECK。', 'Steam 0→1B', 7);
}


// ============================================================================
// 历史去重 + 建站关键词规划 Build 同步
// ============================================================================

var HISTORY_PLACEHOLDER_APP_ID_ = '1337';
var HISTORY_STAGE_BUILD_ = '已进入建站';
var HISTORY_STAGE_GSC_ = 'GSC监控';
var HISTORY_AUTO_NOTE_ = '由建站关键词规划自动同步';

function isPlaceholderSteamValue_(value) {
  return String(value || '').trim() === HISTORY_PLACEHOLDER_APP_ID_;
}

function isReliableSteamAppId_(value) {
  const s = String(value || '').trim();
  if (!/^\d+$/.test(s)) return false;
  if (s === HISTORY_PLACEHOLDER_APP_ID_) return false;
  return true;
}

function isReliableSteamUrl_(value) {
  const s = String(value || '').trim();
  if (!s || isPlaceholderSteamValue_(s)) return false;
  const m = s.match(/store\.steampowered\.com\/app\/(\d+)/i);
  if (!m) return false;
  return isReliableSteamAppId_(m[1]);
}

function isBuildAction_(value) {
  return /^build$/i.test(String(value || '').trim());
}

function mapKeywordPlanHeaders_(headerRow) {
  const cols = {name: null, appId: null, action: null, url: null};
  (headerRow || []).forEach((cell, idx) => {
    const h = String(cell || '').toLowerCase().replace(/\s+/g, '');
    if (!h) return;
    if (cols.name == null && (h === '目标游戏' || h === '游戏名称' || h === '游戏')) {
      cols.name = idx;
    }
    if (
      cols.appId == null &&
      (h === '关联appid' || h === 'steamappid' || h === 'appid' || h === '关联steamappid')
    ) {
      cols.appId = idx;
    }
    if (cols.action == null && (h === '动作' || h === 'action')) {
      cols.action = idx;
    }
    if (
      cols.url == null &&
      (h === 'steamurl' || h === 'steam链接' || h === '商店url' || h === '商店链接')
    ) {
      cols.url = idx;
    }
  });
  return cols;
}

function findKeywordPlanHeader_(values) {
  const maxScan = Math.min((values || []).length, 15);
  for (let i = 0; i < maxScan; i++) {
    const cols = mapKeywordPlanHeaders_(values[i]);
    if (cols.name != null && cols.action != null) {
      return {rowIndex: i, cols: cols};
    }
  }
  return null;
}

function cellAt_(row, idx) {
  if (idx == null || idx < 0 || !row) return '';
  return String(row[idx] == null ? '' : row[idx]).trim();
}

function aggregateKeywordPlanGames_(rawRows) {
  const byAppId = new Map();
  const byName = new Map();
  const seen = [];

  function remember(game) {
    if (seen.indexOf(game) < 0) seen.push(game);
    if (isReliableSteamAppId_(game.appId)) byAppId.set(String(game.appId), game);
    const nkey = normalizeGameName_(game.name);
    if (nkey) byName.set(nkey, game);
  }

  (rawRows || []).forEach(row => {
    const name = String(row.name || '').trim();
    const appId = String(row.appId || '').trim();
    const action = String(row.action || '').trim();
    const url = String(row.url || '').trim();
    if (!name && !isReliableSteamAppId_(appId)) return;

    let game = null;
    if (isReliableSteamAppId_(appId) && byAppId.has(appId)) {
      game = byAppId.get(appId);
    } else {
      const nkey = normalizeGameName_(name);
      if (nkey && byName.has(nkey)) game = byName.get(nkey);
    }

    if (!game) {
      game = {name: name, appId: '', url: '', hasBuild: false};
    }

    if (name && !game.name) game.name = name;
    if (isReliableSteamAppId_(appId) && !isReliableSteamAppId_(game.appId)) {
      game.appId = appId;
    }
    if (isReliableSteamUrl_(url) && !isReliableSteamUrl_(game.url)) {
      game.url = url;
    }
    if (isBuildAction_(action)) game.hasBuild = true;
    remember(game);
  });

  return seen;
}

function parseKeywordPlanValues_(values) {
  const headerInfo = findKeywordPlanHeader_(values);
  if (!headerInfo) return {games: [], buildGames: [], parsed: false};

  const rawRows = [];
  let lastName = '';
  let lastAppId = '';
  let lastUrl = '';

  for (let i = headerInfo.rowIndex + 1; i < values.length; i++) {
    const row = values[i] || [];
    let name = cellAt_(row, headerInfo.cols.name);
    let appId = cellAt_(row, headerInfo.cols.appId);
    const action = cellAt_(row, headerInfo.cols.action);
    let url = cellAt_(row, headerInfo.cols.url);

    if (name) {
      lastName = name;
      lastAppId = appId || '';
      lastUrl = url || '';
    } else {
      name = lastName;
      if (!appId) appId = lastAppId;
      if (!url) url = lastUrl;
    }
    if (appId) lastAppId = appId;
    if (url) lastUrl = url;

    if (!name) continue;
    rawRows.push({name: name, appId: appId, action: action, url: url});
  }

  const games = aggregateKeywordPlanGames_(rawRows);
  return {
    games: games,
    buildGames: games.filter(g => g.hasBuild),
    parsed: true
  };
}

function findHistoryMatchIndex_(rows, game) {
  if (isReliableSteamAppId_(game && game.appId)) {
    const appId = String(game.appId);
    for (let i = 0; i < rows.length; i++) {
      if (isReliableSteamAppId_(rows[i].appId) && String(rows[i].appId) === appId) {
        return i;
      }
    }
  }

  const nkey = normalizeGameName_(game && game.name);
  if (nkey) {
    for (let i = 0; i < rows.length; i++) {
      if (normalizeGameName_(rows[i].name) === nkey) return i;
    }
  }
  return -1;
}

function lookupPlanFieldByName_(planGames, name, field) {
  const nkey = normalizeGameName_(name);
  if (!nkey) return '';
  for (let i = 0; i < (planGames || []).length; i++) {
    if (normalizeGameName_(planGames[i].name) !== nkey) continue;
    const value = planGames[i][field];
    if (field === 'appId' && isReliableSteamAppId_(value)) return String(value);
    if (field === 'url' && isReliableSteamUrl_(value)) return String(value);
  }
  return '';
}

/**
 * 纯函数：把 Build 游戏 upsert 进历史库，并清理 1337 占位。
 * 已有 GSC监控 不降级；已有人工备注不覆盖。
 */
function applyBuildGamesHistorySync_(historyRows, buildGames, allPlanGames) {
  const rows = (historyRows || []).map(r => ({
    rowNumber: r.rowNumber,
    appId: String(r.appId || '').trim(),
    name: String(r.name || '').trim(),
    url: String(r.url || '').trim(),
    stage: String(r.stage || '').trim(),
    note: String(r.note || '').trim()
  }));

  rows.forEach(row => {
    if (isPlaceholderSteamValue_(row.appId)) {
      row.appId = lookupPlanFieldByName_(allPlanGames, row.name, 'appId') || '';
    }
    if (isPlaceholderSteamValue_(row.url)) {
      row.url = lookupPlanFieldByName_(allPlanGames, row.name, 'url') || '';
    }
  });

  let inserted = 0;
  let updated = 0;

  (buildGames || []).forEach(game => {
    const idx = findHistoryMatchIndex_(rows, game);
    if (idx < 0) {
      rows.push({
        appId: isReliableSteamAppId_(game.appId) ? String(game.appId) : '',
        name: String(game.name || '').trim(),
        url: isReliableSteamUrl_(game.url) ? String(game.url) : '',
        stage: HISTORY_STAGE_BUILD_,
        note: HISTORY_AUTO_NOTE_
      });
      inserted += 1;
      return;
    }

    const existing = rows[idx];
    let changed = false;

    if (!isReliableSteamAppId_(existing.appId) && isReliableSteamAppId_(game.appId)) {
      existing.appId = String(game.appId);
      changed = true;
    }
    if (isPlaceholderSteamValue_(existing.url)) {
      existing.url = isReliableSteamUrl_(game.url) ? String(game.url) : '';
      changed = true;
    } else if (!isReliableSteamUrl_(existing.url) && isReliableSteamUrl_(game.url)) {
      existing.url = String(game.url);
      changed = true;
    }
    if (existing.stage !== HISTORY_STAGE_GSC_ && !existing.stage) {
      existing.stage = HISTORY_STAGE_BUILD_;
      changed = true;
    }
    if (!existing.note) {
      existing.note = HISTORY_AUTO_NOTE_;
      changed = true;
    }
    if (changed) updated += 1;
  });

  return {rows: rows, inserted: inserted, updated: updated};
}

function historyRecordsFromSheetValues_(values) {
  return (values || [])
    .map((row, i) => ({
      rowNumber: i + 2,
      appId: String(row[0] || '').trim(),
      name: String(row[1] || '').trim(),
      url: String(row[2] || '').trim(),
      stage: String(row[3] || '').trim(),
      note: String(row[4] || '').trim()
    }))
    .filter(r => r.appId || r.name);
}

function buildHistoryKeysFromRows_(rows) {
  const result = {byAppId: new Set(), byName: new Set()};
  (rows || []).forEach(row => {
    const appId = Array.isArray(row) ? String(row[0] || '').trim() : String(row.appId || '').trim();
    const name = Array.isArray(row) ? row[1] : row.name;
    const normalized = normalizeGameName_(name);
    if (isReliableSteamAppId_(appId)) result.byAppId.add(appId);
    if (normalized) result.byName.add(normalized);
  });
  return result;
}

function isInHistoryIndex_(item, historyIndex) {
  const appId = String((item && item.appId) || '').trim();
  const normalized = normalizeGameName_(item && item.name);
  return (
    (isReliableSteamAppId_(appId) && historyIndex.byAppId.has(appId)) ||
    (!!normalized && historyIndex.byName.has(normalized))
  );
}

function loadHistoryRecords_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const colCount = Math.max(1, Math.min(5, sheet.getLastColumn()));
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getDisplayValues();
  return historyRecordsFromSheetValues_(values);
}

function writeHistorySyncResult_(sheet, result) {
  (result.rows || []).forEach(row => {
    if (!row.rowNumber) return;
    sheet.getRange(row.rowNumber, 1, 1, 5).setValues([[
      row.appId,
      row.name,
      row.url,
      row.stage,
      row.note
    ]]);
  });

  const newRows = (result.rows || []).filter(r => !r.rowNumber);
  if (!newRows.length) return;
  const values = newRows.map(r => [r.appId, r.name, r.url, r.stage, r.note]);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 5).setValues(values);
}

function syncBuildGamesToHistory_(ss) {
  const empty = {inserted: 0, updated: 0, skipped: true, rows: []};
  if (!ss) return empty;

  const historySheet = ss.getSheetByName(HOTWORD_V2.sheets.history);
  if (!historySheet) return empty;

  const planSheet = ss.getSheetByName(HOTWORD_V2.sheets.keywordPlan);
  let parsed = {games: [], buildGames: [], parsed: false};
  if (planSheet && planSheet.getLastRow() >= 1) {
    const planValues = planSheet
      .getRange(1, 1, planSheet.getLastRow(), Math.max(1, planSheet.getLastColumn()))
      .getDisplayValues();
    parsed = parseKeywordPlanValues_(planValues);
  }

  const historyRows = loadHistoryRecords_(historySheet);
  const result = applyBuildGamesHistorySync_(
    historyRows,
    parsed.parsed ? parsed.buildGames : [],
    parsed.parsed ? parsed.games : []
  );
  writeHistorySyncResult_(historySheet, result);
  result.skipped = false;
  return result;
}

function buildHistoryIndex_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.history);
  if (!sheet || sheet.getLastRow() < 2) return {byAppId: new Set(), byName: new Set()};
  const colCount = Math.max(1, Math.min(5, sheet.getLastColumn()));
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getDisplayValues();
  return buildHistoryKeysFromRows_(values);
}


// ============================================================================
// Google Trends 查询词（Steam 原名 → Trends OR 查询）
// ============================================================================

const TRENDS_QUERY_STATUS_ = {
  AUTO: '✅ 自动',
  REVIEW: '⚠️ Alias需确认'
};

/** 商店页版本后缀（整段移除，不当作游戏核心名） */
const TRENDS_STORE_EDITION_SUFFIX_RES_ = [
  /\s*[-–—]\s*(?:legacy|deluxe|ultimate|complete|collector'?s?|definitive|standard|gold|premium|special)\s+edition\s*$/i,
  /\s+(?:legacy|deluxe|ultimate|complete|collector'?s?|definitive|standard|gold|premium|special)\s+edition\s*$/i
];

/** 触发人工复核的版本/重制词（可存在于原名，不一定从 Core Name 删除） */
const TRENDS_VERSION_HINT_RE_ =
  /\b(?:legacy|deluxe|ultimate|complete|collector'?s?|definitive|remastered|remaster|goty|game of the year)\b/i;

/** 明显大型 IP / franchise：只用于保守标记复核，不激进截短 */
const TRENDS_FRANCHISE_REVIEW_RE_ =
  /\b(?:aliens|the lord of the rings|star wars|marvel|harry potter|pokemon|zelda|final fantasy|assassin'?s creed|call of duty|grand theft auto|warhammer|resident evil|silent hill|metal gear|mass effect|dragon age|need for speed|mortal kombat|street fighter|counter[\s-]?strike|diablo|overwatch|fortnite|minecraft|elder scrolls|fallout|borderlands|bioshock|half[\s-]?life|dead space|battlefield|halo|gears of war|god of war|horizon zero dawn|last of us|uncharted|spider[\s-]?man|batman|superman|tomb raider|hitman|far cry|watch dogs|saints row|dying light|payday|payday 2|total war|crusader kings|europa universalis|hearts of iron|football manager|fifa|nba 2k|madden|nhl|wwe|ufc|formula 1|f1)\b/i;

/** 禁止单独作为 alias 的主标题 / 大型 IP（避免把影视、泛 IP 热度带入 Trends） */
const TRENDS_FRANCHISE_MAIN_ALIAS_BLOCK_RE_ =
  /\b(?:aliens|the lord of the rings|star wars|marvel|harry potter|pokemon|zelda|final fantasy|assassin'?s creed|call of duty|grand theft auto|warhammer|resident evil|silent hill|metal gear|mass effect|dragon age|need for speed|mortal kombat|street fighter|counter[\s-]?strike|diablo|overwatch|fortnite|minecraft|elder scrolls|fallout|borderlands|bioshock|half[\s-]?life|dead space|battlefield|halo|gears of war|god of war|horizon zero dawn|last of us|uncharted|spider[\s-]?man|batman|superman|tomb raider|hitman|far cry|watch dogs|saints row|dying light|payday|total war|crusader kings|europa universalis|hearts of iron|football manager|fifa|nba 2k|madden|nhl|wwe|ufc|formula 1|f1)\b/i;

/** 冒号前主标题 alias 白名单：仅高置信、游戏特异性识别词 */
const TRENDS_SHORT_MAIN_ALIAS_WHITELIST_RES_ = [
  /^agent\s+\d+$/i
];

/** 已知 franchise 缩写（仅在高置信场景追加第三别名） */
const TRENDS_FRANCHISE_ABBREV_RULES_ = [
  {match: /^the lord of the rings\b/i, abbrev: 'LOTR'}
];

/**
 * 由 Steam 原始游戏名生成 Google Trends OR 查询词。
 * @param {string} gameName
 * @param {string} [searchAlias] 玩家常用称呼发现结果；有值时 Trends 仅使用官方名 + 搜索别名。
 * @return {{query: string, status: string}}
 */
function buildTrendsQuery_(gameName, searchAlias) {
  const raw = String(gameName || '').trim();
  if (!raw) return {query: '', status: TRENDS_QUERY_STATUS_.AUTO};

  let working = stripTrendsNoise_(raw);
  TRENDS_STORE_EDITION_SUFFIX_RES_.forEach(re => {
    working = working.replace(re, '').trim();
  });
  working = working.replace(/\s*[-–—]\s*$/, '').trim();
  let coreName = cleanTrendsDisplayName_(working);
  if (!coreName) coreName = cleanTrendsDisplayName_(raw);

  const alias = String(searchAlias || '').trim();
  if (alias && normalizeTrendsTermKey_(alias) !== normalizeTrendsTermKey_(coreName)) {
    return {
      query: coreName + ' + ' + alias,
      status: TRENDS_QUERY_STATUS_.AUTO
    };
  }

  const hadVersionHint = TRENDS_VERSION_HINT_RE_.test(raw);

  const aliasCandidates = [];
  let needsReview = hadVersionHint || TRENDS_FRANCHISE_REVIEW_RE_.test(raw);

  const colonIdx = working.indexOf(':');
  if (colonIdx > 0 && colonIdx < working.length - 1) {
    const mainPart = working.slice(0, colonIdx).trim();
    const subtitlePart = working.slice(colonIdx + 1).trim();
    const mainClean = cleanTrendsDisplayName_(mainPart);
    const subClean = cleanTrendsDisplayName_(subtitlePart);
    coreName = cleanTrendsDisplayName_(mainClean + ' ' + subClean);

    const mainAliasBlocked = isTrendsMainTitleAliasBlocked_(mainClean, mainPart);
    const hasFranchiseAbbrevRule = TRENDS_FRANCHISE_ABBREV_RULES_.some(rule => rule.match.test(mainPart));

    if (mainAliasBlocked) needsReview = true;

    TRENDS_FRANCHISE_ABBREV_RULES_.forEach(rule => {
      if (rule.match.test(mainPart) && subClean) {
        aliasCandidates.push({
          text: rule.abbrev + ' ' + subClean,
          kind: 'franchise',
          priority: 3
        });
        needsReview = true;
      }
    });

    if (!mainAliasBlocked && isReasonableTrendsShortMainAlias_(mainClean, coreName, mainPart)) {
      aliasCandidates.push({text: mainClean, kind: 'shortMain', priority: 2});
    } else if ((!mainAliasBlocked || hasFranchiseAbbrevRule) && isReasonableTrendsSubtitleAlias_(subClean, coreName)) {
      aliasCandidates.push({text: subClean, kind: 'subtitle', priority: 2});
    } else if (mainAliasBlocked && !hasFranchiseAbbrevRule) {
      needsReview = true;
    }
  }

  if (!coreName) coreName = cleanTrendsDisplayName_(raw);
  if (coreName.length > 42 || raw.length > 48) needsReview = true;

  const terms = [coreName];
  aliasCandidates
    .sort((a, b) => a.priority - b.priority)
    .forEach(item => {
      if (terms.length >= 3) return;
      const text = String(item.text || '').trim();
      if (!text) return;
      const key = normalizeTrendsTermKey_(text);
      if (terms.some(t => normalizeTrendsTermKey_(t) === key)) return;
      terms.push(text);
    });

  if (terms.length >= 3) needsReview = true;

  return {
    query: terms.join(' + '),
    status: needsReview ? TRENDS_QUERY_STATUS_.REVIEW : TRENDS_QUERY_STATUS_.AUTO
  };
}

/**
 * 清理 Trends 展示用词：保留字母数字与空格，去掉搜索无意义标点。
 * @param {string} text
 * @return {string}
 */
function stripTrendsNoise_(text) {
  return String(text || '')
    .replace(/[™®©]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[''\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTrendsDisplayName_(text) {
  return stripTrendsNoise_(text)
    .replace(/[\u2010-\u2015]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 主标题是否禁止生成 alias（单词级默认禁止；大型 IP 禁止单独 alias）。
 * @param {string} mainClean
 * @param {string} mainPart
 * @return {boolean}
 */
function isTrendsMainTitleAliasBlocked_(mainClean, mainPart) {
  const words = String(mainClean || '').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.length === 1) return true;

  const probe = String(mainPart || mainClean || '');
  if (TRENDS_FRANCHISE_MAIN_ALIAS_BLOCK_RE_.test(probe)) return true;
  if (TRENDS_FRANCHISE_MAIN_ALIAS_BLOCK_RE_.test(mainClean)) return true;
  return false;
}

/**
 * 主标题 alias 是否命中白名单（如 Agent 64）。
 * @param {string} mainClean
 * @return {boolean}
 */
function isTrendsShortMainAliasWhitelisted_(mainClean) {
  return TRENDS_SHORT_MAIN_ALIAS_WHITELIST_RES_.some(re => re.test(String(mainClean || '').trim()));
}

/**
 * @param {string} text
 * @return {string}
 */
function normalizeTrendsTermKey_(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * 主标题简称：仅当冒号前较短且能作为 Core Name 前缀时采用。
 * @param {string} mainClean
 * @param {string} coreName
 * @return {boolean}
 */
function isReasonableTrendsShortMainAlias_(mainClean, coreName, mainPart) {
  if (!mainClean || !coreName || mainClean === coreName) return false;

  const words = mainClean.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2) return false;
  if (mainClean.length < 2 || mainClean.length > 18) return false;

  if (words.length === 1) {
    if (!isTrendsShortMainAliasWhitelisted_(mainClean)) return false;
  } else if (isTrendsMainTitleAliasBlocked_(mainClean, mainPart)) {
    if (!isTrendsShortMainAliasWhitelisted_(mainClean)) return false;
  }

  const coreKey = normalizeTrendsTermKey_(coreName);
  const mainKey = normalizeTrendsTermKey_(mainClean);
  return coreKey.indexOf(mainKey) === 0;
}

/**
 * 副标题 alias：仅当主标题不够短、且副标题在 Core Name 中足够明确时采用。
 * @param {string} subClean
 * @param {string} coreName
 * @return {boolean}
 */
function isReasonableTrendsSubtitleAlias_(subClean, coreName) {
  if (!subClean || !coreName || subClean === coreName) return false;
  if (subClean.length < 8) return false;
  if (subClean.split(/\s+/).length < 2) return false;
  const coreKey = normalizeTrendsTermKey_(coreName);
  const subKey = normalizeTrendsTermKey_(subClean);
  return coreKey.indexOf(subKey) >= 0;
}

/**
 * 生成 Google Trends Explore 链接；保留 ` + ` OR 语义，仅对每段别名做 URL encode。
 * @param {string} query
 * @return {string}
 */
function buildGoogleTrendsExploreUrl_(query) {
  const q = String(query || '').trim();
  if (!q) return '';

  const parts = q.split(/\s+\+\s+/).map(p => p.trim()).filter(Boolean);
  const encodedQuery = parts.map(p => encodeURIComponent(p)).join('%20%2B%20');

  const params = ['q=' + encodedQuery];
  if (HOTWORD_V2.trendsExplore.date) {
    params.push('date=' + encodeURIComponent(HOTWORD_V2.trendsExplore.date));
  }
  if (HOTWORD_V2.trendsExplore.geo !== undefined && HOTWORD_V2.trendsExplore.geo !== null) {
    params.push('geo=' + encodeURIComponent(HOTWORD_V2.trendsExplore.geo));
  }

  return 'https://trends.google.com/trends/explore?' + params.join('&');
}

function normalizeDecisionStatus_(value) {
  const status = String(value || '').trim().toUpperCase();
  return ['WATCH', 'BUILD', 'REJECT'].indexOf(status) >= 0 ? status : '';
}

function isStrongWatchType_(type) {
  return type === '🔥 趋势候选' || type === '🌱 Early候选' ||
    type === '🟡 Trend Watch' || type === '🟢 Early Watch';
}

function addDays_(date, days) {
  const out = new Date(date.getTime());
  out.setDate(out.getDate() + Number(days || 0));
  return out;
}

function dateAtStart_(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function hasCompletedManualResearchValue_(value) {
  const text = String(value == null ? '' : value).trim();
  return !!text && text !== '未检查';
}

function candidateExternalSignalIsNew_(decision) {
  if (!decision || !String(decision.externalSignal || '').trim()) return false;
  const signalDate = dateAtStart_(decision.trendLastChecked);
  const lastCheckedDate = dateAtStart_(decision.lastCheckedDate);
  return !!signalDate && (!lastCheckedDate || signalDate.getTime() > lastCheckedDate.getTime());
}

function candidateGainGrowthReached_(rec, decision, rules) {
  if (!rec || !decision) return false;
  const currentGain = Number(rec.gain7d);
  const previousGain = Number(decision.lastGain);
  const hasPreviousGain = decision.lastGain !== '' && decision.lastGain !== null && decision.lastGain !== undefined;
  if (!hasPreviousGain || previousGain < 0 || !isFiniteNumber_(previousGain) || !isFiniteNumber_(currentGain)) return false;
  const minGrowth = Number(rules && rules.RECHECK_GAIN_GROWTH_MIN);
  if (!isFiniteNumber_(minGrowth)) return false;
  return previousGain === 0
    ? currentGain > 0
    : currentGain >= previousGain * (1 + minGrowth);
}

function candidateWatchRecheckGate_(rec, decision, today, rules) {
  const todayStart = dateAtStart_(today) || dateAtStart_(new Date());
  const due = dateAtStart_(decision && decision.nextRecheckDate);
  const dueNow = !!due && due.getTime() <= todayStart.getTime();
  const gainGrowth = candidateGainGrowthReached_(rec, decision, rules);
  const externalSignal = candidateExternalSignalIsNew_(decision);
  return {
    due: dueNow,
    gainGrowth,
    externalSignal,
    allowed: gainGrowth || externalSignal,
    reason: gainGrowth ? 'GAIN_GROWTH' : externalSignal ? 'NEW_EXTERNAL_SIGNAL' : 'WATCH_CONTINUE_NO_NEW_SIGNAL'
  };
}

function candidateManualEvidenceNextAction_(rec, decision, allowWeakTrendRecheck) {
  if (machineResearchPending_(decision)) return 'Automatic Preflight';
  if (machineResearchFailed_(decision)) return 'Automatic Preflight';
  const trends = String(decision && decision.trendsResult || '').trim();
  const trendsDone = hasCompletedManualResearchValue_(trends);
  if (!trendsDone) return 'Google Trends';
  if (!normalizeDecisionStatus_(decision && decision.status)) return 'Decision';
  const trendWeak = trends === '弱' || trends === '无';
  if (trendWeak && !allowWeakTrendRecheck) return 'Recheck';
  return 'Recheck';
}

function candidateManualEvidenceNeedsNoProvider_(rec, decision, allowWeakTrendRecheck) {
  if (machineResearchPending_(decision) || machineResearchFailed_(decision)) return false;
  const trendsDone = hasCompletedManualResearchValue_(decision && decision.trendsResult);
  if (!trendsDone) return false;
  const nextAction = candidateManualEvidenceNextAction_(rec, decision, allowWeakTrendRecheck);
  return nextAction === 'Recheck' && !normalizeDecisionStatus_(decision && decision.status);
}

function isTodayActionP2Type_(type) {
  return type === '🟡 Trend Watch' || type === '🟢 Early Watch';
}

function hasNoManualResearchHistory_(decision) {
  if (!decision) return true;
  return !hasCompletedManualResearchValue_(decision.trendsResult) &&
    !hasCompletedManualResearchValue_(decision.socialResult) &&
    !hasCompletedManualResearchValue_(decision.serpCompetition) &&
    !hasCompletedManualResearchValue_(decision.keywordOpportunity);
}

function isDirectP2TodayActionSample_(rec, decision) {
  return !!rec && isTodayActionP2Type_(rec.firstRoundType) &&
    rec.continueNext === '是' && rec.nextAction === 'Google Trends' &&
    !normalizeDecisionStatus_(decision && decision.status) &&
    hasNoManualResearchHistory_(decision);
}

function decideTodayAction_(rec, decision, today, rules) {
  if (rec.continueNext !== '是') return {include: false};
  // P2 Watch rows are deliberate first-pass manual samples. They may not yet
  // have a Candidate Decision row or preflight verdict, so the master-row
  // Google Trends gate must be evaluated before the preflight gate.
  if (isDirectP2TodayActionSample_(rec, decision)) {
    return {include: true, type: 'NEW', reason: 'P2首次进入人工采样，尚无人工研究记录', humanAction: '检查 Google Trends'};
  }
  // Standalone legacy function tests evaluate this function without the
  // surrounding Apps Script constants; retain their preflight-neutral mode.
  const preflightEnabled = typeof STEAM_PREFLIGHT_ENABLED === 'undefined' ? false : STEAM_PREFLIGHT_ENABLED;
  if (preflightEnabled) {
    const preflightVerdict = String(decision && decision.preflightVerdict || '').trim().toUpperCase();
    if (preflightVerdict === 'AUTO_REJECT' || preflightVerdict === 'PREFLIGHT_ERROR' ||
        preflightVerdict === 'PENDING' || !preflightVerdict) return {include: false};
    if (preflightVerdict !== 'MANUAL_REVIEW' && preflightVerdict !== 'WATCH') return {include: false};
    if (preflightVerdict === 'WATCH') {
      const preflightDue = dateAtStart_(decision && decision.nextRecheckDate);
      const todayStartForPreflight = dateAtStart_(today) || dateAtStart_(new Date());
      if (!preflightDue || preflightDue.getTime() > todayStartForPreflight.getTime()) return {include: false};
      const preflightGate = candidateWatchRecheckGate_(rec, decision, today, rules);
      if (!preflightGate.allowed) return {include: false};
    }
  }
  const status = normalizeDecisionStatus_(decision && decision.status);
  if (!status) {
    const isManualReview = String(decision && decision.preflightVerdict || '').trim().toUpperCase() === 'MANUAL_REVIEW';
    if (machineResearchPending_(decision)) {
      return {include: true, type: 'RESEARCHING', reason: '机器研究进行中', humanAction: '机器研究中'};
    }
    if (machineResearchFailed_(decision)) {
      return {include: true, type: 'RESEARCHING', reason: '机器研究失败', humanAction: '机器研究失败，待复查'};
    }
    if (!isManualReview && candidateManualEvidenceNeedsNoProvider_(rec, decision, candidateExternalSignalIsNew_(decision))) return {include: false};
    const manualEvidenceAction = candidateManualEvidenceNextAction_(rec, decision, candidateExternalSignalIsNew_(decision));
    if (manualEvidenceAction === 'Recheck') return {include: false};
    if (machineResearchComplete_(decision) || (decision && (decision.researchStatus === '研究中' || decision.researchStatus === '已完成'))) {
      const humanAction = candidateInboxHumanAction_(rec, decision);
      return {
        include: true,
        type: machineResearchComplete_(decision) ? 'RESEARCHING' : 'RESEARCHING',
        reason: machineResearchComplete_(decision) ? '机器研究完成，等待人工决定' : '人工研究尚未完成',
        humanAction: humanAction || '继续完成研究'
      };
    }
    if (isManualReview && hasCompletedManualResearchValue_(decision && decision.trendsResult)) {
      return {include: true, type: 'RESEARCHING', reason: 'Preflight要求人工继续研究', humanAction: candidateInboxHumanAction_(rec, decision)};
    }
    return {include: true, type: 'NEW', reason: '首次进入1B，尚无人工复查记录', humanAction: '检查 Google Trends'};
  }
  if (status === 'BUILD' || status === 'REJECT') return {include: false};

  const todayStart = dateAtStart_(today) || dateAtStart_(new Date());
  const due = dateAtStart_(decision.nextRecheckDate);
  if (due && due.getTime() <= todayStart.getTime()) {
    const watchGate = candidateWatchRecheckGate_(rec, decision, today, rules);
    if (!watchGate.allowed) return {include: false};
    const humanAction = candidateManualEvidenceNextAction_(rec, decision, true);
    if (humanAction === 'Recheck') return {include: false};
    return {
      include: true,
      type: watchGate.gainGrowth ? 'GAIN_GROWTH' : 'EXTERNAL_SIGNAL',
      reason: watchGate.gainGrowth ? '当前7d Gain较上次检查增长≥30%' : '存在新的 ExternalSignal',
      humanAction
    };
  }
  const earlyGainGrowth = candidateGainGrowthReached_(rec, decision, rules);
  const earlyExternalSignal = candidateExternalSignalIsNew_(decision);
  if (earlyGainGrowth || earlyExternalSignal) {
    const humanAction = candidateManualEvidenceNextAction_(rec, decision, true);
    if (humanAction !== 'Recheck') {
      return {
        include: true,
        type: earlyGainGrowth ? 'GAIN_GROWTH' : 'EXTERNAL_SIGNAL',
        reason: earlyGainGrowth ? '当前7d Gain较上次检查增长≥30%' : '存在新的 ExternalSignal',
        humanAction
      };
    }
  }
  if (candidateManualEvidenceNeedsNoProvider_(rec, decision, candidateExternalSignalIsNew_(decision))) {
    return {include: false};
  }
  return {include: false};
}

function isUnfinishedResearchValue_(value) {
  const text = String(value || '').trim();
  return !text || text === '未检查';
}

function deriveResearchStatus_(decision) {
  const status = normalizeDecisionStatus_(decision && decision.status);
  if (status) return '已完成';
  if (machineResearchPending_(decision)) return '研究中';
  if (machineResearchComplete_(decision)) {
    return hasCompletedManualResearchValue_(decision && decision.trendsResult) ? '研究中' : '待研究';
  }
  const fields = [decision && decision.trendsResult];
  return fields.every(isUnfinishedResearchValue_) ? '待研究' : '研究中';
}

function deriveResearchCompletion_(decision) {
  const status = deriveResearchStatus_(decision);
  return status === '已完成' ? '已完成' : status === '研究中' ? '进行中' : '未开始';
}

function deriveHumanAction_(rec, decision, isWatchRecheck) {
  if (isWatchRecheck) return '重新验证趋势变化';
  const inboxAction = candidateInboxHumanAction_(rec, decision);
  if (inboxAction) return inboxAction;
  const action = candidateManualEvidenceNextAction_(rec, decision, candidateExternalSignalIsNew_(decision));
  if (action === 'Google Trends') return '检查 Google Trends';
  if (action === 'Decision') return '选择 BUILD / WATCH / REJECT';
  return '继续验证';
}

function findMasterRecord_(ss, appId) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HOTWORD_V2.masterHeaders.length).getValues();
  return rows.find(row => String(row[1] || '').trim() === String(appId).trim()) || null;
}

function isSiteIdContractValue_(value) {
  const siteId = String(value || '').trim();
  return !!siteId && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteId);
}

function discoveryIdentifierFromGameName_(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').replace(/-+/g, '-') || '';
}

/**
 * Steam Candidate discovery/opportunity identifier.
 * This is not a canonical site identity and must not be used as site_id,
 * repoPath, githubRepo, or projectSlug downstream.
 * Steam App ID is the runtime key that decides whether this value is created
 * or reused. The fixed 001 sequence is not a run counter.
 */
function opportunityIdFromSteamCandidate_(gameName, appId) {
  const normalizedAppId = String(appId || '').trim();
  const gameId = discoveryIdentifierFromGameName_(gameName);
  if (!normalizedAppId || !gameId) return '';
  return 'opp-' + gameId + '-steam-candidate-001';
}

function inspectSitePoolSiteIds_(sheet) {
  const result = {rows: 0, missing: 0, duplicate: 0, invalid: 0};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const lastColumn = Math.max(sheet.getLastColumn(), HOTWORD_V2.sitePoolHeaders.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const siteIdColumn = headers.indexOf('Site ID');
  if (siteIdColumn < 0) return result;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastColumn).getValues();
  const seen = new Set();
  result.rows = rows.length;
  rows.forEach(row => {
    const siteId = String(row[siteIdColumn] || '').trim();
    if (!siteId) {
      result.missing++;
      return;
    }
    if (!isSiteIdContractValue_(siteId)) result.invalid++;
    if (seen.has(siteId)) result.duplicate++;
    seen.add(siteId);
  });
  return result;
}

function logSitePoolIdentityIssue_(message) {
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(message);
}

function upsertSitePoolRecord_(ss, gameName, appId, buildDate, siteFacts) {
  const sheet = ensureSitePoolSchema_(ss);
  // Site Pool rows are runtime references; the canonical site_id is supplied
  // by the identity handoff or retained from the existing Steam App ID row.
  const facts = siteFacts || {};
  const suppliedSiteId = typeof facts === 'object' ? String(facts.siteId || facts.site_id || '').trim() : '';
  const normalizedAppId = String(appId || '').trim();
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, HOTWORD_V2.sitePoolHeaders.length).getValues();
  const existingByAppId = values.find(row => String(row[2] || '').trim() === normalizedAppId);
  const siteId = suppliedSiteId || String(existingByAppId?.[0] || '').trim();
  const opportunityId = typeof facts === 'string' ? facts.trim() : String(facts.opportunityId || '').trim();
  const experimentType = typeof facts === 'string' ? '' : ['PROBE', 'FORMAL'].indexOf(String(facts.experimentType || '').trim().toUpperCase()) >= 0
    ? String(facts.experimentType).trim().toUpperCase() : '';
  const actualLiveAt = typeof facts === 'string' ? '' : facts.actualLiveAt || '';
  const launchPageCount = typeof facts === 'string' ? '' : facts.launchPageCount === undefined ? '' : facts.launchPageCount;
  if (!isSiteIdContractValue_(siteId) || !normalizedAppId) {
    logSitePoolIdentityIssue_('Site Pool upsert skipped: Site ID and Steam App ID are required.');
    return null;
  }
  const appIdIndex = values.findIndex(row => String(row[2] || '').trim() === normalizedAppId);
  const siteIdIndex = values.findIndex(row => String(row[0] || '').trim() === siteId);
  let index = appIdIndex;
  if (index < 0 && siteIdIndex >= 0) {
    const existingAppId = String(values[siteIdIndex][2] || '').trim();
    if (existingAppId && existingAppId !== normalizedAppId) {
      logSitePoolIdentityIssue_('Site ID collision skipped: ' + siteId + ' is already linked to Steam App ID ' + existingAppId + '.');
      return null;
    }
    index = siteIdIndex;
  }
  if (appIdIndex >= 0 && !String(values[appIdIndex][0] || '').trim() && siteIdIndex >= 0 && siteIdIndex !== appIdIndex) {
    const existingAppId = String(values[siteIdIndex][2] || '').trim();
    if (existingAppId && existingAppId !== normalizedAppId) {
      logSitePoolIdentityIssue_('Site ID collision skipped: ' + siteId + ' is already linked to Steam App ID ' + existingAppId + '.');
      return null;
    }
  }
  if (index >= 0) {
    const existing = values[index];
    const row = [existing[0] || siteId, existing[1] || gameName, existing[2] || normalizedAppId, existing[3] || 'BUILD_PENDING', existing[4] || buildDate,
      existing[5] || 'BUILD_PENDING', existing[6] || '', existing[7] || '', existing[8] || '', existing[9] || '', existing[10] || 'NOT_CONNECTED',
      existing[11] || '', existing[12] || '', existing[13] || '', existing[14] || 'WAITING_INDEX', existing[15] || 'UNKNOWN', existing[16] || '',
      existing[17] || '', existing[18] || '', existing[19] || '', existing[20] || '', existing[21] || opportunityId,
      existing[22] || experimentType, existing[23] || actualLiveAt, existing[24] === '' || existing[24] === null || existing[24] === undefined ? launchPageCount : existing[24]];
    sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
    upsertGscBindingRecord_(ss, row[0], row[1], row[2], row[7]);
    return row;
  }
  const row = [siteId, gameName, normalizedAppId, 'BUILD_PENDING', buildDate, 'BUILD_PENDING', '', '', '', '', 'NOT_CONNECTED', '', '', '', 'WAITING_INDEX', 'UNKNOWN', '', '', '', '', '', opportunityId, experimentType, actualLiveAt, launchPageCount];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  upsertGscBindingRecord_(ss, row[0], row[1], row[2], row[7]);
  return row;
}

function upsertGscBindingRecord_(ss, siteId, gameName, appId, websiteUrl) {
  const sheet = ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.gscBinding, HOTWORD_V2.gscBindingHeaders);
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, HOTWORD_V2.gscBindingHeaders.length).getValues();
  const index = values.findIndex(row => String(row[0] || '').trim() === String(siteId || '').trim());
  if (index >= 0) {
    const existing = values[index];
    const row = [existing[0] || siteId, existing[1] || gameName, existing[2] || String(appId), existing[3] || websiteUrl || '',
      existing[4] || '', existing[5] || 'NOT_CONNECTED', existing[6] || '', existing[7] || ''];
    sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
    return row;
  }
  const row = [siteId, gameName, String(appId), websiteUrl || '', '', 'NOT_CONNECTED', '', ''];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return row;
}

/**
 * 为历史站点项目补建缺失的「项目GSC关联」记录。
 * 只从「站点项目池」读取项目身份与 Vercel URL，不修改项目池，也不读取或写入 GSC 源表。
 * @return {{created:number, skipped:number, missingWebsiteUrl:number}}
 */
function backfillProjectGscBindings() {
  const emptyResult = {created: 0, skipped: 0, missingWebsiteUrl: 0};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const poolSheet = ss && ss.getSheetByName(HOTWORD_V2.sheets.sitePool);
  if (!poolSheet || poolSheet.getLastRow() < 2) return emptyResult;

  const bindingSheet = ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.gscBinding, HOTWORD_V2.gscBindingHeaders);
  const poolHeaders = poolSheet.getRange(1, 1, 1, Math.max(poolSheet.getLastColumn(), HOTWORD_V2.sitePoolHeaders.length)).getDisplayValues()[0];
  const bindingHeaders = bindingSheet.getRange(1, 1, 1, Math.max(bindingSheet.getLastColumn(), HOTWORD_V2.gscBindingHeaders.length)).getDisplayValues()[0];
  const poolColumn = name => poolHeaders.indexOf(name);
  const bindingColumn = name => bindingHeaders.indexOf(name);
  const requiredPoolColumns = ['Site ID', '游戏名称', 'Steam App ID', 'Vercel URL'];
  const requiredBindingColumns = ['Site ID', '游戏名称', 'Steam App ID', '网站URL', 'GSC Property', 'GSC状态', '首次同步日期', '最近同步日期'];
  if (requiredPoolColumns.some(name => poolColumn(name) < 0) || requiredBindingColumns.some(name => bindingColumn(name) < 0)) {
    return emptyResult;
  }

  const existingSiteIds = new Set();
  if (bindingSheet.getLastRow() >= 2) {
    bindingSheet.getRange(2, 1, bindingSheet.getLastRow() - 1, bindingHeaders.length).getValues().forEach(row => {
      const siteId = String(row[bindingColumn('Site ID')] || '').trim();
      if (siteId) existingSiteIds.add(siteId);
    });
  }

  const rowsToAppend = [];
  const result = emptyResult;
  const seenPoolSiteIds = new Set();
  const poolRows = poolSheet.getRange(2, 1, poolSheet.getLastRow() - 1, poolHeaders.length).getValues();
  poolRows.forEach(poolRow => {
    const siteId = String(poolRow[poolColumn('Site ID')] || '').trim();
    if (!siteId || seenPoolSiteIds.has(siteId)) return;
    seenPoolSiteIds.add(siteId);
    const websiteUrl = String(poolRow[poolColumn('Vercel URL')] || '').trim();
    if (!websiteUrl) result.missingWebsiteUrl++;
    if (existingSiteIds.has(siteId)) return;
    const row = Array(bindingHeaders.length).fill('');
    row[bindingColumn('Site ID')] = siteId;
    row[bindingColumn('游戏名称')] = poolRow[poolColumn('游戏名称')] || '';
    row[bindingColumn('Steam App ID')] = poolRow[poolColumn('Steam App ID')] || '';
    row[bindingColumn('网站URL')] = websiteUrl;
    row[bindingColumn('GSC Property')] = '';
    row[bindingColumn('GSC状态')] = 'NOT_CONNECTED';
    row[bindingColumn('首次同步日期')] = '';
    row[bindingColumn('最近同步日期')] = '';
    rowsToAppend.push(row);
    existingSiteIds.add(siteId);
  });

  if (rowsToAppend.length) {
    bindingSheet.getRange(bindingSheet.getLastRow() + 1, 1, rowsToAppend.length, bindingHeaders.length).setValues(rowsToAppend);
  }
  result.created = rowsToAppend.length;
  result.skipped = poolRows.length - rowsToAppend.length;
  return result;
}

function ensureSitePoolSchema_(ss) {
  let sheet = ss.getSheetByName(HOTWORD_V2.sheets.sitePool);
  if (!sheet) sheet = ss.insertSheet(HOTWORD_V2.sheets.sitePool);
  const desired = HOTWORD_V2.sitePoolHeaders;
  const oldLastColumn = Math.max(sheet.getLastColumn(), desired.length);
  const currentHeaders = sheet.getRange(1, 1, 1, oldLastColumn).getDisplayValues()[0];
  const sameOrder = desired.every((header, index) => currentHeaders[index] === header);
  if (!sameOrder && sheet.getLastRow() >= 1) {
    const oldValues = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, oldLastColumn).getValues() : [];
    const aliases = {
      'Vercel URL': ['站点URL'],
      Clicks: ['点击'],
      Impressions: ['曝光']
    };
    const positions = desired.map(header => {
      const direct = currentHeaders.indexOf(header);
      if (direct >= 0) return direct;
      const fallback = (aliases[header] || []).map(alias => currentHeaders.indexOf(alias)).find(index => index >= 0);
      return fallback === undefined ? -1 : fallback;
    });
    const rows = oldValues.map(row => positions.map(position => position >= 0 ? row[position] : ''));
    rows.forEach(row => {
      if (!row[3]) row[3] = 'BUILD_PENDING';
      if (!row[5]) row[5] = 'BUILD_PENDING';
      if (!row[10]) row[10] = 'NOT_CONNECTED';
      if (!row[14]) row[14] = 'WAITING_INDEX';
      if (!row[15]) row[15] = 'UNKNOWN';
    });
    sheet.getRange(1, 1, 1, desired.length).setValues([desired]);
    if (rows.length) sheet.getRange(2, 1, rows.length, desired.length).setValues(rows);
  } else {
    ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.sitePool, desired);
  }
  if (oldLastColumn > desired.length) sheet.getRange(1, desired.length + 1, sheet.getMaxRows(), oldLastColumn - desired.length).clearContent();
  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, desired.length).getValues();
    rows.forEach(row => {
      if (!row[3]) row[3] = 'BUILD_PENDING';
      if (!row[5]) row[5] = 'BUILD_PENDING';
      if (!row[10]) row[10] = 'NOT_CONNECTED';
      if (!row[14]) row[14] = 'WAITING_INDEX';
      if (!row[15]) row[15] = 'UNKNOWN';
    });
    sheet.getRange(2, 1, rows.length, desired.length).setValues(rows);
  }
  return sheet;
}

function setupSitePoolUi_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.sitePool);
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, HOTWORD_V2.sitePoolHeaders.length).getDisplayValues()[0];
  const validate = (name, values) => {
    const col = headers.indexOf(name) + 1;
    if (col > 0) sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build());
  };
  validate('Build状态', ['BUILD_PENDING', 'BUILDING', 'LIVE', 'FAILED']);
  validate('ExperimentType', ['PROBE', 'FORMAL']);
  validate('GSC状态', ['NOT_CONNECTED', 'CONNECTED']);
  validate('SEO阶段', ['WAITING_INDEX', 'INDEXING', 'EARLY_DATA', 'GROWING', 'FAILED']);
  validate('Index状态', ['UNKNOWN', 'INDEXING', 'INDEXED', 'ISSUE']);
}

function setupGscBindingUi_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.gscBinding);
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, HOTWORD_V2.gscBindingHeaders.length).getDisplayValues()[0];
  const statusCol = headers.indexOf('GSC状态') + 1;
  if (statusCol > 0) sheet.getRange(2, statusCol, Math.max(sheet.getMaxRows() - 1, 1), 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['NOT_CONNECTED', 'CONNECTED'], true).setAllowInvalid(false).build());
  ['首次同步日期', '最近同步日期'].forEach(name => {
    const col = headers.indexOf(name) + 1;
    if (col > 0) sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  });
}

function emptyGscSnapshot_(siteId, status) {
  return {siteId: String(siteId || ''), clicks: 0, impressions: 0, ctr: 0, averagePosition: 0, lastSync: '', status: status || 'no_match'};
}

function findGscSnapshotColumn_(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.findIndex(header => String(header || '').trim().toLowerCase() === String(alias).toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function numberOrZero_(value) {
  const number = typeof value === 'number' ? value : Number(String(value || '').replace(/[% ,]/g, ''));
  return isFinite(number) ? number : 0;
}

function normalizeGscUrl_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/]+)(\/.*)?$/i);
  if (!match) return text;
  const path = (match[3] || '').replace(/\/+$/, '');
  return match[1].toLowerCase() + match[2].toLowerCase() + path;
}

function objectValue_(object, names) {
  if (!object) return '';
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null && String(object[name]).trim()) return object[name];
  }
  return '';
}

function gscBindingInfo_(siteOrBinding) {
  if (typeof siteOrBinding === 'string') return {siteId: String(siteOrBinding).trim(), gameName: '', websiteUrl: '', gscProperty: ''};
  return {
    siteId: String(objectValue_(siteOrBinding, ['siteId', 'Site ID']) || '').trim(),
    gameName: String(objectValue_(siteOrBinding, ['gameName', '游戏名称', 'name']) || '').trim(),
    websiteUrl: String(objectValue_(siteOrBinding, ['websiteUrl', '网站URL', 'Vercel URL', 'url']) || '').trim(),
    gscProperty: String(objectValue_(siteOrBinding, ['gscProperty', 'GSC Property', 'PropertyURL']) || '').trim()
  };
}

function gscDateValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  const text = String(value || '').trim();
  if (!text) return 0;
  const time = new Date(text).getTime();
  return isNaN(time) ? 0 : time;
}

function mapGscSnapshotRow_(headers, row, requestedSiteId, matchedSite, matchedPropertyURL) {
  const siteIndex = findGscSnapshotColumn_(headers, ['Site', 'site', '站点', '网站']);
  const propertyIndex = findGscSnapshotColumn_(headers, ['PropertyURL', 'Property URL', 'property_url', '网站URL']);
  const clicksIndex = findGscSnapshotColumn_(headers, ['Clicks', 'clicks', '点击']);
  const impressionsIndex = findGscSnapshotColumn_(headers, ['Impressions', 'impressions', '曝光']);
  const ctrIndex = findGscSnapshotColumn_(headers, ['CTR', 'ctr', '点击率']);
  const positionIndex = findGscSnapshotColumn_(headers, ['AveragePosition', 'Average Position', 'average_position', '平均排名', '平均位置']);
  const latestDataIndex = findGscSnapshotColumn_(headers, ['LatestGSCDataDate', 'GSC Last Sync', 'Last Sync', 'last_sync', '最近同步日期', '同步日期']);
  const runDateIndex = findGscSnapshotColumn_(headers, ['RunDate', 'run_date', '运行日期', 'Date', '日期']);
  const firstImpressionIndex = findGscSnapshotColumn_(headers, ['FirstImpressionDate', 'first_impression_date', '首次曝光日期']);
  const sitemapCountIndex = findGscSnapshotColumn_(headers, ['SitemapURLCount', 'sitemap_url_count', 'Sitemap URL Count']);
  const lastSync = latestDataIndex >= 0 && row[latestDataIndex] ? row[latestDataIndex] : runDateIndex >= 0 ? row[runDateIndex] || '' : '';
  const clicks = clicksIndex >= 0 ? numberOrZero_(row[clicksIndex]) : 0;
  const impressions = impressionsIndex >= 0 ? numberOrZero_(row[impressionsIndex]) : 0;
  const ctr = ctrIndex >= 0 ? numberOrZero_(row[ctrIndex]) : 0;
  const averagePosition = positionIndex >= 0 ? numberOrZero_(row[positionIndex]) : 0;
  const sitemapUrlCount = sitemapCountIndex >= 0 ? numberOrZero_(row[sitemapCountIndex]) : 0;
  return {
    siteId: String(requestedSiteId || ''), clicks, impressions, ctr, averagePosition, lastSync,
    sitemapUrlCount,
    status: clicks || impressions || ctr || averagePosition ? 'ok' : 'valid_zero',
    matchedSite: matchedSite || (siteIndex >= 0 ? row[siteIndex] || '' : ''),
    matchedPropertyURL: matchedPropertyURL || (propertyIndex >= 0 ? row[propertyIndex] || '' : ''),
    runDate: runDateIndex >= 0 ? row[runDateIndex] || '' : '',
    firstImpressionDate: firstImpressionIndex >= 0 ? row[firstImpressionIndex] || '' : ''
  };
}

/**
 * GSC 数据读取准备层。只读独立 GSC Spreadsheet 的「每日快照」，不调用 API、不写入任何 Sheet。
 * @param {string|Object} siteOrBinding Site ID 或「项目GSC关联」记录
 * @return {{siteId:string, clicks:number, impressions:number, ctr:number, averagePosition:number, lastSync:*}}
 */
function loadGscSnapshot(siteOrBinding) {
  const binding = gscBindingInfo_(siteOrBinding);
  const empty = emptyGscSnapshot_(binding.siteId);
  if (!binding.siteId) return empty;

  let sheet;
  try {
    const sourceSpreadsheet = SpreadsheetApp.openById(HOTWORD_V2.GSC_SOURCE_SPREADSHEET_ID);
    sheet = sourceSpreadsheet && sourceSpreadsheet.getSheetByName(HOTWORD_V2.GSC_SOURCE_SHEET_NAME);
  } catch (error) {
    return emptyGscSnapshot_(binding.siteId, 'source_error');
  }
  if (!sheet) return emptyGscSnapshot_(binding.siteId, 'source_error');

  let values;
  try {
    values = sheet.getDataRange().getValues();
  } catch (error) {
    return emptyGscSnapshot_(binding.siteId, 'source_error');
  }
  if (!values || values.length < 2) return emptyGscSnapshot_(binding.siteId, 'no_match');
  const headers = values[0].map(value => String(value || '').trim());
  const siteIndex = findGscSnapshotColumn_(headers, ['Site', 'site', '站点', '网站']);
  const propertyIndex = findGscSnapshotColumn_(headers, ['PropertyURL', 'Property URL', 'property_url', '网站URL']);
  if (siteIndex < 0 || propertyIndex < 0) return emptyGscSnapshot_(binding.siteId, 'source_error');
  const rows = values.slice(1).filter(row => row.some(value => String(value || '').trim()));
  const property = normalizeGscUrl_(binding.gscProperty);
  const website = normalizeGscUrl_(binding.websiteUrl);
  const gameName = binding.gameName;
  const byProperty = property
    ? rows.filter(row => normalizeGscUrl_(row[propertyIndex]) === property)
    : [];
  const byWebsite = website
    ? rows.filter(row => normalizeGscUrl_(row[propertyIndex]) === website)
    : [];
  const byName = gameName
    ? rows.filter(row => String(row[siteIndex] || '').trim() === gameName)
    : [];
  const candidates = byProperty.length ? byProperty : byWebsite.length ? byWebsite : byName;
  if (!candidates.length) return emptyGscSnapshot_(binding.siteId, 'no_match');

  const distinctProperties = new Set(candidates.map(row => normalizeGscUrl_(row[propertyIndex])));
  if (distinctProperties.size > 1) {
    const ambiguous = emptyGscSnapshot_(binding.siteId, 'ambiguous');
    ambiguous.matchedPropertyURL = Array.from(distinctProperties).join(' | ');
    return ambiguous;
  }
  const latestDataIndex = findGscSnapshotColumn_(headers, ['LatestGSCDataDate']);
  const runDateIndex = findGscSnapshotColumn_(headers, ['RunDate']);
  const sorted = candidates.slice().sort((left, right) => {
    const latestDiff = (latestDataIndex >= 0 ? gscDateValue_(right[latestDataIndex]) : 0) - (latestDataIndex >= 0 ? gscDateValue_(left[latestDataIndex]) : 0);
    if (latestDiff) return latestDiff;
    return (runDateIndex >= 0 ? gscDateValue_(right[runDateIndex]) : 0) - (runDateIndex >= 0 ? gscDateValue_(left[runDateIndex]) : 0);
  });
  const selected = sorted[0];
  return mapGscSnapshotRow_(headers, selected, binding.siteId, selected[siteIndex], selected[propertyIndex]);
}

/**
 * Apps Script 编辑器人工运行的真实 GSC 只读验收入口。
 * 只读取当前 Steam Spreadsheet 的「项目GSC关联」，不写入任何 Sheet。
 * @return {Object|null} loadGscSnapshot 的结果，未找到绑定时返回 null
 */
function debugRealGscReadAcceptance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss && ss.getSheetByName(HOTWORD_V2.sheets.gscBinding);
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
    Logger.log('NO_ELIGIBLE_GSC_BINDING');
    return null;
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const column = name => headers.indexOf(name);
  const siteColumn = column('Site ID');
  const gameColumn = column('游戏名称');
  const websiteColumn = column('网站URL');
  const propertyColumn = column('GSC Property');
  if ([siteColumn, gameColumn, websiteColumn, propertyColumn].some(index => index < 0)) {
    Logger.log('NO_ELIGIBLE_GSC_BINDING');
    return null;
  }
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  const selected = rows.find(row => [siteColumn, websiteColumn, propertyColumn].every(index => String(row[index] || '').trim()));
  if (!selected) {
    Logger.log('NO_ELIGIBLE_GSC_BINDING');
    return null;
  }
  const binding = {
    siteId: String(selected[siteColumn]).trim(),
    gameName: String(selected[gameColumn] || '').trim(),
    websiteUrl: String(selected[websiteColumn]).trim(),
    gscProperty: String(selected[propertyColumn]).trim()
  };
  Logger.log('TEST_BINDING\n' + JSON.stringify(binding));
  const result = loadGscSnapshot(binding);
  Logger.log('GSC_RESULT\n' + JSON.stringify(result));
  const status = String(result && result.status || 'source_error').toLowerCase();
  if (status === 'ok' || status === 'valid_zero') Logger.log('REAL_GSC_READ_ACCEPTANCE: PASS');
  else Logger.log('REAL_GSC_READ_ACCEPTANCE: ' + status.toUpperCase());
  return result;
}

/**
 * 根据当前快照与项目池中上一周期的指标推导 SEO 阶段。
 * FAILED 是人工保留状态，不会被自动阶段覆盖。
 * @param {Object} snapshot
 * @param {Object} previous
 * @return {string}
 */
function calculateSeoStage(snapshot, previous) {
  const oldStage = String(previous && (previous.seoStage || previous['SEO阶段']) || '').trim();
  if (oldStage === 'FAILED') return 'FAILED';

  const impressions = numberOrZero_(snapshot && snapshot.impressions);
  const clicks = numberOrZero_(snapshot && snapshot.clicks);
  if (impressions <= 0) return 'WAITING_INDEX';
  if (clicks <= 0) return 'INDEXING';

  const previousImpressions = numberOrZero_(previous && (previous.impressions || previous['Impressions']));
  const previousClicks = numberOrZero_(previous && (previous.clicks || previous['Clicks']));
  const hasPrevious = previous && (previousImpressions > 0 || previousClicks > 0);
  if (hasPrevious && (impressions > previousImpressions || clicks > previousClicks)) return 'GROWING';
  return 'EARLY_DATA';
}

/**
 * 将既有 GSC 监控快照同步到站点项目池。
 * 只更新 GSC 指标与自动 SEO 阶段，不触碰项目身份、URL 和 GSC Property。
 * @return {{updated:number, skipped:number, missingProjects:number}}
 */
function syncProjectPoolGsc() {
  const emptyResult = {updated: 0, validZero: 0, noMatch: 0, ambiguous: 0, sourceError: 0, skipped: 0};
  const ss = SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const bindingSheet = ss && ss.getSheetByName(HOTWORD_V2.sheets.gscBinding);
  const poolSheet = ss && ensureSitePoolSchema_(ss);
  if (!bindingSheet || !poolSheet || bindingSheet.getLastRow() < 2 || poolSheet.getLastRow() < 2) {
    return emptyResult;
  }

  const bindingHeaders = bindingSheet.getRange(1, 1, 1, Math.max(bindingSheet.getLastColumn(), HOTWORD_V2.gscBindingHeaders.length)).getDisplayValues()[0];
  const bindingSiteColumn = bindingHeaders.indexOf('Site ID');
  if (bindingSiteColumn < 0) return emptyResult;

  const poolHeaders = poolSheet.getRange(1, 1, 1, HOTWORD_V2.sitePoolHeaders.length).getDisplayValues()[0];
  const poolColumn = name => poolHeaders.indexOf(name);
  const requiredColumns = ['Site ID', 'GSC Last Sync', 'Clicks', 'Impressions', 'CTR', 'Average Position', 'SEO阶段', 'LaunchPageCount'];
  if (requiredColumns.some(name => poolColumn(name) < 0)) return emptyResult;

  const bindings = bindingSheet.getRange(2, 1, bindingSheet.getLastRow() - 1, bindingHeaders.length).getValues();
  const poolRows = poolSheet.getRange(2, 1, poolSheet.getLastRow() - 1, HOTWORD_V2.sitePoolHeaders.length).getValues();
  const poolBySiteId = new Map();
  poolRows.forEach((row, index) => {
    const siteId = String(row[poolColumn('Site ID')] || '').trim();
    if (siteId && !poolBySiteId.has(siteId)) poolBySiteId.set(siteId, index);
  });

  const writeColumns = ['GSC Last Sync', 'Clicks', 'Impressions', 'CTR', 'Average Position'];
  const result = emptyResult;
  bindings.forEach(binding => {
    const siteId = String(binding[bindingSiteColumn] || '').trim();
    if (!siteId) return;
    const poolIndex = poolBySiteId.get(siteId);
    if (poolIndex === undefined) {
      result.skipped++;
      return;
    }

    const snapshot = loadGscSnapshot({
      siteId: siteId,
      '游戏名称': binding[bindingHeaders.indexOf('游戏名称')],
      '网站URL': binding[bindingHeaders.indexOf('网站URL')],
      'GSC Property': binding[bindingHeaders.indexOf('GSC Property')]
    });
    const status = snapshot && snapshot.status;
    if (status !== 'ok' && status !== 'valid_zero') {
      if (status === 'no_match') result.noMatch++;
      else if (status === 'ambiguous') result.ambiguous++;
      else result.sourceError++;
      result.skipped++;
      return;
    }
    if (status === 'valid_zero') result.validZero++;

    const previous = {
      seoStage: poolRows[poolIndex][poolColumn('SEO阶段')],
      clicks: poolRows[poolIndex][poolColumn('Clicks')],
      impressions: poolRows[poolIndex][poolColumn('Impressions')]
    };
    const rowNumber = poolIndex + 2;
    writeColumns.forEach(name => {
      const value = name === 'GSC Last Sync' ? snapshot.lastSync : snapshot[name === 'Average Position' ? 'averagePosition' : name.toLowerCase()];
      if (name !== 'GSC Last Sync' || snapshot.lastSync) {
        poolSheet.getRange(rowNumber, poolColumn(name) + 1).setValue(value === undefined ? 0 : value);
      }
    });
    const launchPageColumn = poolColumn('LaunchPageCount');
    const currentLaunchPageCount = numberOrZero_(poolRows[poolIndex][launchPageColumn]);
    const inventoryPageCount = numberOrZero_(snapshot.sitemapUrlCount);
    if (inventoryPageCount > 0 && inventoryPageCount !== currentLaunchPageCount) {
      poolSheet.getRange(rowNumber, launchPageColumn + 1).setValue(inventoryPageCount);
      poolRows[poolIndex][launchPageColumn] = inventoryPageCount;
    }
    const seoColumn = poolColumn('SEO阶段');
    if (String(previous.seoStage || '').trim() !== 'FAILED') {
      poolSheet.getRange(rowNumber, seoColumn + 1).setValue(calculateSeoStage(snapshot, previous));
    }
    result.updated++;
  });
  return result;
}

/** Read-only helper for remote verification of site-pool GSC sync fields. */
function inspectSitePoolGsc(siteId) {
  siteId = String(siteId || '').trim();
  if (!siteId) throw new Error('inspectSitePoolGsc: siteId required');
  const ss = SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const poolSheet = ss && ensureSitePoolSchema_(ss);
  if (!poolSheet || poolSheet.getLastRow() < 2) {
    return { siteId: siteId, found: false };
  }
  const poolHeaders = poolSheet.getRange(1, 1, 1, HOTWORD_V2.sitePoolHeaders.length).getDisplayValues()[0];
  const poolColumn = name => poolHeaders.indexOf(name);
  const siteColumn = poolColumn('Site ID');
  const launchPageColumn = poolColumn('LaunchPageCount');
  if (siteColumn < 0 || launchPageColumn < 0) {
    return { siteId: siteId, found: false, error: 'site_pool_columns_missing' };
  }
  const poolRows = poolSheet.getRange(2, 1, poolSheet.getLastRow() - 1, HOTWORD_V2.sitePoolHeaders.length).getValues();
  for (let i = 0; i < poolRows.length; i++) {
    if (String(poolRows[i][siteColumn] || '').trim() !== siteId) continue;
    const snapshot = loadGscSnapshot(siteId);
    return {
      siteId: siteId,
      found: true,
      launchPageCount: numberOrZero_(poolRows[i][launchPageColumn]),
      sitemapUrlCount: numberOrZero_(snapshot && snapshot.sitemapUrlCount),
      gscLastSync: poolRows[i][poolColumn('GSC Last Sync')] || '',
      clicks: numberOrZero_(poolRows[i][poolColumn('Clicks')]),
      impressions: numberOrZero_(poolRows[i][poolColumn('Impressions')])
    };
  }
  return { siteId: siteId, found: false };
}

function readCandidateDecisions_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const out = new Map();
  if (!sheet || sheet.getLastRow() < 2) return out;
  const columnMap = candidateDecisionColumnMap_(sheet);
  sheet.getRange(2, 1, sheet.getLastRow() - 1, columnMap.width).getValues().forEach((row, index) => {
    const at = name => columnMap.byName[name] ? row[columnMap.byName[name] - 1] : '';
    const appId = String(at('Steam App ID') || '').trim();
    if (!appId) return;
    const explicitDecision = normalizeDecisionStatus_(at('Decision'));
    out.set(appId, {
      row,
      rowNumber: index + 2,
      appId,
      name: String(at('游戏名称') || ''),
      status: explicitDecision || normalizeDecisionStatus_(at('决策状态')),
      lastCheckedDate: at('上次人工检查日'),
      lastGain: at('上次检查7d Gain'),
      lastType: String(at('上次检查类型') || ''),
      nextRecheckDate: at('下次复查日'),
      note: at('决策备注') || '',
      lastCheckedStatus: normalizeDecisionStatus_(at('上次检查时决策状态')),
      firstSeen: at('首次发现日期') || '', source: at('首次来源') || '', firstType: at('第一轮类型') || '', currentStage: at('当前Steam阶段') || '',
      researchStatus: at('研究状态') || '', trendsResult: at('Google Trends结果') || '', socialResult: at('Social结果') || '', serpCompetition: at('SERP竞争') || '',
      keywordOpportunity: at('关键词机会') || '', manualNote: at('人工备注') || '', decisionDate: at('Decision日期') || '', nextAction: at('Next Action') || '',
      opportunityId: columnMap.byName['OpportunityID'] ? String(at('OpportunityID') || '').trim() : '',
      researchJobId: String(at('ResearchJobID') || '').trim(),
      autoResearchStatus: String(at('自动研究状态') || '').trim(),
      autoResearchTime: at('自动研究时间') || '',
      autoSocialSummary: at('自动Social摘要') || '',
      autoSerpSummary: at('自动SERP摘要') || '',
      autoResearchResultPath: String(at('自动研究结果路径') || '').trim(),
      autoRecommendation: String(at('自动Recommendation') || '').trim(),
      autoRecommendationConfidence: String(at('自动Recommendation置信度') || '').trim(),
      autoRecommendationReasons: String(at('自动Recommendation理由') || '').trim(),
      autoMissingEvidence: String(at('自动缺失证据') || '').trim(),
      autoRecommendationResultPath: String(at('自动Recommendation结果路径') || '').trim(),
      autoResearchError: String(at('自动研究错误') || '').trim(),
      autoBuildEvidence: String(at('自动BUILD依据') || '').trim(),
      autoBuildThesis: String(at('自动BUILD Thesis') || '').trim(),
      decisionId: String(at('DecisionID') || '').trim(),
      machineDecision: String(at('MachineDecision') || '').trim(),
      machineDecisionReason: String(at('MachineDecisionReason') || '').trim(),
      recommendedDomain: String(at('RecommendedDomain') || '').trim(),
      domainTld: String(at('DomainTLD') || '').trim(),
      domainFirstYearPrice: at('DomainFirstYearPrice') === '' ? '' : at('DomainFirstYearPrice'),
      domainRegistrar: String(at('DomainRegistrar') || '').trim(),
      domainPurchaseUrl: String(at('DomainPurchaseURL') || '').trim(),
      domainCheckedAt: at('DomainCheckedAt') || '',
      domainAlternative1: String(at('DomainAlternative1') || '').trim(),
      domainAlternative1Price: at('DomainAlternative1Price') === '' ? '' : at('DomainAlternative1Price'),
      domainAlternative1PurchaseUrl: String(at('DomainAlternative1PurchaseURL') || '').trim(),
      domainAlternative2: String(at('DomainAlternative2') || '').trim(),
      domainAlternative2Price: at('DomainAlternative2Price') === '' ? '' : at('DomainAlternative2Price'),
      domainAlternative2PurchaseUrl: String(at('DomainAlternative2PurchaseURL') || '').trim(),
      preflightVerdict: String(at('PreflightVerdict') || '').trim(),
      preflightCheckedAt: at('PreflightCheckedAt') || '',
      preflightReason: String(at('PreflightReason') || '').trim(),
      trendRelativeStrength: at('TrendRelativeStrength') === '' ? '' : at('TrendRelativeStrength'),
      trendVerdict: String(at('TrendVerdict') || '').trim(),
      trendLastChecked: at('TrendLastChecked') || '',
      externalSignal: String(at('ExternalSignal') || '').trim(),
      finalResearchStage: String(at('FinalResearchStage') || '').trim()
    });
  });
  return out;
}

function addTodayActionHandledIdentity_(index, source, appId, name, legacyNameFallback) {
  const normalizedAppId = String(appId || '').trim();
  const normalizedName = normalizeGameName_(name);
  if (isReliableSteamAppId_(normalizedAppId)) {
    index.byAppId.add(normalizedAppId);
    todayActionHandledSetAdd_(index.reasonsByAppId, normalizedAppId).add(source);
  } else if (legacyNameFallback && normalizedName) {
    index.byLegacyName.add(normalizedName);
    todayActionHandledSetAdd_(index.reasonsByLegacyName, normalizedName).add(source);
  }
}

function todayActionHandledSetAdd_(setMap, key) {
  if (!setMap.has(key)) setMap.set(key, new Set());
  return setMap.get(key);
}

function readTodayActionHandledRows_(sheet, appIdHeader, nameHeader) {
  const rows = [];
  if (!sheet || sheet.getLastRow() < 2) return rows;
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const appIdColumn = headers.indexOf(appIdHeader);
  const nameColumn = headers.indexOf(nameHeader);
  if (appIdColumn < 0 && nameColumn < 0) return rows;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    rows.push({
      appId: appIdColumn >= 0 ? row[appIdColumn] : '',
      name: nameColumn >= 0 ? row[nameColumn] : ''
    });
  });
  return rows;
}

function buildTodayActionAlreadyHandled_(ss, decisions) {
  const index = {
    byAppId: new Set(),
    byLegacyName: new Set(),
    reasonsByAppId: new Map(),
    reasonsByLegacyName: new Map()
  };
  (decisions || new Map()).forEach(decision => {
    const status = normalizeDecisionStatus_(decision && decision.status);
    if (status === 'BUILD' || status === 'WATCH' || status === 'REJECT') {
      addTodayActionHandledIdentity_(index, 'handledByDecision', decision.appId, decision.name, true);
    }
  });

  const readRows = (sheet, appIdHeader, nameHeader) => readTodayActionHandledRows_(sheet, appIdHeader, nameHeader);
  const researchSheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  const researchHeaders = researchSheet && researchSheet.getLastColumn() > 0
    ? researchSheet.getRange(1, 1, 1, researchSheet.getLastColumn()).getDisplayValues()[0] : [];
  const researchRows = readRows(researchSheet, 'AppID', 'Game');
  researchRows.forEach((row, indexNumber) => {
    const values = researchSheet.getRange(indexNumber + 2, 1, 1, researchHeaders.length).getDisplayValues()[0];
    const value = name => {
      const column = researchHeaders.indexOf(name);
      return column >= 0 ? values[column] : '';
    };
    const trendVerdict = String(value('TrendVerdict') || '').trim().toUpperCase();
    const result = trendVerdict && trendVerdict !== 'ALIAS_DISCOVERY' &&
      [value('研究结果'), value('Trends结论'), value('人工判定'), value('TrendVerdict')]
        .some(item => hasCompletedManualResearchValue_(item));
    const status = String(value('状态') || '').trim().toUpperCase();
    const completedStatus = ['COMPLETED', 'COMPLETE', 'DONE', '已完成', '完成'].indexOf(status) >= 0;
    if (result || completedStatus) {
      addTodayActionHandledIdentity_(index, 'handledByTrendsResearch', row.appId, row.name, true);
    }
  });

  const poolSheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.sitePool) : null;
  const poolHeaders = poolSheet && poolSheet.getLastColumn() > 0
    ? poolSheet.getRange(1, 1, 1, poolSheet.getLastColumn()).getDisplayValues()[0] : [];
  readRows(poolSheet, 'Steam App ID', '游戏名称').forEach((row, indexNumber) => {
    const values = poolSheet.getRange(indexNumber + 2, 1, 1, poolHeaders.length).getDisplayValues()[0];
    const value = name => {
      const column = poolHeaders.indexOf(name);
      return column >= 0 ? String(values[column] || '').trim().toUpperCase() : '';
    };
    const terminal = ['LIVE', '已建站', '已上线', '已完成', 'BUILD_COMPLETE', 'COMPLETED', 'COMPLETE', 'DONE', 'PUBLISHED'];
    if (terminal.indexOf(value('当前状态')) >= 0 || terminal.indexOf(value('Build状态')) >= 0) {
      addTodayActionHandledIdentity_(index, 'handledBySitePool', row.appId, row.name, true);
    }
  });

  const historySheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.history) : null;
  readRows(historySheet, 'Steam App ID', '游戏名称').forEach((row, indexNumber) => {
    const values = historySheet.getRange(indexNumber + 2, 1, 1, historySheet.getLastColumn()).getDisplayValues()[0];
    const stageColumn = historySheet.getRange(1, 1, 1, historySheet.getLastColumn()).getDisplayValues()[0].indexOf('当前阶段');
    const stage = stageColumn >= 0 ? String(values[stageColumn] || '').trim() : '';
    if ([HISTORY_STAGE_BUILD_, HISTORY_STAGE_GSC_, '已上线', '已完成', 'BUILD_COMPLETE', 'COMPLETED'].indexOf(stage) >= 0) {
      addTodayActionHandledIdentity_(index, 'handledByHistory', row.appId, row.name, true);
    }
  });

  const planSheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.keywordPlan) : null;
  if (planSheet && planSheet.getLastRow() >= 1) {
    const plan = parseKeywordPlanValues_(planSheet.getRange(1, 1, planSheet.getLastRow(), Math.max(1, planSheet.getLastColumn())).getDisplayValues());
    (plan.buildGames || []).forEach(game => addTodayActionHandledIdentity_(index, 'handledByBuildPlan', game.appId, game.name, true));
  }
  return index;
}

function isTodayActionAlreadyHandled_(rec, index) {
  if (!rec || !index) return false;
  const appId = String(rec.appId || '').trim();
  if (isReliableSteamAppId_(appId)) return index.byAppId.has(appId);
  const name = normalizeGameName_(rec.name);
  return !!name && index.byLegacyName.has(name);
}

function todayActionHandledReasons_(rec, index) {
  if (!rec || !index) return [];
  const appId = String(rec.appId || '').trim();
  if (isReliableSteamAppId_(appId)) return Array.from(index.reasonsByAppId.get(appId) || []);
  const name = normalizeGameName_(rec.name);
  return name ? Array.from(index.reasonsByLegacyName.get(name) || []) : [];
}

// ============================================================================
// M7A — Steam Candidate Research bridge
// ============================================================================

function steamCandidateResearchNumberOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function steamCandidateResearchDateString_(value, ss) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    const tz = ss && ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Shanghai';
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function steamCandidateResearchCreatedAt_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  const text = String(value || '').trim();
  return text || new Date().toISOString();
}

function steamCandidateResearchCycleFromJobId_(jobId) {
  const match = /-(\d{8})$/.exec(String(jobId || '').trim());
  if (!match) return '';
  const compact = match[1];
  return compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8);
}

function steamCandidateResearchSignalsFromMasterRow_(masterRow, masterCol, ss) {
  const value = name => masterCol[name] === undefined ? '' : masterRow[masterCol[name]];
  return {
    first_round_type: String(value('第一轮类型') || '').trim(),
    first_round_priority: String(value('第一轮优先级') || '').trim(),
    followers: steamCandidateResearchNumberOrNull_(value('Steam Followers')),
    followers_gain_7d: steamCandidateResearchNumberOrNull_(value('Steam 7d Gain')),
    growth_rate: steamCandidateResearchNumberOrNull_(value('近似增长率')),
    release_stage: String(value('发布阶段') || '').trim(),
    release_date: steamCandidateResearchDateString_(value('Steam 发布日期'), ss),
    days_to_release: steamCandidateResearchNumberOrNull_(value('距发售天数')),
    review_count: steamCandidateResearchNumberOrNull_(value('评论数')),
    steam_score: steamCandidateResearchNumberOrNull_(value('Steam评分'))
  };
}

function buildSteamCandidateResearchJob_(masterRow, masterCol, decision, ss, createdAt) {
  const value = name => masterCol[name] === undefined ? '' : masterRow[masterCol[name]];
  const appId = String(value('Steam App ID') || decision.appId || '').trim();
  const gameName = String(value('游戏名称') || decision.name || '').trim();
  const cycleDate = steamCandidateResearchCycleFromJobId_(decision.researchJobId) ||
    steamCandidateResearchDateString_(createdAt, ss);
  const ymd = cycleDate.replace(/-/g, '');
  const jobId = String(decision.researchJobId || '').trim() ||
    ('steam-research-' + appId + '-' + ymd);
  return {
    job_id: jobId,
    job_type: STEAM_CANDIDATE_RESEARCH_JOB_TYPE,
    steam_app_id: appId,
    game_name: gameName,
    steam_url: String(value('Steam URL') || '').trim(),
    research_cycle_date: cycleDate,
    steam_signals: steamCandidateResearchSignalsFromMasterRow_(masterRow, masterCol, ss),
    manual_signals: {
      trends_result: decision.trendsResult || '',
      social_result: decision.socialResult || '',
      serp_competition: decision.serpCompetition || '',
      keyword_opportunity: decision.keywordOpportunity || '',
      trend_last_checked: decision.trendLastChecked || '',
      external_signal: decision.externalSignal || '',
      final_research_stage: decision.finalResearchStage || ''
    },
    serp_queries: gameName ? [gameName] : [],
    requested_checks: STEAM_CANDIDATE_RESEARCH_CHECKS.slice(),
    created_at: steamCandidateResearchCreatedAt_(decision.autoResearchTime || createdAt),
    candidate_state: {
      decision: decision.status || '',
      next_recheck_date: decision.nextRecheckDate || '',
      // `进入下一步` is the existing authoritative 1A -> 1B gate used by
      // both the enqueue path and the pending endpoint.  Do not re-parse the
      // human-facing `1A结果` text here: historical accepted values may carry
      // explanatory suffixes and would otherwise be falsely marked excluded.
      one_a_excluded: String(value('进入下一步') || '').trim() !== '是',
      preflight_verdict: decision.preflightVerdict || '',
      current_7d_gain: steamCandidateResearchNumberOrNull_(value('Steam 7d Gain')),
      last_checked_7d_gain: steamCandidateResearchNumberOrNull_(decision.lastGain),
      last_checked_date: steamCandidateResearchDateString_(decision.lastCheckedDate, ss),
      trend_last_checked: steamCandidateResearchDateString_(decision.trendLastChecked, ss),
      external_signal: decision.externalSignal || '',
      manual_evidence: {
        trends_result: decision.trendsResult || '',
        social_result: decision.socialResult || '',
        serp_competition: decision.serpCompetition || '',
        keyword_opportunity: decision.keywordOpportunity || '',
        final_research_stage: decision.finalResearchStage || ''
      }
    }
  };
}

function steamCandidatePreflightDue_(decision, today) {
  if (!decision || (decision.status !== 'WATCH' && decision.preflightVerdict !== 'WATCH')) return false;
  const due = dateAtStart_(decision.nextRecheckDate);
  const todayStart = dateAtStart_(today) || dateAtStart_(new Date());
  return !!due && due.getTime() <= todayStart.getTime();
}

function enqueueSteamCandidateResearchJobs_(ss, createdAt) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { created: 0, skipped: 0 };
  const decisionSheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const masterSheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!decisionSheet || !masterSheet || masterSheet.getLastRow() < 2) {
    return { created: 0, skipped: 0, error: 'candidate_sheet_missing' };
  }

  const decisionCol = candidateDecisionColumnMap_(decisionSheet);
  const masterCol = {};
  HOTWORD_V2.masterHeaders.forEach((name, index) => { masterCol[name] = index; });
  const masterRows = masterSheet.getRange(
    2, 1, masterSheet.getLastRow() - 1, HOTWORD_V2.masterHeaders.length
  ).getValues();
  const decisions = readCandidateDecisions_(ss);
  const rules = loadRules_(ss);
  const now = createdAt || new Date();
  const cycleDate = steamCandidateResearchDateString_(now, ss);
  const created = [];
  const createdJobIds = new Set();
  let skipped = 0;

  masterRows.forEach(masterRow => {
    const appId = String(masterRow[masterCol['Steam App ID']] || '').trim();
    const continueNext = String(masterRow[masterCol['进入下一步']] || '').trim();
    if (!isReliableSteamAppId_(appId) || continueNext !== '是') return;
    const oneAResult = String(masterRow[masterCol['1A结果']] || '').trim();
    if (oneAResult && !STEAM_CANDIDATE_1A_PASS_RESULTS[oneAResult]) return;

    const decision = decisions.get(appId);
    if (!decision || !decision.rowNumber) return;
    // M7E V1 is one-shot per Steam App ID. An existing ResearchJobID means
    // this candidate has already entered the paid research lifecycle.
    if (String(decision.researchJobId || '').trim() &&
        !(STEAM_PREFLIGHT_ENABLED && steamCandidatePreflightDue_(decision, now))) {
      skipped += 1;
      return;
    }
    // Final human decisions are never eligible; an explicitly due WATCH may
    // re-enter using the existing recheck date semantics.
    const persistedStatus = normalizeDecisionStatus_(decision.status);
    if (persistedStatus === 'BUILD' || persistedStatus === 'REJECT' ||
        (persistedStatus === 'WATCH' && !steamCandidatePreflightDue_(decision, now) &&
          machineResearchComplete_(decision))) {
      skipped += 1;
      return;
    }
    const candidateRec = {
      gain7d: masterRow[masterCol['Steam 7d Gain']],
      firstRoundType: masterRow[masterCol['第一轮类型']]
    };
    if (persistedStatus === 'WATCH') {
      const watchGate = candidateWatchRecheckGate_(candidateRec, decision, now, rules);
      if (machineResearchComplete_(decision) && watchGate.due && !watchGate.allowed) {
        skipped += 1;
        return;
      }
    }
    if (candidateManualEvidenceNeedsNoProvider_(candidateRec, decision, candidateExternalSignalIsNew_(decision))) {
      skipped += 1;
      return;
    }
    const jobId = 'steam-research-' + appId + '-' + cycleDate.replace(/-/g, '');
    if (createdJobIds.has(jobId)) {
      skipped += 1;
      return;
    }
    if (String(decision.researchJobId || '').trim() === jobId) {
      skipped += 1;
      return;
    }

    const dueWatch = STEAM_PREFLIGHT_ENABLED && steamCandidatePreflightDue_(decision, now);
    const job = buildSteamCandidateResearchJob_(
      masterRow,
      masterCol,
      Object.assign({}, decision, { researchJobId: dueWatch ? '' : jobId, autoResearchTime: now }),
      ss,
      now
    );
    const rowNumber = decision.rowNumber;
    candidateDecisionSetField_(decisionSheet, rowNumber, 'ResearchJobID', job.job_id, decisionCol);
    candidateDecisionSetField_(decisionSheet, rowNumber, '自动研究状态', STEAM_CANDIDATE_RESEARCH_PENDING, decisionCol);
    candidateDecisionSetField_(decisionSheet, rowNumber, '自动研究时间', now, decisionCol);
    ['自动Social摘要', '自动SERP摘要', '自动研究结果路径', '自动Recommendation',
      '自动Recommendation置信度', '自动Recommendation理由', '自动缺失证据',
      '自动Recommendation结果路径', '自动研究错误', '自动BUILD依据', '自动BUILD Thesis', 'PreflightCheckedAt', 'PreflightReason']
      .forEach(field => candidateDecisionSetField_(decisionSheet, rowNumber, field, '', decisionCol));
    candidateDecisionSetField_(decisionSheet, rowNumber, 'PreflightVerdict', STEAM_PREFLIGHT_ENABLED ? 'PENDING' : '', decisionCol);
    createdJobIds.add(job.job_id);
    created.push(job);
  });

  return { created: created.length, skipped: skipped, jobs: created };
}

function loadPendingSteamCandidateResearchJobs_(spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  const decisionSheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const masterSheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!decisionSheet || !masterSheet || decisionSheet.getLastRow() < 2 || masterSheet.getLastRow() < 2) return [];

  const masterCol = {};
  HOTWORD_V2.masterHeaders.forEach((name, index) => { masterCol[name] = index; });
  const masterRows = masterSheet.getRange(
    2, 1, masterSheet.getLastRow() - 1, HOTWORD_V2.masterHeaders.length
  ).getValues();
  const masterByAppId = new Map();
  masterRows.forEach(row => {
    const appId = String(row[masterCol['Steam App ID']] || '').trim();
    if (appId) masterByAppId.set(appId, row);
  });

  const decisions = readCandidateDecisions_(ss);
  const rules = loadRules_(ss);
  const jobs = [];
  decisions.forEach(decision => {
    if (String(decision.autoResearchStatus || '').trim() !== STEAM_CANDIDATE_RESEARCH_PENDING) return;
    const jobId = String(decision.researchJobId || '').trim();
    const masterRow = masterByAppId.get(String(decision.appId || '').trim());
    if (!jobId || !masterRow) return;
    if (String(masterRow[masterCol['进入下一步']] || '').trim() !== '是') return;
    const status = normalizeDecisionStatus_(decision.status);
    if (status === 'REJECT' || status === 'BUILD') return;
    if (status === 'WATCH' && !steamCandidatePreflightDue_(decision, new Date()) &&
        machineResearchComplete_(decision)) return;
    const candidateRec = {
      gain7d: masterRow[masterCol['Steam 7d Gain']],
      firstRoundType: masterRow[masterCol['第一轮类型']]
    };
    if (status === 'WATCH' && machineResearchComplete_(decision)) {
      const watchGate = candidateWatchRecheckGate_(candidateRec, decision, new Date(), rules);
      if (watchGate.due && !watchGate.allowed) return;
    }
    if (candidateManualEvidenceNeedsNoProvider_(candidateRec, decision, candidateExternalSignalIsNew_(decision))) return;
    if (decision.preflightVerdict && decision.preflightVerdict !== 'PENDING' &&
        !steamCandidatePreflightDue_(decision, new Date())) return;
    jobs.push(buildSteamCandidateResearchJob_(masterRow, masterCol, decision, ss, decision.autoResearchTime));
  });
  return jobs;
}

function candidateDecisionRow_(decision, columnMap, existingRow) {
  const map = columnMap && columnMap.byName ? columnMap : candidateDecisionColumnMap_(columnMap);
  const row = existingRow ? existingRow.slice() : new Array(map.width).fill('');
  while (row.length < map.width) row.push('');
  const values = candidateDecisionFieldValues_(decision);
  Object.keys(values).forEach(name => {
    if (map.byName[name]) row[map.byName[name] - 1] = values[name];
  });
  return row.slice(0, map.width);
}

function syncCandidateDecisions_(ss, records, runTime, rules) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const columnMap = candidateDecisionColumnMap_(sheet);
  const decisions = readCandidateDecisions_(ss);
  records.forEach(rec => {
    const appId = String(rec.appId);
    let decision = decisions.get(appId);
    if (!decision) {
      decision = {appId, name: rec.name, status: '', lastCheckedDate: '', lastGain: '', lastType: '', nextRecheckDate: '', note: '', lastCheckedStatus: '',
        firstSeen: '', source: '', firstType: '', currentStage: '', researchStatus: '待研究', trendsResult: '', socialResult: '', serpCompetition: '未检查', keywordOpportunity: '未检查', manualNote: '', decisionDate: '', nextAction: '',
        researchJobId: '', autoResearchStatus: '', autoResearchTime: '', autoSocialSummary: '', autoSerpSummary: '', autoResearchResultPath: '',
        autoRecommendation: '', autoRecommendationConfidence: '', autoRecommendationReasons: '', autoMissingEvidence: '', autoRecommendationResultPath: '', autoResearchError: '', autoBuildEvidence: '', autoBuildThesis: '', decisionId: '',
        preflightVerdict: '', preflightCheckedAt: '', preflightReason: '',
        trendRelativeStrength: '', trendVerdict: '', trendLastChecked: '', externalSignal: '', finalResearchStage: ''};
      decisions.set(appId, decision);
    }
    decision.name = rec.name;
    // Opportunity precedes Decision: create only when this candidate enters the
    // normal decision runtime, and preserve it across later refreshes/statuses.
    decision.opportunityId = decision.opportunityId || opportunityIdFromSteamCandidate_(decision.name, appId);
    const masterRow = findMasterRecord_(ss, appId);
    if (masterRow) {
      decision.firstSeen = decision.firstSeen || masterRow[28] || runTime;
      decision.source = decision.source || masterRow[4] || '';
      decision.firstType = decision.firstType || masterRow[20] || rec.firstRoundType;
      decision.currentStage = masterRow[25] || rec.currentStage;
    }
    decision.firstType = decision.firstType || rec.firstRoundType;
    decision.currentStage = decision.currentStage || rec.currentStage;
    const isHumanStage = decision.currentStage === '1B完成→人工第二轮';
    decision.researchStatus = isHumanStage ? deriveResearchStatus_(decision) : '';
    const actionRec = {gain7d: rec.gain7d, firstRoundType: rec.firstRoundType};
    if (decision.status === 'BUILD') decision.nextAction = 'Site Build';
    else if (decision.status === 'WATCH') decision.nextAction = candidateManualEvidenceNextAction_(actionRec, decision, candidateExternalSignalIsNew_(decision));
    else if (decision.status === 'REJECT' || !isHumanStage) decision.nextAction = 'None';
    else if (STEAM_PREFLIGHT_ENABLED && decision.preflightVerdict === 'MANUAL_REVIEW') decision.nextAction = candidateManualEvidenceNextAction_(actionRec, decision, candidateExternalSignalIsNew_(decision));
    else if (STEAM_PREFLIGHT_ENABLED && decision.preflightVerdict === 'WATCH') decision.nextAction = 'Recheck';
    else if (STEAM_PREFLIGHT_ENABLED && (!decision.preflightVerdict || decision.preflightVerdict === 'PENDING' || decision.preflightVerdict === 'PREFLIGHT_ERROR')) decision.nextAction = 'Automatic Preflight';
    else if (!decision.nextAction || (decision.nextAction === 'Keyword Research' && decision.researchStatus === '待研究')) decision.nextAction = candidateManualEvidenceNextAction_(actionRec, decision, candidateExternalSignalIsNew_(decision));
    if (decision.status && decision.status !== decision.lastCheckedStatus) {
      decision.lastCheckedDate = runTime;
      decision.lastGain = rec.gain7d;
      decision.lastType = rec.firstRoundType;
      decision.nextRecheckDate = decision.status === 'WATCH'
        ? addDays_(runTime, isStrongWatchType_(rec.firstRoundType)
          ? rules.WATCH_RECHECK_DAYS_STRONG : rules.WATCH_RECHECK_DAYS_NORMAL)
        : '';
      decision.lastCheckedStatus = decision.status;
      decision.decisionDate = decision.status === 'REJECT' || decision.status === 'BUILD' ? runTime : decision.decisionDate;
    }
    if (decision.status === 'WATCH') {
      const watchGate = candidateWatchRecheckGate_(actionRec, decision, runTime, rules);
      if (watchGate.due && !watchGate.allowed) {
        decision.nextRecheckDate = addDays_(runTime, isStrongWatchType_(decision.lastType || rec.firstRoundType)
          ? rules.WATCH_RECHECK_DAYS_STRONG : rules.WATCH_RECHECK_DAYS_NORMAL);
        decision.nextAction = 'Recheck';
      }
    }
  });

  decisions.forEach(decision => {
    if (decision.rowNumber) {
      sheet.getRange(decision.rowNumber, 1, 1, columnMap.width)
        .setValues([candidateDecisionRow_(decision, columnMap, decision.row)]);
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, columnMap.width)
        .setValues([candidateDecisionRow_(decision, columnMap)]);
    }
  });
  return decisions;
}

function nextActionForResearch_(decision) {
  return candidateManualEvidenceNextAction_(
    {firstRoundType: decision && decision.firstType},
    decision,
    candidateExternalSignalIsNew_(decision)
  );
}

function syncCandidateDecisionFromActionEdit_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== HOTWORD_V2.sheets.action || e.range.getRow() < 4) return;
  const headers = sheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).getDisplayValues()[0];
  const editable = ['Trends结果', '人工决定', 'Decision', '人工备注'];
  const rangeStart = e.range.getColumn();
  const rangeEnd = e.range.getLastColumn ? e.range.getLastColumn() : rangeStart;
  const editedHeaders = editable.filter(name => {
    const col = headers.indexOf(name) + 1;
    return col >= rangeStart && col <= rangeEnd;
  });
  if (!editedHeaders.length) return;

  const rowNumber = e.range.getRow();
  const values = sheet.getRange(rowNumber, 1, 1, HOTWORD_V2.actionHeaders.length).getValues()[0];
  const at = name => values[headers.indexOf(name)];
  const appId = String(at('Steam App ID') || '').trim();
  if (!appId) return;
  const decisions = readCandidateDecisions_(e.source);
  let decision = decisions.get(appId);
  if (!decision) {
    decision = {appId, name: at('游戏名称') || '', status: '', lastCheckedDate: '', lastGain: '', lastType: '', nextRecheckDate: '', note: '', lastCheckedStatus: '',
      firstSeen: '', source: '', firstType: '', currentStage: at('当前阶段') || '', researchStatus: '', trendsResult: '', socialResult: '', serpCompetition: '', keywordOpportunity: '', manualNote: '', decisionDate: '', nextAction: '', opportunityId: '',
      researchJobId: '', autoResearchStatus: '', autoResearchTime: '', autoSocialSummary: '', autoSerpSummary: '', autoResearchResultPath: '',
      autoRecommendation: '', autoRecommendationConfidence: '', autoRecommendationReasons: '', autoMissingEvidence: '', autoRecommendationResultPath: '', autoResearchError: '', autoBuildEvidence: '', autoBuildThesis: '', decisionId: '',
      preflightVerdict: '', preflightCheckedAt: '', preflightReason: '',
      trendRelativeStrength: '', trendVerdict: '', trendLastChecked: '', externalSignal: '', finalResearchStage: ''};
  }
  decision.name = at('游戏名称') || decision.name;
  decision.opportunityId = decision.opportunityId || opportunityIdFromSteamCandidate_(decision.name, appId);
  decision.firstType = decision.firstType || at('第一轮类型') || '';
  decision.currentStage = at('当前阶段') || decision.currentStage;
  decision.trendsResult = at('Trends结果') || '';
  decision.manualNote = at('人工备注') || '';
  decision.status = normalizeDecisionStatus_(at('人工决定') || at('Decision'));
  const trendsEdited = editedHeaders.indexOf('Trends结果') >= 0;
  if (trendsEdited) {
    recalculateSteamCandidateRecommendationFromTrends_(decision);
  }
  const masterRow = findMasterRecord_(e.source, appId);
  if (masterRow) {
    decision.firstSeen = decision.firstSeen || masterRow[28] || '';
    decision.source = decision.source || masterRow[4] || '';
    decision.firstType = decision.firstType || masterRow[20] || '';
  }
  decision.researchStatus = deriveResearchStatus_(decision);
  if (decision.status && decision.status !== decision.lastCheckedStatus) {
    const checkedAt = new Date();
    decision.lastCheckedDate = checkedAt;
    decision.lastGain = masterRow ? masterRow[12] : '';
    decision.lastType = masterRow ? masterRow[20] : decision.firstType;
    decision.nextRecheckDate = decision.status === 'WATCH' ? addDays_(checkedAt, isStrongWatchType_(decision.lastType) ? loadRules_(e.source).WATCH_RECHECK_DAYS_STRONG : loadRules_(e.source).WATCH_RECHECK_DAYS_NORMAL) : '';
    decision.decisionDate = decision.status === 'BUILD' || decision.status === 'REJECT' ? checkedAt : decision.decisionDate;
    decision.lastCheckedStatus = decision.status;
  } else if (!decision.status) {
    decision.lastCheckedStatus = '';
    decision.nextRecheckDate = '';
    decision.decisionDate = '';
  }
  if (decision.status === 'BUILD') decision.nextAction = 'Site Build';
  else if (decision.status === 'WATCH') decision.nextAction = 'Recheck';
  else if (decision.status === 'REJECT' || decision.currentStage !== '1B完成→人工第二轮') decision.nextAction = 'None';
  else decision.nextAction = nextActionForResearch_(decision);

  const decisionSheet = e.source.getSheetByName(HOTWORD_V2.sheets.decisions);
  const decisionColumnMap = candidateDecisionColumnMap_(decisionSheet);
  const existing = decisions.get(appId);
  if (existing && existing.row) {
    decisionSheet.getRange(existing.rowNumber, 1, 1, decisionColumnMap.width)
      .setValues([candidateDecisionRow_(decision, decisionColumnMap, existing.row)]);
  } else {
    decisionSheet.getRange(decisionSheet.getLastRow() + 1, 1, 1, decisionColumnMap.width)
      .setValues([candidateDecisionRow_(decision, decisionColumnMap)]);
  }
  if (decision.status === 'BUILD') upsertSitePoolRecord_(e.source, decision.name, appId, decision.decisionDate || new Date(), {opportunityId: decision.opportunityId});

  const output = {
    '研究状态': decision.researchStatus,
    '人工动作': decision.status ? '' : deriveHumanAction_({firstRoundType: decision.firstType}, decision, false),
    '研究完成度': deriveResearchCompletion_(decision),
    '人工决定': decision.status,
    'Decision': decision.status,
    '最终状态': deriveFinalStatus_(decision),
    '机器推荐': decision.machineDecision || normalizeMachineRecommendationDisplay_(decision.autoRecommendation),
    '机器置信度': decision.autoRecommendationConfidence || '',
    '机器推荐理由': decision.machineDecisionReason || decision.autoRecommendationReasons || ''
  };
  Object.keys(output).forEach(name => {
    const col = headers.indexOf(name) + 1;
    if (col > 0) sheet.getRange(rowNumber, col).setValue(output[name]);
  });
  refreshTodayActionsFromCandidateDecisions_(e.source);
}

function captureCandidateDecisionEdit_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== HOTWORD_V2.sheets.decisions || e.range.getRow() < 2) return;
  const columnMap = candidateDecisionColumnMap_(sheet);
  const decisionColumn = columnMap.byName['Decision'] || 0;
  const legacyColumn = columnMap.byName['决策状态'] || 0;
  const editStart = e.range.getColumn();
  const editEnd = e.range.getLastColumn ? e.range.getLastColumn() : editStart;
  const decisionEdited = (decisionColumn > 0 && decisionColumn >= editStart && decisionColumn <= editEnd) ||
    (legacyColumn > 0 && legacyColumn >= editStart && legacyColumn <= editEnd);
  if (!decisionEdited) return;
  const editedDecisionColumn = decisionColumn > 0 && decisionColumn >= editStart && decisionColumn <= editEnd
    ? decisionColumn : legacyColumn;
  const status = normalizeDecisionStatus_(sheet.getRange(e.range.getRow(), editedDecisionColumn).getValue());
  if (!status) return;
  if (decisionColumn > 0) candidateDecisionSetField_(sheet, e.range.getRow(), 'Decision', status, columnMap);
  if (legacyColumn > 0) candidateDecisionSetField_(sheet, e.range.getRow(), '决策状态', status, columnMap);
  const appId = String(sheet.getRange(e.range.getRow(), columnMap.byName['Steam App ID'] || 1).getDisplayValue() || '').trim();
  const opportunityIdColumn = columnMap.byName['OpportunityID'] || 0;
  if (opportunityIdColumn > 0 && !sheet.getRange(e.range.getRow(), opportunityIdColumn).getDisplayValue()) {
    const name = sheet.getRange(e.range.getRow(), columnMap.byName['游戏名称'] || 2).getDisplayValue();
    candidateDecisionSetField_(sheet, e.range.getRow(), 'OpportunityID', opportunityIdFromSteamCandidate_(name, appId), columnMap);
  }
  const master = e.source.getSheetByName(HOTWORD_V2.sheets.master);
  if (!appId || !master || master.getLastRow() < 2) return;
  const ids = master.getRange(2, 2, master.getLastRow() - 1, 1).getDisplayValues();
  const index = ids.findIndex(row => String(row[0]).trim() === appId);
  if (index < 0) return;
  const masterRow = index + 2;
  const checkedAt = new Date();
  const type = master.getRange(masterRow, 21).getDisplayValue();
  const gain = master.getRange(masterRow, 13).getValue();
  const rules = loadRules_(e.source);
  candidateDecisionSetField_(sheet, e.range.getRow(), '上次人工检查日', checkedAt, columnMap);
  candidateDecisionSetField_(sheet, e.range.getRow(), '上次检查7d Gain', gain, columnMap);
  candidateDecisionSetField_(sheet, e.range.getRow(), '上次检查类型', type, columnMap);
  candidateDecisionSetField_(sheet, e.range.getRow(), '下次复查日', status === 'WATCH' ? addDays_(checkedAt, isStrongWatchType_(type)
    ? rules.WATCH_RECHECK_DAYS_STRONG : rules.WATCH_RECHECK_DAYS_NORMAL) : '', columnMap);
  candidateDecisionSetField_(sheet, e.range.getRow(), '上次检查时决策状态', status, columnMap);
  const nextActionColumn = columnMap.byName['Next Action'] || 0;
  const decisionDateColumn = columnMap.byName['Decision日期'] || 0;
  const researchStatusColumn = columnMap.byName['研究状态'] || 0;
  if (researchStatusColumn > 0) candidateDecisionSetField_(sheet, e.range.getRow(), '研究状态', '已完成', columnMap);
  if (decisionDateColumn > 0 && (status === 'BUILD' || status === 'REJECT')) candidateDecisionSetField_(sheet, e.range.getRow(), 'Decision日期', checkedAt, columnMap);
  if (nextActionColumn > 0) candidateDecisionSetField_(sheet, e.range.getRow(), 'Next Action', status === 'BUILD' ? 'Site Build' : status === 'WATCH' ? 'Recheck' : 'None', columnMap);
  if (status === 'BUILD') upsertSitePoolRecord_(e.source, sheet.getRange(e.range.getRow(), 2).getValue(), appId, checkedAt, {
    opportunityId: opportunityIdColumn > 0 ? sheet.getRange(e.range.getRow(), opportunityIdColumn).getValue() : ''
  });
}

function candidateDecisionEditAffectsTodayAction_(e) {
  if (!e || !e.range || !e.range.getSheet || e.range.getSheet().getName() !== HOTWORD_V2.sheets.decisions || e.range.getRow() < 2) return false;
  const sheet = e.range.getSheet();
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HOTWORD_V2.decisionHeaders.length)).getDisplayValues()[0];
  const relevant = [
    '决策状态', '下次复查日', 'Google Trends结果', 'Social结果', 'SERP竞争', '关键词机会',
    'Decision', 'Next Action', 'FinalResearchStage', 'ExternalSignal', 'PreflightVerdict',
    'PreflightCheckedAt', 'PreflightReason', 'TrendRelativeStrength', 'TrendVerdict', 'TrendLastChecked',
    '自动研究状态', '自动研究时间', '自动研究错误', '人工备注'
  ];
  const start = e.range.getColumn();
  const end = e.range.getLastColumn ? e.range.getLastColumn() : start;
  return relevant.some(name => {
    const column = headers.indexOf(name) + 1;
    return column > 0 && column >= start && column <= end;
  });
}

function onEdit(e) {
  syncCandidateDecisionFromActionEdit_(e);
  captureCandidateTrendsRecalc_(e);
  captureCandidateDecisionEdit_(e);
  if (candidateDecisionEditAffectsTodayAction_(e)) refreshTodayActionsFromCandidateDecisions_(e.source);
}

function captureCandidateTrendsRecalc_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== HOTWORD_V2.sheets.decisions || e.range.getRow() < 2) return;
  const columnMap = candidateDecisionColumnMap_(sheet);
  const trendsColumn = columnMap.byName['Google Trends结果'] || 0;
  if (!trendsColumn) return;
  const editStart = e.range.getColumn();
  const editEnd = e.range.getLastColumn ? e.range.getLastColumn() : editStart;
  if (trendsColumn < editStart || trendsColumn > editEnd) return;
  const appId = String(sheet.getRange(e.range.getRow(), columnMap.byName['Steam App ID'] || 1).getDisplayValue() || '').trim();
  if (!appId) return;
  const decisions = readCandidateDecisions_(e.source);
  const decision = decisions.get(appId);
  if (!decision) return;
  decision.trendsResult = sheet.getRange(e.range.getRow(), trendsColumn).getDisplayValue();
  const recalculated = recalculateSteamCandidateRecommendationFromTrends_(decision);
  if (!recalculated) return;
  sheet.getRange(decision.rowNumber, 1, 1, columnMap.width)
    .setValues([candidateDecisionRow_(recalculated, columnMap, decision.row)]);
  refreshTodayActionsFromCandidateDecisions_(e.source);
}

/**
 * @param {Object} rec
 * @return {Array<*>}
 */
function actionRow_(rec) {
  const trends = buildTrendsQuery_(rec.name, rec.searchAlias);
  const trendsUrl = buildGoogleTrendsExploreUrl_(trends.query);
  const trendsLink = trendsUrl
    ? '=HYPERLINK("' + trendsUrl.replace(/"/g, '""') + '","打开 Trends")'
    : '';
  const humanAction = rec.todayAction && rec.todayAction.humanAction
    ? rec.todayAction.humanAction
    : deriveHumanAction_({firstRoundType: rec.firstRoundType}, rec.todayAction && rec.todayAction.decision, false);
  const decision = rec.todayAction && rec.todayAction.decision || {};
  const purchaseUrl = String(decision.domainPurchaseUrl || '').trim();
  const purchaseLink = purchaseUrl
    ? '=HYPERLINK("' + purchaseUrl.replace(/"/g, '""') + '","购买域名")'
    : '';
  const machineRecommendation = normalizeMachineRecommendationDisplay_(
    decision.machineDecision || decision.autoRecommendation
  );
  const machineConfidence = decision.autoRecommendationConfidence || '';
  const machineReason = decision.machineDecisionReason || decision.autoRecommendationReasons || '';
  const humanDecision = normalizeDecisionStatus_(decision.status) || '';
  const finalStatus = deriveFinalStatus_(decision);

  return [
    rec.todayAction.type,
    rec.priority,
    rec.name,
    rec.appId,
    rec.firstRoundType,
    rec.followers,
    rec.gain7d,
    rec.growthRate,
    rec.releaseStage,
    rec.releaseDate || '',
    rec.daysToRelease,
    rec.reviews,
    rec.rating,
    rec.searchAlias || '',
    trendsLink,
    rec.todayAction.decision && rec.todayAction.decision.trendsResult || '',
    formatMachineSocialDisplay_(decision),
    rec.todayAction.decision && rec.todayAction.decision.serpCompetition || '',
    rec.todayAction.decision && rec.todayAction.decision.keywordOpportunity || '',
    machineRecommendation,
    machineConfidence,
    machineReason,
    humanDecision,
    rec.todayAction.decision && rec.todayAction.decision.manualNote || '',
    finalStatus,
    rec.currentStage,
    rec.todayAction.decision && rec.todayAction.decision.researchStatus || '',
    rec.todayAction.decision && rec.todayAction.decision.researchStatus === '已完成' ? '已完成' : rec.todayAction.decision && rec.todayAction.decision.researchStatus === '研究中' ? '进行中' : '未开始',
    humanAction || (rec.todayAction.type === 'RESEARCHING' ? '继续完成研究' : ''),
    rec.todayAction.reason,
    rec.todayAction.lastCheckedDate || (rec.todayAction.decision && rec.todayAction.decision.lastCheckedDate) || '',
    rec.url,
    rec.firstRoundReason,
    decision.recommendedDomain || '',
    decision.domainFirstYearPrice == null ? '' : decision.domainFirstYearPrice,
    decision.domainRegistrar || '',
    purchaseLink,
  ];
}


// ============================================================================
// 输出到 Sheet
// ============================================================================

function upsertMaster_(ss, records, runTime, runId, stats) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  const index = new Map();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
    ids.forEach((r, i) => {
      const id = String(r[0] || '').trim();
      if (id) index.set(id, i + 2);
    });
  }

  const newRows = [];

  for (const rec of records) {
    const existingRow = index.get(rec.appId);
    let firstSeen = runTime;
    let manualNote = '';

    if (existingRow) {
      firstSeen = sheet.getRange(existingRow, 29).getValue() || runTime;
      manualNote = sheet.getRange(existingRow, 32).getValue() || '';
    }

    // UNCHANGED_SKIP updates only the lightweight eligibility audit fields on
    // an existing master row; it never rewrites qualification/enrichment.
    if (rec.qualificationEligible === false && rec.eligibilityReason && existingRow) {
      const headers = sheet.getRange(1, 1, 1, HOTWORD_V2.masterHeaders.length).getDisplayValues()[0];
      const fields = {
        'Eligibility原因': rec.eligibilityReason || 'UNCHANGED_SKIP',
        'Qualification状态': rec.qualificationStatus || 'SKIPPED'
      };
      Object.keys(fields).forEach(name => {
        const column = headers.indexOf(name);
        if (column >= 0) sheet.getRange(existingRow, column + 1).setValues([[fields[name]]]);
      });
      continue;
    }

    const row = masterRow_(rec, runTime, firstSeen, runId, manualNote);

    // A failed GP request is not a new observation and must not erase a
    // previously successful enrichment in the master table.
    if (existingRow && rec._gpEnrichmentFailed) {
      const existing = sheet.getRange(existingRow, 1, 1, row.length).getValues()[0];
      let preserved = false;
      [11, 12, 13, 14, 15].forEach(index => {
        const rowValue = row[index];
        const existingValue = existing[index];
        if ((rowValue === null || rowValue === undefined || String(rowValue).trim() === '') &&
            existingValue !== null && existingValue !== undefined && String(existingValue).trim() !== '' &&
            isFiniteNumber_(Number(existingValue))) {
          row[index] = existing[index];
          preserved = true;
        }
      });
      if (preserved && stats) stats.failuresKept += 1;
    }

    if (existingRow) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      newRows.push(row);
    }
  }

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HOTWORD_V2.masterHeaders.length).setValues(newRows);
  }
}

// G018 P3: additive fields on the existing 候选主表.  These are intentionally
// separate from masterHeaders so legacy Steam row construction keeps its
// established width and qualification semantics unchanged.
const UNIFIED_CANDIDATE_HEADERS = [
  'Candidate ID', '候选来源', 'Twitch Game ID', 'IGDB ID',
  'Twitch排名', 'Twitch观察时间', 'Twitch来源'
];

function ensureUnifiedCandidateSchema_(sheet) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  let lastColumn = width;
  const appended = [];
  UNIFIED_CANDIDATE_HEADERS.forEach(name => {
    if (headers.indexOf(name) >= 0) return;
    lastColumn += 1;
    if (sheet.getMaxColumns && lastColumn > sheet.getMaxColumns() && sheet.insertColumnsAfter) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), 1);
    }
    sheet.getRange(1, lastColumn).setValue(name);
    headers.push(name);
    appended.push(name);
  });
  return {headers: headers, width: lastColumn, appended: appended};
}

function unifiedCandidateSource_(candidate) {
  const hasSteam = !!(candidate && (candidate.has_steam ||
    (Array.isArray(candidate.steam_app_ids) && candidate.steam_app_ids.some(Boolean))));
  const hasTwitch = !!(candidate && candidate.has_twitch) ||
    (Array.isArray(candidate && candidate.platform_listings) && candidate.platform_listings.some(item =>
      String(item && item.platform || '').toUpperCase() === 'TWITCH'));
  return hasSteam && hasTwitch ? 'STEAM+TWITCH' : hasSteam ? 'STEAM' : hasTwitch ? 'TWITCH' : '';
}

function unifiedCandidateTwitchFields_(candidate) {
  const listings = Array.isArray(candidate && candidate.platform_listings) ? candidate.platform_listings : [];
  const twitchListing = listings.find(item => String(item && item.platform || '').toUpperCase() === 'TWITCH') || {};
  const signals = Array.isArray(candidate && candidate.signals) ? candidate.signals : [];
  const twitchSignal = signals.find(item => String(item && item.source || '').toUpperCase().indexOf('TWITCH') >= 0) || {};
  const metadata = twitchSignal.metadata && typeof twitchSignal.metadata === 'object' ? twitchSignal.metadata : {};
  return {
    twitchId: String(twitchListing.platform_game_id || metadata.twitch_game_id || '').trim(),
    igdbId: String(metadata.igdb_id || '').trim(),
    rank: twitchSignal.raw_value === null || twitchSignal.raw_value === undefined ? '' : twitchSignal.raw_value,
    observedAt: twitchSignal.observed_at || '',
    provenance: signals.filter(item => String(item && item.source || '').toUpperCase().indexOf('TWITCH') >= 0)
      .map(item => ({signal_id: item.signal_id || '', source: item.source || '', observed_at: item.observed_at || '', metadata: item.metadata || {}}))
  };
}

/**
 * Upsert P2 UnifiedCandidate payloads into the existing 候选主表.
 * Existing rows are matched by Candidate ID, Steam App ID, or exact normalized
 * game name. Only additive identity/source fields and empty legacy identity
 * cells are written; manual decision and 1A/1B fields are never overwritten.
 */
function upsertUnifiedCandidates_(ss, candidates) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet is required');
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!sheet) throw new Error('候选主表不存在');
  const schema = ensureUnifiedCandidateSchema_(sheet);
  const col = name => schema.headers.indexOf(name);
  const rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.width).getValues() : [];
  const candidateColumn = col('Candidate ID');
  const appColumn = col('Steam App ID');
  const nameColumn = col('游戏名称');
  const index = new Map();
  rows.forEach((row, i) => {
    const id = String(row[candidateColumn] || '').trim();
    const app = String(row[appColumn] || '').trim();
    const name = normalizeGameName_(row[nameColumn] || '');
    if (id) index.set('id:' + id, i);
    if (app) index.set('app:' + app, i);
    if (name) index.set('name:' + name, i);
  });
  let inserted = 0;
  let updated = 0;
  const items = Array.isArray(candidates) ? candidates : [];
  items.forEach(candidate => {
    if (!candidate || typeof candidate !== 'object') return;
    const candidateId = String(candidate.candidate_id || candidate.game_entity_id || '').trim();
    const name = String(candidate.canonical_name || '').trim();
    if (!candidateId || !name) return;
    const appIds = Array.isArray(candidate.steam_app_ids) ? candidate.steam_app_ids.map(String).filter(Boolean) : [];
    const keyCandidates = ['id:' + candidateId].concat(appIds.map(app => 'app:' + app), ['name:' + normalizeGameName_(name)]);
    let rowIndex = -1;
    for (const key of keyCandidates) {
      if (index.has(key)) { rowIndex = index.get(key); break; }
    }
    const row = rowIndex >= 0 ? rows[rowIndex].slice() : new Array(schema.width).fill('');
    const setIfEmpty = (field, value) => {
      const position = col(field);
      if (position >= 0 && (row[position] === '' || row[position] === null || row[position] === undefined) && value !== '') row[position] = value;
    };
    setIfEmpty('Candidate ID', candidateId);
    setIfEmpty('游戏名称', name);
    setIfEmpty('Steam App ID', appIds[0] || '');
    const steamListing = (candidate.platform_listings || []).find(item => String(item && item.platform || '').toUpperCase() === 'STEAM');
    setIfEmpty('Steam URL', steamListing && steamListing.store_url || '');
    const twitch = unifiedCandidateTwitchFields_(candidate);
    const fields = {
      '候选来源': unifiedCandidateSource_(candidate),
      'Twitch Game ID': twitch.twitchId,
      'IGDB ID': twitch.igdbId,
      'Twitch排名': twitch.rank,
      'Twitch观察时间': twitch.observedAt,
      'Twitch来源': twitch.provenance.length ? JSON.stringify(twitch.provenance) : ''
    };
    Object.keys(fields).forEach(field => {
      const position = col(field);
      if (position >= 0 && fields[field] !== '') row[position] = fields[field];
    });
    if (rowIndex >= 0) {
      sheet.getRange(rowIndex + 2, 1, 1, schema.width).setValues([row]);
      rows[rowIndex] = row;
      updated += 1;
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, schema.width).setValues([row]);
      rows.push(row);
      inserted += 1;
      rowIndex = rows.length - 1;
    }
    index.set('id:' + candidateId, rowIndex);
    if (appIds[0]) index.set('app:' + appIds[0], rowIndex);
    index.set('name:' + normalizeGameName_(name), rowIndex);
  });
  return {ok: true, inserted: inserted, updated: updated, schemaAppended: schema.appended};
}

function masterRow_(rec, runTime, firstSeen, runId, manualNote) {
  return [
    runTime,
    rec.appId,
    rec.name,
    rec.url,
    rec.source,
    rec.sourceRank,
    rec.releaseDate || '',
    rec.releaseRaw,
    rec.releaseStage,
    rec.daysToRelease,
    rec.followers,
    rec.baselineFollowers,
    rec.gain7d,
    rec.growthRate,
    rec.coverageDays,
    rec.reviews,
    rec.positiveReviews,
    rec.rating,
    rec.result1A,
    rec.reason1A,
    rec.firstRoundType,
    rec.priority,
    rec.continueNext,
    rec.nextAction,
    rec.firstRoundReason,
    rec.currentStage,
    rec.dataStatus,
    rec.dataNotes.join(' | '),
    firstSeen,
    runTime,
    runId,
    manualNote,
    rec.qualificationEligible ? runTime : '',
    rec.qualificationEligible ? (qualificationRankValue_(rec.sourceRank) || '') : '',
    rec.eligibilityReason || '',
    rec.qualificationStatus || ''
  ];
}

function appendSnapshots_(ss, records, runTime, runId) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  const uniqueRecords = [];
  const seenAppIds = new Set();
  (records || []).forEach(rec => {
    const appId = String(rec.appId || '').trim();
    if (!appId || seenAppIds.has(appId)) return;
    seenAppIds.add(appId);
    uniqueRecords.push(rec);
  });
  if (!uniqueRecords.length) return {persisted: 0, uniqueAppIds: 0, bySourcePage: '', rowByAppId: {}};

  const bySourcePage = {};
  uniqueRecords.forEach(rec => {
    String(rec.sourcePage || '').split(' + ').filter(Boolean).forEach(value => {
      bySourcePage[value] = (bySourcePage[value] || 0) + 1;
    });
  });

  const rows = uniqueRecords.map(rec => snapshotRow_(rec, runTime, runId));
  const firstRow = sheet.getLastRow() + 1;
  sheet.getRange(firstRow, 1, rows.length, HOTWORD_V2.snapshotHeaders.length).setValues(rows);
  const rowByAppId = {};
  uniqueRecords.forEach((rec, index) => {
    rowByAppId[String(rec.appId)] = firstRow + index;
  });
  return {
    persisted: rows.length,
    uniqueAppIds: uniqueRecords.length,
    bySourcePage: Object.keys(bySourcePage).sort().map(key => key + '=' + bySourcePage[key]).join(','),
    rowByAppId: rowByAppId
  };
}

function isDailyCandidateSnapshotRecord_(rec) {
  const priority = String(rec && rec.priority || '').trim();
  return rec && rec.continueNext === '是' && (priority.indexOf('P1') === 0 || priority.indexOf('P2') === 0);
}

function dailyCandidateSnapshotDateKey_(value, ss) {
  const text = String(value == null ? '' : value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return todayActionDateText_(value, ss);
}

function dailyCandidateSnapshotRow_(rec, dateKey, runId) {
  return [
    dateKey,
    runId,
    rec.name || '',
    rec.appId || '',
    rec.priority || '',
    rec.firstRoundType || '',
    rec.followers,
    rec.gain7d,
    rec.growthRate,
    rec.releaseStage || '',
    rec.releaseDate || '',
    rec.daysToRelease,
    rec.firstRoundReason || ''
  ];
}

/**
 * Persist the first completed P1/P2 candidate set for a business day.
 * Existing date + App ID rows are immutable, so later research, decisions,
 * and Today Action refreshes cannot alter this historical view.
 */
function writeDailyCandidateSnapshot_(ss, records, runTime, runId, options) {
  options = options || {};
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.candidateSnapshot) : null;
  if (!sheet) return {persisted: 0, skipped: 0, error: 'candidate_snapshot_sheet_missing'};
  const dateKey = dailyCandidateSnapshotDateKey_(runTime, ss);
  if (!dateKey) return {persisted: 0, skipped: 0, error: 'candidate_snapshot_date_missing'};
  const width = HOTWORD_V2.candidateSnapshotHeaders.length;
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const dateColumn = headers.indexOf('日期');
  const appIdColumn = headers.indexOf('Steam App ID');
  const runIdColumn = headers.indexOf('Run ID');
  if (dateColumn < 0 || appIdColumn < 0) return {persisted: 0, skipped: 0, error: 'candidate_snapshot_schema_invalid'};
  const useRunIdempotency = options.idempotency === 'run' && runIdColumn >= 0 && String(runId || '').trim();

  const existing = new Set();
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getDisplayValues().forEach(row => {
      const appId = String(row[appIdColumn] || '').trim();
      const rowDate = String(row[dateColumn] || '').trim();
      const rowRunId = runIdColumn >= 0 ? String(row[runIdColumn] || '').trim() : '';
      if (!appId) return;
      if (useRunIdempotency) {
        if (rowRunId && rowRunId === String(runId).trim()) existing.add(rowRunId + '|' + appId);
      } else if (rowDate) {
        existing.add(rowDate + '|' + appId);
      }
    });
  }

  const unique = new Map();
  (records || []).forEach(rec => {
    if (!isDailyCandidateSnapshotRecord_(rec)) return;
    const appId = String(rec.appId || '').trim();
    if (!appId) return;
    const idemKey = useRunIdempotency ? (String(runId).trim() + '|' + appId) : (dateKey + '|' + appId);
    if (existing.has(idemKey) || unique.has(appId)) return;
    unique.set(appId, rec);
  });
  const rows = Array.from(unique.values()).map(rec => dailyCandidateSnapshotRow_(rec, dateKey, runId));
  if (!rows.length) return {persisted: 0, skipped: (records || []).filter(isDailyCandidateSnapshotRecord_).length};

  // Put the newest business day first without rewriting any historical row.
  if (sheet.insertRowsAfter) sheet.insertRowsAfter(1, rows.length);
  sheet.getRange(2, 1, rows.length, width).setValues(rows);
  return {
    persisted: rows.length,
    skipped: (records || []).filter(isDailyCandidateSnapshotRecord_).length - rows.length
  };
}

function snapshotRow_(rec, runTime, runId) {
  return [
    runTime,
    runId,
    rec.appId,
    rec.name,
    rec.url,
    rec.source,
    rec.sourceRank,
    rec.releaseStage,
    rec.releaseDate || '',
    rec.daysToRelease,
    rec.followers,
    rec.baselineFollowers,
    rec.gain7d,
    rec.growthRate,
    rec.coverageDays,
    rec.reviews,
    rec.positiveReviews,
    rec.rating,
    rec.result1A,
    rec.reason1A,
    rec.firstRoundType,
    rec.priority,
    rec.continueNext,
    rec.nextAction,
    rec.observationDataStatus || rec.dataStatus,
    rec.dataNotes.concat(rec.observationDataNotes || []).join(' | '),
    rec.sourcePage || '',
    rec.rawStatus || 'RAW_ONLY'
  ];
}

function updateSnapshots_(ss, records, runTime, runId, rowByAppId, skipIdentityCheck) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  const updated = [];
  const skipped = [];
  const refs = rowByAppId || {};
  const width = HOTWORD_V2.snapshotHeaders.length;

  records.forEach(rec => {
    const rowNumber = Number(refs[String(rec.appId)] || 0);
    if (!rowNumber) {
      skipped.push(String(rec.appId));
      return;
    }
    if (!skipIdentityCheck) {
      const identity = sheet.getRange(rowNumber, 2, 1, 2).getDisplayValues()[0];
      if (String(identity[0] || '').trim() !== String(runId) ||
          String(identity[1] || '').trim() !== String(rec.appId)) {
        skipped.push(String(rec.appId));
        return;
      }
    }
    sheet.getRange(rowNumber, 1, 1, width).setValues([snapshotRow_(rec, runTime, runId)]);
    updated.push(String(rec.appId));
  });

  return {updated: updated.length, skipped: skipped};
}

function readCandidateMasterRecordsForTodayAction_(ss) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.master) : null;
  if (!sheet || sheet.getLastRow() < 2) return new Map();
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.masterHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const col = {};
  HOTWORD_V2.masterHeaders.forEach(name => { col[name] = headers.indexOf(name); });
  const value = (row, name) => col[name] === undefined || col[name] < 0 ? '' : row[col[name]];
  const records = new Map();
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues().forEach(row => {
    const appId = String(value(row, 'Steam App ID') || '').trim();
    if (!appId) return;
    const notes = String(value(row, '数据备注') || '').trim();
    records.set(appId, {
      appId,
      name: value(row, '游戏名称') || '',
      url: value(row, 'Steam URL') || '',
      source: value(row, '候选来源') || '',
      sourceRank: value(row, '来源排名') || '',
      releaseRaw: value(row, '发布日原文') || '',
      releaseDate: value(row, 'Steam 发布日期') || '',
      releaseStage: value(row, '发布阶段') || '',
      daysToRelease: value(row, '距发售天数'),
      followers: value(row, 'Steam Followers'),
      baselineFollowers: value(row, '7d基准Followers'),
      gain7d: value(row, 'Steam 7d Gain'),
      growthRate: value(row, '近似增长率'),
      coverageDays: value(row, '增速覆盖天数'),
      reviews: value(row, '评论数'),
      rating: value(row, 'Steam评分'),
      firstRoundType: value(row, '第一轮类型') || '',
      priority: value(row, '第一轮优先级') || '',
      continueNext: value(row, '进入下一步') || '',
      firstRoundReason: value(row, '第一轮判定依据') || '',
      currentStage: value(row, '当前筛选阶段') || '',
      nextAction: value(row, '下一步动作') || '',
      dataNotes: notes ? notes.split(' | ') : []
    });
  });
  return records;
}

function readTodayActionManualContent_(sheet) {
  const out = new Map();
  if (!sheet || sheet.getLastRow() < 4) return out;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.actionHeaders.length);
  const headers = sheet.getRange(3, 1, 1, width).getDisplayValues()[0];
  const appIdColumn = headers.indexOf('Steam App ID');
  const noteColumn = headers.indexOf('人工备注');
  if (appIdColumn < 0 || noteColumn < 0) return out;
  sheet.getRange(4, 1, sheet.getLastRow() - 3, width).getValues().forEach(row => {
    const appId = String(row[appIdColumn] || '').trim();
    if (!appId) return;
    out.set(appId, {manualNote: row[noteColumn] || ''});
  });
  return out;
}

function todayActionDateText_(value, ss) {
  const date = dateAtStart_(value);
  if (!date) return '';
  try {
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
      const timezone = ss && ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Shanghai';
      return Utilities.formatDate(date, timezone, 'yyyy-MM-dd');
    }
  } catch (err) {
    // Fall through to a deterministic local date representation in tests.
  }
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function todayActionDecisionProjection_(rec, decision) {
  const projected = Object.assign({}, decision || {});
  projected.status = normalizeDecisionStatus_(projected.status);
  const isHumanStage = projected.currentStage === '1B完成→人工第二轮';
  projected.researchStatus = isHumanStage ? deriveResearchStatus_(projected) : '';
  if (projected.status === 'BUILD') projected.nextAction = 'Site Build';
  else if (projected.status === 'REJECT' || !isHumanStage) projected.nextAction = 'None';
  else if (projected.status === 'WATCH') projected.nextAction = 'Recheck';
  else if (projected.preflightVerdict === 'MANUAL_REVIEW') {
    projected.nextAction = candidateManualEvidenceNextAction_(rec, projected, candidateExternalSignalIsNew_(projected));
  }
  return projected;
}

function decideTodayActionProjection_(rec, decision, today, rules, ss) {
  const status = normalizeDecisionStatus_(decision && decision.status);
  if (status === 'REJECT') return {include: false, reason: 'Decision=REJECT，只保留在候选决策历史账本'};
  if (status === 'BUILD') return {include: true, isCompleted: true, type: 'BUILD', humanAction: '进入 Site Creation', reason: 'Decision=BUILD，展示机器决定与推荐域名'};
  const action = decideTodayAction_(rec, decision, today, rules);
  if (action.include) return action;

  // Keep the existing trigger/filter decision untouched. A WATCH that is not
  // currently actionable remains visible as a non-task status row so stale
  // NEW/Google Trends rows cannot survive a decision refresh.
  if (normalizeDecisionStatus_(decision && decision.status) !== 'WATCH') return action;
  const due = dateAtStart_(decision && decision.nextRecheckDate);
  const gate = candidateWatchRecheckGate_(rec, decision, today, rules);
  const dueText = todayActionDateText_(decision && decision.nextRecheckDate, ss);
  return {
    include: true,
    isWaiting: true,
    type: 'WATCH_WAITING',
    humanAction: dueText ? '等待 ' + dueText + ' 复查' : '等待复查',
    reason: due && !gate.allowed ? '继续 WATCH，未满足现有 recheck trigger' : 'WATCH，等待复查日'
  };
}

/**
 * Rebuilds 今日行动 from 候选决策. Candidate decisions own all decision,
 * research, signal, stage, and preflight state; the master sheet supplies only
 * the stable candidate facts needed to render a row.
 *
 * @return {{ok:boolean,beforeCount:number,afterCount:number,beforePendingCount:number,afterPendingCount:number}}
 */
function refreshTodayActionsFromCandidateDecisions_(spreadsheet, runTime, runId, counts) {
  const ss = spreadsheet || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  const actionSheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.action) : null;
  if (!ss || !actionSheet) return {ok: false, error: 'today_action_sheet_missing'};
  const decisionSheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  const masterSheet = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (!decisionSheet || !masterSheet) return {ok: false, error: 'candidate_sheet_missing'};

  const now = runTime || new Date();
  const rules = loadRules_(ss);
  const decisions = readCandidateDecisions_(ss);
  const alreadyHandled = buildTodayActionAlreadyHandled_(ss, decisions);
  const masterRecords = readCandidateMasterRecordsForTodayAction_(ss);
  const manualContent = readTodayActionManualContent_(actionSheet);
  const before = countTodayActionRows_(actionSheet);
  const actions = [];
  let handledExcludedCount = 0;
  const handledReasonBreakdown = {
    handledByDecision: 0,
    handledByTrendsResearch: 0,
    handledBySitePool: 0,
    handledByHistory: 0,
    handledByBuildPlan: 0
  };

  masterRecords.forEach(rec => {
    const decision = decisions.get(rec.appId) || {
      appId: rec.appId,
      name: rec.name,
      status: '',
      trendsResult: '',
      socialResult: '',
      serpCompetition: '',
      keywordOpportunity: '',
      currentStage: rec.currentStage,
      nextAction: rec.nextAction
    };
    if (rec.continueNext !== '是') return;
    // Preserve WATCH recheck rows and the existing BUILD/REJECT projection;
    // only suppress a candidate with no Candidate Decision state when a
    // persisted lifecycle/research source already handled its identity.
    if (isTodayActionAlreadyHandled_(rec, alreadyHandled) &&
        !normalizeDecisionStatus_(decision.status)) {
      handledExcludedCount += 1;
      todayActionHandledReasons_(rec, alreadyHandled).forEach(reason => {
        if (Object.prototype.hasOwnProperty.call(handledReasonBreakdown, reason)) handledReasonBreakdown[reason] += 1;
      });
      return;
    }
    const projectedDecision = todayActionDecisionProjection_(rec, decision);
    const projection = decideTodayActionProjection_(rec, projectedDecision, now, rules, ss);
    if (!projection.include) return;
    const preserved = manualContent.get(projectedDecision.appId);
    if (preserved && preserved.manualNote !== '') projectedDecision.manualNote = preserved.manualNote;
    rec.todayAction = projection;
    rec.todayAction.decision = projectedDecision;
    rec.todayAction.lastCheckedDate = projectedDecision.lastCheckedDate;
    actions.push(rec);
  });
  const sampledActions = limitTodayActionSamples_(actions, rules);
  if (typeof ensurePlayerSearchAliasesForTodayActions_ === 'function') {
    ensurePlayerSearchAliasesForTodayActions_(ss, sampledActions);
  }
  sampledActions.sort(compareActions_);

  const summaryCounts = Object.assign({
    discoveredCount: masterRecords.size,
    historyExcludedCount: handledExcludedCount,
    pass1ACount: Array.from(masterRecords.values()).filter(rec => rec.continueNext === '是').length,
    trendCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🔥 趋势候选').length,
    earlyCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🌱 Early候选').length,
    controlCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🏢 大盘对照').length,
    p2TrendCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🟡 Trend Watch').length,
    p2EarlyCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🟢 Early Watch').length,
    anomalyCount: 0
  }, counts || {});
  refreshTodayAction_(ss, sampledActions, now, runId || todayActionRefreshRunId_(ss, now), summaryCounts);
  if (typeof Logger !== 'undefined' && Logger.log && handledExcludedCount) {
    Logger.log(JSON.stringify({todayActionHandledReasonBreakdown: handledReasonBreakdown}));
  }
  const after = countTodayActionRows_(actionSheet);
  return {
    ok: true,
    beforeCount: before.total,
    afterCount: after.total,
    beforePendingCount: before.pending,
    afterPendingCount: after.pending,
    waitingCount: after.waiting,
    handledReasonBreakdown
  };
}

function selectTodayActionQuota_(records, trendType, earlyType, totalLimit, trendLimit, earlyLimit) {
  const ordered = (records || []).slice();
  const selected = [];
  const selectedSet = new Set();
  const takeType = (type, limit) => {
    ordered.filter(rec => rec.firstRoundType === type).slice(0, Math.max(0, limit)).forEach(rec => {
      selected.push(rec);
      selectedSet.add(rec);
    });
  };
  takeType(trendType, trendLimit);
  takeType(earlyType, earlyLimit);

  // Priority quotas are preferred allocations; an undersupplied class lets the
  // other class fill the remaining daily capacity without changing master data.
  ordered.filter(rec => !selectedSet.has(rec) &&
    (rec.firstRoundType === trendType || rec.firstRoundType === earlyType))
    .slice(0, Math.max(0, totalLimit - selected.length))
    .forEach(rec => selected.push(rec));
  return selected;
}

function configuredTodayActionNumber_(rules, key, fallback) {
  const value = Number(rules && rules[key]);
  return isFinite(value) ? value : fallback;
}

function limitTodayActionSamples_(actions, rules) {
  const waiting = (actions || []).filter(rec => rec.todayAction && rec.todayAction.isWaiting);
  const pending = (actions || []).filter(rec => !rec.todayAction || !rec.todayAction.isWaiting);
  const p1 = pending.filter(rec => rec.firstRoundType === '🔥 趋势候选' || rec.firstRoundType === '🌱 Early候选');
  const p2 = pending.filter(rec => rec.firstRoundType === '🟡 Trend Watch' || rec.firstRoundType === '🟢 Early Watch');
  const selected = selectTodayActionQuota_(
    p1, '🔥 趋势候选', '🌱 Early候选',
    configuredTodayActionNumber_(rules, 'P1_MAX_PER_DAY', 6),
    configuredTodayActionNumber_(rules, 'P1_TREND_MAX_PER_DAY', 4),
    configuredTodayActionNumber_(rules, 'P1_EARLY_MAX_PER_DAY', 2)
  ).concat(selectTodayActionQuota_(
    p2, '🟡 Trend Watch', '🟢 Early Watch',
    configuredTodayActionNumber_(rules, 'P2_MAX_PER_DAY', 6),
    configuredTodayActionNumber_(rules, 'P2_TREND_MAX_PER_DAY', 3),
    configuredTodayActionNumber_(rules, 'P2_EARLY_MAX_PER_DAY', 3)
  ));
  const selectedSet = new Set(selected);
  // Existing Control rows remain visible and are not counted against the P1/P2
  // experiment quotas. All non-actionable rows were already excluded upstream.
  pending.forEach(rec => {
    if (rec.firstRoundType === '🏢 大盘对照' && !selectedSet.has(rec)) selected.push(rec);
  });
  // BUILD is a completed machine decision, but remains visible as a handoff
  // reference so the domain recommendation is actionable from 今日行动.
  return dedupeTodayActionByAppId_(waiting.concat(selected).concat(pending.filter(rec =>
    rec.todayAction && rec.todayAction.type === 'BUILD')));
}

function dedupeTodayActionByAppId_(actions) {
  const byAppId = new Map();
  (actions || []).forEach(rec => {
    const appId = String(rec && rec.appId || '').trim();
    if (!appId) return;
    const existing = byAppId.get(appId);
    if (!existing || todayActionRecordPriority_(rec) > todayActionRecordPriority_(existing)) {
      byAppId.set(appId, rec);
    }
  });
  return Array.from(byAppId.values());
}

function todayActionRecordPriority_(rec) {
  const action = rec && rec.todayAction || {};
  const decision = action.decision || {};
  const isBuild = action.type === 'BUILD' || normalizeDecisionStatus_(decision.status) === 'BUILD';
  const hasDomain = String(decision.recommendedDomain || '').trim() !== '' ||
    String(decision.domainPurchaseUrl || '').trim() !== '';
  return (isBuild ? 4 : 0) + (hasDomain ? 2 : 0) + (action.isCompleted ? 1 : 0);
}

// Public Apps Script API wrapper; the implementation remains the single
// underscore-suffixed entry used by the menu, callbacks, and onEdit.
function refreshTodayActionsFromCandidateDecisions() {
  return refreshTodayActionsFromCandidateDecisions_();
}

/**
 * Production-only projection refresh for already persisted BUILD/research data.
 * This deliberately does not run discovery, enrichment, provider research, or
 * any domain recommendation logic. Callback-written fields remain the source
 * of truth; this entry only normalizes their persisted values back through the
 * current 60-column map before rebuilding 今日行动.
 */
function runBuildDecisionDomainRefresh() {
  const ss = SpreadsheetApp.openById(QUALIFICATION_ELIGIBILITY_PRODUCTION_SHEET_ID);
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (!sheet) return {status: 'FAILED', error: 'candidate_sheet_missing'};
  const columnMap = candidateDecisionColumnMap_(sheet);
  const decisions = readCandidateDecisions_(ss);
  const persistedFields = [
    'MachineDecision', 'MachineDecisionReason', 'RecommendedDomain', 'DomainTLD',
    'DomainFirstYearPrice', 'DomainRegistrar', 'DomainPurchaseURL', 'DomainCheckedAt',
    'DomainAlternative1', 'DomainAlternative1Price', 'DomainAlternative1PurchaseURL',
    'DomainAlternative2', 'DomainAlternative2Price', 'DomainAlternative2PurchaseURL'
  ];
  let eligible = 0;
  let synced = 0;
  const firstPersistedColumn = columnMap.byName[persistedFields[0]];
  const persistedWidth = persistedFields.length;
  const persistedRows = sheet.getRange(2, firstPersistedColumn, Math.max(sheet.getLastRow() - 1, 0), persistedWidth).getValues();
  decisions.forEach(function (decision) {
    if (decision.status !== 'BUILD' && decision.autoResearchStatus !== 'COMPLETED') return;
    eligible += 1;
    const rowIndex = decision.rowNumber - 2;
    if (rowIndex < 0 || rowIndex >= persistedRows.length) return;
    const values = candidateDecisionFieldValues_(decision);
    persistedFields.forEach(function (field) {
      const column = columnMap.byName[field];
      if (!column) return;
      const value = values[field];
      if (value !== null && value !== undefined && value !== '') {
        persistedRows[rowIndex][column - firstPersistedColumn] = value;
        synced += 1;
      }
    });
  });
  if (persistedRows.length) {
    sheet.getRange(2, firstPersistedColumn, persistedRows.length, persistedWidth).setValues(persistedRows);
  }
  const actionRefresh = refreshTodayActionsFromCandidateDecisions_(ss, new Date(), 'BUILD-DOMAIN-REFRESH', {});
  return {
    status: actionRefresh.ok ? 'SUCCESS' : 'FAILED',
    eligible,
    synced,
    today_action_refresh: actionRefresh
  };
}

function todayActionRefreshRunId_(ss, runTime) {
  const stamp = todayActionDateText_(runTime, ss).replace(/-/g, '') || 'unknown';
  return 'TODAY-ACTION-' + stamp;
}

function countTodayActionRows_(sheet) {
  const result = {total: 0, pending: 0, waiting: 0};
  if (!sheet || sheet.getLastRow() < 4) return result;
  const width = Math.max(sheet.getLastColumn(), HOTWORD_V2.actionHeaders.length);
  const headers = sheet.getRange(3, 1, 1, width).getDisplayValues()[0];
  const appIdColumn = headers.indexOf('Steam App ID');
  const typeColumn = headers.indexOf('行动类型');
  if (appIdColumn < 0) return result;
  sheet.getRange(4, 1, sheet.getLastRow() - 3, width).getDisplayValues().forEach(row => {
    if (!String(row[appIdColumn] || '').trim()) return;
    result.total += 1;
    if (typeColumn >= 0 && row[typeColumn] === 'WATCH_WAITING') result.waiting += 1;
    else if (typeColumn < 0 || (row[typeColumn] !== 'COMPLETED' && row[typeColumn] !== 'BUILD')) result.pending += 1;
  });
  return result;
}

function refreshTodayAction_(ss, actions, runTime, runId, counts) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.action);

  // 清除旧数据区，保留第1行说明。
  const maxRows = Math.max(sheet.getMaxRows(), 20);
  sheet.getRange(2, 1, maxRows - 1, HOTWORD_V2.actionHeaders.length).clearContent();

  sheet.getRange('A2').setValue('Run ID');
  sheet.getRange('B2').setValue(runId);
  sheet.getRange('C2').setValue('运行时间');
  sheet.getRange('D2').setValue(runTime);
  sheet.getRange('E2').setValue('发现');
  sheet.getRange('F2').setValue(counts.discoveredCount);
  sheet.getRange('G2').setValue('历史排除');
  sheet.getRange('H2').setValue(counts.historyExcludedCount);
  sheet.getRange('I2').setValue('1A通过');
  sheet.getRange('J2').setValue(counts.pass1ACount);
  sheet.getRange('K2').setValue('🔥');
  sheet.getRange('L2').setValue(counts.trendCount);
  sheet.getRange('M2').setValue('🌱');
  sheet.getRange('N2').setValue(counts.earlyCount);
  sheet.getRange('O2').setValue('🏢');
  sheet.getRange('P2').setValue(counts.controlCount);

  sheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).setValues([HOTWORD_V2.actionHeaders]);
  // 表头变更（如新增「搜索别名」）后，旧列的数据验证会错位到 Google Trends 链接列；
  // 写入 HYPERLINK 前必须按当前表头重绑人工字段验证。
  setupTodayActionUi_(ss);

  if (actions.length) {
    const rows = actions.map(rec => actionRow_(rec));
    sheet.getRange(4, 1, rows.length, HOTWORD_V2.actionHeaders.length).setValues(rows);
  }

  applyActionFormatting_(sheet, actions.length);
}

function appendAnomalyRecord_(ss, runTime, runId, rec, phase, type, detail, action) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.anomalies);
  sheet.appendRow([
    runTime,
    runId,
    rec.appId,
    rec.name,
    phase,
    type,
    detail,
    action,
    rec.url
  ]);
}

function appendRunLog_(ss, row) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.log);
  if (!sheet) return;
  sheet.appendRow(row);
}

function compareActions_(a, b) {
  const order = {
    '🔥 趋势候选': 1, '🌱 Early候选': 2, '🏢 大盘对照': 3,
    '🟡 Trend Watch': 4, '🟢 Early Watch': 5
  };
  const oa = order[a.firstRoundType] || 9;
  const ob = order[b.firstRoundType] || 9;
  if (oa !== ob) return oa - ob;
  return Number(b.gain7d || 0) - Number(a.gain7d || 0);
}


// ============================================================================
// 规则读取 + 自动触发器
// ============================================================================

function loadRules_(ss) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.rules);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('规则配置不存在，请先初始化 V2。');

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const out = {};
  rows.forEach(r => {
    const key = String(r[0] || '').trim();
    if (!key) return;
    const value = r[1];
    out[key] = typeof value === 'number' ? value : Number(value);
    if (!isFinite(out[key])) out[key] = value;
  });
  return out;
}

function installDailyHotwordTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupSteamHotwordV2();
  getGamesPopularityApiKey_(); // 没有key则不允许安装。
  const rules = loadRules_(ss);

  removeDailyHotwordTriggers();

  ScriptApp.newTrigger(G010_DAILY_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(Math.max(0, Math.min(23, Math.floor(Number(rules.DAILY_HOUR || 8)))))
    .create();

  safeToast_('每日自动任务已安装。以后只需查看“今日行动”。', 'Steam 0→1B', 7);
}

function removeDailyHotwordTriggers() {
  const handlers = new Set(['runSteamHotword01B', 'runSteamHotwordDaily_', 'runSteamCandidateScan']);
  let removed = 0;

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (handlers.has(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });

  return removed;
}


// ============================================================================
// 格式
// ============================================================================

function applyBasicFormatting_(ss) {
  const headerColor = '#1F4E78';
  const headerFont = '#FFFFFF';

  [
    HOTWORD_V2.sheets.master,
    HOTWORD_V2.sheets.candidateSnapshot,
    HOTWORD_V2.sheets.snapshot,
    HOTWORD_V2.sheets.rules,
    HOTWORD_V2.sheets.anomalies,
    HOTWORD_V2.sheets.log,
    HOTWORD_V2.sheets.history,
    HOTWORD_V2.sheets.decisions,
    HOTWORD_V2.sheets.sitePool,
    HOTWORD_V2.sheets.gscBinding,
    '1B规则回测'
  ].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;

    sheet.setFrozenRows(1);
    const cols = Math.max(1, sheet.getLastColumn());
    sheet.getRange(1, 1, 1, cols)
      .setBackground(headerColor)
      .setFontColor(headerFont)
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  });

  const master = ss.getSheetByName(HOTWORD_V2.sheets.master);
  if (master) {
    master.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    master.getRange('G:G').setNumberFormat('yyyy-mm-dd');
    master.getRange('N:N').setNumberFormat('0.0%');
    master.getRange('R:R').setNumberFormat('0.0%');
    master.getRange('AC:AD').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    master.setFrozenRows(1);
    master.setFrozenColumns(3);
  }

  const snap = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  if (snap) {
    snap.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    snap.getRange('I:I').setNumberFormat('yyyy-mm-dd');
    snap.getRange('N:N').setNumberFormat('0.0%');
    snap.getRange('R:R').setNumberFormat('0.0%');
  }

  const candidateSnap = ss.getSheetByName(HOTWORD_V2.sheets.candidateSnapshot);
  if (candidateSnap) {
    candidateSnap.getRange('A:A').setNumberFormat('yyyy-mm-dd');
    candidateSnap.getRange('G:G').setNumberFormat('0');
    candidateSnap.getRange('H:H').setNumberFormat('0');
    candidateSnap.getRange('I:I').setNumberFormat('0.0%');
    candidateSnap.getRange('K:K').setNumberFormat('yyyy-mm-dd');
    candidateSnap.setFrozenRows(1);
    candidateSnap.setFrozenColumns(4);
  }

  const rules = ss.getSheetByName(HOTWORD_V2.sheets.rules);
  if (rules) {
    rules.setFrozenRows(1);
    rules.autoResizeColumns(1, 5);
  }

  const decisions = ss.getSheetByName(HOTWORD_V2.sheets.decisions);
  if (decisions) {
    decisions.getRange('D:D').setNumberFormat('yyyy-mm-dd');
    decisions.getRange('G:G').setNumberFormat('yyyy-mm-dd');
    decisions.getRange('J:J').setNumberFormat('yyyy-mm-dd');
    decisions.getRange('U:U').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  const sitePool = ss.getSheetByName(HOTWORD_V2.sheets.sitePool);
  if (sitePool) {
    const poolHeaders = sitePool.getRange(1, 1, 1, HOTWORD_V2.sitePoolHeaders.length).getDisplayValues()[0];
    const poolFormat = (name, format) => {
      const col = poolHeaders.indexOf(name) + 1;
      if (col > 0) sitePool.getRange(1, col, sitePool.getMaxRows(), 1).setNumberFormat(format);
    };
    poolFormat('BUILD日期', 'yyyy-mm-dd hh:mm:ss');
    poolFormat('上线日期', 'yyyy-mm-dd hh:mm:ss');
    poolFormat('ActualLiveAt', 'yyyy-mm-dd hh:mm:ss');
    poolFormat('首次曝光日期', 'yyyy-mm-dd');
    poolFormat('CTR', '0.0%');
    poolFormat('Average Position', '0.0');
  }
}

function applyActionFormatting_(sheet, dataRows) {
  sheet.setFrozenRows(3);

  // 核心判断区固定在左侧；标题行不合并，避免冻结边界切过合并单元格。
  sheet.setFrozenColumns(5);

  sheet.getRange(1, 1, 1, HOTWORD_V2.actionHeaders.length)
    .setBackground('#0F766E')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('left');

  sheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length)
    .setBackground('#1F4E78')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  const headers = sheet.getRange(3, 1, 1, HOTWORD_V2.actionHeaders.length).getDisplayValues()[0];
  const setFormat = (name, format) => {
    const col = headers.indexOf(name) + 1;
    if (col > 0) sheet.getRange(4, col, Math.max(dataRows, 1), 1).setNumberFormat(format);
  };
  sheet.getRange('D2:D2').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (dataRows > 0) {
    setFormat('上次人工检查日', 'yyyy-mm-dd');
    setFormat('Steam发布日期', 'yyyy-mm-dd');
    setFormat('距发售天数', '0');
    setFormat('Steam Followers', '0');
    setFormat('Steam 7d Gain', '0');
    setFormat('近似增长率', '0.0%');
    setFormat('评论数', '0');
    setFormat('Steam评分', '0.0');
    setFormat('首年价', '$0.00');

    const typeColumn = headers.indexOf('第一轮类型') + 1;
    const typeRange = sheet.getRange(4, typeColumn, dataRows, 1);
    const types = typeRange.getDisplayValues();
    types.forEach((r, idx) => {
      const cell = sheet.getRange(idx + 4, typeColumn);
      if (r[0] === '🔥 趋势候选') cell.setBackground('#FCE8E6');
      else if (r[0] === '🌱 Early候选') cell.setBackground('#E6F4EA');
      else if (r[0] === '🏢 大盘对照') cell.setBackground('#E8F0FE');
      else if (r[0] === '🟡 Trend Watch') cell.setBackground('#FFF2CC');
      else if (r[0] === '🟢 Early Watch') cell.setBackground('#E2F0D9');
    });
  }

  const widths = [18, 12, 34, 14, 18, 16, 16, 14, 14, 15, 12, 12, 12, 20, 24, 18, 18, 18, 18, 18, 36, 22, 16, 16, 22, 34, 16, 48, 55];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, Math.min(420, w * 8)));
}


// ============================================================================
// 通用工具
// ============================================================================

function ensureSheetWithHeaders_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const empty = current.every(v => !String(v).trim());

  if (empty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // 如果V2升级增加了列，按当前位置补齐标题，不覆盖已有数据。
    headers.forEach((h, i) => {
      if (!String(sheet.getRange(1, i + 1).getDisplayValue()).trim()) {
        sheet.getRange(1, i + 1).setValue(h);
      }
    });
  }
  return sheet;
}

function normalizeGameName_(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[™®©]/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function stripTags_(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml_(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ');
}

function isFiniteNumber_(value) {
  return value !== null && value !== '' && value !== undefined && isFinite(Number(value));
}

function formatPercentText_(value) {
  return (Number(value) * 100).toFixed(1) + '%';
}

function addDataNote_(rec, note) {
  if (!note) return;
  if (!Array.isArray(rec.dataNotes)) rec.dataNotes = [];
  if (!rec.dataNotes.includes(note)) rec.dataNotes.push(note);
}

function safeToast_(message, title, seconds) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) ss.toast(message, title, seconds);
  } catch (e) {
    // 时间触发器无交互上下文时忽略 toast。
  }
}
