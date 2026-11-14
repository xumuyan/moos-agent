import Foundation
import Security
import CryptoKit

@main struct N01Check {
    static func main() async throws {
        let args = CommandLine.arguments
        let root = URL(fileURLWithPath: args[1])
        func data(_ name: String) throws -> Data { try Data(contentsOf: root.appendingPathComponent(name)) }
        let ca = try data("ca.der"), leaf = try data("server.der"), other = try data("other.der")
        let hash = SHA256.hash(data: leaf).map { String(format: "%02x", $0) }.joined()
        let good = try N01TrustPolicy(anchorDER: ca, leafSHA256: hash, hostname: "localhost")
        func trust(_ der: Data? = nil) throws -> SecTrust {
            var result: SecTrust?
            guard let certificate = SecCertificateCreateWithData(nil, (der ?? leaf) as CFData),
                  SecTrustCreateWithCertificates(certificate, SecPolicyCreateSSL(true, "localhost" as CFString), &result) == errSecSuccess,
                  let result else { throw N01TLSError.invalidConfiguration }
            return result
        }
        func check(_ value: Bool, _ name: String) throws {
            guard value else { throw NSError(domain: "N01 check failed: \(name)", code: 1) }
        }
        try check(good.accepts(trust()), "valid chain/pin/hostname")
        let wrongPin = try N01TrustPolicy(anchorDER: ca, leafSHA256: String(repeating: "0", count: 64), hostname: "localhost")
        let wrongCA = try N01TrustPolicy(anchorDER: other, leafSHA256: hash, hostname: "localhost")
        let wrongHost = try N01TrustPolicy(anchorDER: ca, leafSHA256: hash, hostname: "wrong.invalid")
        try check(!wrongPin.accepts(trust()), "wrong pin")
        try check(!wrongCA.accepts(trust()), "wrong anchor")
        try check(!wrongHost.accepts(trust()), "wrong hostname")
        try check(!good.accepts(trust(), date: Date(timeIntervalSinceNow: 86400 * 10)), "expired leaf")
        try check(!good.accepts(trust(), date: Date(timeIntervalSinceNow: -86400 * 10)), "not yet valid")
        let rotated = try data("rotated.der")
        let rotatedHash = SHA256.hash(data: rotated).map { String(format: "%02x", $0) }.joined()
        let newPolicy = try N01TrustPolicy(anchorDER: ca, leafSHA256: rotatedHash, hostname: "localhost")
        try check(!good.accepts(trust(rotated)), "old pin rejects rotated leaf")
        try check(newPolicy.accepts(trust(rotated)), "explicit new pin accepts rotated leaf")
        try check(!newPolicy.accepts(trust()), "new pin rejects retired leaf")
        let url = URL(string: args[2])!
        let bytes = try await N01PinnedProbe(policy: good).get(url)
        try check(String(data: bytes, encoding: .utf8) == "N01 pinned TLS OK", "live pinned HTTPS")
        var rejected = false
        do { _ = try await N01PinnedProbe(policy: wrongPin).get(url) } catch { rejected = true }
        try check(rejected, "live wrong pin rejected")
        rejected = false
        do { _ = try await N01PinnedProbe(policy: good).get(URL(string: args[3])!) } catch { rejected = true }
        try check(rejected, "redirect rejected")
        rejected = false
        do { _ = try await N01PinnedProbe(policy: good).get(URL(string: args[4])!) } catch { rejected = true }
        try check(rejected, "oversized response rejected")
        print("{\"status\":\"passed\",\"checks\":13,\"phoneVerified\":false,\"systemTrustChanged\":false}")
    }
}
