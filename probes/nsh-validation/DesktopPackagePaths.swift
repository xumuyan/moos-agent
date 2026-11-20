import Foundation
import Darwin

// Signed fixture package names are fixed, and profile paths never come from NSH.
enum DesktopPackagePaths {
    static let resources = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources", isDirectory: true)
    static let node = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/moos-node").path
    static let script = resources.appendingPathComponent("host/probes/nsh-validation/desktop-package-stdio.mjs").path

    static func data() throws -> URL {
#if PI_UI_CHECK
        let root = URL(fileURLWithPath: try canonical(Bundle.main.bundleURL.deletingLastPathComponent().path), isDirectory: true)
#else
        // Use the current account's home (also used by the sealed Node child), not
        // a renderer parameter or an inherited HOME from a desktop tool.
        guard let info = getpwuid(getuid()), let accountHome = info.pointee.pw_dir, accountHome.pointee == 47 else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let home = URL(fileURLWithPath: String(cString: accountHome), isDirectory: true)
        let support = home.appendingPathComponent("Library/Application Support", isDirectory: true)
        let root = support.appendingPathComponent("dev.muma.probe.nsh.package", isDirectory: true)
        guard try canonical(support.path) == support.path else { throw CocoaError(.fileWriteInvalidFileName) }
        if mkdir(root.path, 0o700) == 0 {
            guard mkdir(root.appendingPathComponent("profile").path, 0o700) == 0 else { throw CocoaError(.fileWriteNoPermission) }
        } else if errno != EEXIST {
            throw CocoaError(.fileWriteNoPermission)
        }
#endif
        try validate(root)
        try validate(root.appendingPathComponent("profile", isDirectory: true))
        let storage = root.appendingPathComponent("storage", isDirectory: true)
        if mkdir(storage.path, 0o700) != 0 && errno != EEXIST { throw CocoaError(.fileWriteNoPermission) }
        try validate(storage)
        return root
    }

    private static func canonical(_ path: String) throws -> String {
        guard let resolved = realpath(path, nil) else { throw CocoaError(.fileReadInvalidFileName) }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private static func validate(_ url: URL) throws {
        var info = stat()
        guard lstat(url.path, &info) == 0, info.st_uid == getuid(), (info.st_mode & S_IFMT) == S_IFDIR,
              (info.st_mode & 0o7777) == 0o700, try canonical(url.path) == url.path else {
            throw CocoaError(.fileWriteNoPermission)
        }
    }
}
