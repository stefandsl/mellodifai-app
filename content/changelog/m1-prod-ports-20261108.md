# Production port recovery outside Windows dynamic range

Moved production service ports out of the Windows dynamic ephemeral range and improved logon recovery diagnostics.

## What changed

- Reassigned production ports outside the Windows dynamic port range to prevent startup collisions after reboot.
- Added startup failure diagnostics and automatic service recovery at logon.
- Updated the CLI to preserve uncertain write outcomes and isolate test artifacts.
