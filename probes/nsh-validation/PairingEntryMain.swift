import AppKit
import Foundation

@main @MainActor struct N01EntryMain {
    static func main() {
        let app = NSApplication.shared
        if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
            do { try check(); print("{\"status\":\"passed\",\"nativeViewConstructed\":true,\"windowShown\":false,\"humanSelectionVerified\":false}") }
            catch { fputs("Native entry check failed\n", stderr); exit(1) }
            return
        }
        let automatedDenial = CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--automation-deny"
        guard CommandLine.arguments.count == 1 || automatedDenial else { exit(1) }
        guard let snapshot = try? N01EntrySnapshot(FileHandle.standardInput.readData(ofLength: 4097)) else { exit(1) }
        app.setActivationPolicy(.regular)
        let view = N01EntryPanel(snapshot: snapshot) { result in
            guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) else { exit(1) }
            FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])); exit(0)
        }
        if automatedDenial { view.refuse(); return } // No automatic native select/start option.
        view.panel.center(); view.panel.makeKeyAndOrderFront(nil); app.activate(ignoringOtherApps: true)
        withExtendedLifetime(view) { app.run() }
    }
    static func check() throws {
        func require(_ value: Bool) { if !value { fatalError("Native entry assertion failed") } }
        let raw: [String: Any] = ["version": 1, "requestId": String(repeating: "a", count: 64), "projects": ["project-a", "project-b"], "validForMs": 60000]
        let data = try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys])
        let snapshot = try N01EntrySnapshot(data)
        var results: [[String: Any]] = []; var time = 1.0
        let view = N01EntryPanel(snapshot: snapshot, now: { time }) { results.append($0) }
        require(!view.panel.isVisible && !view.start.isEnabled && view.choices.allSatisfy { $0.state == .off })
        require(view.cancel.keyEquivalent == "\r" && view.start.keyEquivalent.isEmpty)
        view.selectProjects(); require(results.isEmpty)
        view.choices[1].state = .on; view.toggle(); require(view.start.isEnabled)
        view.choices[1].state = .off; view.toggle(); require(!view.start.isEnabled)
        view.choices[0].state = .on; view.toggle(); view.selectProjects()
        require(results.count == 1 && results[0]["projects"] as? [String] == ["project-a"])
        view.refuse(); require(results.count == 1)
        let late = N01EntryPanel(snapshot: snapshot, now: { time }) { results.append($0) }
        time = 61; late.choices[0].state = .on; late.selectProjects()
        require(results.count == 2 && results[1]["decision"] as? String == "deny")
        let closed = N01EntryPanel(snapshot: snapshot) { results.append($0) }; _ = closed.windowShouldClose(closed.panel)
        require(results.count == 3 && results[2]["decision"] as? String == "deny")
        for change: [String: Any] in [["version": true], ["projects": []], ["projects": ["a", "a"]], ["projects": ["a\n"]], ["requestId": String(repeating: "a", count: 64) + "\n"], ["validForMs": true], ["validForMs": 60001], ["unknown": 1]] {
            var invalid = raw; invalid.merge(change) { _, new in new }
            require((try? N01EntrySnapshot(JSONSerialization.data(withJSONObject: invalid))) == nil)
        }
        let duplicate = String(data: data, encoding: .utf8)!.replacingOccurrences(of: "\"version\":1", with: "\"version\":1,\"version\":1")
        require((try? N01EntrySnapshot(Data(duplicate.utf8))) == nil)
    }
}
