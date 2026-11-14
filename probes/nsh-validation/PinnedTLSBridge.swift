import Foundation
import NativeShell

// Build-only bridge candidate. Not wired into the installed phone app.
// No endpoint, anchor or pin is accepted from untrusted JS arguments.
@MainActor
func installN01TrustCheck(on app: NshAppView, policy: N01TrustPolicy, endpoint: URL) {
    var busy = false
    app.handle("n01.trustCheck") { data in
        guard data == nil || data is NSNull, !busy else {
            throw N01TLSError.rejected
        }
        busy = true
        defer { busy = false }
        // One bounded, credential-free GET only. This does not expose arbitrary native fetch.
        do {
            let bytes = try await N01PinnedProbe(policy: policy).get(endpoint)
            guard String(data: bytes, encoding: .utf8) == "N01 pinned TLS OK" else {
                throw N01TLSError.invalidResponse
            }
            return ["version": 1, "status": "passed"]
        } catch {
            // Do not leak URLs, native diagnostic messages or response contents over the bridge.
            throw N01TLSError.rejected
        }
    }
}
