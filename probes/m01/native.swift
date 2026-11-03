import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit

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
