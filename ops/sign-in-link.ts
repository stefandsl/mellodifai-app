import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userAdmin, validateEmail } from "./lib/user-admin.js";

type Admin = {
  generateLink(input: {
    type: "magiclink";
    email: string;
    options: { redirectTo: string };
  }): Promise<{
    data: { properties: { hashed_token: string } | null } | null;
    error: Error | null;
  }>;
};

export async function signInLink(
  admin: Admin,
  email: string,
  siteUrl: string,
): Promise<string> {
  validateEmail(email);
  const site = new URL(siteUrl);
  if (
    !["http:", "https:"].includes(site.protocol) ||
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  )
    throw new Error("SITE_URL must be an HTTP origin");
  const confirm = new URL("/auth/confirm", site);
  const { data, error } = await admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: confirm.href },
  });
  if (error || !data?.properties?.hashed_token)
    throw new Error("Sign-in link generation failed");
  confirm.searchParams.set("token_hash", data.properties.hashed_token);
  confirm.searchParams.set("type", "magiclink");
  return confirm.href;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const main = async () => {
    const [email, target, extra] = process.argv.slice(2);
    if (!email || extra)
      throw new Error("Usage: sign-in-link.ts <email> [site-url]");
    process.stdout.write(
      `${await signInLink(userAdmin(), email, target ?? process.env.SITE_URL ?? "http://127.0.0.1:3000")}\n`,
    );
  };
  main().catch(() => {
    process.stderr.write(
      "Sign-in link generation failed; check the email, target origin and worker configuration\n",
    );
    process.exitCode = 1;
  });
}
