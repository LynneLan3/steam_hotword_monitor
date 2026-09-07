#!/usr/bin/env node
/** Drive active G010 run through clasp continuation segments until SUCCESS or timeout. */
'use strict';

const {execFileSync} = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAX_SEGMENTS = 40;
const SEGMENT_WAIT_MS = 90000;
const TARGET_RUN = process.env.G010_TARGET_RUN_ID || '';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function claspRun(fn) {
  try {
    const out = execFileSync('clasp', ['run', fn, '--json'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    return JSON.parse(out);
  } catch (err) {
    const stdout = String(err.stdout || '').trim();
    const stderr = String(err.stderr || '').trim();
    if (stdout) {
      try { return JSON.parse(stdout); } catch (parseErr) { /* fall through */ }
    }
    return {error: stderr || stdout || err.message};
  }
}

(async () => {
  const started = Date.now();
  let segments = 0;
  let last = null;
  for (let i = 0; i < MAX_SEGMENTS; i += 1) {
    segments += 1;
    last = claspRun('g010ContinueActiveRunOnce_');
    console.log(JSON.stringify({segment: segments, result: last}));
    if (last && last.status === 'SUCCESS') break;
    if (last && last.status === 'PARTIAL') {
      if (TARGET_RUN && last.runId && last.runId !== TARGET_RUN) {
        console.error('Unexpected runId', last.runId, 'expected', TARGET_RUN);
        process.exit(2);
      }
      await sleep(SEGMENT_WAIT_MS);
      continue;
    }
    if (last && last.error) {
      console.error('clasp run failed:', last.error);
      process.exit(3);
    }
    await sleep(SEGMENT_WAIT_MS);
  }
  const elapsedSec = Math.round((Date.now() - started) / 1000);
  console.log(JSON.stringify({
    done: last && last.status === 'SUCCESS',
    segments: segments,
    wallSec: elapsedSec,
    final: last
  }));
  process.exit(last && last.status === 'SUCCESS' ? 0 : 1);
})();
