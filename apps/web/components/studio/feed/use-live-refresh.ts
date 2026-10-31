"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/browser";

// Re-renders the server data when a version or job changes, debounced so a burst of
// stage events causes one refresh.
export function useLiveRefresh(tables: string[] = ["versions", "jobs"]) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase.channel(`studio-feed-${crypto.randomUUID()}`);
    for (const table of key.split(","))
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        refresh,
      );
    channel.subscribe();
    // Signed media URLs last an hour; refresh before they expire.
    const hourly = setInterval(() => router.refresh(), 50 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(hourly);
      void supabase.removeChannel(channel);
    };
  }, [router, key]);
}
