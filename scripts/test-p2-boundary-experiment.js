/** P2 boundary classification, history state, and sampling regression tests. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

function extract(name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  return match[0];
}
function assert(value, message) { if (!value) throw new Error(message); }

var context = {
  isFiniteNumber_: function (value) { return typeof value === 'number' && isFinite(value); },
  formatPercentText_: function (value) { return (Number(value) * 100).toFixed(1) + '%'; },
  Number: Number, String: String, Math: Math, Date: Date, Set: Set, Array: Array
};
vm.createContext(context);
vm.runInContext(extract('classify1BRaw_'), context);
vm.runInContext(extract('computeFollowerGrowth_'), context);
vm.runInContext(extract('selectTodayActionQuota_'), context);
vm.runInContext(extract('configuredTodayActionNumber_'), context);
vm.runInContext(extract('limitTodayActionSamples_'), context);

var rules = {
  TREND_GAIN_MIN: 1000, TREND_GROWTH_MIN: 0.10,
  EARLY_FOLLOWERS_MAX: 5000, EARLY_GAIN_MIN: 600, EARLY_GROWTH_MIN: 0.175,
  CONTROL_FOLLOWERS_MIN: 30000, CONTROL_FOLLOWERS_MAX: 60000,
  CONTROL_GAIN_MIN: 1500, CONTROL_GROWTH_MAX: 0.10,
  TREND_WATCH_GAIN_MIN: 600, TREND_WATCH_GROWTH_MIN: 0.07,
  TREND_WATCH_HIGH_GAIN_MIN: 1000, TREND_WATCH_HIGH_GAIN_GROWTH_MIN: 0.05,
  EARLY_WATCH_FOLLOWERS_MAX: 8000, EARLY_WATCH_GAIN_MIN: 300, EARLY_WATCH_GROWTH_MIN: 0.10
};
function classify(followers, gain, growth) {
  return context.classify1BRaw_({followers: followers, gain7d: gain, growthRate: growth}, rules).type;
}

assert(classify(12000, 1264, 0.099) === '🟡 Trend Watch', 'Clawed is P2 Trend Watch');
assert(classify(1600, 578, 0.361) === '🟢 Early Watch', 'TV Archive is P2 Early Watch');
assert(classify(12000, 837, 0.049) === '⚪ 低优先级', 'BOMBANANA remains P3');
assert(classify(6911, 388, 0.056) === '⚪ 低优先级', 'Car Wash Simulator remains P3');

assert(classify(12000, 1000, 0.10) === '🔥 趋势候选', 'P1 Trend unchanged');
assert(classify(5000, 600, 0.175) === '🌱 Early候选', 'P1 Early unchanged');
assert(classify(30000, 1500, 0.09) === '🏢 对照候选', 'Control unchanged');

var now = new Date('2026-08-28T00:00:00Z');
var insufficient = context.computeFollowerGrowth_({history: [{followers: 100, added: '2026-08-25T00:00:00Z'}]}, 150, now, 5);
assert(insufficient.ok === false, 'short history is not classified');
assert(source.indexOf("rec.firstRoundType = '⏳ 等待历史'") >= 0, 'history state label is persisted');
assert(source.indexOf("rec.currentStage = '1B等待历史'") >= 0, 'history stage is distinct');
assert(source.indexOf("'⏳1B历史不足'") >= 0, 'history counter is in log schema');
assert(source.indexOf("'P2_MAX_PER_DAY'") >= 0, 'P2 sample cap is configurable');

var actionFixtures = [];
for (var i = 0; i < 8; i += 1) actionFixtures.push({firstRoundType: '🔥 趋势候选', gain7d: 1000 - i, todayAction: {}});
for (var j = 0; j < 4; j += 1) actionFixtures.push({firstRoundType: '🌱 Early候选', gain7d: 900 - j, todayAction: {}});
for (var k = 0; k < 5; k += 1) actionFixtures.push({firstRoundType: '🟡 Trend Watch', gain7d: 800 - k, todayAction: {}});
for (var m = 0; m < 5; m += 1) actionFixtures.push({firstRoundType: '🟢 Early Watch', gain7d: 700 - m, todayAction: {}});
actionFixtures.push({firstRoundType: '🌱 Early候选', gain7d: 1, todayAction: {isWaiting: true}});
var sampled = context.limitTodayActionSamples_(actionFixtures, {
  P1_MAX_PER_DAY: 6, P1_TREND_MAX_PER_DAY: 4, P1_EARLY_MAX_PER_DAY: 2,
  P2_MAX_PER_DAY: 6, P2_TREND_MAX_PER_DAY: 3, P2_EARLY_MAX_PER_DAY: 3
});
function countType(type, includeWaiting) {
  return sampled.filter(function (row) { return row.firstRoundType === type && (includeWaiting || !row.todayAction.isWaiting); }).length;
}
assert(countType('🔥 趋势候选', false) + countType('🌱 Early候选', false) === 6, 'P1 daily cap');
assert(countType('🟡 Trend Watch', false) + countType('🟢 Early Watch', false) === 6, 'P2 daily cap');
assert(countType('🌱 Early候选', true) === 3, 'waiting WATCH remains visible');

console.log('PASS scripts/test-p2-boundary-experiment.js (P1/Control unchanged, P2 boundaries, history state)');
