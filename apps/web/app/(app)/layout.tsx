import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { getLocale } from "@/lib/locale";

export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProfile();
  return <AppShell lang={await getLocale()}>{children}</AppShell>;
}
