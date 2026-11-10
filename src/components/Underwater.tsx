import React from "react";
import { C, rand, wavePath } from "../lib";
import { Alga, Glow, Shrimp, Spirulina } from "./Critters";

const ALGAE = [
  { x: 170, y: 930, r: 30, c: "green" },
  { x: 900, y: 880, r: 24, c: "orange" },
  { x: 610, y: 820, r: 18, c: "green" },
  { x: 820, y: 1080, r: 36, c: "green" },
  { x: 130, y: 1260, r: 22, c: "orange" },
  { x: 560, y: 1130, r: 26, c: "orange" },
  { x: 960, y: 1330, r: 20, c: "green" },
  { x: 280, y: 1520, r: 32, c: "green" },
  { x: 700, y: 1500, r: 22, c: "orange" },
  { x: 440, y: 900, r: 14, c: "orange" },
  { x: 990, y: 1580, r: 26, c: "orange" },
  { x: 80, y: 1640, r: 18, c: "green" },
] as const;

const SHRIMPS = [
  { x: 300, y: 1050, s: 1.7, flip: false, seed: 0 },
  { x: 800, y: 1300, s: 1.45, flip: true, seed: 2 },
  { x: 430, y: 1480, s: 1.25, flip: false, seed: 4 },
];

/** Position animée d'une source (algue ou crevette) à l'instant f. */
const algaPos = (i: number, f: number) => {
  const a = ALGAE[i];
  return { x: a.x + Math.sin(f * 0.04 + i) * 14, y: a.y + Math.sin(f * 0.06 + i * 1.7) * 12 };
};
const shrimpPos = (i: number, f: number) => {
  const s = SHRIMPS[i];
  const dir = s.flip ? -1 : 1;
  return { x: s.x + dir * (f - 165) * 0.9 + Math.sin(f * 0.08 + i) * 10, y: s.y + Math.sin(f * 0.09 + i * 2) * 16 };
};

/** Scène sous-marine, en coordonnées écran. f = frame globale. */
export const Underwater: React.FC<{ f: number }> = ({ f }) => {
  // Particules de pigment qui se détachent des algues et des crevettes
  const glows: React.ReactNode[] = [];
  for (let k = 0; k < 30; k++) {
    const born = 190 + k * 2.3;
    const age = f - born;
    const life = 46;
    if (age < 0 || age > life) continue;
    const fromShrimp = k % 3 === 0;
    const src = fromShrimp ? shrimpPos(k % SHRIMPS.length, born) : algaPos(k % ALGAE.length, born);
    const u = age / life;
    const x = src.x + Math.sin(age * 0.18 + k) * 18 + (rand(k) - 0.5) * 90 * u;
    const y = src.y - 20 - age * (2.2 + rand(k + 9) * 1.6);
    const s = Math.min(1, age / 8) * (0.7 + rand(k + 3) * 0.6);
    const o = Math.min(1, (life - age) / 10) * (y < 760 ? Math.max(0, (y - 700) / 60) : 1);
    glows.push(<Glow key={k} x={x} y={y} s={s} o={o} />);
  }

  const bubbles: React.ReactNode[] = [];
  for (let k = 0; k < 14; k++) {
    const period = 70 + rand(k) * 50;
    const age = (f + rand(k + 5) * period) % period;
    const x = 60 + rand(k + 1) * 960 + Math.sin(age * 0.15) * 8;
    const y = 1720 - age * 12;
    if (y < 760) continue;
    bubbles.push(<circle key={k} cx={x} cy={y} r={6 + rand(k + 2) * 10} fill="none" stroke={C.white} strokeWidth={4} opacity={0.6} />);
  }

  return (
    <g>
      <rect x={0} y={0} width={1080} height={1920} fill={C.lagoon} />
      {/* rayons de lumière */}
      {[0, 1, 2, 3].map((i) => {
        const sway = Math.sin(f * 0.03 + i) * 40;
        const x = 120 + i * 270 + sway;
        return <path key={i} d={`M${x} 0 L${x + 120} 0 L${x + 260} 1920 L${x + 60} 1920 Z`} fill={C.white} opacity={0.1} />;
      })}
      {/* fond sableux */}
      <path d={wavePath(1700, 14, 420, 0.4, -100, 1180, 2000)} fill={C.sand} />
      <path d={wavePath(1760, 10, 300, 1.5, -100, 1180, 2000)} fill={C.sandDark} opacity={0.5} />
      <g transform={`translate(250 ${1180 + Math.sin(f * 0.05) * 10}) rotate(-18)`}><Spirulina t={f} len={150} /></g>
      <g transform={`translate(860 ${760 + 700 + Math.sin(f * 0.05 + 2) * 10}) rotate(24)`}><Spirulina t={f + 20} len={120} /></g>
      {ALGAE.map((a, i) => {
        const p = algaPos(i, f);
        return (
          <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${f * (i % 2 ? 0.6 : -0.5)})`}>
            <Alga r={a.r} color={a.c} />
          </g>
        );
      })}
      {SHRIMPS.map((s, i) => {
        const p = shrimpPos(i, f);
        return (
          <g key={i} transform={`translate(${p.x} ${p.y}) scale(${s.flip ? -s.s : s.s} ${s.s}) rotate(${Math.sin(f * 0.07 + i) * 6})`}>
            <Shrimp t={f} seed={s.seed} />
          </g>
        );
      })}
      {glows}
      {bubbles}
    </g>
  );
};
