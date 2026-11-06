import { runTokenOp } from "./bearer";
import type { TokenOp } from "./registry";

export function tokenRoute(def: TokenOp) {
  return async (
    req: Request,
    context: { params: Promise<Record<string, string>> },
  ) => {
    const params = await context.params;
    let input: unknown;
    if (req.method === "GET") {
      const query: Record<string, unknown> = Object.fromEntries(
        new URL(req.url).searchParams,
      );
      for (const name of ["limit", "events_after"]) {
        if (name in query)
          query[name] = /^\d+$/.test(String(query[name]))
            ? Number(query[name])
            : query[name];
      }
      if (query.include_trashed === "true") query.include_trashed = true;
      if (query.include_trashed === "false") query.include_trashed = false;
      if (query.cursor === "") delete query.cursor;
      input = { ...query, ...params };
    } else {
      try {
        const text = await req.text();
        const body: unknown = text ? JSON.parse(text) : {};
        input =
          body && typeof body === "object" && !Array.isArray(body)
            ? { ...body, ...params }
            : null;
      } catch {
        input = null;
      }
    }
    return runTokenOp(def, req, input);
  };
}
