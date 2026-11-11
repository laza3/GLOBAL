// Polices embarquées (SIL OFL, Google Fonts) : rendu reproductible sans réseau.
import { continueRender, delayRender, staticFile } from "remotion";

export const SANS = "JBaloo, 'Baloo 2', sans-serif";
export const SERIF = "JFraunces, Georgia, serif";

const faces: [string, string, FontFaceDescriptors][] = [
  ["JBaloo", "journee/fonts/Baloo2.woff2", { weight: "400 800" }],
  ["JFraunces", "journee/fonts/Fraunces.woff2", { weight: "100 900" }],
  ["JFraunces", "journee/fonts/Fraunces-Italic.woff2", { weight: "100 900", style: "italic" }],
];

if (typeof document !== "undefined") {
  const handle = delayRender("Polices de « Une journée catastrophique »");
  Promise.all(
    faces.map(([family, file, desc]) =>
      new FontFace(family, `url(${staticFile(file)}) format('woff2')`, desc).load().then((f) => {
        (document.fonts as unknown as { add: (x: FontFace) => void }).add(f);
      }),
    ),
  )
    .then(() => continueRender(handle))
    .catch((e) => {
      console.error(e);
      continueRender(handle);
    });
}
