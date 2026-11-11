import React from "react";
import { Stickman } from "../Stickman";
import { Key, P, Pose, STAND, keyed, mixPose, runPose, toWorld, joints } from "../rig";
import { SevenSeg, Shoe } from "../props";
import { Defs } from "../decor/City";
import { CamKey, H, W, backO, camAt, camTransform, easeI, easeO, ev, evr, k01, lerp, mixC, shake, springAt } from "../util";
import { SANS } from "../fonts";

const FLOOR = 1420; // pied du mur
const FRONT = 1520; // sol où marche le héros

const [ff0, ff1] = evr("ff");
const [al1a, al1b] = evr("alarm1");
const [al2a, al2b] = evr("alarm2");
const SNOOZE = ev("snooze");
const WAKE = ev("wake");
const JUMP = ev("jumpOff");
const TRIP = ev("trip");
const IMPACT = ev("impact");
const SHOE_LAND = ev("shoeLand");
const WHIP = ev("whip1");

// ——— Héros ———
const SLEEP_FACE = { eye: 0.05, mouth: 0.35, brow: 0, turn: 0.1, look: 0, lookY: 0, open: 0 };
const LIE = P(STAND, { x: 700, y: 1243, dir: -1, rot: 90, hip: 0, lean: 0, neck: 0, lF: [0, 0], lB: [3, 0], aF: [6, 4], aB: [3, 4], face: SLEEP_FACE });
const LIE_STIR = P(LIE, { neck: -6, face: { eye: 0.05, mouth: -0.5, brow: 0.8 } });
const SIT = P(STAND, {
  x: 705, y: 1250, dir: -1, rot: 0, hip: 0, lean: -6, neck: -4, lF: [92, 0], lB: [90, 2], aF: [42, 28], aB: [-34, 24],
  face: { eye: 1.35, open: 0.45, brow: -0.6, mouth: -0.2, turn: 0.35, look: 0.2 },
});
const LOOK = P(SIT, { lean: -2, neck: -6, aF: [70, 60], aB: [-20, 30], face: { eye: 1.55, open: 0.95, brow: -1, mouth: -0.6, turn: -0.95, look: -1, lookY: 0.1 } });
const CROUCH = P(SIT, { lean: 24, neck: 6, aF: [-40, 30], aB: [-55, 30], face: { eye: 1.2, open: 0.3, brow: 0.5, mouth: -0.4, turn: 0.85, look: 1 } });
const AIR = P(STAND, { x: 742, y: 1360, dir: 0.6, hip: 210, lean: 12, lF: [62, 100], lB: [36, 90], aF: [150, 20], aB: [128, 24], face: { eye: 1.35, open: 0.7, brow: -0.8, mouth: -0.3, turn: 0.4 } });
const LAND = P(STAND, { x: 775, y: FRONT, dir: 1, hip: null, lean: 18, lF: [26, 54], lB: [-12, 44], aF: [60, 40], aB: [-40, 30], sq: 0.94, face: { eye: 1.3, open: 0.5, brow: -0.8, mouth: -0.4, turn: 0.9, look: 1 } });
const PANIC = { eye: 1.3, open: 0.55, brow: -0.9, mouth: -0.4, turn: 0.9, look: 1, lookY: 0 };
const FALL = P(STAND, { x: 950, y: FRONT, dir: 1, rot: 38, hip: 130, lean: 18, neck: -10, lF: [10, 20], lB: [-55, 70], aF: [150, 8], aB: [128, 18], face: { eye: 1.55, open: 1, brow: -1, mouth: -0.6, turn: 0.6, look: 1 } });
const FLAT = P(STAND, { x: 1002, y: 1511, dir: 1, rot: 90, hip: 0, lean: 0, neck: -12, lF: [2, 0], lB: [-6, 4], aF: [168, 6], aB: [160, 10], face: { eye: 1.4, open: 0.8, brow: -1, mouth: -0.6, turn: 0.3, look: 0 } });
const SAD = P(FLAT, { neck: -16, face: { eye: 0.55, open: 0, brow: -1, mouth: -0.85, turn: 0, look: 0, lookY: 0 } });
const SIGH = P(SAD, { neck: -30, face: { eye: 0.45, brow: -1, mouth: -0.95, turn: 0 } });

const heroAt = (t: number): Pose => {
  if (t < WAKE) {
    const stir = t > al2a ? k01(t, al2a, al2a + 0.3) : 0;
    const p = mixPose(LIE, LIE_STIR, stir);
    return p;
  }
  if (t < 7.3) {
    const s = springAt(t, WAKE, 3.2, 7);
    return mixPose(LIE, SIT, Math.min(1.12, s));
  }
  if (t < JUMP) {
    return keyed(
      [
        { t: 7.3, p: SIT },
        { t: 7.42, p: LOOK, e: backO },
        { t: 7.82, p: LOOK },
        { t: 7.98, p: CROUCH },
      ],
      t,
    );
  }
  if (t < 8.3) {
    const k: Key[] = [
      { t: JUMP, p: CROUCH },
      { t: 8.15, p: AIR, e: easeO },
      { t: 8.3, p: LAND, e: easeI },
    ];
    return keyed(k, t);
  }
  if (t < TRIP) {
    const u = (t - 8.3) / (TRIP - 8.3);
    const run = runPose(P(STAND, { x: lerp(775, 900, u), y: FRONT, dir: 1, face: PANIC }), (t - 8.3) / 0.5 + 0.1, 1.05);
    return u < 0.25 ? mixPose(LAND, run, u / 0.25) : run;
  }
  if (t < IMPACT + 0.25) {
    const p = keyed(
      [
        { t: TRIP, p: runPose(P(STAND, { x: 900, y: FRONT, dir: 1, face: PANIC }), 0.9, 1.05) },
        { t: 8.88, p: FALL, e: easeO },
        { t: IMPACT, p: FLAT, e: easeI },
      ],
      t,
    );
    const sq = t > IMPACT ? 1 - 0.14 * Math.exp(-(t - IMPACT) * 9) * Math.cos((t - IMPACT) * 40) : 1;
    return { ...p, sq };
  }
  return keyed(
    [
      { t: IMPACT + 0.25, p: FLAT },
      { t: 9.75, p: SAD },
      { t: 10.15, p: SAD },
      { t: 10.45, p: SIGH },
      { t: 11.2, p: SIGH },
      { t: 11.6, p: P(SAD, { neck: -8 }) },
    ],
    t,
  );
};

// ——— Caméra ———
const CAM: CamKey[] = [
  { t: 0, c: { x: 690, y: 1030, s: 0.84 } },
  { t: 2.45, c: { x: 720, y: 1110, s: 0.98 } },
  { t: 2.95, c: { x: 900, y: 1205, s: 1.6 } },
  { t: 3.6, c: { x: 895, y: 1200, s: 1.62 } },
  { t: 5.5, c: { x: 760, y: 1080, s: 1.0 } },
  { t: 6.4, c: { x: 860, y: 1180, s: 1.38 } },
  { t: 6.95, c: { x: 850, y: 1175, s: 1.4 } },
  { t: 7.3, c: { x: 735, y: 1110, s: 2.35 }, e: easeO },
  { t: 7.95, c: { x: 740, y: 1112, s: 2.45 } },
  { t: 8.3, c: { x: 840, y: 1300, s: 1.28 }, e: easeO },
  { t: IMPACT, c: { x: 940, y: 1350, s: 1.22 } },
  { t: 9.6, c: { x: 1060, y: 1440, s: 1.7, r: -1.5 }, e: easeO },
  { t: 12.2, c: { x: 1100, y: 1470, s: 2.15, r: -3.5 } },
];

// ——— Décor ———
const lightAt = (t: number) => 0.12 + 0.88 * k01(t, ff0, ff1);

const clockText = (t: number) => {
  const u = k01(t, ff0, ff1, (x) => x);
  const minutes = Math.round(7 * 60 + u * 102);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const ringing = (t: number) => (t >= al1a && t < SNOOZE) || (t >= al2a && t < al2b + 0.4);

const Room: React.FC<{ t: number; light: number }> = ({ t, light }) => {
  const c = (dim: string, bright: string) => mixC(dim, bright, light);
  const wall = c("#3a4466", "#efd9bd");
  const wall2 = c("#323a5a", "#e2c39e");
  const floor = c("#3f343d", "#b9875e");
  const seam = c("#2e2630", "#9c6f4b");
  const wood = c("#3d2c2a", "#8c5b3d");
  const sunY = lerp(1080, 640, k01(t, ff0, ff1));
  const ring = ringing(t);
  const jit = ring ? Math.sin(t * 90) * 3.5 : 0;
  const blink = ring ? (Math.floor(t * 4) % 2 === 0 ? 1 : 0.25) : 1;
  return (
    <g>
      {/* mur */}
      <rect x={-400} y={-800} width={2300} height={FLOOR + 800} fill={wall} />
      <rect x={-400} y={-800} width={2300} height={1000} fill="#000" opacity={0.06} />
      <rect x={-400} y={196} width={2300} height={10} fill={c("#4a5578", "#f7ead6")} />
      {Array.from({ length: 30 }, (_, i) => <rect key={i} x={-400 + i * 76} y={200} width={30} height={FLOOR - 200 - 260} fill="#000" opacity={0.035} />)}
      <rect x={-400} y={FLOOR - 260} width={2300} height={260} fill={wall2} />
      <rect x={-400} y={FLOOR - 270} width={2300} height={14} fill={c("#4a5578", "#f7ead6")} />
      <rect x={-400} y={FLOOR - 26} width={2300} height={26} fill={c("#4a5578", "#f7ead6")} />
      {/* fenêtre */}
      <defs>
        <linearGradient id="winSky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c("#5d6ea8", "#7cc0ee")} />
          <stop offset="1" stopColor={c("#e3a49c", "#e3f4fb")} />
        </linearGradient>
        <clipPath id="winClip"><rect x={480} y={560} width={340} height={430} /></clipPath>
      </defs>
      <g clipPath="url(#winClip)">
        <rect x={480} y={560} width={340} height={430} fill="url(#winSky)" />
        <circle cx={700} cy={sunY} r={46} fill={c("#ffb38a", "#fff6d8")} />
        <circle cx={700} cy={sunY} r={90} fill={c("#ffb38a", "#fff6d8")} opacity={0.25} />
        <path d="M480 990 L480 880 L530 880 L530 840 L590 840 L590 900 L640 900 L640 820 L700 820 L700 870 L760 870 L760 900 L820 900 L820 990 Z" fill={c("#3d4a73", "#a9c6dc")} />
      </g>
      <rect x={470} y={550} width={360} height={450} fill="none" stroke={c("#d5d2d8", "#fbf8f2")} strokeWidth={22} />
      <rect x={640} y={560} width={14} height={430} fill={c("#d5d2d8", "#fbf8f2")} />
      <rect x={480} y={768} width={340} height={14} fill={c("#d5d2d8", "#fbf8f2")} />
      <rect x={450} y={1000} width={400} height={20} rx={4} fill={c("#c9c6cc", "#f4efe6")} />
      {/* rideaux */}
      <path d="M400 520 Q430 760 410 1060 L480 1060 Q470 780 480 520 Z" fill={c("#3d6a73", "#5fa8a3")} />
      <path d="M900 520 Q870 760 890 1060 L820 1060 Q830 780 820 520 Z" fill={c("#3d6a73", "#5fa8a3")} />
      <rect x={380} y={508} width={540} height={16} rx={8} fill={c("#2c2c34", "#6d4c3d")} />
      {/* rai de lumière */}
      <path d={`M480 1000 L820 1000 L${1010 + 120 * light} ${FRONT + 60} L${560 + 80 * light} ${FRONT + 60} Z`} fill="#fff4d6" opacity={0.2 * light} />
      {/* affiche */}
      <g transform="translate(130 640)">
        <rect x={0} y={0} width={210} height={270} fill={c("#26262e", "#2e2e2e")} />
        <rect x={12} y={12} width={186} height={246} fill={c("#6a7ca8", "#f6d39b")} />
        <circle cx={140} cy={90} r={30} fill={c("#c98c7c", "#fff3d4")} />
        <path d="M12 258 L12 190 L70 120 L110 170 L150 130 L198 190 L198 258 Z" fill={c("#3f4b72", "#e07a5f")} />
        <path d="M12 258 L12 220 L90 180 L198 230 L198 258 Z" fill={c("#36405f", "#c1543e")} />
      </g>
      {/* étagère */}
      <g transform="translate(970 860)">
        <rect x={0} y={0} width={280} height={14} fill={wood} />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={14 + i * 30} y={-80 + (i % 2) * 12} width={24} height={80 - (i % 2) * 12} fill={[c("#5a3f5f", "#8e5572"), c("#3c5a5a", "#2a9d8f"), c("#6a5a3a", "#e9c46a"), c("#5a3a3a", "#e76f51"), c("#3a465a", "#457b9d")][i]} />
        ))}
        <path d="M200 0 L250 0 L244 -40 L206 -40 Z" fill={c("#5a4a44", "#c97b5a")} />
        <circle cx={214} cy={-58} r={20} fill={c("#3c5a46", "#6a994e")} />
        <circle cx={238} cy={-66} r={22} fill={c("#456650", "#8cb369")} />
      </g>
      {/* porte */}
      <g transform="translate(1200 990)">
        <rect x={-14} y={-14} width={208} height={FLOOR - 990 + 14} fill={c("#4a5578", "#f7ead6")} />
        <rect x={0} y={0} width={180} height={FLOOR - 990} fill={c("#4a3a3a", "#b98b62")} />
        <rect x={20} y={24} width={140} height={160} rx={6} fill="none" stroke={c("#3c2e2e", "#a37a54")} strokeWidth={6} />
        <rect x={20} y={214} width={140} height={190} rx={6} fill="none" stroke={c("#3c2e2e", "#a37a54")} strokeWidth={6} />
        <circle cx={150} cy={225} r={10} fill={c("#8a7a50", "#e9c46a")} />
      </g>
      {/* sol */}
      <rect x={-400} y={FLOOR} width={2300} height={1000} fill={floor} />
      {[FLOOR + 22, FLOOR + 50, FLOOR + 86, FLOOR + 132, FLOOR + 190, FLOOR + 262, FLOOR + 350].map((y, i) => (
        <rect key={y} x={-400} y={y} width={2300} height={3} fill={seam} opacity={0.8 - i * 0.05} />
      ))}
      {Array.from({ length: 26 }, (_, i) => {
        const row = i % 6;
        const ys = [FLOOR, FLOOR + 22, FLOOR + 50, FLOOR + 86, FLOOR + 132, FLOOR + 190, FLOOR + 262];
        const x = -300 + ((i * 337) % 2000);
        return <rect key={i} x={x} y={ys[row]} width={3} height={ys[row + 1] - ys[row]} fill={seam} opacity={0.7} />;
      })}
      {/* tapis */}
      <ellipse cx={560} cy={1572} rx={360} ry={46} fill={c("#5a3a44", "#c4705d")} />
      <ellipse cx={560} cy={1572} rx={330} ry={36} fill="none" stroke={c("#6a4a52", "#e9c46a")} strokeWidth={5} strokeDasharray="14 10" />
      {/* lit */}
      <rect x={250} y={1300} width={660} height={110} rx={8} fill={wood} />
      <rect x={270} y={1408} width={22} height={26} fill={wood} />
      <rect x={870} y={1408} width={22} height={26} fill={wood} />
      <rect x={236} y={1150} width={44} height={262} rx={10} fill={wood} />
      <rect x={280} y={1252} width={630} height={54} rx={12} fill={c("#b9b6c4", "#f6f1e7")} />
      <path d="M815 1232 Q812 1206 840 1204 L900 1206 Q922 1210 918 1236 Q914 1262 890 1262 L836 1262 Q816 1258 815 1232 Z" fill={c("#c7c3cf", "#fffaf2")} />
      {/* table de nuit */}
      <rect x={925} y={1288} width={160} height={132} rx={6} fill={wood} />
      <rect x={940} y={1320} width={130} height={40} rx={4} fill={c("#33262a", "#7a4f35")} />
      <circle cx={1005} cy={1340} r={6} fill={c("#8a7a50", "#e9c46a")} />
      <rect x={935} y={1418} width={14} height={16} fill={wood} />
      <rect x={1061} y={1418} width={14} height={16} fill={wood} />
      {/* lampe de chevet */}
      <path d="M1048 1288 L1078 1288 L1070 1250 L1056 1250 Z" fill={c("#7d7a86", "#d9cbb5")} />
      <path d="M1036 1252 L1090 1252 L1078 1206 L1048 1206 Z" fill={c("#8a8696", "#f1e3c6")} />
      {/* réveil */}
      <g transform={`translate(990 1288) rotate(${jit})`}>
        <rect x={-48} y={-62} width={96} height={62} rx={14} fill="#26262b" />
        <rect x={-38} y={-52} width={76} height={38} rx={6} fill="#120c0c" />
        <SevenSeg text={clockText(t)} x={-34} y={-48} w={11} h={24} color={`rgba(255,59,48,${blink})`} />
        <rect x={-12} y={-70} width={24} height={9} rx={3} fill="#3a3a40" />
        {ring
          ? [1, 2, 3].map((i) => (
              <g key={i} opacity={0.8 - i * 0.18}>
                <path d={`M${-60 - i * 14} -52 Q${-74 - i * 18} -30 ${-60 - i * 14} -8`} stroke="#ff6b5b" strokeWidth={4} fill="none" strokeLinecap="round" />
                <path d={`M${60 + i * 14} -52 Q${74 + i * 18} -30 ${60 + i * 14} -8`} stroke="#ff6b5b" strokeWidth={4} fill="none" strokeLinecap="round" />
              </g>
            ))
          : null}
        <circle cx={0} cy={-34} r={70} fill="#ff3b30" opacity={0.08 * blink} />
      </g>
    </g>
  );
};

/** Couverture (couvre tout le corps couché, ou seulement les jambes une fois assis). */
const Blanket: React.FC<{ t: number; light: number }> = ({ t, light }) => {
  const sit = t < WAKE ? 0 : Math.min(1, springAt(t, WAKE, 3, 7));
  const gone = k01(t, JUMP, JUMP + 0.25);
  const breathe = t < WAKE ? Math.sin(t * 2.6) * 3 : 0;
  const right = lerp(838, 732, sit);
  const bump = 1218 - breathe;
  const col = mixC("#8a6a3c", "#e3a948", light);
  const stripe = mixC("#6e5430", "#c98b2c", light);
  const d = `M290 1258 Q300 ${1222 + 8 * gone} 380 ${1226 + 6 * gone} Q520 ${bump - 4 + 22 * gone} 640 ${bump + 4 + 18 * gone} Q${right - 20} ${bump + 2 + 16 * gone} ${right} ${1232 + 10 * gone} Q${right + 18} 1262 ${right + 4} 1300 L${right + 4 - 20 * gone} 1350 Q600 1366 296 1352 Z`;
  return (
    <g>
      <path d={d} fill={col} />
      <path d={`M${(right - 10).toFixed(0)} ${1238 + 10 * gone} L${right - 40} 1340`} stroke={stripe} strokeWidth={10} opacity={0.6} />
      <path d={`M420 ${1232 + 6 * gone} L400 1350 M540 ${bump + 10 * gone} L520 1356`} stroke={stripe} strokeWidth={12} opacity={0.55} />
    </g>
  );
};

/** Chaussure : au sol, puis frappée par le pied, vole et retombe sur le dos du héros. */
const shoeAt = (t: number) => {
  if (t < TRIP) return { x: 918, y: FRONT, r: 0 };
  if (t < SHOE_LAND) {
    const u = (t - TRIP) / (SHOE_LAND - TRIP);
    return { x: lerp(918, 1048, u), y: lerp(FRONT, 1494, u) - Math.sin(Math.PI * u) * 300, r: 640 * u };
  }
  const b = Math.exp(-(t - SHOE_LAND) * 10) * Math.abs(Math.sin((t - SHOE_LAND) * 22)) * 26;
  return { x: 1048, y: 1494 - b, r: 0 };
};

const Zzz: React.FC<{ t: number; at: { x: number; y: number } }> = ({ t, at }) => {
  const on = (t > 0.4 && t < al1a) || (t > SNOOZE + 0.4 && t < al2a);
  if (!on) return null;
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const u = ((t * 0.55 + i / 3) % 1);
        return (
          <text key={i} x={at.x + 20 + u * 70 + Math.sin(u * 6) * 8} y={at.y - 40 - u * 140} fontFamily={SANS} fontWeight={800} fontSize={30 + u * 26} fill="#f2f0ff" opacity={Math.sin(Math.PI * u) * 0.9}>
            z
          </text>
        );
      })}
    </g>
  );
};

export const Chambre: React.FC<{ t: number }> = ({ t }) => {
  const light = lightAt(t);
  const base = camAt(CAM, t);
  // coup de fouet final vers la droite
  const whip = k01(t, WHIP, 12.6, easeI);
  const cam = { ...base, x: base.x + whip * 1100 };
  const sh1 = shake(t, IMPACT, 26, 0.6, 2);
  const sh2 = shake(t, SNOOZE, 9, 0.3, 5);
  const sh = { x: sh1.x + sh2.x, y: sh1.y + sh2.y, r: sh1.r + sh2.r };
  const hero = heroAt(t);
  const j = joints(hero);
  const headW = toWorld(hero, j.head);
  const slapOn = t > 2.98 && t < 3.62;
  const slap = slapOn
    ? keyed(
        [
          { t: 2.98, p: P(LIE, { aF: [60, 50] }) },
          { t: 3.12, p: P(LIE, { aF: [174, 2], reach: 1.47 }), e: easeO },
          { t: SNOOZE + 0.02, p: P(LIE, { aF: [168, 4], reach: 1.44 }) },
          { t: 3.35, p: P(LIE, { aF: [168, 4], reach: 1.44 }) },
          { t: 3.62, p: P(LIE, { aF: [40, 30], reach: 1 }) },
        ],
        t,
      )
    : null;
  const shoe = shoeAt(t);
  const dust = t > IMPACT && t < IMPACT + 0.7 ? (t - IMPACT) / 0.7 : -1;
  const excl = t > 7.35 && t < 8.05 ? springAt(t, 7.35, 3, 6) : 0;
  const sweat = t > 7.45 && t < 8.1 ? k01(t, 7.45, 8.1) : -1;
  const darkV = 0.55 * (1 - light);
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <Defs />
      <rect width={W} height={H} fill="#1a1c28" />
      <g transform={camTransform(cam, sh)}>
        <Room t={t} light={light} />
        {/* héros couché sous la couverture, puis assis */}
        {t < JUMP + 0.05 ? <Stickman pose={hero} /> : null}
        <Blanket t={t} light={light} />
        {slap ? <Stickman pose={slap} only="armF" /> : null}
        <Zzz t={t} at={headW} />
        {t >= JUMP + 0.05 ? <Stickman pose={hero} /> : null}
        <Shoe x={shoe.x} y={shoe.y} rot={shoe.r} />
        {dust >= 0
          ? Array.from({ length: 7 }, (_, i) => (
              <circle key={i} cx={1000 + (i - 3) * 60 * (0.4 + dust)} cy={1512 - 18 * dust - (i % 2) * 14} r={14 + 26 * dust} fill={mixC("#7a6a70", "#e9dcc7", light)} opacity={0.7 * (1 - dust)} />
            ))
          : null}
        {excl > 0 ? (
          <g transform={`translate(${headW.x + 10} ${headW.y - 92}) scale(${excl})`}>
            <text x={0} y={0} fontFamily={SANS} fontWeight={800} fontSize={86} fill="#ff3b30" textAnchor="middle" stroke="#fff" strokeWidth={5} paintOrder="stroke">!</text>
          </g>
        ) : null}
        {sweat >= 0 ? (
          <path
            d={`M${headW.x - 42} ${headW.y - 30 + sweat * 40} q-9 16 0 22 q9 -6 0 -22 Z`}
            fill="#8fd3ff"
            opacity={1 - sweat * 0.6}
          />
        ) : null}
      </g>
      {/* pénombre du petit matin */}
      <rect width={W} height={H} fill="#0d1030" opacity={darkV * 0.55} />
    </svg>
  );
};
