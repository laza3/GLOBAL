import { Easing, interpolate, interpolateColors, spring } from "remotion";

export const C = {
  cream: "#FFF4E6",
  lagoon: "#7EC8E3",
  pink: "#FF6FA5",
  orange: "#FF9F43",
  grey: "#BDBDBD",
  navy: "#1E2A3A",
  // teintes dérivées (même famille, jamais de dégradés agressifs)
  lagoonDeep: "#6AB9D8",
  lagoonLight: "#A9DCEE",
  sand: "#F2D4AE",
  sandDark: "#E2BD91",
  peach: "#FFE2C4",
  sun: "#FFD6A5",
  green: "#86C97A",
  greenDark: "#5FAE5A",
  white: "#FFFFFF",
};

export const FPS = 30;
export const FREEZE_AT = 429; // les 0,7 dernières secondes restent figées

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const smooth = Easing.inOut(Easing.cubic);
export const out = Easing.out(Easing.cubic);
export const backOut = Easing.out(Easing.back(1.7));

/** 0 → 1 entre a et b, avec easing. */
export const prog = (f: number, a: number, b: number, easing = smooth) =>
  interpolate(f, [a, b], [0, 1], { ...clamp, easing });

/** Ressort « pop » avec petit rebond. */
export const pop = (f: number, at: number, damping = 11, stiffness = 170, mass = 0.7) =>
  spring({ frame: f - at, fps: FPS, config: { damping, stiffness, mass } });

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Pt = { x: number; y: number };
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export const bezier = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

export const mix = (a: string, b: string, t: number) =>
  interpolateColors(Math.min(1, Math.max(0, t)), [0, 1], [a, b]);

/** Pseudo-aléatoire déterministe. */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Contour « duveteux » : ellipse dont le rayon ondule. */
export const blobPath = (cx: number, cy: number, rx: number, ry: number, amp: number, bumps: number) => {
  const n = 160;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + amp * (0.5 + 0.5 * Math.cos(a * bumps));
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d + "Z";
};

/** Surface d'eau ondulée (bord haut animé) fermée vers le bas. */
export const wavePath = (y0: number, amp: number, wl: number, phase: number, x0 = -1400, x1 = 2500, bottom = 3600) => {
  let d = `M${x0} ${bottom} L${x0} ${y0} `;
  for (let x = x0; x <= x1; x += 24) {
    const y = y0 + amp * Math.sin((x / wl) * Math.PI * 2 + phase) + amp * 0.4 * Math.sin((x / (wl * 0.53)) * Math.PI * 2 - phase * 1.3);
    d += `L${x} ${y.toFixed(1)} `;
  }
  return d + `L${x1} ${bottom} Z`;
};
