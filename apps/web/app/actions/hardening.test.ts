// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({
      data: {
        id: "publication",
        render_id: "render",
        version_id: "version",
        project_id: "project",
      },
      error: null,
    })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({
      data: "project",
      error: null as { message: string } | null,
    })),
    auth: vi.fn(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/locale", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth", () => ({
  actionProfile: async () => {
    mocks.auth();
    return { supabase: mocks, user: { id: "owner" } };
  },
}));

import { revalidatePath } from "next/cache";
import {
  approveLyrics,
  approveVideo,
  backToLyrics,
  generateAgain,
  pickTake,
  rerenderVideo,
  resolveKieSubmission,
  resolveUpload,
  retryStage,
  setPrivacy,
  uploadPrivate,
} from "./checkpoints";
import { createProject } from "./project";

const id = "00000000-0000-4000-8000-000000000001";
it("redacts JWT and Supabase keys before logging server action failures", async () => {
  const { runAction } = await import("@/lib/run-action");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const credentials = [
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.signature",
    "sb_secret_Abc123_xyz",
    "sb_publishable_Abc123_xyz",
  ];
  for (const plain of [false, true]) {
    const message = `request failed ${credentials.join(" ")}`;
    await runAction(async () => {
      throw plain ? { message } : new Error(message);
    });
  }
  const logged = JSON.stringify(log.mock.calls);
  expect(logged).toContain("request failed");
  for (const credential of credentials)
    expect(logged).not.toContain(credential);
  log.mockRestore();
});
it("routes both resolution forms through owned recovery RPCs and revalidates", async () => {
  await resolveUpload({ publicationId: id, uploaded: true, videoId: "abc123" });
  expect(mocks.rpc).toHaveBeenCalledWith("resolve_upload", {
    p_publication: id,
    p_uploaded: true,
    p_video_id: "abc123",
  });
  await resolveUpload({ publicationId: id, uploaded: false });
  expect(mocks.rpc).toHaveBeenCalledWith("resolve_upload", {
    p_publication: id,
    p_uploaded: false,
    p_video_id: null,
  });
  await resolveKieSubmission({
    versionId: id,
    charged: true,
    taskId: "task-1",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("resolve_kie_submission", {
    p_version: id,
    p_charged: true,
    p_task_id: "task-1",
  });
  await backToLyrics({ versionId: id });
  expect(mocks.rpc).toHaveBeenCalledWith("back_to_lyrics", { p_version: id });
  expect(revalidatePath).toHaveBeenCalledWith("/projects/project");
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: "project", error: null });
});
it("picks atomically and revalidates the project rather than version path", async () => {
  expect(await pickTake({ versionId: id, takeId: id })).toEqual({
    ok: true,
    id: "project",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("pick_take", {
    p_version: id,
    p_take: id,
  });
  expect(revalidatePath).toHaveBeenCalledWith("/projects/project");
});
it("sends expected generation, override reason and render request to separate RPCs", async () => {
  await generateAgain({ versionId: id, generation: 4 });
  await rerenderVideo({ versionId: id });
  await approveVideo({ versionId: id, overrideReason: "Reviewed loudness" });
  expect(mocks.rpc).toHaveBeenCalledWith("generate_again", {
    p_version: id,
    p_generation: 4,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("render_again", { p_version: id });
  expect(mocks.rpc).toHaveBeenCalledWith("approve_video", {
    p_version: id,
    p_override_reason: "Reviewed loudness",
  });
  expect(mocks.auth).toHaveBeenCalledTimes(3);
});
it("confirms scheduled publication and refreshes its project", async () => {
  await setPrivacy({
    publicationId: id,
    privacy: "scheduled",
    publishAt: "2099-01-01T00:00:00Z",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("confirm_publication", {
    p_publication: id,
    p_privacy: "scheduled",
    p_publish_at: "2099-01-01T00:00:00Z",
  });
  expect(revalidatePath).toHaveBeenCalledWith("/projects/project");
});
it("creates a deduplicated project in one RPC", async () => {
  await createProject({
    topic: "Song",
    style: "Pop",
    vocalGender: "f",
    languages: ["en", "en"],
  });
  expect(mocks.rpc).toHaveBeenCalledWith(
    "create_project",
    expect.objectContaining({ p_languages: ["en"] }),
  );
  expect(mocks.from).not.toHaveBeenCalled();
});
it("all actions return failures for malformed input instead of throwing", async () => {
  for (const action of [
    approveLyrics,
    approveVideo,
    generateAgain,
    pickTake,
    rerenderVideo,
    setPrivacy,
    uploadPrivate,
    retryStage,
    createProject,
  ])
    expect(await action({})).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("database errors are returned without leaking raw database details", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: "",
    error: { message: "secret internal detail" },
  });
  expect(await pickTake({ versionId: id, takeId: id })).toEqual({
    ok: false,
    error: "Action failed. Please try again.",
  });
});
