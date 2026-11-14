// N01 untrusted bootstrap candidate. No promotion, credentials, storage or arbitrary fetch API.
import Foundation
import Security
import CryptoKit

enum N01BootstrapError: Error { case rejected }
private func n01Hex(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}
private func n01Hash(_ value: Data) -> String {
    SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined()
}

@MainActor
final class N01BootstrapCandidate {
    private let endpoint: URL
    private let origin: String
    private let caHash: String
    private let leafHash: String
    private let policy: N01TrustPolicy
    private let clock: () -> TimeInterval
    private let deadline: TimeInterval
    private var previous: TimeInterval
    private var invitationID: String
    private var secret: String
    private var nonce: String?
    private var claimed = false
    private var probed = false
    private var closed = false
    private var active: N01PinnedProbe?

    // Must only be created in a user-initiated pairing flow. Parsing never implies trust.
    init(bytes: Data, clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) throws {
        guard bytes.count <= 8192, !bytes.isEmpty,
              bytes.allSatisfy({ $0 == 10 || (33...126).contains($0) }),
              let raw = String(data: bytes, encoding: .ascii) else { throw N01BootstrapError.rejected }
        let fields = raw.components(separatedBy: "\n")
        guard fields.count == 8, fields[0] == "N01BOOT1",
              fields[1].range(of: #"^https://(localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$"#, options: .regularExpression) != nil,
              let url = URL(string: fields[1]), let port = url.port, (1...65535).contains(port), port != 443,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty,
              let der = Data(base64Encoded: fields[2]), der.count <= 4096,
              der.base64EncodedString() == fields[2],
              let cert = SecCertificateCreateWithData(nil, der as CFData),
              (SecCertificateCopyData(cert) as Data) == der,
              fields[3...6].allSatisfy({ n01Hex($0) }), n01Hash(der) == fields[3],
              let milliseconds = Int(fields[7]), String(milliseconds) == fields[7], (1...120000).contains(milliseconds) else {
            throw N01BootstrapError.rejected
        }
        let time = clock()
        guard time.isFinite, time >= 0 else { throw N01BootstrapError.rejected }
        self.clock = clock; previous = time; deadline = time + Double(milliseconds) / 1000
        endpoint = url; origin = fields[1]; caHash = fields[3]; leafHash = fields[4]
        invitationID = fields[5]; secret = fields[6]
        policy = try N01TrustPolicy(anchorDER: der, leafSHA256: fields[4], hostname: url.host!)
    }
    private func requireLive() throws {
        let time = clock()
        guard !closed, time.isFinite, time >= previous, time < deadline else {
            cancel(); throw N01BootstrapError.rejected
        }
        previous = time
    }
    func cancel() {
        closed = true; active?.cancel(); active = nil
        secret = ""; invitationID = ""; nonce = nil
    }
    // Only fixed /trust-check; still unconfirmed and cannot create a task client after success.
    func probe() async throws {
        try requireLive()
        guard !probed else { throw N01BootstrapError.rejected }
        probed = true
        let probe = N01PinnedProbe(policy: policy); active = probe
        defer { active = nil }
        do {
            let data = try await probe.get(endpoint.appendingPathComponent("trust-check"))
            try requireLive()
            guard data == Data("N01 pinned TLS OK".utf8) else { throw N01BootstrapError.rejected }
        } catch { cancel(); throw N01BootstrapError.rejected }
    }
    // Fixed claim body contains an invitation secret, never a device token. No network send here.
    func claimBody() throws -> Data {
        try requireLive()
        guard !claimed else { throw N01BootstrapError.rejected }
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { cancel(); throw N01BootstrapError.rejected }
        let value = random.map { String(format: "%02x", $0) }.joined()
        let body = try JSONSerialization.data(withJSONObject: ["invitationId": invitationID, "secret": secret, "clientNonce": value])
        nonce = value; claimed = true; secret = ""
        return body
    }
    // Returns a comparison value only, never promotes a candidate or trusts a server assertion.
    func comparison(claimID: String, serverTranscript: String) throws -> String {
        try requireLive()
        guard claimed, let nonce, n01Hex(claimID), n01Hex(serverTranscript) else { cancel(); throw N01BootstrapError.rejected }
        let array: [Any] = [1, origin, caHash, leafHash, invitationID, claimID, nonce]
        let bytes = try JSONSerialization.data(withJSONObject: array, options: [.withoutEscapingSlashes])
        let expected = n01Hash(bytes)
        guard expected == serverTranscript else { cancel(); throw N01BootstrapError.rejected }
        return expected
    }
}
