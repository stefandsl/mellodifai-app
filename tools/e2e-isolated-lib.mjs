// Supabase's default ports 5432N move to <base>+N. The default base 45620 is the shared e2e
// stack (API 45621); a parallel session picks another base (and project) so two stacks never meet.
export const DEFAULT_PORT_BASE = 45620;
export const DEFAULT_E2E_PROJECT = "mellodifai_e2e";
const DEFAULT_PORT_LIST = [
  "54320",
  "54321",
  "54322",
  "54323",
  "54324",
  "54325",
  "54326",
  "54327",
  "54329",
];
export function e2ePortMap(base = DEFAULT_PORT_BASE) {
  if (!Number.isInteger(base) || base < 1024 || base > 65500 || base % 10 !== 0)
    throw new Error("Base delle porte e2e non valida.");
  return new Map(
    DEFAULT_PORT_LIST.map((port) => [port, String(base + (Number(port) % 10))]),
  );
}
const DEFAULT_PORTS = new Set(DEFAULT_PORT_LIST);

export function redactE2eStderr(stderr) {
  return String(stderr)
    .split(/\r?\n/u)
    .map((line) =>
      /key|secret|jwt|password/iu.test(line)
        ? "[redacted sensitive stderr line]"
        : line,
    )
    .join("\n");
}

export function rewriteE2eConfig(
  source,
  webPort,
  { base = DEFAULT_PORT_BASE, project = DEFAULT_E2E_PROJECT } = {},
) {
  if (!/^[a-z0-9_]+$/u.test(project) || project === "mellodifai")
    throw new Error("Nome del progetto e2e non valido.");
  const ports = e2ePortMap(base);
  let result = source.replace(
    /^project_id\s*=\s*"[^"]+"/mu,
    `project_id = "${project}"`,
  );
  result = result.replace(/5432[0-9]/gu, (port) => ports.get(port) ?? port);
  result = result.replace(
    /http:\/\/(127\.0\.0\.1|localhost):3000/g,
    `http://$1:${webPort}`,
  );
  return result;
}

export function assertIsolatedConfig(config) {
  const id = /^project_id\s*=\s*"([^"]+)"/mu.exec(config)?.[1];
  if (id === "mellodifai")
    throw new Error("Il progetto e2e non puo' usare mellodifai.");
  for (const port of DEFAULT_PORTS)
    if (new RegExp(`(?:port\\s*=\\s*|:)${port}(?:\\D|$)`, "u").test(config))
      throw new Error(`Il progetto e2e contiene la porta predefinita ${port}.`);
  return true;
}
