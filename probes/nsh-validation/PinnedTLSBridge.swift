import Foundation
import NativeShell

// Not wired into the installed phone app. The trusted Swift host supplies the destination.
// Cancelling a JS host.call waiter alone does not cancel native work; use the explicit cancel handler.
@MainActor
func installN01TrustCheck(on app: NshAppView, policy: N01TrustPolicy, endpoint: URL) {
    var active: N01PinnedProbe?
    app.handle("n01.trustCheck") { data in
        guard data == nil || data is NSNull, active == nil else { throw N01TLSError.rejected }
        let probe = N01PinnedProbe(policy: policy)
        active = probe
        defer { active = nil }
        do {
            let bytes = try await probe.get(endpoint)
            guard String(data: bytes, encoding: .utf8) == "N01 pinned TLS OK" else {
                throw N01TLSError.invalidResponse
            }
            return ["version": 1, "status": "passed"]
        } catch { throw N01TLSError.rejected }
    }
    app.handle("n01.cancelTrustCheck") { data in
        guard data == nil || data is NSNull else { throw N01TLSError.rejected }
        let hadActive = active != nil
        active?.cancel()
        return ["version": 1, "cancelled": hadActive]
    }
}
