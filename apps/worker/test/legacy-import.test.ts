import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LANGS } from "@mellodifai/shared";
import { describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine.js";
import {
  createLegacyFiles,
  importLegacy,
  type LegacyImportDb,
  type LegacyImportFiles,
} from "../src/legacy-import.js";
import { transcodePreview } from "../src/preview.js";

class FakeDb implements LegacyImportDb {
  completed = new Set<string>();
  async isComplete(projectId: string, lang: string) {
    return this.completed.has(`${projectId}/${lang}`);
  }
  async markComplete(versionId: string) {
    const version = this.versions.find((v) => v.id === versionId);
    if (version) this.completed.add(`${version.project_id}/${version.lang}`);
  }
  projects: { id: string; owner_id: string; topic: string; theme: string }[] =
    [];
  versions: {
    id: string;
    project_id: string;
    owner_id: string;
    lang: string;
    chosen_take_id?: string;
  }[] = [];
  takes: { id: string; version_id: string }[] = [];
  renders: { version_id: string; kind: "master" | "hook" }[] = [];

  async findProject(ownerId: string, topic: string) {
    return this.projects.find(
      (project) => project.owner_id === ownerId && project.topic === topic,
    );
  }
  async createProject(ownerId: string, topic: string, brief: string) {
    const project = {
      id: `project-${this.projects.length + 1}`,
      owner_id: ownerId,
      topic,
      brief,
      theme: "vbp",
    };
    this.projects.push(project);
    return project;
  }
  async upsertVersion(input: {
    project_id: string;
    owner_id: string;
    lang: string;
  }) {
    let version = this.versions.find(
      (item) =>
        item.project_id === input.project_id && item.lang === input.lang,
    );
    if (!version) {
      version = { id: `version-${this.versions.length + 1}`, ...input };
      this.versions.push(version);
    }
    return version;
  }
  async upsertTake(input: { version_id: string }) {
    let take = this.takes.find((item) => item.version_id === input.version_id);
    if (!take) {
      take = { id: `take-${this.takes.length + 1}`, ...input };
      this.takes.push(take);
    }
    return take;
  }
  async setChosenTake(versionId: string, takeId: string) {
    const version = this.versions.find((item) => item.id === versionId);
    if (version) version.chosen_take_id = takeId;
  }
  async upsertRender(input: { version_id: string; kind: "master" | "hook" }) {
    if (
      !this.renders.some(
        (item) =>
          item.version_id === input.version_id && item.kind === input.kind,
      )
    )
      this.renders.push(input);
  }
}

const files: LegacyImportFiles = {
  async readPack(lang) {
    return {
      title: `${lang} title`,
      lyrics: "lyrics",
      style: "style",
      exclude: "",
      settings: {},
      displayMap: {},
      l10n: {},
    };
  },
  videoPath: (lang) => `final/${lang}/video.mp4`,
  hookPath: (lang) => `final/${lang}/hook.mp4`,
  async uploads() {
    return [];
  },
};

describe("importLegacy", () => {
  it("replaces old preview objects on completed imports without changing rows", async () => {
    const db = new FakeDb();
    const objects = new Map<string, string>([
      ["previews/owner/project-1/it/video-720p.mp4", "old-large"],
    ]);
    const upload = vi.fn(async (value: { path: string; localFile: string }) => {
      objects.set(value.path, value.localFile);
    });
    const inputs = {
      ...files,
      upload,
      uploads: async () => [
        {
          path: "previews/owner/project-1/it/video-720p.mp4",
          localFile: "small-video",
          contentType: "video/mp4",
        },
        {
          path: "previews/owner/project-1/it/hook.mp4",
          localFile: "small-hook",
          contentType: "video/mp4",
        },
      ],
    };
    await importLegacy({
      db,
      files: inputs,
      ownerId: "owner",
      languages: ["it"],
    });
    const rows = JSON.stringify(db);
    objects.set("previews/owner/project-1/it/video-720p.mp4", "old-large");
    await importLegacy({
      db,
      files: inputs,
      ownerId: "owner",
      languages: ["it"],
    });
    expect(objects.get("previews/owner/project-1/it/video-720p.mp4")).toBe(
      "small-video",
    );
    expect(objects.get("previews/owner/project-1/it/hook.mp4")).toBe(
      "small-hook",
    );
    expect(JSON.stringify(db)).toBe(rows);
    expect(upload).toHaveBeenCalledTimes(4);
  });
  it("imports filesystem packs and real previews for all languages twice into a fake database", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-legacy-test-"));
    try {
      const versions = join(root, "versions");
      const final = join(root, "final");
      const previews = join(root, "previews");
      const source = join(root, "fixture.mp4");
      await promisify(execFile)(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=32x32:r=1:d=1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          source,
        ],
        { windowsHide: true },
      );
      for (const lang of LANGS) {
        const pack = join(versions, lang);
        const render = join(final, lang);
        await mkdir(pack, { recursive: true });
        await mkdir(render, { recursive: true });
        for (const [name, content] of Object.entries({
          "title.txt": `${lang} fixture title`,
          "lyrics.txt": "Fixture lyrics",
          "style.txt": "Fixture style",
          "exclude.txt": "",
          "settings.json": "{}",
          "display-map.json": "{}",
          "storyboard-l10n.json": "{}",
        }))
          await writeFile(join(pack, name), content);
        await copyFile(source, join(render, "video.mp4"));
        await copyFile(source, join(render, "hook.mp4"));
        await writeFile(
          join(final, `${lang}.srt`),
          "1\n00:00:00,000 --> 00:00:01,000\nFixture\n",
        );
      }
      const db = new FakeDb();
      const encode = async (input: string, output: string) => {
        expect(output.startsWith(previews)).toBe(true);
        await transcodePreview(
          new Engine({ log: async () => {} }),
          input,
          output,
        );
      };
      const realFiles = createLegacyFiles(versions, final, encode, previews);
      const upload = vi.fn(async ({ localFile }: { localFile: string }) => {
        expect((await readFile(localFile)).length).toBeGreaterThan(0);
      });
      await importLegacy({
        db,
        files: { ...realFiles, upload },
        ownerId: "owner",
      });
      const calls = upload.mock.calls.length;
      expect(calls).toBe(33);
      await importLegacy({
        db,
        files: { ...realFiles, upload },
        ownerId: "owner",
      });
      expect(db.versions).toHaveLength(11);
      expect(db.renders).toHaveLength(22);
      expect(upload).toHaveBeenCalledTimes(calls * 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
  it("retries an interrupted upload and only marks completion after success", async () => {
    const db = new FakeDb();
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("interrupted"))
      .mockResolvedValue(undefined);
    const inputs = {
      ...files,
      upload,
      uploads: async () => [
        { path: "preview", localFile: "local", contentType: "video/mp4" },
      ],
    };
    await expect(
      importLegacy({ db, files: inputs, ownerId: "owner", languages: ["it"] }),
    ).rejects.toThrow("interrupted");
    expect(db.completed.size).toBe(0);
    await importLegacy({
      db,
      files: inputs,
      ownerId: "owner",
      languages: ["it"],
    });
    expect(db.completed.size).toBe(1);
    expect(db.versions).toHaveLength(1);
    expect(db.renders).toHaveLength(2);
  });
  it("imports all eleven languages and refreshes previews without rewriting rows", async () => {
    const db = new FakeDb();
    const readPack = vi.fn(files.readPack);
    const onLanguage = vi.fn();
    const upload = vi.fn(async () => {});
    const inputs = {
      ...files,
      readPack,
      upload,
      uploads: async () => [
        { path: "preview", localFile: "local", contentType: "video/mp4" },
      ],
    };
    await importLegacy({ db, files: inputs, ownerId: "owner", onLanguage });
    expect(db.versions).toHaveLength(11);
    expect(onLanguage.mock.calls.map(([lang]) => lang)).toEqual(LANGS);
    const before = JSON.stringify(db);
    await importLegacy({ db, files: inputs, ownerId: "owner" });
    expect(JSON.stringify(db)).toBe(before);
    expect(readPack).toHaveBeenCalledTimes(11);
    expect(upload).toHaveBeenCalledTimes(22);
    expect(db.projects[0]?.topic).toBe("Va bene, passa (VBP)");
    expect(db.projects[0]).toMatchObject({
      brief: "Office satire about AI in the workplace, 11 languages",
    });
  });
  it("is idempotent when run twice", async () => {
    const db = new FakeDb();
    await importLegacy({
      db,
      files,
      ownerId: "owner",
      languages: ["it", "fr"],
    });
    await importLegacy({
      db,
      files,
      ownerId: "owner",
      languages: ["it", "fr"],
    });
    expect(db.projects).toHaveLength(1);
    expect(db.versions).toHaveLength(2);
    expect(db.takes).toHaveLength(2);
    expect(db.renders).toHaveLength(4);
    expect(db.versions.every((version) => version.chosen_take_id)).toBe(true);
  });
});
