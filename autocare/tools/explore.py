"""Planche de recherche : pistes de symbole et de logotype (usage interne)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from outline import text_path  # noqa: E402
from geom import mark_path, Drop  # noqa: E402

INK = "#14201D"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "explore.svg")

cells = []
W, H = 760, 300


def cell(i, content, label):
    col, row = i % 2, i // 2
    x, y = col * (W + 20) + 20, row * (H + 20) + 20
    cells.append(
        f'<g transform="translate({x},{y})"><rect width="{W}" height="{H}" fill="#fff"/>'
        f'<text x="16" y="26" font-family="monospace" font-size="13" fill="#888">{label}</text>'
        f'{content}</g>'
    )


def lockup(mark_d, word_d, mark_w, gap, word_w, cap_h, size_box=(W, H)):
    total = mark_w + gap + word_w
    s = 1.0
    ox = (size_box[0] - total) / 2
    return (f'<g transform="translate({ox},{size_box[1]/2 + cap_h/2})" fill="{INK}">'
            f'<path fill-rule="evenodd" d="{mark_d}"/>'
            f'<path transform="translate({mark_w + gap},0)" d="{word_d}"/></g>')


size = 64
cap = 0.686 * size
# symbole dimensionné sur la hauteur de capitale (+ dépassements optiques)
def mk(k=2.05, t=0.24, bar=0.0, hfac=1.32):
    Ht = cap * hfac
    R = Ht / (1 + k)
    cx, cy = R, -R + (Ht - cap) / 2  # base de la goutte un peu sous la ligne de base
    return mark_path(cx, cy, R, k, t, bar), 2 * R

opts = [
    dict(text="AUTOCARE", wght=700, wdth=125, tr=0.02, mark=dict(), label="1 · Contour + barre · Expanded Bold"),
    dict(text="AUTOCARE", wght=560, wdth=125, tr=0.12, mark=dict(t=0.18), label="2 · Contour fin · Expanded SemiBold espacé"),
    dict(text="autocare", wght=700, wdth=112, tr=-0.01, mark=dict(t=0.28, bar=0.15), label="3 · Minuscules · Semi-expanded Bold"),
    dict(text="AutoCare", wght=680, wdth=100, tr=-0.005, mark=dict(t=0.26), label="4 · Bas de casse · Normal Bold"),
    dict(text="AUTOCARE", wght=800, wdth=82, tr=0.04, mark=dict(t=0.3, k=2.2), label="5 · Condensed ExtraBold"),
    dict(text="AUTOCARE", wght=620, wdth=118, tr=0.06, mark=dict(t=0.22, bar=0.25), label="6 · Expanded SemiBold, barre haute"),
]
for i, o in enumerate(opts):
    wd, ww = text_path(o["text"], size, o["wght"], o["wdth"], o["tr"])
    md, mw = mk(**o["mark"])
    cell(i, lockup(md, wd, mw, size * 0.42, ww, cap), o["label"])

# grands symboles seuls
big = []
for j, (k, t, bar) in enumerate([(2.05, 0.24, 0.0), (1.85, 0.2, 0.2), (2.3, 0.3, 0.1), (2.05, 0.16, -0.1)]):
    R = 60
    big.append(f'<g transform="translate({90 + j*180},{150})"><path fill="{INK}" fill-rule="evenodd" d="{mark_path(0, 40, R, k, t, bar)}"/>'
               f'<text x="-40" y="130" font-family="monospace" font-size="12" fill="#888">k{k} t{t} b{bar}</text></g>')
cell(6, "".join(big), "7 · Variantes du symbole")
# symbole en réserve
rev = []
for j, (bg, fg) in enumerate([(INK, "#fff"), ("#1F4F4A", "#fff"), ("#E9E6DF", INK)]):
    rev.append(f'<g transform="translate({60 + j*230},60)"><rect width="200" height="200" rx="0" fill="{bg}"/>'
               f'<path fill="{fg}" fill-rule="evenodd" d="{mark_path(100, 128, 44, 2.05, 0.24, 0.0)}"/></g>')
cell(7, "".join(rev), "8 · Symbole en réserve")

rows = 4
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{2*(W+20)+20}" height="{rows*(H+20)+20}">'
       f'<rect width="100%" height="100%" fill="#ECEAE6"/>{"".join(cells)}</svg>')
OUT.write_text(svg)
print(OUT)
