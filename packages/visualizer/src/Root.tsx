import {
  normalizeVisualizerParams,
  renderSize,
  VISUALIZER_FPS,
} from "@mellodifai/shared";
import { Composition } from "remotion";
import { Previz, type PrevizProps } from "./previz/Previz";
import { Visualizer, type VisualizerProps } from "./Visualizer";

const defaults: VisualizerProps = {
  params: normalizeVisualizerParams(null),
  title: "",
  duration: 10,
  frames: 10 * VISUALIZER_FPS,
  audio: null,
  analysis: null,
  background: null,
  center: null,
  logos: [],
};

const previzDefaults: PrevizProps = {
  shot: {
    index: 0,
    segment: 0,
    start: 0,
    end: 10,
    startFrame: 0,
    endFrame: 10 * VISUALIZER_FPS,
    section: "Verse",
    sectionKind: "verse",
    kind: "lipsync-single",
    camera: "close-up",
    burst: [],
    set: "set-verse",
    costume: "costume-a",
    energy: 0.5,
    lyrics: "",
    prompt: "previz",
  },
  frames: 10 * VISUALIZER_FPS,
  beats: [],
  words: [],
};

// The visualizer, whose size and length the worker's props set, and the music-video previz:
// one grey-box shot per cut-plan segment, 720p.
export function Root() {
  return (
    <>
      <Composition
        id="Visualizer"
        component={Visualizer}
        fps={VISUALIZER_FPS}
        width={1920}
        height={1080}
        durationInFrames={defaults.frames}
        defaultProps={defaults}
        calculateMetadata={({ props }) => {
          const params = normalizeVisualizerParams(props.params);
          return {
            durationInFrames: Math.max(1, Math.round(props.frames)),
            ...renderSize(params.aspect, params.quality),
            props: { ...props, params },
          };
        }}
      />
      <Composition
        id="Previz"
        component={Previz}
        fps={VISUALIZER_FPS}
        width={1280}
        height={720}
        durationInFrames={previzDefaults.frames}
        defaultProps={previzDefaults}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round(props.frames)),
        })}
      />
    </>
  );
}
