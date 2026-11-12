"""Mise en situation de la gamme (illustration de présentation, pas un fichier d'impression).

Usage : python3 tools/mockup.py  ->  build/mockup.svg (rendu ensuite en PNG)
Toutes les cotes sont en millimètres ; les étiquettes sont posées à leur taille réelle.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREV = ROOT / "etiquettes" / "apercu"
pal = {c["id"]: c["hex"] for c in json.loads((ROOT / "brand" / "palette.json").read_text())["colors"]}

PLASTIC = "#FAFAF7"
CAP = pal["encre"]
GROUND = 420  # ligne de sol (mm)


def defs():
    return f"""
<defs>
  <linearGradient id="body" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#D9D8D2"/><stop offset=".07" stop-color="#F3F2EE"/>
    <stop offset=".22" stop-color="#FFFFFF"/><stop offset=".78" stop-color="#F7F6F2"/>
    <stop offset=".95" stop-color="#DEDDD7"/><stop offset="1" stop-color="#CFCEC8"/>
  </linearGradient>
  <linearGradient id="labelshade" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".08" stop-color="#000" stop-opacity="0"/>
    <stop offset=".9" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/>
  </linearGradient>
  <linearGradient id="cap" x1="0" x2="1">
    <stop offset="0" stop-color="#0B1311"/><stop offset=".3" stop-color="#2A3532"/><stop offset=".65" stop-color="{CAP}"/><stop offset="1" stop-color="#070C0B"/>
  </linearGradient>
  <radialGradient id="shadow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0" stop-color="#ECEAE5"/><stop offset=".25" stop-color="#E3E1DB"/><stop offset="1" stop-color="#DAD8D1"/>
  </linearGradient>
</defs>"""


def bottle_1l(x):
    """Flacon 1 L à face plate : corps 116 × 205, épaule, col, bouchon."""
    w, h = 116, 205
    top = GROUND - h
    sh = 34  # hauteur d'épaule
    neck_w, neck_h = 36, 14
    cx = x + w / 2
    body = (f"M{x} {GROUND - 10} L{x} {top + sh} "
            f"C{x} {top + 8} {cx - neck_w/2 - 6} {top + 2} {cx - neck_w/2} {top} "
            f"L{cx + neck_w/2} {top} C{cx + neck_w/2 + 6} {top + 2} {x + w} {top + 8} {x + w} {top + sh} "
            f"L{x + w} {GROUND - 10} Q{x + w} {GROUND} {x + w - 10} {GROUND} L{x + 10} {GROUND} Q{x} {GROUND} {x} {GROUND - 10} Z")
    lw, lh = 100, 130
    lx, ly = x + (w - lw) / 2, GROUND - 14 - lh
    return f"""
<ellipse cx="{cx}" cy="{GROUND}" rx="{w*0.62}" ry="7" fill="url(#shadow)"/>
<rect x="{cx - neck_w/2}" y="{top - neck_h}" width="{neck_w}" height="{neck_h + 2}" fill="url(#body)"/>
<rect x="{cx - 22}" y="{top - neck_h - 22}" width="44" height="26" rx="3" fill="url(#cap)"/>
<g stroke="#000" stroke-opacity=".18" stroke-width=".5">{''.join(f'<line x1="{cx - 22 + i*3.4}" y1="{top - neck_h - 20}" x2="{cx - 22 + i*3.4}" y2="{top - neck_h + 2}"/>' for i in range(1, 13))}</g>
<path d="{body}" fill="url(#body)"/>
<image href="{PREV / 'AutoCare_1L_recto.png'}" x="{lx}" y="{ly}" width="{lw}" height="{lh}" preserveAspectRatio="none"/>
<rect x="{lx}" y="{ly}" width="{lw}" height="{lh}" fill="url(#labelshade)"/>
"""


def jerrican(x, w, h, label, lw, lh, handle_w):
    """Bidon : face plate, poignée évidée à gauche, goulot à droite."""
    top = GROUND - h
    r = 14
    hx0, hx1 = x + 16, x + 16 + handle_w
    shoulder = 44
    body = (f"M{x + r} {GROUND} L{x + w - r} {GROUND} Q{x + w} {GROUND} {x + w} {GROUND - r} "
            f"L{x + w} {top + shoulder} Q{x + w} {top + shoulder - 18} {x + w - 22} {top + shoulder - 22} "
            f"L{x + r} {top + shoulder - 22} Q{x} {top + shoulder - 22} {x} {top + shoulder} "
            f"L{x} {GROUND - r} Q{x} {GROUND} {x + r} {GROUND} Z")
    # poignée : anse au-dessus de l'épaule gauche
    handle = (f"M{hx0} {top + shoulder - 20} L{hx0} {top + 10} Q{hx0} {top} {hx0 + 10} {top} "
              f"L{hx1 - 10} {top} Q{hx1} {top} {hx1} {top + 10} L{hx1} {top + shoulder - 20} "
              f"L{hx1 - 12} {top + shoulder - 20} L{hx1 - 12} {top + 14} L{hx0 + 12} {top + 14} "
              f"L{hx0 + 12} {top + shoulder - 20} Z")
    nx = x + w - 52
    lx, ly = x + (w - lw) / 2, GROUND - 16 - lh
    return f"""
<ellipse cx="{x + w/2}" cy="{GROUND}" rx="{w*0.6}" ry="9" fill="url(#shadow)"/>
<path d="{handle}" fill="url(#body)"/>
<rect x="{nx}" y="{top + shoulder - 36}" width="34" height="18" fill="url(#body)"/>
<rect x="{nx - 5}" y="{top + shoulder - 58}" width="44" height="26" rx="3" fill="url(#cap)"/>
<g stroke="#000" stroke-opacity=".18" stroke-width=".5">{''.join(f'<line x1="{nx - 5 + i*3.4}" y1="{top + shoulder - 56}" x2="{nx - 5 + i*3.4}" y2="{top + shoulder - 34}"/>' for i in range(1, 13))}</g>
<path d="{body}" fill="url(#body)"/>
<image href="{PREV / label}" x="{lx}" y="{ly}" width="{lw}" height="{lh}" preserveAspectRatio="none"/>
<rect x="{lx}" y="{ly}" width="{lw}" height="{lh}" fill="url(#labelshade)"/>
"""


def main():
    W, H, Y0 = 760, 470, 62
    parts = [defs(),
             f'<rect width="{W}" height="{H}" fill="#ECEAE5"/>',
             f'<rect y="{GROUND - 30}" width="{W}" height="{H - GROUND + 30}" fill="url(#floor)"/>',
             bottle_1l(92),
             jerrican(262, 186, 268, "AutoCare_5L_recto.png", 140, 182, 64),
             jerrican(492, 214, 318, "AutoCare_10L_recto.png", 160, 208, 72)]
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {Y0} {W} {H - Y0}" width="{W*3}" height="{(H - Y0)*3}">'
           + "".join(parts) + "</svg>")
    out = ROOT / "build" / "mockup.svg"
    out.write_text(svg)
    print(out)


if __name__ == "__main__":
    main()
