// Rendu d'un fichier HTML/SVG en PNG (et PDF optionnel) avec Chromium.
// node tools/shot.js <entrée.html|svg> <sortie.png> [largeur] [hauteur] [échelle]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [, , input, output, w = '1600', h = '1000', scale = '1'] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: +scale,
  });
  await page.goto('file://' + path.resolve(input));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: output, fullPage: false });
  await browser.close();
})();
