// Unsigned build/link check only. No device, accounts, signing or installation commands.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
process.umask(0o077);
const base = resolve('artifacts/nsh-validation');
const nsh = join(base, 'toolchain/nsh/bin/nsh');
assert.equal(execFileSync(nsh, ['--version'], { encoding: 'utf8' }).trim(), 'nsh 0.5.0 (f4d68f7)');
const framework = join(base, 'toolchain/embed-ios/nsh-embed-ios/NativeShell.xcframework/ios-arm64/NativeShell.framework');
await readFile(join(framework, 'Modules/NativeShell.swiftmodule/arm64-apple-ios.swiftinterface'));
await mkdir(join(base, 'bridge-build'), { recursive: true });
const dir = await mkdtemp(join(base, 'bridge-build/run-'));
await mkdir(join(dir, 'ui'));
await writeFile(join(dir, 'ui/nsh.json'), JSON.stringify({ name: 'N01 bridge build check', id: 'dev.muma.probe.nsh.bridgecheck', capabilities: { host: ['n01.trustCheck'] } }));
await writeFile(join(dir, 'ui/App.tsx'), `import { mount, Text } from 'nsh';
mount(() => <Text>N01 build-only bridge candidate, not phone network verification</Text>);`);
execFileSync(nsh, ['build', join(dir, 'ui/App.tsx'), '--release', '--out', join(dir, 'nsh')], { stdio: 'pipe' });
await writeFile(join(dir, 'main.swift'), `import UIKit
import NativeShell
final class Controller: UIViewController {
 let app = NshAppView()
 override func viewDidLoad() {
  super.viewDidLoad(); app.frame = view.bounds; app.autoresizingMask = [.flexibleWidth, .flexibleHeight]; view.addSubview(app)
  if let url = Bundle.main.url(forResource: "bundle", withExtension: "nshc", subdirectory: "nsh") { try? app.loadBundle(at: url) }
 }
}
final class Delegate: UIResponder, UIApplicationDelegate {
 var window: UIWindow?
 func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
  let window = UIWindow(frame: UIScreen.main.bounds); window.rootViewController = Controller(); window.makeKeyAndVisible(); self.window = window; return true
 }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(Delegate.self))
`);
const project = {
  name: 'N01BridgeCheck',
  options: { deploymentTarget: { iOS: '15.0' } },
  targets: { N01BridgeCheck: {
    type: 'application', platform: 'iOS',
    sources: [join(dir, 'main.swift'), ...['PinnedTLS.swift', 'PinnedTLSBridge.swift'].map(p => resolve('probes/nsh-validation', p)), { path: join(dir, 'nsh'), type: 'folder', buildPhase: 'resources' }],
    dependencies: [{ framework, embed: false }],
    settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: 'dev.muma.probe.nsh.bridgecheck', GENERATE_INFOPLIST_FILE: 'YES', CODE_SIGNING_ALLOWED: 'NO', SWIFT_VERSION: '6.0', TARGETED_DEVICE_FAMILY: '1', INFOPLIST_KEY_NSLocalNetworkUsageDescription: '独立验证手机与本机 Mac 的加密连接，不访问正式应用数据。', INFOPLIST_KEY_CADisableMinimumFrameDurationOnPhone: 'YES', INFOPLIST_KEY_UILaunchScreen_Generation: 'YES' } }
  } }
};
await writeFile(join(dir, 'project.json'), JSON.stringify(project));
execFileSync('/opt/homebrew/bin/xcodegen', ['generate', '--spec', join(dir, 'project.json')], { stdio: 'pipe' });
try {
  const result = execFileSync('/usr/bin/xcodebuild', ['-project', join(dir, 'N01BridgeCheck.xcodeproj'), '-scheme', 'N01BridgeCheck', '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', '-derivedDataPath', join(dir, 'DerivedData'), 'CODE_SIGNING_ALLOWED=NO', 'build'], { timeout: 240000, maxBuffer: 20 * 1024 * 1024 });
  await writeFile(join(dir, 'build.log'), result);
} catch (error) {
  await writeFile(join(dir, 'build.log'), error.stdout ?? '');
  throw new Error(`unsigned iOS bridge build failed; see ${dir}/build.log`);
}
const app = join(dir, 'DerivedData/Build/Products/Release-iphoneos/N01BridgeCheck.app');
const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')], { encoding: 'utf8' }));
assert.equal(plist.CFBundleIdentifier, 'dev.muma.probe.nsh.bridgecheck');
assert.equal(plist.MinimumOSVersion, '15.0');
assert.ok(plist.NSLocalNetworkUsageDescription);
assert.equal(plist.NSAppTransportSecurity, undefined);
assert.ok((await readFile(join(app, 'nsh/bundle.nshc'))).length > 0);
assert.ok(execFileSync('/usr/bin/file', [join(app, 'N01BridgeCheck')], { encoding: 'utf8' }).includes('arm64'));
console.log(JSON.stringify({ status: 'passed', scope: 'unsigned iOS arm64 build/link only', app, bridgeRuntimeVerified: false, phoneInstalled: false, systemTrustChanged: false }));
