import React from "react";
import { Composition } from "remotion";
import { Presentation } from "./Presentation";
import { FPS, TOTAL_FRAMES } from "./scenes";

export const Root: React.FC = () => (
  <Composition id="Presentation" component={Presentation} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
