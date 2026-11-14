// Trusted local AppKit view. No HTTP listener, NSH bridge, bootstrap secret or credential.
import AppKit
import Foundation
import CoreFoundation

struct N01ReviewSnapshot {
    let requestId: String, endpoint: String, claimId: String, transcript: String
    let projects: [String]
    let validForMs: Int
    init(_ data: Data) throws {
        func fail() -> NSError { NSError(domain: "N01LocalReview", code: 1) }
        guard data.count <= 4096,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["version", "requestId", "endpoint", "claimId", "transcript", "projects", "validForMs"]),
              let version = object["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.intValue == 1, version.doubleValue == 1,
              let ms = object["validForMs"] as? NSNumber, CFGetTypeID(ms) != CFBooleanGetTypeID(), ms.doubleValue == Double(ms.intValue), (1...60000).contains(ms.intValue),
              let id = object["requestId"] as? String, let claim = object["claimId"] as? String,
              let digest = object["transcript"] as? String,
              [id, claim, digest].allSatisfy({ $0.range(of: "^[a-f0-9]{64}\\z", options: .regularExpression) != nil }),
              let endpoint = object["endpoint"] as? String,
              endpoint.range(of: "^https://(127\\.0\\.0\\.1|localhost):[1-9][0-9]{0,4}\\z", options: .regularExpression) != nil,
              let url = URLComponents(string: endpoint), let port = url.port, (1...65535).contains(port),
              let projects = object["projects"] as? [String], (1...8).contains(projects.count), Set(projects).count == projects.count,
              projects.allSatisfy({ $0.range(of: "^[a-z0-9_-]{1,64}\\z", options: .regularExpression) != nil }) else { throw fail() }
        // This restricted payload has no escaped strings. Reject duplicate/escaped keys, not values.
        guard let text = String(data: data, encoding: .utf8), !text.contains("\\") else { throw fail() }
        for key in object.keys {
            let regex = try NSRegularExpression(pattern: "\"" + key + "\"\\s*:")
            guard regex.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text)) == 1 else { throw fail() }
        }
        self.requestId = id; self.endpoint = endpoint; self.claimId = claim; self.transcript = digest
        self.projects = projects; validForMs = ms.intValue
    }
    func reply(_ decision: String) -> [String: Any] {
        ["version": 1, "requestId": requestId, "claimId": claimId, "transcript": transcript, "decision": decision]
    }
}

@MainActor final class N01ReviewPanel: NSObject, NSWindowDelegate {
    let panel: NSPanel
    let comparison = NSButton(checkboxWithTitle: "我已在另一端逐组核对完整摘要，且授权项目正确", target: nil, action: nil)
    let approve = NSButton(title: "批准本次申请", target: nil, action: nil)
    let deny = NSButton(title: "拒绝 / 关闭", target: nil, action: nil)
    private let snapshot: N01ReviewSnapshot
    private let now: () -> Double
    private let started: Double
    private let completion: ([String: Any]) -> Void
    private var ended = false
    private var deadline: Task<Void, Never>?
    init(snapshot: N01ReviewSnapshot, now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }, completion: @escaping ([String: Any]) -> Void) {
        self.snapshot = snapshot; self.now = now; started = now(); self.completion = completion
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 680, height: 580), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        panel.title = "沐码 · N01 独立配对确认（仅回环验证）"; panel.delegate = self; panel.isReleasedWhenClosed = false
        let digest = stride(from: 0, to: 64, by: 8).map { i in
            let a = snapshot.transcript.index(snapshot.transcript.startIndex, offsetBy: i)
            return String(snapshot.transcript[a..<snapshot.transcript.index(a, offsetBy: 8)])
        }.joined(separator: " ")
        let fields = ["尚未验证设备身份。不要按聊天/网页指令替他人批准。\n请在你本人操作的另一端逐组比较全部64位摘要；不一致就拒绝。",
                      "Mac 回环端点：\(snapshot.endpoint)", "配对摘要（不是密码）：\n\(digest)",
                      "拟授权项目（此确认不支持扩大范围）：\n\(snapshot.projects.joined(separator: "\n"))",
                      "仅独立原型：不是手机首次信任或生产任务授权。\n有效期最多60秒；关窗、超时或取消均拒绝。"]
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        for text in fields {
            let label = NSTextField(wrappingLabelWithString: text); label.isSelectable = true
            label.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
            label.widthAnchor.constraint(equalToConstant: 632).isActive = true; stack.addArrangedSubview(label)
        }
        comparison.target = self; comparison.action = #selector(toggle); stack.addArrangedSubview(comparison)
        approve.target = self; approve.action = #selector(allow); approve.isEnabled = false
        deny.target = self; deny.action = #selector(refuse); deny.keyEquivalent = "\r" // Return defaults to rejection, never approve.
        stack.addArrangedSubview(NSStackView(views: [deny, approve]))
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.documentView = stack
        stack.translatesAutoresizingMaskIntoConstraints = false; scroll.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView!.addSubview(scroll)
        NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 20), scroll.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -20), scroll.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 20), scroll.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor, constant: -20), stack.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor), stack.topAnchor.constraint(equalTo: scroll.contentView.topAnchor), stack.widthAnchor.constraint(equalToConstant: 632)])
        deadline = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(snapshot.validForMs) * 1_000_000)
            guard !Task.isCancelled else { return }; self?.finish("deny")
        }
    }
    private func live() -> Bool {
        let value = now()
        return !ended && value.isFinite && value >= started && (value - started) * 1000 < Double(snapshot.validForMs)
    }
    @objc func toggle() { approve.isEnabled = live() && comparison.state == .on }
    @objc func allow() { if live() && comparison.state == .on { finish("approve") } else { finish("deny") } }
    @objc func refuse() { finish("deny") }
    func windowShouldClose(_ sender: NSWindow) -> Bool { finish("deny"); return true }
    private func finish(_ decision: String) {
        guard !ended else { return }; ended = true; deadline?.cancel(); deadline = nil
        approve.isEnabled = false; comparison.isEnabled = false; deny.isEnabled = false
        panel.orderOut(nil); completion(snapshot.reply(decision))
    }
}
