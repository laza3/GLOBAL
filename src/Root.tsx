import React from "react";
import { Composition } from "remotion";
import { Journee } from "./journee/Journee";
import timeline from "./journee/timeline.json";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Journee"
      component={Journee}
      durationInFrames={timeline.duration * timeline.fps}
      fps={timeline.fps}
      width={1080}
      height={1920}
    />
    {/* chargée à la demande : ses polices Google ne bloquent pas les autres rendus */}
    <Composition
      id="Flamants"
      lazyComponent={(): Promise<{ default: React.FC }> => import("./Flamants").then((m) => ({ default: m.Flamants }))}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
    />
  </>
);
