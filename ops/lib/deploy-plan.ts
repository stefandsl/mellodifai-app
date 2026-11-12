import type { Runner } from "./run.js";

export type DeployInput = {
  target: string;
  hasAuth: boolean;
  skipMigrations: boolean;
};
export type DeployStep = {
  kind:
    | "stop"
    | "backup"
    | "checkout"
    | "check-no-keys"
    | "install"
    | "migrate"
    | "passwords"
    | "set-owner"
    | "build-ops"
    | "build-web"
    | "build-auth"
    | "start"
    | "health";
  target: string;
  hasAuth: boolean;
};

export function planDeploy(input: DeployInput): DeployStep[] {
  const kinds: DeployStep["kind"][] = [
    "stop",
    "backup",
    "checkout",
    "check-no-keys",
    "install",
  ];
  if (!input.skipMigrations) kinds.push("migrate");
  kinds.push("passwords", "set-owner", "build-ops", "build-web");
  if (input.hasAuth) kinds.push("build-auth");
  kinds.push("start", "health");
  return kinds.map((kind) => ({
    kind,
    target: input.target,
    hasAuth: input.hasAuth,
  }));
}

export async function assertAtOrAfterFloor(
  repo: string,
  target: string,
  runner: Runner,
): Promise<void> {
  const floor = await runner(
    "git",
    ["rev-parse", "--verify", "refs/tags/m1-floor^{commit}"],
    { cwd: repo },
  );
  if (floor.code !== 0)
    throw new Error("Deploy refused: m1-floor does not exist");
  const commit = await runner(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${target}^{commit}`],
    { cwd: repo },
  );
  if (commit.code !== 0) throw new Error("Deploy target does not exist");
  const ancestor = await runner(
    "git",
    ["merge-base", "--is-ancestor", floor.stdout.trim(), commit.stdout.trim()],
    { cwd: repo },
  );
  if (ancestor.code !== 0)
    throw new Error("Deploy target does not contain m1-floor");
}

export interface DeployActions {
  step(step: DeployStep): Promise<void>;
  migrations(): Promise<string[]>;
  fakeStack(): Promise<boolean>;
  rollback(): Promise<void>;
  log(message: string): Promise<void>;
}

export async function runDeploy(
  input: DeployInput,
  actions: DeployActions,
): Promise<void> {
  if (await actions.fakeStack())
    throw new Error("Production fake_stack is on; deploy refused");
  const before = await actions.migrations();
  let current = "preflight";
  try {
    for (const step of planDeploy(input)) {
      current = step.kind;
      if (step.kind === "start" && (await actions.fakeStack()))
        throw new Error("Production fake_stack is on");
      await actions.step(step);
    }
  } catch {
    let result = "services stopped; manual recovery required";
    try {
      await actions.step({
        kind: "stop",
        target: input.target,
        hasAuth: input.hasAuth,
      });
      if (current === "health") {
        const after = await actions.migrations();
        if (
          JSON.stringify([...before].sort()) ===
          JSON.stringify([...after].sort())
        ) {
          await actions.rollback();
          result = "previous commit restored";
        }
      }
    } catch {
      // A failed rollback must not leave a partially started application running.
      try {
        await actions.step({
          kind: "stop",
          target: input.target,
          hasAuth: input.hasAuth,
        });
      } catch {
        result = "service stop failed; owner must stop writers";
      }
    }
    const message = `Deploy failed at ${current}; ${result}`;
    await actions.log(message);
    throw new Error(message);
  }
}
