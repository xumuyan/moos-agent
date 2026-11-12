import AppKit
let app=NSApplication.shared
app.setActivationPolicy(.regular)
final class Owner: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
 var window:NSWindow!;var field:NSTextField!;var label:NSTextField!;var clicks=0
 func applicationDidFinishLaunching(_ note:Notification){
  window=NSWindow(contentRect:NSRect(x:740,y:340,width:580,height:380),styleMask:[.titled,.closable],backing:.buffered,defer:false)
  window.title="Desktop input acceptance · isolated fixture"
  let content=window.contentView!
  let title=NSTextField(labelWithString:"Isolated test — no network / no saved data")
  title.frame=NSRect(x:30,y:300,width:520,height:30);content.addSubview(title)
  field=NSTextField(string:"");field.frame=NSRect(x:30,y:230,width:520,height:32);field.delegate=self;content.addSubview(field)
  let button=NSButton(title:"Test click",target:self,action:#selector(clicked));button.frame=NSRect(x:30,y:160,width:140,height:36);content.addSubview(button)
  label=NSTextField(labelWithString:"clicks: 0 | input: empty");label.frame=NSRect(x:30,y:105,width:520,height:36);content.addSubview(label)
  window.makeKeyAndOrderFront(nil);app.activate(ignoringOtherApps:true);window.makeFirstResponder(field)
 }
 @objc func clicked(){clicks+=1;update()}
 func controlTextDidChange(_ notification:Notification){update()}
 func update(){label.stringValue="clicks: \(clicks) | input: \(field.stringValue)"}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
}
let owner=Owner();app.delegate=owner;app.run()
