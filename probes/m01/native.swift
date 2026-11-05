import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import Darwin

func emit(_ value: [String: Any], code: Int32 = 0) -> Never {
    do { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) }
    catch { fputs("Unable to encode native probe result.\n", stderr); exit(2) }
    exit(code)
}

func cgPoint(_ point: CGPoint, primaryHeight: CGFloat) -> CGPoint {
    CGPoint(x: point.x, y: primaryHeight - point.y)
}

func capturePixels(_ size: CGSize, scale: CGFloat) -> [String: Int] {
    ["width": Int((size.width * scale).rounded()), "height": Int((size.height * scale).rounded())]
}

func inputAllowed(active: Bool, key: Bool, editor: Bool) -> Bool {
    active && key && editor
}

func screenID(_ screen: NSScreen) -> CGDirectDisplayID {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! NSNumber).uint32Value
}

let mode = CommandLine.arguments.dropFirst().first ?? ""
if mode == "input-focus", CommandLine.arguments.count == 3 {
    let flags = Array(CommandLine.arguments[2])
    guard flags.count == 3, flags.allSatisfy({ $0 == "0" || $0 == "1" }) else { exit(2) }
    emit(["allowed": inputAllowed(active: flags[0] == "1", key: flags[1] == "1", editor: flags[2] == "1"),
          "inputInjected": false])
}
if mode == "displays" {
    let displays: [[String: Any]] = NSScreen.screens.map { screen in
        let id = screenID(screen)
        let bounds = CGDisplayBounds(id)
        return ["id": id, "isPrimary": id == CGMainDisplayID(), "scale": screen.backingScaleFactor,
                "x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height]
    }
    emit(["displays": displays, "inputInjected": false, "screenshotCaptured": false])
}
if mode == "coordinate-plan" {
    let values = CommandLine.arguments.dropFirst(2).compactMap(Double.init)
    guard values.count == 6, values.allSatisfy({ $0.isFinite }),
          values[2] > 0, values[3] > 0, values[3] <= 4,
          values[4] > 0, values[5] > 0, values[4] <= 16384, values[5] <= 16384 else { exit(2) }
    let point = cgPoint(CGPoint(x: values[0], y: values[1]), primaryHeight: values[2])
    emit(["point": ["x": point.x, "y": point.y],
          "pixels": capturePixels(CGSize(width: values[4], height: values[5]), scale: values[3]),
          "inputInjected": false, "screenshotCaptured": false])
}
let screenGranted = CGPreflightScreenCaptureAccess()
let inputGranted = AXIsProcessTrusted()
if mode == "permissions" {
    var count: UInt32 = 0
    let status = CGGetActiveDisplayList(0, nil, &count)
    emit(["screenCaptureGranted": screenGranted, "accessibilityGranted": inputGranted,
          "activeDisplays": Int(count), "displayQuerySucceeded": status == .success,
          "screenScale": NSScreen.main?.backingScaleFactor ?? 0,
          "system": ProcessInfo.processInfo.operatingSystemVersionString,
          "inputInjected": false, "screenshotCaptured": false])
}

// Explicit navigation avoids leaving System Settings on a previously opened pane.
let permissionSettings = [
    "request-screen": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "request-accessibility": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
]
// Read-only route inspection for regression tests; never opens settings or grants access.
if mode == "permission-settings" { emit(permissionSettings) }
if let destination = permissionSettings[mode], let url = URL(string: destination) {
    let opened = NSWorkspace.shared.open(url)
    emit(["screenCaptureGranted": screenGranted, "accessibilityGranted": inputGranted,
          "settingsOpened": opened, "settingsURL": destination], code: opened ? 0 : 1)
}

func axValue(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}

func targetPage(_ root: AXUIElement, url: URL, budget: inout Int) -> AXUIElement? {
    if budget <= 0 { return nil }
    budget -= 1
    if let role = axValue(root, kAXRoleAttribute as String) as? String, role == "AXWebArea",
       let value = axValue(root, kAXURLAttribute as String) {
        let candidate = (value as? URL) ?? ((value as? String).flatMap { URL(string: $0) })
        if candidate?.standardizedFileURL == url.standardizedFileURL { return root }
    }
    if let children = axValue(root, kAXChildrenAttribute as String) as? [AXUIElement] {
        for child in children {
            if let found = targetPage(child, url: url, budget: &budget) { return found }
        }
    }
    return nil
}

func pageFrame(_ element: AXUIElement) -> CGRect? {
    guard let position = axValue(element, kAXPositionAttribute as String),
          let size = axValue(element, kAXSizeAttribute as String),
          CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}

// A private source plus explicit flags prevents Cmd+L from contaminating text/Return.
let browserEventSource = CGEventSource(stateID: .privateState)
func browserEvents(_ key: CGKeyCode, command: Bool = false, text: String? = nil) -> (CGEvent, CGEvent) {
    guard let source = browserEventSource,
          let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false) else {
        emit(["status": "failed", "reason": "keyboard-event-unavailable"], code: 1)
    }
    down.flags = command ? .maskCommand : []
    up.flags = []
    if let text = text {
        let units = Array(text.utf16)
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
    }
    return (down, up)
}
func browserKey(_ key: CGKeyCode, command: Bool = false) {
    let (down, up) = browserEvents(key, command: command)
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
}
// Construct events without posting any input; exercise the same factory as the GUI flow.
if mode == "keyboard-events" {
    let (shortcutDown, shortcutUp) = browserEvents(37, command: true)
    let (textDown, textUp) = browserEvents(0, text: "file:///tmp/moos/index.html")
    let (returnDown, returnUp) = browserEvents(36)
    emit(["shortcutDownFlags": shortcutDown.flags.rawValue, "shortcutUpFlags": shortcutUp.flags.rawValue,
          "textDownFlags": textDown.flags.rawValue, "textUpFlags": textUp.flags.rawValue,
          "returnDownFlags": returnDown.flags.rawValue, "returnUpFlags": returnUp.flags.rawValue,
          "inputInjected": false])
}

if mode == "browser-probe" {
    guard CommandLine.arguments.count == 5,
          let url = URL(string: CommandLine.arguments[2]), url.isFileURL,
          url.lastPathComponent == "index.html",
          CommandLine.arguments[3].range(of: "^MOOS_M01_BROWSER_[0-9_]+$", options: .regularExpression) != nil else {
        fputs("Invalid fixed browser-probe arguments.\n", stderr); exit(2)
    }
    if !screenGranted || !inputGranted {
        emit(["status": "blocked", "reason": "system-permission-required",
              "screenCaptureGranted": screenGranted, "accessibilityGranted": inputGranted])
    }
    let parentPID = getppid()
    let parentTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
        if getppid() != parentPID { emit(["status": "cancelled", "reason": "parent-process-exited"]) }
    }
    _ = parentTimer
    let marker = CommandLine.arguments[3]
    let output = URL(fileURLWithPath: CommandLine.arguments[4])
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    guard let safariURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") else {
        emit(["status": "blocked", "reason": "safari-not-installed"])
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    NSWorkspace.shared.openApplication(at: safariURL, configuration: config) { safari, error in
        guard let safari = safari, error == nil else {
            emit(["status": "failed", "reason": "safari-launch-failed"], code: 1)
        }
        let safariPID = safari.processIdentifier
        var textEventFlags: UInt64 = 0
        func ensureFocus(_ stage: String) {
            guard getppid() == parentPID else {
                emit(["status": "cancelled", "reason": "parent-process-exited"])
            }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == safariPID else {
                emit(["status": "blocked", "reason": "safari-lost-focus", "stage": stage])
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            ensureFocus("before-new-window")
            browserKey(45, command: true) // Cmd+N: preserve existing tabs by using a new window.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                ensureFocus("before-address-focus")
                browserKey(37, command: true) // Cmd+L
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    ensureFocus("before-url-input")
                    let (down, up) = browserEvents(0, text: url.absoluteString)
                    textEventFlags = down.flags.rawValue
                    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                    browserKey(36) // Return
                    let deadline = Date().addingTimeInterval(12)
                    func verify() {
                        ensureFocus("observe-target")
                        let safariAX = AXUIElementCreateApplication(safariPID)
                        var budget = 2500
                        let focused = axValue(safariAX, kAXFocusedWindowAttribute as String)
                        if let focused = focused,
                           CFGetTypeID(focused) == AXUIElementGetTypeID(),
                           let webArea = targetPage(unsafeBitCast(focused, to: AXUIElement.self), url: url, budget: &budget),
                           let contentFrame = pageFrame(webArea) {
                            Task { @MainActor in
                                do {
                                    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                                    guard let window = content.windows.first(where: {
                                        $0.owningApplication?.processID == safariPID && ($0.title ?? "").contains(marker)
                                    }) else {
                                        emit(["status": "failed", "reason": "verified-test-window-not-found"], code: 1)
                                    }
                                    let capture = SCStreamConfiguration()
                                    let crop = CGRect(x: contentFrame.minX - window.frame.minX,
                                                      y: contentFrame.minY - window.frame.minY,
                                                      width: contentFrame.width, height: contentFrame.height)
                                        .intersection(CGRect(origin: .zero, size: window.frame.size))
                                    guard crop.width > 0, crop.height > 0 else {
                                        emit(["status": "failed", "reason": "test-content-frame-invalid"], code: 1)
                                    }
                                    capture.sourceRect = crop
                                    let filter = SCContentFilter(desktopIndependentWindow: window)
                                    let pixels = capturePixels(crop.size, scale: CGFloat(filter.pointPixelScale))
                                    capture.width = pixels["width"]!
                                    capture.height = pixels["height"]!
                                    capture.showsCursor = false
                                    let image = try await SCScreenshotManager.captureImage(
                                        contentFilter: filter, configuration: capture)
                                    guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                                        emit(["status": "failed", "reason": "png-encoding-failed"], code: 1)
                                    }
                                    var finalBudget = 2500
                                    ensureFocus("before-save")
                                    guard targetPage(webArea, url: url, budget: &finalBudget) != nil else {
                                        emit(["status": "blocked", "reason": "test-page-changed-before-save"])
                                    }
                                    try png.write(to: output)
                                    emit(["status": "passed", "browser": "Safari", "keyboardNavigation": true,
                                          "urlVerified": true, "markerVerified": true, "captureScope": "verified-test-page-content",
                                          "imageWidth": image.width, "imageHeight": image.height])
                                } catch { emit(["status": "failed", "reason": "verified-window-capture-failed"], code: 1) }
                            }
                        } else if Date() < deadline {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { verify() }
                        } else {
                            emit(["status": "failed", "reason": "target-url-not-observed", "textEventFlags": textEventFlags], code: 1)
                        }
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { verify() }
                }
            }
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 22) {
        emit(["status": "failed", "reason": "browser-probe-timeout"], code: 1)
    }
    app.run()
}

// Explicit, bounded desktop self-test. Only our own temporary window is captured.
var requestedScreen: NSScreen?
if mode == "self-test", CommandLine.arguments.count == 5, CommandLine.arguments[3] == "--display" {
    guard let id = UInt32(CommandLine.arguments[4]),
          let screen = NSScreen.screens.first(where: { screenID($0) == id }) else {
        emit(["status": "failed", "reason": "display-not-found", "inputInjected": false], code: 2)
    }
    requestedScreen = screen
}
if mode != "self-test" || !(CommandLine.arguments.count == 3 || requestedScreen != nil) {
    fputs("Usage: moos-native permissions | self-test <own-window.png>\n", stderr); exit(2)
}
if !screenGranted || !inputGranted {
    emit(["status": "blocked", "reason": "system-permission-required",
          "screenCaptureGranted": screenGranted, "accessibilityGranted": inputGranted], code: 3)
}
if #available(macOS 14.0, *) {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 520, height: 200),
        styleMask: [.titled, .closable], backing: .buffered, defer: false)
    if let screen = requestedScreen {
        window.setFrameOrigin(NSPoint(x: screen.visibleFrame.midX - window.frame.width / 2,
                                      y: screen.visibleFrame.midY - window.frame.height / 2))
    }
    window.title = "Moos M01 · 桌面输入自测"
    let field = NSTextField(frame: NSRect(x: 30, y: 80, width: 460, height: 32))
    field.placeholderString = "仅向此测试窗口输入"
    window.contentView!.addSubview(field)
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    window.makeFirstResponder(nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
        // Refuse to type if another application or window owns the focus.
        guard app.isActive, window.isKeyWindow else {
            emit(["status": "blocked", "reason": "probe-window-not-focused"], code: 3)
        }
        let fieldRect = window.convertToScreen(field.convert(field.bounds, to: nil))
        let mainHeight = CGDisplayBounds(CGMainDisplayID()).height
        let point = cgPoint(CGPoint(x: fieldRect.midX, y: fieldRect.midY), primaryHeight: mainHeight)
        guard requestedScreen == nil || window.screen.map(screenID) == requestedScreen.map(screenID) else {
            emit(["status": "blocked", "reason": "target-display-changed"], code: 3)
        }
        guard let clickDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                                      mouseCursorPosition: point, mouseButton: .left),
              let clickUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                                    mouseCursorPosition: point, mouseButton: .left) else {
            emit(["status": "failed", "reason": "mouse-event-unavailable"], code: 1)
        }
        clickDown.post(tap: .cghidEventTap); clickUp.post(tap: .cghidEventTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            guard inputAllowed(active: app.isActive, key: window.isKeyWindow,
                               editor: field.currentEditor().map { window.firstResponder === $0 } ?? false) else {
                emit(["status": "blocked", "reason": "probe-input-focus-lost"], code: 3)
            }
            let (down, up) = browserEvents(0, text: "MOOS_M01_INPUT_OK")
            down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            guard field.stringValue == "MOOS_M01_INPUT_OK" else {
                emit(["status": "failed", "reason": "input-not-received"], code: 1)
            }
            Task { @MainActor in
                do {
                    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                    guard let own = content.windows.first(where: { $0.windowID == CGWindowID(window.windowNumber) }) else {
                        emit(["status": "failed", "reason": "own-window-not-found"], code: 1)
                    }
                    let config = SCStreamConfiguration()
                    let filter = SCContentFilter(desktopIndependentWindow: own)
                    let pixels = capturePixels(own.frame.size, scale: CGFloat(filter.pointPixelScale))
                    config.width = pixels["width"]!
                    config.height = pixels["height"]!
                    config.showsCursor = false
                    let image = try await SCScreenshotManager.captureImage(
                        contentFilter: filter, configuration: config)
                    let bitmap = NSBitmapImageRep(cgImage: image)
                    guard let png = bitmap.representation(using: .png, properties: [:]) else {
                        emit(["status": "failed", "reason": "png-encoding-failed"], code: 1)
                    }
                    try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
                    emit(["status": "passed", "inputVerified": true, "clickVerified": true, "captureScope": "probe-window-only",
                          "imageWidth": image.width, "imageHeight": image.height,
                          "screenScale": window.screen!.backingScaleFactor, "displayID": screenID(window.screen!),
                          "captureScale": filter.pointPixelScale,
                          "windowWidthPoints": own.frame.width, "windowHeightPoints": own.frame.height,
                          "clickPoint": ["x": point.x, "y": point.y]])
                } catch { emit(["status": "failed", "reason": "own-window-capture-failed"], code: 1) }
            }
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
        emit(["status": "failed", "reason": "native-probe-timeout"], code: 1)
    }
    app.run()
} else {
    emit(["status": "blocked", "reason": "self-test-requires-macos-14"], code: 3)
}
