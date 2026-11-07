"""Install the reviewed reference skin into an isolated original DSH desktop."""

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import plistlib
import stat
import subprocess
import sys
import tempfile
import zipfile

DSH_VERSION = "0.2.2-rc.1"
PLUGIN = "@linxin666/dsh-client-ui-skin-center@0.4.5"
SKIN = "maid-atelier"
SKIN_DIGEST = "09ec4463c11bc81046781f4701a75a40039d9a9c89c10faae52d2007b1eaa087"
MAX_BYTES = 16 * 1024 * 1024
REPO = Path(__file__).resolve().parents[2]


def original_files(archive, expected=SKIN_DIGEST):
    """Accept the reviewed files, with or without a single skin directory wrapper."""
    files = {}
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) > 64 or sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("ZIP exceeds the reference skin's limits")
        regular = [entry for entry in entries if not entry.is_dir()]
        wrapped = all(entry.filename.startswith(f"{SKIN}/") for entry in regular)
        for entry in regular:
            name = entry.filename.removeprefix(f"{SKIN}/") if wrapped else entry.filename
            path = PurePosixPath(name)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if (not path.parts or path.is_absolute() or ".." in path.parts
                    or name != path.as_posix() or "\\" in name
                    or kind not in (0, stat.S_IFREG) or name in files):
                raise ValueError("ZIP contains an unsafe or duplicate entry")
            files[name] = bundle.read(entry)
    identity = "".join(f"{name}\0{hashlib.sha256(data).hexdigest()}\n"
                       for name, data in sorted(files.items()))
    if hashlib.sha256(identity.encode()).hexdigest() != expected:
        raise ValueError("ZIP files differ from the pinned original maid-atelier package")
    return files


def private_directory(path):
    path.mkdir(mode=0o700, exist_ok=True)
    if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid():
        raise ValueError(f"Not a local directory owned by this user: {path}")
    return path


def isolated_environment(state):
    # Override alternate skin roots too; user profile overrides must not affect this probe.
    return {
        **os.environ,
        "DSH_HOME": str(state / "dsh"),
        "DSH_SKINS_HOME": str(state / "dsh" / "skins"),
        "DSH_SKINS_DIR": str(state / "dsh" / "skins"),
        "DSH_DESKTOP_UPDATE_JOURNAL_DIR": str(state / "updates"),
        "DSH_TELEMETRY_DISABLED": "1",
    }


def install_skin(files, destination):
    with tempfile.TemporaryDirectory(prefix=".skin-stage-", dir=destination.parent) as stage:
        unpacked = Path(stage) / SKIN
        unpacked.mkdir()
        for name, data in files.items():
            path = unpacked / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        unpacked.rename(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, default=Path("/Applications/DeepSeek Harness.app"))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="launch once to initialize the separate desktop profile")
    install = commands.add_parser("install", help="install the pinned skin center and original ZIP")
    install.add_argument("original_zip", type=Path)
    commands.add_parser("open", help="open the prepared Electron verification window")
    args = parser.parse_args()

    if sys.platform != "darwin":
        raise ValueError("This probe requires macOS and the original DSH Desktop application")
    contents = args.app.resolve() / "Contents"
    with (contents / "Info.plist").open("rb") as f:
        app = plistlib.load(f)
    if app.get("CFBundleShortVersionString") != DSH_VERSION:
        raise ValueError(f"The reference run requires DSH Desktop {DSH_VERSION}")

    state = private_directory(private_directory(REPO / ".generated") / "dsh-electron-skin")
    dsh = private_directory(state / "dsh")
    electron = private_directory(state / "electron")
    workspace = private_directory(state / "workspace")
    env = isolated_environment(state)
    profile = dsh / "profiles" / "desktop" / "package.json"
    skin = dsh / "skins" / SKIN
    if args.command == "install":
        files = original_files(args.original_zip)
        if not profile.is_file():
            raise ValueError("Run init and quit that window before installing")
        if skin.exists() or skin.is_symlink():
            raise ValueError(f"Already installed or occupied: {skin}")
        private_directory(skin.parent)
        cli = contents / "Resources" / "runtime" / "cli" / "bin" / "dsh"
        subprocess.run([cli, "plugin", "--profile", "desktop", "add", PLUGIN, "--save-exact"],
                       cwd=workspace, env=env, check=True)
        install_skin(files, skin)
        print("Installed. Run open; in DSH, choose 设置 → 皮肤 → Abyssal Maid Atelier → 应用.")
        return

    if args.command == "open" and not (skin / "skin.json").is_file():
        raise ValueError("Run init, quit the window, then install the original ZIP first")
    if args.command == "init" and profile.is_file():
        print("Profile already initialized. Use install or open.")
        return
    print(f"Opening isolated DSH Electron profile: {state}", flush=True)
    # Upstream can log the loopback bootstrap URL with its private token.
    subprocess.run([contents / "MacOS" / app["CFBundleExecutable"], f"--user-data-dir={electron}"],
                   cwd=workspace, env=env, check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        sys.exit(f"DSH skin probe: {error}")
