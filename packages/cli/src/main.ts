import { readFile } from "node:fs/promises";
import { ClientError, request } from "./client.js";
import { commands, parse, run } from "./commands.js";
import {
  loadCredentials,
  saveCredentials,
  validateCredentials,
} from "./credentials.js";
import { bridge } from "./mcp.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
function output(value: unknown) {
  process.stdout.write(
    `${JSON.stringify(value, null, json ? undefined : 2)}\n`,
  );
}
async function stdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new ClientError(
      "validation",
      "Passa l'input tramite stdin o --input <file>.",
    );
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
async function main() {
  const { values, positionals } = parse(args);
  if (values.help || !positionals.length) {
    output({
      data: {
        commands,
        usage:
          "login --url <origine> (PAT da stdin); songs|costs|remakes [--input filtri.json]; create --input canzone.json; status <job> [--watch]; approve <versione> --input testo.json; regenerate <versione> --input generazione.json; video <versione>; pick <versione> <take>; approve-video <versione>; remake <link> [--lang it] [--country IT]; remake-status <rifacimento> [--watch]; remake-edit <rifacimento> --input modifiche.json; remake-accept <rifacimento> --input accetta.json; remake-cancel <rifacimento>; remake-retry <rifacimento>; tools; call <strumento> [--input argomenti.json]; mcp. --json su tutti; --idempotency-key <chiave> sulle scritture. --input - legge JSON da stdin.",
      },
    });
    return;
  }
  if (positionals[0] === "login") {
    if (
      positionals.length !== 1 ||
      !values.url ||
      values.input ||
      values.watch ||
      values.lang ||
      values.country ||
      values["idempotency-key"]
    )
      throw new ClientError(
        "validation",
        "Usa login --url <origine> con PAT da stdin.",
      );
    const credentials = validateCredentials({
      url: values.url,
      pat: (await stdin()).trim(),
    });
    await request(credentials, "/songs?limit=1");
    await saveCredentials(credentials);
    output({ data: { logged_in: true, url: credentials.url } });
    return;
  }
  const credentials = await loadCredentials();
  if (positionals[0] === "mcp") {
    if (
      positionals.length !== 1 ||
      values.url ||
      values.input ||
      values.watch ||
      values.lang ||
      values.country ||
      values["idempotency-key"]
    )
      throw new ClientError("validation", "Usa mcp [--json].");
    await bridge(process.stdin, process.stdout, credentials);
    return;
  }
  await run(args, {
    credentials,
    output,
    input: async (file) => {
      try {
        return JSON.parse(
          file && file !== "-" ? await readFile(file, "utf8") : await stdin(),
        );
      } catch {
        throw new ClientError(
          "validation",
          "Input JSON non valido o non disponibile.",
        );
      }
    },
  });
}

main().catch((error: unknown) => {
  const code = error instanceof ClientError ? error.code : "validation";
  const message =
    error instanceof ClientError
      ? error.message
      : "Comando o credenziali non validi. Usa --help o login.";
  process.stderr.write(
    `${JSON.stringify({ error: { code, message, ...(error instanceof ClientError && error.retry_after !== undefined ? { retry_after: error.retry_after } : {}) } })}\n`,
  );
  process.exitCode = 1;
});
