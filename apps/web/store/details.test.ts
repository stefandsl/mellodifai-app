import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@/lib/studio/clips";
import {
  dropFromDetails,
  useDetails,
  useDetailsClips,
  useKnownClips,
} from "./details";

const KEY = "mellodifai-details";
const clip = (id: string) => ({ id, title: id }) as Clip;
beforeEach(() => {
  localStorage.clear();
  useDetails.setState({ open: false, selectedId: null });
  useKnownClips.setState({ known: {} });
  localStorage.clear();
});

describe("details store", () => {
  it("opens on a song and closes without forgetting it", () => {
    useDetails.getState().show("a");
    expect(useDetails.getState()).toMatchObject({
      open: true,
      selectedId: "a",
    });
    useDetails.getState().close();
    expect(useDetails.getState()).toMatchObject({
      open: false,
      selectedId: "a",
    });
    useDetails.getState().show("a");
    expect(useDetails.getState().open).toBe(true);
  });

  it("forgets the choice only when the picked song is one of those that left", () => {
    useDetails.getState().show("a");
    useDetails.getState().forget(["b"]);
    expect(useDetails.getState().selectedId).toBe("a");
    useDetails.getState().forget(["a", "b"]);
    expect(useDetails.getState().selectedId).toBeNull();
  });

  it("remembers open and the selection across a reload", async () => {
    useDetails.getState().show("a");
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(stored.state).toEqual({ open: true, selectedId: "a" });
    const raw = localStorage.getItem(KEY) ?? "";
    // Clearing the store writes the cleared state; a new visit finds what was stored before.
    useDetails.setState({ open: false, selectedId: null });
    localStorage.setItem(KEY, raw);
    await useDetails.persist.rehydrate();
    expect(useDetails.getState()).toMatchObject({
      open: true,
      selectedId: "a",
    });
  });

  it("ignores a damaged stored value", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { open: "yes", selectedId: 4 }, version: 1 }),
    );
    await useDetails.persist.rehydrate();
    expect(useDetails.getState()).toMatchObject({
      open: false,
      selectedId: null,
    });
  });
});

describe("known songs", () => {
  it("replaces the known songs with the page's", () => {
    useKnownClips.getState().sync([clip("a"), clip("b")]);
    expect(Object.keys(useKnownClips.getState().known)).toEqual(["a", "b"]);
    useKnownClips.getState().sync([clip("c")]);
    expect(Object.keys(useKnownClips.getState().known)).toEqual(["c"]);
  });

  it("never touches the stored choice: a page filling it in before the panel has read it must not erase what was remembered", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { open: true, selectedId: "a" }, version: 1 }),
    );
    useKnownClips.getState().sync([clip("a")]);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").state).toEqual({
      open: true,
      selectedId: "a",
    });
  });

  it("drops trashed songs from both, clearing the selection when it was one of them", () => {
    useKnownClips.getState().sync([clip("a"), clip("b")]);
    useDetails.getState().show("a");
    dropFromDetails(["b"]);
    expect(useDetails.getState().selectedId).toBe("a");
    expect(Object.keys(useKnownClips.getState().known)).toEqual(["a"]);
    dropFromDetails(["a"]);
    expect(useDetails.getState().selectedId).toBeNull();
    expect(useKnownClips.getState().known).toEqual({});
  });
});

describe("a page's songs", () => {
  it("are known while the page is on screen and forgotten when it goes", () => {
    const songs = [clip("a"), clip("b")];
    const { unmount, rerender } = renderHook(
      ({ list }) => useDetailsClips(list),
      { initialProps: { list: songs } },
    );
    expect(Object.keys(useKnownClips.getState().known)).toEqual(["a", "b"]);
    rerender({ list: [clip("c")] });
    expect(Object.keys(useKnownClips.getState().known)).toEqual(["c"]);
    unmount();
    expect(useKnownClips.getState().known).toEqual({});
  });
});
