import React from "react";
import { Fedora, Stickman } from "../Stickman";
import { P, P2, Pose, STAND, joints, keyed, mixPose, reachTo, runPose, toWorld, walkPose } from "../rig";
import { Bus, ORANGE, Orange, Umbrella } from "../props";
import { BusSign, City, Defs, GROUND, Mood, Planter, Shelter, Sky, cityPal } from "../decor/City";
import { Puddle, Rain, Splashes, StormCover, SunBeams } from "../decor/Weather";
import { CYC, CamKey, H, W, camAt, camTransform, easeIO, easeO, ev, evr, k01, lerp, rnd } from "../util";

const T0 = 24.6;
const BUS_DOORS = ev("busDoors");
const BUS_GO = ev("busDepart");
const [r0, r1] = evr("run3");
const STOP = ev("heroStop");
const SLUMP_T = ev("slump");
const [wb0, wb1] = evr("walkBench");
const SIT_T = ev("sit");
const [ow0, ow1] = evr("oldWalk");
const RIP = ev("rip");
const ARRIVE = ev("orangeArrive");
const LOOK_T = ev("heroLook");
const STAND_T = ev("heroStand");
const [wa0, wa1] = evr("walkAway");
const HALT = ev("heroHalt");
const LOOKBACK = ev("lookBack");
const TURN = ev("turn");
const [wk0, wk1] = evr("walkBack");
const KNEEL_T = ev("kneel");
const STANDUP = ev("standUp");
const OFFER = ev("offer");
const TAKE = ev("take");
const SMILE = ev("oldSmile");
const [rs0, rs1] = evr("rainStop");
const SUN = ev("sunBurst");
const HSMILE = ev("heroSmile");
const WAVE = ev("wave");

const SHELTER_X = 1060;
const BENCH_X = 1230;
const SIGN_X = 1585;
const X_STOP = 1760;
const X_AWAY = 860;
const X_KNEEL = 1300;
const OLD_X = 1660;
const BAG: P2 = { x: 1545, y: 1418 };

// ——— Visages ———
const F = {
  rush: { eye: 1.15, open: 0.4, brow: -0.6, mouth: -0.3, turn: 0.9, look: 1, lookY: 0 },
  reach: { eye: 1.35, open: 0.8, brow: -1, mouth: -0.4, turn: 0.85, look: 1, lookY: -0.2 },
  sad: { eye: 0.55, open: 0, brow: -1, mouth: -0.85, turn: 0.55, look: 0.3, lookY: 0.8 },
  low: { eye: 0.3, open: 0, brow: -1, mouth: -0.9, turn: 0.4, look: 0, lookY: 1 },
  notice: { eye: 1.05, open: 0, brow: -0.2, mouth: -0.3, turn: 0.6, look: 0.4, lookY: 0.95 },
  watch: { eye: 1.05, open: 0, brow: -0.5, mouth: -0.25, turn: 0.75, look: 1, lookY: 0.1 },
  away: { eye: 0.75, open: 0, brow: -0.4, mouth: -0.35, turn: 0.8, look: 0.6, lookY: 0.5 },
  halt: { eye: 1.15, open: 0.1, brow: -0.7, mouth: -0.3, turn: 0.6, look: 0, lookY: 0 },
  back: { eye: 1.1, open: 0, brow: -0.6, mouth: -0.2, turn: -0.9, look: -1, lookY: 0.1 },
  resolve: { eye: 1, open: 0, brow: 0.25, mouth: 0.35, turn: 0.9, look: 1, lookY: 0.2 },
  focus: { eye: 0.9, open: 0, brow: 0.1, mouth: 0.4, turn: 0.8, look: 0.6, lookY: 1 },
  surprised: { eye: 1.3, open: 0.35, brow: -0.3, mouth: 0.2, turn: 0.7, look: 1, lookY: -0.2 },
  touched: { eye: 0.85, open: 0.1, brow: -0.4, mouth: 0.85, turn: 0.6, look: 1, lookY: 0 },
  joy: { eye: 0.9, open: 0.45, brow: -0.2, mouth: 1, turn: 0.35, look: 0.2, lookY: -0.9 },
};
const OF = {
  calm: { eye: 0.8, open: 0, brow: -0.2, mouth: 0.15, turn: 0.75, look: 1, lookY: 0.1 },
  oops: { eye: 1.35, open: 0.6, brow: -0.9, mouth: -0.4, turn: 0.7, look: 0.5, lookY: 1 },
  pain: { eye: 0.4, open: 0.15, brow: -1, mouth: -0.6, turn: 0.6, look: 0.4, lookY: 1 },
  thanks: { eye: 0.55, open: 0, brow: -0.3, mouth: 0.8, turn: 0.6, look: 1, lookY: 0.2 },
  smile: { eye: 0.4, open: 0.25, brow: -0.2, mouth: 1, turn: 0.55, look: 1, lookY: 0 },
  up: { eye: 0.6, open: 0.2, brow: -0.2, mouth: 0.9, turn: 0.35, look: 0, lookY: -0.9 },
};

const HB = P(STAND, { y: GROUND, dir: 1 });
const SIT_HEAD = P(HB, { x: BENCH_X, hip: 92, lean: 40, neck: 32, lF: [86, 92], lB: [80, 86], aF: [40, 138], aB: [34, 128], face: F.low });
const SIT_LOOK = P(HB, { x: BENCH_X, hip: 92, lean: 12, neck: 8, lF: [86, 92], lB: [80, 86], aF: [52, 30], aB: [46, 34], face: F.notice });
const SIT_WATCH = P(SIT_LOOK, { lean: 8, neck: -2, face: F.watch });
const REACH = P(HB, { x: X_STOP, lean: 12, neck: -6, lF: [24, 6], lB: [-20, 14], aF: [118, 4], aB: [-40, 30], face: F.reach });
const DROP = P(HB, { x: X_STOP, lean: 20, neck: 30, aF: [4, 6], aB: [2, 6], face: F.sad });
const STANDH = (x: number, dir: number, face = F.watch) => P(HB, { x, dir, face });
const KNEEL = P(HB, { x: X_KNEEL, hip: null, lean: 48, neck: 10, lF: [70, 140], lB: [62, 140], aF: [40, 40], aB: [26, 70], reach: 1.08, face: F.focus });

// ——— Oranges ———
const N_OR = 5;
const OR_FINAL = [1345, 1395, 1440, 1480, 1515];
const OR_R = 17;
const GY = GROUND - OR_R - 2;
const ripPoint = { x: OLD_X - 40, y: 1360 };
const pickT = (k: number) => 48.5 + k * 0.5; // début du geste du héros
const tossLand = (k: number) => pickT(k) + 0.62;

const orangeGround = (k: number, t: number): { x: number; y: number; spin: number } => {
  const u = t - RIP - 0.03 * k;
  if (u <= 0) return { x: ripPoint.x + (k - 2) * 8, y: ripPoint.y, spin: 0 };
  const g = 2600;
  const vx = -60 - 30 * k;
  const h = GY - ripPoint.y;
  const t1 = Math.sqrt((2 * h) / g);
  const v2 = 0.32 * g * t1;
  const t2 = (2 * v2) / g;
  const xLand = ripPoint.x + (k - 2) * 8 + vx * (t1 + t2);
  if (u < t1) return { x: ripPoint.x + (k - 2) * 8 + vx * u, y: ripPoint.y + 0.5 * g * u * u, spin: -u * 200 };
  if (u < t1 + t2) {
    const w = u - t1;
    return { x: ripPoint.x + (k - 2) * 8 + vx * u, y: GY - (v2 * w - 0.5 * g * w * w), spin: -u * 200 };
  }
  const rollDur = k === 0 ? ARRIVE - (RIP + t1 + t2) : 0.5 + 0.12 * k;
  const w = Math.min(1, (u - t1 - t2) / rollDur);
  const x = lerp(xLand, OR_FINAL[k], easeO(w));
  return { x, y: GY, spin: ((x - xLand) / OR_R) * 57.3 };
};

// ——— Héros ———
const heroBase = (t: number): Pose => {
  if (t < STOP) {
    const x = lerp(470, X_STOP, (t - r0) / (r1 - r0));
    const run = runPose(P(HB, { x, face: F.rush }), (t - r0) / CYC.run3, 1);
    return t > STOP - 0.18 ? mixPose(run, REACH, (t - (STOP - 0.18)) / 0.18) : run;
  }
  if (t < wb0) {
    return keyed(
      [
        { t: STOP, p: REACH },
        { t: 27.0, p: P(REACH, { aF: [104, 10] }) },
        { t: SLUMP_T, p: DROP },
        { t: 27.85, p: DROP },
        { t: wb0, p: P(DROP, { dir: -1 }) },
      ],
      t,
    );
  }
  if (t < SIT_T) {
    const u = (t - wb0) / (wb1 - wb0);
    const w = walkPose(P(HB, { x: lerp(X_STOP, BENCH_X + 60, u), dir: -1, face: F.sad }), (t - wb0) / CYC.walkBench, 0.85, 1);
    return t > wb1 ? mixPose(w, P(HB, { x: BENCH_X + 40, dir: 1, face: F.sad, lean: 14, neck: 24 }), (t - wb1) / (SIT_T - wb1)) : w;
  }
  if (t < STAND_T) {
    const breathe = Math.sin(t * 2.2) * 1.5;
    const p = keyed(
      [
        { t: SIT_T, p: P(HB, { x: BENCH_X + 40, dir: 1, face: F.sad, lean: 14, neck: 24 }) },
        { t: 29.85, p: SIT_HEAD, e: easeO },
        { t: LOOK_T, p: SIT_HEAD },
        { t: LOOK_T + 0.35, p: SIT_LOOK },
        { t: 40.95, p: SIT_LOOK },
        { t: 41.3, p: SIT_WATCH },
        { t: 42.4, p: SIT_WATCH },
        { t: 42.7, p: P(SIT_WATCH, { face: { ...F.watch, look: 0.2, lookY: 0.6, brow: -0.8 } }) },
        { t: STAND_T, p: P(SIT_WATCH, { face: { ...F.watch, look: 0.2, lookY: 0.6, brow: -0.8 } }) },
      ],
      t,
    );
    return { ...p, lean: p.lean + breathe };
  }
  if (t < wa0) {
    return keyed(
      [
        { t: STAND_T, p: SIT_WATCH },
        { t: 43.38, p: STANDH(BENCH_X + 20, 1, F.away) },
        { t: wa0, p: STANDH(BENCH_X + 20, -1, F.away) },
      ],
      t,
    );
  }
  if (t < HALT) {
    const u = (t - wa0) / (wa1 - wa0);
    return walkPose(P(HB, { x: lerp(BENCH_X + 20, X_AWAY, u), dir: -1, face: F.away }), (t - wa0) / CYC.walkAway, 0.72, 0.4);
  }
  if (t < wk0) {
    return keyed(
      [
        { t: HALT, p: STANDH(X_AWAY, -1, F.halt) },
        { t: LOOKBACK, p: STANDH(X_AWAY, -1, F.halt) },
        { t: LOOKBACK + 0.25, p: P(STANDH(X_AWAY, -1, F.back), { neck: -4, lean: -2 }) },
        { t: TURN, p: P(STANDH(X_AWAY, -1, F.back), { neck: -4, lean: -2 }) },
        { t: TURN + 0.25, p: STANDH(X_AWAY, 1, F.resolve) },
        { t: wk0, p: STANDH(X_AWAY, 1, F.resolve) },
      ],
      t,
    );
  }
  if (t < KNEEL_T) {
    const u = (t - wk0) / (wk1 - wk0);
    const w = walkPose(P(HB, { x: lerp(X_AWAY, X_KNEEL, u), dir: 1, face: F.resolve }), (t - wk0) / CYC.walkBack, 1);
    return t > wk1 ? mixPose(w, KNEEL, (t - wk1) / (KNEEL_T - wk1)) : w;
  }
  if (t < STANDUP) {
    const x = t < 49.15 ? X_KNEEL : t < 49.4 ? lerp(X_KNEEL, 1340, easeIO((t - 49.15) / 0.25)) : t < 50.15 ? 1340 : lerp(1340, 1368, easeIO(Math.min(1, (t - 50.15) / 0.25)));
    return P(KNEEL, { x });
  }
  const UP = STANDH(1440, 1, F.surprised);
  return keyed(
    [
      { t: STANDUP, p: P(KNEEL, { x: 1368 }) },
      { t: 51.6, p: P(UP, { x: 1420, face: F.focus }) },
      { t: 51.75, p: P(UP, { face: F.focus }) },
      { t: 52.6, p: P(UP, { face: { ...F.resolve, lookY: -0.2 } }) },
      { t: 53.6, p: UP },
      { t: 54.5, p: P(UP, { face: F.touched }) },
      { t: 56.0, p: P(UP, { face: F.touched }) },
      { t: 56.9, p: P(UP, { neck: -18, face: { ...F.touched, lookY: -1, look: 0.2 } }) },
      { t: HSMILE, p: P(UP, { neck: -26, lean: -4, face: F.joy }) },
      { t: 58.4, p: P(UP, { neck: -10, face: { ...F.joy, lookY: -0.2, look: 1, turn: 0.6 } }) },
    ],
    t,
  );
};

/** Main avant du héros : cueillette des oranges, puis prise du parapluie. */
const heroHandTarget = (t: number, p: Pose): P2 | null => {
  if (t >= pickT(0) - 0.05 && t < STANDUP) {
    for (let k = N_OR - 1; k >= 0; k--) {
      const s = pickT(k);
      if (t >= s) {
        const o = orangeGround(k, s);
        const chest = toWorld(p, { x: 46, y: -86 });
        if (t < s + 0.2) return { x: lerp(chest.x, o.x, easeIO((t - s) / 0.2)), y: lerp(chest.y, o.y - 6, easeIO((t - s) / 0.2)) };
        if (t < s + 0.34) return { x: lerp(o.x, chest.x + 20, easeO((t - s - 0.2) / 0.14)), y: lerp(o.y - 6, chest.y - 10, easeO((t - s - 0.2) / 0.14)) };
        return { x: chest.x + 20, y: chest.y - 10 };
      }
    }
    return null;
  }
  return null;
};

// ——— Parapluie ———
const umbrellaHeld = (t: number) => t >= TAKE; // tenu par le héros

// ——— Vieil homme ———
const OB = P(STAND, { y: GROUND, dir: -1, lean: 13, neck: -4, face: OF.calm });
const OLD_STAND = P(OB, { x: OLD_X });
const OLD_OOPS = P(OB, { x: OLD_X, lean: 22, neck: 26, face: OF.oops });
const OLD_BEND = P(OB, { x: OLD_X, lean: 56, neck: 6, lF: [30, 40], lB: [8, 34], face: OF.pain });
const OLD_KNEEL = P(OB, { x: OLD_X + 20, hip: null, lean: 26, neck: 4, lF: [62, 120], lB: [52, 116], face: OF.thanks });

const oldBase = (t: number): Pose => {
  if (t < ow0) return P(OB, { x: 2300 });
  if (t < ow1) {
    const u = (t - ow0) / (ow1 - ow0);
    const w = walkPose(P(OB, { x: lerp(2180, OLD_X, u) }), (t - ow0) / CYC.oldWalk, 0.55);
    return { ...w, lean: OB.lean + 2 };
  }
  if (t < 58.85) {
    return keyed(
      [
        { t: ow1, p: OLD_STAND },
        { t: RIP + 0.05, p: OLD_STAND },
        { t: RIP + 0.25, p: OLD_OOPS, e: easeO },
        { t: 38.8, p: OLD_OOPS },
        { t: 40.0, p: OLD_BEND },
        { t: 41.0, p: P(OLD_BEND, { lean: 60, neck: 2 }) },
        { t: 42.2, p: P(OLD_BEND, { lean: 50, neck: 10 }) },
        { t: 44.5, p: P(OLD_BEND, { lean: 58 }) },
        { t: 47.5, p: P(OLD_BEND, { lean: 52, face: { ...OF.pain, lookY: 0.2, look: 1, eye: 0.8 } }) },
        { t: KNEEL_T + 0.1, p: OLD_KNEEL },
        { t: STANDUP, p: OLD_KNEEL },
        { t: 51.8, p: P(OLD_STAND, { face: OF.thanks }) },
        { t: SMILE, p: P(OLD_STAND, { face: OF.smile }) },
        { t: 56.0, p: P(OLD_STAND, { face: OF.smile }) },
        { t: 57.0, p: P(OLD_STAND, { neck: -20, face: OF.up }) },
        { t: 58.3, p: P(OLD_STAND, { face: OF.smile }) },
      ],
      t,
    );
  }
  const u = Math.max(0, t - 59.1);
  const turn = keyed([{ t: 58.85, p: P(OLD_STAND, { face: OF.smile }) }, { t: 59.1, p: P(OLD_STAND, { dir: 1, face: OF.smile }) }], t);
  return t < 59.1 ? turn : walkPose(P(OB, { x: OLD_X + u * 230, dir: 1, face: OF.smile }), u / CYC.oldWalk, 0.55);
};

/** Points tenus par le vieil homme (monde). */
const oldTargets = (t: number, p: Pose) => {
  const head = toWorld(p, joints(p).head);
  // parapluie : main arrière (au-dessus de la tête) jusqu'au relèvement, puis main avant
  let umb: P2 | null = { x: head.x + 18 * -p.dir, y: head.y + 70 };
  let bag: P2 | null = toWorld(p, { x: 40, y: -82 });
  if (t > RIP && t < KNEEL_T) bag = toWorld(p, { x: 34, y: -40 });
  if (t >= KNEEL_T - 0.1 && t < STANDUP + 0.1) {
    bag = BAG;
    umb = { x: 1585, y: 1272 };
  }
  if (t >= STANDUP + 0.1) {
    bag = toWorld(p, { x: 36, y: -36 });
    const own = { x: head.x + 14 * -p.dir, y: head.y + 64 };
    const give = { x: 1530, y: 1206 };
    umb = t < OFFER ? own : t < TAKE ? { x: lerp(own.x, give.x, easeIO((t - OFFER) / (TAKE - OFFER))), y: lerp(own.y, give.y, easeIO((t - OFFER) / (TAKE - OFFER))) } : null;
  }
  return { umb, bag };
};

const CAM: CamKey[] = [
  { t: T0, c: { x: 1250, y: 1062, s: 0.8 } },
  { t: STOP, c: { x: 1640, y: 1098, s: 0.98 } },
  { t: 27.6, c: { x: 1800, y: 1115, s: 1.04 } },
  { t: wb0, c: { x: 1680, y: 1125, s: 1.04 } },
  { t: 29.7, c: { x: 1300, y: 1180, s: 1.25 } },
  { t: 35.5, c: { x: 1285, y: 1235, s: 1.78 } },
  { t: 36.7, c: { x: 1470, y: 1125, s: 1.0 } },
  { t: 39.6, c: { x: 1460, y: 1141, s: 1.05 } },
  { t: 40.6, c: { x: 1350, y: 1205, s: 1.32 } },
  { t: 42.7, c: { x: 1400, y: 1179, s: 1.18 } },
  { t: 44.2, c: { x: 1230, y: 1124, s: 0.92 } },
  { t: HALT, c: { x: 1160, y: 1120, s: 0.96 } },
  { t: 46.3, c: { x: 1010, y: 1139, s: 1.3 } },
  { t: wk0, c: { x: 1020, y: 1142, s: 1.28 } },
  { t: 48.25, c: { x: 1420, y: 1184, s: 1.18 } },
  { t: 48.9, c: { x: 1475, y: 1269, s: 1.45 } },
  { t: 51.1, c: { x: 1490, y: 1259, s: 1.45 } },
  { t: 51.9, c: { x: 1530, y: 1164, s: 1.45 } },
  { t: 53.4, c: { x: 1525, y: 1142, s: 1.72 } },
  { t: 55.2, c: { x: 1525, y: 1137, s: 1.72 } },
  { t: 56.4, c: { x: 1525, y: 1106, s: 1.5 } },
  { t: 58.4, c: { x: 1540, y: 990, s: 0.95 } },
  { t: 60.0, c: { x: 1600, y: 985, s: 0.92 } },
];

export const Arret: React.FC<{ t: number }> = ({ t }) => {
  const stop = k01(t, rs0, rs1);
  const sunK = k01(t, SUN - 0.2, SUN + 1.3);
  const mood: Mood = { rain: 1 - stop, gold: 0.5 * sunK };
  const p = cityPal(mood);
  let cam = camAt(CAM, t);
  const inW = 1 - k01(t, T0, T0 + 0.4, easeO);
  cam = { ...cam, x: cam.x - inW * 1100 };
  const vis: [number, number] = [cam.x - 600 / cam.s - 200, cam.x + 600 / cam.s + 200];

  // héros
  let hero = heroBase(t);
  const tgt = heroHandTarget(t, hero);
  if (tgt) hero = reachTo(hero, "aF", tgt);
  const old = oldBase(t);
  const ot = oldTargets(t, old);
  let oldP = old;
  if (ot.umb) oldP = reachTo(oldP, t >= STANDUP + 0.1 ? "aF" : "aB", ot.umb);
  if (ot.bag) oldP = reachTo(oldP, t >= STANDUP + 0.1 ? "aB" : "aF", ot.bag);
  // salut du chapeau puis au revoir
  if (t > 54.7 && t < 55.5) {
    const hat = toWorld(oldP, { x: joints(oldP).head.x + 20, y: joints(oldP).head.y - 26 });
    oldP = reachTo(oldP, "aB", hat, Math.sin(Math.PI * k01(t, 54.7, 55.5)));
  }
  if (t > WAVE && t < 59.1) {
    const k = Math.sin(Math.PI * Math.min(1, (t - WAVE) / 0.6));
    oldP = { ...oldP, aB: [lerp(oldP.aB[0], 150, k), lerp(oldP.aB[1], 30 + 25 * Math.sin(t * 16), k)] };
  }
  // parapluie : main du héros après la prise
  let heroUmb: P2 | null = null;
  if (umbrellaHeld(t)) {
    const take = { x: 1530, y: 1206 };
    const up = { x: 1492, y: 1192 };
    heroUmb = t < TAKE + 0.5 ? { x: lerp(take.x, up.x, easeIO((t - TAKE) / 0.5)), y: lerp(take.y, up.y, easeIO((t - TAKE) / 0.5)) } : up;
    hero = reachTo(hero, "aF", heroUmb);
  } else if (t > OFFER + 0.35 && t < TAKE) {
    hero = reachTo(hero, "aF", { x: 1530, y: 1206 }, k01(t, OFFER + 0.35, TAKE));
  }
  if (t > WAVE + 0.2) {
    const k = Math.sin(Math.PI * Math.min(1, (t - WAVE - 0.2) / 0.9));
    hero = { ...hero, aB: [lerp(hero.aB[0], -150, k), lerp(hero.aB[1], -30 - 25 * Math.sin(t * 15), k)] };
  }
  const umbPos = heroUmb ?? ot.umb;
  const umbOpen = 1;

  // bus
  const busX = t < BUS_GO ? 1600 : 1600 + 0.5 * 760 * (t - BUS_GO) ** 2;
  const busV = t < BUS_GO ? 0 : 760 * (t - BUS_GO);
  const doors = 1 - k01(t, BUS_DOORS, BUS_DOORS + 0.3);

  // oranges
  const oranges: React.ReactNode[] = [];
  let inBag = 0;
  if (t >= RIP) {
    for (let k = 0; k < N_OR; k++) {
      const s = pickT(k);
      if (t < s + 0.2) {
        const o = orangeGround(k, Math.min(t, s));
        oranges.push(<Orange key={k} x={o.x} y={o.y} spin={o.spin} />);
      } else if (t < s + 0.34) {
        const h = toWorld(hero, joints(hero).handF);
        oranges.push(<Orange key={k} x={h.x} y={h.y - 4} />);
      } else if (t < tossLand(k)) {
        const u = (t - s - 0.34) / (tossLand(k) - s - 0.34);
        const from = toWorld(hero, joints(hero).handF);
        oranges.push(<Orange key={k} x={lerp(from.x, BAG.x, u)} y={lerp(from.y, BAG.y - 30, u) - Math.sin(Math.PI * u) * 90} spin={u * 400} r={OR_R * (1 - 0.15 * u)} />);
      } else inBag++;
    }
  }
  const bagWorld = ot.bag;
  const bagBounce = Array.from({ length: N_OR }, (_, k) => Math.max(0, 1 - Math.abs(t - tossLand(k)) / 0.12)).reduce((a, b) => Math.max(a, b), 0);
  const torn = t > RIP;
  const bagFull = t < RIP ? 1 : t > STANDUP ? 1 : inBag / N_OR;
  const rimH = mood.rain > 0.3 ? `rgba(230,238,250,${0.2 * mood.rain})` : undefined;
  const sunScreen = { x: 860, y: 260 };
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <Defs />
      <Sky mood={mood} sun={{ ...sunScreen, r: 60, o: sunK }} />
      <StormCover k={1 - 0.0 * stop} t={t} open={k01(t, SUN - 0.4, SUN + 1.6)} />
      <SunBeams k={sunK * (1 - 0.3 * k01(t, 58.5, 60))} x={sunScreen.x} y={sunScreen.y} t={t} />
      <g transform={camTransform(cam)}>
        <City variant="arret" mood={mood} camX={cam.x} camY={cam.y} t={t} vis={vis} lit={0.8 * (1 - sunK * 0.6)} lampsOn={0.5 * (1 - sunK)}>
          {busX < 3600 ? <g transform={`translate(${busX} 1394) scale(0.92) translate(${-busX} -1394)`}><Bus x={busX} y={1394} t={t} doors={doors} v={busV} /></g> : null}
        </City>
        <Shelter x={SHELTER_X} p={p} wet={mood.rain} />
        <BusSign x={SIGN_X} p={p} />
        <Puddle x={720} y={1560} w={150} t={t} rain={mood.rain} tint={p.road} glow={0.5 * sunK} />
        <Puddle x={1900} y={1585} w={170} t={t} rain={mood.rain} tint={p.road} glow={0.5 * sunK} />
        <Puddle x={1390} y={1620} w={80} t={t} rain={mood.rain} tint={p.road} glow={0.5 * sunK} />
        {/* traînée d'eau du bus */}
        {t > BUS_GO && t < 28.5 ? (
          <g opacity={1 - k01(t, 27.3, 28.5)}>
            {Array.from({ length: 10 }, (_, i) => <circle key={i} cx={busX + 60 - i * 30 - rnd(i) * 20} cy={1380 - rnd(i + 3) * 30} r={6 + rnd(i + 7) * 8} fill="#dfe9f4" opacity={0.5} />)}
          </g>
        ) : null}
        <Stickman pose={oldP} hat={<Fedora />} mustache rim={rimH} />
        {bagWorld ? (
          <g transform={`translate(${bagWorld.x} ${bagWorld.y + 6 * bagBounce})`}>
            <path d={`M-30 -40 L30 -40 L34 ${36 - (torn && bagFull < 1 ? 8 : 0)} L14 ${torn && t < KNEEL_T ? 48 : 40} L0 ${torn && t < KNEEL_T ? 30 : 40} L-14 ${torn && t < KNEEL_T ? 50 : 40} L-34 36 Z`} fill="#c8a165" />
            <rect x={-30} y={-40} width={60} height={10} fill="#b38b52" />
            {bagFull > 0.05 ? (
              <g>
                <circle cx={-12} cy={-44} r={15} fill={ORANGE} opacity={Math.min(1, bagFull * 3)} />
                <circle cx={12} cy={-46} r={16} fill={ORANGE} opacity={Math.min(1, bagFull * 1.6)} />
                <path d="M18 -62 q6 -14 14 -9" stroke="#3f7d20" strokeWidth={4} fill="none" strokeLinecap="round" opacity={bagFull} />
              </g>
            ) : null}
          </g>
        ) : null}
        {oranges}
        <Stickman pose={hero} rim={rimH} />
        {umbPos ? (
          <g transform={`translate(${umbPos.x} ${umbPos.y})`}>
            <Umbrella open={umbOpen} />
          </g>
        ) : null}
        <Splashes t={t} k={mood.rain} x0={vis[0]} x1={vis[1]} y0={1440} y1={1660} n={50} />
        <g transform={`translate(${(-(cam.x - 1400) * 0.3).toFixed(1)} 0)`}>
          <Planter x={560} y={1800} p={p} s={1.35} />
          <Planter x={2240} y={1810} p={p} s={1.4} />
        </g>
      </g>
      <Rain t={t} k={mood.rain} />
      <rect width={W} height={H} fill="#1b2433" opacity={0.18 * mood.rain} />
      <rect width={W} height={H} fill="#ffb347" opacity={0.08 * sunK} style={{ mixBlendMode: "soft-light" }} />
    </svg>
  );
};
