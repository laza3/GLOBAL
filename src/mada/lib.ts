import { Easing, interpolate, spring } from "remotion";

export const FPS = 30;
export const DURATION = 390; // 13 s

export const P = {
  night: "#241540",
  plum: "#6B2A5E",
  coral: "#E8505B",
  orange: "#FF8F3C",
  gold: "#FFC85E",
  cream: "#FFF6E8",
  ink: "#2A1530",
  green: "#1F8A5B",
  greenDeep: "#126B47",
  teal: "#1A7F8E",
  red: "#D9482B",
  yellow: "#F6B93B",
  violet: "#7B3F8C",
  rose: "#E86A92",
  earth: "#A8391F",
  earthDark: "#7A2616",
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const smooth = Easing.inOut(Easing.cubic);
export const outC = Easing.out(Easing.cubic);

export const prog = (f: number, a: number, b: number, easing: (t: number) => number = smooth) =>
  interpolate(f, [a, b], [0, 1], { ...clamp, easing });

export const pop = (f: number, at: number, damping = 11, stiffness = 170, mass = 0.7) =>
  spring({ frame: f - at, fps: FPS, config: { damping, stiffness, mass } });

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
