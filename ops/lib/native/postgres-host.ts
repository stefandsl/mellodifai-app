/** A detached Windows postmaster has no console. Its CreateProcess calls then
 * allocate a console for every backend. Keep one hidden console for the server
 * and its descendants, owned by a persistent detached host. The host stays
 * alive until PostgreSQL exits, independently of the supervisor's caller.
 * Inline Node code also works in the bundled/pinned ops distribution. */
export const postgresHostScript = `
// MDF_POSTGRES_CONSOLE_HOST
const { spawn } = require('node:child_process');
const child = spawn(process.argv[1], process.argv.slice(2), {
  stdio: ['ignore', 'inherit', 'inherit'],
  windowsHide: true,
  detached: false,
});
child.once('spawn', () => process.send({ pid: child.pid }));
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
  return platform === "win32"
    ? {
        command: process.execPath,
        args: ["-e", postgresHostScript, command, ...args],
        ipc: true,
      }
    : { command, args, ipc: false };
}
