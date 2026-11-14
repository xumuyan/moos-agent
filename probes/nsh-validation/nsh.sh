#!/bin/bash
# Local, pinned toolchain only; never install, upgrade or launch production MuMa.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NSH="$ROOT/artifacts/nsh-validation/toolchain/nsh/bin/nsh"
if [[ ! -x "$NSH" ]]; then
  echo 'Missing NSH 0.5.0 toolchain. See probes/nsh-validation/README.md.' >&2
  exit 1
fi
[[ "$("$NSH" --version)" == 'nsh 0.5.0 (f4d68f7)' ]] || { echo 'Unexpected NSH version' >&2; exit 1; }
cd "$ROOT"
command="${1:-test}"
if [[ $# -gt 0 ]]; then shift; fi
case "$command" in
  test|check|run) exec "$NSH" "$command" probes/nsh-validation "$@" ;;
  package) exec "$NSH" package probes/nsh-validation --out artifacts/nsh-validation/package "$@" ;;
  *) echo 'Usage: bash probes/nsh-validation/nsh.sh test|check|run|package [NSH options]' >&2; exit 2 ;;
esac
