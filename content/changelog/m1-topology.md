# Edge proxy, server-side sign-in, and key rotation

Added the local edge proxy with path allowlisting, server-side sign-in via link or 6-digit code, and externalized signing key rotation.

## What changed

- Added server-side sign-in supporting both magic links and 6-digit codes with bounded rate-limit storage.
- Built the edge proxy with explicit path allowlisting and a tunnel configuration template.
- Added signing key and JWT secret rotation stored outside every git checkout, keeping rotation caches off drive C.
- Hardened Windows service installation logging, folder creation, and `icacls` traverse permissions.
