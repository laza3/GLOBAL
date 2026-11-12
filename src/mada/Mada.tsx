import React from "react";
import { AbsoluteFill, Audio, Easing, Sequence, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";
import { P, clamp, lerp, outC, pop, prog, rand } from "./lib";
import { S, VOICE_FILE, VOICE_FROM, W } from "./timing";
import { Baobabs, Fireflies, Rays, Sky } from "./Scenery";
import { COVERS, Cover, HomeScreen, Logo, ProfileScreen, ReaderScreen, SCREEN_H, SCREEN_W, SubWord, Subtitle } from "./Ui";

// Police locale (Baloo 2 ExtraBold) : aucun accès réseau nécessaire au rendu.
const FONT = `"Baloo2Mada", sans-serif`;
const fontFace = new FontFace("Baloo2Mada", `url(${staticFile("fonts/Baloo2-800.ttf")})`, { weight: "800" });
const fontHandle = delayRender("Chargement de la police Baloo 2");
fontFace
  .load()
  .then((ff) => {
    (document.fonts as unknown as { add: (f: FontFace) => void }).add(ff);
    continueRender(fontHandle);
  })
  .catch((e) => cancelRender(e));

const PHONE = { x: 540, y: 1130, w: 540, h: 1100 };

// ——— Caméra continue ———
const CAM_T = [0, 14, 44, 104, 150, 190, 215, 280, 310, 345, 390];
const CAM_S = [1.14, 1.12, 1.0, 1.0, 1.07, 1.04, 1.18, 1.18, 1.06, 1.0, 1.04];
const CAM_FY = [1120, 1120, 1010, 1010, 1010, 1060, 820, 820, 1010, 1010, 1050];
const cam = (f: number) => {
  const o = { ...clamp, easing: Easing.inOut(Easing.cubic) };
  return { s: interpolate(f, CAM_T, CAM_S, o), fy: interpolate(f, CAM_T, CAM_FY, o) };
};

// ——— Textes ———
const w = (t: string, at: number, hl = false): SubWord => ({ t, at, hl });
const SUBS = [
  { start: 4, end: 31, size: 156, top: 300, lines: [[w("Mada", W.mada), w("ebook", W.ebook, true)]] },
  { start: 32, end: 102, size: 84, top: 300, lines: [[w("la", W.la), w("lecture", W.lecture), w("malgache", W.malgache)], [w("dans", W.dans), w("ta", W.ta), w("poche", W.poche, true)]] },
  { start: 108, end: 176, size: 104, top: 270, lines: [[w("Culture,", W.culture), w("histoire,", W.histoire)], [w("contes", W.contes), w("et", W.contes + 8), w("nature", W.nature, true)]] },
  { start: 176, end: 198, size: 92, top: 300, lines: [[w("de la", 178), w("Grande Île", 186, true)]] },
  { start: 200, end: 291, size: 96, top: 250, lines: [[w("Lis,", W.lis), w("découvre,", W.decouvre)], [w("partage,", W.partage, true)], [w("où que tu sois", W.partage + 20)]] },
  { start: 294, end: 999, size: 118, top: 260, lines: [[w("Rejoins", W.rejoins), w("la", W.la2), w("page", W.page)], [w("Mada", W.mada2), w("ebook", W.ebook2, true), w("!", W.ebook2 + 8)]] },
];

// ——— Couvertures flottantes autour du téléphone ———
const FLOATS = [
  { dx: -385, dy: -360, rot: -13, w: 200, at: W.culture },
  { dx: 395, dy: -250, rot: 11, w: 200, at: W.histoire },
  { dx: -405, dy: 150, rot: 9, w: 200, at: W.contes },
  { dx: 400, dy: 270, rot: -10, w: 200, at: W.nature },
  { dx: -330, dy: 520, rot: -7, w: 170, at: -1 },
  { dx: 340, dy: 560, rot: 8, w: 170, at: -1 },
];

const Heart: React.FC<{ s: number; fill: string }> = ({ s, fill }) => (
  <svg width={s} height={s} viewBox="-12 -12 24 24">
    <path d="M0 9 C-14 -1 -9 -12 -3 -10 C-1 -9 0 -7 0 -6 C0 -7 1 -9 3 -10 C9 -12 14 -1 0 9 Z" fill={fill} />
  </svg>
);
const Star: React.FC<{ s: number; fill: string }> = ({ s, fill }) => (
  <svg width={s} height={s} viewBox="-20 -20 40 40">
    <path d="M0 -18 L4.5 -5 L18 -4 L7 4 L11 17 L0 9 L-11 17 L-7 4 L-18 -4 L-4.5 -5 Z" fill={fill} />
  </svg>
);

const Burst: React.FC<{ f: number; at: number }> = ({ f, at }) => {
  const t = f - at;
  if (t < 0) return null;
  return (
    <>
      {Array.from({ length: 22 }).map((_, i) => {
        const a = (i / 22) * Math.PI * 2 + rand(i) * 0.4;
        const sp = 260 + rand(i + 9) * 380;
        const x = Math.cos(a) * sp * outC(Math.min(1, t / 34));
        const y = Math.sin(a) * sp * outC(Math.min(1, t / 34)) + 0.5 * 14 * t * t * 0.18;
        const o = 1 - Math.min(1, t / 44);
        const sz = 30 + rand(i + 3) * 36;
        const col = [P.gold, P.coral, P.cream, P.orange][i % 4];
        return (
          <div key={i} style={{ position: "absolute", left: x - sz / 2, top: y - sz / 2, opacity: o, transform: `rotate(${t * (i % 2 ? 9 : -9)}deg) scale(${0.4 + 0.6 * Math.min(1, t / 8)})` }}>
            {i % 3 === 0 ? <Heart s={sz} fill={col} /> : <Star s={sz} fill={col} />}
          </div>
        );
      })}
    </>
  );
};

export const Mada: React.FC = () => {
  const f = useCurrentFrame();
  const c = cam(f);

  // téléphone : montée avec rebond + inclinaison
  const rise = pop(f, S.homeIn, 13, 120, 0.9);
  const phoneY = lerp(1000, 0, rise);
  const tilt = lerp(-9, 0, rise) + Math.sin(f / 30) * 0.8;
  const sway = Math.sin(f / 36) * 6;
  const readerOn = prog(f, S.reader - 6, S.reader + 4);
  const profileOn = prog(f, S.profile - 6, S.profile + 6);
  const scroll = interpolate(f, [S.explode + 20, S.reader - 10], [0, 110], { ...clamp, easing: Easing.inOut(Easing.cubic) });

  // flottantes : sortie du téléphone, puis retour avant la lecture
  const floatsOut = (i: number) => pop(f, S.explode + i * 4, 11, 110, 0.9);
  const floatsIn = prog(f, S.reader - 22, S.reader - 4);

  return (
    <AbsoluteFill style={{ background: P.night, overflow: "hidden" }}>
      {VOICE_FILE ? (
        <Sequence from={VOICE_FROM} layout="none">
          <Audio src={staticFile(VOICE_FILE)} volume={1} />
        </Sequence>
      ) : null}

      {/* ——— Monde (caméra) ——— */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1920,
          transformOrigin: "0 0",
          transform: `translate(${540 - 540 * c.s}px, ${960 - c.fy * c.s}px) scale(${c.s})`,
        }}
      >
        <Sky f={f} />
        <Rays f={f} opacity={prog(f, 10, 60)} />
        <Baobabs f={f} />
        <Fireflies f={f} />

        {/* téléphone + contenus */}
        <div style={{ position: "absolute", left: PHONE.x, top: PHONE.y, width: 0, height: 0 }}>
          {/* couvertures flottantes (derrière le téléphone) */}
          {FLOATS.map((fl, i) => {
            const s = floatsOut(i);
            const bob = Math.sin(f / 16 + i * 1.4) * 14;
            const hit = fl.at > 0 ? Math.max(0, 1 - Math.abs(f - (fl.at + 6)) / 10) : 0;
            const out = 1 - floatsIn;
            const sc = (0.2 + 0.8 * s) * (1 + 0.16 * hit) * (0.3 + 0.7 * out);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: lerp(0, fl.dx, s * out) - fl.w / 2,
                  top: lerp(0, fl.dy, s * out) + bob * s - (fl.w * 1.42) / 2,
                  opacity: Math.min(1, s * 1.5) * out,
                  transform: `rotate(${fl.rot * s + hit * 4 * Math.sin(f)}deg) scale(${sc})`,
                  filter: hit > 0 ? `drop-shadow(0 0 ${40 * hit}px rgba(255,214,120,${hit}))` : undefined,
                }}
              >
                <Cover spec={COVERS[i]} w={fl.w} font={FONT} />
              </div>
            );
          })}

          {/* téléphone */}
          <div
            style={{
              position: "absolute",
              left: -PHONE.w / 2,
              top: -PHONE.h / 2 + phoneY,
              width: PHONE.w,
              height: PHONE.h,
              transform: `perspective(2200px) rotateY(${sway + tilt * 0.6}deg) rotateX(${tilt * 0.3}deg) rotateZ(${tilt * 0.5}deg)`,
              transformOrigin: "50% 50%",
            }}
          >
            <div style={{ position: "absolute", inset: 0, borderRadius: 76, background: "#161022", boxShadow: "0 50px 90px rgba(20,5,30,0.55), inset 0 0 0 3px #3a2c52" }} />
            <div style={{ position: "absolute", left: 18, top: 18, width: SCREEN_W, height: SCREEN_H, borderRadius: 60, overflow: "hidden", background: P.cream }}>
              <HomeScreen f={f} font={FONT} coversAt={S.coversIn} scroll={scroll} />
              <div style={{ position: "absolute", inset: 0, opacity: readerOn, transform: `translateY(${(1 - readerOn) * 40}px)`, display: readerOn <= 0 ? "none" : "block" }}>
                <ReaderScreen f={f} font={FONT} start={S.reader} />
              </div>
              <div style={{ position: "absolute", inset: 0, opacity: profileOn, transform: `scale(${1.06 - 0.06 * profileOn})`, display: profileOn <= 0 ? "none" : "block" }}>
                <ProfileScreen f={f} font={FONT} start={S.profile} tapAt={S.tap} />
              </div>
              {/* encoche */}
              <div style={{ position: "absolute", left: SCREEN_W / 2 - 62, top: 16, width: 124, height: 34, borderRadius: 20, background: "#0e0a16", zIndex: 20 }} />
            </div>
            {/* reflet */}
            <div style={{ position: "absolute", left: 18, top: 18, width: SCREEN_W, height: SCREEN_H, borderRadius: 60, background: "linear-gradient(115deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 30%)", pointerEvents: "none" }} />

            {/* doigt qui appuie sur « Suivre » */}
            {f >= S.profile + 30 && f < S.tap + 22 ? (() => {
              const m = prog(f, S.profile + 30, S.tap, Easing.inOut(Easing.cubic));
              const fx = lerp(PHONE.w / 2 + 120, PHONE.w / 2 + 110, m);
              const fy = lerp(PHONE.h - 160, 18 + 712 + 20, m);
              const press = f >= S.tap ? 1 - prog(f, S.tap, S.tap + 14) : 0;
              const o = prog(f, S.profile + 30, S.profile + 42) * (1 - prog(f, S.tap + 8, S.tap + 22));
              return (
                <div style={{ position: "absolute", left: fx - 44, top: fy - 44, width: 88, height: 88, borderRadius: 44, background: "rgba(255,246,232,0.55)", border: "5px solid rgba(255,255,255,0.9)", opacity: o, transform: `scale(${0.82 + 0.18 * (1 - press) + 0.1 * (f < S.tap ? m : 0)})`, boxShadow: "0 10px 24px rgba(20,5,30,0.35)", zIndex: 30 }} />
              );
            })() : null}

            {/* confettis depuis le bouton */}
            <div style={{ position: "absolute", left: PHONE.w / 2 + 20, top: 18 + 712, width: 0, height: 0, zIndex: 40 }}>
              <Burst f={f} at={S.tap + 4} />
            </div>
          </div>
        </div>
      </div>

      {/* ——— Premier plan : sous-titres ——— */}
      {SUBS.map((s, i) => (
        <Subtitle key={i} f={f} lines={s.lines} start={s.start} end={s.end} size={s.size} font={FONT} top={s.top} />
      ))}

      {/* badge logo final */}
      {f >= S.tap + 8 ? (() => {
        const s = pop(f, S.tap + 8, 10, 160, 0.7);
        return (
          <div style={{ position: "absolute", left: 735, top: 1470, transform: `scale(${s}) rotate(${(1 - s) * -30}deg)`, filter: "drop-shadow(0 14px 22px rgba(20,5,30,0.45))" }}>
            <Logo size={170} ring />
          </div>
        );
      })() : null}

      {/* vignette douce */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(20,5,30,0.38) 100%)", pointerEvents: "none" }} />
      {/* fondu d'ouverture */}
      <AbsoluteFill style={{ background: P.night, opacity: 1 - prog(f, 0, 8), pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
