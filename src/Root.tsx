import React from "react";
import { Composition } from "remotion";
import { Flamants } from "./Flamants";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Flamants"
    component={Flamants}
    durationInFrames={450}
    fps={30}
    width={1080}
    height={1920}
  />
);
