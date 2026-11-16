import NativeShell
import Foundation

// The owner must await destroy() before terminating its app or replacing the view.
// host.call wait timeouts alone DO NOT cancel a native call. Native deadlines close this instance.
@MainActor
final class DesktopNativeBridge {
    private let app: NshAppView
    let pipe: DesktopPipe
    convenience init(on app: NshAppView) throws {
        self.init(on: app, transport: try DesktopPipe())
    }
#if BRIDGE_CHECK
    // Only the acceptance executable compiles this trusted, fixed stalled-child seam.
    static func testStalled(on app: NshAppView) throws -> DesktopNativeBridge {
        let pipe = try DesktopPipe.testLaunch(script: DesktopFixedLaunch.stalledScript, callSeconds: 0.5)
        return DesktopNativeBridge(on: app, transport: pipe)
    }
#endif
    private init(on app: NshAppView, transport: DesktopPipe) {
        self.app = app; pipe = transport
        for method in DesktopPipe.methods {
            app.handle(method) { [weak self] data, reply in
                guard let self else { reply.reject("desktop unavailable"); return }
                self.pipe.call(method, params: data) { result in
                    switch result {
                    case .success(let response): reply.resolve(response)
                    case .failure: reply.reject("desktop unavailable")
                    }
                }
            }
        }
    }
    func destroy() async -> Bool {
        pipe.shutdown()
        for method in DesktopPipe.methods { app.removeHandler(method) }
        return await pipe.close()
    }
    deinit { /* DesktopPipe deinit sends EOF as a fallback; normal owner path awaits destroy. */ }
}
