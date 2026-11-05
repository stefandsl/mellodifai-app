// Shared by stack rendering and Next without importing filesystem tooling into Next.
export const AUTH_ORIGINS = {
  dev: {
    siteUrl: "http://127.0.0.1:3001",
    redirectUrls: ["http://127.0.0.1:3001/**", "http://localhost:3001/**"],
  },
  e2e: {
    siteUrl: "http://127.0.0.1:3210",
    redirectUrls: ["http://127.0.0.1:3210/**", "http://127.0.0.1:3212/**"],
  },
  ci: {
    siteUrl: "http://127.0.0.1:3210",
    redirectUrls: ["http://127.0.0.1:3210/**", "http://127.0.0.1:3212/**"],
  },
  prod: {
    siteUrl: "https://app.mellodifai.com",
    redirectUrls: [
      "https://app.mellodifai.com/**",
      "http://127.0.0.1:3000/**",
      "http://localhost:3000/**",
    ],
  },
};
