// Screenshots of the mock build (vite preview :4173) and of the design files, for visual comparison.
// usage: node scripts/screenshots.cjs <outDir> [designOutDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const out = process.argv[2] || path.join(__dirname, '../../../docs/screenshots');
const designOut = process.argv[3];
const repo = path.join(__dirname, '../../..');
const fontsCss = () => {
  const f = (pkg, file) => `url('file://${path.join(__dirname, '../node_modules/@fontsource', pkg, 'files', file)}')`;
  const faces = [];
  for (const w of [500, 700, 800]) faces.push(`@font-face{font-family:'Bricolage Grotesque';font-weight:${w};src:${f('bricolage-grotesque', `bricolage-grotesque-latin-${w}-normal.woff2`)}}`);
  for (const w of [400, 500, 600]) faces.push(`@font-face{font-family:'IBM Plex Sans';font-weight:${w};src:${f('ibm-plex-sans', `ibm-plex-sans-latin-${w}-normal.woff2`)}}`);
  for (const w of [400, 500]) faces.push(`@font-face{font-family:'IBM Plex Mono';font-weight:${w};src:${f('ibm-plex-mono', `ibm-plex-mono-latin-${w}-normal.woff2`)}}`);
  return `<style>${faces.join('')}</style>`;
};
function designToHtml(file) {
  let s = fs.readFileSync(file, 'utf8');
  s = s.replace(/<script src="\.\/support\.js"><\/script>/, '').replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const helmet = (/<helmet>([\s\S]*?)<\/helmet>/.exec(s) || [, ''])[1].replace(/<link[^>]+fonts\.google[^>]+>/g, '').replace(/<link rel="preconnect"[^>]*>/g, '');
  s = s.replace(/<helmet>[\s\S]*?<\/helmet>/, '').replace('<x-dc>', '').replace('</x-dc>', '');
  s = s.replace('</head>', `${helmet}${fontsCss()}</head>`);
  const tmp = path.join(path.dirname(file), `.tmp-${path.basename(file, '.dc.html')}.html`);
  fs.writeFileSync(tmp, s);
  return tmp;
}
(async () => {
  const b = await chromium.launch();
  const shot = async (url, file, { w = 1440, h = 1000, full = false, session } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    if (session) await ctx.addInitScript((s) => localStorage.setItem('rf.session.v1', JSON.stringify(s)), session);
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(1500);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) console.warn(`!! horizontal overflow on ${url} @${w}: ${sw}px`);
    await p.screenshot({ path: path.join(out, file), fullPage: full });
    console.log('saved', file);
    await ctx.close();
  };
  const aicha = { access: 'mock-at.u-aicha.1', refresh: 'mock-rt.u-aicha.1' };
  const jm = { access: 'mock-at.u-jeanmarc.1', refresh: 'mock-rt.u-jeanmarc.1' };
  await shot(`${BASE}/`, 'web-home-1440.png', { full: true });
  await shot(`${BASE}/`, 'web-home-1440-fold.png');
  await shot(`${BASE}/`, 'web-home-390.png', { w: 390, h: 844, full: true });
  await shot(`${BASE}/admin`, 'web-admin-dashboard-1440.png', { session: aicha });
  await shot(`${BASE}/admin/studio`, 'web-admin-studio-1440.png', { session: jm });
  if (process.env.ALL) {
    for (const [u, f] of [['/admin/exploitations', 'web-admin-farms'], ['/admin/exploitations/f-mfou', 'web-admin-farm'], ['/admin/rappels', 'web-admin-reminders'], ['/admin/alertes', 'web-admin-alerts'], ['/admin/surveillance', 'web-admin-surveillance'], ['/admin/campagnes', 'web-admin-campaigns'], ['/admin/abonnements', 'web-admin-subscriptions'], ['/admin/exports', 'web-admin-exports'], ['/admin/utilisateurs', 'web-admin-users']])
      await shot(`${BASE}${u}`, `${f}-1440.png`, { session: aicha });
    await shot(`${BASE}/admin/studio/v/v-porcin-200/formulaires`, 'web-admin-studio-forms-1440.png', { session: jm });
    await shot(`${BASE}/admin/studio/packs`, 'web-admin-studio-catalogue-1440.png', { session: jm });
    await shot(`${BASE}/admin/login`, 'web-admin-login-1440.png');
    await shot(`${BASE}/verifier`, 'web-verify-1440.png');
    await shot(`${BASE}/admin`, 'web-admin-dashboard-390.png', { w: 390, h: 844, full: true, session: aicha });
    await shot(`${BASE}/nope`, 'web-404-390.png', { w: 390, h: 844 });
  }
  if (designOut) {
    for (const [d, f, full] of [['Main', 'design-home-1440.png', true], ['Main', 'design-home-1440-fold.png', false], ['Admin', 'design-admin-1440.png', false], ['Studio', 'design-studio-1440.png', false]]) {
      const tmp = designToHtml(path.join(repo, 'docs/design', `${d}.dc.html`));
      const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
      const p = await ctx.newPage();
      await p.goto('file://' + tmp);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(designOut, f), fullPage: full });
      fs.unlinkSync(tmp);
      await ctx.close();
      console.log('saved', f);
    }
  }
  await b.close();
})();
