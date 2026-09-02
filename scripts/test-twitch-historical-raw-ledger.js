/** Offline checks for Twitch Historical Raw Ledger Apps Script module. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, '..', 'TwitchHistoricalRawLedger.gs'), 'utf8');
const scanner = fs.readFileSync(path.join(__dirname, '..', 'SteamCandidateScanner.js'), 'utf8');

assert(source.includes("'Twitch Historical Raw Ledger V1'"), 'spreadsheet name pinned');
assert(source.includes("'Run Ledger'"), 'Run Ledger tab declared');
assert(source.includes("'Raw Observations'"), 'Raw Observations tab declared');
assert(source.includes("'Daily Canonical Runs'"), 'Daily Canonical Runs tab declared');
assert(source.includes('TWITCH_HISTORICAL_RAW_LEDGER_APPEND'), 'job type declared');
assert(source.includes('SUCCESS + COMPLETE + production + latest finished'), 'canonical priority recorded');
assert(scanner.includes("jobType === 'TWITCH_HISTORICAL_RAW_LEDGER_APPEND'"), 'doPost routes Twitch ledger job');
assert(scanner.includes('handleTwitchHistoricalLedgerCallback_'), 'doPost invokes Twitch ledger handler');
assert(!/upsertMaster_|候选主表\.getRange|sheets\.master/.test(source), 'Twitch ledger module does not write candidate master');
console.log('PASS scripts/test-twitch-historical-raw-ledger.js');
