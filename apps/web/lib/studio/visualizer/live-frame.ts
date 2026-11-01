import {
  bandsFromBytes,
  FFT_SIZE,
  MAX_DB,
  MIN_DB,
  smoothBands,
  waveFromBytes,
} from "@mellodifai/shared";

// The analyser settings the render PC reproduces from samples (packages/shared visualizer
// audio): no smoothing inside the analyser, which would depend on how often it is read.
export function configureAnalyser(analyser: AnalyserNode): void {
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = MIN_DB;
  analyser.maxDecibels = MAX_DB;
}

const freq = new Uint8Array(FFT_SIZE / 2);
const time = new Uint8Array(FFT_SIZE);

// One preview frame from the analyser: the same bands and wave the render reads from its
// analysis file, smoothed over the `dt` seconds since the previous frame.
export function readAnalyser(
  analyser: AnalyserNode,
  prev: Float32Array | null,
  dt: number,
): { bands: Float32Array; wave: Float32Array } {
  analyser.getByteFrequencyData(freq);
  analyser.getByteTimeDomainData(time);
  return {
    bands: smoothBands(
      prev,
      bandsFromBytes(freq, analyser.context.sampleRate),
      dt,
    ),
    wave: waveFromBytes(time),
  };
}
