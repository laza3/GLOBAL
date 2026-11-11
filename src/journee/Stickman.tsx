import React from "react";
import { Face, L, Pose, joints, root } from "./rig";

export const INK = "#161616";
export const INK_BACK = "#3b3b3e";
const SW = 15; // épaisseur des membres

type Props = {
  pose: Pose;
  /** Contour clair pour détacher la silhouette sur fond sombre (pluie). */
  rim?: string;
  rimWidth?: number;
  /** Accessoires attachés aux mains (repère : origine = main, x le long de l'avant-bras). */
  handF?: React.ReactNode;
  handB?: React.ReactNode;
  /** Accessoire posé sur la tête (chapeau…), repère : centre de la tête, aligné avec elle. */
  hat?: React.ReactNode;
  mustache?: boolean;
  /** Ne dessiner qu'une partie (ex. bras qui sort de la couverture). */
  only?: "all" | "armF" | "upper";
  /** Teinte des membres arrière (profondeur). */
  back?: string;
};

const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;

const FaceView: React.FC<{ f: Face; mustache?: boolean }> = ({ f, mustache }) => {
  const turn = Math.max(-1, Math.min(1, f.turn));
  const cx = 13 * turn;
  const spread = 7 + 6 * (1 - Math.abs(turn));
  const eyeR = 7.4 * Math.min(1.5, Math.max(1, f.eye));
  const open = Math.max(0, Math.min(1.5, f.eye));
  const eyes = [cx - spread, cx + spread];
  const px = f.look * 2.6;
  const py = f.lookY * 2.6;
  const browY = -13 - 3 * Math.max(0, f.eye - 1);
  const mW = 9 + 2 * Math.abs(f.mouth);
  const my = 15;
  const mc = f.mouth * 7;
  return (
    <g>
      {eyes.map((ex, i) => {
        const far = (turn > 0 && i === 0) || (turn < 0 && i === 1);
        const sx = far ? 1 - 0.35 * Math.abs(turn) : 1;
        return (
          <g key={i} transform={`translate(${ex} -2) scale(${sx} 1)`}>
            {open > 0.18 ? (
              <>
                <ellipse cx={0} cy={0} rx={eyeR * 0.82} ry={eyeR * Math.min(1.25, open) * 1.08} fill="#fff" />
                <circle cx={px} cy={py} r={3.3 * Math.min(1.2, 0.9 + 0.1 * (2 - open))} fill={INK} />
              </>
            ) : (
              <path d={`M${-eyeR * 0.8} 0 Q0 ${3 + 2 * f.mouth} ${eyeR * 0.8} 0`} stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" />
            )}
            {/* sourcils : extrémité intérieure relevée (inquiet, b < 0) ou abaissée (fâché, b > 0) */}
            <path
              d={i === 0
                ? `M-6 ${browY - f.brow * 1.5} L6 ${browY + f.brow * 3.5}`
                : `M-6 ${browY + f.brow * 3.5} L6 ${browY - f.brow * 1.5}`}
              stroke="#fff"
              strokeWidth={2.6}
              strokeLinecap="round"
              opacity={0.92}
            />
          </g>
        );
      })}
      {f.open > 0.08 ? (
        <path
          d={`M${cx - mW} ${my - 1} Q${cx} ${my + mc - 2} ${cx + mW} ${my - 1} Q${cx} ${my + 4 + 12 * f.open + mc} ${cx - mW} ${my - 1} Z`}
          fill="#fff"
        />
      ) : (
        <path d={`M${cx - mW} ${my} Q${cx} ${my + mc} ${cx + mW} ${my}`} stroke="#fff" strokeWidth={2.8} fill="none" strokeLinecap="round" />
      )}
      {mustache ? (
        <path d={`M${cx - 13} ${my - 3} Q${cx - 6} ${my - 9} ${cx} ${my - 5} Q${cx + 6} ${my - 9} ${cx + 13} ${my - 3} Q${cx + 6} ${my - 2} ${cx} ${my - 3.5} Q${cx - 6} ${my - 2} ${cx - 13} ${my - 3} Z`} fill="#e9e6df" />
      ) : null}
    </g>
  );
};

const Body: React.FC<Props & { color: string; back: string; width: number; outline?: boolean }> = ({
  pose, handF, handB, hat, mustache, only = "all", color, back, width, outline,
}) => {
  const j = joints(pose);
  const lw = width;
  const common = { strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const armB = `${seg(j.shoulder, j.elbowB)} L${j.handB.x.toFixed(1)} ${j.handB.y.toFixed(1)}`;
  const armF = `${seg(j.shoulder, j.elbowF)} L${j.handF.x.toFixed(1)} ${j.handF.y.toFixed(1)}`;
  const legB = `${seg(j.hip, j.kneeB)} L${j.footB.x.toFixed(1)} ${j.footB.y.toFixed(1)}`;
  const legF = `${seg(j.hip, j.kneeF)} L${j.footF.x.toFixed(1)} ${j.footF.y.toFixed(1)}`;
  const torso = seg(j.hip, j.neck);
  const neck = `M${j.neck.x} ${j.neck.y} L${(j.neck.x + (L.neck + 4) * Math.sin(j.headAng * Math.PI / 180)).toFixed(1)} ${(j.neck.y - (L.neck + 4) * Math.cos(j.headAng * Math.PI / 180)).toFixed(1)}`;
  const handProp = (h: { x: number; y: number }, ang: number, node?: React.ReactNode) =>
    node && !outline ? <g transform={`translate(${h.x} ${h.y}) rotate(${90 - ang})`}>{node}</g> : null;

  if (only === "armF") {
    return (
      <g>
        <path d={armF} stroke={color} strokeWidth={lw} {...common} />
        {handProp(j.handF, j.foreF, handF)}
      </g>
    );
  }
  return (
    <g>
      {handProp(j.handB, j.foreB, handB)}
      <path d={armB} stroke={back} strokeWidth={lw} {...common} />
      {only === "all" ? <path d={legB} stroke={back} strokeWidth={lw} {...common} /> : null}
      <path d={torso} stroke={color} strokeWidth={lw + 1.5} {...common} />
      <path d={neck} stroke={color} strokeWidth={lw - 2} {...common} />
      {only === "all" ? <path d={legF} stroke={color} strokeWidth={lw} {...common} /> : null}
      <g transform={`translate(${j.head.x} ${j.head.y}) rotate(${j.headAng})`}>
        <circle r={L.head + (outline ? (lw - SW) / 2 : 0)} fill={color} />
        {!outline ? <FaceView f={pose.face} mustache={mustache} /> : null}
        {hat && !outline ? hat : null}
      </g>
      <path d={armF} stroke={color} strokeWidth={lw} {...common} />
      {handProp(j.handF, j.foreF, handF)}
    </g>
  );
};

/** Stickman complet, posé dans le monde. */
export const Stickman: React.FC<Props> = (props) => {
  const { pose, rim, rimWidth = 7 } = props;
  const r = root(pose);
  // demi-tour : on écrase horizontalement pendant que dir traverse 0
  const d = pose.dir;
  const sx = (d >= 0 ? 1 : -1) * (0.32 + 0.68 * Math.min(1, Math.abs(d)));
  const tr = `translate(${r.x.toFixed(1)} ${r.y.toFixed(1)}) rotate(${pose.rot.toFixed(2)}) scale(${sx.toFixed(3)} ${pose.sq.toFixed(3)})`;
  return (
    <g transform={tr}>
      {rim ? <Body {...props} color={rim} back={rim} width={SW + rimWidth * 2} outline /> : null}
      <Body {...props} color={INK} back={props.back ?? INK_BACK} width={SW} />
    </g>
  );
};

/** Chapeau feutre du vieil homme (repère tête). */
export const Fedora: React.FC = () => (
  <g transform="translate(0 -26)">
    <path d="M-50 4 Q0 -6 50 4 Q46 10 0 9 Q-46 10 -50 4 Z" fill="#4a4036" />
    <path d="M-30 4 Q-32 -30 -10 -32 Q0 -26 10 -32 Q32 -30 30 4 Z" fill="#5a4e42" />
    <path d="M-30 -2 L30 -2 L30 4 L-30 4 Z" fill="#c9a227" />
  </g>
);
