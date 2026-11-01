// Standard share URLs for the networks the share window offers. Each is a plain link: the
// window opens them in a new tab, so no script from the networks runs in the app.

export const SHARE_NETWORKS = [
  "whatsapp",
  "telegram",
  "x",
  "facebook",
  "linkedin",
  "reddit",
  "email",
] as const;
export type ShareNetwork = (typeof SHARE_NETWORKS)[number];

export type ShareLink = {
  network: ShareNetwork;
  href: string;
  // mailto: links open the mail app in the same tab; the others open a new tab.
  newTab: boolean;
};

export function shareLinks(url: string, title: string): ShareLink[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const both = encodeURIComponent(`${title} ${url}`);
  return [
    { network: "whatsapp", href: `https://wa.me/?text=${both}` },
    { network: "telegram", href: `https://t.me/share/url?url=${u}&text=${t}` },
    {
      network: "x",
      href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    },
    {
      network: "facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    },
    {
      network: "linkedin",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    },
    {
      network: "reddit",
      href: `https://www.reddit.com/submit?url=${u}&title=${t}`,
    },
    {
      network: "email",
      href: `mailto:?subject=${t}&body=${encodeURIComponent(`${title}\n${url}`)}`,
    },
  ].map((link) => ({
    ...link,
    network: link.network as ShareNetwork,
    newTab: !link.href.startsWith("mailto:"),
  }));
}

// The absolute address of a page of the app.
export function absoluteUrl(href: string, origin: string): string {
  return new URL(href, origin).toString();
}
