// Generates PNG icons and the Open Graph image from the logo SVG (run once: node scripts/gen-assets.cjs).
const { chromium } = require('playwright');
const path = require('path');
const out = (f) => path.join(__dirname, '..', 'public', f);
const mark = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 30 30"><circle cx="15" cy="15" r="13.5" fill="none" stroke="#C8F169" stroke-width="1.5"/><circle cx="15" cy="15" r="7.5" fill="none" stroke="#C8F169" stroke-width="1.5" stroke-dasharray="3 3"/><circle cx="15" cy="15" r="2.6" fill="#C8F169"/><circle cx="26.2" cy="9" r="2" fill="#8FE3FF"/></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [file, size, pad] of [['icon-192.png', 192, 0.18], ['icon-512.png', 512, 0.18], ['apple-touch-icon.png', 180, 0.16]]) {
    await p.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - 2 * pad));
    await p.setContent(`<body style="margin:0;width:${size}px;height:${size}px;background:#062B4F;display:flex;align-items:center;justify-content:center">${mark(inner)}</body>`);
    await p.screenshot({ path: out(file) });
  }
  await p.setViewportSize({ width: 1200, height: 630 });
  const fontDir = path.join(__dirname, '..', 'node_modules', '@fontsource');
  const fs = require('fs');
  const f64 = (rel) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(fontDir, rel)).toString('base64');
  await p.setContent(`<html><head><style>
    @font-face{font-family:B;src:url('${f64('bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2')}')}
    @font-face{font-family:P;src:url('${f64('ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2')}')}
    @font-face{font-family:M;src:url('${f64('ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')}')}
    body{margin:0;width:1200px;height:630px;background:#0780D8;color:#F2F8FD;font-family:P;position:relative;overflow:hidden}
    .bg{position:absolute;inset:0}
    .c{position:absolute;left:80px;top:76px;width:820px}
    .k{font-family:M;color:#C8F169;letter-spacing:.08em;font-size:22px;text-transform:uppercase;display:flex;gap:12px;align-items:center}
    .k i{width:12px;height:12px;border-radius:50%;background:#C8F169;display:inline-block}
    h1{font-family:B;font-weight:800;font-size:66px;line-height:1.02;letter-spacing:-.035em;margin:28px 0 0}
    h1 span{color:#C8F169}
    .brand{position:absolute;left:80px;bottom:60px;display:flex;align-items:center;gap:14px;font-family:B;font-size:34px}
  </style></head><body>
  <svg class="bg" viewBox="0 0 1200 630"><defs><pattern id="d" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#BFE3FB"/></pattern></defs><rect width="1200" height="630" fill="url(#d)" opacity=".35"/><circle cx="1000" cy="315" r="250" fill="none" stroke="#4FA9EA"/><circle cx="1000" cy="315" r="180" fill="none" stroke="#6BB8EE" stroke-dasharray="2 6"/><circle cx="1000" cy="315" r="320" fill="none" stroke="#3C9DE4"/></svg>
  <div class="c"><div class="k"><i></i>Gestion d'élevage · Afrique</div><h1>Ne ratez plus aucun vaccin.<br><span>Pilotez toute votre ferme,</span> même sans réseau.</h1></div>
  <div class="brand">${mark(46)}RecallFarm</div></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  await p.screenshot({ path: out('og-image.png') });
  await b.close();
  console.log('assets generated');
})();
