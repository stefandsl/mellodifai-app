// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as getAgents } from "@/app/(site)/agents/route";
import { GET as getChangelog } from "@/app/(site)/changelog/route";
import { GET as getPricing } from "@/app/(site)/pricing/route";
import { GET as getRecipeDetail } from "@/app/(site)/recipes/[slug]/route";
import { GET as getRecipeTry } from "@/app/(site)/recipes/[slug]/try/route";
import { GET as getRecipes } from "@/app/(site)/recipes/route";
import { GET as getHome } from "@/app/(site)/route";
import { GET as getIsland } from "@/app/site/islands/[name]/route";
import { GET as getStyle } from "@/app/site/styles/[name]/route";
import { buildSiteStatic } from "../../scripts/build-site-static.mjs";
import { resetStaticSiteCacheForTest } from "./serve-static-site";

const WEB_DIR = resolve(import.meta.dirname, "../..");
const TMP_PARENT = join(WEB_DIR, ".tmp-site-routes-tests");

function makeRequest(url: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(url, { headers });
}

describe("public site static route handlers", () => {
  let outDir = "";
  let built: Awaited<ReturnType<typeof buildSiteStatic>>;
  const prevStaticDir = process.env.SITE_STATIC_DIR;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevWorkerFake = process.env.WORKER_FAKE;

  beforeAll(async () => {
    mkdirSync(TMP_PARENT, { recursive: true });
    outDir = mkdtempSync(join(TMP_PARENT, "routes-"));
    built = await buildSiteStatic(outDir);
    process.env.SITE_STATIC_DIR = outDir;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    resetStaticSiteCacheForTest();
  }, 30_000);

  afterAll(() => {
    if (prevStaticDir === undefined) delete process.env.SITE_STATIC_DIR;
    else process.env.SITE_STATIC_DIR = prevStaticDir;
    if (prevNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        prevNodeEnv;
    }
    if (prevWorkerFake === undefined) delete process.env.WORKER_FAKE;
    else process.env.WORKER_FAKE = prevWorkerFake;
    resetStaticSiteCacheForTest();
    rmSync(outDir, { recursive: true, force: true });
    rmSync(TMP_PARENT, { recursive: true, force: true });
  });

  it("serves /, /pricing, and /recipes with private no-cache, Vary: Cookie, and locale selection", async () => {
    for (const [handler, url] of [
      [getHome, "http://127.0.0.1:3239/"],
      [getPricing, "http://127.0.0.1:3239/pricing"],
      [getChangelog, "http://127.0.0.1:3239/changelog"],
      [getAgents, "http://127.0.0.1:3239/agents"],
      [getRecipes, "http://127.0.0.1:3239/recipes"],
    ] as const) {
      const itRes = await handler(makeRequest(url));
      expect(itRes.status, url).toBe(200);
      expect(itRes.headers.get("cache-control"), url).toBe("private, no-cache");
      expect(itRes.headers.get("vary"), url).toBe("Cookie");
      expect(await itRes.text(), url).toContain('<html lang="it"');

      const enRes = await handler(makeRequest(url, "mellodifai_lang=en"));
      expect(enRes.status, `${url} en`).toBe(200);
      expect(enRes.headers.get("cache-control"), `${url} en`).toBe(
        "private, no-cache",
      );
      expect(enRes.headers.get("vary"), `${url} en`).toBe("Cookie");
      expect(await enRes.text(), `${url} en`).toContain('<html lang="en"');
    }
  });

  it("serves prerendered /agents?agent=<id> for all 5 agents and defaults invalid values to claude", async () => {
    for (const [query, expected] of [
      ["", "claude"],
      ["?agent=claude", "claude"],
      ["?agent=chatgpt", "chatgpt"],
      ["?agent=gemini", "gemini"],
      ["?agent=codex", "codex"],
      ["?agent=cursor", "cursor"],
      ["?agent=unknown", "claude"],
    ] as const) {
      const res = await getAgents(
        makeRequest(
          `http://127.0.0.1:3239/agents${query}`,
          "mellodifai_lang=en",
        ),
      );
      expect(res.status, query || "default").toBe(200);
      const html = await res.text();
      expect(html, query || "default").toContain(
        `data-active-agent="${expected}"`,
      );
      expect(html, query || "default").toContain(
        `id="agent-tab-hero-${expected}" aria-current="page"`,
      );
      expect(html, query || "default").not.toContain('role="tab"');
      expect(html, query || "default").not.toMatch(
        /<a\b[^>]*data-agent-tab=[^>]*tabindex="-1"|<a\b[^>]*tabindex="-1"[^>]*data-agent-tab=/u,
      );
    }
  });

  it("supports ?view=grid and gates ?fixture=24 behind WORKER_FAKE=1", async () => {
    delete process.env.WORKER_FAKE;
    const gridNoFake = await getRecipes(
      makeRequest(
        "http://127.0.0.1:3239/recipes?view=grid&fixture=24",
        "mellodifai_lang=en",
      ),
    );
    expect(gridNoFake.status).toBe(200);
    const gridNoFakeHtml = await gridNoFake.text();
    expect(gridNoFakeHtml).toContain('data-recipes-view="grid"');
    expect(gridNoFakeHtml).not.toContain('"fixtureParam":"24"');

    process.env.WORKER_FAKE = "1";
    const gridWithFake = await getRecipes(
      makeRequest(
        "http://127.0.0.1:3239/recipes?view=grid&fixture=24",
        "mellodifai_lang=en",
      ),
    );
    expect(gridWithFake.status).toBe(200);
    const gridWithFakeHtml = await gridWithFake.text();
    expect(gridWithFakeHtml).toContain('data-recipes-view="grid"');
    expect(gridWithFakeHtml).toContain('"fixtureParam":"24"');
  });

  it("serves hashed islands and fonts CSS as immutable and rejects shell.js or unhashed names with 404", async () => {
    const homeIsland = built.islandFiles.home;
    const okIsland = await getIsland(
      makeRequest(`http://127.0.0.1:3239/site/islands/${homeIsland}`),
      { params: Promise.resolve({ name: homeIsland }) },
    );
    expect(okIsland.status).toBe(200);
    expect(okIsland.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(okIsland.headers.get("content-type")).toContain("text/javascript");

    const detailIsland = built.islandFiles["recipe-detail"];
    const okDetailIsland = await getIsland(
      makeRequest(`http://127.0.0.1:3239/site/islands/${detailIsland}`),
      { params: Promise.resolve({ name: detailIsland }) },
    );
    expect(okDetailIsland.status).toBe(200);
    expect(okDetailIsland.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(okDetailIsland.headers.get("content-type")).toContain(
      "text/javascript",
    );

    const changelogIsland = built.islandFiles.changelog;
    const okChangelogIsland = await getIsland(
      makeRequest(`http://127.0.0.1:3239/site/islands/${changelogIsland}`),
      { params: Promise.resolve({ name: changelogIsland }) },
    );
    expect(okChangelogIsland.status).toBe(200);
    expect(okChangelogIsland.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(okChangelogIsland.headers.get("content-type")).toContain(
      "text/javascript",
    );

    const agentsIsland = built.islandFiles.agents;
    const okAgentsIsland = await getIsland(
      makeRequest(`http://127.0.0.1:3239/site/islands/${agentsIsland}`),
      { params: Promise.resolve({ name: agentsIsland }) },
    );
    expect(okAgentsIsland.status).toBe(200);
    expect(okAgentsIsland.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(okAgentsIsland.headers.get("content-type")).toContain(
      "text/javascript",
    );

    for (const bad of [
      "shell.js",
      "home.js",
      "shell.0123456789ab.js",
      "../home-en.html",
      "home.000000000000.js",
    ]) {
      const res = await getIsland(
        makeRequest(`http://127.0.0.1:3239/site/islands/${bad}`),
        { params: Promise.resolve({ name: bad }) },
      );
      expect(res.status, bad).toBe(404);
    }

    const okFonts = await getStyle(
      makeRequest(`http://127.0.0.1:3239/site/styles/${built.fontsFile}`),
      { params: Promise.resolve({ name: built.fontsFile }) },
    );
    expect(okFonts.status).toBe(200);
    expect(okFonts.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(okFonts.headers.get("content-type")).toContain("text/css");
    expect(await okFonts.text()).toContain("/site/fonts/");

    for (const bad of ["fonts.css", "fonts.000000000000.css", "site.css"]) {
      const res = await getStyle(
        makeRequest(`http://127.0.0.1:3239/site/styles/${bad}`),
        { params: Promise.resolve({ name: bad }) },
      );
      expect(res.status, bad).toBe(404);
    }
  });

  it("serves prerendered /recipes/<slug> pages in IT and EN and returns the site 404 for unknown slugs", async () => {
    for (const slug of ["acoustic-voice-swap", "group-chat-ballad"]) {
      const itRes = await getRecipeDetail(
        makeRequest(`http://127.0.0.1:3239/recipes/${slug}`),
        { params: Promise.resolve({ slug }) },
      );
      expect(itRes.status, `${slug} it`).toBe(200);
      expect(itRes.headers.get("cache-control")).toBe("private, no-cache");
      expect(itRes.headers.get("vary")).toBe("Cookie");
      const itHtml = await itRes.text();
      expect(itHtml).toContain('<html lang="it"');
      expect(itHtml).toContain(`href="/recipes/${slug}/try"`);

      const enRes = await getRecipeDetail(
        makeRequest(
          `http://127.0.0.1:3239/recipes/${slug}`,
          "mellodifai_lang=en",
        ),
        { params: Promise.resolve({ slug }) },
      );
      expect(enRes.status, `${slug} en`).toBe(200);
      expect(enRes.headers.get("cache-control")).toBe("private, no-cache");
      expect(enRes.headers.get("vary")).toBe("Cookie");
      const enHtml = await enRes.text();
      expect(enHtml).toContain('<html lang="en"');
      expect(enHtml).toContain(`href="/recipes/${slug}/try"`);
    }

    for (const bad of ["does-not-exist", "../home-en", "UPPER_CASE"]) {
      const en404 = await getRecipeDetail(
        makeRequest(
          `http://127.0.0.1:3239/recipes/${encodeURIComponent(bad)}`,
          "mellodifai_lang=en",
        ),
        { params: Promise.resolve({ slug: bad }) },
      );
      expect(en404.status, bad).toBe(404);
      expect(en404.headers.get("cache-control")).toBe("private, no-cache");
      expect(en404.headers.get("vary")).toBe("Cookie");
      const html404 = await en404.text();
      expect(html404).toContain('<html lang="en"');
      expect(html404).toContain('data-astryx-theme="mesh"');
      expect(html404).toContain('href="/"');
      expect(html404).toContain("404");

      const it404 = await getRecipeDetail(
        makeRequest(`http://127.0.0.1:3239/recipes/${encodeURIComponent(bad)}`),
        { params: Promise.resolve({ slug: bad }) },
      );
      expect(it404.status, `${bad} it`).toBe(404);
      expect(await it404.text()).toContain('<html lang="it"');
    }
  });

  it("redirects /recipes/<slug>/try (307) to /create?recipe=<slug> and returns site 404 for unknown slugs", async () => {
    for (const slug of ["acoustic-voice-swap", "group-chat-ballad"]) {
      const res = await getRecipeTry(
        makeRequest(
          `http://127.0.0.1:3239/recipes/${slug}/try`,
          "mellodifai_lang=en",
        ),
        { params: Promise.resolve({ slug }) },
      );
      expect(res.status, `${slug} try`).toBe(307);
      expect(res.headers.get("location"), `${slug} location`).toBe(
        `/create?recipe=${slug}`,
      );
      expect(res.headers.get("cache-control")).toBe("private, no-cache");
      expect(res.headers.get("vary")).toBe("Cookie");
    }

    for (const bad of ["does-not-exist", "../home-en", "UPPER_CASE"]) {
      const en404 = await getRecipeTry(
        makeRequest(
          `http://127.0.0.1:3239/recipes/${encodeURIComponent(bad)}/try`,
          "mellodifai_lang=en",
        ),
        { params: Promise.resolve({ slug: bad }) },
      );
      expect(en404.status, `${bad} en`).toBe(404);
      const enHtml = await en404.text();
      expect(enHtml).toContain('<html lang="en"');
      expect(enHtml).toContain("404");

      const it404 = await getRecipeTry(
        makeRequest(
          `http://127.0.0.1:3239/recipes/${encodeURIComponent(bad)}/try`,
        ),
        { params: Promise.resolve({ slug: bad }) },
      );
      expect(it404.status, `${bad} it`).toBe(404);
      expect(await it404.text()).toContain('<html lang="it"');
    }
  });

  it("returns 500 and logs an error in production when a required static HTML file is missing instead of rebuilding", async () => {
    const missingDir = mkdtempSync(join(TMP_PARENT, "missing-"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.SITE_STATIC_DIR = missingDir;
      resetStaticSiteCacheForTest();

      const res = await getHome(
        makeRequest("http://127.0.0.1:3239/", "mellodifai_lang=en"),
      );
      expect(res.status).toBe(500);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("home-en.html"),
      );
      // Production must never rebuild files during a request.
      expect(
        (() => {
          try {
            readFileSync(join(missingDir, "home-en.html"), "utf8");
            return true;
          } catch {
            return false;
          }
        })(),
      ).toBe(false);
    } finally {
      errSpy.mockRestore();
      process.env.SITE_STATIC_DIR = outDir;
      resetStaticSiteCacheForTest();
      rmSync(missingDir, { recursive: true, force: true });
    }
  });
});
