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

let mode = CommandLine.arguments.dropFirst().first ?? ""
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

func browserKey(_ key: CGKeyCode, command: Bool = false) {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false) else {
        emit(["status": "failed", "reason": "keyboard-event-unavailable"], code: 1)
    }
    if command { down.flags = .maskCommand; up.flags = .maskCommand }
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
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
        func ensureFocus() {
            guard getppid() == parentPID else {
                emit(["status": "cancelled", "reason": "parent-process-exited"])
            }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == safariPID else {
                emit(["status": "blocked", "reason": "safari-lost-focus"])
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            ensureFocus()
            browserKey(45, command: true) // Cmd+N: preserve existing tabs by using a new window.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                ensureFocus()
                browserKey(37, command: true) // Cmd+L
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    ensureFocus()
                    let units = Array(url.absoluteString.utf16)
                    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                        emit(["status": "failed", "reason": "keyboard-event-unavailable"], code: 1)
                    }
                    down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                    up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                    browserKey(36) // Return
                    let deadline = Date().addingTimeInterval(12)
                    func verify() {
                        ensureFocus()
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
                                    capture.width = Int(crop.width * (NSScreen.main?.backingScaleFactor ?? 1))
                                    capture.height = Int(crop.height * (NSScreen.main?.backingScaleFactor ?? 1))
                                    capture.showsCursor = false
                                    let image = try await SCScreenshotManager.captureImage(
                                        contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: capture)
                                    guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                                        emit(["status": "failed", "reason": "png-encoding-failed"], code: 1)
                                    }
                                    var finalBudget = 2500
                                    ensureFocus()
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
                            emit(["status": "failed", "reason": "target-url-not-observed"], code: 1)
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
if mode != "self-test" || CommandLine.arguments.count != 3 {
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
        let point = CGPoint(x: fieldRect.midX, y: mainHeight - fieldRect.midY)
        guard let clickDown = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                                      mouseCursorPosition: point, mouseButton: .left),
              let clickUp = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                                    mouseCursorPosition: point, mouseButton: .left) else {
            emit(["status": "failed", "reason": "mouse-event-unavailable"], code: 1)
        }
        clickDown.post(tap: .cghidEventTap); clickUp.post(tap: .cghidEventTap)
        let units = Array("MOOS_M01_INPUT_OK".utf16)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            emit(["status": "failed", "reason": "keyboard-event-unavailable"], code: 1)
        }
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
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
                    config.width = Int(own.frame.width * (window.screen?.backingScaleFactor ?? 1))
                    config.height = Int(own.frame.height * (window.screen?.backingScaleFactor ?? 1))
                    config.showsCursor = false
                    let image = try await SCScreenshotManager.captureImage(
                        contentFilter: SCContentFilter(desktopIndependentWindow: own), configuration: config)
                    let bitmap = NSBitmapImageRep(cgImage: image)
                    guard let png = bitmap.representation(using: .png, properties: [:]) else {
                        emit(["status": "failed", "reason": "png-encoding-failed"], code: 1)
                    }
                    try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
                    emit(["status": "passed", "inputVerified": true, "clickVerified": true, "captureScope": "probe-window-only",
                          "imageWidth": image.width, "imageHeight": image.height,
                          "screenScale": window.screen?.backingScaleFactor ?? 0])
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
