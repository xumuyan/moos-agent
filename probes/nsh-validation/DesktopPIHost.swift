import UIKit
import NativeShell
import Darwin

// Isolated Mac Catalyst candidate only. No production data or app identity.
@MainActor
final class DesktopPIController: UIViewController {
    private let shell = NshAppView()
    private var bridge: DesktopNativeBridge?
    private var heartbeat: Timer?
    private var lastTick = ProcessInfo.processInfo.systemUptime
    private var longestTick = 0.0
    private var finished = false
    private var dir: URL { Bundle.main.bundleURL.deletingLastPathComponent() }

    override func viewDidLoad() {
        super.viewDidLoad()
        do {
            shell.frame = view.bounds
            shell.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            shell.storageDirectory = dir.appendingPathComponent("storage", isDirectory: true)
            view.addSubview(shell)
            bridge = try DesktopNativeBridge(on: shell)
            shell.onError = { [weak self] _ in self?.finish(["passed": false, "stage": "engine"]) }
#if PI_UI_CHECK
            heartbeat = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    let now = ProcessInfo.processInfo.systemUptime
                    self.longestTick = max(self.longestTick, now - self.lastTick)
                    self.lastTick = now
                }
            }
            shell.handle("piui.disconnect") { [weak self] _ in
                guard let self, let bridge = self.bridge else { throw DesktopPipe.Failure.rejected }
                return ["clean": await bridge.destroy()]
            }
            shell.handle("piui.report") { [weak self] data, reply in
                guard let self, let report = data as? [String: Any] else { reply.reject("invalid report"); return }
                reply.resolve(["accepted": true])
                self.finish(report)
            }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 55_000_000_000)
                self?.finish(["passed": false, "stage": "deadline"])
            }
#endif
            try shell.loadBundle(at: Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/ui/bundle.nshc"))
        } catch {
            finish(["passed": false, "stage": "initialization"])
        }
    }

    func close() { finish(["passed": true, "stage": "owner-close"]) }
    func revoke() { shell.send("desktop.dispose"); bridge?.pipe.shutdown() }

    private func finish(_ report: [String: Any]) {
        guard !finished else { return }
        finished = true
        heartbeat?.invalidate()
        shell.send("desktop.dispose")
        Task {
            let clean = await bridge?.destroy() ?? false
            var output = report
            let passed = report["passed"] as? Bool == true && clean && bridge?.pipe.forced == false
            output["passed"] = passed
            output["normalChildExit"] = clean
            output["forced"] = bridge?.pipe.forced ?? false
            output["stderrBytes"] = bridge?.pipe.diagnosticsBytes ?? 0
            output["mainRunLoopMaxGapMs"] = Int(longestTick * 1000)
            output["platform"] = "Mac Catalyst NSH 0.5.0"
            if let data = try? JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: dir.appendingPathComponent("result.json"), options: .atomic)
            }
            exit(passed ? 0 : 2)
        }
    }
}

@MainActor
final class DesktopPIScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var controller: DesktopPIController?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        scene.sizeRestrictions?.minimumSize = CGSize(width: 680, height: 620)
        let window = UIWindow(windowScene: scene)
        let controller = DesktopPIController()
        self.controller = controller
        self.window = window
        DesktopPIDelegate.controller = controller
        window.rootViewController = controller
        _ = controller.view
#if PI_UI_CHECK
        window.isHidden = false // Driver does not need key-window focus.
#else
        window.makeKeyAndVisible()
#endif
    }
    func sceneDidDisconnect(_ scene: UIScene) { controller?.close() }
}

@main @MainActor
final class DesktopPIDelegate: UIResponder, UIApplicationDelegate {
    static weak var controller: DesktopPIController?
    override init() {
        super.init()
        signal(SIGPIPE, SIG_IGN)
        let dir = Bundle.main.bundleURL.deletingLastPathComponent()
        try? Data(String(getpid()).utf8).write(to: dir.appendingPathComponent("app.pid"), options: .atomic)
    }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "DesktopPI", sessionRole: session.role)
        config.delegateClass = DesktopPIScene.self
        return config
    }
    func applicationWillTerminate(_ application: UIApplication) { Self.controller?.revoke() }
}
