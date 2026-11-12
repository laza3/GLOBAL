import React from "react";
import { P, clamp, pop, prog, rand } from "./lib";
import { baobabPath } from "./Scenery";

export const FONT_STACK = (family: string) => `${family}, "Noto Color Emoji", sans-serif`;

// ——— Logo : pastille verte, livre ouvert + feuille ———
export const Logo: React.FC<{ size: number; ring?: boolean }> = ({ size, ring }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100">
    <circle r={48} fill={P.green} />
    {ring ? <circle r={48} fill="none" stroke={P.gold} strokeWidth={4} /> : null}
    {/* livre ouvert */}
    <path d="M-30 8 Q-15 0 0 8 L0 32 Q-15 24 -30 32 Z" fill={P.cream} />
    <path d="M30 8 Q15 0 0 8 L0 32 Q15 24 30 32 Z" fill="#F4E2C4" />
    {/* feuille / arbre qui sort du livre */}
    <path d={baobabPath(14, 26)} fill={P.gold} transform="translate(0 6)" />
  </svg>
);

// ——— Couverture d'ebook ———
export type CoverSpec = { title: string; c1: string; c2: string; motif: "sun" | "baobab" | "leaf" | "wave" | "star" | "moon" };

export const COVERS: CoverSpec[] = [
  { title: "Culture", c1: P.green, c2: P.greenDeep, motif: "leaf" },
  { title: "Histoire", c1: P.red, c2: P.earthDark, motif: "sun" },
  { title: "Contes", c1: P.violet, c2: "#4F2561", motif: "moon" },
  { title: "Nature", c1: P.teal, c2: "#0F5260", motif: "baobab" },
  { title: "Voyage", c1: P.yellow, c2: "#D98E1F", motif: "wave" },
  { title: "Poésie", c1: P.rose, c2: "#B8446A", motif: "star" },
];

const Motif: React.FC<{ m: CoverSpec["motif"]; s: number }> = ({ m, s }) => {
  const c = "rgba(255,246,232,0.92)";
  return (
    <svg width={s} height={s} viewBox="-50 -50 100 100">
      {m === "sun" && (
        <>
          <circle r={20} fill={c} />
          {Array.from({ length: 10 }).map((_, i) => (
            <rect key={i} x={-2} y={-42} width={4} height={13} rx={2} fill={c} transform={`rotate(${i * 36})`} />
          ))}
        </>
      )}
      {m === "baobab" && (
        <>
          <circle cx={0} cy={-8} r={30} fill="rgba(255,226,154,0.9)" />
          <path d={baobabPath(26, 44)} fill="#1c0b24" transform="translate(0 40)" />
        </>
      )}
      {m === "leaf" && (
        <>
          <path d="M0 -42 C34 -22 34 22 0 42 C-34 22 -34 -22 0 -42 Z" fill={c} />
          <path d="M0 -30 L0 38" stroke="rgba(31,138,91,0.7)" strokeWidth={3} />
        </>
      )}
      {m === "wave" && (
        <>
          <circle cx={14} cy={-18} r={16} fill={c} />
          <path d="M-42 8 Q-28 -4 -14 8 T14 8 T42 8" stroke={c} strokeWidth={6} fill="none" strokeLinecap="round" />
          <path d="M-42 26 Q-28 14 -14 26 T14 26 T42 26" stroke={c} strokeWidth={6} fill="none" strokeLinecap="round" />
        </>
      )}
      {m === "star" && <path d="M0 -40 L11 -12 L41 -10 L18 9 L26 38 L0 22 L-26 38 L-18 9 L-41 -10 L-11 -12 Z" fill={c} />}
      {m === "moon" && (
        <>
          <path d="M8 -40 C-30 -40 -44 20 -8 40 C20 52 42 30 44 10 C20 28 -14 10 8 -40 Z" fill={c} />
          <circle cx={26} cy={-20} r={4} fill={c} />
        </>
      )}
    </svg>
  );
};

export const Cover: React.FC<{ spec: CoverSpec; w: number; font: string; shadow?: boolean }> = ({ spec, w, font, shadow = true }) => {
  const h = w * 1.42;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        borderRadius: w * 0.07,
        background: `linear-gradient(160deg, ${spec.c1}, ${spec.c2})`,
        boxShadow: shadow ? `0 ${w * 0.12}px ${w * 0.22}px rgba(20,5,30,0.45)` : undefined,
        overflow: "hidden",
        fontFamily: font,
      }}
    >
      {/* reliure */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: w * 0.07, background: "rgba(0,0,0,0.22)" }} />
      <div style={{ position: "absolute", left: w * 0.07, top: 0, bottom: 0, width: 2, background: "rgba(255,255,255,0.25)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: h * 0.1, display: "flex", justifyContent: "center" }}>
        <Motif m={spec.motif} s={w * 0.56} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: h * 0.1,
          textAlign: "center",
          color: P.cream,
          fontWeight: 800,
          fontSize: w * 0.17,
          letterSpacing: 0.5,
        }}
      >
        {spec.title}
      </div>
      <div style={{ position: "absolute", left: w * 0.2, right: w * 0.2, bottom: h * 0.06, height: 3, borderRadius: 2, background: "rgba(255,246,232,0.55)" }} />
    </div>
  );
};

// ——— Sous-titres cinétiques (mot par mot) ———
export type SubWord = { t: string; at: number; hl?: boolean };
export const Subtitle: React.FC<{
  f: number;
  lines: SubWord[][];
  start: number;
  end: number;
  size: number;
  font: string;
  top?: number;
}> = ({ f, lines, start, end, size, font, top = 250 }) => {
  if (f < start) return null;
  const exit = prog(f, end, end + 9);
  if (exit >= 1) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 50,
        right: 50,
        top,
        height: 380,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: 1 - exit,
        transform: `translateY(${-40 * exit}px) scale(${1 - 0.1 * exit})`,
      }}
    >
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", gap: size * 0.24, lineHeight: 1.14, whiteSpace: "nowrap" }}>
          {line.map((w, wi) => {
            const s = pop(f, w.at, 10, 200, 0.55);
            const o = Math.min(1, Math.max(0, (f - w.at) / 4));
            const hs = pop(f, w.at + 3, 14, 150, 0.7);
            return (
              <span
                key={wi}
                style={{
                  position: "relative",
                  display: "inline-block",
                  fontFamily: font,
                  fontWeight: 800,
                  fontSize: size,
                  color: w.hl ? P.ink : P.cream,
                  textShadow: w.hl ? "none" : "0 6px 0 rgba(36,21,64,0.55), 0 0 30px rgba(36,21,64,0.5)",
                  opacity: o,
                  transform: `translateY(${(1 - s) * 56}px) scale(${0.4 + 0.6 * s}) rotate(${(1 - s) * -4}deg)`,
                  transformOrigin: "50% 85%",
                }}
              >
                {w.hl ? (
                  <span
                    style={{
                      position: "absolute",
                      left: -size * 0.16,
                      right: -size * 0.16,
                      top: size * 0.18,
                      bottom: size * 0.06,
                      background: P.gold,
                      borderRadius: size * 0.26,
                      boxShadow: "0 8px 0 rgba(36,21,64,0.4)",
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

// ——— Écrans du téléphone ———
export const SCREEN_W = 504;
export const SCREEN_H = 1064;

export const HomeScreen: React.FC<{ f: number; font: string; coversAt: number; scroll: number }> = ({ f, font, coversAt, scroll }) => (
  <div style={{ position: "absolute", inset: 0, background: P.cream, fontFamily: font, overflow: "hidden", isolation: "isolate" }}>
    {/* en-tête */}
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 190, background: `linear-gradient(180deg, ${P.green}, ${P.greenDeep})`, zIndex: 3 }}>
      <div style={{ position: "absolute", left: 30, right: 30, top: 74, display: "flex", alignItems: "center", gap: 16 }}>
        <Logo size={64} ring />
        <div style={{ color: P.cream, fontWeight: 800, fontSize: 44, letterSpacing: -0.5 }}>Mada ebook</div>
      </div>
    </div>
    <div style={{ position: "absolute", left: 30, top: 210 + 0, fontSize: 30, fontWeight: 800, color: P.ink, opacity: 0.9, zIndex: 2 }}>Bibliothèque</div>
    {/* grille */}
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", transform: `translateY(${-scroll}px)` }}>
      {COVERS.map((c, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const at = coversAt + i * 5;
        const s = pop(f, at, 12, 160, 0.7);
        const w = 192;
        return (
          <div
            key={c.title}
            style={{
              position: "absolute",
              left: 36 + col * 238,
              top: 268 + row * 350,
              opacity: Math.min(1, s * 1.4),
              transform: `translateY(${(1 - s) * 90}px) scale(${0.7 + 0.3 * s}) rotate(${(1 - s) * (col ? 8 : -8)}deg)`,
            }}
          >
            <Cover spec={c} w={w} font={font} />
          </div>
        );
      })}
    </div>
  </div>
);

const bars = (n: number, seed: number) => Array.from({ length: n }).map((_, i) => 0.62 + rand(seed + i * 3) * 0.38);

const Page: React.FC<{ seed: number; num: number; font: string; chapter: string }> = ({ seed, num, font, chapter }) => (
  <div style={{ position: "absolute", inset: 0, background: "#FFFBF2", fontFamily: font }}>
    <div style={{ position: "absolute", left: 44, right: 44, top: 150 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: P.green, letterSpacing: 3, textTransform: "uppercase" }}>{chapter}</div>
      <div style={{ marginTop: 18, display: "flex", gap: 14 }}>
        <div style={{ fontSize: 118, lineHeight: 0.85, fontWeight: 800, color: P.coral }}>L</div>
        <div style={{ flex: 1, paddingTop: 10 }}>
          {bars(4, seed).map((w, i) => (
            <div key={i} style={{ height: 15, marginBottom: 17, borderRadius: 8, width: `${w * 100}%`, background: "#3b2744", opacity: 0.82 }} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 22 }}>
        {bars(15, seed + 40).map((w, i) => (
          <div key={i} style={{ height: 15, marginBottom: 20, borderRadius: 8, width: `${i % 5 === 4 ? w * 60 : w * 100}%`, background: "#3b2744", opacity: 0.82 }} />
        ))}
      </div>
    </div>
    <div style={{ position: "absolute", bottom: 70, left: 0, right: 0, textAlign: "center", fontSize: 24, color: "#8a7a8f", fontWeight: 800 }}>{num}</div>
  </div>
);

export const ReaderScreen: React.FC<{ f: number; font: string; start: number }> = ({ f, font, start }) => {
  const t = f - start;
  // deux tournages de page
  const flip1 = prog(t, 22, 46);
  const flip2 = prog(t, 62, 86);
  const bookmark = pop(f, start + 4, 12, 160, 0.7);
  const lit = prog(t, 0, 20);
  return (
    <div style={{ position: "absolute", inset: 0, background: "#EFE2CC", fontFamily: font, overflow: "hidden", perspective: 1500, isolation: "isolate" }}>
      <Page seed={91} num={3} font={font} chapter="Chapitre 3" />
      <div style={{ position: "absolute", inset: 0, transformOrigin: "0% 50%", transform: `rotateY(${-(flip2) * 115}deg)`, opacity: 1 - flip2 * 0.2, display: flip2 >= 1 ? "none" : "block", zIndex: 3, filter: `brightness(${1 - flip2 * 0.2})` }}>
        <Page seed={33} num={2} font={font} chapter="Chapitre 2" />
      </div>
      <div style={{ position: "absolute", inset: 0, transformOrigin: "0% 50%", transform: `rotateY(${-(flip1) * 115}deg)`, opacity: 1 - flip1 * 0.2, display: flip1 >= 1 ? "none" : "block", zIndex: 4, filter: `brightness(${1 - flip1 * 0.2})` }}>
        <Page seed={7} num={1} font={font} chapter="Chapitre 1" />
      </div>
      {/* en-tête lecteur */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 120, background: P.greenDeep, zIndex: 6, display: "flex", alignItems: "flex-end", paddingBottom: 18, paddingLeft: 30, gap: 14 }}>
        <Logo size={44} />
        <div style={{ color: P.cream, fontWeight: 800, fontSize: 30 }}>Contes de la Grande Île</div>
      </div>
      {/* marque-page */}
      <div style={{ position: "absolute", right: 46, top: 120, width: 34, height: 96, background: P.coral, clipPath: "polygon(0 0,100% 0,100% 100%,50% 76%,0 100%)", transform: `scaleY(${bookmark})`, transformOrigin: "50% 0%", zIndex: 6 }} />
      {/* barre de progression */}
      <div style={{ position: "absolute", left: 44, right: 44, bottom: 30, height: 10, borderRadius: 6, background: "rgba(42,21,48,0.15)", zIndex: 6 }}>
        <div style={{ width: `${lit * 20 + prog(t, 22, 86) * 40}%`, height: "100%", borderRadius: 6, background: P.green }} />
      </div>
    </div>
  );
};

export const ProfileScreen: React.FC<{ f: number; font: string; start: number; tapAt: number }> = ({ f, font, start, tapAt }) => {
  const followed = f >= tapAt + 4;
  const press = pop(f, tapAt, 8, 260, 0.5);
  const btnScale = f >= tapAt ? 1 - 0.12 * Math.max(0, 1 - press) + 0.12 * Math.max(0, press - 1) * 0 : 1;
  const idle = f < tapAt ? 1 + 0.035 * Math.sin((f - start) / 4) : 1;
  const av = pop(f, start + 4, 12, 150, 0.8);
  const nm = pop(f, start + 10, 12, 170, 0.7);
  const bt = pop(f, start + 18, 12, 170, 0.7);
  const ripple = prog(f, tapAt, tapAt + 22);
  return (
    <div style={{ position: "absolute", inset: 0, background: P.cream, fontFamily: font, overflow: "hidden", isolation: "isolate" }}>
      {/* bannière : mini paysage */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 380, background: `linear-gradient(180deg, ${P.plum}, ${P.coral} 55%, ${P.gold})` }}>
        <svg width={SCREEN_W} height={380} viewBox="0 0 504 380" style={{ position: "absolute", inset: 0 }}>
          <circle cx={252} cy={300} r={74} fill="#FFE8A8" />
          <path d="M0 330 Q 120 310 252 328 T 504 322 L504 380 L0 380 Z" fill={P.earth} />
          <g transform="translate(110 336)"><path d={baobabPath(46, 150)} fill="#2A0F2E" /></g>
          <g transform="translate(400 338)"><path d={baobabPath(40, 120)} fill="#2A0F2E" /></g>
          <g transform="translate(250 340)"><path d={baobabPath(26, 70)} fill="#5A1F3A" opacity={0.8} /></g>
        </svg>
      </div>
      <div style={{ position: "absolute", left: 38, top: 300, transform: `scale(${av})`, transformOrigin: "50% 50%" }}>
        <div style={{ width: 168, height: 168, borderRadius: 100, background: P.cream, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 24px rgba(36,21,64,0.3)" }}>
          <Logo size={148} ring />
        </div>
      </div>
      <div style={{ position: "absolute", left: 38, top: 490, opacity: nm, transform: `translateY(${(1 - nm) * 24}px)` }}>
        <div style={{ fontSize: 56, fontWeight: 800, color: P.ink, letterSpacing: -1 }}>Mada ebook</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#7a5a76", marginTop: 4 }}>La lecture malgache, dans ta poche</div>
      </div>
      {/* bouton suivre */}
      <div style={{ position: "absolute", left: 38, right: 38, top: 660, transform: `scale(${bt * idle * btnScale})`, transformOrigin: "50% 50%", opacity: Math.min(1, bt) }}>
        <div
          style={{
            position: "relative",
            height: 104,
            borderRadius: 52,
            background: followed ? P.cream : `linear-gradient(90deg, ${P.coral}, ${P.orange})`,
            border: followed ? `5px solid ${P.green}` : "none",
            color: followed ? P.green : P.cream,
            fontSize: 46,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            boxShadow: followed ? "none" : "0 12px 0 rgba(168,57,31,0.45)",
            overflow: "hidden",
          }}
        >
          {followed ? "✓ Suivi" : "+ Suivre la page"}
          {f >= tapAt ? <div style={{ position: "absolute", left: "70%", top: "55%", width: 40 + ripple * 520, height: 40 + ripple * 520, marginLeft: -(20 + ripple * 260), marginTop: -(20 + ripple * 260), borderRadius: "50%", background: "rgba(255,246,232,0.55)", opacity: 1 - ripple }} /> : null}
        </div>
      </div>
      {/* mini-couvertures */}
      <div style={{ position: "absolute", left: 38, right: 38, top: 830, display: "flex", gap: 22 }}>
        {COVERS.slice(0, 3).map((c, i) => {
          const s = pop(f, start + 26 + i * 4, 12, 160, 0.7);
          return (
            <div key={c.title} style={{ opacity: Math.min(1, s), transform: `translateY(${(1 - s) * 60}px)` }}>
              <Cover spec={c} w={128} font={font} shadow={false} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { clamp };
