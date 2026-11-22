const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright'); const QR = require('qrcode');
const DIR = __dirname; const FD = 'file:///home/user/GLOBAL/presentation-saas/public/fonts'; const SH = 'file:///home/user/GLOBAL/presentation-saas/public/shots';
const SITE = 'https://hotel-manager-pro-81wg.vercel.app'; const SITE_SHORT = 'hotel-manager-pro-81wg.vercel.app';
const C = { night: '#070B1A', mist: '#E6EBFA', mute: '#98A4D0', ind1: '#5668F0', ind2: '#1B2476', em1: '#23DDB0', em2: '#0A7C66', lat1: '#FF7C4D', lat2: '#D93A1E' };
const W = 1080, H = 1350;

/* ---------- marque (identique au logo) ---------- */
const pt = (a) => a.map((p) => p.join(',')).join(' '); const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
function mark(id) {
  const cx = 200, cy = 214, R = 112, dx = R * Math.cos(Math.PI / 6), dy = R * Math.sin(Math.PI / 6), lift = 20;
  const T = [cx, cy - R], UR = [cx + dx, cy - dy], LR = [cx + dx, cy + dy], B = [cx, cy + R], LL = [cx - dx, cy + dy], UL = [cx - dx, cy - dy], Cc = [cx, cy];
  const top = [T, UR, Cc, UL], left = [UL, Cc, B, LL], right = [Cc, UR, LR, B];
  const grid = (q) => { const [a, b, c, d] = q; const m1 = [mid(a, b), mid(d, c)], m2 = [mid(b, c), mid(a, d)];
    return [m1, m2].map(([p, r]) => `<line x1="${p[0]}" y1="${p[1]}" x2="${r[0]}" y2="${r[1]}" stroke="#fff" stroke-opacity=".17" stroke-width="2"/>`).join(''); };
  const rx = 168, ry = 58, rot = -24, dotA = 38 * Math.PI / 180, dot = [rx * Math.cos(dotA), ry * Math.sin(dotA)];
  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg"><defs>
<linearGradient id="t${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.lat1}"/><stop offset="1" stop-color="${C.lat2}"/></linearGradient>
<linearGradient id="l${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ind1}"/><stop offset="1" stop-color="${C.ind2}"/></linearGradient>
<linearGradient id="r${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.em1}"/><stop offset="1" stop-color="${C.em2}"/></linearGradient>
<mask id="m${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400"><rect width="400" height="400" fill="#fff"/><line x1="${Cc[0]}" y1="${Cc[1]}" x2="${B[0]}" y2="${B[1] + 4}" stroke="#000" stroke-width="7"/></mask></defs>
<g transform="translate(${cx} ${cy}) rotate(${rot})" fill="none" stroke="#fff" stroke-opacity=".72" stroke-width="3.5" stroke-linecap="round"><path d="M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0"/></g>
<g mask="url(#m${id})"><polygon points="${pt(left)}" fill="url(#l${id})"/><polygon points="${pt(right)}" fill="url(#r${id})"/>${grid(left)}${grid(right)}</g>
<g transform="translate(0 ${-lift})"><polygon points="${pt(top)}" fill="url(#t${id})"/>${grid(top)}<polyline points="${pt([UL, T, UR])}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.2" stroke-linejoin="round"/></g>
<g transform="translate(${cx} ${cy}) rotate(${rot})" fill="none"><path d="M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0" stroke="#fff" stroke-opacity=".72" stroke-width="3.5" stroke-linecap="round"/><circle cx="${dot[0]}" cy="${dot[1]}" r="12" fill="${C.lat1}" stroke="${C.night}" stroke-width="4"/></g></svg>`;
}

/* ---------- trame isométrique ---------- */
const XS = 72.7, YS = 42; const P = (o, i, j) => [o[0] + (i - j) * XS, o[1] + (i + j) * YS];
function floor(o, i0, i1, j0, j1, op) {
  let s = '';
  for (let i = i0; i <= i1; i++) { const a = P(o, i - .5, j0 - .5), b = P(o, i - .5, j1 + .5); s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; }
  for (let j = j0; j <= j1; j++) { const a = P(o, i0 - .5, j - .5), b = P(o, i1 + .5, j - .5); s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; }
  return `<g stroke="#9FB0FF" stroke-opacity="${op}" stroke-width="1.2">${s}</g>`;
}
const bg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0"><defs>
<radialGradient id="sky" cx="140" cy="-60" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4658E8" stop-opacity=".42"/><stop offset="1" stop-color="#4658E8" stop-opacity="0"/></radialGradient>
<radialGradient id="dawn" cx="1040" cy="1380" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.lat1}" stop-opacity=".40"/><stop offset=".5" stop-color="${C.lat2}" stop-opacity=".10"/><stop offset="1" stop-color="${C.lat2}" stop-opacity="0"/></radialGradient>
<radialGradient id="em" cx="470" cy="770" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.em1}" stop-opacity=".26"/><stop offset="1" stop-color="${C.em1}" stop-opacity="0"/></radialGradient>
<radialGradient id="fade" cx="600" cy="760" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
<mask id="fm"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask></defs>
<rect width="${W}" height="${H}" fill="${C.night}"/><rect width="${W}" height="${H}" fill="url(#sky)"/><rect width="${W}" height="${H}" fill="url(#dawn)"/>
<g mask="url(#fm)">${floor([560, 520], -6, 8, -6, 8, .16)}</g><rect width="${W}" height="${H}" fill="url(#em)"/></svg>`;

const dots = [C.em1, '#A9B6FF', '#FFB08F'];
const feats = ['Réservations', 'Calendrier', 'Chambres et clients', 'Réception', 'Facturation PDF', 'Restaurant', 'Housekeeping', 'Rapports', 'Mobile Money'];
const pills = feats.map((t, i) => `<span class="pill"><i style="background:${dots[i % 3]}"></i>${t}</span>`).join('');

(async () => {
  const qr = await QR.toString(SITE + '/inscription', { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#070B1A', light: '#FFFFFF' } });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Outfit';src:url('${FD}/Outfit-Bold.ttf');font-weight:700}
@font-face{font-family:'Outfit';src:url('${FD}/Outfit-Regular.ttf');font-weight:400}
@font-face{font-family:'GeistMono';src:url('${FD}/GeistMono-Regular.ttf');font-weight:400}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden;background:${C.night};-webkit-font-smoothing:antialiased}
.abs{position:absolute}
.pill{display:inline-flex;align-items:center;gap:11px;height:46px;padding:0 20px 0 17px;border-radius:23px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);font-family:Outfit;font-weight:400;font-size:21px;color:${C.mist};white-space:nowrap}
.pill i{width:9px;height:9px;border-radius:50%;display:inline-block}
.qr svg{display:block;width:100%;height:100%}
</style></head><body><div class="abs" style="left:0;top:0;width:${W}px;height:${H}px;overflow:hidden">${bg}

<!-- en-tête -->
<div class="abs" style="left:64px;top:52px;display:flex;align-items:center;gap:14px"><div style="width:62px;height:62px">${mark('a')}</div>
  <div><div style="font-family:Outfit;color:#fff;font-size:31px;line-height:1;letter-spacing:-.02em"><b style="font-weight:700">SaaS</b> Lab</div><div style="font-family:GeistMono;font-size:10px;letter-spacing:.5em;color:${C.mute};margin-top:8px">MADAGASCAR</div></div></div>
<div class="abs" style="right:64px;top:70px;font-family:GeistMono;font-size:13px;letter-spacing:.18em;color:${C.mute};display:flex;align-items:center;gap:10px"><i style="width:8px;height:8px;border-radius:50%;background:${C.em1};display:inline-block"></i><span style="color:#fff">HOTEL MANAGER PRO</span></div>

<!-- titre -->
<div class="abs" style="left:60px;top:158px;font-family:Outfit;font-size:112px;line-height:1.0;letter-spacing:-.035em;color:#fff"><b style="font-weight:700">Votre hôtel,</b><br><span style="font-weight:400;color:#AEB9E6">sous contrôle.</span></div>
<div class="abs" style="left:64px;top:402px;width:800px;font-family:Outfit;font-weight:400;font-size:29px;line-height:1.38;color:${C.mist};opacity:.88">Réservations, facturation, réception, restaurant, rapports : tout votre hôtel dans un seul logiciel.</div>

<!-- captures -->
<div class="abs" style="left:64px;top:528px;width:740px;height:462.5px;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.24);box-shadow:0 50px 100px rgba(0,0,0,.6),0 0 90px rgba(35,221,176,.14)"><img src="${SH}/calendrier.jpg" style="display:block;width:100%;height:100%;object-fit:cover"></div>
<div class="abs" style="left:790px;top:546px;width:226px;height:474px;border-radius:38px;background:#0A0F28;padding:7px;border:1px solid rgba(255,255,255,.28);box-shadow:0 50px 90px rgba(0,0,0,.65),0 0 70px rgba(86,104,240,.22)"><img src="${SH}/mobile-overview.jpg" style="display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:31px"></div>
<div class="abs" style="left:64px;top:1008px;font-family:GeistMono;font-size:12px;letter-spacing:.2em;color:${C.mute};display:flex;align-items:center;gap:10px"><i style="width:7px;height:7px;border-radius:50%;background:${C.em1};display:inline-block"></i>CALENDRIER D'OCCUPATION · SUR ORDINATEUR ET TÉLÉPHONE</div>

<!-- fonctions -->
<div class="abs" style="left:64px;top:1050px;width:952px;display:flex;flex-wrap:wrap;gap:10px">${pills}</div>

<!-- appel à l'action -->
<div class="abs" style="left:64px;top:1180px;width:952px;height:122px;border-radius:26px;border:1px solid rgba(255,255,255,.22);background:linear-gradient(100deg,rgba(35,221,176,.20),rgba(86,104,240,.16) 58%,rgba(255,124,77,.18));box-shadow:0 20px 60px rgba(0,0,0,.35)">
  <div class="abs" style="left:30px;top:20px;display:flex;align-items:baseline;gap:14px;font-family:Outfit;line-height:1"><span style="font-weight:700;font-size:62px;color:${C.em1};letter-spacing:-.03em">14</span><span style="font-weight:700;font-size:33px;color:#fff;letter-spacing:-.01em">jours d'essai gratuit</span></div>
  <div class="abs" style="left:32px;top:86px;font-family:Outfit;font-weight:400;font-size:18px;color:${C.mist};opacity:.85">Créez votre compte et testez avec votre hôtel.</div>
  <div class="abs" style="right:128px;top:26px;text-align:right"><div style="font-family:Outfit;font-weight:700;font-size:22px;color:#fff">Scannez pour essayer</div>
    <div style="font-family:GeistMono;font-size:12.5px;letter-spacing:.02em;color:${C.em1};margin-top:10px">${SITE_SHORT}</div>
    <div style="font-family:Outfit;font-size:16px;color:${C.mute};margin-top:9px">Une question ? Écrivez-nous en message privé.</div></div>
  <div class="abs qr" style="right:22px;top:16px;width:90px;height:90px;background:#fff;border-radius:14px;padding:7px">${qr}</div>
</div>
</div></body></html>`;
  const f = path.join(DIR, 'affiche.html'); fs.writeFileSync(f, html);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p.goto('file://' + f); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(DIR, 'affiche-1080x1350.png') });
  // contrôle de géométrie : rien ne dépasse, rien ne se chevauche
  const rep = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const pills = [...document.querySelectorAll('.pill')].map((e) => Math.round(e.getBoundingClientRect().top)); return { pillsRows: [...new Set(pills)], pillsRight: Math.max(...[...document.querySelectorAll('.pill')].map((e) => Math.round(e.getBoundingClientRect().right))) }; });
  console.log(JSON.stringify(rep));
  await b.close(); console.log('ok');
})();
