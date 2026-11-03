const PORTS = new Map([
  ["54321", "45621"],
  ["54322", "45622"],
  ["54320", "45620"],
  ["54329", "45629"],
  ["54323", "45623"],
  ["54324", "45624"],
  ["54325", "45625"],
  ["54326", "45626"],
  ["54327", "45627"],
]);
const DEFAULT_PORTS = new Set(PORTS.keys());

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

export function rewriteE2eConfig(source, webPort) {
  let result = source.replace(
    /^project_id\s*=\s*"[^"]+"/mu,
    'project_id = "mellodifai_e2e"',
  );
  result = result.replace(/5432[0-9]/gu, (port) => PORTS.get(port) ?? port);
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
