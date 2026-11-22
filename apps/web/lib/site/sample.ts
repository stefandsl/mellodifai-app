// The hero sample: one lyric line of one of our own songs, pre-rendered twice (the word as
// recorded and the word sung again). The page plays the clip of the word the visitor picks.
//
// TODO(owner): choose the song and the line for the hero sample. Then put the two pre-rendered
// clips at the paths below (folder apps/web/public/site/sample/, short MP3s of about 6 seconds)
// and change the lyric words in lib/site/copy.ts (hero.lineStart, hero.words) to that line.
// Until the files exist the play button says that the sample is not here yet.
export const HERO_SAMPLE = {
  clips: {
    hate: "/site/sample/line-as-recorded.mp3",
    love: "/site/sample/line-sung-again.mp3",
  },
  // The word that is on screen first: the line as recorded.
  first: "hate",
} as const;

export type SampleWord = keyof typeof HERO_SAMPLE.clips;
