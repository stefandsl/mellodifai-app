import { mcpResource, patOnlySite } from "../../../../../ops/lib/auth-origins";

export const runtime = "nodejs";

export function GET(): Response {
  try {
    const resource = mcpResource(process.env.SITE_URL);
    return Response.json({
      resource,
      ...(patOnlySite(process.env.SITE_URL)
        ? {}
        : { authorization_servers: [new URL("/oauth", resource).href] }),
      scopes_supported: ["read", "create", "spend"],
      bearer_methods_supported: ["header"],
    });
  } catch {
    return Response.json(
      { error: { code: "internal", message: "Internal error" } },
      { status: 500 },
    );
  }
}
