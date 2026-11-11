import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { SANS, SERIF } from "./fonts";
import { Umbrella } from "./props";
import { TL, clampO, easeO, k01, rnd } from "./util";
import { interpolate } from "remotion";

/** Titre d'ouverture. */
export const Title: React.FC<{ t: number }> = ({ t }) => {
  if (t > 2.7) return null;
  const a = k01(t, 0.25, 0.85, easeO);
  const b = k01(t, 0.75, 1.35, easeO);
  const out = k01(t, 2.15, 2.6);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 330, opacity: 1 - out }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 92, lineHeight: 1.0, color: "#fff", textAlign: "center", letterSpacing: -1, opacity: a, transform: `translateY(${(1 - a) * 30}px)`, textShadow: "0 6px 28px rgba(0,0,0,0.55)" }}>
        Une journée
        <br />
        catastrophique…
      </div>
      <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 500, fontSize: 66, color: "#ffc93c", marginTop: 18, opacity: b, transform: `translateY(${(1 - b) * 24}px)`, textShadow: "0 6px 24px rgba(0,0,0,0.6)" }}>
        …mais pas inutile
      </div>
    </AbsoluteFill>
  );
};

/** Sous-titres synchronisés avec la voix off (révélation mot à mot approchée). */
export const Captions: React.FC<{ t: number }> = ({ t }) => {
  const c = TL.captions.find((x) => t >= x.t[0] - 0.05 && t < x.t[1] + 0.12);
  if (!c) return null;
  const [a, b] = c.t;
  const words = c.text.split(" ");
  const total = c.text.length;
  let acc = 0;
  const inO = k01(t, a - 0.05, a + 0.12);
  const outO = 1 - k01(t, b - 0.02, b + 0.12);
  const speak = Math.max(0.3, (b - a) * 0.86);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 1530 }}>
      <div
        style={{
          maxWidth: 930,
          textAlign: "center",
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 56,
          lineHeight: 1.12,
          color: "#fff",
          opacity: inO * outO,
          transform: `translateY(${(1 - inO) * 14}px)`,
          textShadow: "0 3px 0 rgba(0,0,0,0.55), 0 0 22px rgba(0,0,0,0.65)",
          padding: "8px 18px",
        }}
      >
        {words.map((w, i) => {
          const at = a + (acc / total) * speak;
          acc += w.length + 1;
          const k = interpolate(t, [at - 0.04, at + 0.1], [0.32, 1], clampO);
          return (
            <span key={i} style={{ opacity: k, display: "inline-block", marginRight: 14, transform: `translateY(${(1 - k) * 6}px)` }}>
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Message final : grandes lignes en typographie élégante. */
export const Message: React.FC<{ t: number }> = ({ t }) => {
  const items = TL.message;
  const idx = items.findIndex((m) => t >= m.t[0] - 0.1 && t < m.t[1] + 0.25);
  if (idx < 0) return null;
  const m = items[idx];
  const last = idx === items.length - 1;
  const [a, b] = m.t;
  const outO = last ? 1 : 1 - k01(t, b - 0.05, b + 0.25);
  const size = last ? 84 : 70;
  const hl = ["bonheur", "choisissons"];
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingBottom: last ? 260 : 300 }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 30% at 50% 42%, rgba(60,25,10,0.32), rgba(60,25,10,0) 70%)", opacity: outO }} />
      {last ? (
        <div style={{ marginBottom: 26, opacity: k01(t, a - 0.1, a + 0.5), transform: `scale(${0.6 + 0.4 * k01(t, a - 0.1, a + 0.6, easeO)})` }}>
          <svg width={190} height={148} viewBox="-180 -250 360 280">
            <Umbrella open={1} shaft={150} />
          </svg>
        </div>
      ) : null}
      <div style={{ textAlign: "center", opacity: outO }}>
        {m.lines.map((line, i) => {
          const at = a + i * (last ? 0.85 : 0.75);
          const k = k01(t, at - 0.1, at + 0.45, easeO);
          return (
            <div
              key={i}
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: size,
                lineHeight: 1.16,
                color: "#fffaf0",
                opacity: k,
                filter: k < 1 ? `blur(${((1 - k) * 8).toFixed(1)}px)` : undefined,
                transform: `translateY(${(1 - k) * 22}px)`,
                textShadow: "0 4px 26px rgba(70,30,10,0.65), 0 2px 4px rgba(70,30,10,0.4)",
                letterSpacing: -0.5,
              }}
            >
              {line.split(" ").map((w, j) => {
                const isHl = hl.some((h) => w.toLowerCase().startsWith(h));
                return (
                  <span key={j} style={{ color: isHl ? "#ffd166" : undefined, fontStyle: isHl ? "italic" : undefined }}>
                    {w}{" "}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Grain de pellicule + vignettage. */
export const FilmLook: React.FC<{ frame: number }> = ({ frame }) => {
  const ox = Math.floor(rnd(frame) * 200) - 100;
  const oy = Math.floor(rnd(frame + 0.5) * 200) - 100;
  return (
    <>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 90% 75% at 50% 46%, rgba(0,0,0,0) 60%, rgba(10,8,20,0.3) 100%)" }} />
      <AbsoluteFill style={{ overflow: "hidden", opacity: 0.075, mixBlendMode: "overlay" }}>
        <Img src={staticFile("journee/grain.png")} style={{ position: "absolute", left: -120 + ox, top: -120 + oy, width: 1320, height: 2160, imageRendering: "pixelated" }} />
      </AbsoluteFill>
    </>
  );
};
