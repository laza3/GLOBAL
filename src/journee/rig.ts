// Squelette du stickman : cinématique directe, poses, interpolation et cycles.
// Repère local « tourné vers la droite » : origine à la hanche, y vers le bas,
// angles en degrés mesurés depuis la verticale descendante, positifs vers l'avant.
import { Easing } from "remotion";

export type Face = {
  eye: number; // ouverture des yeux 0 → 1 (>1 = écarquillés)
  look: number; // regard horizontal -1 (arrière) → 1 (avant)
  lookY: number; // regard vertical -1 (haut) → 1 (bas)
  brow: number; // -1 inquiet/triste → 0 neutre → 1 fâché
  mouth: number; // -1 moue → 1 sourire
  open: number; // bouche ouverte 0 → 1
  turn: number; // orientation du visage : 1 profil avant, 0 face, -1 regarde derrière
};

export type Pose = {
  x: number; // position monde du point au sol sous la hanche
  y: number; // niveau du sol (monde)
  dir: number; // 1 regarde à droite, -1 à gauche (valeurs intermédiaires = demi-tour)
  rot: number; // rotation de tout le corps autour de la hanche (chute, couché)
  hip: number | null; // hauteur de la hanche au-dessus du sol ; null = pieds au sol
  lean: number; // inclinaison du buste
  neck: number; // inclinaison de la tête
  aF: [number, number]; // bras avant : épaule (relative au buste), coude
  aB: [number, number]; // bras arrière
  lF: [number, number]; // jambe avant : hanche, genou (flexion)
  lB: [number, number]; // jambe arrière
  sq: number; // squash & stretch vertical (1 = neutre)
  reach: number; // étirement des bras (1 = neutre)
  face: Face;
};

export const L = { thigh: 80, shin: 78, torso: 118, neck: 12, head: 36, upper: 62, fore: 60, shoulder: 10 };

export const FACE0: Face = { eye: 1, look: 0.3, lookY: 0, brow: 0, mouth: 0.2, open: 0, turn: 0.75 };

export const STAND: Pose = {
  x: 0, y: 0, dir: 1, rot: 0, hip: null, lean: 2, neck: 0,
  aF: [8, 12], aB: [-6, 10], lF: [4, 2], lB: [-4, 2], sq: 1, reach: 1, face: FACE0,
};

const R = Math.PI / 180;
const sin = (d: number) => Math.sin(d * R);
const cos = (d: number) => Math.cos(d * R);

export type P2 = { x: number; y: number };
export type Joints = {
  hip: P2; neck: P2; shoulder: P2; head: P2; headAng: number;
  elbowF: P2; handF: P2; foreF: number; elbowB: P2; handB: P2; foreB: number;
  kneeF: P2; footF: P2; kneeB: P2; footB: P2;
};

const limb = (o: P2, a1: number, l1: number, a2: number, l2: number) => {
  const m = { x: o.x + l1 * sin(a1), y: o.y + l1 * cos(a1) };
  const e = { x: m.x + l2 * sin(a2), y: m.y + l2 * cos(a2) };
  return [m, e] as const;
};

/** Articulations dans le repère local (hanche = origine). */
export const joints = (p: Pose): Joints => {
  const hip = { x: 0, y: 0 };
  const neck = { x: L.torso * sin(p.lean), y: -L.torso * cos(p.lean) };
  const shoulder = { x: neck.x - L.shoulder * sin(p.lean), y: neck.y + L.shoulder * cos(p.lean) };
  const headAng = p.lean + p.neck;
  const hd = L.neck + L.head;
  const head = { x: neck.x + hd * sin(headAng), y: neck.y - hd * cos(headAng) };
  const down = -p.lean;
  const [elbowF, handF] = limb(shoulder, down + p.aF[0], L.upper * p.reach, down + p.aF[0] + p.aF[1], L.fore * p.reach);
  const [elbowB, handB] = limb(shoulder, down + p.aB[0], L.upper * p.reach, down + p.aB[0] + p.aB[1], L.fore * p.reach);
  const [kneeF, footF] = limb(hip, p.lF[0], L.thigh, p.lF[0] - p.lF[1], L.shin);
  const [kneeB, footB] = limb(hip, p.lB[0], L.thigh, p.lB[0] - p.lB[1], L.shin);
  return {
    hip, neck, shoulder, head, headAng,
    elbowF, handF, foreF: down + p.aF[0] + p.aF[1], elbowB, handB, foreB: down + p.aB[0] + p.aB[1],
    kneeF, footF, kneeB, footB,
  };
};

/** Hauteur de hanche effective (pieds posés au sol si hip = null). */
export const hipHeight = (p: Pose, j = joints(p)) =>
  p.hip ?? Math.max(j.footF.y, j.footB.y) + 7;

/** Racine (hanche) en coordonnées monde. */
export const root = (p: Pose) => ({ x: p.x, y: p.y - hipHeight(p) * p.sq });

/** Point local → monde (même transformation que le rendu SVG). */
export const toWorld = (p: Pose, q: P2): P2 => {
  const r = root(p);
  const sx = q.x * p.dir;
  const sy = q.y * p.sq;
  return { x: r.x + sx * cos(p.rot) - sy * sin(p.rot), y: r.y + sx * sin(p.rot) + sy * cos(p.rot) };
};

// ——— Interpolation ———
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

export const mixFace = (a: Face, b: Face, t: number): Face => ({
  eye: lerp(a.eye, b.eye, t), look: lerp(a.look, b.look, t), lookY: lerp(a.lookY, b.lookY, t),
  brow: lerp(a.brow, b.brow, t), mouth: lerp(a.mouth, b.mouth, t), open: lerp(a.open, b.open, t),
  turn: lerp(a.turn, b.turn, t),
});

export const mixPose = (a: Pose, b: Pose, t: number): Pose => {
  const ha = a.hip ?? hipHeight(a);
  const hb = b.hip ?? hipHeight(b);
  const bothAuto = a.hip === null && b.hip === null;
  return {
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), dir: lerp(a.dir, b.dir, t), rot: lerp(a.rot, b.rot, t),
    hip: bothAuto ? null : lerp(ha, hb, t), lean: lerp(a.lean, b.lean, t), neck: lerp(a.neck, b.neck, t),
    aF: lerp2(a.aF, b.aF, t), aB: lerp2(a.aB, b.aB, t), lF: lerp2(a.lF, b.lF, t), lB: lerp2(a.lB, b.lB, t),
    sq: lerp(a.sq, b.sq, t), reach: lerp(a.reach, b.reach, t), face: mixFace(a.face, b.face, t),
  };
};

export type PartialPose = Partial<Omit<Pose, "face">> & { face?: Partial<Face> };

export const P = (base: Pose, o: PartialPose = {}): Pose => ({
  ...base, ...o, face: { ...base.face, ...(o.face ?? {}) },
});

export type Key = { t: number; p: Pose; e?: (x: number) => number };

const EASE = Easing.inOut(Easing.cubic);

/** Pose à l'instant t (secondes) d'après des clés triées. */
export const keyed = (keys: Key[], t: number): Pose => {
  if (t <= keys[0].t) return keys[0].p;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return mixPose(a.p, b.p, (b.e ?? EASE)(u));
    }
  }
  return keys[keys.length - 1].p;
};

// ——— Cycles ———
const TAU = Math.PI * 2;

/** Marche : phase p (0 → 1 par double pas). Contacts talon à p = 0,25 et 0,75. */
export const walkPose = (base: Pose, p: number, amp = 1, mood = 0): Pose => {
  const s = Math.sin(TAU * p);
  const s2 = Math.sin(TAU * (p + 0.5));
  const knee = (q: number) => 6 + 42 * Math.max(0, Math.cos(TAU * q)) ** 2;
  return {
    ...base,
    lean: base.lean + 3 * amp + mood * 10,
    neck: base.neck + mood * 12,
    lF: [28 * amp * s, knee(p) * amp],
    lB: [28 * amp * s2, knee(p + 0.5) * amp],
    aF: [-22 * amp * s * (1 - 0.5 * Math.abs(mood)), 18 + 8 * Math.max(0, -s)],
    aB: [-22 * amp * s2 * (1 - 0.5 * Math.abs(mood)), 18 + 8 * Math.max(0, -s2)],
    hip: null,
  };
};

/** Course : phase p (0 → 1 par double foulée). */
export const runPose = (base: Pose, p: number, amp = 1): Pose => {
  const s = Math.sin(TAU * p);
  const s2 = Math.sin(TAU * (p + 0.5));
  const knee = (q: number) => 18 + 85 * Math.max(0, Math.cos(TAU * q)) ** 1.4;
  const flight = 10 * amp * Math.abs(Math.sin(TAU * 2 * p + 0.6));
  const auto = { ...base, lF: [46 * amp * s, knee(p) * amp] as [number, number], lB: [46 * amp * s2, knee(p + 0.5) * amp] as [number, number], hip: null };
  return {
    ...auto,
    lean: base.lean + 14 * amp,
    hip: hipHeight(auto) + flight,
    aF: [-58 * amp * s, 82],
    aB: [-58 * amp * s2, 82],
  };
};

/** Monde → repère local du personnage (inverse de toWorld). */
export const toLocal = (p: Pose, q: P2): P2 => {
  const r = root(p);
  const dx = q.x - r.x;
  const dy = q.y - r.y;
  const c = cos(-p.rot);
  const s = sin(-p.rot);
  const ux = dx * c - dy * s;
  const uy = dx * s + dy * c;
  const d = Math.abs(p.dir) < 1e-3 ? 1e-3 : p.dir;
  return { x: ux / d, y: uy / p.sq };
};

/** Cinématique inverse d'un bras : renvoie [épaule, coude] pour atteindre la cible (monde). */
export const ikArm = (p: Pose, target: P2): [number, number] => {
  const j = joints(p);
  const q = toLocal(p, target);
  const l1 = L.upper * p.reach;
  const l2 = L.fore * p.reach;
  const dx = q.x - j.shoulder.x;
  const dy = q.y - j.shoulder.y;
  const dist = Math.max(Math.abs(l1 - l2) + 1, Math.min(l1 + l2 - 0.5, Math.hypot(dx, dy)));
  const th = Math.atan2(dx, dy) / R;
  const al = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))) / R;
  const a1 = th - al;
  const ex = j.shoulder.x + l1 * sin(a1);
  const ey = j.shoulder.y + l1 * cos(a1);
  const a2 = Math.atan2(q.x - ex, q.y - ey) / R;
  let e = a2 - a1;
  while (e > 180) e -= 360;
  while (e < -180) e += 360;
  return [a1 + p.lean, e];
};

/** Pose avec un bras placé par IK (aF ou aB). */
export const reachTo = (p: Pose, arm: "aF" | "aB", target: P2 | null, k = 1): Pose => {
  if (!target || k <= 0) return p;
  const a = ikArm(p, target);
  return { ...p, [arm]: [p[arm][0] + (a[0] - p[arm][0]) * k, p[arm][1] + (a[1] - p[arm][1]) * k] };
};
