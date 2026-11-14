import Foundation

@main struct N01PairingNetworkCheck {
    @MainActor static func main() async throws {
        let dir = URL(fileURLWithPath: CommandLine.arguments[1])
        var checks = 0
        func check(_ value: Bool) throws { guard value else { throw N01BootstrapError.rejected }; checks += 1 }
        func candidate(_ name: String) throws -> N01BootstrapCandidate {
            try N01BootstrapCandidate(bytes: Data(contentsOf: dir.appendingPathComponent(name + ".bin")))
        }
        func rejects(_ body: () async throws -> Void) async throws {
            var denied = false; do { try await body() } catch { denied = true }; try check(denied)
        }
        let good = try candidate("good")
        try await rejects { _ = try await good.redeem() } // Local gate, no HTTP.
        let value = try await good.claim()
        try check(value.utf8.count == 64)
        try await rejects { _ = try await good.claim() }
        try await rejects { _ = try await good.redeem() } // Still no local comparison.
        try good.acknowledgeComparison(value)
        let pending = try await good.redeem(); try check(pending == nil) // HTTP409, bounded explicit retry only.
        try Data(value.utf8).write(to: dir.appendingPathComponent("comparison.txt"), options: .atomic)
        for _ in 0..<200 {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("approved").path) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let credential = try await good.redeem()
        try check(credential != nil && credential!.isLocallyUsable && credential!.projects == ["project-a"])
        try await rejects { _ = try await good.redeem() }
        credential!.cancel(); credential!.cancel(); try check(!credential!.isLocallyUsable)
        // Every malformed/ambiguous result closes the candidate; no blind retry after a consumed claim.
        for name in ["wrongpin", "transcript", "extra", "version", "duplicate", "mime", "redirect", "large", "badjson"] {
            let bad = try candidate(name)
            try await rejects { _ = try await bad.claim() }
            try await rejects { _ = try await bad.claim() }
        }
        let wrongComparison = try candidate("comparison")
        _ = try await wrongComparison.claim()
        var denied = false
        do { try wrongComparison.acknowledgeComparison(String(repeating: "0", count: 64)) } catch { denied = true }
        try check(denied); try await rejects { _ = try await wrongComparison.redeem() }
        let attempts = try candidate("attempts")
        let comparison = try await attempts.claim(); try attempts.acknowledgeComparison(comparison)
        for _ in 0..<4 { let pending = try await attempts.redeem(); try check(pending == nil) }
        try await rejects { _ = try await attempts.redeem() } // fifth attempt never reaches HTTP.
        let badRedeem = try candidate("badredeem")
        let hash = try await badRedeem.claim(); try badRedeem.acknowledgeComparison(hash)
        try await rejects { _ = try await badRedeem.redeem() }
        try await rejects { _ = try await badRedeem.redeem() }
        let cancelled = try candidate("cancel")
        let task = Task { try await cancelled.claim() }
        for _ in 0..<100 {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("active").path) { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        try await rejects { _ = try await cancelled.claim() } // concurrent admission denied, no duplicate HTTP.
        cancelled.cancel(); cancelled.cancel()
        try await rejects { _ = try await task.value }
        try await rejects { _ = try await cancelled.claim() }
        let taskCancelled = try candidate("taskcancel")
        let stopped = Task { withUnsafeCurrentTask { $0?.cancel() }; return try await taskCancelled.claim() }
        try await rejects { _ = try await stopped.value }
        try await rejects { _ = try await taskCancelled.claim() }
        print("{\"status\":\"passed\",\"checks\":\(checks),\"phoneVerified\":false,\"humanConfirmationVerified\":false,\"systemTrustChanged\":false,\"credentialsPersisted\":false,\"nshBridgeVerified\":false}")
    }
}
