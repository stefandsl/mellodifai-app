# Compiled production runtime launch fix

Fixed launching compiled production services under restricted Windows service accounts.

## What changed

- Updated compiled production service launch handling so services start cleanly under dedicated low-privilege Windows accounts.
