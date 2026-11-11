import React from "react";
import { Stickman } from "../Stickman";
import { P, Pose, STAND, joints, keyed, mixPose, runPose, toWorld, walkPose } from "../rig";
import { Car, Cup } from "../props";
import { City, Defs, GROUND, Mood, PedLight, Planter, Sky, cityPal } from "../decor/City";
import { Clouds, Puddle, Rain, Splashes, StormCover } from "../decor/Weather";
import { CYC, CamKey, H, W, backO, camAt, camTransform, easeI, easeO, ev, evr, k01, lerp, mixC, shake, springAt } from "../util";

const T0 = 12.6;
const [r0, r1] = evr("runA");
const SKID = ev("skid");
const [j0, j1] = evr("jog");
const GREEN = ev("green");
const [d0, d1] = evr("dash");
const BONK = ev("bonk");
const SPLASH = ev("splash");
const CUPLAND = ev("cupLand");
const [dk0, dk1] = evr("darken");
const THUNDER = ev("thunder");
const RAIN0 = ev("rainStart");
const LOOKUP = ev("lookUp");
const DESPAIR = ev("despair");
const WHIP = ev("whip2");

const X_RUN0 = -110;
const X_SKID = 1150;
const X_WAIT = 1255;
const X_HIT = 1627;
const LAMP_X = 1720;

const HURRY = { eye: 1.1, open: 0.25, brow: 0.6, mouth: -0.4, turn: 0.9, look: 1, lookY: 0 };
const base = P(STAND, { y: GROUND, dir: 1, face: HURRY });

// bras avant qui tient le gobelet bien droit pendant la course
const holdCup = (p: Pose): Pose => ({ ...p, aF: [62, 72] });

const heroAt = (t: number): Pose => {
  if (t < SKID) {
    const u = (t - r0) / (r1 - r0);
    const x = lerp(X_RUN0, X_SKID, u);
    let p = holdCup(runPose(P(base, { x }), (t - r0) / CYC.runA, 1));
    // coup d'œil à la montre
    const w = k01(t, 13.75, 13.95) * (1 - k01(t, 14.35, 14.55));
    if (w > 0) p = { ...p, aB: [lerp(p.aB[0], 78, w), lerp(p.aB[1], 112, w)], neck: lerp(p.neck, 22, w), face: { ...p.face, lookY: 0.9 * w, look: 0.6, brow: 0.8 } };
    return p;
  }
  const BRAKE = P(base, { x: X_WAIT, lean: -16, neck: -6, lF: [38, 0], lB: [-22, 18], aF: [60, 72], aB: [-70, 30], face: { eye: 1.3, open: 0.5, brow: -0.6, mouth: -0.5, look: 1 } });
  if (t < j0) {
    return keyed([{ t: SKID, p: holdCup(runPose(P(base, { x: X_SKID }), (SKID - r0) / CYC.runA)) }, { t: j0, p: BRAKE, e: easeO }], t);
  }
  const WAIT_FACE = { eye: 1, open: 0, brow: 0.9, mouth: -0.7, turn: 0.75, look: 1, lookY: -0.7 };
  if (t < GREEN) {
    const jog = walkPose(P(base, { x: X_WAIT, face: WAIT_FACE }), (t - j0) / CYC.jog, 0.32);
    const p = { ...jog, aF: [62, 72] as [number, number], aB: [-10 + 6 * Math.sin(t * 20), 40] as [number, number], neck: -10 };
    return t < j0 + 0.15 ? mixPose(BRAKE, p, (t - j0) / 0.15) : p;
  }
  const CROUCH = P(base, { x: X_WAIT, lean: 30, lF: [30, 60], lB: [-14, 50], aF: [62, 72], aB: [-60, 30], face: { ...HURRY, brow: 1, mouth: -0.2 } });
  if (t < d0) return keyed([{ t: GREEN, p: P(base, { x: X_WAIT, face: WAIT_FACE }) }, { t: d0, p: CROUCH }], t);
  if (t < BONK) {
    const u = (t - d0) / (d1 - d0);
    const p = holdCup(runPose(P(base, { x: lerp(X_WAIT, X_HIT, easeI(u) * 0.4 + u * 0.6), face: { ...HURRY, look: -0.4, lookY: 0.9 } }), (t - d0) / CYC.dash, 1.2));
    // il regarde sa montre en fonçant…
    return { ...p, aB: [78, 112], neck: 18 };
  }
  const HIT = P(base, { x: X_HIT, lean: -10, neck: -14, sq: 0.86, lF: [10, 4], lB: [-8, 6], aF: [100, 10], aB: [70, 20], face: { eye: 0.15, open: 0.6, brow: -1, mouth: -0.5, turn: 0.6 } });
  const DAZED = P(base, { x: 1585, lean: -4, neck: -6, lF: [14, 8], lB: [-12, 10], aF: [30, 30], aB: [-26, 30], face: { eye: 0.7, open: 0.2, brow: -0.8, mouth: -0.4, turn: 0.4, look: 0 } });
  const LOOKDOWN = P(DAZED, { lean: 8, neck: 34, aF: [52, 36], aB: [40, 40], face: { eye: 0.9, open: 0.15, brow: -1, mouth: -0.9, turn: 0.55, lookY: 1, look: 0 } });
  const FLINCH = P(LOOKDOWN, { sq: 0.93, neck: 10, aF: [90, 70], aB: [80, 80], face: { eye: 1.4, open: 0.5, brow: -1, mouth: -0.6, lookY: -0.5 } });
  const DRIP = P(base, { x: 1585, lean: 10, neck: 18, aF: [12, 10], aB: [8, 10], lF: [6, 4], lB: [-6, 4], face: { eye: 0.75, open: 0, brow: -1, mouth: -0.8, turn: 0.4, look: 0, lookY: 0.4 } });
  const UP = P(DRIP, { lean: -6, neck: -34, face: { eye: 1, open: 0.1, brow: -1, mouth: -0.7, turn: 0.2, lookY: -1, look: 0.2 } });
  const WHY = P(base, { x: 1585, lean: -6, neck: -30, lF: [14, 22], lB: [-16, 24], aF: [138, 6], aB: [-132, -8], face: { eye: 1.2, open: 0.75, brow: -1, mouth: -0.8, turn: 0.05, lookY: -1, look: 0 } });
  const SLUMP = P(DRIP, { lean: 18, neck: 32, aF: [6, 8], aB: [2, 8] });
  if (t < BONK + 0.3) {
    const s = springAt(t, BONK, 6, 9);
    return { ...mixPose(HIT, DAZED, Math.min(1, (t - BONK) / 0.3)), sq: 1 - 0.14 * (1 - s), x: lerp(X_HIT, 1585, easeO(Math.min(1, (t - BONK) / 0.3))) };
  }
  const wob = t < 17.4 ? Math.sin(t * 16) * 5 * (1 - k01(t, BONK, 17.4)) : 0;
  const p = keyed(
    [
      { t: BONK + 0.3, p: DAZED },
      { t: 17.35, p: DAZED },
      { t: 17.65, p: LOOKDOWN },
      { t: THUNDER, p: LOOKDOWN },
      { t: THUNDER + 0.08, p: FLINCH, e: easeO },
      { t: 18.5, p: P(LOOKDOWN, { neck: -10, face: { lookY: -1 } }) },
      { t: 19.4, p: DRIP },
      { t: LOOKUP, p: DRIP },
      { t: 20.9, p: UP },
      { t: DESPAIR - 0.1, p: UP },
      { t: DESPAIR + 0.35, p: WHY, e: backO },
      { t: 23.2, p: P(WHY, { aF: [128, 10], aB: [-124, -10] }) },
      { t: 23.8, p: SLUMP },
    ],
    t,
  );
  return { ...p, rot: p.rot + wob };
};

const CAM: CamKey[] = [
  { t: T0, c: { x: 60, y: 1300, s: 1.2 } },
  { t: SKID, c: { x: 1180, y: 1290, s: 1.25 }, e: (x) => x },
  { t: 15.4, c: { x: 1310, y: 1215, s: 1.36 } },
  { t: GREEN, c: { x: 1320, y: 1222, s: 1.42 } },
  { t: BONK, c: { x: 1560, y: 1268, s: 1.36 }, e: easeO },
  { t: 17.25, c: { x: 1600, y: 1272, s: 1.58 } },
  { t: THUNDER, c: { x: 1600, y: 1250, s: 1.46 } },
  { t: 19.6, c: { x: 1592, y: 1228, s: 1.3 } },
  { t: DESPAIR, c: { x: 1590, y: 1190, s: 1.2 } },
  { t: 23.7, c: { x: 1590, y: 905, s: 0.72 }, e: easeIO2 },
  { t: 24.6, c: { x: 1590, y: 880, s: 0.7 } },
];
function easeIO2(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Gobelet : dans la main, puis éjecté au choc. */
const cupAt = (t: number, hand: { x: number; y: number }) => {
  if (t < BONK) return null;
  const u = Math.min(1, (t - BONK) / (CUPLAND - BONK));
  const x = lerp(X_HIT + 70, 1470, u);
  const y = lerp(1300, GROUND - 6, u) - Math.sin(Math.PI * u) * 260;
  const r = 900 * u;
  if (t > CUPLAND) {
    const b = Math.exp(-(t - CUPLAND) * 8) * Math.abs(Math.sin((t - CUPLAND) * 20)) * 30;
    return { x: 1470, y: GROUND - 6 - b, r: 90 };
  }
  void hand;
  return { x, y, r };
};

export const Rue: React.FC<{ t: number }> = ({ t }) => {
  const rainK = k01(t, RAIN0, RAIN0 + 1.2);
  const dark = k01(t, dk0, dk1 + 0.4);
  const mood: Mood = { rain: Math.max(dark * 0.85, rainK), gold: 0 };
  const p = cityPal(mood);
  let cam = camAt(CAM, t);
  // arrivée en coup de fouet depuis la chambre, départ en coup de fouet vers l'arrêt de bus
  const inW = 1 - k01(t, T0, T0 + 0.38, easeO);
  const outW = k01(t, WHIP, 24.6, easeI);
  cam = { ...cam, x: cam.x - inW * 1000 + outW * 1300 };
  const sh1 = shake(t, BONK, 30, 0.5, 3);
  const sh2 = shake(t, THUNDER, 14, 0.7, 7);
  const sh = { x: sh1.x + sh2.x, y: sh1.y + sh2.y, r: sh1.r + sh2.r };
  const hero = heroAt(t);
  const j = joints(hero);
  const head = toWorld(hero, j.head);
  const chest = toWorld(hero, { x: j.neck.x * 0.6, y: j.neck.y * 0.6 });
  const holding = t < BONK;
  const cup = cupAt(t, toWorld(hero, j.handF));
  const vis: [number, number] = [cam.x - 600 / cam.s - 200, cam.x + 600 / cam.s + 200];
  const green = t >= GREEN;
  // giclée de café : de la main vers la tête/poitrine
  const sp = t > SPLASH - 0.05 && t < SPLASH + 0.9 ? (t - (SPLASH - 0.05)) / 0.95 : -1;
  const stars = t > BONK + 0.05 && t < 17.45;
  const flash = Math.max(0, 1 - Math.abs(t - THUNDER - 0.03) / 0.06) * 0.6 + Math.max(0, 1 - Math.abs(t - THUNDER - 0.22) / 0.05) * 0.35;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <Defs />
      <Sky mood={mood} />
      <Clouds t={t} dark={dark} offX={-cam.x * 0.1} o={1 - dark * 0.6} color={mixC("#ffffff", "#7b8599", dark)} />
      <StormCover k={dark} t={t} />
      <g transform={camTransform(cam, sh)}>
        <City variant="rue" mood={mood} camX={cam.x} camY={cam.y} t={t} vis={vis} lit={rainK} lampsOn={rainK * 0.6}>
          <Car x={lerp(-900, 2400, k01(t, 12.7, 14.4, (x) => x))} y={1384} color={mixC("#e63946", "#8b4a50", mood.rain)} t={t} scale={0.9} />
          <Car x={lerp(2900, -400, k01(t, 15.0, 16.3, (x) => x))} y={1360} color={mixC("#457b9d", "#3f5766", mood.rain)} dir={-1} t={t} scale={0.85} />
        </City>
        <PedLight x={1292} y={1455} green={green} p={p} />
        <Puddle x={1880} y={1540} w={130} t={t} rain={rainK} tint={p.road} />
        <Puddle x={1300} y={1585} w={90} t={t} rain={rainK} tint={p.road} />
        {cup && t > CUPLAND - 0.02 ? <g transform={`translate(${cup.x} ${cup.y}) rotate(${cup.r})`}><Cup full={false} /></g> : null}
        <Stickman pose={hero} handF={holding ? <Cup tilt={-hero.lean + hero.aF[0] + hero.aF[1]} /> : undefined} rim={mood.rain > 0.3 ? `rgba(230,238,250,${0.18 * mood.rain})` : undefined} />
        {cup && t <= CUPLAND - 0.02 ? <g transform={`translate(${cup.x} ${cup.y}) rotate(${cup.r})`}><Cup full={false} /></g> : null}
        {sp >= 0 ? (
          <g>
            {/* jet de café */}
            {sp < 0.35
              ? Array.from({ length: 9 }, (_, i) => {
                  const u = sp / 0.35;
                  const x = lerp(X_HIT + 80, head.x - 10 + (i - 4) * 9, u);
                  const y = lerp(1330, head.y + 10 + (i % 3) * 18, u) - Math.sin(Math.PI * u) * (90 + i * 6);
                  return <circle key={i} cx={x} cy={y} r={11 - i * 0.6} fill="#7b4a26" />;
                })
              : null}
            {/* éclaboussure + gouttes qui coulent */}
            {sp >= 0.3
              ? Array.from({ length: 10 }, (_, i) => {
                  const u = (sp - 0.3) / 0.7;
                  const ox = (i - 4.5) * 16;
                  const tgt = i < 5 ? head : chest;
                  return <ellipse key={i} cx={tgt.x + ox * (0.6 + 0.4 * u)} cy={tgt.y + (i % 3) * 14 + u * (60 + i * 12)} rx={7} ry={9 + 6 * u} fill="#8a5a33" opacity={1 - u} />;
                })
              : null}
          </g>
        ) : null}
        {stars
          ? Array.from({ length: 4 }, (_, i) => {
              const a = t * 7 + (i * Math.PI) / 2;
              return (
                <path
                  key={i}
                  transform={`translate(${head.x + Math.cos(a) * 62} ${head.y - 52 + Math.sin(a) * 16}) scale(${0.9 + 0.2 * Math.sin(a)})`}
                  d="M0 -14 L4 -4 L14 -4 L6 3 L9 13 L0 7 L-9 13 L-6 3 L-14 -4 L-4 -4 Z"
                  fill="#ffd166"
                  stroke="#fff"
                  strokeWidth={2}
                />
              );
            })
          : null}
        {/* gouttes qui ruissellent du personnage sous la pluie */}
        {rainK > 0.3
          ? Array.from({ length: 4 }, (_, i) => {
              const u = ((t * 1.6 + i * 0.27) % 1);
              return <circle key={i} cx={head.x + (i - 1.5) * 22} cy={head.y + 30 + u * 140} r={3.2} fill="#e3eefa" opacity={(1 - u) * 0.8} />;
            })
          : null}
        <Splashes t={t} k={rainK} x0={vis[0]} x1={vis[1]} y0={1430} y1={1640} n={46} />
        {/* premier plan (parallaxe accentuée) */}
        <g transform={`translate(${(-cam.x * 0.28).toFixed(1)} 0)`}>
          <Planter x={700} y={1790} p={p} s={1.35} />
          <Planter x={2180} y={1800} p={p} s={1.4} />
        </g>
      </g>
      <Rain t={t} k={rainK} />
      <rect width={W} height={H} fill="#1b2433" opacity={0.18 * mood.rain} />
      {flash > 0 ? <rect width={W} height={H} fill="#f4f7ff" opacity={flash} /> : null}
    </svg>
  );
};
