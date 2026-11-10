#!/usr/bin/env node
/**
 * Couverture Flutter : lit lcov.info, ajoute les fichiers de lib/ jamais importes par un test
 * (sinon la mesure est flatteuse), calcule les lignes par perimetre et applique des seuils.
 *
 * Usage : node lcov-check.js <lcov.info> <dossier lib/> --min-total=N [--scope=prefix:min ...] [--json=out.json]
 *   --scope=core/params:80   fichiers dont le chemin relatif a lib/ commence par core/params, seuil en %.
 * Limite connue : `flutter test --coverage` ne produit pas de couverture de branches (BRDA) ;
 * le seuil des moteurs Dart porte donc sur les lignes. Les fichiers absents du lcov sont comptes avec
 * une estimation du nombre de lignes executables (lignes non vides, hors commentaires, import/export/part,
 * accolades seules) : estimation a +/- 15 %, signalee comme telle dans le rapport.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [lcovPath, libDir, ...flags] = process.argv.slice(2);
if (!lcovPath || !libDir) {
  console.error('usage: lcov-check.js <lcov.info> <lib dir> --min-total=N [--scope=prefix:min] [--json=file]');
  process.exit(2);
}
const opt = { scopes: [] };
for (const f of flags) {
  const m = /^--([a-z-]+)=(.*)$/.exec(f);
  if (!m) continue;
  if (m[1] === 'scope') {
    const i = m[2].lastIndexOf(':');
    opt.scopes.push({ prefix: m[2].slice(0, i), min: Number(m[2].slice(i + 1)) });
  } else opt[m[1]] = m[2];
}

const norm = (p) => p.replace(/\\/g, '/');
const libRoot = norm(path.resolve(libDir));
const rel = (p) => {
  const abs = norm(path.resolve(path.dirname(path.resolve(lcovPath)), '..', p));
  const idx = abs.indexOf('/lib/');
  return idx >= 0 ? abs.slice(idx + 5) : norm(p).replace(/^lib\//, '');
};

/** @type {Map<string,{found:number,hit:number,estimated:boolean}>} */
const files = new Map();
let cur = null;
for (const line of fs.readFileSync(lcovPath, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('SF:')) {
    cur = { found: 0, hit: 0, estimated: false };
    files.set(rel(line.slice(3)), cur);
  } else if (line.startsWith('DA:') && cur) {
    cur.found++;
    if (Number(line.split(',')[1]) > 0) cur.hit++;
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.dart')) out.push(p);
  }
  return out;
}
function estimateExecutable(file) {
  let n = 0;
  let inBlock = false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (inBlock) {
      if (l.includes('*/')) inBlock = false;
      continue;
    }
    if (l.startsWith('/*')) {
      if (!l.includes('*/')) inBlock = true;
      continue;
    }
    if (!l || l.startsWith('//') || /^(import|export|part|library)\b/.test(l) || /^[)\]};,\s]+$/.test(l)) continue;
    n++;
  }
  return n;
}
let missing = 0;
for (const f of walk(libRoot)) {
  const r = norm(path.relative(libRoot, f));
  if (!files.has(r)) {
    files.set(r, { found: estimateExecutable(f), hit: 0, estimated: true });
    missing++;
  }
}

const pct = (a, b) => (b === 0 ? 100 : (100 * a) / b);
const sum = (pred) => {
  let found = 0;
  let hit = 0;
  for (const [r, v] of files) if (pred(r)) (found += v.found), (hit += v.hit);
  return { found, hit, pct: pct(hit, found) };
};

const total = sum(() => true);
const result = { total: { ...total, filesNotImported: missing }, scopes: {} };
let failed = false;
console.log(`Mobile lignes (lcov + ${missing} fichier(s) jamais importe(s), estimes) : ${total.hit}/${total.found} = ${total.pct.toFixed(2)} %`);
if (opt['min-total'] !== undefined && total.pct + 1e-9 < Number(opt['min-total'])) {
  console.error(`ECHEC : couverture totale ${total.pct.toFixed(2)} % < seuil ${opt['min-total']} %`);
  failed = true;
}
for (const s of opt.scopes) {
  const r = sum((p) => p.startsWith(s.prefix));
  result.scopes[s.prefix] = { ...r, min: s.min };
  console.log(`  ${s.prefix} : ${r.hit}/${r.found} = ${r.pct.toFixed(2)} % (seuil ${s.min} %)`);
  if (r.pct + 1e-9 < s.min) {
    console.error(`ECHEC : ${s.prefix} ${r.pct.toFixed(2)} % < seuil ${s.min} %`);
    failed = true;
  }
}
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(result, null, 2));
process.exit(failed ? 1 : 0);
