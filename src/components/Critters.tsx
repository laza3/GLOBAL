import React from "react";
import { C } from "../lib";

/** Artémia (petite crevette) mignonne, tournée vers la droite, longueur ~170 px. */
export const Shrimp: React.FC<{ t: number; seed: number }> = ({ t, seed }) => {
  const segs = 10;
  const items: React.ReactNode[] = [];
  const legs: React.ReactNode[] = [];
  for (let i = segs - 1; i >= 0; i--) {
    const x = 50 - i * 12;
    const y = Math.sin(i * 0.45 + t * 0.12 + seed) * 4 + i * i * 0.18;
    const r = 15 - i * 0.85;
    items.push(<circle key={`s${i}`} cx={x} cy={y} r={r} fill={i % 2 ? "#FF8F3A" : C.orange} />);
    if (i >= 1 && i <= 6) {
      const a = Math.sin(t * 0.45 + i * 0.9 + seed) * 28;
      legs.push(
        <ellipse key={`l${i}`} cx={x} cy={y + r + 4} rx={4} ry={11} fill="#FFC27D" transform={`rotate(${a + 20} ${x} ${y + r - 2})`} />,
      );
    }
  }
  const tailY = 9 * 9 * 0.18 + 6;
  return (
    <g>
      {legs}
      {/* queue fourchue */}
      <path d={`M-58 ${tailY} q-22 -14 -30 -4 M-58 ${tailY} q-20 10 -28 18`} stroke="#FF8F3A" strokeWidth={7} strokeLinecap="round" fill="none" />
      {items}
      {/* tête */}
      <circle cx={66} cy={-2} r={17} fill={C.orange} />
      {/* antennes */}
      <path d="M78 -14 q16 -22 34 -18 M76 -8 q22 -6 36 6" stroke="#FF8F3A" strokeWidth={5} strokeLinecap="round" fill="none" />
      {/* œil sur pédoncule */}
      <path d="M70 -12 L80 -24" stroke="#FF8F3A" strokeWidth={6} strokeLinecap="round" />
      <circle cx={82} cy={-27} r={9} fill={C.white} />
      <circle cx={84} cy={-27} r={5.5} fill={C.navy} />
      <circle cx={86} cy={-29} r={2} fill={C.white} />
      {/* sourire */}
      <path d="M70 4 q6 5 12 0" stroke={C.navy} strokeWidth={3} strokeLinecap="round" fill="none" />
    </g>
  );
};

/** Micro-algue unicellulaire (petit rond avec noyau). */
export const Alga: React.FC<{ r: number; color: "green" | "orange" }> = ({ r, color }) => {
  const main = color === "green" ? C.green : C.orange;
  const dark = color === "green" ? C.greenDark : "#F08A2C";
  const light = color === "green" ? "#B5E2A8" : "#FFC98F";
  return (
    <g>
      <circle r={r} fill={main} />
      <circle r={r} fill="none" stroke={dark} strokeWidth={Math.max(2, r * 0.12)} opacity={0.6} />
      <circle cx={-r * 0.25} cy={-r * 0.2} r={r * 0.38} fill={light} />
      <circle cx={-r * 0.35} cy={-r * 0.35} r={r * 0.12} fill={C.white} opacity={0.9} />
    </g>
  );
};

/** Filament de spiruline (chaîne ondulée). */
export const Spirulina: React.FC<{ t: number; len: number }> = ({ t, len }) => {
  let d = "";
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * len - len / 2;
    const y = Math.sin(i * 0.9 + t * 0.15) * 10;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return <path d={d} stroke={C.green} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
};

/** Particule de pigment orange lumineuse (halo plat + cœur clair). */
export const Glow: React.FC<{ x: number; y: number; s: number; o: number }> = ({ x, y, s, o }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
    <circle r={24} fill={C.orange} opacity={0.22} />
    <circle r={15} fill={C.orange} opacity={0.35} />
    <circle r={9} fill={C.orange} />
    <circle r={4} cx={-2} cy={-2} fill="#FFE1BE" />
  </g>
);

/** Assiette dans un badge rond, avec algues et une mini-crevette. */
export const PlateBadge: React.FC<{ t: number }> = ({ t }) => (
  <g>
    <circle r={104} fill={C.navy} opacity={0.08} cy={10} />
    <circle r={100} fill={C.white} />
    <circle r={100} fill="none" stroke={C.lagoon} strokeWidth={8} />
    <circle r={70} fill={C.cream} stroke="#E4D4BF" strokeWidth={5} />
    <circle r={50} fill="none" stroke="#EADCC9" strokeWidth={3} />
    <g transform="translate(-26 -22)"><Alga r={13} color="green" /></g>
    <g transform="translate(4 -34)"><Alga r={10} color="orange" /></g>
    <g transform="translate(30 -14)"><Alga r={12} color="green" /></g>
    <g transform="translate(-36 10)"><Alga r={9} color="orange" /></g>
    <g transform="translate(6 22) scale(0.36)"><Shrimp t={t} seed={3} /></g>
  </g>
);

/** Petite étoile scintillante. */
export const Sparkle: React.FC<{ s: number; color: string }> = ({ s, color }) => (
  <path
    transform={`scale(${s})`}
    d="M0 -26 Q4 -4 26 0 Q4 4 0 26 Q-4 4 -26 0 Q-4 -4 0 -26 Z"
    fill={color}
  />
);
