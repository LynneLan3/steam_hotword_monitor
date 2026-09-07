'use strict';
const fs = require('fs');
const assert = require('assert');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
const historical = fs.readFileSync(require('path').join(__dirname, '..', 'HistoricalFeatureSnapshot.gs'), 'utf8');
assert(source.includes('g010SelectRejectedControls_'), 'deterministic control sampler exists');
assert(source.includes("controlSampleReason = 'REJECTED_RANDOM_SAMPLE'"), 'rejected reason is fixed');
assert(source.includes('state.controlCursor'), 'control cursor persists across continuation');
assert(source.includes('g010EnrichControlChunk_'), 'control enrichment has a separate side-effect boundary');
assert(source.includes('g010EnrichControlChunk_(ss, chunk'), 'control chunk is called by resumable run');
assert(source.includes('writeDailyCandidateSnapshot_'), 'normal candidate snapshot path remains present');
assert(source.includes('const controls = runContext.controls'), 'controls are separate from eligible candidates');
assert(historical.includes("control ? 'TRUE' : 'FALSE'"), 'feature flag is explicit');

const sandbox = {Math, Number, String, Object, Array, isFinite, Set, Map};
vm.createContext(sandbox);
const match = source.match(/function g010ControlHash_[\s\S]*?\nfunction g010EnrichControlChunk_/);
assert(match, 'sampler functions are extractable');
vm.runInContext(match[0].replace(/\nfunction g010EnrichControlChunk_[\s\S]*$/, ''), sandbox);
const rejected = Array.from({length: 245}, (_, i) => ({
  appId: String(i + 1), source: i % 2 ? 'Popular Upcoming' : 'Popular New Releases',
  sourceRank: (i % 125) + 1, releaseStage: i % 3 ? '未发售' : '已发售'
}));
const first = sandbox.g010SelectRejectedControls_(rejected, '20260901-120000');
const resumed = sandbox.g010SelectRejectedControls_(rejected, '20260901-120000');
assert.strictEqual(first.length, 20, '245 rejected yields at most 20 controls');
assert.deepStrictEqual(first.map(x => x.appId), resumed.map(x => x.appId), 'continuation recomputes same sample');
assert(first.every(x => x.controlSampleFlag && x.controlSampleReason === 'REJECTED_RANDOM_SAMPLE'), 'sample metadata is attached');
assert(source.indexOf('const chunk = eligible.slice') < source.indexOf('g010EnrichControlChunk_(ss, chunk'), 'normal enrichment completes before control enrichment');
assert(source.includes('g010WriteFinalCandidateSnapshotFromMaster_'), 'controls do not enter candidate snapshot from raw records');
console.log('PASS rejected control sample: cap, deterministic continuation, and candidate boundary');
