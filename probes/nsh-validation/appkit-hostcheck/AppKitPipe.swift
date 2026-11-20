import Foundation
import Darwin

public typealias Reply = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int) -> Void

@MainActor private var pipe: DesktopPipe?

@MainActor @_cdecl("n01_pipe_start")
public func start() -> Bool {
    signal(SIGPIPE, SIG_IGN)
    pipe = try? DesktopPipe()
    return pipe != nil
}

// Rust transfers exactly one reply context. Copy borrowed bytes before queueing.
@_cdecl("n01_pipe_call")
public func call(_ method: UnsafePointer<CChar>, _ bytes: UnsafePointer<UInt8>, _ count: Int,
          _ context: UnsafeMutableRawPointer?, _ reply: Reply) {
    let method = String(cString: method), params = Data(bytes: bytes, count: count)
    DispatchQueue.main.async {
        guard let pipe, let parameters = try? JSONSerialization.jsonObject(with: params) else {
            reply(context, nil, 0); return
        }
        pipe.call(method, params: parameters) { result in
            guard case .success(let response) = result,
                  let output = try? JSONSerialization.data(withJSONObject: response) else {
                reply(context, nil, 0); return
            }
            output.withUnsafeBytes { reply(context, $0.bindMemory(to: UInt8.self).baseAddress, $0.count) }
        }
    }
}

// NSH has returned to its owner; pump the owning run loop until DesktopPipe reaps.
@MainActor @_cdecl("n01_pipe_finish")
public func finish() -> Bool {
    guard let transport = pipe else { return false }
    transport.shutdown()
    let deadline = ProcessInfo.processInfo.systemUptime + 24
    while transport.exitCode == nil && ProcessInfo.processInfo.systemUptime < deadline {
        _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.02))
    }
    let clean = transport.exitCode == 0 && !transport.forced && transport.diagnosticsBytes == 0
    print("N01_HOST_EXIT \(transport.exitCode ?? -1) forced=\(transport.forced) stderrBytes=\(transport.diagnosticsBytes)")
    pipe = nil
    return clean
}
