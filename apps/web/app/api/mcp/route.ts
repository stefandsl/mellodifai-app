import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { buildMcpServer } from "@/lib/mcp/server";
import { bearerCtx } from "@/lib/ops/bearer";
import { mcpResource } from "../../../../../ops/lib/auth-origins";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await bearerCtx(request, ["pat", "oauth"]);
    if (!ctx) {
      const metadata = new URL(
        "/.well-known/oauth-protected-resource/api/mcp",
        mcpResource(process.env.SITE_URL),
      );
      return Response.json(
        { error: { code: "unauthorized", message: "Authentication required" } },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${metadata.href}"`,
          },
        },
      );
    }
    const server = buildMcpServer(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  } catch {
    return Response.json(
      { error: { code: "internal", message: "Internal error" } },
      { status: 500 },
    );
  }
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
