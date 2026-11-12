import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, it } from "vitest";
import { startScheduler } from "../src/scheduler.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for scheduler integration`);
  return value;
}

it("claims and finishes expire_reservations on the e2e stack", async () => {
  const sql = postgres(required("TEST_DB_URL"), { max: 1 });
  const workerId = `scheduler-test-${crypto.randomUUID()}`;
  const calls: {
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    data: unknown;
  }[] = [];
  const service = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false },
      global: {
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          const body = await response.clone().text();
          calls.push({
            name: url.pathname.split("/").pop() ?? "",
            args: JSON.parse(String(init?.body ?? "{}")),
            ok: response.ok,
            data: body ? JSON.parse(body) : null,
          });
          return response;
        },
      },
    },
  );
  const before = new Date();
  let stop = () => {};
  try {
    await sql`update public.scheduled_tasks set next_run_at = now() where name = 'expire_reservations'`;
    stop = startScheduler(service, workerId, {
      intervalMs: 25,
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      if (
        calls.some(
          (call) =>
            call.name === "finish_scheduled_task" &&
            call.args.p_name === "expire_reservations" &&
            call.args.p_worker === workerId,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const claim = calls.findIndex(
      (call) =>
        call.name === "claim_scheduled_task" &&
        call.args.p_worker === workerId &&
        call.data === "expire_reservations",
    );
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(calls.slice(claim, claim + 3)).toMatchObject([
      {
        name: "claim_scheduled_task",
        args: { p_worker: workerId },
        ok: true,
        data: "expire_reservations",
      },
      { name: "expire_reservations", ok: true },
      {
        name: "finish_scheduled_task",
        args: {
          p_name: "expire_reservations",
          p_worker: workerId,
          p_ok: true,
          p_error: null,
        },
        ok: true,
      },
    ]);
    const [task] = await sql`
      select running_by, last_ok_at, last_error, next_run_at
      from public.scheduled_tasks where name = 'expire_reservations'
    `;
    expect(task?.running_by).toBeNull();
    expect(task?.last_ok_at.getTime()).toBeGreaterThan(before.getTime());
    expect(task?.last_error).toBeNull();
    expect(task?.next_run_at.getTime()).toBeGreaterThan(Date.now());
  } finally {
    stop();
    await sql.end();
  }
}, 15_000);
