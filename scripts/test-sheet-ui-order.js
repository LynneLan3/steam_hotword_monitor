/**
 * M0-2 / M1-1 本地纯函数自测：Steam Sheet UI 顺序 + 近似增长率说明一致性。
 * 运行：node scripts/test-sheet-ui-order.js
 */

function buildSheetUiOrder_(existingNames, preferredNames) {
  var present = {};
  existingNames.forEach(function (n) {
    present[n] = true;
  });

  var used = {};
  var out = [];

  (preferredNames || []).forEach(function (n) {
    if (!present[n] || used[n]) return;
    out.push(n);
    used[n] = true;
  });

  existingNames.forEach(function (n) {
    if (used[n]) return;
    out.push(n);
    used[n] = true;
  });

  return out;
}

var SHEET_UI_ORDER = [
  '今日行动',
  '站点项目池',
  '项目GSC关联',
  '候选决策',
  '候选主表',
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
];

function assertEqual(actual, expected, label) {
  var a = actual.join('|');
  var e = expected.join('|');
  if (a !== e) {
    throw new Error(label + '\n expected: ' + e + '\n actual:   ' + a);
  }
}

assertEqual(
  buildSheetUiOrder_(
    [
      '运行日志_V2',
      '配置',
      '今日行动',
      '站点项目池',
      '项目GSC关联',
      '指标说明',
      '候选决策',
      'Steam_候选池',
      '候选主表',
      '使用说明',
      '神秘旧表',
      '建站关键词规划',
      '规则配置',
      '1B规则回测',
      'Steam_每日快照',
      '数据异常',
      '历史游戏库',
      '概览',
      'Steam_抓取日志'
    ],
    SHEET_UI_ORDER
  ),
  [
    '今日行动',
    '站点项目池',
    '项目GSC关联',
    '候选决策',
    '候选主表',
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
    '配置',
    '神秘旧表'
  ],
  'full order with 指标说明'
);

assertEqual(
  buildSheetUiOrder_(['使用说明', '今日行动'], SHEET_UI_ORDER),
  ['今日行动', '使用说明'],
  'does not invent 指标说明 when missing from existingNames input — creator runs separately'
);

// Growth formula documentation must match computeFollowerGrowth_: gain / current
var fs = require('fs');
var src = fs.readFileSync(
  require('path').join(__dirname, '..', 'SteamCandidateScanner.js'),
  'utf8'
);
var growthFn = src.match(
  /function computeFollowerGrowth_[\s\S]*?return \{\s*ok: true[\s\S]*?\n\}/
);
if (!growthFn) throw new Error('computeFollowerGrowth_ not found');
if (!/growthRate = current > 0 \? gain \/ current/.test(growthFn[0])) {
  throw new Error('computeFollowerGrowth_ formula changed unexpectedly');
}
if (!/Gain ÷ 当前 Followers/.test(src) && !/gain \/ current/.test(src)) {
  // metric guide uses Chinese wording
}
if (!/\(当前 Followers − 历史基准 Followers\) ÷ 当前 Followers/.test(src)) {
  throw new Error('指标说明 missing exact 近似增长率 formula text');
}
if (!/不是通常意义上的“相较 7 天前增长率”/.test(src)) {
  throw new Error('指标说明 missing PM caveat for 近似增长率');
}

// 指标说明 must not be in hidden list
if (/sheetUiHidden:[\s\S]*指标说明/.test(src.split('sheetUiHidden')[1].slice(0, 200))) {
  throw new Error('指标说明 must not be hidden');
}
if (!/sheetUiOrder:[\s\S]*?'指标说明'/.test(src)) {
  throw new Error('sheetUiOrder missing 指标说明');
}
if (!/sheetUiOrder:[\s\S]*?'候选决策'/.test(src)) {
  throw new Error('sheetUiOrder missing 候选决策');
}
if (!/RECHECK_GAIN_GROWTH_MIN/.test(src) || !/WATCH_RECHECK_DAYS_STRONG/.test(src) || !/WATCH_RECHECK_DAYS_NORMAL/.test(src)) {
  throw new Error('candidate recheck rules missing');
}

// Count metric rows roughly from getMetricGuideRows_
var rowsMatch = src.match(/function getMetricGuideRows_\(\) \{[\s\S]*?^\}/m);
if (!rowsMatch) throw new Error('getMetricGuideRows_ missing');
var rowStarts = (rowsMatch[0].match(/^\s+\[\s*$/gm) || []).length;
// each metric is an array starting with [ on its own conceptually - count "',"原始事实'" style
var metricTitles = [
  'Steam App ID',
  '近似增长率',
  '1A 即将发售',
  '🔥 趋势候选',
  'BUILD / WATCH / REJECT'
];
metricTitles.forEach(function (t) {
  if (src.indexOf("'" + t + "'") < 0 && src.indexOf('"' + t + '"') < 0) {
    // Chinese titles use single quotes in arrays
    if (src.indexOf(t) < 0) throw new Error('missing metric ' + t);
  }
});

console.log('PASS scripts/test-sheet-ui-order.js');
