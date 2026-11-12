"""Génère les fichiers du logo AutoCare (SVG vectorisés, sans police requise).

Usage : python3 tools/build_logo.py
Sortie : logo/*.svg  (+ logo/_lockups.json, utilisé par le générateur d'étiquettes)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from geom import Drop  # noqa: E402
from outline import text_path  # noqa: E402

PALETTE = json.loads((ROOT / "brand" / "palette.json").read_text())
COL = {c["id"]: c["hex"] for c in PALETTE["colors"]}

# --- paramètres du symbole -------------------------------------------------
K = 2.0          # hauteur apex / rayon
T = 0.30         # épaisseur des côtés / rayon
BAR = 0.15       # niveau de la ligne (fraction de R au-dessus du centre)

# --- paramètres du logotype -------------------------------------------------
WORD = "AUTOCARE"
WGHT, WDTH, TRACK = 700, 125, 0.03
SIZE = 100.0                       # corps de référence
CAP = 0.686 * SIZE                 # hauteur de capitale Archivo


def mark(cx, cy, R):
    """Goutte pleine, contre-forme triangulaire du « A »."""
    o = Drop(cx, cy, R, K)
    i = o.scaled((R - T * R) / R)
    y = cy - BAR * R - T * R / 2
    return o.outline(True) + i.region_above(y)


def mark_for_height(h, x=0.0, top=0.0):
    """Symbole de hauteur totale h, coin haut-gauche (x, top)."""
    R = h / (1 + K)
    return mark(x + R, top + K * R, R), 2 * R


def horizontal():
    word, ww = text_path(WORD, SIZE, WGHT, WDTH, TRACK)
    Ht = CAP * 1.18
    R = Ht / (1 + K)
    over_bottom = (Ht - CAP) * 0.35
    cy = -R + over_bottom
    m = mark(R, cy, R)
    mw = 2 * R
    gap = SIZE * 0.36
    x0, y0 = 0, cy - K * R
    x1, y1 = mw + gap + ww, cy + R
    body = (f'<path fill-rule="evenodd" d="{m}"/>'
            f'<path transform="translate({mw + gap:.3f} 0)" d="{word}"/>')
    return body, (x0, y0, x1 - x0, y1 - y0)


def vertical():
    word, ww = text_path(WORD, SIZE, WGHT, WDTH, TRACK)
    mh = CAP * 2.6
    R = mh / (1 + K)
    gap = CAP * 0.62
    cx = ww / 2
    cy = -CAP - gap - R
    m = mark(cx, cy, R)
    top = cy - K * R
    body = f'<path fill-rule="evenodd" d="{m}"/><path d="{word}"/>'
    return body, (0, top, ww, -top)


def symbol():
    h = 300.0
    m, w = mark_for_height(h)
    return f'<path fill-rule="evenodd" d="{m}"/>', (0, 0, w, h)


def wordmark():
    word, ww = text_path(WORD, SIZE, WGHT, WDTH, TRACK)
    return f'<path d="{word}"/>', (0, -CAP, ww, CAP)


def svg(body, box, fill, pad=0.0, bg=None, title="AutoCare"):
    x, y, w, h = box
    x, y, w, h = x - pad, y - pad, w + 2 * pad, h + 2 * pad
    bgrect = f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.3f} {y:.3f} {w:.3f} {h:.3f}" '
            f'width="{w:.2f}" height="{h:.2f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{bgrect}<g fill="{fill}">{body}</g></svg>\n')


def main():
    out = ROOT / "logo"
    out.mkdir(exist_ok=True)
    variants = {
        "horizontal": horizontal(),
        "vertical": vertical(),
        "symbole": symbol(),
        "logotype": wordmark(),
    }
    colorways = {
        "encre": COL["encre"],
        "petrole": COL["petrole"],
        "blanc": "#FFFFFF",
    }
    lockups = {}
    for name, (body, box) in variants.items():
        lockups[name] = {"body": body, "box": box}
        for cname, hexv in colorways.items():
            (out / f"autocare-{name}-{cname}.svg").write_text(svg(body, box, hexv))
    # icône d'application / réseaux sociaux : symbole sur carré pétrole
    m, w = mark_for_height(560, x=(1024 - 560 / (1 + K) * 2) / 2, top=(1024 - 560) / 2 + 12)
    icon = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" '
            f'role="img" aria-label="AutoCare"><title>AutoCare</title>'
            f'<rect width="1024" height="1024" fill="{COL["petrole"]}"/>'
            f'<path fill="{COL["ecume"]}" fill-rule="evenodd" d="{m}"/></svg>\n')
    (out / "autocare-icone.svg").write_text(icon)
    (ROOT / "build").mkdir(exist_ok=True)
    (ROOT / "build" / "lockups.json").write_text(json.dumps(lockups))
    print("logo ->", out)


if __name__ == "__main__":
    main()
