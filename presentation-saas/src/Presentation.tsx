import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ACCENT, C, Mark, Wordmark, clamp01, prog } from "./brand";
import { FPS, SCENES, TOTAL_FRAMES, type Scene, type Shot } from "./scenes";
import { VOICE } from "./voice-data";

const Fonts: React.FC = () => (
  <style>{`
@font-face{font-family:'Outfit';src:url('${staticFile("fonts/Outfit-Bold.ttf")}');font-weight:700}
@font-face{font-family:'Outfit';src:url('${staticFile("fonts/Outfit-Regular.ttf")}');font-weight:400}
@font-face{font-family:'GeistMono';src:url('${staticFile("fonts/GeistMono-Regular.ttf")}');font-weight:400}`}</style>
);

const Background: React.FC = () => {
  const f = useCurrentFrame();
  const dx = Math.sin(f / 170) * 60, dy = Math.cos(f / 210) * 40;
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(1000px 760px at ${300 + dx}px ${-40 + dy}px, rgba(70,88,232,.40), transparent 70%), radial-gradient(1100px 820px at ${1650 - dx}px ${1140 - dy}px, rgba(255,124,77,.24), transparent 70%)` }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(30deg, rgba(159,176,255,.055) 0 1px, transparent 1px 84px), repeating-linear-gradient(-30deg, rgba(159,176,255,.055) 0 1px, transparent 1px 84px)" }} />
    </AbsoluteFill>
  );
};

const ShotCard: React.FC<{ shot: Shot; frame: number; total: number }> = ({ shot, frame, total }) => {
  const d = shot.delay ?? 0;
  const p = prog(frame, 8 + d, 28);
  const aspect = shot.phone ? 390 / 844 : 1.6;
  const w = shot.w, h = w / aspect;
  const zoom = 1 + ((shot.zoom ?? 1.05) - 1) * clamp01(frame / total);
  const [fx, fy] = shot.focus ?? [50, 50];
  const float = Math.sin((frame + d * 7) / 48) * 5;
  const radius = shot.phone ? 38 : 18;
  return (
    <div style={{ position: "absolute", left: shot.x, top: shot.y + (1 - p) * 70 + float, width: w, height: h, opacity: p, transform: `perspective(2400px) rotateY(${(shot.rotY ?? 0) * (0.4 + 0.6 * p)}deg) rotateX(${shot.phone ? 0 : 2}deg)`, transformOrigin: "left center", borderRadius: radius, overflow: "hidden", background: "#fff", boxShadow: "0 60px 110px rgba(0,0,0,.58), 0 0 0 1.5px rgba(255,255,255,.18)", border: shot.phone ? "9px solid #0B1020" : undefined }}>
      <Img src={staticFile(`shots/${shot.src}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", transform: `scale(${zoom})`, transformOrigin: `${fx}% ${fy}%` }} />
    </div>
  );
};

const Reveal: React.FC<{ frame: number; at: number; children: React.ReactNode; style?: React.CSSProperties; from?: number }> = ({ frame, at, children, style, from = 26 }) => {
  const p = prog(frame, at, 22);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * from}px)`, ...style }}>{children}</div>;
};

const Dot: React.FC<{ color: string; size?: number }> = ({ color, size = 12 }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, boxShadow: `0 0 18px ${color}`, marginRight: 14, flex: "none" }} />
);

const SceneText: React.FC<{ scene: Scene; frame: number }> = ({ scene, frame }) => {
  const col = ACCENT[scene.accent];
  const size = scene.title.length > 20 ? 58 : scene.title.length > 13 ? 70 : 88;
  return (
    <div style={{ position: "absolute", left: 120, top: 160, width: 560, display: "flex", flexDirection: "column", gap: 0 }}>
      <Reveal frame={frame} at={2} style={{ fontFamily: "GeistMono", fontSize: 21, letterSpacing: "0.3em", color: col, marginBottom: 20 }}>{scene.tag}</Reveal>
      <Reveal frame={frame} at={5} style={{ fontFamily: "Outfit", fontWeight: 700, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.03em", color: "#fff" }}>{scene.title}</Reveal>
      <Reveal frame={frame} at={13} style={{ fontFamily: "Outfit", fontSize: 33, lineHeight: 1.25, color: "rgba(230,235,250,.86)", marginTop: 22 }}>{scene.sub}</Reveal>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 30 }}>
        {scene.paths.map((p, i) => (
          <Reveal key={p} frame={frame} at={22 + i * 8}>
            <div style={{ display: "flex", alignItems: "center", fontFamily: "GeistMono", fontSize: 21, color: "#fff", padding: "10px 18px", borderRadius: 999, border: `1.5px solid ${col}88`, background: "rgba(255,255,255,.05)" }}><Dot color={col} size={9} />{p}</div>
          </Reveal>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 38, alignItems: "flex-start" }}>
        {scene.callouts.map((c) => (
          <Reveal key={c.text} frame={frame} at={c.delay} from={18}>
            <div style={{ display: "flex", alignItems: "center", fontFamily: "Outfit", fontSize: 30, color: "#fff", padding: "13px 26px 13px 22px", borderRadius: 16, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.14)" }}>
              <Dot color={ACCENT[c.accent ?? scene.accent]} />{c.text}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
};

const Captions: React.FC<{ text: string; start: number; frames: number; frame: number }> = ({ text, start, frames, frame }) => {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const total = parts.reduce((a, s) => a + s.length, 0);
  let acc = 0;
  const slots = parts.map((s) => { const a = start + (acc / total) * frames; acc += s.length; return { s, a, b: start + (acc / total) * frames }; });
  const cur = slots.find((x) => frame >= x.a - 3 && frame < x.b + 6);
  if (!cur) return null;
  const o = clamp01((frame - (cur.a - 3)) / 8) * clamp01((cur.b + 6 - frame) / 8);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 62, display: "flex", justifyContent: "center", opacity: o }}>
      <div style={{ maxWidth: 1560, textAlign: "center", fontFamily: "Outfit", fontSize: 35, lineHeight: 1.28, color: "#fff", padding: "14px 34px", borderRadius: 18, background: "rgba(7,11,26,.66)", boxShadow: "0 10px 40px rgba(0,0,0,.35)" }}>{cur.s}</div>
    </div>
  );
};

const ModuleScene: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {scene.shots.map((s) => <ShotCard key={s.src} shot={s} frame={frame} total={scene.frames} />)}
      <SceneText scene={scene} frame={frame} />
      <Captions text={scene.caption} start={scene.lead} frames={Math.round(VOICE[scene.id].seconds * FPS)} frame={frame} />
    </AbsoluteFill>
  );
};

const IntroScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const faces = prog(f, 4, 26), lift = prog(f, 26, 24), orbit = prog(f, 14, 40);
  const bg: Shot[] = [{ src: "overview", x: 80, y: 90, w: 700 }, { src: "calendrier", x: 1180, y: 520, w: 720 }, { src: "plat-dashboard", x: 1280, y: 40, w: 560 }];
  return (
    <AbsoluteFill>
      {bg.map((s, i) => <div key={s.src} style={{ opacity: 0.16 * prog(f, 6 + i * 8, 40) }}><ShotCard shot={{ ...s, rotY: i % 2 ? 8 : -8, delay: i * 6 }} frame={f} total={scene.frames} /></div>)}
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, display: "flex", justifyContent: "center", transform: `scale(${0.94 + 0.06 * faces})`, opacity: faces }}><Mark size={430} faces={faces} lift={lift} orbit={orbit} id="in" /></div>
      <Reveal frame={f} at={34} style={{ position: "absolute", left: 0, right: 0, top: 530, textAlign: "center", fontFamily: "Outfit", fontWeight: 700, fontSize: 138, letterSpacing: "-0.035em", color: "#fff" }} from={40}>Hotel Manager Pro</Reveal>
      <Reveal frame={f} at={46} style={{ position: "absolute", left: 0, right: 0, top: 716, textAlign: "center", fontFamily: "GeistMono", fontSize: 28, letterSpacing: "0.45em", color: C.em1 }}>PAR SAAS LAB MADAGASCAR</Reveal>
      <Captions text={scene.caption} start={scene.lead} frames={Math.round(VOICE[scene.id].seconds * FPS)} frame={f} />
    </AbsoluteFill>
  );
};

const OutroScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const f = useCurrentFrame();
  const faces = prog(f, 2, 24), lift = prog(f, 14, 22), orbit = prog(f, 8, 30);
  const mods = ["Réservations", "Calendrier", "Réception", "Facturation", "Restaurant", "Housekeeping", "Rapports"];
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, display: "flex", justifyContent: "center", opacity: faces }}><Mark size={250} faces={faces} lift={lift} orbit={orbit} id="out" /></div>
      <Reveal frame={f} at={20} style={{ position: "absolute", left: 0, right: 0, top: 330, textAlign: "center", fontFamily: "Outfit", fontWeight: 700, fontSize: 118, letterSpacing: "-0.03em", color: "#fff" }} from={36}>{scene.title}</Reveal>
      <Reveal frame={f} at={32} style={{ position: "absolute", left: 0, right: 0, top: 480, textAlign: "center", fontFamily: "Outfit", fontSize: 44, color: "rgba(230,235,250,.85)" }}>{scene.sub}</Reveal>
      <Reveal frame={f} at={46} style={{ position: "absolute", left: 0, right: 0, top: 580, display: "flex", justifyContent: "center" }}>
        <div style={{ fontFamily: "Outfit", fontWeight: 700, fontSize: 44, color: "#fff", padding: "22px 54px", borderRadius: 22, background: `linear-gradient(120deg, ${C.ind1}, ${C.em2} 60%, ${C.lat2})`, boxShadow: "0 24px 70px rgba(86,104,240,.45)" }}>Contactez SaaS Lab Madagascar</div>
      </Reveal>
      <Reveal frame={f} at={60} style={{ position: "absolute", left: 120, right: 120, top: 740, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12 }}>
        {mods.map((m) => <div key={m} style={{ fontFamily: "GeistMono", fontSize: 21, color: C.mute, padding: "8px 16px", border: "1px solid rgba(152,164,208,.35)", borderRadius: 999 }}>{m}</div>)}
      </Reveal>
      <Captions text={scene.caption} start={scene.lead} frames={Math.round(VOICE[scene.id].seconds * FPS)} frame={f} />
    </AbsoluteFill>
  );
};

const Shell: React.FC<{ scene: Scene; index: number; children: React.ReactNode }> = ({ scene, index, children }) => {
  const f = useCurrentFrame();
  const inn = prog(f, 0, 12), out = clamp01((scene.frames - f) / 12);
  const o = Math.min(inn, out);
  return (
    <AbsoluteFill style={{ opacity: o, transform: `translateX(${(1 - inn) * 40 - (1 - out) * 40}px)` }}>
      {children}
      {VOICE[scene.id].real && <Sequence from={scene.lead}><Audio src={staticFile(`voix/${scene.id}.mp3`)} /></Sequence>}
    </AbsoluteFill>
  );
};

export const Presentation: React.FC = () => {
  const frame = useCurrentFrame();
  let start = 0;
  return (
    <AbsoluteFill style={{ background: C.night }}>
      <Fonts />
      <Background />
      {SCENES.map((s, i) => {
        const from = start; start += s.frames;
        return (
          <Sequence key={s.id} from={from} durationInFrames={s.frames}>
            <Shell scene={s} index={i}>
              {s.kind === "intro" ? <IntroScene scene={s} /> : s.kind === "outro" ? <OutroScene scene={s} /> : <ModuleScene scene={s} index={i} />}
            </Shell>
          </Sequence>
        );
      })}
      {/* repère de marque + progression */}
      <div style={{ position: "absolute", left: 120, top: 62, display: "flex", alignItems: "center", gap: 14, opacity: frame < 60 || frame > TOTAL_FRAMES - 120 ? 0 : 0.95 }}>
        <Mark size={54} id="hd" /><Wordmark size={26} sub={false} />
      </div>
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(frame / TOTAL_FRAMES) * 100}%`, background: `linear-gradient(90deg, ${C.ind1}, ${C.em1}, ${C.lat1})` }} />
    </AbsoluteFill>
  );
};
