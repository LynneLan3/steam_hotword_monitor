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
    trendsResearch: 'Trends研究记录'
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

  masterHeaders: [
    '最后扫描时间', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名',
    'Steam 发布日期', '发布日原文', '发布阶段', '距发售天数',
    'Steam Followers', '7d基准Followers', 'Steam 7d Gain', '近似增长率', '增速覆盖天数',
    '评论数', '好评数', 'Steam评分',
    '1A结果', '1A排除原因', '第一轮类型', '第一轮优先级', '进入下一步', '下一步动作',
    '第一轮判定依据', '当前筛选阶段', '数据状态', '数据备注',
    '首次发现日期', '最后发现日期', '最近Run ID', '人工备注'
  ],

  snapshotHeaders: [
    '运行时间', 'Run ID', 'Steam App ID', '游戏名称', 'Steam URL', '候选来源', '来源排名',
    '发布阶段', 'Steam 发布日期', '距发售天数',
    'Steam Followers', '7d基准Followers', 'Steam 7d Gain', '近似增长率', '增速覆盖天数',
    '评论数', '好评数', 'Steam评分',
    '1A结果', '1A排除原因', '第一轮类型', '第一轮优先级', '进入下一步', '下一步动作',
    '数据状态', '数据备注'
  ],

  anomalyHeaders: [
    '运行时间', 'Run ID', 'Steam App ID', '游戏名称', '阶段', '异常类型', '异常详情', '建议动作', 'Steam URL'
  ],

  logHeaders: [
    '运行时间', 'Run ID', '运行状态', '发现唯一游戏', '历史排除', '数据补全成功',
    '1A通过', '1A排除', '🔥趋势', '🌱Early', '🏢对照', '⚪低优先级', '数据异常',
    '今日行动数', '耗时秒', '错误/警告'
  ],

  actionHeaders: [
    '行动类型', '优先级', '游戏名称', 'Steam App ID', '第一轮类型',
    'Steam Followers', 'Steam 7d Gain', '近似增长率',
    '发布阶段', 'Steam发布日期', '距发售天数', '评论数', 'Steam评分',
    'Google Trends链接', 'Trends结果', 'Social结果', 'SERP竞争', '关键词机会', 'Decision', '人工备注',
    '当前阶段', '研究状态', '研究完成度', '人工动作', '触发原因', '上次人工检查日',
    'Steam URL', '判定依据'
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
    // Candidate External Signal Loop v1：append-only structured Trends summary.
    'TrendRelativeStrength', 'TrendVerdict', 'TrendLastChecked', 'ExternalSignal', 'FinalResearchStage',
    // Steam Candidate automatic preflight; append-only and human-readable.
    'PreflightVerdict', 'PreflightCheckedAt', 'PreflightReason'
  ],

  /** Site ID is a cross-system reference; Steam runtime preserves existing values and never rewrites them. */
  sitePoolHeaders: ['Site ID', '游戏名称', 'Steam App ID', '当前状态', 'BUILD日期', 'Build状态', 'Repo URL', 'Vercel URL', '上线日期', '模板版本', 'GSC状态', 'GSC Site', 'GSC URL Prefix', 'GSC Last Sync', 'SEO阶段', 'Index状态', '首次曝光日期', 'Clicks', 'Impressions', 'CTR', 'Average Position'],
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
  RECOMMEND_REJECT: true
};
const STEAM_CANDIDATE_RESEARCH_CONFIDENCES = { HIGH: true, MEDIUM: true, LOW: true };


// ============================================================================
// 菜单 + 兼容入口
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Steam 0→1B')
    .addItem('① 初始化 V2', 'setupSteamHotwordV2')
    .addItem('整理工作表视图', 'organizeSheetUi')
    .addItem('② 设置 Games Popularity API Key', 'setGamesPopularityApiKey')
    .addItem('③ 检查 API Key', 'checkGamesPopularityApiKey')
    .addSeparator()
    .addItem('▶ 立即运行 0→1B', 'runSteamHotword01B')
    .addItem('刷新今日行动', 'refreshTodayActionsFromCandidateDecisions')
    .addItem('M7A 安全恢复 Candidate Research', 'recoverSteamCandidateResearch')
    .addItem('回测 1B 规则', 'runFirstRoundBacktest')
    .addSeparator()
    .addItem('安装每日自动触发器', 'installDailyHotwordTrigger')
    .addItem('删除每日自动触发器', 'removeDailyHotwordTriggers')
    .addToUi();
}

/** Read-only Steam Candidate Research queue endpoint. */
function doGet(e) {
  const action = e && e.parameter ? String(e.parameter.action || '').trim() : '';
  if (action === 'pendingSteamCandidateResearchJobs') {
    return ContentService
      .createTextOutput(JSON.stringify({ jobs: loadPendingSteamCandidateResearchJobs_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ error: 'unknown_action', jobs: [] }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Web App POST: accepts only the Steam Candidate Research callback contract. */
function doPost(e) {
  try {
    const body = steamCandidateResearchParsePostJson_(e);
    if (!body) return steamCandidateResearchJsonOutput_({ok: false, error: 'invalid_json'});
    if (!checkSteamCandidateResearchWriteToken_(e, body)) {
      return steamCandidateResearchJsonOutput_({ok: false, error: 'unauthorized'});
    }
    if (String(body.job_type || '').trim().toUpperCase() !== STEAM_CANDIDATE_RESEARCH_JOB_TYPE) {
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
  if (steamCandidateResearchCallbackString_(body.preflight_verdict)) {
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
  let text = steamCandidateResearchCallbackString_(summary.status).toUpperCase() +
    ' | evidence=' + summary.evidence_count +
    ' | clusters=' + summary.cluster_count +
    ' | actionable=' + summary.actionable_cluster_count;
  if (topics.length) text += ' | ' + topics.join(' / ');
  return text;
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
      '自动Recommendation理由', '自动缺失证据', '自动Recommendation结果路径'].forEach(function (field) {
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
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Social摘要', steamCandidateResearchSocialSummary_(body.social_summary));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动SERP摘要', steamCandidateResearchSerpSummary_(body.serp_summary));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation', body.recommendation);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation置信度', body.confidence);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation理由', steamCandidateResearchJoin_(body.reasons));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动缺失证据', steamCandidateResearchJoin_(body.missing_evidence));
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动Recommendation结果路径', body.recommendation_result_path);
  steamCandidateResearchSetAutomaticField_(sheet, decision.rowNumber, '自动研究错误', '');
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
    'Google Trends结果': decision.trendsResult,
    'Social结果': decision.socialResult,
    'SERP竞争': decision.serpCompetition,
    '关键词机会': decision.keywordOpportunity,
    '人工备注': decision.manualNote,
    'Decision': decision.status,
    'Decision日期': decision.decisionDate,
    'Next Action': decision.nextAction,
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

function setupSteamHotwordV2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.master, HOTWORD_V2.masterHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.snapshot, HOTWORD_V2.snapshotHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.anomalies, HOTWORD_V2.anomalyHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.log, HOTWORD_V2.logHeaders);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.history, ['Steam App ID', '游戏名称', 'Steam URL', '当前阶段', '备注']);
  ensureCandidateDecisionSchema_(ss);
  ensureSitePoolSchema_(ss);
  setupSitePoolUi_(ss);
  ensureSheetWithHeaders_(ss, HOTWORD_V2.sheets.gscBinding, HOTWORD_V2.gscBindingHeaders);
  setupGscBindingUi_(ss);
  ensureExternalSignalSheets_(ss);
  repairCandidateDecisionSchemaData_(ss);
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

    ['FOLLOWER_HISTORY_MIN_DAYS', 5, '天', '至少需要多少天Followers历史才做1B', '防止把1–2天增长误当7d Gain'],
    ['RECHECK_GAIN_GROWTH_MIN', 0.30, '比例', 'WATCH候选重新进入今日行动所需的7d Gain增长', '候选人工复查 V1'],
    ['WATCH_RECHECK_DAYS_STRONG', 3, '天', '强信号 WATCH 的默认复查间隔', '候选人工复查 V1'],
    ['WATCH_RECHECK_DAYS_NORMAL', 7, '天', '普通 WATCH 的默认复查间隔', '候选人工复查 V1'],
    ['DISCOVERY_PAGES', 1, '页/来源', '每个Steam来源抓取页数', '当前每页约50条，V2默认1页'],
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
}

function setupActionSheet_(ss) {
  let sheet = ss.getSheetByName(HOTWORD_V2.sheets.action);
  if (!sheet) sheet = ss.insertSheet(HOTWORD_V2.sheets.action, 0);

  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).breakApart();
  if (!sheet.getRange('A1').getDisplayValue()) {
    sheet.getRange('A1').setValue('今日行动：只看首次或需要复查的 1B 候选；从这里开始手动做 Google Trends / Social');
  }
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
  const decisionCol = col('Decision');
  // V3.3 列重排迁移：旧列（例如 W 列）的验证规则不能继续作用于新列。
  // 先清空今日行动数据区的全部验证，再按当前表头重新绑定人工字段。
  sheet.getRange(4, 1, Math.max(sheet.getMaxRows() - 3, 1), sheet.getMaxColumns()).clearDataValidations();
  const editableOptions = {
    'Trends结果': ['强', '中', '弱', '无', '未检查'],
    'Social结果': ['强', '中', '弱', '无', '未检查'],
    'SERP竞争': ['低', '中', '高', '未检查'],
    '关键词机会': ['有', '无', '未检查'],
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
  validation('Next Action', ['Google Trends', 'Social验证', 'SERP检查', 'Keyword Research', 'Site Build', 'Recheck', 'None']);

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
    '今日行动：每天主要入口。这里只有值得进入第二轮验证的候选。进入今日行动 ≠ 一定建站。',
    '候选决策：后台自动同步数据库，以 Steam App ID 唯一标识；日常无需打开或人工编辑。',
    '每天操作：1.只打开今日行动；2.点击 Google Trends 链接；3.在同一行选择 Trends、Social、SERP、Keyword 结果；4.最后选择 BUILD / WATCH / REJECT；5.必要时写一句人工备注。其余字段自动记录。',
    '今日行动复查规则：无人工记录的1B候选标记 NEW；WATCH 仅在到期或当前7d Gain较上次检查增长至少30%时出现；BUILD / REJECT 不再出现。',
    '指标说明：数据字典。查字段来源、公式、是否实验规则；不是每日操作入口。',
    '候选主表：系统当前所有候选及自动计算结果。用来回答“为什么推荐 / 为什么过滤”，不是每天逐行浏览的工作表。',
    '建站关键词规划：只有人工二次验证确认值得 BUILD 或重点 WATCH 后才进入。把游戏机会 → 搜索意图 → 页面结构 → URL / Page Type。不是候选发现入口。',
    '规则配置：当前 1A / 1B 参数。这些是热词站项目当前实验规则，不是 Steam / Google / SEO 行业官方标准。不要为了日常候选结果随意修改。',
    '1B规则回测：观察历史样本是否仍支持当前规则。不是每日运营页。',
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
      '覆盖天数 < 最低天数时本轮不做 1B 分类，记入数据异常。'
    ],
    [
      '近似增长率',
      '候选主表 / 今日行动 / 1B规则回测',
      '系统计算',
      '系统公式（computeFollowerGrowth_）',
      '(当前 Followers − 历史基准 Followers) ÷ 当前 Followers；即 Gain ÷ 当前 Followers',
      '1B 相对增速分类（与绝对 Gain 一起用）',
      '是（1B）',
      '🔥 ≥10%；🌱 ≥17.5%；🏢 增长率须 <10%（默认）',
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


// ============================================================================
// 主流程 0 → 1B
// ============================================================================

function runSteamHotword01B() {
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
        'LockService：已有完整抓取 run 在执行，本轮被阻止（防止手动与定时重叠）'
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

  let status = 'SUCCESS';
  let discoveredCount = 0;
  let historyExcludedCount = 0;
  let enrichedSuccessCount = 0;
  let pass1ACount = 0;
  let excluded1ACount = 0;
  let trendCount = 0;
  let earlyCount = 0;
  let controlCount = 0;
  let lowCount = 0;
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

    const gpKey = getGamesPopularityApiKey_();

    // ------------------------------------------------------------------------
    // 0A. 发现候选
    // ------------------------------------------------------------------------
    const discovery = discoverSteamCandidates_(rules.DISCOVERY_PAGES, warnings, discoveryNotes);
    const discovered = discovery.items;
    discoveredCount = discovered.length;

    if (discovery.usedCache) {
      status = 'PARTIAL';
    }

    if (discoveredCount === 0) {
      throw new Error('两个 Steam 发现来源都没有解析到游戏，停止本轮。');
    }

    // ------------------------------------------------------------------------
    // 0B. 历史去重（使用同步之后的历史库）
    // ------------------------------------------------------------------------
    const active = [];

    for (const item of discovered) {
      if (isInHistoryIndex_(item, historyIndex)) {
        historyExcludedCount += 1;
        continue;
      }

      active.push(createCandidateRecord_(item));
    }

    // ------------------------------------------------------------------------
    // 0C. Followers 当前值（Games Popularity latest）
    // ------------------------------------------------------------------------
    const latestMap = fetchGamesPopularityLatestBatch_(active, gpKey, warnings);

    for (const rec of active) {
      const latest = latestMap.get(rec.appId);
      if (!latest) {
        rec.dataStatus = '⚠ 数据缺失';
        addDataNote_(rec, 'Games Popularity latest 无数据');
        continue;
      }

      if (latest.followers && isFiniteNumber_(latest.followers.followers)) {
        rec.followers = Number(latest.followers.followers);
      } else {
        rec.dataStatus = '⚠ 数据缺失';
        addDataNote_(rec, '缺少 Followers 当前值');
      }
    }

    // ------------------------------------------------------------------------
    // 0D. 解析发售日 / 发布阶段
    // ------------------------------------------------------------------------
    for (const rec of active) {
      fillReleaseStage_(rec, startedAt, tz);
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
    // 1B 前置：仅对 1A 通过的对象拉 Followers 历史
    // ------------------------------------------------------------------------
    const followerHistoryMap = fetchGamesPopularityFollowersBatch_(pass1A, gpKey, warnings);

    const eligibleFor1B = [];

    for (const rec of pass1A) {
      const payload = followerHistoryMap.get(rec.appId);
      const growth = computeFollowerGrowth_(payload, rec.followers, startedAt, rules.FOLLOWER_HISTORY_MIN_DAYS);

      if (!growth.ok) {
        rec.dataStatus = '⚠ 增速数据不足';
        addDataNote_(rec, growth.reason);
        rec.firstRoundType = '⚠ 增速数据不足';
        rec.priority = '待补数据';
        rec.continueNext = '否（本轮）';
        rec.nextAction = '等待 Followers 历史达到最少天数后自动重算';
        rec.currentStage = '1B待数据';

        anomalyCount += 1;
        appendAnomalyRecord_(ss, startedAt, runId, rec, '1B', 'Followers历史不足', growth.reason, rec.nextAction);
        continue;
      }

      rec.baselineFollowers = growth.baselineFollowers;
      rec.gain7d = growth.gain;
      rec.growthRate = growth.growthRate;
      rec.coverageDays = growth.coverageDays;
      rec.dataStatus = rec.dataStatus === '⚠ 数据缺失' ? rec.dataStatus : 'OK';
      eligibleFor1B.push(rec);
      enrichedSuccessCount += 1;
    }

    // ------------------------------------------------------------------------
    // 1B. 先分趋势 / Early / 对照候选 / 低优先级
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

    // ------------------------------------------------------------------------
    // 输出
    // ------------------------------------------------------------------------
    upsertMaster_(ss, active, startedAt, runId);
    appendSnapshots_(ss, active, startedAt, runId);

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
      anomalyCount
    });
    actionCount = actionRefresh && actionRefresh.afterPendingCount || 0;

    // 使用了 source cache，或有 warnings，但主链路能完成 → PARTIAL（不可伪装 SUCCESS）。
    if (discovery.usedCache || warnings.length > 0) status = 'PARTIAL';

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
      logMessage
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
        failMsg
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

function discoverSteamCandidates_(pagesPerSource, warnings, fetchLogs) {
  const pages = Math.max(1, Math.floor(Number(pagesPerSource || 1)));
  const merged = new Map();
  let usedCache = false;
  const degradeNotes = Array.isArray(warnings) ? warnings : [];
  const logs = Array.isArray(fetchLogs) ? fetchLogs : degradeNotes;

  for (const source of HOTWORD_V2.sources) {
    const sourceResult = fetchSteamSourceWithFallback_(source, pages, degradeNotes, logs);
    if (sourceResult.fromCache) usedCache = true;

    sourceResult.items.forEach((item, idx) => {
      const key = String(item.appId);
      // 缓存回放时保留首次发现时的 sourceRank；实时抓取按页序重算。
      const sourceRank = sourceResult.fromCache && item._sourceRank
        ? item._sourceRank
        : idx + 1;

      if (!merged.has(key)) {
        merged.set(key, {
          appId: key,
          name: item.name,
          url: item.url,
          releaseRaw: item.releaseDate || item.releaseRaw || '',
          reviewCount: isFiniteNumber_(item.reviewCount) ? Number(item.reviewCount) : null,
          reviewRating: isFiniteNumber_(item.reviewRating) ? Number(item.reviewRating) : null,
          sources: [source.name],
          ranks: [source.name + '#' + sourceRank]
        });
      } else {
        const existing = merged.get(key);
        if (!existing.sources.includes(source.name)) existing.sources.push(source.name);
        existing.ranks.push(source.name + '#' + sourceRank);
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
    usedCache: usedCache
  };
}

/**
 * 抓取单个 Steam source；403/429 最终失败时尝试 <24h 缓存。
 */
function fetchSteamSourceWithFallback_(source, pages, warnings, fetchLogs) {
  let lastHttpStatus = null;
  let lastErrorMessage = '';
  const logs = Array.isArray(fetchLogs) ? fetchLogs : warnings;

  try {
    const liveItems = fetchSteamSourcePagesLive_(source, pages, logs);
    const cacheSaved = saveSteamSourceCache_(source.name, liveItems);
    logs.push(
      'source=' + source.name +
      ' | result=LIVE_OK' +
      ' | pages=' + pages +
      ' | items=' + liveItems.length +
      ' | cache=false' +
      ' | cacheSaved=' + cacheSaved
    );
    return { items: liveItems, fromCache: false };
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

    return { items: cached.items, fromCache: true };
  }
}

function fetchSteamSourcePagesLive_(source, pages, fetchLogs) {
  const allItems = [];

  for (let page = 1; page <= pages; page++) {
    // V2.2：
    // Steam 基础榜单 URL（不带 page=1）实际会返回约 50 条；
    // 显式追加 page=1 时，Steam 当前只返回约 25 条。
    // 因此第一页必须使用原始 URL；只有第二页及以后才追加 page 参数。
    const url = page === 1
      ? source.url
      : source.url + (source.url.includes('?') ? '&' : '?') + 'page=' + page;

    const fetched = fetchSteamSearchPageReliable_(source.name, url, page, fetchLogs);
    const items = parseSteamSearchResults_(fetched.body);
    if (items.length === 0) {
      throw new Error(source.name + ' 第' + page + '页解析结果为0');
    }

    // V2.2：第一页使用原始榜单 URL，正常应接近 50 条。
    // 如果只解析到明显偏少的数据，不再继续生成“看似成功但漏掉一半候选”的结果。
    if (page === 1 && items.length < 40) {
      throw new Error(
        source.name + ' 第1页仅解析到 ' + items.length +
        ' 条，低于完整性下限40。停止本轮，避免漏候选。'
      );
    }

    items.forEach((item, idx) => {
      item._sourceRank = (page - 1) * 50 + idx + 1;
      allItems.push(item);
    });
  }

  return allItems;
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
    k: item._sourceRank || null
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
      _sourceRank: row.k || row._sourceRank || null
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

    const releaseMatch = row.match(/<div\b[^>]*class=["'][^"']*\bsearch_released\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    const name = decodeHtml_(stripTags_(titleMatch[1])).trim();
    const releaseDate = releaseMatch ? decodeHtml_(stripTags_(releaseMatch[1])).trim() : '';
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

function createCandidateRecord_(item) {
  return {
    appId: String(item.appId),
    name: item.name,
    url: item.url,
    source: item.sources.join(' + '),
    sourceRank: item.ranks.join(' + '),
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
    controlOnly: false
  };
}


// ============================================================================
// 0：Games Popularity + Steam Reviews 数据补全
// ============================================================================

function fetchGamesPopularityLatestBatch_(records, apiKey, warnings) {
  const map = new Map();
  const requests = records.map(rec => ({
    url: HOTWORD_V2.gpBase + '/game/latest/' + encodeURIComponent(rec.appId) + '?apiKey=' + encodeURIComponent(apiKey),
    muteHttpExceptions: true,
    method: 'get'
  }));

  const responses = fetchAllInChunks_(requests, 40, 150);

  responses.forEach((resp, idx) => {
    const rec = records[idx];
    const code = resp.getResponseCode();

    if (code === 200) {
      try {
        map.set(rec.appId, JSON.parse(resp.getContentText()));
      } catch (e) {
        warnings.push('GP latest JSON异常 ' + rec.appId + ' ' + rec.name);
      }
    } else if (code === 404) {
      warnings.push('GP数据集无此App ' + rec.appId + ' ' + rec.name);
    } else {
      warnings.push('GP latest HTTP ' + code + ' ' + rec.appId + ' ' + rec.name);
    }
  });

  return map;
}

function fetchGamesPopularityFollowersBatch_(records, apiKey, warnings) {
  const map = new Map();
  const requests = records.map(rec => ({
    url: HOTWORD_V2.gpBase + '/game/followers/' + encodeURIComponent(rec.appId) + '?apiKey=' + encodeURIComponent(apiKey),
    muteHttpExceptions: true,
    method: 'get'
  }));

  const responses = fetchAllInChunks_(requests, 40, 150);

  responses.forEach((resp, idx) => {
    const rec = records[idx];
    const code = resp.getResponseCode();

    if (code === 200) {
      try {
        map.set(rec.appId, JSON.parse(resp.getContentText()));
      } catch (e) {
        warnings.push('GP followers JSON异常 ' + rec.appId + ' ' + rec.name);
      }
    } else if (code === 404) {
      warnings.push('GP followers无历史 ' + rec.appId + ' ' + rec.name);
    } else {
      warnings.push('GP followers HTTP ' + code + ' ' + rec.appId + ' ' + rec.name);
    }
  });

  return map;
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

  return {
    type: '⚪ 低优先级',
    reason: '未同时满足趋势、Early或大盘对照规则；7d Gain=' + gain +
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
 * @return {{query: string, status: string}}
 */
function buildTrendsQuery_(gameName) {
  const raw = String(gameName || '').trim();
  if (!raw) return {query: '', status: TRENDS_QUERY_STATUS_.AUTO};

  let working = stripTrendsNoise_(raw);
  const hadVersionHint = TRENDS_VERSION_HINT_RE_.test(raw);

  TRENDS_STORE_EDITION_SUFFIX_RES_.forEach(re => {
    working = working.replace(re, '').trim();
  });

  working = working.replace(/\s*[-–—]\s*$/, '').trim();

  const aliasCandidates = [];
  let coreName = cleanTrendsDisplayName_(working);
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
  return type === '🔥 趋势候选' || type === '🌱 Early候选';
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
  const trends = String(decision && decision.trendsResult || '').trim();
  const trendsDone = hasCompletedManualResearchValue_(trends);
  if (!trendsDone) return 'Google Trends';
  const trendWeak = trends === '弱' || trends === '无';
  if (trendWeak && !allowWeakTrendRecheck) return 'Recheck';
  if ((rec && rec.firstRoundType === '🌱 Early候选') && trendWeak &&
      !hasCompletedManualResearchValue_(decision.socialResult)) return 'Social验证';
  const stage = String(decision && decision.finalResearchStage || '').trim().toUpperCase();
  if (stage === 'SERP_PROBE' && !hasCompletedManualResearchValue_(decision.serpCompetition)) return 'SERP检查';
  if (stage === 'KEYWORD_RESEARCH' && !hasCompletedManualResearchValue_(decision.keywordOpportunity)) return 'Keyword Research';
  if (!hasCompletedManualResearchValue_(decision.keywordOpportunity)) return 'Keyword Research';
  if (!hasCompletedManualResearchValue_(decision.serpCompetition)) return 'SERP检查';
  return 'Recheck';
}

function candidateManualEvidenceNeedsNoProvider_(rec, decision, allowWeakTrendRecheck) {
  const trendsDone = hasCompletedManualResearchValue_(decision && decision.trendsResult);
  if (!trendsDone) return false;
  const nextAction = candidateManualEvidenceNextAction_(rec, decision, allowWeakTrendRecheck);
  return nextAction !== 'Google Trends';
}

function decideTodayAction_(rec, decision, today, rules) {
  if (rec.continueNext !== '是') return {include: false};
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
    if (!isManualReview && candidateManualEvidenceNeedsNoProvider_(rec, decision, candidateExternalSignalIsNew_(decision))) return {include: false};
    const manualEvidenceAction = candidateManualEvidenceNextAction_(rec, decision, candidateExternalSignalIsNew_(decision));
    if (manualEvidenceAction === 'Recheck') return {include: false};
    if (decision && (decision.researchStatus === '研究中' || decision.researchStatus === '已完成')) {
      return {include: true, type: 'RESEARCHING', reason: decision.researchStatus === '已完成' ? '已完成研究但尚未填写最终Decision' : '人工研究尚未完成', humanAction: manualEvidenceAction};
    }
    if (isManualReview && hasCompletedManualResearchValue_(decision && decision.trendsResult)) {
      return {include: true, type: 'RESEARCHING', reason: 'Preflight要求人工继续研究', humanAction: manualEvidenceAction};
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
  const fields = [decision && decision.trendsResult, decision && decision.socialResult, decision && decision.serpCompetition, decision && decision.keywordOpportunity];
  return fields.every(isUnfinishedResearchValue_) ? '待研究' : '研究中';
}

function deriveResearchCompletion_(decision) {
  const status = deriveResearchStatus_(decision);
  return status === '已完成' ? '已完成' : status === '研究中' ? '进行中' : '未开始';
}

function deriveHumanAction_(rec, decision, isWatchRecheck) {
  if (isWatchRecheck) return '重新验证趋势变化';
  const action = candidateManualEvidenceNextAction_(rec, decision, candidateExternalSignalIsNew_(decision));
  if (action === 'Google Trends') return '检查 Google Trends';
  if (action === 'Social验证') return '检查 Social';
  if (action === 'SERP检查') return '检查 SERP';
  if (action === 'Keyword Research') return '检查关键词';
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

function siteIdFromGameName_(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').replace(/-+/g, '-') || '';
}

/**
 * Steam Candidate Opportunity identity.
 * The game_id deliberately reuses the existing Site ID/canonical slug logic;
 * Steam App ID is the runtime key that decides whether this value is created
 * or reused. The fixed 001 sequence is not a run counter.
 */
function opportunityIdFromSteamCandidate_(gameName, appId) {
  const normalizedAppId = String(appId || '').trim();
  const gameId = siteIdFromGameName_(gameName);
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

function upsertSitePoolRecord_(ss, gameName, appId, buildDate) {
  const sheet = ensureSitePoolSchema_(ss);
  const siteId = siteIdFromGameName_(gameName);
  const normalizedAppId = String(appId || '').trim();
  if (!isSiteIdContractValue_(siteId) || !normalizedAppId) {
    logSitePoolIdentityIssue_('Site Pool upsert skipped: Site ID and Steam App ID are required.');
    return null;
  }
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, HOTWORD_V2.sitePoolHeaders.length).getValues();
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
      existing[17] || '', existing[18] || '', existing[19] || '', existing[20] || ''];
    sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
    upsertGscBindingRecord_(ss, row[0], row[1], row[2], row[7]);
    return row;
  }
  const row = [siteId, gameName, normalizedAppId, 'BUILD_PENDING', buildDate, 'BUILD_PENDING', '', '', '', '', 'NOT_CONNECTED', '', '', '', 'WAITING_INDEX', 'UNKNOWN', '', '', '', '', ''];
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
  const lastSync = latestDataIndex >= 0 && row[latestDataIndex] ? row[latestDataIndex] : runDateIndex >= 0 ? row[runDateIndex] || '' : '';
  const clicks = clicksIndex >= 0 ? numberOrZero_(row[clicksIndex]) : 0;
  const impressions = impressionsIndex >= 0 ? numberOrZero_(row[impressionsIndex]) : 0;
  const ctr = ctrIndex >= 0 ? numberOrZero_(row[ctrIndex]) : 0;
  const averagePosition = positionIndex >= 0 ? numberOrZero_(row[positionIndex]) : 0;
  return {
    siteId: String(requestedSiteId || ''), clicks, impressions, ctr, averagePosition, lastSync,
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  const requiredColumns = ['Site ID', 'GSC Last Sync', 'Clicks', 'Impressions', 'CTR', 'Average Position', 'SEO阶段'];
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
    const seoColumn = poolColumn('SEO阶段');
    if (String(previous.seoStage || '').trim() !== 'FAILED') {
      poolSheet.getRange(rowNumber, seoColumn + 1).setValue(calculateSeoStage(snapshot, previous));
    }
    result.updated++;
  });
  return result;
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
    const oneAResult = String(masterRow[masterCol['1A结果']] || '').trim().toUpperCase();
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
        (persistedStatus === 'WATCH' && !steamCandidatePreflightDue_(decision, now))) {
      skipped += 1;
      return;
    }
    const candidateRec = {
      gain7d: masterRow[masterCol['Steam 7d Gain']],
      firstRoundType: masterRow[masterCol['第一轮类型']]
    };
    if (persistedStatus === 'WATCH') {
      const watchGate = candidateWatchRecheckGate_(candidateRec, decision, now, rules);
      if (watchGate.due && !watchGate.allowed) {
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
      '自动Recommendation结果路径', '自动研究错误', 'PreflightCheckedAt', 'PreflightReason']
      .forEach(field => candidateDecisionSetField_(decisionSheet, rowNumber, field, '', decisionCol));
    candidateDecisionSetField_(decisionSheet, rowNumber, 'PreflightVerdict', STEAM_PREFLIGHT_ENABLED ? 'PENDING' : '', decisionCol);
    createdJobIds.add(job.job_id);
    created.push(job);
  });

  return { created: created.length, skipped: skipped, jobs: created };
}

function loadPendingSteamCandidateResearchJobs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    if (status === 'WATCH' && !steamCandidatePreflightDue_(decision, new Date())) return;
    const candidateRec = {
      gain7d: masterRow[masterCol['Steam 7d Gain']],
      firstRoundType: masterRow[masterCol['第一轮类型']]
    };
    if (status === 'WATCH') {
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
        autoRecommendation: '', autoRecommendationConfidence: '', autoRecommendationReasons: '', autoMissingEvidence: '', autoRecommendationResultPath: '', autoResearchError: '',
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
  const editable = ['Trends结果', 'Social结果', 'SERP竞争', '关键词机会', 'Decision', '人工备注'];
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
      autoRecommendation: '', autoRecommendationConfidence: '', autoRecommendationReasons: '', autoMissingEvidence: '', autoRecommendationResultPath: '', autoResearchError: '',
      preflightVerdict: '', preflightCheckedAt: '', preflightReason: '',
      trendRelativeStrength: '', trendVerdict: '', trendLastChecked: '', externalSignal: '', finalResearchStage: ''};
  }
  decision.name = at('游戏名称') || decision.name;
  decision.opportunityId = decision.opportunityId || opportunityIdFromSteamCandidate_(decision.name, appId);
  decision.firstType = decision.firstType || at('第一轮类型') || '';
  decision.currentStage = at('当前阶段') || decision.currentStage;
  decision.trendsResult = at('Trends结果') || '';
  decision.socialResult = at('Social结果') || '';
  decision.serpCompetition = at('SERP竞争') || '';
  decision.keywordOpportunity = at('关键词机会') || '';
  decision.manualNote = at('人工备注') || '';
  decision.status = normalizeDecisionStatus_(at('Decision'));
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
  if (decision.status === 'BUILD') upsertSitePoolRecord_(e.source, decision.name, appId, decision.decisionDate || new Date());

  const output = {
    '研究状态': decision.researchStatus,
    '人工动作': decision.status ? '' : deriveHumanAction_({firstRoundType: decision.firstType}, decision, false),
    '研究完成度': deriveResearchCompletion_(decision),
    'Decision': decision.status
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
  if (status === 'BUILD') upsertSitePoolRecord_(e.source, sheet.getRange(e.range.getRow(), 2).getValue(), appId, checkedAt);
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
  captureCandidateDecisionEdit_(e);
  if (candidateDecisionEditAffectsTodayAction_(e)) refreshTodayActionsFromCandidateDecisions_(e.source);
}

/**
 * @param {Object} rec
 * @return {Array<*>}
 */
function actionRow_(rec) {
  const trends = buildTrendsQuery_(rec.name);
  const trendsUrl = buildGoogleTrendsExploreUrl_(trends.query);
  const trendsLink = trendsUrl
    ? '=HYPERLINK("' + trendsUrl.replace(/"/g, '""') + '","打开 Trends")'
    : '';
  const humanAction = rec.todayAction && (rec.todayAction.isWaiting || rec.todayAction.isCompleted)
    ? rec.todayAction.humanAction
    : deriveHumanAction_({firstRoundType: rec.firstRoundType}, rec.todayAction && rec.todayAction.decision, false);

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
    trendsLink,
    rec.todayAction.decision && rec.todayAction.decision.trendsResult || '',
    rec.todayAction.decision && rec.todayAction.decision.socialResult || '',
    rec.todayAction.decision && rec.todayAction.decision.serpCompetition || '',
    rec.todayAction.decision && rec.todayAction.decision.keywordOpportunity || '',
    rec.todayAction.decision && rec.todayAction.decision.status || '',
    rec.todayAction.decision && rec.todayAction.decision.manualNote || '',
    rec.currentStage,
    rec.todayAction.decision && rec.todayAction.decision.researchStatus || '',
    rec.todayAction.decision && rec.todayAction.decision.researchStatus === '已完成' ? '已完成' : rec.todayAction.decision && rec.todayAction.decision.researchStatus === '研究中' ? '进行中' : '未开始',
    humanAction || (rec.todayAction.type === 'RESEARCHING' ? '继续完成研究' : ''),
    rec.todayAction.reason,
    rec.todayAction.lastCheckedDate || (rec.todayAction.decision && rec.todayAction.decision.lastCheckedDate) || '',
    rec.url,
    rec.firstRoundReason,
  ];
}


// ============================================================================
// 输出到 Sheet
// ============================================================================

function upsertMaster_(ss, records, runTime, runId) {
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

    const row = masterRow_(rec, runTime, firstSeen, runId, manualNote);

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
    manualNote
  ];
}

function appendSnapshots_(ss, records, runTime, runId) {
  const sheet = ss.getSheetByName(HOTWORD_V2.sheets.snapshot);
  if (!records.length) return;

  const rows = records.map(rec => [
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
    rec.dataStatus,
    rec.dataNotes.join(' | ')
  ]);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HOTWORD_V2.snapshotHeaders.length).setValues(rows);
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
  if (status === 'BUILD' || status === 'REJECT') {
    return {include: false, reason: 'Decision=' + status + '，只保留在候选决策历史账本'};
  }
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
  const masterRecords = readCandidateMasterRecordsForTodayAction_(ss);
  const manualContent = readTodayActionManualContent_(actionSheet);
  const before = countTodayActionRows_(actionSheet);
  const actions = [];

  decisions.forEach(decision => {
    const rec = masterRecords.get(String(decision.appId || '').trim());
    if (!rec || rec.continueNext !== '是') return;
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
  actions.sort(compareActions_);

  const summaryCounts = Object.assign({
    discoveredCount: masterRecords.size,
    historyExcludedCount: 0,
    pass1ACount: Array.from(masterRecords.values()).filter(rec => rec.continueNext === '是').length,
    trendCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🔥 趋势候选').length,
    earlyCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🌱 Early候选').length,
    controlCount: Array.from(masterRecords.values()).filter(rec => rec.firstRoundType === '🏢 大盘对照').length,
    anomalyCount: 0
  }, counts || {});
  refreshTodayAction_(ss, actions, now, runId || todayActionRefreshRunId_(ss, now), summaryCounts);
  const after = countTodayActionRows_(actionSheet);
  return {
    ok: true,
    beforeCount: before.total,
    afterCount: after.total,
    beforePendingCount: before.pending,
    afterPendingCount: after.pending,
    waitingCount: after.waiting
  };
}

// Public Apps Script API wrapper; the implementation remains the single
// underscore-suffixed entry used by the menu, callbacks, and onEdit.
function refreshTodayActionsFromCandidateDecisions() {
  return refreshTodayActionsFromCandidateDecisions_();
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
    else if (typeColumn < 0 || row[typeColumn] !== 'COMPLETED') result.pending += 1;
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
  const order = {'🔥 趋势候选': 1, '🌱 Early候选': 2, '🏢 大盘对照': 3};
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

  ScriptApp.newTrigger('runSteamHotword01B')
    .timeBased()
    .everyDays(1)
    .atHour(Math.max(0, Math.min(23, Math.floor(Number(rules.DAILY_HOUR || 8)))))
    .create();

  safeToast_('每日自动任务已安装。以后只需查看“今日行动”。', 'Steam 0→1B', 7);
}

function removeDailyHotwordTriggers() {
  const handlers = new Set(['runSteamHotword01B', 'runSteamCandidateScan']);
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

    const typeColumn = headers.indexOf('第一轮类型') + 1;
    const typeRange = sheet.getRange(4, typeColumn, dataRows, 1);
    const types = typeRange.getDisplayValues();
    types.forEach((r, idx) => {
      const cell = sheet.getRange(idx + 4, typeColumn);
      if (r[0] === '🔥 趋势候选') cell.setBackground('#FCE8E6');
      else if (r[0] === '🌱 Early候选') cell.setBackground('#E6F4EA');
      else if (r[0] === '🏢 大盘对照') cell.setBackground('#E8F0FE');
    });
  }

  const widths = [18, 12, 34, 14, 18, 16, 16, 14, 14, 15, 12, 12, 12, 24, 18, 18, 18, 18, 18, 36, 22, 16, 16, 22, 34, 16, 48, 55];
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
