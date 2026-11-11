import React from "react";
import { Stickman } from "../Stickman";
import { P, Pose, STAND, reachTo, toWorld, walkPose } from "../rig";
import { Umbrella } from "../props";
import { City, Defs, GROUND, Mood, Planter, Sky, cityPal } from "../decor/City";
import { Clouds, Puddle } from "../decor/Weather";
import { CYC, CamKey, H, W, camAt, camTransform, easeIO, evr, k01 } from "../util";

const [w0] = evr("walk6");
const [c0, c1] = evr("crane");
const SPEED = 250;

const heroAt = (t: number): Pose => {
  const x = (t - w0) * SPEED;
  const base = P(STAND, { y: GROUND, dir: 1, face: { eye: 0.85, open: 0, brow: -0.1, mouth: 0.75, turn: 0.75, look: 1, lookY: -0.1 } });
  const p = walkPose(P(base, { x }), (t - w0) / CYC.walk6, 0.85, -0.2);
  // regard vers le ciel pendant la montée de caméra
  const up = k01(t, 66.0, 67.5) * (1 - 0.6 * k01(t, 74.0, 76.0));
  return { ...p, neck: p.neck - 14 * up, face: { ...p.face, lookY: -0.1 - 0.7 * up } };
};

const heroX = (t: number) => (t - w0) * SPEED;

const CAM = (t: number) => {
  const keys: CamKey[] = [
    { t: w0, c: { x: 40, y: 1210, s: 1.3 } },
    { t: c0, c: { x: 0, y: 1220, s: 1.22 } },
    { t: c1, c: { x: 0, y: 780, s: 0.74 }, e: easeIO },
    { t: 80, c: { x: 0, y: 730, s: 0.7 } },
  ];
  const c = camAt(keys, t);
  return { ...c, x: c.x + heroX(t) + 70 };
};

/** Oiseaux en coordonnées écran. */
const Birds: React.FC<{ t: number }> = ({ t }) => (
  <g>
    {[0, 1, 2, 3].map((i) => {
      const u = ((t - 58 + i * 2.7) * 0.07) % 1.2;
      const x = -100 + u * 1400;
      const y = 380 + i * 60 + Math.sin(t * 0.8 + i) * 20;
      const f = Math.sin(t * 9 + i * 2) * 10;
      const s = 0.8 + 0.25 * (i % 2);
      return <path key={i} transform={`translate(${x} ${y}) scale(${s})`} d={`M-22 ${f} Q-11 ${-6 + f * 0.3} 0 4 Q11 ${-6 + f * 0.3} 22 ${f}`} stroke="#4a2d2a" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.75} />;
    })}
  </g>
);

export const Final: React.FC<{ t: number }> = ({ t }) => {
  const mood: Mood = { rain: 0, gold: 1 };
  const p = cityPal(mood);
  const cam = CAM(t);
  const vis: [number, number] = [cam.x - 600 / cam.s - 300, cam.x + 600 / cam.s + 300];
  let hero = heroAt(t);
  const handle = toWorld(hero, { x: 40, y: -118 });
  hero = reachTo(hero, "aF", handle);
  const sunY = 300 + (cam.y - 1210) * 0.25;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <Defs />
      <Sky mood={mood} sun={{ x: 760, y: sunY + 420, r: 70, o: 1 }} />
      <Clouds t={t} dark={0} offX={-cam.x * 0.05} offY={(1210 - cam.y) * 0.6} o={0.5} color="#f7b48a" />
      <Birds t={t} />
      <g transform={camTransform(cam)}>
        <City variant="quai" mood={mood} camX={cam.x} camY={cam.y} t={t} vis={vis} lampsOn={0.35} />
        {[-200, 700, 1500, 2600, 3400, 4300, 5200].filter((x) => x > vis[0] && x < vis[1]).map((x) => (
          <Puddle key={x} x={x} y={1560 + (x % 3) * 20} w={140} t={t} rain={0} tint="#f2a65a" glow={0.8} />
        ))}
        {/* ombre portée longue (soleil rasant) */}
        <ellipse cx={hero.x - 60} cy={GROUND + 6} rx={110} ry={10} fill="#7a4a2a" opacity={0.25} />
        <Stickman pose={hero} />
        <g transform={`translate(${handle.x.toFixed(1)} ${handle.y.toFixed(1)}) rotate(-22)`}>
          <Umbrella open={1} shaft={150} />
        </g>
        <g transform={`translate(${(-(cam.x - heroX(t)) * 0.3 - heroX(t) * 0.3).toFixed(1)} 0)`}>
          {[600, 1900, 3200, 4500, 5800].map((x) => <Planter key={x} x={x} y={1800} p={p} s={1.35} />)}
        </g>
      </g>
      {/* lumière dorée */}
      <rect width={W} height={H} fill="#ff9e4f" opacity={0.12} style={{ mixBlendMode: "soft-light" }} />
    </svg>
  );
};
