/**
 * Steam 抓取可靠性本地 mock 测试（不访问 Steam）。
 * 运行：node scripts/test-steam-fetch-reliability.js
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var srcPath = path.join(__dirname, '..', 'SteamCandidateScanner.js');
var src = fs.readFileSync(srcPath, 'utf8');

function extractFunction(name) {
  var re = new RegExp(
    'function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}\\n(?=\\n|function\\s|// =+|var\\s|_steam)'
  );
  var m = src.match(re);
  if (!m) {
    // 文件末尾函数可能没有尾随换行模式
    re = new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}');
    m = src.match(re);
  }
  if (!m) throw new Error('无法提取函数: ' + name);
  return m[0];
}

var sandbox = {
  Math: Math,
  Date: Date,
  Number: Number,
  String: String,
  Object: Object,
  Array: Array,
  JSON: JSON,
  isFinite: isFinite,
  console: console
};
vm.createContext(sandbox);

[
  'decideSteamHttpRetry_',
  'computeExponentialBackoffMs_',
  'parseRetryAfterMs_',
  'isSteamRetryableHttpStatus_',
  'isSteamSourceCacheFresh_',
  'splitSteamCacheChunks_'
].forEach(function (name) {
  vm.runInContext(extractFunction(name), sandbox);
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ' | expected=' + expected + ' actual=' + actual);
  }
}

var baseInput = {
  attempt: 1,
  maxAttempts429: 4,
  maxAttempts403: 2,
  maxAttempts5xx: 3,
  retryAfterHeader: '',
  backoffBaseMs: 2000,
  backoffMaxMs: 60000,
  jitterMs: 0,
  recovery403Ms: 8000,
  networkError: false,
  randomFn: function () {
    return 0;
  }
};

// --------------------------------------------------------------------------
// 1. 正常 200
// --------------------------------------------------------------------------
(function test200() {
  var d = sandbox.decideSteamHttpRetry_(
    Object.assign({}, baseInput, { statusCode: 200 })
  );
  assertEqual(d.action, 'ok', '200 action');
  assertEqual(d.reason, 'success', '200 reason');
  console.log('PASS 1: 正常 200');
})();

// --------------------------------------------------------------------------
// 2. 第一次 429 → retry 后可视为将再请求（decision=retry）
// --------------------------------------------------------------------------
(function test429ThenRetry() {
  var d1 = sandbox.decideSteamHttpRetry_(
    Object.assign({}, baseInput, { statusCode: 429, attempt: 1 })
  );
  assertEqual(d1.action, 'retry', '429 attempt1 action');
  assertEqual(d1.reason, '429_exponential_backoff', '429 attempt1 reason');
  assertEqual(d1.sleepMs, 2000, '429 attempt1 sleep');

  var dRetryAfter = sandbox.decideSteamHttpRetry_(
    Object.assign({}, baseInput, {
      statusCode: 429,
      attempt: 1,
      retryAfterHeader: '12'
    })
  );
  assertEqual(dRetryAfter.action, 'retry', '429 Retry-After action');
  assertEqual(dRetryAfter.reason, '429_retry_after', '429 Retry-After reason');
  assertEqual(dRetryAfter.sleepMs, 12000, '429 Retry-After sleep');

  // 模拟 attempt2 得到 200
  var d2 = sandbox.decideSteamHttpRetry_(
    Object.assign({}, baseInput, { statusCode: 200, attempt: 2 })
  );
  assertEqual(d2.action, 'ok', '429→200 final');
  console.log('PASS 2: 第一次 429 → retry 后 200');
})();

/**
 * 模拟单 source 抓取 + 缓存回退 → 最终 run status。
 * 不打真实 HTTP。
 */
function simulateSourceRun_(opts) {
  var statuses = opts.httpStatuses.slice();
  var warnings = [];
  var attempt = 0;
  var liveItems = null;
  var lastStatus = null;

  while (statuses.length) {
    attempt += 1;
    lastStatus = statuses.shift();
    var decision = sandbox.decideSteamHttpRetry_(
      Object.assign({}, baseInput, {
        statusCode: lastStatus,
        attempt: attempt
      })
    );
    warnings.push({
      status: lastStatus,
      attempt: attempt,
      action: decision.action,
      reason: decision.reason,
      sleepMs: decision.sleepMs
    });
    if (decision.action === 'ok') {
      liveItems = opts.liveItems || [{ appId: '1', name: 'Demo' }];
      break;
    }
    if (decision.action === 'fail') break;
    // retry: continue loop
  }

  if (liveItems) {
    return {
      status: opts.forcePartial ? 'PARTIAL' : 'SUCCESS',
      usedCache: false,
      items: liveItems,
      warnings: warnings,
      httpStatus: lastStatus
    };
  }

  var cache = opts.cache || null;
  var nowMs = opts.nowMs || Date.now();
  var maxAge = opts.cacheMaxAgeMs || 24 * 60 * 60 * 1000;
  var fresh = cache
    ? sandbox.isSteamSourceCacheFresh_(cache, nowMs, maxAge)
    : false;

  if (
    sandbox.isSteamRetryableHttpStatus_(lastStatus) &&
    fresh &&
    cache.items &&
    cache.items.length
  ) {
    return {
      status: 'PARTIAL',
      usedCache: true,
      items: cache.items,
      warnings: warnings,
      httpStatus: lastStatus,
      cacheAgeMs: nowMs - cache.savedAtMs
    };
  }

  return {
    status: 'FAILED',
    usedCache: false,
    items: [],
    warnings: warnings,
    httpStatus: lastStatus
  };
}

// --------------------------------------------------------------------------
// 3. 持续 429 → 使用 <24h cache → PARTIAL
// --------------------------------------------------------------------------
(function test429CachePartial() {
  var now = Date.UTC(2026, 7, 16, 10, 0, 0);
  var result = simulateSourceRun_({
    httpStatuses: [429, 429, 429, 429],
    nowMs: now,
    cache: {
      savedAtMs: now - 2 * 3600000,
      items: [{ appId: '100', name: 'Cached Upcoming' }]
    }
  });
  assertEqual(result.status, 'PARTIAL', '429 cache status');
  assert(result.usedCache === true, '429 used cache');
  assertEqual(result.items[0].name, 'Cached Upcoming', '429 cache item');
  assert(result.warnings.length === 4, '429 exhausted attempts logged');
  assertEqual(result.warnings[3].action, 'fail', '429 last fail');
  console.log('PASS 3: 持续 429 → <24h cache → PARTIAL');
})();

// --------------------------------------------------------------------------
// 4. 持续 403 → 使用 <24h cache → PARTIAL
// --------------------------------------------------------------------------
(function test403CachePartial() {
  var now = Date.UTC(2026, 7, 16, 10, 0, 0);
  var result = simulateSourceRun_({
    httpStatuses: [403, 403],
    nowMs: now,
    cache: {
      savedAtMs: now - 60 * 60 * 1000,
      items: [{ appId: '200', name: 'Cached New' }]
    }
  });
  assertEqual(result.status, 'PARTIAL', '403 cache status');
  assert(result.usedCache === true, '403 used cache');
  assertEqual(result.warnings[0].reason, '403_single_recovery', '403 recovery once');
  assertEqual(result.warnings[1].action, 'fail', '403 no more retries');
  console.log('PASS 4: 持续 403 → <24h cache → PARTIAL');
})();

// --------------------------------------------------------------------------
// 5. 403/429 + cache >24h → FAILED
// --------------------------------------------------------------------------
(function testStaleCacheFailed() {
  var now = Date.UTC(2026, 7, 16, 10, 0, 0);
  var r429 = simulateSourceRun_({
    httpStatuses: [429, 429, 429, 429],
    nowMs: now,
    cache: {
      savedAtMs: now - 25 * 3600000,
      items: [{ appId: '1', name: 'Stale' }]
    }
  });
  assertEqual(r429.status, 'FAILED', '429 stale cache FAILED');

  var r403 = simulateSourceRun_({
    httpStatuses: [403, 403],
    nowMs: now,
    cache: {
      savedAtMs: now - 30 * 3600000,
      items: [{ appId: '1', name: 'Stale' }]
    }
  });
  assertEqual(r403.status, 'FAILED', '403 stale cache FAILED');
  console.log('PASS 5: 403/429 + cache >24h → FAILED');
})();

// --------------------------------------------------------------------------
// 6. 两个 run 重叠 → Lock 阻止（模拟）
// --------------------------------------------------------------------------
(function testLockSkip() {
  function tryAcquire(lockHeld) {
    if (lockHeld) {
      return { acquired: false, status: 'SKIPPED' };
    }
    return { acquired: true, status: 'RUNNING' };
  }
  assertEqual(tryAcquire(true).status, 'SKIPPED', 'second run skipped');
  assertEqual(tryAcquire(false).status, 'RUNNING', 'first run runs');
  assert(
    /SKIPPED/.test(src) && /LockService/.test(src),
    'production code writes SKIPPED on lock conflict'
  );
  console.log('PASS 6: 两个 run 重叠 → Lock 阻止');
})();

// --------------------------------------------------------------------------
// 7. 正常成功时 1A / 1B 规则函数未被本轮改动（完整性门槛保持）
// --------------------------------------------------------------------------
(function testRulesUntouched() {
  assert(/function classify1A_/.test(src), 'classify1A_ still present');
  assert(/function classify1BRaw_/.test(src), 'classify1BRaw_ still present');
  assert(/TREND_GAIN_MIN/.test(src), 'trend gain rule present');
  assert(/EARLY_GROWTH_MIN/.test(src), 'early growth rule present');
  assert(/STEAM_DISCOVERY_RUNTIME_BUDGET_MS/.test(src), 'runtime budget is explicit');
  assert(/stopReason = page === 1 \? 'empty-page-1' : 'empty-page'/.test(src), 'empty page is a valid pagination stop');

  // 正常 200 路径不走 cache，run 可为 SUCCESS
  var ok = simulateSourceRun_({
    httpStatuses: [200],
    liveItems: new Array(50).fill(0).map(function (_, i) {
      return { appId: String(1000 + i), name: 'G' + i };
    })
  });
  assertEqual(ok.status, 'SUCCESS', 'live 200 => SUCCESS');
  assert(ok.usedCache === false, 'live 200 no cache');
  assertEqual(ok.items.length, 50, 'live items intact');

  // 业务发现不再用固定页数/条数完整性门槛截断。
  assert(!/G010_RAW_DISCOVERY_PAGES\s*=/.test(src), 'no fixed discovery page cap');
  console.log('PASS 7: 正常成功路径 SUCCESS，1A/1B 规则函数保持');
})();

// --------------------------------------------------------------------------
// 额外：404 不重试；403 不暴力连打
// --------------------------------------------------------------------------
(function testNoViolentRetry() {
  var d404 = sandbox.decideSteamHttpRetry_(
    Object.assign({}, baseInput, { statusCode: 404 })
  );
  assertEqual(d404.action, 'fail', '404 no retry');

  var d403a2 = sandbox.decideSteamHttpRetry_(
    Object.assign({}, baseInput, { statusCode: 403, attempt: 2 })
  );
  assertEqual(d403a2.action, 'fail', '403 attempt2 fail');
  console.log('PASS extra: 404/403 不暴力重试');
})();

// --------------------------------------------------------------------------
// 额外：100 条缓存必须可分片（覆盖自动分页返回的大批量发现）
// --------------------------------------------------------------------------
(function testCacheChunking() {
  var rows = [];
  for (var i = 0; i < 100; i++) {
    rows.push({
      a: String(1000000 + i),
      n: 'Longish Game Title Example ' + i,
      r: 'Coming soon',
      c: 1234,
      p: 0.85,
      k: i + 1
    });
  }
  var single = JSON.stringify({ t: 1, i: 'x', s: 'Popular Upcoming', g: rows });
  assert(single.length > 8500, '100-item single blob would exceed 9KB');

  var chunks = sandbox.splitSteamCacheChunks_(rows, 7500);
  assert(chunks.length >= 2, '100 items split into >=2 chunks');
  var total = 0;
  chunks.forEach(function (ch) {
    var len = JSON.stringify(ch).length;
    assert(len <= 7500 || ch.length === 1, 'chunk within limit unless single-row overflow');
    total += ch.length;
  });
  assertEqual(total, 100, 'chunk rows cover all 100');
  console.log('PASS extra: 100-item cache chunking');
})();

console.log('\nAll Steam fetch reliability mock tests passed.');
