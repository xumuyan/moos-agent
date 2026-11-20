import Foundation
import Darwin

@main
struct DesktopPipeCheck {
    @MainActor static func main() async {
        signal(SIGPIPE, SIG_IGN)
        do {
            let directory = CommandLine.arguments[1]
            var checks = 0
            func check(_ value: Bool) throws { if !value { throw DesktopPipe.Failure.rejected }; checks += 1 }
            let real = try DesktopPipe()
            async let one = real.request("projects.list")
            async let two = real.request("projects.list")
            let responses = try await [one, two]
            try check(responses[0]["id"] as? String != responses[1]["id"] as? String)
            try check(real.maxPending == 2)
            try check(await real.close())
            try check(real.exitCode == 0 && !real.forced)
            let lostStatus = try DesktopPipe.testLaunch(script: directory + "/limit.mjs", callSeconds: 3)
            _ = try await lostStatus.request("projects.list")
            lostStatus.externallyReapForTest()
            try check(!(await lostStatus.close()))
            try check(lostStatus.exitCode == 255 && !lostStatus.forced && !lostStatus.accepting)
            // Observe immediate exit without a request or an explicit close() call.
            for _ in 0..<8 {
                let fast = try DesktopPipe.testLaunch(script: directory + "/instant-exit.mjs")
                let deadline = DispatchTime.now() + 2
                while fast.exitCode == nil && DispatchTime.now() < deadline {
                    try await Task.sleep(nanoseconds: 10_000_000)
                }
                try check(fast.exitCode == 19 && !fast.accepting && !fast.forced)
                try check(kill(fast.pid, 0) == -1 && errno == ESRCH)
            }
            let stuck = try DesktopPipe.testLaunch(script: directory + "/ignore-term.mjs",
                                                   shutdownGrace: 0.15, killGrace: 0.15)
            _ = try await stuck.request("projects.list")
            async let closeOne = stuck.close()
            async let closeTwo = stuck.close()
            let closed = await [closeOne, closeTwo]
            try check(closed == [false, false] && stuck.exitCode == 137 && stuck.forced)
            try check(kill(stuck.pid, 0) == -1 && errno == ESRCH)
            for name in ["reverse", "timeout", "oversize", "badutf8", "unknown", "duplicate", "exit", "partial", "badversion", "badok", "baderror", "broken", "limit", "deinit", "blocked"] {
                let pipe = try DesktopPipe.testLaunch(script: directory + "/" + name + ".mjs", callSeconds: name == "timeout" ? 0.3 : name == "blocked" ? 0.5 : 3)
                if name == "reverse" {
                    async let a = pipe.request("projects.list")
                    async let b = pipe.request("sessions.list", ["projectId": "b"])
                    let pair = try await [a, b]
                    try check((pair[0]["result"] as? [String: Any])?["echo"] as? String == "projects.list")
                    try check((pair[1]["result"] as? [String: Any])?["echo"] as? String == "sessions.list")
                } else if name == "limit" {
                    do { _ = try await pipe.request("projects.list", ["x": String(repeating: "中", count: 6000)]); throw DesktopPipe.Failure.rejected }
                    catch DesktopPipe.Failure.limit { checks += 1 }
                    do { _ = try await pipe.request("shell.run"); throw DesktopPipe.Failure.rejected }
                    catch DesktopPipe.Failure.rejected { checks += 1 }
                    do { _ = try await pipe.request("projects.list", ["x": true]); } catch { throw error }
                } else if name == "deinit" {
                    var dropped: DesktopPipe? = try DesktopPipe.testLaunch(script: directory + "/limit.mjs", callSeconds: 1)
                    let pid = dropped!.pid
                    _ = try await dropped!.request("projects.list")
                    dropped = nil
                    let deadline = Date().addingTimeInterval(2)
                    var gone = false
                    while Date() < deadline {
                        if kill(pid, 0) == -1 && errno == ESRCH { gone = true; break }
                        try await Task.sleep(nanoseconds: 20_000_000)
                    }
                    try check(gone)
                } else if name == "broken" {
                    _ = try await pipe.request("projects.list")
                    pipe.breakOutputForTest()
                    try check(!pipe.accepting)
                } else if name == "blocked" {
                    var rejected = 0
                    for _ in 0..<33 {
                        pipe.call("projects.list", params: ["x": String(repeating: "a", count: 15000)]) { if case .failure = $0 { rejected += 1 } }
                    }
                    try check(pipe.maxPending == 32 && rejected >= 1)
                    try await Task.sleep(nanoseconds: 700_000_000)
                    try check(rejected == 33 && !pipe.accepting)
                } else if name == "duplicate" {
                    _ = try await pipe.request("projects.list")
                    try await Task.sleep(nanoseconds: 100_000_000)
                    try check(!pipe.accepting)
                } else {
                    var failed = false
                    do { _ = try await pipe.request("projects.list") }
                    catch DesktopPipe.Failure.timeout { failed = true; try check(name == "timeout") }
                    catch { failed = true; try check(name != "timeout") }
                    try check(failed && !pipe.accepting)
                }
                _ = await pipe.close()
                try check(pipe.exitCode != nil && !pipe.forced)
                var closed = false
                do { _ = try await pipe.request("projects.list") } catch { closed = true }
                try check(closed)
            }
            print("{\"passed\":true,\"nativeChecks\":\(checks),\"platform\":\"macOS Foundation private pipes\"}")
            exit(0)
        } catch { fputs("native check failed: \(error)\n", stderr); exit(2) }
    }
}
