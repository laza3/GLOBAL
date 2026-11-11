import { Easing, interpolate, interpolateColors } from "remotion";
import timeline from "./timeline.json";

export const TL = timeline;
export const EV = timeline.ev as Record<string, number | number[]>;
export const ev = (k: string) => EV[k] as number;
export const evr = (k: string) => EV[k] as [number, number];
export const CYC = timeline.cycles as Record<string, number>;
export const FPS = timeline.fps;
export const W = 1080;
export const H = 1920;

export const clampO = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeIO = Easing.inOut(Easing.cubic);
export const easeO = Easing.out(Easing.cubic);
export const easeI = Easing.in(Easing.cubic);
export const backO = Easing.out(Easing.back(1.6));

/** 0 → 1 entre a et b (secondes). */
export const k01 = (t: number, a: number, b: number, e: (x: number) => number = easeIO) =>
  interpolate(t, [a, b], [0, 1], { ...clampO, easing: e });

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const mixC = (a: string, b: string, t: number) => interpolateColors(Math.max(0, Math.min(1, t)), [0, 1], [a, b]);

/** Pseudo-aléatoire déterministe. */
export const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Ressort amorti (0 → 1) déclenché à t0. */
export const springAt = (t: number, t0: number, freq = 4.5, damp = 5) => {
  const u = t - t0;
  if (u <= 0) return 0;
  return 1 - Math.exp(-damp * u) * Math.cos(2 * Math.PI * freq * u);
};

/** Secousse de caméra décroissante. */
export const shake = (t: number, t0: number, amp: number, dur = 0.5, seed = 1) => {
  const u = t - t0;
  if (u < 0 || u > dur) return { x: 0, y: 0, r: 0 };
  const d = Math.exp(-5 * u / dur) * (1 - u / dur);
  return {
    x: amp * d * Math.sin(u * 71 + seed),
    y: amp * d * Math.cos(u * 57 + seed * 2),
    r: amp * 0.05 * d * Math.sin(u * 43 + seed * 3),
  };
};

export type Cam = { x: number; y: number; s: number; r?: number };
export type CamKey = { t: number; c: Cam; e?: (x: number) => number };

export const camAt = (keys: CamKey[], t: number): Cam => {
  if (t <= keys[0].t) return { r: 0, ...keys[0].c };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const u = (b.e ?? easeIO)((t - a.t) / Math.max(1e-6, b.t - a.t));
      return { x: lerp(a.c.x, b.c.x, u), y: lerp(a.c.y, b.c.y, u), s: lerp(a.c.s, b.c.s, u), r: lerp(a.c.r ?? 0, b.c.r ?? 0, u) };
    }
  }
  return { r: 0, ...keys[keys.length - 1].c };
};

export const camTransform = (c: Cam, sh = { x: 0, y: 0, r: 0 }) =>
  `translate(${(W / 2 + sh.x).toFixed(2)} ${(H / 2 + sh.y).toFixed(2)}) rotate(${((c.r ?? 0) + sh.r).toFixed(3)}) scale(${c.s.toFixed(4)}) translate(${(-c.x).toFixed(2)} ${(-c.y).toFixed(2)})`;

/** Phase d'un cycle de marche/course démarré à t0 (période en s). */
export const phase = (t: number, t0: number, period: number) => (t - t0) / period;
