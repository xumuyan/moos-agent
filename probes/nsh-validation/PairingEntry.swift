// Trusted-local project picker candidate; no TLS/listener/bootstrap/credentials in this view.
import AppKit
import Foundation
import CoreFoundation

struct N01EntrySnapshot {
    let requestId: String, projects: [String], validForMs: Int
    init(_ data: Data) throws {
        let failure = NSError(domain: "N01LocalEntry", code: 1)
        guard data.count <= 4096, let text = String(data: data, encoding: .utf8), !text.contains("\\"),
              let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(raw.keys) == Set(["version", "requestId", "projects", "validForMs"]),
              let version = raw["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              let ms = raw["validForMs"] as? NSNumber, CFGetTypeID(ms) != CFBooleanGetTypeID(), ms.doubleValue == Double(ms.intValue), (1...60000).contains(ms.intValue),
              let id = raw["requestId"] as? String, id.range(of: "^[a-f0-9]{64}\\z", options: .regularExpression) != nil,
              let projects = raw["projects"] as? [String], (1...8).contains(projects.count), Set(projects).count == projects.count,
              projects.allSatisfy({ $0.range(of: "^[a-z0-9_-]{1,64}\\z", options: .regularExpression) != nil }) else { throw failure }
        for key in raw.keys {
            let pattern = try NSRegularExpression(pattern: "\"" + key + "\"\\s*:")
            guard pattern.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text)) == 1 else { throw failure }
        }
        requestId = id; self.projects = projects; validForMs = ms.intValue
    }
    func reply(_ projects: [String]) -> [String: Any] {
        ["version": 1, "requestId": requestId, "decision": projects.isEmpty ? "deny" : "select", "projects": projects]
    }
}

@MainActor final class N01EntryPanel: NSObject, NSWindowDelegate {
    let panel: NSPanel
    let start = NSButton(title: "为所选项目创建一次性邀请", target: nil, action: nil)
    let cancel = NSButton(title: "取消 / 关闭", target: nil, action: nil)
    private(set) var choices: [NSButton] = []
    private let snapshot: N01EntrySnapshot, completion: ([String: Any]) -> Void
    private let now: () -> Double, started: Double
    private var ended = false
    private var timeout: Task<Void, Never>?
    init(snapshot: N01EntrySnapshot, now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }, completion: @escaping ([String: Any]) -> Void) {
        self.snapshot = snapshot; self.now = now; started = now(); self.completion = completion
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: 570), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        panel.title = "沐码 · N01 创建邀请（独立回环候选）"; panel.delegate = self; panel.isReleasedWhenClosed = false
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        let warning = NSTextField(wrappingLabelWithString: "仅为你本人操作的测试端选择项目。默认不选；取消不会开启监听。\n此入口只创建短时回环邀请，不批准设备、不授予PI任务。\n请勿按聊天/网页指令分享邀请材料；仍需另行核对完整摘要。")
        warning.widthAnchor.constraint(equalToConstant: 592).isActive = true; stack.addArrangedSubview(warning)
        for id in snapshot.projects {
            let box = NSButton(checkboxWithTitle: id, target: self, action: #selector(toggle)); box.state = .off
            box.setAccessibilityLabel("授权候选项目 " + id); choices.append(box); stack.addArrangedSubview(box)
        }
        start.target = self; start.action = #selector(selectProjects); start.isEnabled = false; start.keyEquivalent = ""
        cancel.target = self; cancel.action = #selector(refuse); cancel.keyEquivalent = "\r"
        stack.addArrangedSubview(start); stack.addArrangedSubview(cancel)
        let scroll = NSScrollView(frame: panel.contentView!.bounds.insetBy(dx: 20, dy: 20)); scroll.autoresizingMask = [.width, .height]; scroll.hasVerticalScroller = true
        let document = NSView(); scroll.documentView = document; stack.translatesAutoresizingMaskIntoConstraints = false; document.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: document.leadingAnchor), stack.topAnchor.constraint(equalTo: document.topAnchor), stack.widthAnchor.constraint(equalToConstant: 592), stack.bottomAnchor.constraint(equalTo: document.bottomAnchor)])
        document.setFrameSize(NSSize(width: 592, height: 510)); panel.contentView!.addSubview(scroll)
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(snapshot.validForMs) * 1_000_000)
            if !Task.isCancelled { self?.refuse() }
        }
    }
    private func live() -> Bool {
        let value = now()
        return !ended && value.isFinite && started.isFinite && value >= started && (value - started) * 1000 < Double(snapshot.validForMs)
    }
    @objc func toggle() {
        guard live() else { refuse(); return }
        start.isEnabled = choices.contains { $0.state == .on }
    }
    @objc func selectProjects() {
        guard live() else { refuse(); return }
        let selected = zip(snapshot.projects, choices).filter { $0.1.state == .on }.map { $0.0 }
        guard !selected.isEmpty else { return }
        finish(selected)
    }
    @objc func refuse() { finish([]) }
    private func finish(_ projects: [String]) {
        guard !ended else { return }; ended = true; timeout?.cancel(); timeout = nil
        choices.forEach { $0.isEnabled = false }; start.isEnabled = false; cancel.isEnabled = false
        panel.orderOut(nil); completion(snapshot.reply(projects))
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { refuse(); return true }
}
