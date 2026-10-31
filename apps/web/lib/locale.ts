import { cookies } from "next/headers";

export async function getLocale(): Promise<"it" | "en"> {
  return (await cookies()).get("mellodifai_lang")?.value === "en" ? "en" : "it";
}
