# E131 — post-click AX geometry drift (diagnostic reproduction, not a fix)

The repository baseline is E130 b0cfd85. No runtime source is changed or formal
application restarted/replaced. Local MuSu is unchanged. No text was typed this round.

## Target and instrumentation

The initial runs use the existing build-dE6zME helper via a transparent metadata
wrapper. A later disposable optimized Swift helper is compiled from the same
repository source with exactly one diagnostic change: a focusRejection failure may
include diagnosticActualFocus (the existing PID/bundle/window/element/role/path
binding only). No event, timing, matching, or occlusion logic changes. The wrapper
records only mode/exit/reason/expected/actual focus metadata; no values or titles.
Its source SHA-256 is in the evidence. Diagnostic runs are not packaged-helper acceptance.

## Observations

- Clicking the already-selected task sidebar did not remove search focus. Do not
  label this a successful unfocus trial. That lease expired before Tab; refused
  actions were not replayed. Another independent snapshot was focus-unavailable.
- A packaged-helper Tab request was focus-changed before dispatch. It did not
  expose actual focus; its cause remains unknown, distinct from the later drift.
- A fresh diagnostic run navigated to the browser's offline placeholder (no home
  action/network) and back. Focus became AXWindow, with empty path and empty search.
- The first observed search click returned posted but screenshots and AXWindow
  showed it had NOT focused the field. No typing followed; protocol end passed but
  businessGoalVerified remained false. This is negative native delivery evidence.
- A separate new transaction observed the still-unfocused field and issued one
  deliberate click (not an automatic retry). The helper returned exit0. The first
  post-input focus had AXTextField inner bounds [1594,585,218,18]; the immediately
  next capture-preflight focus had AXTextField outer bounds [1583,573,240,42].
  PID61235/window64926/window rectangle/path[7,0,9,0]/role were identical.
  capturePng rejected because lastFocus and the new snapshot were not deeply equal.
  No post-click verification screenshot was returned, and the next screenshot was
  correctly rejected because the lease had stopped. No action was replayed.
- Later independent packaged-helper screenshot showed the search visibly focused
  and empty with outer bounds; a fresh end verified observation protocol, not business success.

## Interpretation and limit

This identifies the refusal site and metadata delta for ONE reproduced post-click
failure. It does not prove AX object identity, establish why macOS returns these
rectangles, explain other pre-input failures, or make all focus drift harmless.
There is still an input-delivery/observation-timing problem: the earlier first click
reported posted without focus. Fixed waits are not ACKs. Do not ignore geometry,
reclaim focus, replay events, change MuSu, or weaken guards to hide the failure.
A future bounded observation-only stabilization design must separately justify
exact target identity, cancellation, timeout, and mid-capture drift rejection.

Evidence PNGs are search-field crops only. Full originals were manually read; hashes
and crop geometry are recorded. focus-sequence.json is metadata-only, not a raw
screen/network payload. P06.3a/P06.6 remain unchecked; no deployment or paid calls.
