"""Trois directions pour la V2 (recto 1 L + logo), à comparer avant de tout décliner.

A · Plaque  — le logo est une plaque d'immatriculation. Univers voiture.
B · Mousse  — l'étiquette est un seau d'eau savonneuse : mousse en haut, eau en bas.
C · Éponge  — le jaune et la texture de l'éponge de lavage.

Usage : python3 directions/build.py   ->  directions/apercu/*.png
"""
import math
import random
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"
OUT = HERE / "apercu"
SRC = HERE / "html"
W, H = 100, 130  # mm

FACES = f"""
@font-face {{ font-family: "Barlow Condensed"; src: url("{FONTS}/BarlowCondensed-Medium.ttf"); font-weight: 500; }}
@font-face {{ font-family: "Barlow Condensed"; src: url("{FONTS}/BarlowCondensed-SemiBold.ttf"); font-weight: 600; }}
@font-face {{ font-family: "Barlow Condensed"; src: url("{FONTS}/BarlowCondensed-Bold.ttf"); font-weight: 700; }}
@font-face {{ font-family: "Barlow"; src: url("{FONTS}/Barlow-Regular.ttf"); font-weight: 400; }}
@font-face {{ font-family: "Barlow"; src: url("{FONTS}/Barlow-Medium.ttf"); font-weight: 500; }}
@font-face {{ font-family: "Barlow"; src: url("{FONTS}/Barlow-SemiBold.ttf"); font-weight: 600; }}
@font-face {{ font-family: "Familjen"; src: url("{FONTS}/FamiljenGrotesk[wght].ttf"); font-weight: 400 700; }}
@font-face {{ font-family: "Rubik"; src: url("{FONTS}/Rubik[wght].ttf"); font-weight: 300 900; }}
"""


def page(body, css, w=W, h=H):
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
{FACES}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {w}mm; height: {h}mm; overflow: hidden; }}
body {{ position: relative; font-kerning: normal; text-rendering: geometricPrecision; }}
{css}
</style></head><body>{body}</body></html>"""


# ---------------------------------------------------------------- A · Plaque
A = {"blanc": "#FFFFFF", "noir": "#1D1D1B", "bleu": "#1E47A0", "gris": "#5F5F5B"}


def drop_svg(color, h):
    # goutte simple : cercle + tangentes
    R = h / 2.9
    k = 1.9
    cy = h - R
    d = k * R
    beta = math.asin(R / d)
    tx, ty = R * math.cos(beta), cy - R * math.sin(beta)
    w = 2 * R
    cx = R
    return (f'<svg viewBox="0 0 {w:.3f} {h:.3f}" style="height:{h}mm;width:{w}mm;display:block" aria-hidden="true">'
            f'<path fill="{color}" d="M{cx} {cy - d:.3f}L{cx + tx:.3f} {ty:.3f}A{R:.3f} {R:.3f} 0 1 1 {cx - tx:.3f} {ty:.3f}Z"/></svg>')


def plate(width_mm, volume=None):
    h = width_mm / 4.6
    band = h * 0.47
    return f"""
<div class="plate" style="width:{width_mm}mm;height:{h:.2f}mm;border-width:{h*0.045:.2f}mm;border-radius:{h*0.13:.2f}mm">
  <div class="band" style="width:{band:.2f}mm">{drop_svg('#FFFFFF', h*0.36)}<span style="font-size:{h*0.2:.2f}mm">AC</span></div>
  <div class="name" style="font-size:{h*0.78:.2f}mm">AUTOCARE</div>
  {f'<div class="band right" style="width:{band*1.6:.2f}mm;font-size:{h*0.4:.2f}mm">{volume}</div>' if volume else ''}
</div>"""


A_CSS = f"""
body {{ background: {A['blanc']}; color: {A['noir']}; font-family: "Barlow", sans-serif; }}
.plate {{ display: flex; align-items: stretch; border-style: solid; border-color: {A['noir']}; background: #fff; overflow: hidden; }}
.plate .band {{ background: {A['bleu']}; color: #fff; display: flex; flex-direction: column; align-items: center;
               justify-content: center; gap: 4%; font-family: "Barlow Condensed"; font-weight: 600; letter-spacing: .04em; }}
.plate .band.right {{ font-weight: 700; letter-spacing: 0; }}
.plate .name {{ flex: 1; display: flex; align-items: center; justify-content: center; font-family: "Barlow Condensed";
               font-weight: 600; letter-spacing: .035em; line-height: 1; padding-top: 2%; }}
"""


def dir_a():
    body = f"""
<div style="position:absolute;left:8mm;top:10mm">{plate(84)}</div>
<h1 style="position:absolute;left:8mm;right:8mm;top:44mm;font-family:'Barlow Condensed';font-weight:700;font-size:44pt;line-height:.9;letter-spacing:-.005em">Shampooing<br>carrosserie</h1>
<p style="position:absolute;left:8mm;top:83mm;width:62mm;font-size:9.5pt;line-height:1.35;color:{A['noir']}">Concentré, pH neutre.<br><span style="color:{A['gris']}">Pour le lavage au seau et au canon à mousse.</span></p>
<div style="position:absolute;left:8mm;right:8mm;bottom:9mm;display:flex;justify-content:space-between;align-items:flex-end">
  <span></span>
  <span style="background:{A['bleu']};color:#fff;font-family:'Barlow Condensed';font-weight:700;font-size:26pt;line-height:1;padding:2.2mm 4mm 1.6mm;border-radius:1.6mm">1 L</span>
</div>"""
    return page(body, A_CSS)


def logo_a():
    body = f'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">{plate(120)}</div>'
    return page(body, A_CSS + f"body{{background:#F3F3F1}}", 160, 90)


# ---------------------------------------------------------------- B · Mousse
B = {"eau": "#CFE3F1", "mousse": "#FFFFFF", "bleu": "#173A63", "moyen": "#3D72A8", "ombre": "#DDEAF4"}


def foam_svg(edge, seed=7):
    rnd = random.Random(seed)
    parts = [f'<rect x="-5" y="-5" width="{W + 10}" height="{edge + 5}" fill="{B["mousse"]}"/>']
    x = -4
    while x < W + 6:
        r = rnd.uniform(2.6, 6.8)
        cy = edge + rnd.uniform(-1.8, 1.2)
        parts.append(f'<circle cx="{x:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{B["mousse"]}"/>')
        x += r * rnd.uniform(0.95, 1.5)
    # bulles libres sous la mousse, de moins en moins nombreuses
    for _ in range(14):
        y = edge + 6 + rnd.random() ** 1.6 * 18
        r = rnd.uniform(0.6, 1.6) * (1 - (y - edge) / 34)
        parts.append(f'<circle cx="{rnd.uniform(2, W - 2):.2f}" cy="{y:.2f}" r="{max(r, .5):.2f}" fill="{B["mousse"]}"/>')
    # quelques bulles dessinées dans la mousse, pour la matière
    for _ in range(5):
        y = rnd.uniform(edge - 12, edge - 2)
        r = rnd.uniform(0.8, 2.6)
        parts.append(f'<circle cx="{rnd.uniform(4, W - 4):.2f}" cy="{y:.2f}" r="{r:.2f}" fill="none" stroke="{B["ombre"]}" stroke-width=".28"/>')
    return (f'<svg viewBox="0 0 {W} {H}" style="position:absolute;inset:0;width:{W}mm;height:{H}mm" aria-hidden="true">'
            + "".join(parts) + "</svg>")


B_CSS = f"""
body {{ background: {B['eau']}; color: {B['bleu']}; font-family: "Familjen", sans-serif; }}
.word {{ font-family: "Familjen"; font-weight: 600; letter-spacing: -.035em; line-height: 1; }}
"""


def dir_b():
    body = f"""
{foam_svg(44)}
<div class="word" style="position:absolute;left:8mm;top:13mm;font-size:30pt">autocare</div>
<h1 style="position:absolute;left:8mm;right:8mm;top:66mm;font-weight:500;font-size:27pt;line-height:1.02;letter-spacing:-.02em">Shampooing<br>carrosserie</h1>
<p style="position:absolute;left:8mm;top:91.5mm;width:70mm;font-size:9.5pt;line-height:1.38">Concentré, pH neutre.<br>Pour le lavage au seau et au canon à mousse.</p>
<div style="position:absolute;left:8mm;bottom:8mm;font-weight:600;font-size:24pt;letter-spacing:-.02em;line-height:1">1 L</div>"""
    return page(body, B_CSS)


def logo_b():
    body = f'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div class="word" style="font-size:62pt">autocare</div></div>'
    return page(body, B_CSS + "body{background:#FFFFFF}", 160, 90)


# ---------------------------------------------------------------- C · Éponge
C = {"jaune": "#F2C230", "pore": "#EAB628", "nuit": "#1B2A4A", "creme": "#FFF6DA"}


def pores_svg(w, h, seed=3, density=1.0):
    rnd = random.Random(seed)
    pts = []
    tries = int(2600 * density * (w * h) / (W * H))
    for _ in range(tries):
        x, y = rnd.uniform(-1, w + 1), rnd.uniform(-1, h + 1)
        r = rnd.uniform(0.15, 1.0) ** 1.6 * 1.3 + 0.2
        if all((x - px) ** 2 + (y - py) ** 2 > (r + pr + 0.55) ** 2 for px, py, pr in pts[-400:]):
            pts.append((x, y, r))
    els = []
    for x, y, r in pts:
        ry = r * rnd.uniform(0.65, 1.0)
        a = rnd.uniform(0, 180)
        els.append(f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{r:.2f}" ry="{ry:.2f}" transform="rotate({a:.0f} {x:.2f} {y:.2f})"/>')
    return (f'<svg viewBox="0 0 {w} {h}" style="position:absolute;inset:0;width:{w}mm;height:{h}mm" aria-hidden="true">'
            f'<g fill="{C["pore"]}">' + "".join(els) + "</g></svg>")


C_CSS = f"""
body {{ background: {C['jaune']}; color: {C['nuit']}; font-family: "Rubik", sans-serif; }}
.word {{ font-family: "Rubik"; font-weight: 700; letter-spacing: -.03em; line-height: 1; }}
"""


def dir_c():
    body = f"""
{pores_svg(W, H)}
<div class="word" style="position:absolute;left:7mm;top:12mm;font-size:46pt">autocare</div>
<h1 style="position:absolute;left:8mm;right:8mm;top:58mm;font-weight:600;font-size:21pt;line-height:1.08;letter-spacing:-.015em">Shampooing<br>carrosserie</h1>
<p style="position:absolute;left:8mm;top:78mm;width:68mm;font-size:9.5pt;line-height:1.38;font-weight:400">Concentré, pH neutre.<br>Pour le lavage au seau et au canon à mousse.</p>
<div style="position:absolute;left:8mm;bottom:9mm;background:{C['nuit']};color:{C['jaune']};font-weight:700;font-size:20pt;line-height:1;padding:2.4mm 5mm 2.2mm;border-radius:20mm">1 L</div>"""
    return page(body, C_CSS)


def logo_c():
    body = (pores_svg(160, 90, seed=11) +
            '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div class="word" style="font-size:70pt">autocare</div></div>')
    return page(body, C_CSS, 160, 90)


def main():
    OUT.mkdir(exist_ok=True)
    SRC.mkdir(exist_ok=True)
    jobs = {
        "A_plaque_recto": (dir_a(), W, H), "A_plaque_logo": (logo_a(), 160, 90),
        "B_mousse_recto": (dir_b(), W, H), "B_mousse_logo": (logo_b(), 160, 90),
        "C_eponge_recto": (dir_c(), W, H), "C_eponge_logo": (logo_c(), 160, 90),
    }
    for name, (html, w, h) in jobs.items():
        p = SRC / f"{name}.html"
        p.write_text(html)
        px = 96 / 25.4
        subprocess.run(["node", str(HERE.parent / "tools" / "shot.js"), str(p), str(OUT / f"{name}.png"),
                        str(round(w * px)), str(round(h * px)), "4"], check=True)
        print(name)


if __name__ == "__main__":
    main()
