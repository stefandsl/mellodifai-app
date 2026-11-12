import { expect, it, vi } from "vitest";
import { readKieDelivery } from "../src/providers/kie-client.js";

it("accepts known HTTPS media and checks each redirect before fetching", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://cdn2.suno.ai/song.mp3" },
      }),
    )
    .mockResolvedValueOnce(new Response("song"));
  expect(
    await readKieDelivery(
      "https://cdn1.suno.ai/song.mp3",
      fetcher,
      undefined,
      10,
    ),
  ).toEqual(Buffer.from("song"));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });

  fetcher.mockClear().mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
  );
  await expect(
    readKieDelivery("https://cdn1.suno.ai/song.mp3", fetcher, undefined, 10),
  ).rejects.toThrow("not trusted");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  "http://cdn2.suno.ai/song.mp3",
  "https://127.0.0.1/song.mp3",
  "https://cdn2.suno.ai.evil.example/song.mp3",
  "https://cdn2.suno.ai:8443/song.mp3",
  "https://user@cdn2.suno.ai/song.mp3",
])("rejects an untrusted media URL before fetch: %s", async (url) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(readKieDelivery(url, fetcher, undefined, 10)).rejects.toThrow(
    "not trusted",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds both declared and streamed content", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("large", {
        headers: { "content-length": "100" },
      }),
    )
    .mockResolvedValueOnce(new Response("oversized"));
  await expect(
    readKieDelivery(
      "https://tempfile.aiquickdraw.com/r/song.mp3",
      fetcher,
      undefined,
      4,
    ),
  ).rejects.toThrow("too large");
  await expect(
    readKieDelivery(
      "https://tempfile.aiquickdraw.com/r/song.mp3",
      fetcher,
      undefined,
      4,
    ),
  ).rejects.toThrow("too large");
});
