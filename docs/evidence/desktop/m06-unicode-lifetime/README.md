# E129 — Unicode posting-process lifetime candidate (not deployed)

The four PNGs are search-field-only crops (top-left pixel rectangle 860,395,260,60)
from original MuSu window captures. No task cards are included. Original filenames
and SHA-256, crop geometry and derivative SHA-256 are in the adjacent JSON.

- baseline-empty.png: original helper reported success; field still empty after a caller-side wait.
- delay-ascii.png: experimental helper retained its own process for 250ms after posting; DELAY_TEST visible.
- source-unicode.png: compiled repository candidate visibly entered 本地验收🙂XYZ.
- source-cleared.png: fresh-observation cmd+a/delete cleared the transient search field.

Images were manually reviewed in the original complete window captures. Native
source-candidate semantic success is distinct from the tool's retained
businessGoalVerified=false. No target receipt is inferred from event-posting success.

The source-only regression checks ordering/bounds/no retry, not native reliability.
The packaged build passed strict signing/source match and automated tests but its
native typing trial was blocked by expired/different-foreground observations. No
focus reclaim or stale-action replay occurred. P06.3a/P06.6 remain unchecked.

Temporary SwiftUI fixture exited normally (accepted terminate was followed by an
independent absent-process check). Formal Moos was not exited/restarted/replaced.
No key, paid GLM request, official-site navigation, order or persisted task change.
