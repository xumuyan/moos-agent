import UIKit
import NativeShell
import CryptoKit

// Catalyst-only isolated acceptance runner; no device access or foreground activation.
@MainActor
final class N01RuntimeController: UIViewController {
    var views: [NshAppView] = []
    var finished = false
    override func viewDidLoad() {
        super.viewDidLoad()
        do {
            let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["N01_RUNTIME_DIR"]!)
            try Data("controller started".utf8).write(to: dir.appendingPathComponent("startup.txt"))
            let config = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("config.json"))) as! [String: Any]
            let ca = try Data(contentsOf: dir.appendingPathComponent("ca.der"))
            let leaf = try Data(contentsOf: dir.appendingPathComponent("server.der"))
            let hash = SHA256.hash(data: leaf).map { String(format: "%02x", $0) }.joined()
            var results: [String: [String: Any]] = [:]
            for name in ["good", "wrongpin", "denied"] {
                let app = NshAppView()
                app.frame = CGRect(x: 0, y: 0, width: 320, height: 200)
                view.addSubview(app); views.append(app)
                app.storageDirectory = dir.appendingPathComponent("storage-" + name)
                app.onError = { [weak self] message in
                    try? Data(message.utf8).write(to: dir.appendingPathComponent("engine-error.txt"))
                    self?.finish(false, dir: dir)
                }
                app.params = ["scenario": name]
                let policy = try N01TrustPolicy(anchorDER: ca, leafSHA256: name == "wrongpin" ? String(repeating: "0", count: 64) : hash, hostname: "localhost")
                installN01TrustCheck(on: app, policy: policy, endpoint: URL(string: config["url"] as! String)!)
                app.handle("n01.report") { [weak self] data, reply in
                    guard let self, let report = data as? [String: Any] else {
                        reply.reject("invalid report"); return
                    }
                    results[name] = report
                    try? JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]).write(to: dir.appendingPathComponent("reports.json"))
                    guard report["passed"] as? Bool == true else {
                        self.finish(false, dir: dir); reply.reject("failed report"); return
                    }
                    reply.resolve(["accepted": true])
                    if results.count == 3 {
                        try? JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]).write(to: dir.appendingPathComponent("reports.json"))
                        self.finish(true, dir: dir)
                    }
                }
                try app.loadBundle(at: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/" + name + "/bundle.nshc"))
                try Data("loaded".utf8).write(to: dir.appendingPathComponent(name + "-loaded.txt"))
            }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                self?.finish(false, dir: dir)
            }
        } catch {
            let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["N01_RUNTIME_DIR"]!)
            try? Data(String(describing: error).utf8).write(to: dir.appendingPathComponent("swift-error.txt"))
            exit(3)
        }
    }
    func finish(_ passed: Bool, dir: URL) {
        guard !finished else { return }; finished = true
        try? Data((passed ? "passed" : "failed").utf8).write(to: dir.appendingPathComponent("result.txt"))
        // Give host replies time to drain before exiting only this acceptance runner.
        Task { try? await Task.sleep(nanoseconds: 150_000_000); exit(passed ? 0 : 2) }
    }
}
@MainActor
final class N01RuntimeScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = N01RuntimeController(); self.window = window
        _ = window.rootViewController?.view
        window.isHidden = false // Visible background window, never makeKeyAndVisible or activate.
    }
}
@main @MainActor
final class N01RuntimeDelegate: UIResponder, UIApplicationDelegate {
    override init() {
        super.init()
        if let path = ProcessInfo.processInfo.environment["N01_RUNTIME_DIR"] {
            try? Data(String(ProcessInfo.processInfo.processIdentifier).utf8).write(to: URL(fileURLWithPath: path).appendingPathComponent("app.pid"))
        }
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "N01", sessionRole: session.role)
        config.delegateClass = N01RuntimeScene.self
        return config
    }
}
