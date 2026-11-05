This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Web environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and server-only `SUPABASE_INTERNAL_URL`, `SITE_URL`, `MDF_WEB_DATABASE_URL`.
`SITE_URL` is `http://127.0.0.1:3001` for dev, `http://127.0.0.1:3210` for e2e/CI,
and `https://app.mellodifai.com` for production. Local email callbacks must match
that stack's `additional_redirect_urls`; remote callbacks always use `SITE_URL`.
Dev accepts localhost and 127.0.0.1 on 3001. Production also accepts those local
hosts on 3000. The accepted e2e override uses `E2E_PORT=3219` with API 45621.
Render/start the stack to activate `supabase/templates/magic_link.html`.

Sign-in runs on the server, with five email sends per address per fifteen minutes.
The response is neutral whether the address is allowlisted or delivery fails.
Six-digit code verification has a separate five-attempt, fifteen-minute window.
These limits are per Next process, matching the single-server M1 topology.
For an OAuth flow the email link only works in the starting browser. If your mail
app opens a different browser, enter the six-digit code on the original login page.
Production SMTP remains owner-configured; `ops/sign-in-link.ts` supplies the local
no-SMTP fallback.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
