// 沐码桌面操作 helper（M06）。每条命令独立进程，stdout 仅输出 JSON。
// 坐标协议：输入/输出统一使用 Quartz 全局顶左逻辑点（CGDisplayBounds/CGWindowList/CGEvent）。
// NSScreen.frame 使用 AppKit 底左坐标，不能混用或对 Quartz 坐标再次翻转。键入与点击事件使用私有 CGEventSource，
// down 事件携带显式修饰键标志、up 事件标志显式清空（不继承先前 Command 状态，M01/E14 结论）。
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit

let helperVersion = "2"

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
    let parts = raw.split(separator: ",", omittingEmptySubsequences: false).map { Double($0) }
    guard parts.count == count, parts.allSatisfy({ $0?.isFinite == true }) else { return nil }
    return parts.compactMap { $0 }
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

// Focus snapshots never include window titles, text values, URLs or accessibility descriptions.
// Fail closed when AX focus cannot be mapped uniquely to a visible Quartz window.
func axValue(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
    return result
}
func axRect(_ element: AXUIElement) -> CGRect? {
    guard let p = axValue(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = axValue(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func rectObject(_ r: CGRect) -> [String: Double] {
    ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height]
}
func focusSnapshot() -> [String: Any] {
    requireInput()
    guard let app = NSWorkspace.shared.frontmostApplication,
          let bundle = app.bundleIdentifier else { fail("focus-unavailable") }
    let application = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(application, 1)
    guard let w = axValue(application, kAXFocusedWindowAttribute), CFGetTypeID(w) == AXUIElementGetTypeID(),
          let f = axValue(application, kAXFocusedUIElementAttribute), CFGetTypeID(f) == AXUIElementGetTypeID() else { fail("focus-unavailable") }
    let window = w as! AXUIElement, focused = f as! AXUIElement
    guard let bounds = axRect(window), let elementBounds = axRect(focused),
          let role = axValue(focused, kAXRoleAttribute) as? String else { fail("focus-unavailable") }
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
    let matches = windows.filter { entry in
        guard entry[kCGWindowOwnerPID as String] as? Int32 == app.processIdentifier,
              entry[kCGWindowLayer as String] as? Int == 0,
              let b = entry[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
        return abs((b["X"] ?? .infinity) - bounds.minX) < 1 && abs((b["Y"] ?? .infinity) - bounds.minY) < 1 &&
            abs((b["Width"] ?? 0) - bounds.width) < 1 && abs((b["Height"] ?? 0) - bounds.height) < 1
    }
    guard matches.count == 1, let id = matches[0][kCGWindowNumber as String] as? Int else { fail("focus-unavailable") }
    var ancestors: [Int] = []
    var cursor = focused
    for _ in 0..<32 {
        if CFEqual(cursor, window) { break }
        guard let rawParent = axValue(cursor, kAXParentAttribute), CFGetTypeID(rawParent) == AXUIElementGetTypeID(),
              let children = axValue(rawParent as! AXUIElement, kAXChildrenAttribute) as? [AXUIElement],
              let index = children.firstIndex(where: { CFEqual($0, cursor) }) else { fail("focus-unavailable") }
        ancestors.append(index); cursor = rawParent as! AXUIElement
    }
    guard CFEqual(cursor, window) else { fail("focus-unavailable") }
    return ["pid": Int(app.processIdentifier), "bundleId": bundle, "windowId": id,
            "window": rectObject(bounds), "element": rectObject(elementBounds), "role": role, "path": ancestors]
}
func expectedFocus(_ args: [String]) -> [String: Any] {
    guard let raw = value("--expect-focus", in: args), raw.utf8.count < 8192,
          let data = raw.data(using: .utf8), let expected = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          expected["pid"] as? Int != nil, expected["windowId"] as? Int != nil,
          expected["bundleId"] as? String != nil, expected["path"] as? [Int] != nil,
          expected["window"] as? [String: Double] != nil, expected["element"] as? [String: Double] != nil,
          expected["role"] as? String != nil else { fail("focus-required", code: 2) }
    return expected
}
func focusRejection(_ expected: [String: Any], _ actual: [String: Any], typing: Bool) -> String? {
    guard NSDictionary(dictionary: expected).isEqual(to: actual) else { return "focus-changed" }
    if typing && !["AXTextField", "AXTextArea", "AXComboBox"].contains(actual["role"] as? String ?? "") {
        return "focus-not-editable"
    }
    return nil
}
// Dock can publish an opaque, full-display layer-20 bookkeeping surface even
// when AX hit-testing resolves to the foreground application underneath it.
// Only this exact system-owned surface is eligible for an AX-confirmed exception.
func isDockDisplaySurface(bundle: String?, executable: String?, layer: Int, bounds: CGRect,
                          displays: [CGRect]) -> Bool {
    bundle == "com.apple.dock" && executable == "/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock" &&
        layer == 20 && displays.contains(bounds)
}
func pointHitsFocusedWindow(_ point: CGPoint, actual: [String: Any]) -> Bool {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 1)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
          let hit = hit else { return false }
    var pid: pid_t = 0
    guard AXUIElementGetPid(hit, &pid) == .success, Int(pid) == actual["pid"] as? Int else { return false }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1)
    guard let rawWindow = axValue(app, kAXFocusedWindowAttribute), CFGetTypeID(rawWindow) == AXUIElementGetTypeID(),
          let bounds = axRect(rawWindow as! AXUIElement),
          NSDictionary(dictionary: rectObject(bounds)).isEqual(to: actual["window"] as? [String: Double] ?? [:]) else { return false }
    let window = rawWindow as! AXUIElement
    if CFEqual(hit, window) { return true }
    guard let hitWindow = axValue(hit, kAXWindowAttribute), CFGetTypeID(hitWindow) == AXUIElementGetTypeID() else { return false }
    return CFEqual(hitWindow, window)
}
func checkFocus(_ args: [String], point: CGPoint? = nil, typing: Bool = false) {
    let expected = expectedFocus(args)
    let actual = focusSnapshot()
    if let reason = focusRejection(expected, actual, typing: typing) { fail(reason, code: 5) }
    if let point = point, let b = actual["window"] as? [String: Double] {
        let bounds = CGRect(x: b["x"]!, y: b["y"]!, width: b["width"]!, height: b["height"]!)
        guard bounds.contains(point) else { fail("point-outside-target", code: 5) }
        // A floating window/popover above the target must not receive a coordinate action.
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
        let hit = list.first { entry in
            guard (entry[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let b = entry[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
            return CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0).contains(point)
        }
        if hit?[kCGWindowNumber as String] as? Int != actual["windowId"] as? Int {
            guard let hit = hit, let pid = hit[kCGWindowOwnerPID as String] as? Int32,
                  let app = NSRunningApplication(processIdentifier: pid),
                  let b = hit[kCGWindowBounds as String] as? [String: CGFloat],
                  isDockDisplaySurface(bundle: app.bundleIdentifier, executable: app.executableURL?.path,
                    layer: hit[kCGWindowLayer as String] as? Int ?? -1,
                    bounds: CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0),
                    displays: NSScreen.screens.map { CGDisplayBounds(screenID($0)) }),
                  pointHitsFocusedWindow(point, actual: actual) else { fail("target-occluded", code: 5) }
            // Never skip another window below the system surface. AX must resolve
            // this point to the exact focused window, not merely the same PID.
        }
    }
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

// Non-posting diagnostic of the same comparison predicate; never reads/replaces live AX state.
if mode == "plan-focus" {
    let expected = expectedFocus(args)
    guard let raw = value("--actual-focus", in: args), let data = raw.data(using: .utf8),
          let actual = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { exit(2) }
    let reason = focusRejection(expected, actual, typing: flag("--typing", in: args))
    emit(["posted": false, "accepted": reason == nil, "reason": reason ?? "matched"])
}
// Pure, non-posting classification; live AX/window checks cannot be supplied by callers.
if mode == "plan-occlusion" {
    guard let bounds = numbers("--bounds", count: 4, in: args),
          let display = numbers("--display-bounds", count: 4, in: args),
          let layer = value("--layer", in: args).flatMap(Int.init) else { exit(2) }
    let candidate = isDockDisplaySurface(bundle: value("--owner-bundle", in: args),
        executable: value("--owner-executable", in: args), layer: layer,
        bounds: CGRect(x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3]),
        displays: [CGRect(x: display[0], y: display[1], width: display[2], height: display[3])])
    emit(["posted": false, "requiresLiveAXWindowHit": candidate, "accepted": false])
}
if mode == "focus" { emit(["status": "ok", "focus": focusSnapshot()]) }

if mode == "displays" {
    let displays: [[String: Any]] = NSScreen.screens.map { screen in
        let id = screenID(screen)
        let bounds = CGDisplayBounds(id)
        // 顶左原点全局坐标中的显示器矩形。
        let topLeftOrigin = bounds
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
    guard let output = value("--out", in: args), output.hasSuffix(".png") else {
        fputs("Usage: helper screenshot --out <path.png> [--display <id> | --window-id <id> | --region x,y,w,h --display <id>]\n", stderr)
        exit(2)
    }
    if flag("--region", in: args) {
        guard let region = numbers("--region", count: 4, in: args), region[2] > 0, region[3] > 0 else { exit(2) }
    }
    for name in ["--display", "--window-id"] where flag(name, in: args) {
        guard let id = value(name, in: args).flatMap(UInt32.init), id > 0 else { exit(2) }
    }
    requireScreen()
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
            let topLeftOrigin = bounds
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
                      "region": ["x": crop.minX + topLeftOrigin.minX, "y": crop.minY + topLeftOrigin.minY, "width": crop.width, "height": crop.height],
                      "scale": filter.pointPixelScale,
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

if mode == "click" || mode == "plan-click" {
    guard let point = numbers("--at", count: 2, in: args) else {
        fputs("Usage: helper click --at x,y [--double] [--right]\n", stderr); exit(2)
    }
    if mode == "click" { requireInput(); _ = expectedFocus(args) }
    let position = CGPoint(x: point[0], y: point[1])
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
    let counts: [Int64] = double ? [1, 2] : [1]
    var planned: [[String: Any]] = []
    for count in counts {
        guard let down = events(downType, clickCount: count),
              let up = events(upType, clickCount: count) else { fail("mouse-event-unavailable") }
        for event in [down, up] {
            planned.append(["type": event.type.rawValue, "clickCount": count,
                            "x": event.location.x, "y": event.location.y, "flags": event.flags.rawValue])
        }
        if mode == "click" {
            checkFocus(args, point: position)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            if double && count == 1 { usleep(80_000) }
        }
    }
    emit(["status": "ok", "at": ["x": point[0], "y": point[1]],
          "cgPoint": ["x": position.x, "y": position.y], "events": planned,
          "posted": mode == "click", "double": double, "right": right])
}

if mode == "scroll" {
    guard let deltas = numbers("--delta", count: 2, in: args), deltas.allSatisfy({ abs($0) <= 10000 }) else {
        fputs("Usage: helper scroll --delta dx,dy（dy>0 表示内容向下滚动）\n", stderr); exit(2)
    }
    requireInput()
    // dy>0（模型语义：向下滚动）→ wheel1 负值（CG：正 wheel1 内容向远离用户方向滚动）。
    let wheel1 = Int32(clamping: -Int(deltas[1].rounded()))
    let wheel2 = Int32(clamping: Int(deltas[0].rounded()))
    guard let scroll = CGEvent(scrollWheelEvent2Source: eventSource, units: .line, wheelCount: 2,
                               wheel1: wheel1, wheel2: wheel2, wheel3: 0) else { fail("scroll-event-unavailable") }
    scroll.flags = []
    guard let point = CGEvent(source: nil)?.location else { fail("cursor-unavailable") }
    checkFocus(args, point: point)
    scroll.post(tap: .cghidEventTap)
    emit(["status": "ok", "delta": ["x": deltas[0], "y": deltas[1]]])
}

if mode == "key" {
    guard let keycode = value("--code", in: args).flatMap(UInt16.init), keycode <= 127 else {
        fputs("Usage: helper key --code <keycode> [--cmd] [--alt] [--ctrl] [--shift]\n", stderr); exit(2)
    }
    requireInput()
    var flags: CGEventFlags = []
    if flag("--cmd", in: args) { flags.insert(.maskCommand) }
    if flag("--alt", in: args) { flags.insert(.maskAlternate) }
    if flag("--ctrl", in: args) { flags.insert(.maskControl) }
    if flag("--shift", in: args) { flags.insert(.maskShift) }
    checkFocus(args)
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
    checkFocus(args, typing: true)
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    // CGEvent.post is asynchronous. Local MuSu trials showed empty fields after
    // immediate exit and visible text with a 250ms process lifetime. Keep the
    // posting process alive for this bounded interval; this is NOT a delivery ACK,
    // no retry/focus reclaim is allowed, and the caller must freshly observe.
    Thread.sleep(forTimeInterval: 0.25)
    emit(["status": "ok", "characters": text.count, "posted": true,
          "businessGoalVerified": false])
}

if mode == "activate" {
    requireInput(); requireScreen()
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
    requireInput(); requireScreen()
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

fputs("Unknown mode. Available: version permissions displays windows focus screenshot click scroll key type activate launch plan-click plan-focus\n", stderr)
exit(2)
