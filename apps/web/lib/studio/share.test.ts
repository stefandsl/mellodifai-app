import { describe, expect, it } from "vitest";
import { absoluteUrl, SHARE_NETWORKS, shareLinks } from "./share";

describe("share links", () => {
  const url = "https://app.test/projects/1?lang=it&x=a b";
  const title = "Notte & città";
  const links = Object.fromEntries(
    shareLinks(url, title).map((link) => [link.network, link]),
  );

  it("has one link per network, in order", () => {
    expect(shareLinks(url, title).map((link) => link.network)).toEqual([
      ...SHARE_NETWORKS,
    ]);
  });

  it("encodes the address and the title for each network", () => {
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(title);
    expect(links.whatsapp?.href).toBe(
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
    );
    expect(links.telegram?.href).toBe(
      `https://t.me/share/url?url=${u}&text=${t}`,
    );
    expect(links.x?.href).toBe(
      `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    );
    expect(links.facebook?.href).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    );
    expect(links.linkedin?.href).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    );
    expect(links.reddit?.href).toBe(
      `https://www.reddit.com/submit?url=${u}&title=${t}`,
    );
    expect(links.email?.href).toBe(
      `mailto:?subject=${t}&body=${encodeURIComponent(`${title}\n${url}`)}`,
    );
  });

  it("opens networks in a new tab and the mail app in place", () => {
    for (const link of Object.values(links))
      expect(link.newTab).toBe(link.network !== "email");
  });

  it("makes absolute addresses", () => {
    expect(absoluteUrl("/projects/1?lang=it", "https://app.test")).toBe(
      "https://app.test/projects/1?lang=it",
    );
  });
});
