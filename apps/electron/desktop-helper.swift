// 沐码桌面操作 helper（M06）。每条命令独立进程，stdout 仅输出 JSON。
// 坐标协议：输入/输出的全局坐标一律为「顶左原点」逻辑点（与 NSScreen/CGWindowList 一致）；
// 内部转换成 CGEvent 的「底左原点」坐标。键入与点击事件使用私有 CGEventSource，
// down 事件携带显式修饰键标志、up 事件标志显式清空（不继承先前 Command 状态，M01/E14 结论）。
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit

let helperVersion = "1"

func emit(_ value: [String: Any], code: Int32 = 0) -> Never {
    do { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) }
    catch { fputs("Unable to encode helper result.\n", stderr); exit(2) }
    exit(code)
}

func fail(_ reason: String, extra: [String: Any] = [:], code: Int32 = 1) -> Never {
    var payload: [String: Any] = ["status": "failed", "reason": reason]
    for (key, value) in extra { payload[key] = value }
    emit(payload, code: code)
}

func arguments() -> [String] { Array(CommandLine.arguments.dropFirst()) }

func flag(_ name: String, in args: [String]) -> Bool { args.contains(name) }

func value(_ name: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func numbers(_ name: String, count: Int, in args: [String]) -> [Double]? {
    guard let raw = value(name, in: args) else { return nil }
    let parts = raw.split(separator: ",").compactMap { Double($0) }
    guard parts.count == count, parts.allSatisfy({ $0.isFinite }) else { return nil }
    return parts
}

let screenGranted = CGPreflightScreenCaptureAccess()
let inputGranted = AXIsProcessTrusted()

func requireScreen() {
    guard screenGranted else {
        emit(["status": "blocked", "reason": "system-permission-required",
              "permission": "screen-capture", "screenCaptureGranted": false,
              "accessibilityGranted": inputGranted], code: 3)
    }
}

func requireInput() {
    guard inputGranted else {
        emit(["status": "blocked", "reason": "system-permission-required",
              "permission": "accessibility", "screenCaptureGranted": screenGranted,
              "accessibilityGranted": false], code: 3)
    }
}

func screenID(_ screen: NSScreen) -> CGDirectDisplayID {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! NSNumber).uint32Value
}

/// 主屏在「顶左原点全局坐标系」中的总高度；用于全局顶左 → CGEvent 底左换算。
let primaryHeight = CGDisplayBounds(CGMainDisplayID()).height

func cgPoint(topLeft: CGPoint) -> CGPoint {
    CGPoint(x: topLeft.x, y: primaryHeight - topLeft.y)
}

// 事件工厂：私有 source；down 携带显式 flags，up 显式清空。
let eventSource = CGEventSource(stateID: .privateState)

func makeKeyEvents(_ key: CGKeyCode, flags: CGEventFlags) -> (CGEvent, CGEvent)? {
    guard let source = eventSource,
          let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) else { return nil }
    down.flags = flags
    up.flags = []
    return (down, up)
}

func postKey(_ key: CGKeyCode, flags: CGEventFlags) {
    guard let (down, up) = makeKeyEvents(key, flags: flags) else {
        fail("keyboard-event-unavailable")
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func makeTextEvents(_ text: String) -> (CGEvent, CGEvent)? {
    guard let source = eventSource,
          let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { return nil }
    let units = Array(text.utf16)
    down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
    up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
    down.flags = []
    up.flags = []
    return (down, up)
}

// 父进程看门狗：Node 侧超时或崩溃时 helper 自行退出，不留孤儿。
let parentPID = getppid()
let watchdog = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
    if getppid() != parentPID { exit(4) }
}
RunLoop.main.add(watchdog, forMode: .default)

let args = arguments()
let mode = args.first ?? ""

if mode == "version" {
    emit(["version": helperVersion, "screenCaptureGranted": screenGranted, "accessibilityGranted": inputGranted])
}

if mode == "permissions" {
    emit(["screenCaptureGranted": screenGranted, "accessibilityGranted": inputGranted,
          "activeDisplays": NSScreen.screens.count,
          "system": ProcessInfo.processInfo.operatingSystemVersionString, "helperVersion": helperVersion])
}

if mode == "displays" {
    let displays: [[String: Any]] = NSScreen.screens.map { screen in
        let id = screenID(screen)
        let bounds = CGDisplayBounds(id)
        // 顶左原点全局坐标中的显示器矩形。
        let topLeftOrigin = CGRect(x: bounds.minX, y: primaryHeight - bounds.maxY,
                                   width: bounds.width, height: bounds.height)
        return ["id": Int(id), "isPrimary": id == CGMainDisplayID(), "scale": screen.backingScaleFactor,
                "x": topLeftOrigin.minX, "y": topLeftOrigin.minY,
                "width": topLeftOrigin.width, "height": topLeftOrigin.height]
    }
    emit(["displays": displays])
}

if mode == "windows" {
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    let appFilter = value("--app", in: args)
    let windows: [[String: Any]] = list.compactMap { entry in
        guard let layer = entry[kCGWindowLayer as String] as? Int, layer == 0 else { return nil }
        guard let bounds = entry[kCGWindowBounds as String] as? [String: CGFloat],
              let width = bounds["Width"], let height = bounds["Height"] else { return nil }
        let name = entry[kCGWindowName as String] as? String ?? ""
        let owner = entry[kCGWindowOwnerName as String] as? String ?? ""
        let pid = entry[kCGWindowOwnerPID as String] as? Int ?? 0
        if let appFilter = appFilter, owner != appFilter { return nil }
        return ["windowId": entry[kCGWindowNumber as String] as? Int ?? 0, "pid": pid,
                "owner": owner, "title": (screenGranted ? name : ""),
                "x": bounds["X"] ?? 0, "y": bounds["Y"] ?? 0, "width": width, "height": height]
    }
    emit(["windows": windows, "screenCaptureGranted": screenGranted,
          "titleRequiresScreenCapture": true])
}

if mode == "screenshot" {
    requireScreen()
    guard let output = value("--out", in: args), output.hasSuffix(".png") else {
        fputs("Usage: helper screenshot --out <path.png> [--display <id> | --window-id <id> | --region x,y,w,h --display <id>]\n", stderr)
        exit(2)
    }
    let captureConfig = SCStreamConfiguration()
    captureConfig.showsCursor = false
    Task { @MainActor in
        do {
            if let windowID = value("--window-id", in: args).flatMap(UInt32.init) {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard let window = content.windows.first(where: { $0.windowID == CGWindowID(windowID) }) else {
                    fail("window-not-found", extra: ["windowId": Int(windowID)])
                }
                let filter = SCContentFilter(desktopIndependentWindow: window)
                let scale = CGFloat(filter.pointPixelScale)
                captureConfig.width = Int((window.frame.width * scale).rounded())
                captureConfig.height = Int((window.frame.height * scale).rounded())
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: captureConfig)
                guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                    fail("png-encoding-failed")
                }
                try png.write(to: URL(fileURLWithPath: output))
                emit(["status": "ok", "scope": "window", "windowId": Int(windowID),
                      "imageWidth": image.width, "imageHeight": image.height,
                      "scale": filter.pointPixelScale, "output": output])
            }
            let displayID = value("--display", in: args).flatMap(UInt32.init) ?? CGMainDisplayID()
            let bounds = CGDisplayBounds(displayID)
            let topLeftOrigin = CGRect(x: bounds.minX, y: primaryHeight - bounds.maxY,
                                       width: bounds.width, height: bounds.height)
            let shareable = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = shareable.displays.first(where: { $0.displayID == displayID }) else {
                fail("display-not-found", extra: ["display": Int(displayID)])
            }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            if let region = numbers("--region", count: 4, in: args) {
                // region 为全局顶左矩形；换算为该显示器顶左原点相对坐标。
                let relative = CGRect(x: region[0] - topLeftOrigin.minX, y: region[1] - topLeftOrigin.minY,
                                      width: region[2], height: region[3])
                guard relative.width > 0, relative.height > 0,
                      relative.intersects(CGRect(origin: .zero, size: topLeftOrigin.size)) else {
                    fail("region-outside-display", extra: ["display": Int(displayID)])
                }
                let crop = relative.intersection(CGRect(origin: .zero, size: topLeftOrigin.size))
                captureConfig.sourceRect = crop
                let scale = topLeftOrigin.width > 0 ? CGFloat(filter.pointPixelScale) : 2
                captureConfig.width = Int((crop.width * scale).rounded())
                captureConfig.height = Int((crop.height * scale).rounded())
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: captureConfig)
                guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                    fail("png-encoding-failed")
                }
                try png.write(to: URL(fileURLWithPath: output))
                emit(["status": "ok", "scope": "region", "display": Int(displayID),
                      "region": ["x": crop.minX, "y": crop.minY, "width": crop.width, "height": crop.height],
                      "imageWidth": image.width, "imageHeight": image.height, "output": output])
            }
            captureConfig.sourceRect = CGRect(origin: .zero, size: topLeftOrigin.size)
            let scale = CGFloat(filter.pointPixelScale)
            captureConfig.width = Int((topLeftOrigin.width * scale).rounded())
            captureConfig.height = Int((topLeftOrigin.height * scale).rounded())
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: captureConfig)
            guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                fail("png-encoding-failed")
            }
            try png.write(to: URL(fileURLWithPath: output))
            emit(["status": "ok", "scope": "display", "display": Int(displayID),
                  "imageWidth": image.width, "imageHeight": image.height,
                  "scale": scale, "output": output])
        } catch {
            fail("capture-failed", extra: ["message": String(describing: error)])
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { fail("screenshot-timeout") }
    NSApplication.shared.setActivationPolicy(.prohibited)
    NSApplication.shared.run()
}

if mode == "click" {
    guard let point = numbers("--at", count: 2, in: args), point[0] >= 0, point[1] >= 0 else {
        fputs("Usage: helper click --at x,y [--double] [--right]\n", stderr); exit(2)
    }
    requireInput()
    let position = cgPoint(topLeft: CGPoint(x: point[0], y: point[1]))
    let right = flag("--right", in: args)
    let double = flag("--double", in: args)
    let downType: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let upType: CGEventType = right ? .rightMouseUp : .leftMouseUp
    let button: CGMouseButton = right ? .right : .left
    func events(_ type: CGEventType, clickCount: Int64) -> CGEvent? {
        CGEvent(mouseEventSource: eventSource, mouseType: type,
                mouseCursorPosition: position, mouseButton: button).flatMap { event in
            event.setIntegerValueField(.mouseEventClickState, value: clickCount)
            event.flags = []
            return event
        }
    }
    let clickCount: Int64 = double ? 2 : 1
    guard let down = events(downType, clickCount: clickCount),
          let up = events(upType, clickCount: clickCount) else { fail("mouse-event-unavailable") }
    down.post(tap: .cghidEventTap)
    if double { usleep(80_000) }
    up.post(tap: .cghidEventTap)
    emit(["status": "ok", "at": ["x": point[0], "y": point[1]],
          "cgPoint": ["x": position.x, "y": position.y],
          "double": double, "right": right])
}

if mode == "scroll" {
    guard let deltas = numbers("--delta", count: 2, in: args) else {
        fputs("Usage: helper scroll --delta dx,dy（dy>0 表示内容向下滚动）\n", stderr); exit(2)
    }
    requireInput()
    // dy>0（模型语义：向下滚动）→ wheel1 负值（CG：正 wheel1 内容向远离用户方向滚动）。
    let wheel1 = Int32(clamping: -Int(deltas[1].rounded()))
    let wheel2 = Int32(clamping: Int(deltas[0].rounded()))
    guard let scroll = CGEvent(scrollWheelEvent2Source: eventSource, units: .line, wheelCount: 1,
                               wheel1: wheel1, wheel2: wheel2, wheel3: 0) else { fail("scroll-event-unavailable") }
    scroll.flags = []
    scroll.post(tap: .cghidEventTap)
    emit(["status": "ok", "delta": ["x": deltas[0], "y": deltas[1]]])
}

if mode == "key" {
    guard let keycode = value("--code", in: args).flatMap(UInt32.init) else {
        fputs("Usage: helper key --code <keycode> [--cmd] [--alt] [--ctrl] [--shift]\n", stderr); exit(2)
    }
    requireInput()
    var flags: CGEventFlags = []
    if flag("--cmd", in: args) { flags.insert(.maskCommand) }
    if flag("--alt", in: args) { flags.insert(.maskAlternate) }
    if flag("--ctrl", in: args) { flags.insert(.maskControl) }
    if flag("--shift", in: args) { flags.insert(.maskShift) }
    postKey(CGKeyCode(keycode), flags: flags)
    emit(["status": "ok", "keycode": Int(keycode),
          "flags": ["cmd": flag("--cmd", in: args), "alt": flag("--alt", in: args),
                    "ctrl": flag("--ctrl", in: args), "shift": flag("--shift", in: args)]])
}

if mode == "type" {
    guard let text = value("--text", in: args), !text.isEmpty,
          text.utf16.count <= 4096, !text.contains(where: { $0 == "\0" }) else {
        fputs("Usage: helper type --text <text(<=4096 chars)>\n", stderr); exit(2)
    }
    requireInput()
    guard let (down, up) = makeTextEvents(text) else { fail("keyboard-event-unavailable") }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    emit(["status": "ok", "characters": text.count])
}

if mode == "activate" {
    if let pid = value("--pid", in: args).flatMap(Int32.init) {
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            fail("process-not-found", extra: ["pid": Int(pid)])
        }
        let ok = app.activate()
        emit(["status": ok ? "ok" : "failed", "pid": Int(pid)], code: ok ? 0 : 1)
    }
    guard let bundleID = value("--bundle-id", in: args) else {
        fputs("Usage: helper activate --pid <n> | --bundle-id <id>\n", stderr); exit(2)
    }
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
        fail("app-not-running", extra: ["bundleId": bundleID])
    }
    let ok = app.activate()
    emit(["status": ok ? "ok" : "failed", "pid": app.processIdentifier, "bundleId": bundleID], code: ok ? 0 : 1)
}

if mode == "launch" {
    guard let bundleID = value("--bundle-id", in: args) else {
        fputs("Usage: helper launch --bundle-id <id>\n", stderr); exit(2)
    }
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
        fail("app-not-installed", extra: ["bundleId": bundleID])
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    NSWorkspace.shared.openApplication(at: url, configuration: config) { app, error in
        if let app = app, error == nil {
            emit(["status": "ok", "pid": app.processIdentifier, "bundleId": bundleID])
        }
        fail("launch-failed", extra: ["bundleId": bundleID, "message": String(describing: error)])
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { fail("launch-timeout") }
    NSApplication.shared.setActivationPolicy(.prohibited)
    NSApplication.shared.run()
}

fputs("Unknown mode. Available: version permissions displays windows screenshot click scroll key type activate launch\n", stderr)
exit(2)
