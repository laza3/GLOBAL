import React from "react";
import { C, Pt, blobPath, lerp, lerpPt, mix } from "../lib";

export type Palette = { body: string; wing: string; leg: string };

export const GREY: Palette = { body: "#BDBDBD", wing: "#A7A7A7", leg: "#A0A0A0" };
export const PINK: Palette = { body: "#FF6FA5", wing: "#F04F8B", leg: "#FF86B5" };
export const PALE: Palette = { body: "#FFC9DD", wing: "#FFB0CD", leg: "#FFCFE1" };

export const mixPalette = (a: Palette, b: Palette, t: number): Palette => ({
  body: mix(a.body, b.body, t),
  wing: mix(a.wing, b.wing, t),
  leg: mix(a.leg, b.leg, t),
});

/**
 * Géométrie paramétrique du flamant, dans un repère local dont l'origine est
 * le pied d'appui (y négatif vers le haut). g : 0 = poussin, 1 = adulte.
 * dip : 0 = tête levée, 1 = tête à l'envers dans l'eau.
 */
export const flamingoGeo = (g: number, dip: number) => {
  const L = (a: number, b: number) => lerp(a, b, g);
  const body = { cx: L(0, -12), cy: L(-138, -362), rx: L(88, 120), ry: L(84, 74), rot: L(0, -9) + dip * 9 };
  const rot = (p: Pt): Pt => {
    const a = (body.rot * Math.PI) / 180;
    const dx = p.x - body.cx;
    const dy = p.y - body.cy;
    return { x: body.cx + dx * Math.cos(a) - dy * Math.sin(a), y: body.cy + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  const N0 = rot({ x: body.cx + body.rx * L(0.15, 0.62), y: body.cy - body.ry * L(0.55, 0.5) });
  const headStand = { x: L(28, 46), y: L(-232, -662) };
  const headDip = { x: 196, y: -84 };
  const H = lerpPt(headStand, headDip, dip);
  const C1 = lerpPt({ x: N0.x + L(8, 78), y: N0.y + L(-20, -78) }, { x: N0.x + 160, y: N0.y - 40 }, dip);
  const C2 = lerpPt({ x: headStand.x + L(0, -98), y: headStand.y + L(20, 122) }, { x: headDip.x + 14, y: headDip.y - 210 }, dip);
  const headR = L(54, 34);
  const hipY = body.cy + body.ry * 0.68;
  return { body, N0, C1, C2, H, headR, headRot: dip * 150, hipY, neckW: L(50, 28) };
};

type Props = {
  g: number;
  dip: number;
  tuck: number;
  palette: Palette;
  blink: number;
  breath: number; // -1..1
  id: string;
};

export const Flamingo: React.FC<Props> = ({ g, dip, tuck, palette, blink, breath, id }) => {
  const L = (a: number, b: number) => lerp(a, b, g);
  const geo = flamingoGeo(g, dip);
  const { body, N0, C1, C2, H, headR, hipY } = geo;
  const legW = L(13, 12);

  // Jambe d'appui (pied à l'origine)
  const sx = L(-24, 0);
  // Seconde jambe : droite (poussin) → repliée (adulte sur une patte)
  const tx = L(24, 4);
  const knee = lerpPt({ x: tx, y: hipY * 0.5 }, { x: tx - 62, y: hipY + 96 }, tuck);
  const foot2 = lerpPt({ x: tx, y: 0 }, { x: tx + 22, y: hipY + 128 }, tuck);

  const footPath = (x: number, y: number, s: number) =>
    `M${x - 8 * s} ${y} Q${x + 18 * s} ${y - 9 * s} ${x + 36 * s} ${y + 3 * s} Q${x + 14 * s} ${y + 9 * s} ${x - 8 * s} ${y + 6 * s} Z`;

  const fluff = 1 - g;
  const bodyPath = blobPath(body.cx, body.cy, body.rx * (1 + breath * 0.012), body.ry * (1 - breath * 0.012), fluff * 0.07, 16);

  // Aile et queue, dans le repère du corps (avant rotation)
  const { rx, ry } = body;
  const ws = L(0.62, 1);
  const wing = `M${0.45 * rx * ws} ${-0.45 * ry * ws} C${0.1 * rx * ws} ${-0.78 * ry * ws} ${-0.7 * rx * ws} ${-0.62 * ry * ws} ${-1.08 * rx * ws} ${-0.05 * ry * ws}
    L${-0.86 * rx * ws} ${0.08 * ry * ws} L${-0.98 * rx * ws} ${0.24 * ry * ws} L${-0.72 * rx * ws} ${0.27 * ry * ws} L${-0.78 * rx * ws} ${0.42 * ry * ws}
    C${-0.3 * rx * ws} ${0.52 * ry * ws} ${0.42 * rx * ws} ${0.32 * ry * ws} ${0.45 * rx * ws} ${-0.45 * ry * ws} Z`;
  const tail = `M${-0.85 * rx} ${-0.28 * ry} L${-1.32 * rx} ${-0.62 * ry} L${-1.18 * rx} ${-0.24 * ry} L${-1.4 * rx} ${-0.14 * ry} L${-0.92 * rx} ${0.2 * ry} Z`;

  // Bec : paramétrique (petit bec droit sombre → grand bec courbé clair à pointe noire)
  const bx = headR * 0.7;
  const BL = L(30, 68);
  const T = L(18, 28);
  const B = L(0.1, 0.9);
  const tipX = bx + BL;
  const tipY = B * BL * 0.45;
  const beak = `M${bx} ${-T * 0.55} L${bx + BL * 0.5} ${-T * 0.5} Q${bx + BL * 0.9} ${-T * 0.45} ${tipX} ${tipY}
    Q${tipX - 3} ${tipY + 8} ${tipX - 10} ${tipY + 4} Q${bx + BL * 0.62} ${T * 0.22} ${bx + BL * 0.42} ${T * 0.3} L${bx} ${T * 0.45} Z`;
  const beakColor = mix("#59626F", "#FFE9DE", g);

  const eyeX = headR * 0.2;
  const eyeY = -headR * 0.22;
  const eyeR = L(15, 9.5);

  return (
    <g>
      {/* seconde jambe */}
      <path d={`M${tx} ${hipY} L${knee.x} ${knee.y} L${foot2.x} ${foot2.y}`} stroke={palette.leg} strokeWidth={legW} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={footPath(foot2.x, foot2.y, L(0.7, 1))} fill={palette.leg} opacity={1 - tuck} />
      {/* jambe d'appui */}
      <path d={`M${sx} ${hipY} L${sx} 0`} stroke={palette.leg} strokeWidth={legW} strokeLinecap="round" />
      <circle cx={sx} cy={hipY * 0.5} r={L(0, 10)} fill={palette.leg} />
      <path d={footPath(sx, 0, L(0.7, 1))} fill={palette.leg} />

      {/* queue */}
      <g transform={`translate(${body.cx} ${body.cy}) rotate(${body.rot})`} opacity={g}>
        <path d={tail} fill={palette.wing} strokeLinejoin="round" />
      </g>

      {/* cou */}
      <path d={`M${N0.x} ${N0.y} C${C1.x} ${C1.y} ${C2.x} ${C2.y} ${H.x} ${H.y}`} stroke={palette.body} strokeWidth={geo.neckW} strokeLinecap="round" fill="none" />

      {/* corps + aile */}
      <g transform={`rotate(${body.rot} ${body.cx} ${body.cy})`}>
        <path d={bodyPath} fill={palette.body} />
        <g transform={`translate(${body.cx} ${body.cy})`}>
          <path d={wing} fill={palette.wing} />
        </g>
      </g>

      {/* tête */}
      <g transform={`translate(${H.x} ${H.y}) rotate(${geo.headRot})`}>
        {/* touffe de duvet */}
        <path d={`M${-headR * 0.25} ${-headR * 0.9} q4 -26 18 -22 M${-headR * 0.02} ${-headR * 0.95} q10 -22 22 -12`} stroke={palette.body} strokeWidth={9} strokeLinecap="round" fill="none" opacity={fluff} />
        <path d={blobPath(0, 0, headR, headR, fluff * 0.06, 12)} fill={palette.body} />
        <ellipse cx={headR * 0.05} cy={headR * 0.38} rx={headR * 0.26} ry={headR * 0.15} fill={C.pink} opacity={fluff * 0.3} />
        <path d={beak} fill={beakColor} />
        <clipPath id={`beakTip-${id}`}>
          <path d={beak} />
        </clipPath>
        <rect x={bx + BL * 0.62} y={-60} width={80} height={140} fill={C.navy} clipPath={`url(#beakTip-${id})`} opacity={g} />
        <g transform={`translate(${eyeX} ${eyeY}) scale(1 ${1 - blink * 0.92})`}>
          <circle r={eyeR} fill={C.white} />
          <circle cx={eyeR * 0.18} r={eyeR * 0.6} fill={C.navy} />
          <circle cx={eyeR * 0.38} cy={-eyeR * 0.25} r={eyeR * 0.22} fill={C.white} />
        </g>
      </g>
    </g>
  );
};
