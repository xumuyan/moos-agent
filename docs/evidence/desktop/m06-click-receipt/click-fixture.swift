import AppKit
import SwiftUI
func record(_ row:[String:Any]) { if let d=try? JSONSerialization.data(withJSONObject:row, options:[.sortedKeys]) { FileHandle.standardError.write(d);FileHandle.standardError.write(Data([10])) } }
struct ClickView:View {
 @State private var count=0
 var body:some View { VStack(spacing:20) {
 Text("Isolated click receipt • no network / no saved tasks")
 Button("SwiftUI click target") { count+=1;record(["semantic":"swiftui","count":count]); }.buttonStyle(.bordered).accessibilityIdentifier("click-fixture-target")
 Text("SwiftUI count: \(count)").font(.title2)
 Text("Mouse metadata only; no keyboard/text logging")
 }.padding(30).frame(width:640,height:300) }
}
final class Owner:NSObject,NSApplicationDelegate {
 var window:NSWindow!
 func applicationDidFinishLaunching(_ n:Notification) {
  window=NSWindow(contentRect:NSRect(x:730,y:370,width:640,height:300),styleMask:[.titled,.closable],backing:.buffered,defer:false)
  window.title="Isolated click receipt"
  window.contentView=NSHostingView(rootView:ClickView())
  NSEvent.addLocalMonitorForEvents(matching:[.leftMouseDown,.leftMouseUp]) { [weak self] e in
   if e.window === self?.window { record(["event":e.type.rawValue,"timestamp":e.timestamp,"clickCount":e.clickCount,"x":e.locationInWindow.x,"y":e.locationInWindow.y,"flags":e.modifierFlags.rawValue]) };return e
  }
  window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
 }
 func applicationShouldTerminateAfterLastWindowClosed(_ a:NSApplication)->Bool{true}
}
let app=NSApplication.shared;app.setActivationPolicy(.regular);let owner=Owner();app.delegate=owner;app.run()
