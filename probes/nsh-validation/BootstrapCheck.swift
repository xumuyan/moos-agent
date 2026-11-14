import Foundation
import CryptoKit

@main struct N01BootstrapCheck {
    @MainActor static func main() async throws {
        let dir = URL(fileURLWithPath: CommandLine.arguments[1])
        let good = try Data(contentsOf: dir.appendingPathComponent("bootstrap.bin"))
        var checks = 0
        func check(_ condition: Bool) throws {
            guard condition else { throw N01BootstrapError.rejected }; checks += 1
        }
        func rejects(_ action: () throws -> Void) throws {
            var rejected = false
            do { try action() } catch { rejected = true }
            try check(rejected)
        }
        let fields = String(data: good, encoding: .ascii)!.components(separatedBy: "\n")
        var cases: [Data] = [Data(), Data(repeating: 65, count: 8193), good + Data([10]), good + Data([0]), Data([255])]
        func altered(_ index: Int, _ value: String) -> Data {
            var copy = fields; copy[index] = value; return Data(copy.joined(separator: "\n").utf8)
        }
        for (index, value) in [(0, "N01BOOT2"), (1, "http://localhost:1234"), (1, "https://example.invalid:1234"),
            (1, "https://192.168.1.2:1234"), (1, "https://localhost:443"), (1, "https://localhost:65536"),
            (1, "https://localhost:01"), (1, "https://localhost:1234/"), (1, "https://u:p@localhost:1234"),
            (1, "https://localhost:1234?x=1"), (1, "https://localhost:1234#x"),
            (2, "AAAA"), (2, fields[2] + "="), (3, String(repeating: "0", count: 64)),
            (4, String(repeating: "A", count: 64)), (5, "bad"), (6, "bad"),
            (7, "0"), (7, "120001"), (7, "0120"), (7, "1.0"), (7, "true")] {
            cases.append(altered(index, value))
        }
        for bytes in cases { try rejects { _ = try N01BootstrapCandidate(bytes: bytes) } }
        var time: TimeInterval = 10
        let expired = try N01BootstrapCandidate(bytes: good, clock: { time })
        time = 10 + Double(fields[7])! / 1000; try rejects { _ = try expired.claimBody() }
        let rollback = try N01BootstrapCandidate(bytes: good, clock: { time })
        time -= 1; try rejects { _ = try rollback.claimBody() }
        let cancelled = try N01BootstrapCandidate(bytes: good)
        cancelled.cancel(); cancelled.cancel(); try rejects { _ = try cancelled.claimBody() }
        try rejects { _ = try N01BootstrapCandidate(bytes: good, clock: { .nan }) }
        let premature = try N01BootstrapCandidate(bytes: good)
        try rejects { _ = try premature.comparison(claimID: String(repeating: "a", count: 64), serverTranscript: String(repeating: "b", count: 64)) }
        try rejects { _ = try premature.claimBody() }
        let candidate = try N01BootstrapCandidate(bytes: good)
        try await candidate.probe(); checks += 1
        var denied = false
        do { try await candidate.probe() } catch { denied = true }; try check(denied)
        // A cancelled independent candidate must not cancel or replace this one's state.
        let body = try candidate.claimBody()
        try rejects { _ = try candidate.claimBody() }
        try body.write(to: dir.appendingPathComponent("claim.json"), options: .atomic)
        // The Node harness computes the same fixed-array transcript with this random native nonce.
        let responseFile = dir.appendingPathComponent("response.json")
        for _ in 0..<150 {
            if FileManager.default.fileExists(atPath: responseFile.path) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let response = try JSONSerialization.jsonObject(with: Data(contentsOf: responseFile)) as! [String: String]
        let comparison = try candidate.comparison(claimID: response["claimId"]!, serverTranscript: response["transcript"]!)
        try check(comparison == response["transcript"]!)
        try rejects { _ = try candidate.comparison(claimID: response["claimId"]!, serverTranscript: String(repeating: "0", count: 64)) }
        try rejects { _ = try candidate.comparison(claimID: response["claimId"]!, serverTranscript: response["transcript"]!) }
        let wrong = try N01BootstrapCandidate(bytes: altered(4, String(repeating: "0", count: 64)))
        denied = false; do { try await wrong.probe() } catch { denied = true }; try check(denied)
        try rejects { _ = try wrong.claimBody() }
        let independent = try N01BootstrapCandidate(bytes: good)
        try await independent.probe(); checks += 1
        independent.cancel(); candidate.cancel()
        print("{\"status\":\"passed\",\"checks\":\(checks),\"phoneVerified\":false,\"humanConfirmationVerified\":false,\"trustPromoted\":false}")
    }
}
