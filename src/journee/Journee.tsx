import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { Chambre } from "./scenes/Chambre";
import { Rue } from "./scenes/Rue";
import { Arret } from "./scenes/Arret";
import { Final } from "./scenes/Final";
import { Captions, FilmLook, Message, Title } from "./overlays";
import { FPS, TL, evr, k01 } from "./util";

/** Flou de mouvement pendant les coups de fouet (transitions). */
const whipBlur = (t: number, center: number, half = 0.36) => {
  const u = 1 - Math.abs(t - center) / half;
  return u > 0 ? 26 * Math.sin((u * Math.PI) / 2) ** 2 : 0;
};

const Layer: React.FC<{ blur?: number; opacity?: number; children: React.ReactNode }> = ({ blur = 0, opacity = 1, children }) => (
  <AbsoluteFill style={{ opacity, filter: blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : undefined }}>{children}</AbsoluteFill>
);

/**
 * « Une journée catastrophique… mais pas inutile » — 80 s, 1080×1920.
 * 1 chambre (0–12,6) · 2 rue (12,6–24,6) · 3-5 arrêt de bus (24,6–59,6) · 6 final (59,6–80).
 */
export const Journee: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const sc = TL.scenes;
  const blur = whipBlur(t, sc.chambre[1]) + whipBlur(t, sc.rue[1]);
  const xf = k01(t, sc.final[0] - 0.2, sc.final[0] + 0.5);
  const [f0, f1] = evr("fadeOut");
  const fadeIn = 1 - k01(t, 0, 0.6);
  const fadeOut = k01(t, f0, f1);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Layer blur={blur}>
        {t < sc.chambre[1] ? <Chambre t={t} /> : null}
        {t >= sc.rue[0] && t < sc.rue[1] ? <Rue t={t} /> : null}
        {t >= sc.arret[0] && t < sc.final[0] + 0.5 ? <Arret t={t} /> : null}
      </Layer>
      {t >= sc.final[0] - 0.2 ? (
        <Layer opacity={xf}>
          <Final t={t} />
        </Layer>
      ) : null}
      <FilmLook frame={frame} />
      <Title t={t} />
      <Captions t={t} />
      <Message t={t} />
      <AbsoluteFill style={{ background: "#000", opacity: Math.max(fadeIn, fadeOut * 0.85) }} />
      <Audio src={staticFile("journee/bande-son.wav")} />
    </AbsoluteFill>
  );
};
