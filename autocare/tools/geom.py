"""Géométrie du symbole AutoCare : une goutte dont le dessin forme un « A ».

La goutte = un cercle (rayon R, centre C) + deux tangentes qui se rejoignent
à l'apex, à la distance k·R au-dessus du centre. Le contour intérieur est la
même goutte réduite de (R - t)/R autour du centre : l'épaisseur du trait
reste donc constante partout (t). La barre du « A » est une bande
horizontale d'épaisseur t.
"""
import math


def _f(v):
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Drop:
    def __init__(self, cx, cy, R, k):
        self.cx, self.cy, self.R, self.k = cx, cy, R, k
        self.d = k * R                      # centre -> apex
        self.sinb = R / self.d              # demi-angle à l'apex
        self.beta = math.asin(self.sinb)
        self.apex_y = cy - self.d
        # points de tangence
        self.tx = R * math.cos(self.beta)
        self.ty = cy - R * self.sinb

    def scaled(self, s):
        return Drop(self.cx, self.cy, self.R * s, self.k)

    def half_width(self, y):
        """Demi-largeur intérieure de la goutte à l'ordonnée y."""
        if y <= self.apex_y:
            return 0.0
        if y <= self.ty:
            return (y - self.apex_y) * math.tan(self.beta)
        dy = y - self.cy
        if abs(dy) >= self.R:
            return 0.0
        return math.sqrt(self.R ** 2 - dy ** 2)

    def outline(self, clockwise=True):
        cx, R = self.cx, self.R
        ax, ay = cx, self.apex_y
        rx, lx, ty = cx + self.tx, cx - self.tx, self.ty
        if clockwise:
            return (f"M{_f(ax)} {_f(ay)}L{_f(rx)} {_f(ty)}"
                    f"A{_f(R)} {_f(R)} 0 1 1 {_f(lx)} {_f(ty)}Z")
        return (f"M{_f(ax)} {_f(ay)}L{_f(lx)} {_f(ty)}"
                f"A{_f(R)} {_f(R)} 0 1 0 {_f(rx)} {_f(ty)}Z")

    # --- régions intérieures coupées par une horizontale ---------------
    def region_above(self, y):
        """Partie de la goutte au-dessus de y (sens anti-horaire)."""
        w = self.half_width(y)
        cx = self.cx
        if y <= self.ty:
            return (f"M{_f(cx)} {_f(self.apex_y)}L{_f(cx - w)} {_f(y)}"
                    f"L{_f(cx + w)} {_f(y)}Z")
        # la coupe tombe dans la partie circulaire
        rx, lx, ty, R = cx + self.tx, cx - self.tx, self.ty, self.R
        return (f"M{_f(cx)} {_f(self.apex_y)}L{_f(lx)} {_f(ty)}"
                f"A{_f(R)} {_f(R)} 0 0 0 {_f(cx - w)} {_f(y)}"
                f"L{_f(cx + w)} {_f(y)}"
                f"A{_f(R)} {_f(R)} 0 0 0 {_f(rx)} {_f(ty)}Z")

    def region_below(self, y):
        """Partie de la goutte sous y (sens anti-horaire)."""
        w = self.half_width(y)
        cx, cy, R = self.cx, self.cy, self.R
        if y >= self.ty:
            large = 1 if y < cy else 0
            return (f"M{_f(cx + w)} {_f(y)}L{_f(cx - w)} {_f(y)}"
                    f"A{_f(R)} {_f(R)} 0 {large} 0 {_f(cx + w)} {_f(y)}Z")
        rx, lx, ty = cx + self.tx, cx - self.tx, self.ty
        return (f"M{_f(cx + w)} {_f(y)}L{_f(cx - w)} {_f(y)}L{_f(lx)} {_f(ty)}"
                f"A{_f(R)} {_f(R)} 0 1 0 {_f(rx)} {_f(ty)}Z")


def mark_path(cx, cy, R, k=2.05, t_ratio=0.24, bar=0.0):
    """Symbole contour : goutte + barre du A.

    t_ratio : épaisseur du trait / R.
    bar     : position du milieu de la barre, en fraction de R au-dessus
              du centre (0 = au centre du cercle).
    Retourne un tracé unique (règle de remplissage evenodd).
    """
    outer = Drop(cx, cy, R, k)
    t = R * t_ratio
    inner = outer.scaled((R - t) / R)
    ym = cy - bar * R
    top, bot = ym - t / 2, ym + t / 2
    return outer.outline(True) + inner.region_above(top) + inner.region_below(bot)


def mark_bbox(cx, cy, R, k=2.05):
    return (cx - R, cy - k * R, cx + R, cy + R)
