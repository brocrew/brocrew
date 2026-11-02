// Read-only observer for the two-Space check, public AppKit/CoreGraphics only. It never activates
// an app, moves a window or changes a setting, and needs no Screen Recording permission: it reads
// window owner ids and on-screen state, never window titles or pixels.
import AppKit
import CoreGraphics
import Foundation

func emit(_ value: [String: Any]) {
    var line = value
    line["at"] = Date().timeIntervalSince1970 * 1000
    if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) {
        print(text)
        fflush(stdout)
    }
}
func app(_ running: NSRunningApplication?) -> [String: Any] {
    ["pid": running?.processIdentifier ?? 0, "bundle": running?.bundleIdentifier ?? ""]
}
/// Windows on the current Space owned by the given processes (layer 0 only: ordinary windows).
func onScreen(_ pids: Set<Int32>) -> Int {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return -1 }
    return rows.filter { row in
        guard let pid = row[kCGWindowOwnerPID as String] as? Int32, let layer = row[kCGWindowLayer as String] as? Int else { return false }
        return layer == 0 && pids.contains(pid)
    }.count
}
let center = NSWorkspace.shared.notificationCenter
center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
    emit(["kind": "activate"].merging(app(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)) { a, _ in a })
}
center.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
    emit(["kind": "space"])
}
Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
    emit(["kind": "front"].merging(app(NSWorkspace.shared.frontmostApplication)) { a, _ in a })
}
// Requests on stdin, one JSON object per line: {"windows": [pid, ...], "id": "..."}.
DispatchQueue.global().async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = request["id"] as? String else { continue }
        let pids = Set(((request["windows"] as? [NSNumber]) ?? []).map { $0.int32Value })
        DispatchQueue.main.async { emit(["kind": "windows", "id": id, "onScreen": onScreen(pids)]) }
    }
    exit(0)
}
let limit = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 3600 : 3600
DispatchQueue.main.asyncAfter(deadline: .now() + limit) { exit(0) }
emit(["kind": "ready"])
RunLoop.main.run()
