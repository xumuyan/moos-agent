import AppKit
import Foundation

@main @MainActor struct N01ReviewMain {
    static func main() {
        let app = NSApplication.shared
        if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
            do { try check(); print("{\"status\":\"passed\",\"checks\":18,\"nativeViewConstructed\":true,\"humanConfirmationVerified\":false,\"phoneVerified\":false}") }
            catch { fputs("Native local review check failed\n", stderr); exit(1) }
            return
        }
        let automatedDenial = CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--automation-deny"
        guard CommandLine.arguments.count == 1 || automatedDenial else { exit(1) }
        // Trusted local stdin only. No file paths/URLs from JS and no HTTP approval route.
        let data = FileHandle.standardInput.readData(ofLength: 4097)
        guard let snapshot = try? N01ReviewSnapshot(data) else { exit(1) }
        app.setActivationPolicy(.regular)
        let view = N01ReviewPanel(snapshot: snapshot) { result in
            guard let output = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) else { exit(1) }
            FileHandle.standardOutput.write(output); FileHandle.standardOutput.write(Data([10])); exit(0)
        }
        if automatedDenial { view.refuse(); return } // Test-only denial can never approve.
        view.panel.center(); view.panel.makeKeyAndOrderFront(nil); app.activate(ignoringOtherApps: true)
        withExtendedLifetime(view) { app.run() }
    }
    static func check() throws {
        func require(_ value: Bool) { if !value { fatalError("Native review assertion failed") } }
        let raw: [String: Any] = ["version": 1, "requestId": String(repeating: "a", count: 64),
          "claimId": String(repeating: "b", count: 64), "transcript": String(repeating: "c", count: 64),
          "endpoint": "https://127.0.0.1:12345", "projects": ["project-a", "project-b"], "validForMs": 60000]
        let data = try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys, .withoutEscapingSlashes])
        let snapshot = try N01ReviewSnapshot(data)
        require(snapshot.projects == ["project-a", "project-b"])
        require(snapshot.reply("deny")["transcript"] as? String == snapshot.transcript)
        var replies: [[String: Any]] = []; var clock = 10.0
        let view = N01ReviewPanel(snapshot: snapshot, now: { clock }) { replies.append($0) }
        require(!view.panel.isVisible)
        require(!view.approve.isEnabled)
        require(view.deny.keyEquivalent == "\r" && view.approve.keyEquivalent.isEmpty)
        if view.approve.isEnabled { view.approve.performClick(nil) }; require(replies.isEmpty)
        view.comparison.state = .on; view.toggle(); require(view.approve.isEnabled)
        view.comparison.state = .off; view.toggle(); require(!view.approve.isEnabled)
        view.comparison.state = .on; view.toggle(); view.allow()
        require(replies.count == 1 && replies[0]["decision"] as? String == "approve")
        view.refuse(); require(replies.count == 1)
        var rejected: [[String: Any]] = []
        let late = N01ReviewPanel(snapshot: snapshot, now: { clock }) { rejected.append($0) }
        clock = 70; late.comparison.state = .on; late.allow()
        require(rejected.count == 1 && rejected[0]["decision"] as? String == "deny")
        let closed = N01ReviewPanel(snapshot: snapshot) { rejected.append($0) }
        _ = closed.windowShouldClose(closed.panel)
        require(rejected.count == 2 && rejected[1]["decision"] as? String == "deny")
        for replacement: [String: Any] in [["version": true], ["validForMs": true], ["endpoint": "https://192.168.1.1:1234"], ["projects": ["project-a\n"]], ["unknown": "x"]] {
            var invalid = raw; invalid.merge(replacement) { _, new in new }
            require((try? N01ReviewSnapshot(JSONSerialization.data(withJSONObject: invalid))) == nil)
        }
        let duplicate = String(data: data, encoding: .utf8)!.replacingOccurrences(of: "\"version\":1", with: "\"version\":1,\"version\":1")
        require((try? N01ReviewSnapshot(Data(duplicate.utf8))) == nil)
    }
}
