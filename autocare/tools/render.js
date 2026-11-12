// Rend chaque étiquette en PDF vectoriel (taille exacte) et en PNG d'aperçu.
// node tools/render.js build/jobs.json
const { chromium } = require('playwright');
const fs = require('fs');

const PX_PER_MM = 96 / 25.4;

(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch();
  for (const j of jobs) {
    const vw = Math.ceil(j.page_w * PX_PER_MM);
    const vh = Math.ceil(j.page_h * PX_PER_MM);
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 4 });
    await page.goto('file://' + j.html);
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: j.pdf,
      width: `${j.page_w}mm`,
      height: `${j.page_h}mm`,
      printBackground: true,
      preferCSSPageSize: true,
      pageRanges: '1',
    });
    const [x, y, w, h] = j.clip.map((v) => v * PX_PER_MM);
    await page.screenshot({ path: j.png, clip: { x, y, width: w, height: h } });
    await page.close();
  }
  await browser.close();
})();
