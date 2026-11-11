import React from "react";
import { Lamp } from "../props";
import { mixC, rnd } from "../util";

// Repères verticaux (monde) communs aux scènes de rue.
export const BASE = 1230; // pied des immeubles d'en face
export const ROAD0 = 1262;
export const ROAD1 = 1398;
export const CURB = 1412;
export const GROUND = 1500; // pieds des personnages

export type Mood = { rain: number; gold: number };

const pal = (m: Mood) => {
  const g = (sunny: string, rain: string, gold: string) => mixC(mixC(sunny, rain, m.rain), gold, m.gold);
  return {
    skyTop: g("#6fb6e6", "#4a5568", "#5e4b8b"),
    skyMid: g("#a9d8f2", "#6f7b90", "#ef8a5f"),
    skyLow: g("#e6f5fb", "#97a3b6", "#ffd08a"),
    far: g("#b7cfe0", "#77839a", "#8b5a78"),
    far2: g("#cfe0ec", "#8a95aa", "#b57486"),
    facades: [
      g("#e07a5f", "#8b6a68", "#e0805f"),
      g("#f2cc8f", "#9b9283", "#f5c27f"),
      g("#81b29a", "#6c8079", "#b9b07f"),
      g("#5b7db1", "#556179", "#a07f8f"),
      g("#f4a261", "#9a7f6b", "#f3a25f"),
      g("#c9ada7", "#827b80", "#e2a99a"),
    ],
    trim: g("#f7f3ea", "#a9adb5", "#fbe6cc"),
    win: g("#3b5a7a", "#2c3444", "#5b4a63"),
    winLit: g("#fff1c1", "#ffd27a", "#ffe6a8"),
    winGlass: g("#9cc9e6", "#566179", "#f7c58f"),
    backWalk: g("#d6cfc3", "#7e838c", "#e8c9a6"),
    road: g("#5d636e", "#3a3f48", "#6d5f62"),
    roadLine: g("#f4f1de", "#c9ccd2", "#fbe8c8"),
    curb: g("#b9b2a6", "#6e737b", "#b47a5e"),
    walk: g("#ddd5c8", "#8c919a", "#e8b98f"),
    walkJoint: g("#c9c0b2", "#7a7f88", "#d09a72"),
    front: g("#b8b0a2", "#666b74", "#a8705a"),
    pole: g("#2f3e46", "#252d33", "#3b2a3a"),
    foliage: g("#6a994e", "#4b6a49", "#9c9a4f"),
    foliage2: g("#8cb369", "#5f7d55", "#c5b35f"),
    awning: [g("#e63946", "#8b4a50", "#e8605a"), g("#2a9d8f", "#3f6b67", "#7fa48a"), g("#e9c46a", "#9b8a5e", "#f2c76f")],
    river: g("#7fb3d5", "#4d5a6e", "#c9705f"),
    riverHi: g("#cfe8f5", "#8994a6", "#ffd59a"),
  };
};
export type Pal = ReturnType<typeof pal>;
export const cityPal = pal;

type Building = { x: number; w: number; h: number; c: number; rows: number; cols: number; roof: number; shop: number; seed: number };

const makeBuildings = (x0: number, x1: number, seed: number) => {
  const out: Building[] = [];
  let x = x0;
  let i = 0;
  while (x < x1) {
    const r = (k: number) => rnd(seed * 31 + i * 7.3 + k);
    const w = 250 + Math.round(r(1) * 190);
    const h = 470 + Math.round(r(2) * 380);
    out.push({ x, w, h, c: Math.floor(r(3) * 6), rows: Math.max(3, Math.floor((h - 160) / 118)), cols: Math.max(2, Math.floor((w - 50) / 86)), roof: Math.floor(r(4) * 3), shop: Math.floor(r(5) * 4), seed: seed * 100 + i });
    x += w + (r(6) > 0.8 ? 30 : 0);
    i++;
  }
  return out;
};

const BUILDINGS: Record<string, Building[]> = {
  rue: makeBuildings(-1600, 4200, 3),
  arret: makeBuildings(-600, 3600, 11),
};

const BuildingView: React.FC<{ b: Building; p: Pal; lit: number; gap?: boolean }> = ({ b, p, lit }) => {
  const top = BASE - b.h;
  const col = p.facades[b.c];
  const winW = 46;
  const winH = 70;
  const mx = (b.w - b.cols * winW) / (b.cols + 1);
  const wins: React.ReactNode[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const wx = b.x + mx + c * (winW + mx);
      const wy = top + 70 + r * 118;
      if (wy + winH > BASE - 150) continue;
      const on = rnd(b.seed + r * 13 + c * 5) < 0.18 + 0.32 * lit;
      wins.push(
        <g key={`${r}-${c}`}>
          <rect x={wx - 5} y={wy - 5} width={winW + 10} height={winH + 12} fill={p.trim} opacity={0.85} />
          <rect x={wx} y={wy} width={winW} height={winH} fill={on ? p.winLit : p.win} />
          {!on ? <path d={`M${wx + 6} ${wy + winH - 8} L${wx + 22} ${wy + 6} L${wx + 30} ${wy + 6} L${wx + 14} ${wy + winH - 8} Z`} fill="rgba(255,255,255,0.13)" /> : null}
          <rect x={wx + winW / 2 - 1.5} y={wy} width={3} height={winH} fill={p.trim} opacity={0.8} />
        </g>,
      );
    }
  }
  const shopY = BASE - 140;
  const aw = p.awning[b.shop % 3];
  return (
    <g>
      <rect x={b.x} y={top} width={b.w} height={b.h} fill={col} />
      <rect x={b.x} y={top} width={b.w} height={b.h} fill="url(#facadeShade)" />
      <rect x={b.x - 8} y={top - 14} width={b.w + 16} height={18} fill={p.trim} />
      {b.roof === 1 ? <rect x={b.x + b.w * 0.6} y={top - 64} width={34} height={52} fill={mixC(col, "#000", 0.25)} /> : null}
      {b.roof === 2 ? <path d={`M${b.x + 20} ${top - 12} L${b.x + b.w / 2} ${top - 70} L${b.x + b.w - 20} ${top - 12} Z`} fill={mixC(col, "#000", 0.2)} /> : null}
      {wins}
      {/* rez-de-chaussée */}
      <rect x={b.x} y={shopY} width={b.w} height={140} fill={mixC(col, "#000", 0.18)} />
      {b.shop < 3 ? (
        <>
          <rect x={b.x + 24} y={shopY + 34} width={b.w - 110} height={106} fill={p.winGlass} />
          <rect x={b.x + 24} y={shopY + 34} width={b.w - 110} height={106} fill={p.winLit} opacity={0.25 + 0.4 * lit} />
          <rect x={b.x + b.w - 74} y={shopY + 30} width={50} height={110} fill={mixC(col, "#000", 0.45)} />
          <path
            d={`M${b.x + 14} ${shopY + 6} L${b.x + b.w - 14} ${shopY + 6} L${b.x + b.w - 4} ${shopY + 40} L${b.x + 4} ${shopY + 40} Z`}
            fill={aw}
          />
          {Array.from({ length: Math.floor((b.w - 20) / 36) }, (_, k) => (
            <path key={k} d={`M${b.x + 14 + k * 36} ${shopY + 6} l18 0 l3 34 l-18 0 Z`} fill="rgba(255,255,255,0.45)" />
          ))}
        </>
      ) : (
        <rect x={b.x + b.w / 2 - 34} y={shopY + 20} width={68} height={120} rx={30} fill={mixC(col, "#000", 0.5)} />
      )}
    </g>
  );
};

/** Silhouettes lointaines (une seule forme par plan). */
const skyline = (seed: number, x0: number, x1: number, base: number, minH: number, maxH: number) => {
  let d = `M${x0} ${base} `;
  let x = x0;
  let i = 0;
  while (x < x1) {
    const w = 90 + rnd(seed + i) * 160;
    const h = minH + rnd(seed + i * 3.1) * (maxH - minH);
    d += `L${x} ${base - h} L${x + w} ${base - h} `;
    if (rnd(seed + i * 5.7) > 0.7) d += `L${x + w * 0.5} ${base - h - 40} `;
    x += w;
    i++;
  }
  return d + `L${x1} ${base} Z`;
};

const FAR1 = skyline(5, -3000, 9000, BASE, 520, 980);
const FAR2 = skyline(9, -3000, 9000, BASE, 380, 760);

export const Defs: React.FC = () => (
  <defs>
    <linearGradient id="facadeShade" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stopColor="#fff" stopOpacity="0.06" />
      <stop offset="1" stopColor="#000" stopOpacity="0.16" />
    </linearGradient>
    <radialGradient id="lampGlow">
      <stop offset="0" stopColor="#fff2c4" stopOpacity="0.85" />
      <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
    </radialGradient>
    <radialGradient id="orangeShade" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0.5" stopColor="#000" stopOpacity="0" />
      <stop offset="1" stopColor="#7a2e00" stopOpacity="0.35" />
    </radialGradient>
    <linearGradient id="puddle" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
      <stop offset="1" stopColor="#fff" stopOpacity="0.05" />
    </linearGradient>
    <linearGradient id="glass" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stopColor="#dff1fb" stopOpacity="0.35" />
      <stop offset="0.5" stopColor="#dff1fb" stopOpacity="0.12" />
      <stop offset="1" stopColor="#dff1fb" stopOpacity="0.28" />
    </linearGradient>
  </defs>
);

/** Ciel plein écran (coordonnées écran). */
export const Sky: React.FC<{ mood: Mood; sun?: { x: number; y: number; r: number; o: number } }> = ({ mood, sun }) => {
  const p = pal(mood);
  return (
    <g>
      <defs>
        <linearGradient id="skyG" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={p.skyTop} />
          <stop offset="0.55" stopColor={p.skyMid} />
          <stop offset="1" stopColor={p.skyLow} />
        </linearGradient>
        <radialGradient id="sunG">
          <stop offset="0" stopColor="#fffbe8" stopOpacity="1" />
          <stop offset="0.25" stopColor="#ffe9a8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-200} y={-200} width={1480} height={2320} fill="url(#skyG)" />
      {sun && sun.o > 0 ? (
        <g opacity={sun.o}>
          <circle cx={sun.x} cy={sun.y} r={sun.r * 4} fill="url(#sunG)" />
          <circle cx={sun.x} cy={sun.y} r={sun.r} fill="#fff6d6" />
        </g>
      ) : null}
    </g>
  );
};

type CityProps = {
  variant: "rue" | "arret" | "quai";
  mood: Mood;
  camX: number;
  camY: number;
  t: number;
  lit?: number; // fenêtres allumées
  /** Bornes visibles (monde) pour ne dessiner que l'utile. */
  vis: [number, number];
  children?: React.ReactNode; // éléments entre la route et le trottoir (bus, voitures)
  lampsOn?: number;
};

const par = (camX: number, camY: number, f: number, fy = f) =>
  `translate(${(camX * (1 - f)).toFixed(1)} ${((camY - 1200) * (1 - fy)).toFixed(1)})`;

export const City: React.FC<CityProps> = ({ variant, mood, camX, camY, t, lit = 0, vis, children, lampsOn = 0 }) => {
  const p = pal(mood);
  const [v0, v1] = vis;
  const blds = variant === "quai" ? [] : BUILDINGS[variant].filter((b) => b.x + b.w > v0 - 900 && b.x < v1 + 900);
  const lamps = variant === "rue" ? [-300, 420, 1720, 2700, 3500] : variant === "arret" ? [300, 900, 2700, 3300] : [-600, 300, 1200, 2100, 3000, 3900, 4800, 5700, 6600];
  return (
    <g>
      {/* lointain */}
      <g transform={par(camX, camY, 0.3, 0.5)}>
        <path d={FAR1} fill={p.far2} />
      </g>
      <g transform={par(camX, camY, 0.5, 0.65)}>
        <path d={FAR2} fill={p.far} />
      </g>
      {variant === "quai" ? (
        <g>
          {/* fleuve */}
          <rect x={v0 - 2000} y={BASE - 10} width={v1 - v0 + 4000} height={ROAD1 - BASE + 30} fill={p.river} />
          {Array.from({ length: 26 }, (_, i) => {
            const x = Math.floor(v0 / 300) * 300 - 600 + i * 300 + ((t * 30) % 300);
            const y = BASE + 20 + (i % 5) * 26;
            return <rect key={i} x={x} y={y} width={90 + (i % 3) * 40} height={4} rx={2} fill={p.riverHi} opacity={0.5} />;
          })}
          {/* reflet du soleil */}
          <rect x={camX - 70} y={BASE} width={140} height={ROAD1 - BASE} fill="#fff1c9" opacity={0.25 * mood.gold} />
        </g>
      ) : (
        <g transform={par(camX, camY, 0.86, 0.9)}>
          {blds.map((b) => <BuildingView key={b.x} b={b} p={p} lit={lit} />)}
          <rect x={v0 - 1500} y={BASE} width={v1 - v0 + 3000} height={ROAD0 - BASE + 2} fill={p.backWalk} />
        </g>
      )}
      {variant !== "quai" ? (
        <g>
          <rect x={v0 - 1500} y={ROAD0} width={v1 - v0 + 3000} height={ROAD1 - ROAD0} fill={p.road} />
          {Array.from({ length: Math.ceil((v1 - v0 + 3000) / 220) }, (_, i) => {
            const x = Math.floor((v0 - 1500) / 220) * 220 + i * 220;
            return <rect key={i} x={x} y={(ROAD0 + ROAD1) / 2 - 4} width={120} height={8} fill={p.roadLine} opacity={0.8} />;
          })}
          {/* reflets mouillés */}
          {mood.rain > 0.05
            ? Array.from({ length: 14 }, (_, i) => (
                <rect key={i} x={v0 - 400 + i * 160 + rnd(i) * 60} y={ROAD0 + 20 + rnd(i + 3) * 90} width={8} height={24 + rnd(i + 9) * 30} fill={p.winLit} opacity={0.18 * mood.rain} />
              ))
            : null}
        </g>
      ) : null}
      {children}
      {/* bordure + trottoir */}
      <rect x={v0 - 1500} y={ROAD1} width={v1 - v0 + 3000} height={CURB - ROAD1 + 4} fill={p.curb} />
      {variant === "quai" ? (
        <g>
          {/* garde-corps */}
          <rect x={v0 - 1500} y={CURB - 120} width={v1 - v0 + 3000} height={10} fill={p.pole} />
          {Array.from({ length: Math.ceil((v1 - v0 + 3000) / 60) }, (_, i) => {
            const x = Math.floor((v0 - 1500) / 60) * 60 + i * 60;
            return <rect key={i} x={x} y={CURB - 112} width={6} height={112} fill={p.pole} />;
          })}
        </g>
      ) : null}
      <rect x={v0 - 1500} y={CURB} width={v1 - v0 + 3000} height={1400} fill={p.walk} />
      {Array.from({ length: Math.ceil((v1 - v0 + 3000) / 180) }, (_, i) => {
        const x = Math.floor((v0 - 1500) / 180) * 180 + i * 180;
        return <path key={i} d={`M${x} ${CURB} L${x - 40} 1640`} stroke={p.walkJoint} strokeWidth={3} />;
      })}
      <rect x={v0 - 1500} y={1560} width={v1 - v0 + 3000} height={3} fill={p.walkJoint} />
      <rect x={v0 - 1500} y={1640} width={v1 - v0 + 3000} height={900} fill={p.front} />
      {variant === "rue" ? (
        // passage piéton sur la rue transversale
        <g>
          <rect x={1340} y={CURB} width={330} height={230} fill={p.road} />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={1360 + i * 52} y={CURB + 10} width={30} height={210} fill={p.roadLine} opacity={0.9} />
          ))}
          <rect x={1340} y={1640} width={330} height={900} fill={p.road} />
          <rect x={1334} y={CURB} width={10} height={1200} fill={p.curb} />
          <rect x={1666} y={CURB} width={10} height={1200} fill={p.curb} />
        </g>
      ) : null}
      {lamps.filter((x) => x > v0 - 400 && x < v1 + 400).map((x) => (
        <Lamp key={x} x={x} y={CURB + 30} on={lampsOn} color={p.pole} />
      ))}
    </g>
  );
};

/** Feu piéton (origine au pied du poteau). */
export const PedLight: React.FC<{ x: number; y: number; green: boolean; p: Pal; blink?: number }> = ({ x, y, green, p }) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x={-8} y={-470} width={16} height={470} fill={p.pole} />
    <rect x={-36} y={-560} width={72} height={150} rx={10} fill="#1d1d1d" />
    <rect x={-28} y={-552} width={56} height={64} rx={6} fill={!green ? "#ff3b30" : "#3a1512"} />
    <rect x={-28} y={-482} width={56} height={64} rx={6} fill={green ? "#34e07a" : "#11301e"} />
    {/* pictogrammes */}
    <g fill={!green ? "#ffd7d4" : "#7a3530"} transform="translate(0 -520)">
      <circle cx={0} cy={-18} r={6} />
      <rect x={-5} y={-11} width={10} height={22} rx={4} />
      <rect x={-4} y={9} width={3.5} height={14} />
      <rect x={0.5} y={9} width={3.5} height={14} />
    </g>
    <g fill={green ? "#d8ffe6" : "#245236"} transform="translate(0 -450)">
      <circle cx={2} cy={-18} r={6} />
      <path d="M-2 -10 L6 -10 L8 6 L14 20 L9 22 L2 8 L-4 22 L-9 20 L-2 4 Z" />
    </g>
    {!green ? <circle cx={0} cy={-520} r={70} fill="#ff3b30" opacity={0.12} /> : <circle cx={0} cy={-450} r={70} fill="#34e07a" opacity={0.14} />}
  </g>
);

/** Abri de bus (origine : pied gauche). */
export const Shelter: React.FC<{ x: number; p: Pal; wet: number }> = ({ x, p, wet }) => (
  <g transform={`translate(${x} ${0})`}>
    {/* paroi du fond */}
    <rect x={10} y={1120} width={360} height={330} fill="url(#glass)" />
    <rect x={10} y={1120} width={360} height={330} fill="none" stroke={p.pole} strokeWidth={8} />
    {/* panneau publicitaire lumineux */}
    <rect x={300} y={1130} width={70} height={250} fill="#fff7e0" opacity={0.9} />
    <rect x={306} y={1140} width={58} height={110} fill="#ffcf70" opacity={0.85} />
    <circle cx={335} cy={1300} r={18} fill="#e76f51" opacity={0.9} />
    {/* toit */}
    <path d={`M-20 1078 L420 1078 L408 1104 L-8 1104 Z`} fill={p.pole} />
    <rect x={-20} y={1072} width={440} height={10} fill={mixC(p.pole, "#fff", 0.25)} />
    {/* poteaux */}
    <rect x={0} y={1100} width={14} height={400} fill={p.pole} />
    <rect x={366} y={1100} width={14} height={400} fill={p.pole} />
    {/* banc */}
    <rect x={50} y={1398} width={240} height={14} rx={4} fill="#8a5a3c" />
    <rect x={50} y={1376} width={240} height={10} rx={4} fill="#9c6a48" />
    <rect x={70} y={1410} width={10} height={90} fill={p.pole} />
    <rect x={260} y={1410} width={10} height={90} fill={p.pole} />
    {/* gouttes qui tombent du toit */}
    {wet > 0
      ? Array.from({ length: 9 }, (_, i) => <rect key={i} x={-10 + i * 52} y={1106} width={3} height={10 + (i % 3) * 6} rx={1.5} fill="#cfe3f5" opacity={0.6 * wet} />)
      : null}
  </g>
);

/** Panneau d'arrêt de bus (origine au pied). */
export const BusSign: React.FC<{ x: number; p: Pal }> = ({ x, p }) => (
  <g transform={`translate(${x} ${CURB + 40})`}>
    <rect x={-6} y={-470} width={12} height={470} fill={p.pole} />
    <circle cx={0} cy={-470} r={44} fill="#2a9d8f" stroke="#f1faee" strokeWidth={6} />
    <text x={0} y={-460} fill="#f1faee" fontFamily="JBaloo, sans-serif" fontWeight={800} fontSize={30} textAnchor="middle">BUS</text>
    <rect x={-30} y={-380} width={60} height={86} rx={6} fill="#f1faee" />
    {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={-22} y={-370 + i * 15} width={44 - (i % 2) * 12} height={6} rx={3} fill="#8d99ae" />)}
  </g>
);

/** Bac à plantes (premier plan). */
export const Planter: React.FC<{ x: number; y: number; p: Pal; s?: number }> = ({ x, y, p, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <circle cx={-30} cy={-120} r={58} fill={p.foliage} />
    <circle cx={34} cy={-130} r={66} fill={p.foliage2} />
    <circle cx={0} cy={-170} r={56} fill={p.foliage} />
    <path d="M-80 -70 L80 -70 L66 0 L-66 0 Z" fill="#8d6e63" />
    <rect x={-86} y={-80} width={172} height={14} rx={4} fill="#a1887f" />
  </g>
);
