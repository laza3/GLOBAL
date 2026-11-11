import React from "react";

/** Gobelet de café (repère : main, x le long de l'avant-bras). */
export const Cup: React.FC<{ tilt?: number; full?: boolean }> = ({ tilt = 0, full = true }) => (
  <g transform={`rotate(${tilt})`}>
    <g transform="rotate(-90) translate(-17 -48)">
      <path d="M2 10 L32 10 L28 54 L6 54 Z" fill="#f4efe6" />
      <path d="M4 26 L30 26 L29 40 L5 40 Z" fill="#b5651d" />
      <rect x={0} y={4} width={34} height={8} rx={3} fill="#3a2a22" />
      {full ? <path d="M10 2 Q12 -8 16 2 Q20 -10 24 2" stroke="rgba(255,255,255,0.55)" strokeWidth={2.4} fill="none" strokeLinecap="round" /> : null}
    </g>
  </g>
);

export const UMBRELLA = "#ffc93c";
export const UMBRELLA_DARK = "#e6a817";

/**
 * Parapluie (repère : poignée à l'origine, mât vers le haut −y).
 * open : 0 fermé → 1 ouvert.
 */
export const Umbrella: React.FC<{ open?: number; rot?: number; shaft?: number }> = ({ open = 1, rot = 0, shaft = 175 }) => {
  const w = 20 + 150 * open;
  const h = 18 + 60 * open;
  const top = -shaft;
  const n = 5;
  // bord festonné, parcouru de droite à gauche pour refermer la toile
  const scallop = Array.from({ length: n }, (_, i) => {
    const x0 = w - (2 * w * i) / n;
    const x1 = w - (2 * w * (i + 1)) / n;
    return `Q${((x0 + x1) / 2).toFixed(1)} ${(top + 14 * open).toFixed(1)} ${x1.toFixed(1)} ${top.toFixed(1)}`;
  }).join(" ");
  return (
    <g transform={`rotate(${rot})`}>
      <path d={`M0 0 L0 ${top - h * 0.9}`} stroke="#2b2b2b" strokeWidth={6} strokeLinecap="round" />
      <path d="M0 0 Q0 16 -12 16 Q-20 16 -20 8" stroke="#2b2b2b" strokeWidth={6} fill="none" strokeLinecap="round" />
      <path d={`M${-w} ${top} Q${-w * 0.9} ${top - h * 1.05} 0 ${top - h} Q${w * 0.9} ${top - h * 1.05} ${w} ${top} ${scallop} Z`} fill={UMBRELLA} />
      <path d={`M0 ${top - h} Q${-w * 0.35} ${top - h * 0.6} ${-w * 0.42} ${top + 6 * open}`} stroke={UMBRELLA_DARK} strokeWidth={3} fill="none" />
      <path d={`M0 ${top - h} Q${w * 0.35} ${top - h * 0.6} ${w * 0.42} ${top + 6 * open}`} stroke={UMBRELLA_DARK} strokeWidth={3} fill="none" />
      <path d={`M${-w * 0.75} ${top - h * 0.55} Q${-w * 0.45} ${top - h * 0.95} ${-w * 0.1} ${top - h * 0.98}`} stroke="rgba(255,255,255,0.45)" strokeWidth={5} fill="none" strokeLinecap="round" />
      <circle cx={0} cy={top - h - 6} r={5} fill="#2b2b2b" />
    </g>
  );
};

export const ORANGE = "#ff8c1a";

export const Orange: React.FC<{ x: number; y: number; r?: number; spin?: number }> = ({ x, y, r = 17, spin = 0 }) => (
  <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${spin.toFixed(1)})`}>
    <circle r={r} fill={ORANGE} />
    <circle r={r} fill="url(#orangeShade)" />
    <path d={`M0 ${-r + 2} q3 -7 9 -6`} stroke="#3f7d20" strokeWidth={3} fill="none" strokeLinecap="round" />
    <ellipse cx={-r * 0.35} cy={-r * 0.35} rx={r * 0.25} ry={r * 0.16} fill="rgba(255,255,255,0.5)" transform="rotate(-35)" />
  </g>
);

/** Sac en papier kraft (repère : main, porté contre soi). */
export const PaperBag: React.FC<{ torn?: number; fill?: number }> = ({ torn = 0, fill = 1 }) => (
  <g transform="rotate(-90) translate(-36 -10)">
    <path d={`M0 0 L72 0 L76 ${86 - torn * 12} L56 ${80 + torn * 10} L40 ${88 - torn * 18} L20 ${80 + torn * 8} L-4 ${86 - torn * 10} Z`} fill="#c8a165" />
    <path d="M0 0 L72 0 L72 10 L0 10 Z" fill="#b38b52" />
    {fill > 0.05 ? (
      <g opacity={Math.min(1, fill * 1.5)}>
        <circle cx={22} cy={-6} r={14} fill={ORANGE} />
        <circle cx={48} cy={-8} r={15} fill={ORANGE} />
        <path d="M58 -24 q6 -16 14 -10" stroke="#5a9e3a" strokeWidth={5} fill="none" strokeLinecap="round" />
      </g>
    ) : null}
  </g>
);

/** Basket au sol. */
export const Shoe: React.FC<{ x: number; y: number; rot?: number; flip?: boolean }> = ({ x, y, rot = 0, flip }) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${flip ? -1 : 1} 1)`}>
    <path d="M-38 0 L-38 -22 Q-30 -30 -14 -26 L4 -18 Q30 -16 38 -6 L38 0 Z" fill="#e94f37" />
    <path d="M-38 0 L38 0 L38 -6 L-38 -6 Z" fill="#f5f0e8" />
    <path d="M-10 -24 L-2 -12 M-2 -24 L6 -14" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
  </g>
);

// ——— Afficheur 7 segments ———
const SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd",
};
const segPath = (s: string, w: number, h: number) => {
  const m = h / 2;
  switch (s) {
    case "a": return `M2 0 L${w - 2} 0`;
    case "b": return `M${w} 2 L${w} ${m - 2}`;
    case "c": return `M${w} ${m + 2} L${w} ${h - 2}`;
    case "d": return `M2 ${h} L${w - 2} ${h}`;
    case "e": return `M0 ${m + 2} L0 ${h - 2}`;
    case "f": return `M0 2 L0 ${m - 2}`;
    default: return `M2 ${m} L${w - 2} ${m}`;
  }
};

export const SevenSeg: React.FC<{ text: string; x: number; y: number; w?: number; h?: number; color: string; dim?: string }> = ({
  text, x, y, w = 13, h = 26, color, dim = "rgba(255,60,48,0.08)",
}) => {
  let cx = x;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ":") {
      out.push(<circle key={`c${i}a`} cx={cx + 3} cy={y + h * 0.3} r={2.2} fill={color} />, <circle key={`c${i}b`} cx={cx + 3} cy={y + h * 0.7} r={2.2} fill={color} />);
      cx += 10;
      continue;
    }
    const on = SEGS[ch] ?? "";
    for (const s of "abcdefg") {
      out.push(
        <path key={`${i}${s}`} d={segPath(s, w, h)} transform={`translate(${cx} ${y}) skewX(-6)`} stroke={on.includes(s) ? color : dim} strokeWidth={3.6} strokeLinecap="round" />,
      );
    }
    cx += w + 8;
  }
  return <g>{out}</g>;
};

/** Petite voiture (vue de profil), roues animées. */
export const Car: React.FC<{ x: number; y: number; color: string; dir?: number; t: number; scale?: number }> = ({ x, y, color, dir = 1, t, scale = 1 }) => {
  const spin = (t * 900 * dir) % 360;
  return (
    <g transform={`translate(${x} ${y}) scale(${dir * scale} ${scale})`}>
      <path d="M-150 -30 L-150 -70 Q-145 -82 -120 -84 L-70 -86 L-40 -128 Q-30 -136 -10 -136 L70 -136 Q90 -136 104 -120 L130 -88 L148 -84 Q160 -80 160 -60 L160 -30 Z" fill={color} />
      <path d="M-30 -122 L-6 -124 L-6 -90 L-56 -88 Z M6 -124 L66 -124 Q80 -124 90 -112 L108 -90 L6 -90 Z" fill="#9fc3d9" opacity={0.85} />
      <rect x={-150} y={-52} width={310} height={6} fill="rgba(0,0,0,0.12)" />
      <circle cx={150} cy={-66} r={6} fill="#fff3b0" />
      {[-90, 100].map((wx) => (
        <g key={wx} transform={`translate(${wx} -26) rotate(${spin})`}>
          <circle r={30} fill="#1f1f1f" />
          <circle r={14} fill="#9a9a9a" />
          <rect x={-2} y={-14} width={4} height={28} fill="#6a6a6a" />
        </g>
      ))}
    </g>
  );
};

/** Bus urbain (profil, avant à droite). Origine : bas des roues, arrière. */
export const Bus: React.FC<{ x: number; y: number; t: number; doors?: number; v?: number }> = ({ x, y, t, doors = 0, v = 0 }) => {
  const spin = (t * v * 0.9) % 360;
  const win = Array.from({ length: 6 }, (_, i) => 120 + i * 112);
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={-330} width={900} height={290} rx={26} fill="#2a9d8f" />
      <rect x={0} y={-130} width={900} height={22} fill="#f1faee" opacity={0.9} />
      <rect x={0} y={-108} width={900} height={50} rx={6} fill="#23867a" />
      {win.map((wx) => (
        <rect key={wx} x={wx} y={-300} width={92} height={120} rx={10} fill="#1d3557" opacity={0.92} />
      ))}
      {win.map((wx) => (
        <path key={`r${wx}`} d={`M${wx + 12} -290 L${wx + 40} -290 L${wx + 18} -192 L${wx + 8} -192 Z`} fill="rgba(255,255,255,0.18)" />
      ))}
      {/* pare-brise */}
      <path d="M830 -310 Q890 -306 896 -250 L896 -170 L820 -170 Z" fill="#1d3557" />
      {/* porte (s'ouvre/ferme) */}
      <rect x={20} y={-300} width={80} height={240} rx={6} fill="#1d3557" />
      <rect x={20 + 40 * doors} y={-300} width={40 * (1 - doors)} height={240} fill="#3d7c74" />
      <rect x={60} y={-300} width={40 * (1 - doors)} height={240} fill="#3d7c74" />
      <rect x={60} y={-300} width={3} height={240} fill="#14322f" opacity={1 - doors} />
      {/* girouette */}
      <rect x={700} y={-326} width={150} height={26} rx={4} fill="#111" />
      <text x={775} y={-306} fontSize={20} fontFamily="monospace" fill="#ffb703" textAnchor="middle">12  GARE</text>
      <circle cx={880} cy={-80} r={10} fill="#fff3b0" />
      <rect x={-6} y={-120} width={12} height={40} rx={4} fill="#e63946" />
      {[150, 720].map((wx) => (
        <g key={wx} transform={`translate(${wx} -40) rotate(${spin})`}>
          <circle r={44} fill="#1b1b1b" />
          <circle r={22} fill="#8d99ae" />
          <rect x={-3} y={-22} width={6} height={44} fill="#5c677d" />
          <rect x={-22} y={-3} width={44} height={6} fill="#5c677d" />
        </g>
      ))}
    </g>
  );
};

/** Réverbère (origine au pied). */
export const Lamp: React.FC<{ x: number; y: number; on?: number; color?: string }> = ({ x, y, on = 0, color = "#2f3e46" }) => (
  <g transform={`translate(${x} ${y})`}>
    {on > 0 ? <circle cx={52} cy={-542} r={120} fill="url(#lampGlow)" opacity={on} /> : null}
    <rect x={-9} y={-540} width={18} height={540} fill={color} />
    <rect x={-16} y={-60} width={32} height={60} rx={4} fill={color} />
    <path d="M0 -530 Q0 -560 50 -560" stroke={color} strokeWidth={12} fill="none" />
    <path d="M30 -566 L76 -566 L70 -544 L36 -544 Z" fill={color} />
    <rect x={38} y={-546} width={30} height={8} rx={3} fill={on > 0 ? "#fff1c1" : "#d9d4c7"} />
  </g>
);
