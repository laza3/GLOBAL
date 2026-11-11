import React from "react";
import { H, W, rnd } from "../util";

/** Pluie en coordonnées écran : deux plans (fin/lointain, épais/proche). */
export const Rain: React.FC<{ t: number; k: number; wind?: number }> = ({ t, k, wind = 0.14 }) => {
  if (k <= 0.01) return null;
  const layers = [
    { n: 150, len: [40, 70], sp: [1900, 2500], w: 2, o: 0.32 },
    { n: 70, len: [80, 130], sp: [2700, 3400], w: 3.2, o: 0.45 },
  ];
  return (
    <g>
      {layers.map((L, li) => {
        const n = Math.round(L.n * Math.min(1, k));
        let d = "";
        for (let i = 0; i < n; i++) {
          const s = li * 1000 + i;
          const sp = L.sp[0] + rnd(s) * (L.sp[1] - L.sp[0]);
          const len = L.len[0] + rnd(s + 0.3) * (L.len[1] - L.len[0]);
          const span = H + 300;
          const y = ((rnd(s + 0.7) * span + t * sp) % span) - 150;
          const x = ((rnd(s + 0.9) * (W + 400) + y * wind) % (W + 400)) - 200;
          d += `M${x.toFixed(1)} ${y.toFixed(1)} l${(len * wind).toFixed(1)} ${len.toFixed(1)} `;
        }
        return <path key={li} d={d} stroke="#e3ecf7" strokeWidth={L.w} strokeLinecap="round" opacity={L.o * Math.min(1, k)} />;
      })}
    </g>
  );
};

/** Éclaboussures au sol (coordonnées monde). */
export const Splashes: React.FC<{ t: number; k: number; x0: number; x1: number; y0: number; y1: number; n?: number }> = ({ t, k, x0, x1, y0, y1, n = 40 }) => {
  if (k <= 0.01) return null;
  const out: React.ReactNode[] = [];
  const life = 0.32;
  for (let i = 0; i < n * k; i++) {
    const period = 0.6 + rnd(i * 3.3) * 0.7;
    const ph = rnd(i * 1.7) * period;
    const cyc = Math.floor((t + ph) / period);
    const u = ((t + ph) % period) / life;
    if (u > 1) continue;
    const x = x0 + rnd(i * 9.1 + cyc * 1.3) * (x1 - x0);
    const y = y0 + rnd(i * 4.7 + cyc * 2.1) * (y1 - y0);
    const r = 6 + 16 * u;
    out.push(
      <g key={i} opacity={(1 - u) * 0.7}>
        <ellipse cx={x} cy={y} rx={r} ry={r * 0.28} fill="none" stroke="#e8f1fb" strokeWidth={2.5} />
        <circle cx={x - 6 - 10 * u} cy={y - 18 * Math.sin(Math.PI * u)} r={2.6} fill="#e8f1fb" />
        <circle cx={x + 6 + 10 * u} cy={y - 14 * Math.sin(Math.PI * u)} r={2.2} fill="#e8f1fb" />
      </g>,
    );
  }
  return <g>{out}</g>;
};

/** Flaque (monde) avec ondes de pluie. */
export const Puddle: React.FC<{ x: number; y: number; w: number; t: number; rain: number; tint: string; glow?: number }> = ({ x, y, w, t, rain, tint, glow = 0 }) => (
  <g>
    <ellipse cx={x} cy={y} rx={w} ry={w * 0.13} fill={tint} opacity={0.55} />
    <ellipse cx={x} cy={y} rx={w} ry={w * 0.13} fill="url(#puddle)" />
    {glow > 0 ? <ellipse cx={x + w * 0.1} cy={y - 2} rx={w * 0.45} ry={w * 0.05} fill="#fff4cf" opacity={glow} /> : null}
    {rain > 0.05
      ? [0, 1, 2].map((i) => {
          const per = 0.9 + i * 0.23;
          const u = ((t + i * 0.37) % per) / per;
          const cx = x + (rnd(i + Math.floor((t + i * 0.37) / per)) - 0.5) * w;
          return <ellipse key={i} cx={cx} cy={y} rx={4 + 26 * u} ry={(4 + 26 * u) * 0.25} fill="none" stroke="#f1f6fc" strokeWidth={2} opacity={(1 - u) * 0.7 * rain} />;
        })
      : null}
  </g>
);

/** Nuages doux (coordonnées écran). */
export const Clouds: React.FC<{ t: number; dark: number; offX?: number; offY?: number; o?: number; color?: string }> = ({ t, dark, offX = 0, offY = 0, o = 1, color }) => {
  const base = color ?? (dark > 0.5 ? "#5d6679" : "#ffffff");
  const list = [
    { x: 120, y: 180, s: 1.2 }, { x: 640, y: 120, s: 1.5 }, { x: 980, y: 300, s: 1.0 },
    { x: 330, y: 420, s: 0.9 }, { x: 820, y: 520, s: 1.3 }, { x: -60, y: 600, s: 1.1 },
  ];
  return (
    <g opacity={o}>
      {list.map((c, i) => {
        const x = ((c.x + t * (10 + i * 3) + offX * 0.2) % 1500) - 200;
        const y = c.y + offY * 0.15;
        return (
          <g key={i} transform={`translate(${x} ${y}) scale(${c.s})`} opacity={0.75 + 0.2 * dark}>
            <ellipse cx={0} cy={0} rx={110} ry={44} fill={base} />
            <ellipse cx={-60} cy={10} rx={70} ry={34} fill={base} />
            <ellipse cx={50} cy={-24} rx={74} ry={50} fill={base} />
            <ellipse cx={90} cy={12} rx={60} ry={30} fill={base} />
          </g>
        );
      })}
    </g>
  );
};

/** Rideau de nuages d'orage (couvre le ciel quand dark → 1). */
export const StormCover: React.FC<{ k: number; t: number; open?: number }> = ({ k, t, open = 0 }) => {
  if (k <= 0.01) return null;
  const blobs = Array.from({ length: 14 }, (_, i) => ({
    x: -150 + i * 100 + Math.sin(i * 1.7) * 40,
    y: 60 + (i % 4) * 110 + Math.cos(i) * 30,
    r: 150 + (i % 3) * 40,
  }));
  return (
    <g opacity={Math.min(1, k)}>
      {blobs.map((b, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const dx = side * open * (500 + i * 30);
        return <ellipse key={i} cx={b.x + dx + Math.sin(t * 0.3 + i) * 12} cy={b.y - 100 * (1 - Math.min(1, k * 1.4))} rx={b.r} ry={b.r * 0.55} fill={i % 3 === 0 ? "#4b5366" : "#596277"} />;
      })}
    </g>
  );
};

/** Rayons de soleil qui percent (coordonnées écran). */
export const SunBeams: React.FC<{ k: number; x: number; y: number; t: number }> = ({ k, x, y, t }) => {
  if (k <= 0.01) return null;
  return (
    <g opacity={k} style={{ mixBlendMode: "screen" }}>
      {Array.from({ length: 9 }, (_, i) => {
        const a = -40 + i * 11 + Math.sin(t * 0.6 + i) * 1.5;
        const w = 14 + (i % 3) * 10;
        return (
          <path
            key={i}
            d={`M${x} ${y} L${x + Math.sin(((a - w / 10) * Math.PI) / 180) * 2600} ${y + Math.cos(((a - w / 10) * Math.PI) / 180) * 2600} L${x + Math.sin(((a + w / 10) * Math.PI) / 180) * 2600} ${y + Math.cos(((a + w / 10) * Math.PI) / 180) * 2600} Z`}
            fill="#fff3c4"
            opacity={0.1 + 0.06 * (i % 2)}
          />
        );
      })}
      <circle cx={x} cy={y} r={260} fill="url(#sunG)" opacity={0.9} />
    </g>
  );
};
