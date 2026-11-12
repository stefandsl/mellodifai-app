import { createHash, randomBytes } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";
import { ownerConnection } from "../../../../ops/lib/pg";
import { assertTestWebStack } from "../../../../ops/test-db-guard";

export function oauthSql() {
  assertTestWebStack(process.env);
  return ownerConnection(process.env.TEST_DB_URL as string);
}

export const OAUTH_ORIGIN = "http://127.0.0.1:3212";
export const OAUTH_RESOURCE = `${OAUTH_ORIGIN}/api/mcp`;
export const OAUTH_REDIRECT = `${OAUTH_ORIGIN}/oauth-client/callback`;
export const CLIENT_NAME = "MellodifAI E2E";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function registerClient(
  request: APIRequestContext,
  redirect = OAUTH_REDIRECT,
) {
  return request.post(`${OAUTH_ORIGIN}/oauth/reg`, {
    data: {
      client_name: CLIENT_NAME,
      redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  });
}

export function authorization(clientId: string) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL(`${OAUTH_ORIGIN}/oauth/auth`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT,
    response_type: "code",
    scope: "read create spend",
    resource: OAUTH_RESOURCE,
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return { url, verifier, state };
}

export function exchangeCode(
  request: APIRequestContext,
  clientId: string,
  code: string,
  verifier: string,
) {
  return request.post(`${OAUTH_ORIGIN}/oauth/token`, {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: OAUTH_REDIRECT,
      code,
      code_verifier: verifier,
      resource: OAUTH_RESOURCE,
    },
  });
}

export async function expectAuthorizationError(
  request: APIRequestContext,
  url: URL,
  error: string,
) {
  const response = await request.get(url.href, { maxRedirects: 0 });
  expect([302, 303, 400]).toContain(response.status());
  const location = response.headers().location;
  const actual = location
    ? new URL(location, OAUTH_ORIGIN).searchParams.get("error")
    : (await response.json()).error;
  expect(actual).toBe(error);
}

export function songGet(
  request: APIRequestContext,
  token: string,
  versionId: string,
) {
  return request.post(OAUTH_RESOURCE, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "song_get", arguments: { version_id: versionId } },
    },
  });
}
