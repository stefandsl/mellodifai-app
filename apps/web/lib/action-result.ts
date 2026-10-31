export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
export type ActionCallback = () =>
  | void
  | ActionResult
  | Promise<void>
  | Promise<ActionResult>;
