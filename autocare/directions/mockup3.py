"""Les trois directions sur le flacon 1 L (image de comparaison)."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tools"))
import mockup as m  # noqa: E402

W, Y0, H = 600, 150, 470
labels = [HERE / "apercu" / f"{n}_recto.png" for n in ("A_plaque", "B_mousse", "C_eponge")]
parts = [m.defs(), f'<rect width="{W}" height="{H}" fill="#ECEAE5"/>',
         f'<rect y="{m.GROUND - 30}" width="{W}" height="{H - m.GROUND + 30}" fill="url(#floor)"/>']
for i, lab in enumerate(labels):
    parts.append(m.bottle_1l(42 + i * 186, lab))
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {Y0} {W} {H - Y0}" width="{W*3}" height="{(H-Y0)*3}">'
       + "".join(parts) + "</svg>")
out = HERE.parent / "build" / "mockup3.svg"
out.write_text(svg)
print(out)
