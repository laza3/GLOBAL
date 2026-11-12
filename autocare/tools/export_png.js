// Exporte chaque logo SVG en PNG transparent (2000 px sur le grand côté).
// node tools/export_png.js logo/*.svg
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  for (const f of process.argv.slice(2)) {
    const svg = fs.readFileSync(f, 'utf8');
    const m = svg.match(/viewBox="([^"]+)"/);
    const [, , w, h] = m[1].split(/\s+/).map(Number);
    const long = 2000;
    const k = long / Math.max(w, h);
    const W = Math.round(w * k), H = Math.round(h * k);
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${W}px;height:${H}px"></body></html>`);
    await page.waitForLoadState('load');
    const out = path.join('logo', 'png', path.basename(f, '.svg') + '.png');
    await page.screenshot({ path: out, omitBackground: true });
    await page.close();
    console.log(out, W + 'x' + H);
  }
  await browser.close();
})();
