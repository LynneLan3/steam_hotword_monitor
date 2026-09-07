#!/usr/bin/env node
/** Drive G010 continuation via Web App deployment until production log shows SUCCESS. */
'use strict';

const https = require('https');
const {execFileSync} = require('child_process');
const path = require('path');

const DEPLOY = process.env.G010_WEB_DEPLOY_ID ||
  'AKfycbxKVxbb7ueWQqIgDaCMsTVLWY6Yn-ddr4nMdAvotbmRJT04yb6oKM6UiWoaSLjFJWKV';
const BASE = `https://script.google.com/macros/s/${DEPLOY}/exec`;
const MAX_SEGMENTS = 50;
const POLL_WAIT_MS = 120000;
const RUN_ID = process.env.G010_TARGET_RUN_ID || '20260901-110846';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {timeout: timeoutMs || 360000}, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function pollProduction() {
  try {
    return JSON.parse(execFileSync('node', [path.join(__dirname, 'g010-poll-production.js')], {
      encoding: 'utf8',
      env: Object.assign({}, process.env, {G010_TARGET_RUN_ID: RUN_ID})
    }).trim());
  } catch (err) {
    const stdout = String(err.stdout || '').trim();
    if (stdout) {
      try { return JSON.parse(stdout); } catch (parseErr) { /* fall through */ }
    }
    throw err;
  }
}

(async () => {
  const started = Date.now();
  let segments = 0;
  let lastPoll = pollProduction();
  console.log(JSON.stringify({phase: 'initial', poll: lastPoll}));

  if ((lastPoll.log || []).some(r => String(r.status).toUpperCase() === 'SUCCESS')) {
    console.log(JSON.stringify({done: true, segments: 0, wallSec: 0, poll: lastPoll}));
    process.exit(0);
  }

  try {
    const kick = await fetchUrl(`${BASE}?action=g010KickContinuation`, 60000);
    console.log(JSON.stringify({kick: JSON.parse(kick)}));
  } catch (kickErr) {
    console.log(JSON.stringify({kickError: String(kickErr.message || kickErr)}));
  }

  for (let i = 0; i < MAX_SEGMENTS; i += 1) {
    segments += 1;
    let segmentResult = null;
    try {
      const body = await fetchUrl(`${BASE}?action=g010ContinueSegment`, 360000);
      segmentResult = JSON.parse(body);
    } catch (segErr) {
      segmentResult = {error: String(segErr.message || segErr), note: 'http_reset_may_still_run'};
    }
    console.log(JSON.stringify({segment: segments, result: segmentResult}));

    await sleep(15000);
    lastPoll = pollProduction();
    const lastLog = (lastPoll.log || []).slice(-1)[0] || {};
    console.log(JSON.stringify({
      segment: segments,
      poll: {
        rawUnique: lastPoll.rawUnique,
        masterRows: lastPoll.masterRows,
        candidateSnapshot: lastPoll.candidateSnapshot,
        status: lastLog.status,
        detail: (lastLog.detail || '').slice(0, 200)
      }
    }));

    if (String(lastLog.status).toUpperCase() === 'SUCCESS') {
      console.log(JSON.stringify({
        done: true,
        segments,
        wallSec: Math.round((Date.now() - started) / 1000),
        poll: lastPoll
      }));
      process.exit(0);
    }

    await sleep(POLL_WAIT_MS);
  }

  console.log(JSON.stringify({
    done: false,
    segments,
    wallSec: Math.round((Date.now() - started) / 1000),
    poll: lastPoll
  }));
  process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(2);
});
