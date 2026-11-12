"""Vectorise du texte Archivo (police variable) en tracés SVG.

Mise en forme par HarfBuzz (crénage inclus), dessin des glyphes par fontTools.
Utilisé pour produire des logos indépendants de toute police installée.
"""
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONT = Path(__file__).resolve().parent.parent / "fonts" / "Archivo-VF.ttf"


@lru_cache(maxsize=None)
def _instance(wght: float, wdth: float):
    vf = TTFont(FONT)
    inst = instantiateVariableFont(vf, {"wght": wght, "wdth": wdth}, inplace=False)
    buf = BytesIO()
    inst.save(buf)
    data = buf.getvalue()
    tt = TTFont(BytesIO(data))
    face = hb.Face(data)
    font = hb.Font(face)
    return tt, font


def text_path(text, size, wght=600, wdth=100, tracking=0.0, x=0.0, y=0.0, features=None):
    """Retourne (d, largeur) — d est le tracé SVG, ligne de base en y.

    tracking : en fraction de corps (0.05 = +5 %).
    """
    tt, font = _instance(wght, wdth)
    upm = tt["head"].unitsPerEm
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features or {"kern": True, "liga": True})
    glyphset = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    scale = size / upm
    pen = SVGPathPen(glyphset)
    cursor = 0.0
    n = len(buf.glyph_infos)
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]
        gx = x + (cursor + pos.x_offset) * scale
        gy = y - pos.y_offset * scale
        tp = TransformPen(pen, (scale, 0, 0, -scale, gx, gy))
        glyphset[name].draw(tp)
        cursor += pos.x_advance
        if i < n - 1:
            cursor += tracking * upm
    width = cursor * scale
    return pen.getCommands(), width


def metrics(wght=600, wdth=100):
    tt, _ = _instance(wght, wdth)
    os2 = tt["OS/2"]
    return {"upm": tt["head"].unitsPerEm, "cap": os2.sCapHeight, "xh": os2.sxHeight}
