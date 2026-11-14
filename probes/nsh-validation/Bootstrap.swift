// N01 untrusted candidate; native-only pairing, no promotion/storage/arbitrary fetch or JS handler.
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
    private var pairingBusy = false
    private var pendingClaim: (id: String, receipt: String, transcript: String)?
    private var locallyCompared = false
    private var redeemAttempts = 0

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
        secret = ""; invitationID = ""; nonce = nil; pendingClaim = nil; locallyCompared = false
    }
    // Only fixed /trust-check; still unconfirmed and cannot create a task client after success.
    func probe() async throws {
        try requireLive()
        guard !probed, !pairingBusy else { throw N01BootstrapError.rejected }
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
        guard !claimed, active == nil else { throw N01BootstrapError.rejected }
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

// Opaque native memory only; no serialization, token accessor, logging, JS bridge or task API.
@MainActor final class N01PairingCredential {
    let deviceID: String
    let projects: [String]
    private var token: String
    private let deadline: TimeInterval
    fileprivate init(deviceID: String, projects: [String], token: String, milliseconds: Int) {
        self.deviceID = deviceID; self.projects = projects; self.token = token
        deadline = ProcessInfo.processInfo.systemUptime + Double(milliseconds) / 1000
    }
    var isLocallyUsable: Bool { !token.isEmpty && ProcessInfo.processInfo.systemUptime < deadline }
    func cancel() { token = "" }
}

extension N01BootstrapCandidate {
    // Returns only the locally computed comparison value. No secret/receipt leaves this object.
    func claim() async throws -> String {
        try requireLive()
        guard !pairingBusy, active == nil, !claimed else { throw N01BootstrapError.rejected }
        let body = try claimBody()
        pairingBusy = true
        let request = N01PinnedProbe(policy: policy, pairing: true); active = request
        defer { active = nil; pairingBusy = false }
        do {
            let bytes = try await request.postPairing(endpoint.appendingPathComponent("v1/pairing/claim"), body: body)
            try requireLive()
            let value = try Self.parse(bytes, keys: ["version", "claimId", "receipt", "transcript", "status"])
            guard value["status"] as? String == "pending",
                  let id = value["claimId"] as? String, let receipt = value["receipt"] as? String,
                  let transcript = value["transcript"] as? String,
                  n01Hex(id), n01Hex(receipt), n01Hex(transcript) else { throw N01BootstrapError.rejected }
            let compared = try comparison(claimID: id, serverTranscript: transcript)
            pendingClaim = (id, receipt, compared)
            return compared
        } catch { cancel(); throw N01BootstrapError.rejected }
    }
    // Only trusted native UI should call this after actual user comparison. Not registered with NSH.
    func acknowledgeComparison(_ displayed: String) throws {
        try requireLive()
        guard !pairingBusy, let claim = pendingClaim, displayed == claim.transcript else {
            cancel(); throw N01BootstrapError.rejected
        }
        locallyCompared = true
    }
    // At most four explicit attempts; 409 means pending, never automatic retry/polling.
    func redeem() async throws -> N01PairingCredential? {
        try requireLive()
        guard !pairingBusy, active == nil, locallyCompared, let claim = pendingClaim,
              redeemAttempts < 4 else { throw N01BootstrapError.rejected }
        redeemAttempts += 1; pairingBusy = true
        let request = N01PinnedProbe(policy: policy, pairing: true); active = request
        defer { active = nil; pairingBusy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["claimId": claim.id, "receipt": claim.receipt])
            let bytes = try await request.postPairing(endpoint.appendingPathComponent("v1/pairing/redeem"), body: body)
            try requireLive()
            let value = try Self.parse(bytes, keys: ["version", "deviceId", "token", "expiresInMs", "projects"])
            guard let id = value["deviceId"] as? String, let token = value["token"] as? String,
                  n01Hex(id), n01Hex(token), let lifetime = value["expiresInMs"] as? NSNumber,
                  CFGetTypeID(lifetime) != CFBooleanGetTypeID(), lifetime.doubleValue == Double(lifetime.intValue),
                  (1...3600000).contains(lifetime.intValue),
                  let projects = value["projects"] as? [String], (1...8).contains(projects.count),
                  Set(projects).count == projects.count, projects.allSatisfy({
                    $0.range(of: #"^[a-z0-9_-]{1,64}$"#, options: .regularExpression) != nil
                  }) else { throw N01BootstrapError.rejected }
            let credential = N01PairingCredential(deviceID: id, projects: projects, token: token, milliseconds: lifetime.intValue)
            cancel(); return credential
        } catch N01TLSError.pending { try requireLive(); return nil }
        catch { cancel(); throw N01BootstrapError.rejected } // Ambiguous response requires new pairing, not blind resend.
    }
    private static func parse(_ bytes: Data, keys: Set<String>) throws -> [String: Any] {
        guard bytes.count <= 4096,
              let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], Set(value.keys) == keys,
              let version = value["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
              version.doubleValue == 1 else { throw N01BootstrapError.rejected }
        // Only the exact flat schema is accepted; escaped/duplicate key spellings rejected before use.
        let text = String(data: bytes, encoding: .utf8) ?? ""
        guard !text.contains("\\"), keys.allSatisfy({ key in
            let pattern = "\"" + key + "\"\\s*:"
            return (try? NSRegularExpression(pattern: pattern).numberOfMatches(in: text,
                range: NSRange(text.startIndex..., in: text))) == 1
        }) else { throw N01BootstrapError.rejected }
        return value
    }
}
