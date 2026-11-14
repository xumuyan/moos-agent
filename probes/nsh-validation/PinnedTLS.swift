// N01 trust primitive, not a general-purpose network bridge or production pairing layer.
import Foundation
import Security
import CryptoKit

struct N01TrustPolicy: Sendable {
    let anchorDER: Data
    let leafSHA256: String
    let hostname: String

    init(anchorDER: Data, leafSHA256: String, hostname: String) throws {
        guard SecCertificateCreateWithData(nil, anchorDER as CFData) != nil,
              leafSHA256.count == 64, leafSHA256.allSatisfy({ "0123456789abcdef".contains($0) }),
              !hostname.isEmpty, !hostname.contains("/"), !hostname.contains(":") else {
            throw N01TLSError.invalidConfiguration
        }
        self.anchorDER = anchorDER; self.leafSHA256 = leafSHA256; self.hostname = hostname
    }

    // Anchor-only validation retains signature, validity, chain and hostname checks.
    // A matching hash alone is never sufficient. The pin is the leaf DER SHA256, not SPKI.
    func accepts(_ trust: SecTrust, date: Date? = nil) -> Bool {
        guard let anchor = SecCertificateCreateWithData(nil, anchorDER as CFData),
              SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, hostname as CFString)) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [anchor] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess else { return false }
        if let date, SecTrustSetVerifyDate(trust, date as CFDate) != errSecSuccess { return false }
        guard SecTrustEvaluateWithError(trust, nil),
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else { return false }
        let bytes = SecCertificateCopyData(leaf) as Data
        let actual = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        return actual == leafSHA256
    }
}

enum N01TLSError: Error { case invalidConfiguration, rejected, invalidResponse, responseTooLarge, network, cancelled, pending }

// One bounded request: fixed trust-check GET or exact pairing POST. No arbitrary fetch/redirect/retry.
// The NSH trust-check handler still exposes only GET; native pairing is not registered with JS.
final class N01PinnedProbe: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let policy: N01TrustPolicy
    private let lock = NSLock()
    private var completion: CheckedContinuation<Data, Error>?
    private var bytes = Data()
    private var session: URLSession?
    private var started = false
    private var cancelled = false
    private let pairing: Bool
    init(policy: N01TrustPolicy, pairing: Bool = false) { self.policy = policy; self.pairing = pairing }

    func get(_ url: URL) async throws -> Data {
        guard !pairing, url.scheme == "https", url.host == policy.hostname, url.user == nil, url.password == nil,
              url.path == "/trust-check", url.query == nil, url.fragment == nil else {
            throw N01TLSError.invalidConfiguration
        }
        return try await perform(URLRequest(url: url))
    }
    func postPairing(_ url: URL, body: Data) async throws -> Data {
        guard pairing, url.scheme == "https", url.host == policy.hostname, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              ["/v1/pairing/claim", "/v1/pairing/redeem"].contains(url.path), body.count <= 4096,
              let object = try? JSONSerialization.jsonObject(with: body) as? [String: String] else {
            throw N01TLSError.invalidConfiguration
        }
        let keys = url.path.hasSuffix("/claim") ? ["invitationId", "secret", "clientNonce"] : ["claimId", "receipt"]
        guard Set(object.keys) == Set(keys), object.values.allSatisfy({
            $0.utf8.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }) else { throw N01TLSError.invalidConfiguration }
        // Re-encode validated input; duplicate fields cannot be forwarded to a different parser.
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: object)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await perform(request)
    }
    private func perform(_ request: URLRequest) async throws -> Data {
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                guard !cancelled else { lock.unlock(); continuation.resume(throwing: N01TLSError.cancelled); return }
                guard !started else { lock.unlock(); continuation.resume(throwing: N01TLSError.invalidConfiguration); return }
                started = true; completion = continuation
                let config = URLSessionConfiguration.ephemeral
                config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
                config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 8
                config.tlsMinimumSupportedProtocolVersion = .TLSv12
                let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
                self.session = session
                session.dataTask(with: request).resume()
                lock.unlock()
            }
        } onCancel: { self.cancel() }
    }
    func cancel() {
        lock.lock(); cancelled = true; lock.unlock()
        finish(.failure(N01TLSError.cancelled))
    }
    private func finish(_ result: Result<Data, Error>) {
        lock.lock(); let callback = completion; completion = nil
        let current = session; session = nil; lock.unlock()
        current?.invalidateAndCancel(); callback?.resume(with: result)
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == policy.hostname,
              let trust = challenge.protectionSpace.serverTrust, policy.accepts(trust) else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil); finish(.failure(N01TLSError.rejected))
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse,
              !pairing || response.value(forHTTPHeaderField: "Content-Type") == "application/json" else {
            completionHandler(.cancel); finish(.failure(N01TLSError.invalidResponse)); return
        }
        if pairing && response.statusCode == 409 {
            completionHandler(.cancel); finish(.failure(N01TLSError.pending)); return
        }
        guard response.statusCode == 200 else {
            completionHandler(.cancel); finish(.failure(N01TLSError.invalidResponse)); return
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard bytes.count + data.count <= 4096 else {
            finish(.failure(N01TLSError.responseTooLarge)); return
        }
        bytes.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if error != nil { finish(.failure(N01TLSError.network)) }
        else { finish(.success(bytes)) }
    }
}
