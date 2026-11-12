"use server";
import { lyricAlignmentRequest } from "@/lib/ops/defs/lyric-alignment-request";
import { runAction } from "@/lib/run-action";

export async function requestLyricAlignment(input: unknown) {
  return runAction(lyricAlignmentRequest, input);
}
