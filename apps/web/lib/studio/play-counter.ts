// A play counts once the listener has actually heard this many seconds of a track.
export const PLAY_SECONDS = 30;

// Fed with the audio element's time on every timeupdate. Seeking forward does not count as
// listening: only small steps of the clock add up. `reset` makes the same track count again
// (the player calls it when the track ends, so a repeated song is a new play).
export function createPlayCounter(onPlay: (trackId: string) => void) {
  let id: string | null = null;
  let last = 0;
  let heard = 0;
  let counted = false;
  return {
    tick(trackId: string, time: number) {
      if (trackId !== id) {
        id = trackId;
        last = time;
        heard = 0;
        counted = false;
        return;
      }
      const step = time - last;
      last = time;
      if (step > 0 && step < 2) heard += step;
      if (!counted && heard >= PLAY_SECONDS) {
        counted = true;
        onPlay(trackId);
      }
    },
    reset() {
      id = null;
    },
  };
}
