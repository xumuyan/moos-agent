import Foundation
import CoreFoundation
import Darwin

// Trusted native-only transport. No shell, renderer launch options, inherited environment or TCP.
// All callbacks/FD operations serialize on the main actor; every FD is nonblocking in the parent.
@MainActor
final class DesktopPipe {
    static let methods: [String] = {
        let base = ["projects.list", "sessions.list", "sessions.create", "tasks.submit", "tasks.cancel", "tasks.events"]
#if PI_PERSISTENT
        return base + ["sessions.history", "sessions.manage", "models.manage", "images.stage"]
#else
        return base
#endif
    }()
    enum Failure: Error { case rejected, closed, transport, timeout, limit }
    private struct Pending {
        let reply: (Result<[String: Any], Error>) -> Void
        let timer: DispatchWorkItem
    }
    private var pending: [String: Pending] = [:]
    private var sequence = 0
    private var incoming = Data(), outgoing = Data()
    private var input: Int32 = -1, output: Int32 = -1, diagnostic: Int32 = -1
    private var reader: DispatchSourceRead?, errors: DispatchSourceRead?, writer: DispatchSourceWrite?
    private var processExit: DispatchSourceProcess?
    private var terminateDeadline: DispatchWorkItem?
    private var killDeadline: DispatchWorkItem?
    private(set) var pid: pid_t = 0
    private(set) var accepting = true
    private(set) var exitCode: Int32?
    private(set) var forced = false
    private var waiters: [(Bool) -> Void] = []
    private let callSeconds: Double
    private let shutdownGrace: Double
    private let killGrace: Double
    private(set) var maxPending = 0
    private(set) var diagnosticsBytes = 0

    convenience init() throws {
        try self.init(node: DesktopFixedLaunch.node, script: DesktopFixedLaunch.script, callSeconds: 10)
    }
    // Private constructor is reachable only by the compiled trusted launch configuration or test code.
    private init(node: String, script: String, callSeconds: Double, shutdownGrace: Double = 20, killGrace: Double = 2) throws {
        self.callSeconds = callSeconds
        self.shutdownGrace = shutdownGrace
        self.killGrace = killGrace
        var toChild: [Int32] = [-1, -1], fromChild: [Int32] = [-1, -1], stderrPipe: [Int32] = [-1, -1]
        guard pipe(&toChild) == 0 else { throw Failure.transport }
        guard pipe(&fromChild) == 0 else { toChild.forEach { Darwin.close($0) }; throw Failure.transport }
        guard pipe(&stderrPipe) == 0 else { (toChild + fromChild).forEach { Darwin.close($0) }; throw Failure.transport }
        let fds = toChild + fromChild + stderrPipe
        for fd in fds { _ = fcntl(fd, F_SETFD, FD_CLOEXEC) }
        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_adddup2(&actions, toChild[0], STDIN_FILENO)
        posix_spawn_file_actions_adddup2(&actions, fromChild[1], STDOUT_FILENO)
        posix_spawn_file_actions_adddup2(&actions, stderrPipe[1], STDERR_FILENO)
        for fd in fds { posix_spawn_file_actions_addclose(&actions, fd) }
        let args = [node, script].map { strdup($0) } + [nil]
        // No HOME, NODE_OPTIONS, NODE_PATH, credentials or inherited app runtime settings.
        let environment: [String] = ["PATH=/usr/bin:/bin", "TMPDIR=/private/tmp/", "LANG=en_US.UTF-8"]
        let env = environment.map { strdup($0) } + [nil]
        defer { args.forEach { free($0) }; env.forEach { free($0) } }
        var child: pid_t = 0
        var attributes: posix_spawnattr_t?
        posix_spawnattr_init(&attributes)
        defer { posix_spawnattr_destroy(&attributes) }
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT))
        let result = args.withUnsafeBufferPointer { argv in env.withUnsafeBufferPointer { envp in
            posix_spawn(&child, node, &actions, &attributes, UnsafeMutablePointer(mutating: argv.baseAddress!), UnsafeMutablePointer(mutating: envp.baseAddress!))
        } }
        guard result == 0 else { fds.forEach { Darwin.close($0) }; throw Failure.transport }
        pid = child
        Darwin.close(toChild[0]); Darwin.close(fromChild[1]); Darwin.close(stderrPipe[1])
        input = toChild[1]; output = fromChild[0]; diagnostic = stderrPipe[0]
        for fd in [input, output, diagnostic] { _ = fcntl(fd, F_SETFL, O_NONBLOCK) }
        // SIGPIPE is ignored by the native executable before constructing the transport.
        let r = DispatchSource.makeReadSource(fileDescriptor: output, queue: .main)
        r.setEventHandler { [weak self] in self?.readOutput() }; r.resume(); reader = r
        let e = DispatchSource.makeReadSource(fileDescriptor: diagnostic, queue: .main)
        e.setEventHandler { [weak self] in self?.readDiagnostics() }; e.resume(); errors = e
        let exit = DispatchSource.makeProcessSource(identifier: child, eventMask: .exit, queue: .main)
        exit.setEventHandler { [weak self] in self?.reap() }
        processExit = exit
        exit.resume()
        // The child may already have exited before the source was registered.
        DispatchQueue.main.async { [weak self] in self?.reap() }
    }
#if BRIDGE_CHECK
    static func testLaunch(script: String, callSeconds: Double = 0.2, shutdownGrace: Double = 20, killGrace: Double = 2) throws -> DesktopPipe {
        try DesktopPipe(node: DesktopFixedLaunch.node, script: script, callSeconds: callSeconds, shutdownGrace: shutdownGrace, killGrace: killGrace)
    }
    func breakOutputForTest() { if output >= 0 { Darwin.close(output); output = -1 }; shutdown() }
    func externallyReapForTest() {
        shutdown()
        var status: Int32 = 0
        while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
        reap()
    }
#endif
    func call(_ method: String, params: Any?, reply: @escaping (Result<[String: Any], Error>) -> Void) {
        guard accepting else { reply(.failure(Failure.closed)); return }
        guard Self.methods.contains(method), let parameters = params as? [String: Any],
              JSONSerialization.isValidJSONObject(parameters) else { reply(.failure(Failure.rejected)); return }
        guard pending.count < 32 else { reply(.failure(Failure.limit)); return }
        sequence += 1; let id = "native-\(sequence)"
        let request: [String: Any] = ["version": 1, "id": id, "method": method, "params": parameters]
        guard let bytes = try? JSONSerialization.data(withJSONObject: request), bytes.count <= 16384,
              outgoing.count + bytes.count + 1 <= 32 * 16385 else { reply(.failure(Failure.limit)); return }
        let timer = DispatchWorkItem { [weak self] in
            guard let self, self.pending[id] != nil else { return }
            self.shutdown(reason: Failure.timeout)
        }
        pending[id] = Pending(reply: reply, timer: timer); maxPending = max(maxPending, pending.count)
        outgoing.append(bytes); outgoing.append(10)
        DispatchQueue.main.asyncAfter(deadline: .now() + callSeconds, execute: timer)
        flush()
    }
    func request(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            call(method, params: params) { continuation.resume(with: $0) }
        }
    }
    private func flush() {
        guard input >= 0 else { return }
        while !outgoing.isEmpty {
            let n = outgoing.withUnsafeBytes { Darwin.write(input, $0.baseAddress!, $0.count) }
            if n > 0 { outgoing.removeFirst(n) }
            else if errno == EINTR { continue }
            else if errno == EAGAIN {
                if writer == nil {
                    let w = DispatchSource.makeWriteSource(fileDescriptor: input, queue: .main)
                    w.setEventHandler { [weak self] in self?.flush() }; writer = w; w.resume()
                }
                return
            } else { shutdown(reason: Failure.transport); return }
        }
        writer?.cancel(); writer = nil
    }
    private func readOutput() {
        guard output >= 0 else { return }
        var buffer = [UInt8](repeating: 0, count: 8192)
        var budget = 65536 // yield to native deadlines even if a child floods the pipe
        while budget > 0 {
            let n = Darwin.read(output, &buffer, buffer.count)
            budget -= max(0, n)
            if n > 0 {
                for byte in buffer.prefix(n) {
                    if byte == 10 {
                        guard !incoming.isEmpty, incoming.count + 1 <= 524288,
                              String(data: incoming, encoding: .utf8) != nil,
                              let object = try? JSONSerialization.jsonObject(with: incoming) as? [String: Any],
                              Set(object.keys) == Set(["version", "id", "ok", object["ok"] as? Bool == true ? "result" : "error"]),
                              let version = object["version"] as? NSNumber,
                              CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
                              let id = object["id"] as? String, let entry = pending[id],
                              let ok = object["ok"] as? NSNumber, CFGetTypeID(ok) == CFBooleanGetTypeID(),
                              (object["result"] as? [String: Any] != nil || Self.validError(object["error"])) else { shutdown(reason: Failure.transport); return }
                        pending.removeValue(forKey: id)
                        incoming.removeAll(keepingCapacity: true); entry.timer.cancel(); entry.reply(.success(object))
                    } else {
                        guard incoming.count < 524287 else { shutdown(reason: Failure.limit); return }
                        incoming.append(byte)
                    }
                }
            } else if n == 0 {
                reader?.cancel(); reader = nil; Darwin.close(output); output = -1
                shutdown(reason: Failure.transport); return
            } else if errno == EINTR { continue }
            else if errno == EAGAIN { return }
            else { shutdown(reason: Failure.transport); return }
        }
    }
    private static func validError(_ value: Any?) -> Bool {
        guard let error = value as? [String: Any], Set(error.keys) == ["code"], let code = error["code"] as? String else { return false }
        return ["invalid_request", "unsupported_method", "not_found", "conflict", "limit", "invalid_cursor", "cursor_expired", "closed", "internal"].contains(code)
    }
    private func readDiagnostics() {
        guard diagnostic >= 0 else { return }
        var bytes = [UInt8](repeating: 0, count: 4096)
        let n = Darwin.read(diagnostic, &bytes, bytes.count)
        if n > 0 { diagnosticsBytes = min(1048576, diagnosticsBytes + n) } // discard, never return raw stderr
        else if n == 0 { errors?.cancel(); errors = nil; Darwin.close(diagnostic); diagnostic = -1 }
    }
    func shutdown(reason: Error = Failure.closed) {
        guard accepting else { return }; accepting = false
        if exitCode == nil {
            let terminate = DispatchWorkItem { [weak self] in self?.reap(thenSignal: SIGTERM) }
            let kill = DispatchWorkItem { [weak self] in self?.reap(thenSignal: SIGKILL) }
            terminateDeadline = terminate
            killDeadline = kill
            let now = DispatchTime.now()
            DispatchQueue.main.asyncAfter(deadline: now + shutdownGrace, execute: terminate)
            DispatchQueue.main.asyncAfter(deadline: now + shutdownGrace + killGrace, execute: kill)
        }
        let callbacks = Array(pending.values); pending.removeAll()
        for entry in callbacks { entry.timer.cancel(); entry.reply(.failure(reason)) }
        outgoing.removeAll(); writer?.cancel(); writer = nil
        if input >= 0 { Darwin.close(input); input = -1 } // private EOF cancels SDK and registered tools
    }
    func close() async -> Bool {
        shutdown()
        if exitCode != nil { return exitCode == 0 && !forced }
        return await withCheckedContinuation { continuation in waiters.append { continuation.resume(returning: $0) } }
    }
    private func reap(thenSignal signal: Int32? = nil) {
        guard exitCode == nil else { return }
        var status: Int32 = 0
        var result: pid_t
        repeat { result = waitpid(pid, &status, WNOHANG) } while result == -1 && errno == EINTR
        if result == pid || (result == -1 && errno == ECHILD) {
            // Another native owner may have reaped this child. Never signal a now-reusable PID.
            // Its status is unknown, so it cannot be accepted as a normal successful exit.
            exitCode = result == pid ? ((status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)) : 255
            shutdown(reason: Failure.transport)
            processExit?.cancel(); processExit = nil
            terminateDeadline?.cancel(); terminateDeadline = nil
            killDeadline?.cancel(); killDeadline = nil
            reader?.cancel(); errors?.cancel(); writer?.cancel()
            for fd in [input, output, diagnostic] where fd >= 0 { Darwin.close(fd) }
            input = -1; output = -1; diagnostic = -1
            let callbacks = waiters; waiters.removeAll()
            for callback in callbacks { callback(exitCode == 0 && !forced) }
        } else if result == 0, let signal {
            // Only the exact unreaped child PID; no process-name matching or broad group kill.
            forced = true
            _ = kill(pid, signal)
        }
    }
    deinit {
        // Owners await close(). Unexpected owner loss closes all pipes and reaps only this child.
        // This fallback is not evidence of graceful registered-tool cleanup.
        processExit?.cancel(); terminateDeadline?.cancel(); killDeadline?.cancel()
        reader?.cancel(); errors?.cancel(); writer?.cancel()
        for entry in pending.values { entry.timer.cancel(); entry.reply(.failure(Failure.closed)) }
        for fd in [input, output, diagnostic] where fd >= 0 { Darwin.close(fd) }
        if exitCode == nil {
            let child = pid
            DispatchQueue.global().async {
                let started = Date(); var status: Int32 = 0; var terminated = false
                while waitpid(child, &status, WNOHANG) == 0 {
                    let elapsed = Date().timeIntervalSince(started)
                    if elapsed > 20 && !terminated { _ = kill(child, SIGTERM); terminated = true }
                    if elapsed > 22 { _ = kill(child, SIGKILL) }
                    usleep(20000)
                }
            }
        }
    }
}
