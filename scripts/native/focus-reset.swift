// Harness-only activation, BEFORE each measured action. Never used by the plugin.
import AppKit
import Foundation
import Darwin
let args = CommandLine.arguments
if args.count != 4 { fputs("supply pinned BroCrew PID, bundle id and bundle path\n", stderr); exit(64) }
guard let pid = Int32(args[1]), let app = NSRunningApplication(processIdentifier: pid),
      app.bundleIdentifier == args[2], app.bundleURL?.path == args[3], !app.isTerminated else {
    fputs("pinned BroCrew application identity changed\n", stderr); exit(1)
}
let accepted = app.activate(options: [.activateIgnoringOtherApps])
print("harness reset requested for pinned BroCrew PID \(pid); accepted=\(accepted)")
exit(accepted ? 0 : 1)
