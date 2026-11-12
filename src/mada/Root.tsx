import React from "react";
import { Composition } from "remotion";
import { Mada } from "./Mada";
import { DURATION } from "./lib";

export const MadaRoot: React.FC = () => (
  <Composition id="Mada" component={Mada} durationInFrames={DURATION} fps={30} width={1080} height={1920} />
);
