import React from "react";
import { interpolate, Easing } from "remotion";

export const C = {
  night: "#070B1A", mist: "#E6EBFA", mute: "#98A4D0",
  ind1: "#5668F0", ind2: "#1B2476", em1: "#23DDB0", em2: "#0A7C66", lat1: "#FF7C4D", lat2: "#D93A1E",
};
export const ACCENT = { em: C.em1, ind: "#A9B6FF", lat: "#FFB08F" } as const;
export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const prog = (frame: number, start: number, dur: number) => ease(clamp01((frame - start) / dur));

const pt = (a: number[][]) => a.map((p) => p.join(",")).join(" ");
const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

/** La marque : cube isométrique de trois modules, module supérieur détaché, orbite. faces/lift/orbit : progressions 0..1 */
export const Mark: React.FC<{ size: number; faces?: number; lift?: number; orbit?: number; id?: string }> = ({ size, faces = 1, lift = 1, orbit = 1, id = "m" }) => {
  const cx = 200, cy = 214, R = 112, dx = R * Math.cos(Math.PI / 6), dy = R * Math.sin(Math.PI / 6);
  const T = [cx, cy - R], UR = [cx + dx, cy - dy], LR = [cx + dx, cy + dy], B = [cx, cy + R], LL = [cx - dx, cy + dy], UL = [cx - dx, cy - dy], Cc = [cx, cy];
  const top = [T, UR, Cc, UL], left = [UL, Cc, B, LL], right = [Cc, UR, LR, B];
  const grid = (q: number[][]) => {
    const [a, b, c, d] = q; const m1 = [mid(a, b), mid(d, c)], m2 = [mid(b, c), mid(a, d)];
    return m1 && [m1, m2].map(([p, r], i) => <line key={i} x1={p[0]} y1={p[1]} x2={r[0]} y2={r[1]} stroke="#fff" strokeOpacity={0.17} strokeWidth={2} />);
  };
  const rx = 168, ry = 58, rot = -24, dotA = (38 * Math.PI) / 180;
  const dot = [rx * Math.cos(dotA), ry * Math.sin(dotA)];
  const L = lift * 20, circ = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) / 2; // demi-ellipse
  return (
    <svg width={size} height={size} viewBox="0 0 400 400">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.lat1} /><stop offset="1" stopColor={C.lat2} /></linearGradient>
        <linearGradient id={`l${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.ind1} /><stop offset="1" stopColor={C.ind2} /></linearGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.em1} /><stop offset="1" stopColor={C.em2} /></linearGradient>
        <mask id={`k${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400"><rect width="400" height="400" fill="#fff" /><line x1={Cc[0]} y1={Cc[1]} x2={B[0]} y2={B[1] + 4} stroke="#000" strokeWidth="7" /></mask>
      </defs>
      <g transform={`translate(${cx} ${cy}) rotate(${rot})`} fill="none" stroke="#fff" strokeOpacity={0.72 * orbit} strokeWidth="3.5" strokeLinecap="round">
        <path d={`M ${-rx} 0 A ${rx} ${ry} 0 0 1 ${rx} 0`} strokeDasharray={circ} strokeDashoffset={circ * (1 - orbit)} />
      </g>
      <g mask={`url(#k${id})`} opacity={faces} transform={`translate(0 ${(1 - faces) * 26})`}>
        <polygon points={pt(left)} fill={`url(#l${id})`} /><polygon points={pt(right)} fill={`url(#r${id})`} />{grid(left)}{grid(right)}
      </g>
      <g transform={`translate(0 ${-L - (1 - lift) * -18})`} opacity={clamp01(faces * 2 - 0.4)}>
        <polygon points={pt(top)} fill={`url(#t${id})`} />{grid(top)}
        <polyline points={pt([UL, T, UR])} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth="2.2" strokeLinejoin="round" />
      </g>
      <g transform={`translate(${cx} ${cy}) rotate(${rot})`} fill="none" opacity={orbit}>
        <path d={`M ${rx} 0 A ${rx} ${ry} 0 0 1 ${-rx} 0`} stroke="#fff" strokeOpacity={0.72} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx={dot[0]} cy={dot[1]} r="12" fill={C.lat1} stroke={C.night} strokeWidth="4" />
      </g>
    </svg>
  );
};

export const Wordmark: React.FC<{ size: number; sub?: boolean }> = ({ size, sub = true }) => (
  <div style={{ fontFamily: "Outfit", color: "#fff", lineHeight: 1 }}>
    <div style={{ fontSize: size, letterSpacing: "-0.02em" }}><b style={{ fontWeight: 700 }}>SaaS</b> <span style={{ fontWeight: 400 }}>Lab</span></div>
    {sub && <div style={{ fontFamily: "GeistMono", fontSize: size * 0.3, letterSpacing: "0.5em", color: C.mute, marginTop: size * 0.22 }}>MADAGASCAR</div>}
  </div>
);
