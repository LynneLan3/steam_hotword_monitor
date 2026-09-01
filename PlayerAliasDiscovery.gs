/**
 * 玩家常用称呼发现：在进入 Google Trends 判断前，通过 Google / YouTube /
 * Reddit / Steam Community 检索玩家实际使用的简称、缩写、去副标题名、数字写法。
 * 禁止模型猜测；无明确证据则留空。
 * 证据写入现有 Trends研究记录（TrendVerdict=ALIAS_DISCOVERY）。
 */

const PLAYER_ALIAS_DISCOVERY_VERDICT_ = 'ALIAS_DISCOVERY';
const PLAYER_ALIAS_MIN_SOURCE_HITS_ = 2;
const PLAYER_ALIAS_ROMAN_WORDS_ = {
  II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10'
};

/**
 * @param {Object} ss
 * @param {string} appId
 * @return {{alias:string,found:boolean,researchId:string}}
 */
function readCachedPlayerSearchAlias_(ss, appId) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  const normalizedAppId = String(appId || '').trim();
  if (!sheet || sheet.getLastRow() < 2 || !normalizedAppId) return {alias: '', found: false, researchId: ''};

  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const appColumn = headers.indexOf('AppID');
  const verdictColumn = headers.indexOf('TrendVerdict');
  const searchColumn = headers.indexOf('SearchTerm');
  const researchColumn = headers.indexOf('ResearchID');
  if (appColumn < 0 || verdictColumn < 0) return {alias: '', found: false, researchId: ''};

  let alias = '';
  let researchId = '';
  let found = false;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues().forEach(row => {
    if (String(row[appColumn] || '').trim() !== normalizedAppId) return;
    if (String(row[verdictColumn] || '').trim().toUpperCase() !== PLAYER_ALIAS_DISCOVERY_VERDICT_) return;
    found = true;
    researchId = researchColumn >= 0 ? String(row[researchColumn] || '').trim() : '';
    const candidate = searchColumn >= 0 ? String(row[searchColumn] || '').trim() : '';
    if (candidate && candidate !== '(none)') alias = candidate;
  });
  return {alias: alias, found: found, researchId: researchId};
}

/**
 * @param {string} gameName
 * @param {string} appId
 * @param {string} steamUrl
 * @param {Object} [options]
 * @return {{alias:string,evidence:Array<Object>,status:string,patterns:Array<string>}}
 */
function discoverPlayerSearchAlias_(gameName, appId, steamUrl, options) {
  options = options || {};
  const officialName = String(gameName || '').trim();
  if (!officialName) return {alias: '', evidence: [], status: 'EMPTY', patterns: []};

  const patterns = playerAliasGenerateEvidencePatterns_(officialName);
  const snippets = playerAliasCollectSearchSnippets_(officialName, appId, steamUrl, options.fetchImpl);
  const ranked = playerAliasRankCandidates_(officialName, patterns, snippets)
    .filter(entry => !playerAliasIsNumeralVariantOnly_(entry.text, officialName))
    .filter(entry => !playerAliasIsWeakSubtitleOnlyAlias_(entry.text, officialName));
  const best = ranked.length ? ranked[0] : null;
  const alias = best && best.hits >= PLAYER_ALIAS_MIN_SOURCE_HITS_ ? best.text : '';

  return {
    alias: alias,
    evidence: snippets.slice(0, 40),
    status: alias ? 'FOUND' : 'NONE',
    patterns: patterns,
    ranked: ranked.slice(0, 5)
  };
}

/**
 * @param {Object} ss
 * @param {Object} rec
 * @param {{alias:string,evidence:Array<Object>,status:string,patterns:Array<string>}} discovery
 * @return {{written:boolean,researchId:string}}
 */
function writePlayerAliasResearchRecord_(ss, rec, discovery) {
  const sheet = ss && ss.getSheetByName ? ss.getSheetByName(HOTWORD_V2.sheets.trendsResearch) : null;
  if (!sheet) return {written: false, researchId: ''};

  const appId = String(rec && rec.appId || '').trim();
  const cached = readCachedPlayerSearchAlias_(ss, appId);
  if (cached.found) return {written: false, researchId: cached.researchId, duplicate: true};

  const headers = HOTWORD_TRENDS_RESEARCH_HEADERS || [
    'ResearchID', 'ResearchDate', 'EvidenceID', 'AppID', 'Game', 'OpportunityID',
    'SearchTerm', 'Geo', 'Window', 'Benchmark', 'CandidateAvg', 'BenchmarkAvg',
    'RelativeStrength', 'TrendDirection', 'Breakout', 'BrandAmbiguity',
    'EntityMatchConfidence', 'Steam1BType', 'SteamPriority', 'TrendVerdict',
    'RecommendedRoute', 'EvidenceRef', 'RecordedAt'
  ];
  const evidenceId = 'alias-' + appId + '-' + playerAliasHashKey_(rec.name + '|' + String(discovery && discovery.alias || ''));
  const researchId = 'alias-research-' + evidenceId;
  const opportunityId = rec.todayAction && rec.todayAction.decision && rec.todayAction.decision.opportunityId
    ? rec.todayAction.decision.opportunityId
    : (typeof opportunityIdFromSteamCandidate_ === 'function'
      ? opportunityIdFromSteamCandidate_(rec.name, appId) : '');

  const evidenceSummary = playerAliasEvidenceSummary_(discovery);
  const row = hotwordExternalRow_ ? hotwordExternalRow_(headers, {
    ResearchID: researchId,
    ResearchDate: playerAliasDateText_(new Date()),
    EvidenceID: evidenceId,
    AppID: appId,
    Game: rec.name,
    OpportunityID: opportunityId,
    SearchTerm: discovery && discovery.alias ? discovery.alias : '(none)',
    Geo: HOTWORD_V2 && HOTWORD_V2.trendsExplore ? HOTWORD_V2.trendsExplore.geo || 'US' : 'US',
    Window: HOTWORD_V2 && HOTWORD_V2.trendsExplore ? HOTWORD_V2.trendsExplore.date || 'today 1-m' : 'today 1-m',
    Benchmark: '',
    CandidateAvg: '',
    BenchmarkAvg: '',
    RelativeStrength: '',
    TrendDirection: '',
    Breakout: '',
    BrandAmbiguity: '',
    EntityMatchConfidence: discovery && discovery.alias ? 'HIGH' : 'LOW',
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
      SearchTerm: discovery && discovery.alias ? discovery.alias : '(none)',
      Geo: 'US', Window: 'today 1-m', Benchmark: '',
      CandidateAvg: '', BenchmarkAvg: '', RelativeStrength: '', TrendDirection: '',
      Breakout: '', BrandAmbiguity: '',
      EntityMatchConfidence: discovery && discovery.alias ? 'HIGH' : 'LOW',
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
 * @param {Object} ss
 * @param {Array<Object>} actions
 */
function ensurePlayerSearchAliasesForTodayActions_(ss, actions) {
  (actions || []).forEach(rec => {
    const cached = readCachedPlayerSearchAlias_(ss, rec.appId);
    if (cached.found) {
      rec.searchAlias = cached.alias;
      return;
    }
    if (!shouldRunPlayerAliasDiscovery_(rec)) {
      rec.searchAlias = '';
      return;
    }
    const discovery = discoverPlayerSearchAlias_(rec.name, rec.appId, rec.url);
    writePlayerAliasResearchRecord_(ss, rec, discovery);
    rec.searchAlias = discovery.alias || '';
  });
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
  if (discovery && discovery.patterns && discovery.patterns.length) {
    parts.push('patterns=' + discovery.patterns.join('; '));
  }
  (discovery && discovery.evidence || []).slice(0, 12).forEach(item => {
    parts.push(String(item.source || 'unknown') + ': ' + String(item.title || item.snippet || '').slice(0, 120));
  });
  if (discovery && discovery.ranked && discovery.ranked.length) {
    parts.push('ranked=' + discovery.ranked.map(entry =>
      entry.text + '(' + entry.hits + ' hits/' + entry.sources.join('+') + ')'
    ).join('; '));
  }
  return parts.join(' | ').slice(0, 4500);
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
      if (sub.length >= 8) patterns.add(sub);
    }
  }

  return Array.from(patterns).filter(item => item && item.length >= 3);
}

function playerAliasCollectSearchSnippets_(gameName, appId, steamUrl, fetchImpl) {
  const fetchFn = fetchImpl || playerAliasFetchText_;
  const query = playerAliasCleanName_(gameName);
  const snippets = [];
  const push = (source, title, snippet, url) => {
    const text = String(title || '').trim();
    const body = String(snippet || '').trim();
    if (!text && !body) return;
    snippets.push({source: source, title: text, snippet: body, url: String(url || '').trim()});
  };

  playerAliasSearchReddit_(query, appId, fetchFn).forEach(item => push('reddit', item.title, item.snippet, item.url));
  playerAliasSearchYouTube_(query, appId, fetchFn).forEach(item => push('youtube', item.title, item.snippet, item.url));
  playerAliasSearchSteamCommunity_(query, appId, steamUrl, fetchFn).forEach(item => push('steam_community', item.title, item.snippet, item.url));
  playerAliasSearchGoogle_(query, appId, fetchFn).forEach(item => push('google', item.title, item.snippet, item.url));
  return snippets;
}

function playerAliasFetchText_(url, options) {
  options = options || {};
  if (typeof UrlFetchApp === 'undefined') return '';
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
    if (resp.getResponseCode() >= 400) return '';
    return resp.getContentText('UTF-8');
  } catch (err) {
    return '';
  }
}

function playerAliasSearchReddit_(query, appId, fetchFn) {
  const q = query + ' steam';
  const urls = [
    'https://www.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance',
    'https://old.reddit.com/search.json?q=' + encodeURIComponent(q) + '&limit=25&sort=relevance'
  ];
  for (let i = 0; i < urls.length; i += 1) {
    const text = fetchFn(urls[i]);
    if (!text || text.charAt(0) !== '{') continue;
    try {
      const data = JSON.parse(text);
      const rows = (data.data && data.data.children || []).map(child => {
        const item = child.data || {};
        return {
          title: item.title || '',
          snippet: String(item.selftext || '').slice(0, 240),
          url: item.permalink ? 'https://www.reddit.com' + item.permalink : ''
        };
      });
      if (rows.length) return rows;
    } catch (err) {
      // try next endpoint
    }
  }
  return [];
}

function playerAliasSearchYouTube_(query, appId, fetchFn) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query + ' steam game');
  const html = fetchFn(url);
  if (!html) return [];
  const results = [];
  const titleRegex = /"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = titleRegex.exec(html)) && results.length < 20) {
    const title = playerAliasUnescapeJson_(match[1]);
    if (title) results.push({title: title, snippet: '', url: ''});
  }
  return results;
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
  const results = [];
  urls.forEach(url => {
    const html = fetchFn(url);
    if (!html) return;
    const titleRegex = /<span class="title">([^<]+)<\/span>/gi;
    let match;
    while ((match = titleRegex.exec(html)) && results.length < 20) {
      results.push({title: playerAliasDecodeHtml_(match[1]), snippet: '', url: url});
    }
    const topicRegex = /data-tooltip-text="([^"]+)"/gi;
    while ((match = topicRegex.exec(html)) && results.length < 20) {
      results.push({title: playerAliasDecodeHtml_(match[1]), snippet: '', url: url});
    }
  });
  return results;
}

function playerAliasSearchGoogle_(query, appId, fetchFn) {
  const searches = [
    query + ' steam game',
    'site:store.steampowered.com "' + query + '"'
  ];
  const results = [];
  searches.forEach(q => {
    const url = 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&num=10';
    const html = fetchFn(url);
    if (!html) return;
    const blockRegex = /<(?:h3|div)[^>]*>([^<]{4,120})<\/(?:h3|div)>/gi;
    let match;
    while ((match = blockRegex.exec(html)) && results.length < 20) {
      const title = playerAliasDecodeHtml_(match[1].replace(/<[^>]+>/g, ' '));
      if (title && title.indexOf('http') < 0) results.push({title: title, snippet: '', url: ''});
    }
  });
  return results;
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
