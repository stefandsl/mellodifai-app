import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { getAdminId, signIn } from "./support";
import {
  authorization,
  CLIENT_NAME,
  digest,
  exchangeCode,
  expectAuthorizationError,
  OAUTH_ORIGIN,
  OAUTH_REDIRECT,
  OAUTH_RESOURCE,
  oauthSql,
  registerClient,
  songGet,
} from "./support/oauth-client";

test.use({
  baseURL: OAUTH_ORIGIN,
  trace: "off",
  screenshot: "off",
  video: "off",
  actionTimeout: 30_000,
});

test("OAuth pairs once, binds read-only consent to the browser, and revokes MCP access", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const sql = oauthSql();
  const userId = await getAdminId();
  const projectId = randomUUID();
  const versionId = randomUUID();
  let clientId: string | undefined;
  const [flag] =
    await sql`select * from public.app_flags where flag = 'remote_mcp'`;
  const [pairing] = await sql`select * from public.oauth_pairing where id`;
  try {
    await sql`update public.app_flags set enabled = true where flag = 'remote_mcp'`;
    await sql`update public.oauth_pairing set open_until = null where id`;
    // No jobs or worker: song_get reads an inert fixture, even if a regression widens scopes.
    await sql`insert into public.projects(id, owner_id, topic) values(${projectId}, ${userId}, 'OAuth E2E')`;
    await sql`insert into public.versions(id, owner_id, project_id, lang, status, test_run)
      values(${versionId}, ${userId}, ${projectId}, 'it', 'failed', true)`;

    await test.step("proxy discovery and one registration per pairing window", async () => {
      for (const path of [
        "/oauth/.well-known/openid-configuration",
        "/.well-known/oauth-authorization-server/oauth",
        "/.well-known/openid-configuration/oauth",
      ]) {
        const response = await request.get(`${OAUTH_ORIGIN}${path}`);
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({
          issuer: `${OAUTH_ORIGIN}/oauth`,
          authorization_endpoint: `${OAUTH_ORIGIN}/oauth/auth`,
          token_endpoint: `${OAUTH_ORIGIN}/oauth/token`,
          code_challenge_methods_supported: ["S256"],
        });
      }
      const metadata = await request.get(
        `${OAUTH_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`,
      );
      expect(metadata.status()).toBe(200);
      expect(await metadata.json()).toMatchObject({ resource: OAUTH_RESOURCE });
      expect((await registerClient(request)).status()).toBe(403);
      await sql`update public.oauth_pairing set open_until = now() + interval '10 minutes' where id`;
      expect(
        (
          await registerClient(request, "https://refused.example/callback")
        ).status(),
      ).toBe(400);
      const registered = await registerClient(request);
      expect(registered.status()).toBe(201);
      clientId = (await registered.json()).client_id;
      expect(typeof clientId).toBe("string");
      expect((await registerClient(request)).status()).toBe(403);
      const [claimed] =
        await sql`select client_id, open_until from public.oauth_pairing where id`;
      expect(claimed.client_id === clientId).toBe(true);
      expect(new Date(claimed.open_until).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    const flow = authorization(clientId as string);
    await test.step("authorization requires S256 PKCE and the registered redirect", async () => {
      const missing = new URL(flow.url);
      missing.searchParams.delete("code_challenge");
      missing.searchParams.delete("code_challenge_method");
      await expectAuthorizationError(request, missing, "invalid_request");
      const plain = new URL(flow.url);
      plain.searchParams.set("code_challenge_method", "plain");
      await expectAuthorizationError(request, plain, "invalid_request");
      const refused = new URL(flow.url);
      refused.searchParams.set("redirect_uri", `${OAUTH_ORIGIN}/unregistered`);
      await expectAuthorizationError(request, refused, "invalid_redirect_uri");
    });

    await signIn(page);
    await page.goto("/settings/agents");
    await expect(
      page.getByRole("switch", { name: "MCP remoto", exact: true }),
    ).toBeVisible();
    for (const name of [
      "Leggere",
      "Creare",
      "Spendere",
      "Uso remoto",
      "Test (provider simulati)",
    ]) {
      await expect(
        page.getByRole("checkbox", { name, exact: true }),
      ).toBeVisible();
    }
    await page.goto(flow.url.href);
    await expect(
      page.getByRole("heading", { name: "Collega un agente" }),
    ).toBeVisible();
    const consentUrl = page.url();
    const uid = new URL(consentUrl).searchParams.get("uid");
    expect(Boolean(uid)).toBe(true);
    const cookies = await page.context().cookies();
    const nonce = cookies.find((cookie) => cookie.name === "mdf_flow")?.value;
    expect(Boolean(nonce)).toBe(true);
    if (!uid || !nonce)
      throw new Error("The browser-bound OAuth flow is missing");

    await test.step("a signed-in second browser without the flow cookie is refused", async () => {
      const other = await browser.newContext({ baseURL: OAUTH_ORIGIN });
      try {
        // Keep the same login and provider cookies: only the flow cookie is missing.
        await other.addCookies(
          cookies.filter((cookie) => cookie.name !== "mdf_flow"),
        );
        const otherPage = await other.newPage();
        await otherPage.goto(consentUrl);
        await expect(otherPage.getByRole("alert")).toHaveText(
          "Avvia di nuovo il collegamento dal tuo agente in questo browser.",
        );
        await expect(
          otherPage.getByRole("button", { name: "Autorizza" }),
        ).toHaveCount(0);
        expect(
          (
            await other.request.get(
              `${OAUTH_ORIGIN}/oauth/interaction/${uid}/resume`,
              { maxRedirects: 0 },
            )
          ).status(),
        ).toBe(403);
      } finally {
        await other.close();
      }
    });

    let code = "";
    await test.step("consent defaults to read only and returns a code with matching state", async () => {
      await expect(page.getByText(CLIENT_NAME, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("checkbox", { name: "Leggere", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("checkbox", { name: "Creare", exact: true }),
      ).not.toBeChecked();
      await expect(
        page.getByRole("checkbox", { name: "Spendere", exact: true }),
      ).not.toBeChecked();
      await page
        .getByRole("checkbox", {
          name: "Test (provider simulati)",
          exact: true,
        })
        .check();
      // The client receives its callback in memory; no fourth server or code log.
      await page.route(`${OAUTH_REDIRECT}?**`, (route) =>
        route.fulfill({
          contentType: "text/plain",
          body: "Collegamento completato.",
        }),
      );
      const resume = `${OAUTH_ORIGIN}/oauth/interaction/${uid}/resume`;
      // Pause navigation after consent, before the provider consumes the Interaction.
      await page.route(resume, (route) =>
        route.fulfill({
          contentType: "text/plain",
          body: "Consenso ricevuto.",
        }),
      );
      await page
        .getByRole("button", { name: "Autorizza", exact: true })
        .click();
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toBe(new URL(resume).pathname);
      await test.step("SQL refuses nonce replay while the matching Interaction remains live", async () => {
        const rollback = new Error("Rollback nonce replay probe");
        await sql
          .begin(async (tx) => {
            await tx`grant mdf_auth to postgres with set true`;
            await tx`set local role mdf_auth`;
            const [decision] =
              await tx`select ops.oauth_interaction_result(${uid}, ${nonce}) as result`;
            expect(decision.result.scopes).toEqual(["read"]);
            await tx`reset role`;
            const [interaction] = await tx`select expires_at > now() as live,
            flow_nonce_hash = ${digest(nonce)} as matches
            from public.oauth_store where model = 'Interaction' and uid = ${uid}`;
            expect(interaction).toEqual({ live: true, matches: true });
            await tx`set local role mdf_auth`;
            await expect(
              tx.savepoint(async (sp) => {
                await sp`select ops.oauth_interaction_result(${uid}, ${nonce})`;
              }),
            ).rejects.toMatchObject({ code: "MDF03" });
            throw rollback;
          })
          .catch((error: unknown) => {
            if (error !== rollback) throw error;
          });
      });
      // Rollback preserves the unused consent for the real provider round trip.
      await page.unroute(resume);
      await page.goto(resume);
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toBe("/oauth-client/callback");
      const callback = new URL(page.url());
      expect(callback.searchParams.get("state") === flow.state).toBe(true);
      expect(callback.searchParams.has("error")).toBe(false);
      code = callback.searchParams.get("code") ?? "";
      expect(Boolean(code)).toBe(true);
      const [consent] =
        await sql`select scopes, used_at, test_mode from public.oauth_consents where uid = ${uid}`;
      expect(consent.scopes).toEqual(["read"]);
      expect(consent.test_mode).toBe(true);
      expect(consent.used_at).not.toBeNull();
    });

    await test.step("the completed interaction cannot resume again", async () => {
      expect(
        (
          await page.request.get(
            `${OAUTH_ORIGIN}/oauth/interaction/${uid}/resume`,
            { maxRedirects: 0 },
          )
        ).status(),
      ).toBe(403);
    });

    await test.step("PKCE exchange, song_get, and immediate revocation", async () => {
      const wrong = await exchangeCode(
        request,
        clientId as string,
        code,
        "x".repeat(43),
      );
      expect(wrong.status()).toBe(400);
      expect((await wrong.json()).error).toBe("invalid_grant");
      const exchanged = await exchangeCode(
        request,
        clientId as string,
        code,
        flow.verifier,
      );
      expect(exchanged.status()).toBe(200);
      const token = await exchanged.json();
      expect(token.scope).toBe("read");
      expect(token.token_type).toBe("Bearer");
      expect(typeof token.access_token).toBe("string");
      const response = await songGet(request, token.access_token, versionId);
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.error).toBeUndefined();
      expect(result.result.isError).not.toBe(true);
      expect(result.result.structuredContent).toMatchObject({
        version_id: versionId,
        project_id: projectId,
      });
      const [grant] =
        await sql`select token_id from public.oauth_consents where uid = ${uid}`;
      const [session] =
        await sql`select id from auth.sessions where user_id = ${userId} order by created_at desc limit 1`;
      const ctx = {
        actor_kind: "session",
        user_id: userId,
        session_id: session.id,
        remote: false,
      };
      const [revoked] =
        await sql`select ops.admin_token_revoke(${sql.json(ctx)}, ${grant.token_id}) as result`;
      expect(revoked.result.ok).toBe(true);
      expect(
        (await songGet(request, token.access_token, versionId)).status(),
      ).toBe(401);
    });
  } finally {
    try {
      if (clientId) {
        await sql`delete from public.oauth_store where payload->>'clientId' = ${clientId}
          or payload->>'client_id' = ${clientId} or payload->'params'->>'client_id' = ${clientId}
          or (model = 'Client' and id_hash = ${digest(clientId)})`;
        await sql`delete from public.spend_caps where scope = 'token' and key in
          (select id::text from public.agent_tokens where oauth_client_id = ${clientId})`;
        await sql`delete from public.agent_tokens where oauth_client_id = ${clientId}`;
      }
      await sql`delete from public.projects where id = ${projectId}`;
      await sql`update public.app_flags set ${sql(flag)} where flag = 'remote_mcp'`;
      await sql`update public.oauth_pairing set ${sql(pairing)} where id`;
    } finally {
      await sql.end();
    }
  }
});

test("oauth_upsert refuses a bound grant without a matching used consent", async () => {
  const sql = oauthSql();
  try {
    const userId = await getAdminId();
    const grantId = randomUUID();
    const clientId = randomUUID();
    await expect(
      sql.begin(async (tx) => {
        await tx`insert into public.agent_tokens(owner_id, kind, name, scopes, remote, expires_at, grant_id, oauth_client_id)
        values(${userId}, 'oauth', 'No consent', array['read'], true, now() + interval '1 day', ${grantId}, ${clientId})`;
        await tx`grant mdf_auth to postgres with set true`;
        await tx`set local role mdf_auth`;
        await tx`select ops.oauth_upsert('AccessToken', ${digest(randomUUID())},
        ${tx.json({ clientId, grantId, scope: "read", aud: OAUTH_RESOURCE })},
        ${grantId}, null, now() + interval '5 minutes')`;
        throw new Error("oauth_upsert accepted a grant without consent");
      }),
    ).rejects.toMatchObject({ code: "MDF03" });
  } finally {
    await sql.end();
  }
});
