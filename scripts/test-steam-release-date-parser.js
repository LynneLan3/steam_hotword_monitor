/** Steam search release-date parser regressions; no network. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var source = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');
var sandbox = {
  console: console, String: String, Number: Number, Date: Date, Math: Math,
  Map: Map, Set: Set, Array: Array, Object: Object, isFinite: isFinite
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

function assert(value, label) { if (!value) throw new Error(label); }
function parse(release) {
  return sandbox.parseSteamSearchResults_(
    '<a class="search_result_row" data-ds-appid="123" ' +
    'href="https://store.steampowered.com/app/123/Test/">' +
    '<span class="title">Test</span>' +
    (release === null ? '' : '<div class="search_released">' + release + '</div>') +
    '</a>'
  )[0];
}

assert(parse('Sep 15, 2026').releaseDate === 'Sep 15, 2026', 'upcoming date');
assert(parse('Aug 20, 2026').releaseDate === 'Aug 20, 2026', 'released date');
assert(parse('Coming Soon').releaseDate === 'Coming Soon', 'coming soon');
assert(parse('TBA').releaseDate === 'TBA', 'TBA');
assert(parse(null).releaseDate === '', 'missing release date');
console.log('PASS scripts/test-steam-release-date-parser.js (upcoming, released, TBA/Coming soon, missing)');
