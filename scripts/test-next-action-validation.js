const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('SteamCandidateScanner.js', 'utf8');
const validationMatch = source.match(/validation\('Next Action', \[([^\]]+)\]\)/);
assert(validationMatch, 'Next Action validation definition exists');
const allowed = [...validationMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);

[
  'Google Trends', 'Social验证', 'SERP检查', 'Keyword Research',
  'Site Build', 'Recheck', 'None', 'Automatic Preflight'
].forEach(value => assert(allowed.includes(value), 'Next Action allows ' + value));

const generatedLiteralValues = [...source.matchAll(/decision\.nextAction\s*=\s*'([^']+)'/g)].map(match => match[1]);
generatedLiteralValues.forEach(value => {
  assert(allowed.includes(value), 'generated Next Action is in the validation allowlist: ' + value);
});

assert(
  source.includes("'Next Action': decision.nextAction"),
  'syncCandidateDecisions_ writes Next Action through the canonical row schema'
);
assert(
  source.includes("decision.nextAction = 'Automatic Preflight'"),
  'syncCandidateDecisions_ can emit Automatic Preflight'
);

console.log('PASS Next Action validation schema and generated values');
