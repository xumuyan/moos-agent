# E130 — Packaged helper limited native input follow-up (not deployed)

Source baseline is committed E129 (`76eca19`). The existing isolated build-dE6zME
helper was used directly; formal Moos was not replaced or restarted. Native runs
are local MuSu search only, with no model/key/network/order actions.

- before.png: empty search before packaged helper input.
- typed.png: full 打包验收🙂ABC visibly present, with corresponding no-results view
  in the original window capture; helper reported eight characters/posted-unverified.
- cleared.png: empty search after a newly observed cleanup transaction.
- after-click.png: empty field after one separately observed click. The trace
  metadata stayed identical; this does not reproduce or explain the prior focus refusal.

PNGs contain only search-field crops, not task cards. Geometry, original and
cropped SHA-256 are in the adjacent JSON. Full original screenshots were manually
read. End protocol confirmation does not set tool businessGoalVerified to true.

The input transaction expired before its first cleanup delete, which was refused.
No stale deletion was replayed: cleanup used a fresh transaction and screenshot.
An intervening wrong-frontmost capture and activation mismatch also stopped;
there was no automatic focus reclaim. Both diagnostic runners were disposed.

For the click trial only, a temporary forwarding wrapper logged operation names,
exit/reason and existing focus metadata (PID/window/role/geometry/path), never text
values or titles. It forwarded to the exact packaged helper without changing
arguments or output. One successful click cannot establish general reliability,
other overlays/secondary display/concurrent cancellation or formal GUI acceptance.
P06.3a/P06.6 remain unchecked; E129 failures remain historical evidence.
