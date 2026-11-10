#!/usr/bin/env node
/**
 * Couverture API : fusionne coverage/coverage-final.json (unitaires) et coverage-e2e/coverage-final.json
 * (e2e), calcule les totaux et applique des seuils.
 *
 * Usage : node merge-api.js <apps/api> --min-lines=N [--min-branches=N]
 *           [--scope=prefix:lignes:branches ...] [--json=out.json] [--lcov-dir=dir]
 *   --scope=src/params/engine:0:68   chemin relatif a apps/api, seuils lignes et branches en %.
 * Le fichier fusionne est ecrit dans <apps/api>/coverage-merged/ (json-summary + lcov).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const apiDir = path.resolve(process.argv[2] || 'apps/api');
const req = createRequire(path.join(apiDir, 'package.json'));
const libCoverage = req('istanbul-lib-coverage');
const libReport = req('istanbul-lib-report');
const reports = req('istanbul-reports');

const opt = { scopes: [] };
for (const f of process.argv.slice(3)) {
  const m = /^--([a-z-]+)=(.*)$/.exec(f);
  if (!m) continue;
  if (m[1] === 'scope') {
    const [prefix, lines, branches] = m[2].split(':');
    opt.scopes.push({ prefix, lines: Number(lines), branches: Number(branches) });
  } else opt[m[1]] = m[2];
}

const map = libCoverage.createCoverageMap({});
const sources = [];
for (const dir of ['coverage', 'coverage-e2e']) {
  const file = path.join(apiDir, dir, 'coverage-final.json');
  if (fs.existsSync(file)) {
    map.merge(JSON.parse(fs.readFileSync(file, 'utf8')));
    sources.push(dir);
  }
}
if (sources.length === 0) {
  console.error('aucun coverage-final.json : lancer npm test -- --coverage et npm run test:e2e -- --coverage');
  process.exit(2);
}

const norm = (p) => p.replace(/\\/g, '/');
const relPath = (f) => norm(path.relative(apiDir, f));
function summarize(pred) {
  const s = libCoverage.createCoverageSummary();
  for (const f of map.files()) if (pred(relPath(f))) s.merge(map.fileCoverageFor(f).toSummary());
  return s;
}
const fmt = (m) => `${m.covered}/${m.total} = ${m.total ? m.pct.toFixed(2) : '100.00'} %`;

let failed = false;
const total = summarize(() => true);
console.log(`API fusion (${sources.join(' + ')}) :`);
console.log(`  lignes    ${fmt(total.lines)}`);
console.log(`  branches  ${fmt(total.branches)}`);
console.log(`  fonctions ${fmt(total.functions)}`);
const out = { sources, total: { lines: total.lines.pct, branches: total.branches.pct, functions: total.functions.pct }, scopes: {} };
if (opt['min-lines'] !== undefined && total.lines.pct + 1e-9 < Number(opt['min-lines'])) {
  console.error(`ECHEC : lignes ${total.lines.pct.toFixed(2)} % < seuil ${opt['min-lines']} %`);
  failed = true;
}
if (opt['min-branches'] !== undefined && total.branches.pct + 1e-9 < Number(opt['min-branches'])) {
  console.error(`ECHEC : branches ${total.branches.pct.toFixed(2)} % < seuil ${opt['min-branches']} %`);
  failed = true;
}
for (const s of opt.scopes) {
  const r = summarize((p) => p.startsWith(s.prefix));
  out.scopes[s.prefix] = { lines: r.lines.pct, branches: r.branches.pct, minLines: s.lines, minBranches: s.branches };
  console.log(`  ${s.prefix} : lignes ${fmt(r.lines)} (seuil ${s.lines} %), branches ${fmt(r.branches)} (seuil ${s.branches} %)`);
  if (r.lines.pct + 1e-9 < s.lines || r.branches.pct + 1e-9 < s.branches) {
    console.error(`ECHEC : ${s.prefix} sous le seuil`);
    failed = true;
  }
}

const outDir = path.join(apiDir, 'coverage-merged');
fs.mkdirSync(outDir, { recursive: true });
const context = libReport.createContext({ dir: outDir, coverageMap: map });
for (const r of ['json-summary', 'lcov']) reports.create(r).execute(context);
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(out, null, 2));
process.exit(failed ? 1 : 0);
