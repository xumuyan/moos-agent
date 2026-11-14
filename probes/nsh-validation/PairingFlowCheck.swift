// macOS test peer only. Programmatic comparison is NOT human/phone evidence.
import Foundation

@main struct N01PairingFlowCheck {
    @MainActor static func main() async {
        do {
            let dir = URL(fileURLWithPath: CommandLine.arguments[1])
            let candidate = try N01BootstrapCandidate(bytes: Data(contentsOf: dir.appendingPathComponent("bootstrap.bin")))
            let digest = try await candidate.claim()
            try Data(digest.utf8).write(to: dir.appendingPathComponent("comparison"), options: .atomic)
            var decision: String?
            for _ in 0..<250 {
                decision = try? String(contentsOf: dir.appendingPathComponent("decision"), encoding: .utf8)
                if decision != nil { break }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            guard decision == "approved" || decision == "denied" else { throw N01BootstrapError.rejected }
            try candidate.acknowledgeComparison(digest) // Automated fixture only, never called by NSH.
            if decision == "approved" {
                guard let credential = try await candidate.redeem(), credential.isLocallyUsable,
                      credential.projects == ["project-a"] else { throw N01BootstrapError.rejected }
                credential.cancel()
                guard !credential.isLocallyUsable else { throw N01BootstrapError.rejected }
            } else {
                var rejected = false
                do { _ = try await candidate.redeem() } catch { rejected = true }
                guard rejected else { throw N01BootstrapError.rejected }
            }
            candidate.cancel()
            print("{\"status\":\"passed\",\"decision\":\"\(decision!)\",\"phoneVerified\":false,\"humanConfirmationVerified\":false}")
        } catch { fputs("Native pairing flow check failed\n", stderr); exit(1) }
    }
}
