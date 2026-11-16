import UIKit
import NativeShell
import Darwin

// Mac Catalyst acceptance runner, not a phone or AppKit product build.
@MainActor
final class DesktopCheckController: UIViewController {
    var bridges: [DesktopNativeBridge] = []
    var views: [NshAppView] = []
    var finished = false
    let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["N01_DESKTOP_CHECK_DIR"]!)
    var reports: [String: [String: Any]] = [:]
    let exitCheck = ProcessInfo.processInfo.environment["N01_DESKTOP_EXIT_CHECK"] == "1"
    var exitReady = false
    override func viewDidLoad() {
        super.viewDidLoad()
        do {
            for scenario in exitCheck ? ["good"] : ["good", "denied", "timeout"] {
                let app = NshAppView(); app.frame = CGRect(x: 0, y: 0, width: 340, height: 180)
                app.storageDirectory = dir.appendingPathComponent("storage-" + scenario)
                app.params = ["scenario": scenario, "exitCheck": exitCheck]
                views.append(app); view.addSubview(app)
                let bridge = try scenario == "timeout" ? DesktopNativeBridge.testStalled(on: app) : DesktopNativeBridge(on: app); bridges.append(bridge)
                // Acceptance-only lifecycle control; not installed by DesktopNativeBridge.
                app.handle("check.destroy") { data in
                    guard scenario != "denied", data == nil || data is NSNull else { throw DesktopPipe.Failure.rejected }
                    let clean = await bridge.destroy()
                    return ["clean": clean, "forced": bridge.pipe.forced]
                }
                app.handle("check.ready") { [weak self] data in
                    guard let self, self.exitCheck, data == nil || data is NSNull else { throw DesktopPipe.Failure.rejected }
                    self.exitReady = true
                    try Data("active registered bash".utf8).write(to: self.dir.appendingPathComponent("ready.txt"))
                    Task { try? await Task.sleep(nanoseconds: 150_000_000); self.finish(true) }
                    return ["accepted": true]
                }
                app.onError = { [weak self] _ in self?.finish(false) }
                app.handle("check.report") { [weak self] data, reply in
                    guard let self, let result = data as? [String: Any] else { reply.reject("report"); return }
                    self.reports[scenario] = result; reply.resolve(["accepted": true])
                    if result["passed"] as? Bool != true { self.finish(false) }
                    else if self.reports.count == 3 { self.finish(true) }
                }
                try app.loadBundle(at: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/" + scenario + "/bundle.nshc"))
            }
            Task { [weak self] in try? await Task.sleep(nanoseconds: 45_000_000_000); self?.finish(false) }
        } catch { finish(false) }
    }
    func finish(_ success: Bool) {
        guard !finished else { return }; finished = true
        Task {
            var clean = true
            for bridge in bridges { let result = await bridge.destroy(); clean = result && clean }
            let output: [String: Any] = ["passed": success && clean, "reports": reports,
                "normalChildExit": clean, "forced": bridges.contains { $0.pipe.forced },
                "maxPending": bridges.map { $0.pipe.maxPending },
                "stderrBytes": bridges.map { $0.pipe.diagnosticsBytes },
                "platform": "Mac Catalyst NSH 0.5.0", "phoneInstalled": false, "productionData": false]
            try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .prettyPrinted]).write(to: dir.appendingPathComponent("result.json"))
            exit(success && clean ? 0 : 2)
        }
    }
}
@MainActor
final class DesktopCheckScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene); let controller = DesktopCheckController()
        window.rootViewController = controller; self.window = window
        DesktopCheckDelegate.controller = controller
        _ = controller.view; window.isHidden = false // never activates or becomes key
    }
}
@main @MainActor
final class DesktopCheckDelegate: UIResponder, UIApplicationDelegate {
    static weak var controller: DesktopCheckController?
    override init() {
        super.init(); signal(SIGPIPE, SIG_IGN)
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["N01_DESKTOP_CHECK_DIR"]!)
        try? Data(String(getpid()).utf8).write(to: dir.appendingPathComponent("app.pid"))
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "DesktopCheck", sessionRole: session.role); config.delegateClass = DesktopCheckScene.self; return config
    }
    func applicationWillTerminate(_ application: UIApplication) {
        // Synchronous admission close/EOF fallback; normal exit uses awaited destroy above.
        Self.controller?.bridges.forEach { $0.pipe.shutdown() }
    }
}
