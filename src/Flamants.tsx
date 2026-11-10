import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Baloo2";
import { C, FREEZE_AT, bezier, clamp, lerp, pop, prog, rand, wavePath } from "./lib";
import { Flamingo, GREY, PALE, PINK, flamingoGeo, mixPalette } from "./components/Flamingo";
import { Glow, PlateBadge, Sparkle } from "./components/Critters";
import { Underwater } from "./components/Underwater";
import { Subtitle, Word } from "./components/Subtitle";
import { VOICE } from "./voice";

const { fontFamily: baloo } = loadFont("normal", { weights: ["800"], subsets: ["latin", "latin-ext"] });
const FONT = `${baloo}, "Noto Color Emoji", sans-serif`;

const SURFACE = 1380; // niveau de l'eau de la lagune (monde)
const ANCHOR = { x: 540, y: 1100 }; // point écran visé par la caméra

// ——— Caméra continue (scale + translate) ———
const CAM_T = [0, 44, 60, 80, 125, 158, 205, 258, 296, 360, 425];
const CAM_FX = [540, 540, 540, 540, 540, 540, 650, 650, 560, 560, 548];
const CAM_FY = [1185, 1185, 1185, 1185, 1095, 1095, 1415, 1415, 1095, 1095, 1085];
const CAM_S = [1.3, 1.38, 1.34, 1.34, 1.12, 1.12, 3.3, 3.3, 1.12, 1.12, 1.16];
const cam = (f: number) => {
  const o = { ...clamp, easing: Easing.inOut(Easing.cubic) };
  return {
    fx: interpolate(f, CAM_T, CAM_FX, o),
    fy: interpolate(f, CAM_T, CAM_FY, o),
    s: interpolate(f, CAM_T, CAM_S, o),
  };
};

const BLINKS = [62, 140, 200, 262, 304, 350, 392];
const blinkAt = (f: number) => {
  let b = 0;
  for (const t of BLINKS) b = Math.max(b, 1 - Math.abs(f - t) / 3.5);
  return Math.max(0, b);
};

const EGG = "M0 -118 C60 -118 92 -30 92 30 C92 90 50 118 0 118 C-50 118 -92 90 -92 30 C-92 -30 -60 -118 0 -118 Z";
const CRACK = [[-100, 6], [-66, -12], [-40, 10], [-12, -14], [14, 8], [40, -12], [66, 8], [100, -8]];
const crackD = "M" + CRACK.map((p) => p.join(" ")).join(" L");
const topClip = `M-140 -200 L140 -200 L140 ${CRACK[CRACK.length - 1][1]} ` + [...CRACK].reverse().map((p) => `L${p[0]} ${p[1]}`).join(" ") + " Z";
const botClip = `M-140 200 L140 200 L140 ${CRACK[CRACK.length - 1][1]} ` + [...CRACK].reverse().map((p) => `L${p[0]} ${p[1]}`).join(" ") + " Z";

// ——— Textes (2 à 6 mots par écran) ———
const TXT: { lines: Word[][]; start: number; end?: number; size: number }[] = [
  {
    start: 4, end: 70, size: 96,
    lines: [
      [{ t: "Les", at: 6 }, { t: "flamants", at: 11 }, { t: "roses", at: 17 }],
      [{ t: "naissent…", at: 24 }, { t: "GRIS.", at: 46, hl: "pink" }],
    ],
  },
  {
    start: 80, end: 158, size: 104,
    lines: [
      [{ t: "Leur", at: 84 }, { t: "couleur", at: 90 }, { t: "vient", at: 97 }],
      [{ t: "de", at: 104 }, { t: "leur", at: 109 }, { t: "assiette.", at: 116, hl: "orange" }],
    ],
  },
  {
    start: 168, end: 262, size: 100,
    lines: [
      [{ t: "Algues", at: 176 }, { t: "+", at: 183 }, { t: "crevettes", at: 188 }],
      [{ t: "=", at: 206 }, { t: "pigments", at: 213 }],
      [{ t: "CAROTÉNOÏDES", at: 236, hl: "orange" }],
    ],
  },
  {
    start: 268, end: 302, size: 112,
    lines: [[{ t: "Plus", at: 272 }, { t: "il", at: 276 }], [{ t: "en", at: 280 }, { t: "mange…", at: 285, hl: "orange" }]],
  },
  {
    start: 308, end: 356, size: 112,
    lines: [[{ t: "plus", at: 311 }, { t: "il", at: 315 }], [{ t: "est", at: 319 }, { t: "rose.", at: 327, hl: "pink" }]],
  },
  {
    start: 364, size: 124,
    lines: [
      [{ t: "Tu", at: 372 }, { t: "es", at: 376 }, { t: "ce", at: 380 }, { t: "que", at: 384 }],
      [{ t: "tu", at: 389 }, { t: "manges", at: 394, hl: "orange" }, { t: "🦩", at: 403 }],
    ],
  },
];

export const Flamants: React.FC = () => {
  const f = Math.min(useCurrentFrame(), FREEZE_AT);
  const { fx, fy, s } = cam(f);
  const shake = f >= 45 && f < 62 ? Math.sin(f * 3.1) * 12 * (1 - (f - 45) / 17) : 0;
  const camT = `translate(${ANCHOR.x + shake} ${ANCHOR.y + shake * 0.4}) scale(${s}) translate(${-fx} ${-fy})`;

  // ——— Flamant ———
  const g = prog(f, 86, 130);
  const hatch = pop(f, 44, 9, 160, 0.7);
  const move = prog(f, 86, 126);
  const ox = lerp(540, 520, move);
  const oy = lerp(1300, 1455, move) - Math.sin(move * Math.PI) * 70 + (1 - hatch) * 90;
  const settle = f > 128 ? 0.06 * Math.sin((f - 128) * 0.55) * Math.exp(-(f - 128) / 7) : 0;
  const scale = (f < 44 ? 0 : hatch) * lerp(0.85, 1, g);
  const tuck = prog(f, 130, 148);
  const dip = prog(f, 276, 296) - prog(f, 322, 342);
  const blink = blinkAt(f);
  const breath = Math.sin(f * 0.12);
  const geo = flamingoGeo(g, dip);

  const fill = prog(f, 322, 356, Easing.inOut(Easing.quad));
  const fillY = lerp(30, -750, fill);
  const pale = prog(f, 386, 402) - prog(f, 404, 420);
  const pinkPal = mixPalette(PINK, PALE, pale);

  // ——— Œuf ———
  const shakeAmp = interpolate(f, [4, 44], [1.5, 11], clamp);
  const eggRot = f < 45 ? Math.sin(f * 1.25) * shakeAmp : 0;
  const eggHop = f < 45 ? -Math.abs(Math.sin(f * 0.42)) * shakeAmp * 0.7 : 0;
  const crack = prog(f, 20, 42);
  const tt = Math.max(0, (f - 45) / 30);

  // ——— Nid ———
  const nestDrop = prog(f, 86, 122);

  // ——— Portail sous-marin ———
  const open = prog(f, 168, 198, Easing.out(Easing.cubic));
  const close = prog(f, 256, 284, Easing.inOut(Easing.cubic));
  const R = 1400 * open * (1 - close);
  const uwScale = lerp(1.5, 1, open) * lerp(1, 0.45, close);

  // ——— Assiette ———
  let plate = 0;
  if (f < 200) plate = pop(f, 116, 10) * (1 - prog(f, 154, 164, Easing.in(Easing.cubic)));
  else if (f < 400) plate = pop(f, 362, 10) * (1 - prog(f, 388, 398, Easing.in(Easing.back(1.6))));
  else plate = pop(f, 402, 9);
  const cross1 = prog(f, 372, 380, Easing.out(Easing.cubic));
  const cross2 = prog(f, 377, 385, Easing.out(Easing.cubic));

  // ——— Vaguelettes ———
  const ripples = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const range = 1500;
    const x = ((rand(i) * range + f * (1.2 + rand(i + 4) * 0.8)) % range) - 220;
    const y = SURFACE + 40 + rand(i + 7) * 330;
    return <path key={i} d={`M${x} ${y} q18 -12 36 0 q18 12 36 0`} stroke={C.white} strokeWidth={6} strokeLinecap="round" fill="none" opacity={0.55} />;
  });

  const footX = ox + lerp(-24, 0, g) * scale;
  const rings = (cx: number, alpha: number, key: string) =>
    [0, 1].map((k) => {
      const age = ((f + k * 22) % 44) / 44;
      return (
        <ellipse key={key + k} cx={cx} cy={SURFACE + 4} rx={22 + age * 80} ry={(22 + age * 80) * 0.22} fill="none" stroke={C.white} strokeWidth={5} opacity={alpha * (1 - age) * 0.8} />
      );
    });

  const worldBubbles = [0, 1, 2, 3, 4, 5].map((k) => {
    const period = 50 + rand(k) * 30;
    const age = (f + rand(k + 3) * period) % period;
    const y = 1640 - age * 5;
    const x = footX - 90 + rand(k + 1) * 180 + Math.sin(age * 0.2) * 6;
    return <circle key={k} cx={x} cy={y} r={5 + rand(k + 5) * 6} fill="none" stroke={C.white} strokeWidth={3.5} opacity={y > SURFACE + 8 ? 0.7 : 0} />;
  });

  // ——— Pigments qui remontent dans le flamant (scène 4) ———
  const intake: React.ReactNode[] = [];
  for (let i = 0; i < 10; i++) {
    const st = 292 + i * 3;
    const u = (f - st) / 28;
    if (u < 0 || u > 1) continue;
    const p0 = { x: 140 + (rand(i) - 0.5) * 160, y: 50 + rand(i + 2) * 60 };
    let p;
    if (u < 0.25) {
      const k = Easing.out(Easing.quad)(u / 0.25);
      p = { x: lerp(p0.x, geo.H.x, k), y: lerp(p0.y, geo.H.y, k) };
    } else if (u < 0.8) {
      p = bezier(geo.N0, geo.C1, geo.C2, geo.H, 1 - (u - 0.25) / 0.55);
    } else {
      const k = (u - 0.8) / 0.2;
      p = { x: lerp(geo.N0.x, geo.body.cx, k), y: lerp(geo.N0.y, geo.body.cy, k) };
    }
    intake.push(<Glow key={i} x={p.x} y={p.y} s={u > 0.85 ? (1 - u) / 0.15 : 1} o={1} />);
  }

  const sparkles = [
    { x: 380, y: 900, c: C.orange, r: 0 },
    { x: 690, y: 760, c: C.pink, r: 1 },
    { x: 760, y: 1010, c: C.orange, r: 2 },
    { x: 330, y: 1180, c: C.pink, r: 3 },
    { x: 640, y: 1220, c: C.orange, r: 4 },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: C.cream }}>
      {VOICE.map((v) => (
        <Sequence key={v.file} from={v.from} layout="none">
          <Audio src={staticFile(`voix/${v.file}`)} volume={1} />
        </Sequence>
      ))}
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <clipPath id="portal">
            <circle cx={ANCHOR.x} cy={ANCHOR.y} r={Math.max(0.01, R)} />
          </clipPath>
        </defs>

        <g transform={camT}>
          {/* décor : soleil bas et collines douces */}
          <rect x={-1400} y={-1400} width={3900} height={4800} fill={C.cream} />
          <circle cx={870} cy={1290} r={95} fill={C.sun} />
          <ellipse cx={160} cy={SURFACE + 20} rx={360} ry={90} fill={C.peach} />
          <ellipse cx={900} cy={SURFACE + 30} rx={420} ry={70} fill={C.peach} />

          {/* lagune */}
          <path d={wavePath(SURFACE, 7, 280, f * 0.09)} fill={C.lagoon} />
          <path d={wavePath(SURFACE + 150, 6, 340, -f * 0.07)} fill={C.lagoonDeep} opacity={0.35} />
          {ripples}

          {/* nid de boue */}
          {f < 125 && (
            <g transform={`translate(0 ${nestDrop * 170})`} opacity={1 - prog(f, 100, 122)}>
              <path d="M318 1404 Q345 1312 430 1300 L650 1300 Q735 1312 762 1404 Q540 1436 318 1404 Z" fill={C.sand} />
              <path d="M372 1352 q40 -8 80 0 M565 1366 q50 -10 100 0" stroke={C.sandDark} strokeWidth={8} strokeLinecap="round" fill="none" />
              <ellipse cx={540} cy={1302} rx={112} ry={20} fill={C.sandDark} />
            </g>
          )}

          {/* œuf : dos, éclats */}
          {f < 95 && (
            <g transform={`translate(540 ${1182 + eggHop}) rotate(${eggRot} 0 110)`}>
              {f < 45 ? (
                <g>
                  <path d={EGG} fill="#FFFDF8" stroke="#EADBC6" strokeWidth={5} />
                  <circle cx={-34} cy={-50} r={9} fill="#F1E4D2" />
                  <circle cx={30} cy={-12} r={7} fill="#F1E4D2" />
                  <circle cx={-10} cy={52} r={11} fill="#F1E4D2" />
                  <path d={crackD} stroke={C.navy} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" fill="none" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - crack} opacity={crack > 0 ? 0.8 : 0} />
                </g>
              ) : (
                <g transform={`translate(${-170 * tt} ${-280 * tt + 640 * tt * tt}) rotate(${-140 * tt})`} opacity={1 - prog(f, 64, 74)}>
                  <clipPath id="eggTop"><path d={topClip} /></clipPath>
                  <path d={EGG} fill="#FFFDF8" stroke="#EADBC6" strokeWidth={5} clipPath="url(#eggTop)" />
                  <circle cx={-34} cy={-50} r={9} fill="#F1E4D2" />
                </g>
              )}
            </g>
          )}

          {f >= 45 && f < 80 &&
            Array.from({ length: 12 }).map((_, i) => {
              const a = (i / 12) * Math.PI * 2 + 0.3;
              const t = (f - 45) / 30;
              const d = 60 + 260 * Easing.out(Easing.cubic)(t);
              const x = 540 + Math.cos(a) * d;
              const y = 1150 + Math.sin(a) * d * 0.8 + 380 * t * t;
              return (
                <path key={i} d="M-12 -8 L12 -4 L-2 12 Z" fill={i % 3 ? "#FFFDF8" : C.orange} stroke="#EADBC6" strokeWidth={2}
                  transform={`translate(${x} ${y}) rotate(${i * 50 + f * 9})`} opacity={1 - t} />
              );
            })}
          {/* flamant : version grise + version rose révélée comme une jauge */}
          {f >= 44 && (
            <g transform={`translate(${ox} ${oy}) scale(${scale * (1 + settle)} ${scale * (1 - settle)})`}>
              <Flamingo id="grey" g={g} dip={dip} tuck={tuck} palette={GREY} blink={blink} breath={breath} />
              {fill > 0 && (
                <>
                  <clipPath id="gauge">
                    <path d={wavePath(fillY, 9, 110, f * 0.35, -400, 500, 200)} />
                  </clipPath>
                  <g clipPath="url(#gauge)">
                    <Flamingo id="pink" g={g} dip={dip} tuck={tuck} palette={pinkPal} blink={blink} breath={breath} />
                  </g>
                </>
              )}
              {intake}
            </g>
          )}

          {/* œuf : coquille du bas (devant le poussin), éclats et étoile d'éclosion */}
          {f >= 45 && f < 95 && (
            <g transform={`translate(540 ${1182 + prog(f, 72, 90) * 70})`} opacity={1 - prog(f, 74, 90)}>
              <clipPath id="eggBot"><path d={botClip} /></clipPath>
              <path d={EGG} fill="#FFFDF8" stroke="#EADBC6" strokeWidth={5} clipPath="url(#eggBot)" />
              <circle cx={-10} cy={52} r={11} fill="#F1E4D2" />
            </g>
          )}
          {f >= 44 && f < 60 &&
            Array.from({ length: 10 }).map((_, i) => {
              const a = (i / 10) * Math.PI * 2;
              const t = prog(f, 44, 58, Easing.out(Easing.cubic));
              const r1 = 140 + 80 * t;
              const r2 = r1 + 50 * (1 - t) + 10;
              return (
                <line key={i} x1={540 + Math.cos(a) * r1} y1={1170 + Math.sin(a) * r1} x2={540 + Math.cos(a) * r2} y2={1170 + Math.sin(a) * r2}
                  stroke={i % 2 ? C.orange : C.pink} strokeWidth={12} strokeLinecap="round" opacity={1 - t} />
              );
            })}

          {/* eau devant (teinte les parties immergées) + vie de la lagune */}
          <path d={wavePath(SURFACE, 7, 280, f * 0.09)} fill={C.lagoon} opacity={0.55} />
          {rings(footX, prog(f, 118, 130), "foot")}
          {rings(ox + 150, dip > 0.7 ? (dip - 0.7) / 0.3 : 0, "beak")}
          {worldBubbles}

          {/* assiette */}
          {plate > 0.001 && (
            <g transform={`translate(225 1010) scale(${plate}) rotate(${(1 - plate) * -25})`}>
              <PlateBadge t={f} />
              {f > 360 && f < 400 && (
                <g>
                  <line x1={-62} y1={-62} x2={-62 + 124 * cross1} y2={-62 + 124 * cross1} stroke={C.navy} strokeWidth={20} strokeLinecap="round" opacity={cross1 > 0 ? 1 : 0} />
                  <line x1={62} y1={-62} x2={62 - 124 * cross2} y2={-62 + 124 * cross2} stroke={C.navy} strokeWidth={20} strokeLinecap="round" opacity={cross2 > 0 ? 1 : 0} />
                </g>
              )}
            </g>
          )}

          {/* étincelles quand il redevient éclatant */}
          {sparkles.map((p, i) => {
            const sp = pop(f, 408 + i * 3, 9);
            if (f < 408 + i * 3) return null;
            return (
              <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${(f - 408) * 2 + i * 20})`}>
                <Sparkle s={sp * (0.7 + rand(i) * 0.5)} color={p.c} />
              </g>
            );
          })}
        </g>

        {/* zoom dans l'eau : portail circulaire vers le monde microscopique */}
        {R > 0.5 && (
          <g>
            <g clipPath="url(#portal)">
              <g transform={`translate(${ANCHOR.x} ${ANCHOR.y}) scale(${uwScale}) translate(${-ANCHOR.x} ${-ANCHOR.y})`}>
                <Underwater f={f} />
              </g>
            </g>
            <circle cx={ANCHOR.x} cy={ANCHOR.y} r={R} fill="none" stroke={C.white} strokeWidth={14} opacity={0.85} />
          </g>
        )}
      </svg>

      {TXT.map((b, i) => (
        <Subtitle key={i} frame={f} lines={b.lines} start={b.start} end={b.end} fontSize={b.size} fontFamily={FONT} />
      ))}
    </AbsoluteFill>
  );
};
