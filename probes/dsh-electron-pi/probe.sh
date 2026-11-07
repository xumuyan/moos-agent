#!/bin/bash
set -euo pipefail
umask 077

probe_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
repo=$(cd -- "$probe_dir/../.." && pwd -P)
state="$repo/.generated/dsh-electron-skin"
dsh='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
resources='/Applications/Moos.app/Contents/Resources'

if [[ ! -x "$dsh" || ! -f "$resources/packages/pi-runtime/sdk-runtime.mjs" ||
  ! -f "$state/dsh/profiles/desktop/package.json" || ! -f "$state/dsh/skins/maid-atelier/skin.json" ]]; then
  printf '%s\n' 'Install the Moos app and initialize the DSH skin probe before running this probe.' >&2
  exit 1
fi

case "${1:-}" in
  install)
    package_dir=$(mktemp -d "$state/pi-package.XXXXXX")
    archive=$(npm pack "$probe_dir" --pack-destination "$package_dir" --silent)
    DSH_HOME="$state/dsh" DSH_TELEMETRY_DISABLED=1 "$dsh" plugin --profile desktop add "$package_dir/$archive"
    ;;
  open)
    mkdir -p "$state/pi-workspace" "$state/pi-data"
    export MOOS_DSH_PI_WORKSPACE="$state/pi-workspace"
    export MOOS_DSH_PI_DATA="$state/pi-data"
    export MOOS_DSH_PI_RESOURCES="$resources"
    printf 'Select this workspace in DSH: %s\n' "$MOOS_DSH_PI_WORKSPACE"
    exec python3 "$repo/probes/dsh-electron-skin/probe.py" open
    ;;
  *)
    printf '%s\n' 'Usage: bash probes/dsh-electron-pi/probe.sh {install|open}' >&2
    exit 2
    ;;
esac
