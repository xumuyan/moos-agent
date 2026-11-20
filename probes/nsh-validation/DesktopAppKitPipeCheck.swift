import AppKit
import Darwin

// AppKit lifecycle and the existing private PI pipe only, not an NSH embedding.
@MainActor
private final class AppKitCheck: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 130),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "N01 AppKit PI 管道探针"
        window.contentView = NSTextField(labelWithString: "合成验证：没有接入 NSH 界面或外部模型")
        window.center()
        window.orderBack(nil) // no focus, pointer, or keyboard automation
        self.window = window
        Task { await run() }
    }

    private enum Failure: Error { case check, rpc, deadline }
    private func require(_ condition: Bool) throws { if !condition { throw Failure.check } }

    private func run() async {
        var pipe: DesktopPipe?, checks: [String] = []
        var stage = "window"
        var passed = false
        do {
            try require(window?.isVisible == true)
            checks.append(stage)
            stage = "projects and session"
            let transport = try DesktopPipe()
            pipe = transport
            func call(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
                let reply = try await transport.request(method, params)
                guard reply["ok"] as? Bool == true, let result = reply["result"] as? [String: Any] else { throw Failure.rpc }
                return result
            }
            let list = try await call("projects.list")
            guard let projects = list["projects"] as? [[String: Any]], projects.count == 2,
                  let projectId = projects[0]["id"] as? String, let otherId = projects[1]["id"] as? String,
                  (list["models"] as? [String: Any])?["defaultId"] as? String == "fixture",
                  let session = try await call("sessions.create", ["projectId": projectId, "title": "AppKit probe"])["session"] as? [String: Any],
                  let sessionId = session["id"] as? String else { throw Failure.check }
            let scope: [String: Any] = ["projectId": projectId, "sessionId": sessionId]
            checks.append(stage)
            func params(_ extra: [String: Any]) -> [String: Any] { scope.merging(extra) { _, new in new } }
            func submit(_ id: String, _ text: String) async throws -> String {
                let result = try await call("tasks.submit", params(["requestId": id, "text": text]))
                guard let task = result["task"] as? [String: Any], let id = task["id"] as? String else { throw Failure.rpc }
                return id
            }
            func events(_ id: String, _ cursor: Any = NSNull(), limit: Int = 50) async throws -> [String: Any] {
                try await call("tasks.events", params(["taskId": id, "cursor": cursor, "limit": limit]))
            }
            func waitFor(_ id: String, active: Bool = false) async throws -> (String?, [[String: Any]], Bool) {
                let deadline = ProcessInfo.processInfo.systemUptime + 12
                var cursor: Any = NSNull(), journal: [[String: Any]] = [], pendingTerminal = false
                while ProcessInfo.processInfo.systemUptime < deadline {
                    let page = try await events(id, cursor, limit: active ? 50 : 1)
                    guard let rows = page["events"] as? [[String: Any]], let next = page["cursor"] as? String,
                          let terminal = page["terminal"] as? Bool, let hasMore = page["hasMore"] as? Bool else { throw Failure.rpc }
                    journal += rows; cursor = next
                    if active {
                        try require(!terminal)
                        if journal.contains(where: { $0["type"] as? String == "tool_start" &&
                            ($0["payload"] as? [String: Any])?["toolName"] as? String == "bash" }) { return (nil, journal, false) }
                    } else if terminal && !hasMore {
                        return ((page["task"] as? [String: Any])?["status"] as? String, journal, pendingTerminal)
                    }
                    pendingTerminal = pendingTerminal || (terminal && hasMore)
                    if !hasMore { try await Task.sleep(for: .milliseconds(20)) }
                }
                throw Failure.deadline
            }
            func text(_ rows: [[String: Any]]) -> String {
                rows.filter { $0["type"] as? String == "text_delta" }.compactMap { ($0["payload"] as? [String: Any])?["delta"] as? String }.joined()
            }
            stage = "real PI write/read and public text"
            let tools = try await submit("appkit-tools", "MOOS_FIXTURE_WRITE APPKIT_OK")
            let written = try await waitFor(tools)
            let completed = written.1.filter { $0["type"] as? String == "tool_end" }.compactMap { $0["payload"] as? [String: Any] }
            try require(written.0 == "succeeded" && completed.compactMap { $0["toolName"] as? String } == ["write", "read"] &&
                        completed.allSatisfy { $0["isError"] as? Bool == false } && text(written.1).contains("完成 APPKIT_OK"))
            checks.append(stage)
            stage = "foreign task denied"
            let denied = try await transport.request("tasks.events", params(["projectId": otherId, "taskId": tools, "cursor": NSNull(), "limit": 1]))
            try require(denied["ok"] as? Bool == false && (denied["error"] as? [String: Any])?["code"] as? String == "not_found")
            checks.append(stage)
            stage = "Stop then terminal and full drain"
            let held = try await submit("appkit-stop", "MOOS_FIXTURE_HOLD")
            _ = try await waitFor(held, active: true)
            _ = try await call("tasks.cancel", params(["taskId": held]))
            // Wait for a terminal task with an intentionally unread backlog before draining it.
            let stopDeadline = ProcessInfo.processInfo.systemUptime + 12
            while true {
                let firstPage = try await events(held, limit: 1)
                if firstPage["terminal"] as? Bool == true {
                    try require(firstPage["hasMore"] as? Bool == true)
                    break
                }
                if ProcessInfo.processInfo.systemUptime >= stopDeadline { throw Failure.deadline }
                try await Task.sleep(for: .milliseconds(20))
            }
            let stopped = try await waitFor(held)
            try require(stopped.0 == "cancelled" && stopped.2)
            checks.append(stage)
            stage = "same-session Send after drain"
            let resend = try await submit("appkit-resend", "APPKIT_RESEND")
            let resumed = try await waitFor(resend)
            try require(resend != held && resumed.0 == "succeeded" && text(resumed.1).contains("本地夹具响应：APPKIT_RESEND"))
            checks.append(stage)
            stage = "active EOF and normal child exit"
            let eof = try await submit("appkit-eof", "MOOS_FIXTURE_HOLD")
            _ = try await waitFor(eof, active: true)
            let clean = await transport.close()
            try require(clean && transport.exitCode == 0 && !transport.forced && transport.diagnosticsBytes == 0)
            checks.append(stage)
            stage = "complete"
            passed = true
        } catch { if let pipe { _ = await pipe.close() } }
        let report: [String: Any] = ["passed": passed, "stage": stage, "checks": checks,
                                     "hostExit": pipe?.exitCode as Any? ?? NSNull(), "forced": pipe?.forced ?? false,
                                     "stderrBytes": pipe?.diagnosticsBytes ?? 0, "nshEmbedded": false]
        if let bytes = try? JSONSerialization.data(withJSONObject: report, options: .sortedKeys) {
            print(String(decoding: bytes, as: UTF8.self))
        }
        window?.close()
        Darwin.exit(passed ? 0 : 1)
    }
}

@main
struct DesktopAppKitPipeCheck {
    @MainActor static func main() {
        signal(SIGPIPE, SIG_IGN)
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = AppKitCheck()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
