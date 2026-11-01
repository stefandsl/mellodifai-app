import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

import { mediaUrl } from "@/lib/media";

const sign = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: { from: () => ({ createSignedUrl: sign }) },
  }),
}));

import { GET } from "./route";

const path = "previews/u/p/it/take-2 preview.mp3";
const call = (url: string) =>
  GET(new NextRequest(`http://localhost${url}`), {
    params: Promise.resolve({
      path: decodeURI(url.split("?")[0].slice("/media/".length)).split("/"),
    }),
  });

beforeEach(() => sign.mockReset());

it("links a stored path under /media, escaping each segment", () => {
  expect(mediaUrl(path)).toBe("/media/previews/u/p/it/take-2%20preview.mp3");
});

it("redirects to a freshly signed link on every request", async () => {
  sign.mockResolvedValue({ data: { signedUrl: "http://s/sign/a?token=t" } });
  const response = await call(mediaUrl(path));
  expect(sign).toHaveBeenCalledWith(path, 3600, undefined);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://s/sign/a?token=t");
  expect(response.headers.get("cache-control")).toBe("private, max-age=600");
});

it("passes the download name on, so storage sends an attachment", async () => {
  sign.mockResolvedValue({ data: { signedUrl: "http://s/sign/a?token=t" } });
  await call(`${mediaUrl(path)}?download=Song.mp3`);
  expect(sign).toHaveBeenCalledWith(path, 3600, { download: "Song.mp3" });
});

it("answers 404 when the file is missing or not the reader's", async () => {
  sign.mockResolvedValue({ data: null, error: { message: "not found" } });
  const response = await call(mediaUrl(path));
  expect(response.status).toBe(404);
});
