import { LANGS } from "@mellodifai/shared";
import { describe, expect, it, vi } from "vitest";
import {
  createLegacyFiles,
  importLegacy,
  type LegacyImportDb,
  type LegacyImportFiles,
} from "../src/legacy-import.js";

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
  it.runIf(process.env.TEST_LEGACY_FILES === "1")(
    "imports real shipped packs for all languages twice into a fake database",
    async () => {
      const db = new FakeDb();
      const realFiles = createLegacyFiles();
      const upload = vi.fn(async () => {});
      await importLegacy({
        db,
        files: { ...realFiles, upload },
        ownerId: "owner",
        onLanguage: (lang) => console.log(`${lang}: imported (fake database)`),
      });
      const calls = upload.mock.calls.length;
      await importLegacy({
        db,
        files: { ...realFiles, upload },
        ownerId: "owner",
      });
      expect(db.versions).toHaveLength(11);
      expect(db.renders).toHaveLength(22);
      expect(upload).toHaveBeenCalledTimes(calls);
    },
  );
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
  it("imports all eleven languages and makes the second run a no-op", async () => {
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
    expect(upload).toHaveBeenCalledTimes(11);
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
