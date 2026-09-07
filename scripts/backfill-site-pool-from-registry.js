#!/usr/bin/env node
/**
 * Load authentic Control Center registry site records and either:
 *   --dry-run   print JSON payload for SITE_POOL_BUILD_RECONCILE_V1
 *   --post-url  POST the payload to the Steam Apps Script web app
 *
 * Never invents Site ID / URL. Only emits sites with real steam_app_id,
 * site_id, and a published production/preview URL plus a completion timestamp.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var https = require('https');
var http = require('http');

function loadYamlLite(filePath) {
  try {
    return require('js-yaml').load(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    // Prefer Python PyYAML when js-yaml is not installed in this repo.
    var child = require('child_process').spawnSync(
      'python3',
      ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding=\"utf-8\"))))', filePath],
      {encoding: 'utf8'}
    );
    if (child.status !== 0) {
      throw new Error('Unable to read registry YAML (js-yaml/PyYAML): ' +
        (child.stderr || err.message));
    }
    return JSON.parse(child.stdout);
  }
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function isRealUrl(value) {
  var url = text(value);
  if (!url || /^(MISSING|N\/A|NA|TBD|TODO|NONE|NULL|-)$/i.test(url)) return false;
  return /^https?:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([\/?#]|$)/i.test(url);
}

function normalizePhase(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '_');
}

function isCompletePhase(phase, siteStatus) {
  var p = normalizePhase(phase);
  var s = normalizePhase(siteStatus);
  return [
    'LIVE', 'PRODUCTION', 'PRODUCTION_LIVE', 'GENERATED', 'PREVIEW_READY',
    'READY_FOR_PRODUCTION_REVIEW'
  ].indexOf(p) >= 0 || ['LIVE', 'PRODUCTION', 'PREVIEW_READY', 'GENERATED'].indexOf(s) >= 0;
}

function buildRecords(sitesPath, gamesPath) {
  var sitesPayload = loadYamlLite(sitesPath);
  var gamesPayload = gamesPath && fs.existsSync(gamesPath) ? loadYamlLite(gamesPath) : {games: []};
  var gamesById = {};
  var gamesList = Array.isArray(gamesPayload)
    ? gamesPayload
    : (gamesPayload && gamesPayload.games) || [];
  gamesList.forEach(function (game) {
    if (game && game.game_id) gamesById[String(game.game_id)] = game;
  });

  var siteList = Array.isArray(sitesPayload)
    ? sitesPayload
    : (sitesPayload && sitesPayload.sites) || [];

  var records = [];
  var skipped = [];
  siteList.forEach(function (site) {
    if (!site || typeof site !== 'object') return;
    var siteId = text(site.site_id);
    var game = gamesById[text(site.game_id)] || {};
    var appId = text(site.steam_app_id || site.steamAppId || game.steam_app_id || game.steamAppId);
    var vercel = site.vercel || {};
    var lifecycle = site.lifecycle || {};
    var launch = site.launch || {};
    var productionUrl = text(vercel.production_url || site.production_url);
    var previewUrl = text(vercel.preview_url || vercel.deployment_url);
    var url = isRealUrl(productionUrl) ? productionUrl : (isRealUrl(previewUrl) ? previewUrl : '');
    var liveAt = text(lifecycle.phase_entered_at || launch.launch_date || '');
    var phase = text(lifecycle.phase || (site.site && site.site.status) || '');
    var siteStatus = text(site.site && site.site.status);
    var fixture = /(?:^|[-_])(?:fixture|artificial)(?:[-_]|$)/i.test(siteId);

    if (fixture) {
      skipped.push({siteId: siteId, reason: 'fixture_or_artificial'});
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteId) || !/^\d{3,}$/.test(appId)) {
      skipped.push({siteId: siteId, appId: appId, reason: 'missing_identity'});
      return;
    }
    if (!url) {
      skipped.push({siteId: siteId, appId: appId, reason: 'missing_published_url'});
      return;
    }
    if (!isCompletePhase(phase, siteStatus) && !liveAt) {
      skipped.push({siteId: siteId, appId: appId, reason: 'no_completion_signal'});
      return;
    }
    records.push({
      siteId: siteId,
      appId: appId,
      gameName: text(game.name || site.game_id || siteId),
      vercelUrl: url,
      actualLiveAt: liveAt || new Date().toISOString(),
      launchPageCount: launch.published_page_count == null ? '' : launch.published_page_count,
      templateVersion: text(launch.template_version || (site.site && site.site.template_version) || ''),
      source: 'control_center_registry',
      lifecyclePhase: phase || siteStatus
    });
  });
  return {records: records, skipped: skipped};
}

function postJson(url, body) {
  return new Promise(function (resolve, reject) {
    var payload = JSON.stringify(body);
    var target = new URL(url);
    var lib = target.protocol === 'http:' ? http : https;
    var req = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')});
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseArgs(argv) {
  var out = {
    sites: path.resolve(__dirname, '../../hotword-control-center/registry/sites.yaml'),
    games: path.resolve(__dirname, '../../hotword-control-center/registry/games.yaml'),
    dryRun: true,
    postUrl: '',
    token: process.env.STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN ||
      process.env.STEAM_CANDIDATE_RESEARCH_CALLBACK_TOKEN || ''
  };
  for (var i = 2; i < argv.length; i += 1) {
    var arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--post-url') { out.postUrl = argv[++i]; out.dryRun = false; }
    else if (arg === '--sites') out.sites = path.resolve(argv[++i]);
    else if (arg === '--games') out.games = path.resolve(argv[++i]);
    else if (arg === '--token') out.token = argv[++i];
  }
  return out;
}

async function main() {
  var args = parseArgs(process.argv);
  var built = buildRecords(args.sites, args.games);
  var payload = {
    job_type: 'SITE_POOL_BUILD_RECONCILE_V1',
    token: args.token,
    include_gsc_bindings: true,
    existing_site_records: built.records
  };
  if (args.dryRun || !args.postUrl) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      recordCount: built.records.length,
      skippedCount: built.skipped.length,
      records: built.records,
      skipped: built.skipped,
      postBodyPreview: {
        job_type: payload.job_type,
        include_gsc_bindings: payload.include_gsc_bindings,
        existing_site_records: built.records.length
      }
    }, null, 2));
    return;
  }
  if (!args.token) throw new Error('STEAM_CANDIDATE_RESEARCH_WRITE_TOKEN / --token required for POST');
  var response = await postJson(args.postUrl, payload);
  console.log(response.body);
  if (response.status < 200 || response.status >= 300) process.exitCode = 1;
}

main().catch(function (err) {
  console.error(err.stack || err.message || err);
  process.exitCode = 1;
});
