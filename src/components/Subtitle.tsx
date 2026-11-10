import React from "react";
import { interpolate } from "remotion";
import { C, clamp, pop, prog } from "../lib";

export type Word = { t: string; at: number; hl?: "pink" | "orange" };

type Props = {
  frame: number;
  lines: Word[][];
  start: number;
  end?: number; // début de la sortie
  fontSize: number;
  fontFamily: string;
};

/**
 * Sous-titres dynamiques : les mots apparaissent un par un (ressort),
 * le mot clé reçoit un surligneur rose / orange qui se déploie.
 * Bloc centré dans le tiers haut, sous la marge de sécurité de 250 px.
 */
export const Subtitle: React.FC<Props> = ({ frame, lines, start, end, fontSize, fontFamily }) => {
  if (frame < start) return null;
  const exit = end === undefined ? 0 : prog(frame, end, end + 8);
  if (exit >= 1) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        right: 70,
        top: 270,
        height: 400,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: 1 - exit,
        transform: `translateY(${-30 * exit}px) scale(${1 - 0.12 * exit})`,
      }}
    >
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", justifyContent: "center", flexWrap: "nowrap", gap: fontSize * 0.26, lineHeight: 1.12 }}>
          {line.map((w, wi) => {
            const s = pop(frame, w.at, 10, 190, 0.6);
            const o = interpolate(frame - w.at, [0, 4], [0, 1], clamp);
            const hs = pop(frame, w.at + 4, 14, 160, 0.7);
            const bg = w.hl === "pink" ? C.pink : C.orange;
            return (
              <span
                key={wi}
                style={{
                  position: "relative",
                  display: "inline-block",
                  fontFamily,
                  fontWeight: 800,
                  fontSize,
                  color: C.navy,
                  letterSpacing: -1,
                  whiteSpace: "nowrap",
                  opacity: o,
                  transform: `translateY(${(1 - s) * 44}px) scale(${0.45 + 0.55 * s})`,
                  transformOrigin: "50% 80%",
                }}
              >
                {w.hl ? (
                  <span
                    style={{
                      position: "absolute",
                      left: -fontSize * 0.14,
                      right: -fontSize * 0.14,
                      top: fontSize * 0.2,
                      bottom: fontSize * 0.08,
                      background: bg,
                      borderRadius: fontSize * 0.26,
                      transform: `rotate(-2deg) scaleX(${hs})`,
                      transformOrigin: "0% 50%",
                    }}
                  />
                ) : null}
                <span style={{ position: "relative" }}>{w.t}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
