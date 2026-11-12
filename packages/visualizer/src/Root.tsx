import {
  normalizeVisualizerParams,
  renderSize,
  VISUALIZER_FPS,
} from "@mellodifai/shared";
import { Composition } from "remotion";
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

// One composition; the worker passes the song's props, which set its size and length.
export function Root() {
  return (
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
  );
}
