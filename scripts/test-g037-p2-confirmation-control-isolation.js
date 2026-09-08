/* G037 P2 Steam confirmation decoupling and rejected-control isolation. */
'use strict';

var fs = require('fs');
var vm = require('vm');
var source = fs.readFileSync(__dirname + '/../SteamCandidateScanner.js', 'utf8');

function extract(name) {
  var match = source.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  if (!match) throw new Error('missing ' + name);
  return match[0];
}
function segment(name, nextName) {
  var start = source.indexOf('function ' + name);
  var end = source.indexOf('function ' + nextName, start + 1);
  if (start < 0 || end < 0) throw new Error('missing segment ' + name);
  return source.slice(start, end);
}
function assert(value, label) { if (!value) throw new Error(label); }

var context = {Number: Number, String: String, Math: Math, isFinite: isFinite, Set: Set, Object: Object};
vm.createContext(context);
vm.runInContext([
  'g010ControlHash_', 'g010ControlGroup_', 'g010SelectRejectedControls_'
].map(extract).join('\n'), context);

var rejected = [];
for (var i = 0; i < 24; i += 1) {
  rejected.push({appId: String(1000 + i), source: i % 2 ? 'Popular New Releases' : 'Popular Upcoming', sourceRank: i + 1, releaseStage: '即将发售'});
}
var controls = context.g010SelectRejectedControls_(rejected, 'run-p2');
assert(controls.length === 20, 'control sample remains capped at 20');
assert(controls.every(function (rec) { return rec.controlSampleFlag && rec.controlSampleReason === 'REJECTED_RANDOM_SAMPLE'; }), 'controls carry explicit sample metadata');
assert(controls.every(function (rec) { return rejected.indexOf(rec) >= 0; }), 'controls are selected from rejected candidates');

var contextSegment = segment('g010BuildRunContext_', 'g010ControlHash_');
var controlSegment = segment('g010EnrichControlChunk_', 'g010AccumulateChunkStats_');
var normalSegment = source.slice(source.indexOf('function g010EnrichChunk_'));
var runSegment = segment('runSteamHotword01B', 'runSteamHotword01BLegacy_');
assert(/const eligible = \[\];[\s\S]*const rejected = \[\];/.test(contextSegment), 'eligible and rejected are separate context collections');
assert(/const controls = g010SelectRejectedControls_\(rejected, state\.runId\)/.test(contextSegment), 'controls derive only from rejected records');
assert(!/fetchSteamReviewSummaryBatch_/.test(controlSegment), 'control enrichment does not call Steam review confirmation');
assert(/const released = records\.filter/.test(normalSegment) && /fetchSteamReviewSummaryBatch_\(released/.test(normalSegment), 'Steam review confirmation is bounded to normal eligible enrichment');
assert(runSegment.indexOf('g010EnrichChunk_(ss, chunk') < runSegment.indexOf('g010EnrichControlChunk_(ss, chunk'), 'normal enrichment runs before isolated control enrichment');

console.log(JSON.stringify({status: 'PASS', normal_confirmation: 'eligible released records only', control_enrichment: 'separate rejected sample boundary'}));
