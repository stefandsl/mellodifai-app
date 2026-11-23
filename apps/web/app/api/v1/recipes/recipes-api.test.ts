// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as getRecipeDetail } from "@/app/api/v1/recipes/[slug]/route";
import { GET as listRecipes } from "@/app/api/v1/recipes/route";
import { GET as searchRecipes } from "@/app/api/v1/recipes/search/route";
import { GET as getRecipesMarkdown } from "@/app/recipes.md/route";

describe("public recipes API endpoints", () => {
  it("GET /api/v1/recipes returns all 12 published recipes and supports filters", async () => {
    const res = await listRecipes(
      new NextRequest("http://127.0.0.1:3000/api/v1/recipes"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recipes: { kind: string; slug: string }[];
    };
    expect(body.recipes.length).toBeGreaterThanOrEqual(12);

    const satireRes = await listRecipes(
      new NextRequest(
        "http://127.0.0.1:3000/api/v1/recipes?kind=satire&limit=2",
      ),
    );
    expect(satireRes.status).toBe(200);
    const satireBody = (await satireRes.json()) as {
      recipes: { kind: string }[];
    };
    expect(satireBody.recipes).toHaveLength(2);
    expect(satireBody.recipes.every((r) => r.kind === "satire")).toBe(true);

    const badKind = await listRecipes(
      new NextRequest("http://127.0.0.1:3000/api/v1/recipes?kind=unknown"),
    );
    expect(badKind.status).toBe(400);
  });

  it("GET /api/v1/recipes/[slug] returns one recipe or 404", async () => {
    const okRes = await getRecipeDetail(
      new NextRequest(
        "http://127.0.0.1:3000/api/v1/recipes/office-monday-satire",
      ),
      { params: Promise.resolve({ slug: "office-monday-satire" }) },
    );
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { recipe: { slug: string } };
    expect(okBody.recipe.slug).toBe("office-monday-satire");

    const missingRes = await getRecipeDetail(
      new NextRequest("http://127.0.0.1:3000/api/v1/recipes/no-such-recipe"),
      { params: Promise.resolve({ slug: "no-such-recipe" }) },
    );
    expect(missingRes.status).toBe(404);
  });

  it("GET /api/v1/recipes/search returns the observed score envelope well under 1.7 s", async () => {
    const start = performance.now();
    const res = await searchRecipes(
      new NextRequest(
        "http://127.0.0.1:3000/api/v1/recipes/search?q=piano&lang=en",
      ),
    );
    const elapsedMs = performance.now() - start;
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(200);
    const body = (await res.json()) as {
      success: boolean;
      message: string;
      data: { scores: Record<string, number> };
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe("");
    const entries = Object.entries(body.data.scores);
    expect(entries.length).toBeGreaterThanOrEqual(12);
    const topId = entries.sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(topId).toBe("11000001-4a14-4c14-9a14-000000000005");
  });

  it("GET /recipes.md serves the agent markdown catalog in en and it", async () => {
    const enRes = await getRecipesMarkdown(
      new NextRequest("http://127.0.0.1:3000/recipes.md"),
    );
    expect(enRes.status).toBe(200);
    expect(enRes.headers.get("content-type")).toContain("text/markdown");
    const enText = await enRes.text();
    expect(enText).toContain("# MellodifAI Song Recipes");
    expect(enText).toContain("office-monday-satire");

    const itRes = await getRecipesMarkdown(
      new NextRequest("http://127.0.0.1:3000/recipes.md?lang=it"),
    );
    expect(itRes.status).toBe(200);
    expect(await itRes.text()).toContain("# Ricette musicali MellodifAI");
  });
});
