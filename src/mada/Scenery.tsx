import React from "react";
import { P, clamp, lerp, outC, prog, rand } from "./lib";

// ——— Baobab : tronc bombé, couronne de petites branches ———
export const baobabPath = (w: number, h: number) => {
  const b = w / 2; // demi-largeur à la base
  const m = b * 0.46; // demi-largeur du col
  const ny = -h * 0.76; // hauteur du col
  const parts: string[] = [
    // tronc en bouteille
    `M${-b} 0 C${-b * 0.97} ${-h * 0.22} ${-b * 0.55} ${-h * 0.5} ${-m} ${ny} L${m} ${ny} C${b * 0.55} ${-h * 0.5} ${b * 0.97} ${-h * 0.22} ${b} 0 Z`,
  ];
  const branch = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    const nx = -dy / L;
    const ny2 = dx / L;
    const f = (n: number) => n.toFixed(1);
    parts.push(
      `M${f(x0 + nx * w0)} ${f(y0 + ny2 * w0)} L${f(x1 + nx * w1)} ${f(y1 + ny2 * w1)} L${f(x1 - nx * w1)} ${f(y1 - ny2 * w1)} L${f(x0 - nx * w0)} ${f(y0 - ny2 * w0)} Z`,
    );
    // touffe de feuilles au bout de la branche
    const r = m * 2.1;
    parts.push(
      `M${f(x1 - r)} ${f(y1 - r * 0.1)} a${f(r)} ${f(r * 0.42)} 0 1 1 ${f(2 * r)} 0 a${f(r)} ${f(r * 0.42)} 0 1 1 ${f(-2 * r)} 0 Z`,
    );
  };
  branch(-m * 0.5, ny + 4, -m * 2.1, -h * 0.98, m * 0.65, m * 0.25);
  branch(0, ny + 4, 0, -h * 1.08, m * 0.6, m * 0.25);
  branch(m * 0.5, ny + 4, m * 2.1, -h * 0.98, m * 0.65, m * 0.25);
  return parts.join(" ");
};

export const Sky: React.FC<{ f: number }> = ({ f }) => {
  const pulse = 1 + 0.015 * Math.sin(f / 14);
  const rise = 1 - prog(f, 0, 40, outC);
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={P.night} />
          <stop offset="0.3" stopColor={P.plum} />
          <stop offset="0.52" stopColor={P.coral} />
          <stop offset="0.68" stopColor={P.orange} />
          <stop offset="0.8" stopColor={P.gold} />
          <stop offset="1" stopColor={P.gold} />
        </linearGradient>
        <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFF1C2" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#FFD27A" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF8F3C" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-600} y={-600} width={2300} height={3200} fill="url(#sky)" />
      {/* étoiles */}
      {Array.from({ length: 34 }).map((_, i) => {
        const x = rand(i + 1) * 1080;
        const y = rand(i + 50) * 700;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(f / 18 + i * 2.1));
        return <circle key={i} cx={x} cy={y} r={1.5 + rand(i + 9) * 2.2} fill="#FFF6E8" opacity={tw * (1 - y / 900)} />;
      })}
      {/* halo + soleil */}
      <g transform={`translate(540 ${1180 + rise * 340}) scale(${pulse})`}>
        <circle r={640} fill="url(#sunGlow)" />
        <circle r={190} fill="#FFE8A8" />
        <circle r={150} fill="#FFF3CF" />
      </g>
    </svg>
  );
};

const BAOBABS = [
  { x: -80, h: 560, w: 150, far: 0.4 },
  { x: 250, h: 420, w: 120, far: 0.55 },
  { x: 800, h: 480, w: 130, far: 0.5 },
  { x: 1180, h: 600, w: 160, far: 0.4 },
];

/** Baobabs en silhouette, 2 plans de profondeur (parallaxe selon la frame). */
export const Baobabs: React.FC<{ f: number }> = ({ f }) => {
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {/* collines lointaines */}
      <path d="M-600 1500 Q -200 1380 120 1450 T 700 1440 T 1400 1470 L1400 1700 L-600 1700 Z" fill="#B8402A" opacity={0.55} />
      {BAOBABS.map((b, i) => {
        const dx = -f * b.far * 0.35;
        const sway = Math.sin(f / 40 + i) * 0.4;
        return (
          <g key={i} transform={`translate(${b.x + dx} 1520) rotate(${sway})`}>
            <path d={baobabPath(b.w * 0.8, b.h * 0.8)} fill="#5A1F3A" opacity={0.75} />
          </g>
        );
      })}
      {/* sol */}
      <path d="M-600 1500 Q 200 1470 540 1490 T 1700 1500 L1700 2600 L-600 2600 Z" fill={P.earth} />
      <path d="M-600 1560 Q 300 1530 700 1555 T 1700 1560 L1700 2600 L-600 2600 Z" fill={P.earthDark} />
      {/* baobabs d'avant-plan */}
      {[
        { x: 70, h: 700, w: 190, s: 1 },
        { x: 1010, h: 640, w: 170, s: 1 },
      ].map((b, i) => {
        const sway = Math.sin(f / 46 + i * 2) * 0.35;
        return (
          <g key={i} transform={`translate(${b.x} 1580) rotate(${sway})`}>
            <path d={baobabPath(b.w, b.h)} fill="#2A0F2E" />
          </g>
        );
      })}
    </svg>
  );
};

/** Lucioles / poussière dorée qui montent. */
export const Fireflies: React.FC<{ f: number; count?: number }> = ({ f, count = 36 }) => (
  <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
    {Array.from({ length: count }).map((_, i) => {
      const sp = 0.6 + rand(i + 3) * 1.4;
      const x0 = rand(i + 11) * 1200 - 60;
      const y0 = 700 + rand(i + 23) * 1300;
      const x = x0 + Math.sin(f / 22 + i) * 40;
      const y = (((y0 - f * sp * 1.4) % 1500) + 1500) % 1500 + 300;
      const r = 3 + rand(i + 5) * 6;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(f / 9 + i * 1.7));
      return (
        <g key={i} opacity={tw * 0.9}>
          <circle cx={x} cy={y} r={r * 3.2} fill="#FFE29A" opacity={0.22} />
          <circle cx={x} cy={y} r={r} fill="#FFF0B8" />
        </g>
      );
    })}
  </svg>
);

/** Rayons de soleil qui tournent doucement. */
export const Rays: React.FC<{ f: number; opacity: number }> = ({ f, opacity }) => (
  <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity }}>
    <g transform={`translate(540 1180) rotate(${f * 0.18})`}>
      {Array.from({ length: 16 }).map((_, i) => (
        <path key={i} d={`M0 0 L${-70} ${-1500} L${70} ${-1500} Z`} fill="#FFE8A8" opacity={0.1} transform={`rotate(${(i * 360) / 16})`} />
      ))}
    </g>
  </svg>
);

export { lerp, clamp };
