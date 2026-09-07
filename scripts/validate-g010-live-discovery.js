/** Live Steam discovery validation (local HTTP, mirrors G010 5-page cap). */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const MAX_PAGES = 5;
const SOURCES = [
  {name: 'Popular Upcoming', url: 'https://store.steampowered.com/search/?filter=popularcomingsoon&os=win'},
  {name: 'Popular New Releases', url: 'https://store.steampowered.com/search/?filter=popularnew&os=win&sort_by=Released_DESC'}
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers: {Accept: 'text/html', 'User-Agent': UA}}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    }).on('error', reject);
  });
}

function parseAppIds(html) {
  const ids = [];
  const rowRegex = /<a\b[^>]*class=["'][^"']*\bsearch_result_row\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  const rows = html.match(rowRegex) || [];
  rows.forEach(row => {
    const appIdAttr = row.match(/\bdata-ds-appid=["'](\d+)["']/i);
    const appIdUrl = row.match(/\bhref=["'][^"']*\/app\/(\d+)/i);
    const appId = appIdAttr ? appIdAttr[1] : (appIdUrl ? appIdUrl[1] : '');
    if (appId) ids.push(String(appId));
  });
  return ids;
}

async function discoverSource(source) {
  const seen = new Set();
  const pages = [];
  let consecutiveNoNew = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? source.url : source.url + '&page=' + page;
    const res = await fetchUrl(url);
    if (res.status !== 200) {
      return {source: source.name, pages, raw: seen.size, error: 'HTTP ' + res.status, stopReason: 'fetch-failure'};
    }
    const ids = parseAppIds(res.body);
    pages.push({page: page, count: ids.length});
    let fresh = 0;
    ids.forEach(id => { if (!seen.has(id)) { seen.add(id); fresh += 1; } });
    if (!ids.length) return {source: source.name, pages, raw: seen.size, stopReason: 'empty-page'};
    if (fresh === 0) {
      consecutiveNoNew += 1;
      if (consecutiveNoNew >= 2) return {source: source.name, pages, raw: seen.size, stopReason: 'no-new-appids-2-pages'};
    } else {
      consecutiveNoNew = 0;
    }
    await sleep(1800);
  }
  return {source: source.name, pages, raw: seen.size, stopReason: 'max-pages'};
}

(async () => {
  const results = [];
  for (const source of SOURCES) results.push(await discoverSource(source));
  const merged = new Set();
  results.forEach(r => r.pages.forEach(p => {}));
  const allIds = new Set();
  for (const source of SOURCES) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = page === 1 ? source.url : source.url + '&page=' + page;
      const res = await fetchUrl(url);
      if (res.status !== 200) break;
      parseAppIds(res.body).forEach(id => allIds.add(id));
      await sleep(1800);
    }
  }
  console.log(JSON.stringify({
    validatedAt: new Date().toISOString(),
    maxPagesPerSource: MAX_PAGES,
    bySource: results,
    uniqueTotal: allIds.size
  }, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
