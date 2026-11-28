# M1 floor baseline and studio ops lockdown

Established the M1 baseline combining the studio web interface with locked-down service accounts, ACL audits, and verified backup restoration.

## What changed

- Merged the studio interface into the M1 release line behind the final ops ACL lockdown.
- Added dedicated Windows service accounts, ACL probes, firewall checks, and port-owner guards.
- Verified production secret bootstrapping and legacy pre-cutover restore paths, including legacy storyboard rerender handling.
- Added database tests checking for unintended `PUBLIC` column grants in the ACL snapshot.
