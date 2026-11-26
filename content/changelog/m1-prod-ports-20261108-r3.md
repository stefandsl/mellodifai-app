# Deployment package ACL inheritance repair

Fixed Windows deployment package permissions so restricted service accounts reliably inherit read access to deployed dependencies.

## What changed

- Copied deployment packages during installation so files inherit the target folder's service read permissions instead of carrying stale source ACLs.
