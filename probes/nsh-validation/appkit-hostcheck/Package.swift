import Foundation
import Darwin

// Scripted check only. Keep writable state next to the relocated .app.
enum DesktopFixedLaunch {
    static let node = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/moos-node").path
    static let script = Bundle.main.bundleURL.appendingPathComponent(
        "Contents/Resources/host/probes/nsh-validation/desktop-package-stdio.mjs").path
}

@_cdecl("n01_package_storage")
public func storage() -> UnsafeMutablePointer<CChar>? {
    guard Bundle.main.bundleIdentifier == "dev.muma.probe.nsh.appkit.package.check",
          let root = realpath(Bundle.main.bundleURL.deletingLastPathComponent().path, nil) else { return nil }
    defer { free(root) }
    let path = String(cString: root)
    for entry in [path, path + "/profile", path + "/storage"] {
        var info = stat()
        guard lstat(entry, &info) == 0, info.st_uid == getuid(),
              (info.st_mode & S_IFMT) == S_IFDIR, (info.st_mode & 0o7777) == 0o700 else { return nil }
    }
    return strdup(path + "/storage")
}

@_cdecl("n01_package_free")
public func freeStorage(_ path: UnsafeMutablePointer<CChar>) { free(path) }
