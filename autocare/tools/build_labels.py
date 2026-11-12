"""Génère les étiquettes AutoCare (recto/verso, 1 L · 5 L · 10 L).

Usage : python3 tools/build_logo.py && python3 tools/build_labels.py
Sorties :
  etiquettes/AutoCare_<format>_<face>_impression.pdf  (fond perdu 3 mm + traits de coupe, TrimBox/BleedBox renseignées)
  etiquettes/apercu/AutoCare_<format>_<face>.png       (aperçu au format fini)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
OUT = ROOT / "etiquettes"
PREVIEW = OUT / "apercu"

BLEED = 3.0        # mm
SLUG = 10.0        # marge extérieure pour les traits de coupe (mm)
MARK_GAP = 3.0     # les traits commencent au bord du fond perdu
MARK_LEN = 5.0
MASTER_W, MASTER_H = 100.0, 130.0

NNBSP = " "   # espace fine insécable
NBSP = " "


def fr(text):
    """Typographie française : espaces fines avant ; : ! ? et entre nombre et unité."""
    s = str(text)
    s = re.sub(r" ([;!?])", NNBSP + r"\1", s)
    s = re.sub(r"(?<=\D) : ", NNBSP + ": ", s)
    s = re.sub(r"(\d) (mL|L|%|°C|mm)\b", r"\1" + NNBSP + r"\2", s)
    s = re.sub(r"N° (\d)", "N°" + NBSP + r"\1", s)
    s = s.replace(" · ", NBSP + "· ")
    return s


def todo(text):
    """Surligne les champs [À COMPLÉTER]."""
    parts = re.split(r"(\[[^\]]*\])", str(text))
    out = []
    for p in parts:
        if p.startswith("[") and p.endswith("]"):
            out.append(Markup('<span class="todo">') + escape(p) + Markup("</span>"))
        else:
            out.append(escape(p))
    return Markup("").join(out)


def md(text):
    """**gras** -> <b>gras</b> (le reste est échappé)."""
    parts = re.split(r"(\*\*[^*]+\*\*)", str(text))
    out = []
    for p in parts:
        if p.startswith("**") and p.endswith("**"):
            out.append(Markup("<b>") + escape(p[2:-2]) + Markup("</b>"))
        else:
            out.append(escape(p))
    return Markup("").join(out)


def crop_marks(page_w, page_h, x0, y0, x1, y1):
    g, L = BLEED + MARK_GAP - BLEED, MARK_LEN
    off = BLEED  # écart entre la coupe et le début du trait
    m = []
    for x in (x0, x1):
        m.append((x, y0 - off - L, x, y0 - off))
        m.append((x, y1 + off, x, y1 + off + L))
    for y in (y0, y1):
        m.append((x0 - off - L, y, x0 - off, y))
        m.append((x1 + off, y, x1 + off + L, y))
    return [tuple(round(v, 3) for v in t) for t in m]


def main():
    content = json.loads((ROOT / "etiquette" / "contenu.json").read_text())
    palette = json.loads((ROOT / "brand" / "palette.json").read_text())
    colors = {c["id"]: c["hex"] for c in palette["colors"]}
    lock = json.loads((BUILD / "lockups.json").read_text())["horizontal"]
    x, y, w, h = lock["box"]
    logo = {"vb": f"{x:.3f} {y:.3f} {w:.3f} {h:.3f}", "body": lock["body"]}

    env = Environment(loader=FileSystemLoader(ROOT / "etiquette"),
                      autoescape=select_autoescape(["html", "j2"]))
    env.filters["fr"] = fr
    env.filters["todo"] = todo
    env.filters["md"] = md
    tpl = env.get_template("gabarit.html.j2")

    OUT.mkdir(exist_ok=True)
    PREVIEW.mkdir(exist_ok=True)
    (BUILD / "html").mkdir(parents=True, exist_ok=True)

    only = set(sys.argv[1:])
    jobs = []
    for fmt in content["formats"]:
        if only and fmt["id"] not in only:
            continue
        tw, th = fmt["largeur_mm"], fmt["hauteur_mm"]
        scale = tw / MASTER_W
        page_w, page_h = tw + 2 * (BLEED + SLUG), th + 2 * (BLEED + SLUG)
        tx0, ty0 = SLUG + BLEED, SLUG + BLEED
        for side in ("recto", "verso"):
            html = tpl.render(
                fmt=fmt, side=side, t=content, c=colors, logo=logo,
                fonts=str(ROOT / "fonts" / "static"),
                page_w=round(page_w, 3), page_h=round(page_h, 3), slug=SLUG,
                bleed_w=tw + 2 * BLEED, bleed_h=th + 2 * BLEED,
                art_off=round(BLEED - BLEED * scale, 4), scale=round(scale, 5),
                trim_w=tw, trim_h=th,
                marks=crop_marks(page_w, page_h, tx0, ty0, tx0 + tw, ty0 + th),
            )
            name = f"AutoCare_{fmt['id']}_{side}"
            hp = BUILD / "html" / f"{name}.html"
            hp.write_text(html)
            jobs.append({
                "html": str(hp),
                "pdf": str(OUT / f"{name}_impression.pdf"),
                "png": str(PREVIEW / f"{name}.png"),
                "page_w": page_w, "page_h": page_h,
                "clip": [tx0, ty0, tw, th],
                "trim": [tx0, ty0, tw, th],
            })

    jf = BUILD / "jobs.json"
    jf.write_text(json.dumps(jobs))
    subprocess.run(["node", str(ROOT / "tools" / "render.js"), str(jf)], check=True)

    pt = 72 / 25.4
    for j in jobs:
        r = PdfReader(j["pdf"])
        wtr = PdfWriter()
        for page in r.pages:
            ph = float(page.mediabox.height)
            x0, y0, tw, th = j["trim"]
            # repère PDF : origine en bas à gauche
            trim = RectangleObject([x0 * pt, ph - (y0 + th) * pt, (x0 + tw) * pt, ph - y0 * pt])
            bl = BLEED * pt
            bleed = RectangleObject([trim.left - bl, trim.bottom - bl, trim.right + bl, trim.top + bl])
            page.trimbox = trim
            page.bleedbox = bleed
            wtr.add_page(page)
        wtr.add_metadata({"/Title": Path(j["pdf"]).stem.replace("_", " "), "/Author": "AutoCare"})
        with open(j["pdf"], "wb") as fh:
            wtr.write(fh)
        print("ok", Path(j["pdf"]).name)


if __name__ == "__main__":
    main()
