import postgres from "postgres";

export function databaseUrl(
  role: string,
  password: string,
  port: number,
): string {
  return `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
}

export function ownerConnection(url: string) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.username !== "postgres")
    throw new Error("Owner connection requires postgres on IPv4 loopback");
  return postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
}
