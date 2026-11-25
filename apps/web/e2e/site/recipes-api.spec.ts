import { expect, test } from "@playwright/test";

test("public recipes API, search endpoint, markdown catalog and media assets serve cleanly", async ({
  request,
}) => {
  const listRes = await request.get("/api/v1/recipes");
  expect(listRes.status()).toBe(200);
  const listBody = (await listRes.json()) as {
    recipes: {
      slug: string;
      kind: string;
      mediaUrls: { cover: string; preview: string; example: string };
    }[];
  };
  expect(listBody.recipes.length).toBeGreaterThanOrEqual(12);

  const first = listBody.recipes[0];
  expect(first).toBeDefined();
  if (!first) return;

  const detailRes = await request.get(`/api/v1/recipes/${first.slug}`);
  expect(detailRes.status()).toBe(200);
  const detailBody = (await detailRes.json()) as { recipe: { slug: string } };
  expect(detailBody.recipe.slug).toBe(first.slug);

  const missingRes = await request.get("/api/v1/recipes/no-such-recipe");
  expect(missingRes.status()).toBe(404);

  // The first hit on a dev server compiles the route; time a warm request.
  const searchUrl = "/api/v1/recipes/search?q=piano&lang=en";
  expect((await request.get(searchUrl)).status()).toBe(200);
  const start = performance.now();
  const searchRes = await request.get(searchUrl);
  const elapsedMs = performance.now() - start;
  expect(searchRes.status()).toBe(200);
  expect(elapsedMs).toBeLessThan(1000);
  const searchBody = (await searchRes.json()) as {
    success: boolean;
    message: string;
    data: { scores: Record<string, number> };
  };
  expect(searchBody.success).toBe(true);
  expect(Object.keys(searchBody.data.scores).length).toBeGreaterThanOrEqual(12);

  const mdRes = await request.get("/recipes.md");
  expect(mdRes.status()).toBe(200);
  expect(mdRes.headers()["content-type"]).toContain("text/markdown");
  expect(await mdRes.text()).toContain("# MellodifAI Song Recipes");

  const coverRes = await request.get(first.mediaUrls.cover);
  expect(coverRes.status()).toBe(200);
  expect((await coverRes.body()).byteLength).toBeGreaterThan(0);
});
