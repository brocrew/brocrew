import AppKit
import Foundation

// An ordinary native Quit request to one verified launch; never forceTerminate.
guard CommandLine.arguments.count == 3,
      let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      let executable = app.executableURL else {
    fputs("No native application for the owned pid\n", stderr)
    exit(2)
}
let expected = URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath().path
guard executable.resolvingSymlinksInPath().path == expected else {
    fputs("Native application executable differs from the owned launch\n", stderr)
    exit(2)
}
let accepted = app.terminate()
let receipt: [String: Any] = [
    "pid": pid,
    "executable": executable.path,
    "bundleIdentifier": app.bundleIdentifier ?? "",
    "quitRequestAccepted": accepted,
    "method": "NSRunningApplication.terminate"
]
let bytes = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
print(String(decoding: bytes, as: UTF8.self))
exit(accepted ? 0 : 1)
