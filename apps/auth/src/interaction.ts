import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type Provider from "oidc-provider";
import { digest, type OpsCall } from "./adapter.js";

export function flowCookie(issuer: string, nonce: string): string {
  const secure = new URL(issuer).protocol === "https:";
  return `${secure ? "__Host-mdf_flow" : "mdf_flow"}=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${secure ? "; Secure" : ""}`;
}

export async function interaction(
  req: IncomingMessage,
  res: ServerResponse,
  provider: Provider,
  call: OpsCall,
  issuer: string,
  uid: string,
  resume: boolean,
) {
  res.setHeader("Cache-Control", "no-store");
  try {
    // Check the signed library cookie before setting or consuming a flow nonce.
    const details = await provider.interactionDetails(req, res);
    if (details.uid !== uid) throw new Error("Interaction mismatch");
    if (!resume) {
      const nonce = randomBytes(32).toString("base64url");
      await call("oauth_flow_nonce_set", [uid, digest(nonce)]);
      res.setHeader("Set-Cookie", flowCookie(issuer, nonce));
      res
        .writeHead(303, { location: `/consent?uid=${encodeURIComponent(uid)}` })
        .end();
      return;
    }
    const name =
      new URL(issuer).protocol === "https:" ? "__Host-mdf_flow" : "mdf_flow";
    const cookies = (req.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.startsWith(`${name}=`));
    const nonce = cookies[0]?.slice(name.length + 1);
    if (cookies.length !== 1 || !nonce || !/^[A-Za-z0-9_-]{43}$/u.test(nonce))
      throw new Error("Flow cookie required");
    const decision = (await call("oauth_interaction_result", [uid, nonce])) as {
      user_id: string;
      client_id: string;
      scopes: string[];
    };
    if (
      !decision ||
      decision.client_id !== details.params.client_id ||
      !decision.user_id ||
      !Array.isArray(decision.scopes) ||
      !decision.scopes.every((scope) =>
        ["read", "create", "spend"].includes(scope),
      )
    )
      throw new Error("Invalid consent");
    const grant = new provider.Grant({
      accountId: decision.user_id,
      clientId: decision.client_id,
    });
    const resource = new URL("/api/mcp", issuer).href;
    grant.addResourceScope(resource, decision.scopes.join(" "));
    // Record unchecked scopes as rejected so the provider does not ask again.
    const requested = String(details.params.scope ?? "").split(" ");
    grant.rejectResourceScope(
      resource,
      requested.filter(
        (scope) =>
          ["read", "create", "spend"].includes(scope) &&
          !decision.scopes.includes(scope),
      ),
    );
    grant.rejectOIDCScope(
      requested.filter((scope) => ["openid", "offline_access"].includes(scope)),
    );
    const grantId = await grant.save();
    await call("oauth_bind_grant", [uid, grantId]);
    await provider.interactionFinished(
      req,
      res,
      { login: { accountId: decision.user_id }, consent: { grantId } },
      { mergeWithLastSubmission: false },
    );
  } catch {
    // Do not expose URLs, cookies, database errors or OAuth credentials.
    if (!res.headersSent)
      res
        .writeHead(403)
        .end(
          "Avvia di nuovo il collegamento dal tuo agente in questo browser.",
        );
    else res.end();
  }
}
