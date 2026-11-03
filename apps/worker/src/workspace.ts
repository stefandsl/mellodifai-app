import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Lang } from "@mellodifai/shared";

export type Workspace = {
  root: string;
  versionsDir: string;
  outDir: string;
  publicDir: string;
  renderDir: string;
};

export class WorkspaceFactory {
  constructor(
    private readonly projectsRoot = "E:\\mellodifai\\projects",
    private readonly fontsSource = "C:\\Users\\Asus\\Documents\\suno-remake\\motion\\public\\fonts",
  ) {}
  async forVersion(
    projectId: string,
    lang: Lang,
    renderAttempt = 1,
  ): Promise<Workspace> {
    const root = join(this.projectsRoot, projectId, lang);
    const versionsDir = join(root, "versions", lang);
    const outDir = join(root, "out", lang);
    const publicDir = join(root, "public");
    const renderDir = join(root, "render", String(renderAttempt));
    await Promise.all([
      mkdir(versionsDir, { recursive: true }),
      mkdir(outDir, { recursive: true }),
      mkdir(join(publicDir, "data", lang), { recursive: true }),
      mkdir(join(publicDir, "audio"), { recursive: true }),
      mkdir(join(root, "stems"), { recursive: true }),
      mkdir(renderDir, { recursive: true }),
    ]);
    const fontsDestination = join(publicDir, "fonts");
    try {
      await stat(fontsDestination);
    } catch {
      if (process.env.WORKER_FAKE === "1")
        await mkdir(fontsDestination, { recursive: true });
      else await cp(this.fontsSource, fontsDestination, { recursive: true });
    }
    return { root, versionsDir, outDir, publicDir, renderDir };
  }
}
