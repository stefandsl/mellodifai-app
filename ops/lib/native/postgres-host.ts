import { restrictedLaunch } from "./restricted.js";

/** A detached Windows postmaster has no console. Its CreateProcess calls then
 * allocate a console for every backend. Keep one hidden console for the server
 * and its descendants, owned by the postmaster and started by a persistent
 * detached host. The host stays alive until PostgreSQL exits, independently of
 * the supervisor's caller. PostgreSQL refuses an administrator token, so the
 * host starts it through the restricted-token launcher, which reports the
 * postmaster pid on its stdout and sends the server's output to the inherited
 * log pipe. Inline Node code also works in the bundled/pinned ops distribution. */
export const postgresHostScript = `
// MDF_POSTGRES_CONSOLE_HOST
const { spawn } = require('node:child_process');
const child = spawn(process.argv[1], process.argv.slice(2), {
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
  detached: false,
});
let reported = '';
child.stdout.on('data', chunk => {
  if (reported === null) return;
  reported += chunk.toString();
  if (!reported.includes('\\n')) return;
  const pid = Number(reported.trim());
  reported = null;
  process.send({ pid });
});
child.once('error', error => {
  const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'UNKNOWN';
  console.error('PostgreSQL console host spawn failed: ' + code);
  process.exit(1);
});
child.once('exit', code => process.exit(code === null ? 1 : code));
// Losing the supervisor must not tear down PostgreSQL's console or job.
process.on('disconnect', () => {});
`;

export function postgresLaunch(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32") return { command, args, ipc: false, env: {} };
  const restricted = restrictedLaunch(
    command,
    args,
    { reportPid: true },
    platform,
  );
  return {
    command: process.execPath,
    args: ["-e", postgresHostScript, restricted.command, ...restricted.args],
    ipc: true,
    env: restricted.env,
  };
}
