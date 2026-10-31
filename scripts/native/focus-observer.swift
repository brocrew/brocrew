// Read-only native focus and active-Space observations. No activation or Space mutation.
import AppKit
import Foundation
import Darwin
import CoreFoundation

typealias Connection = @convention(c) () -> UInt32
typealias ActiveSpace = @convention(c) (UInt32) -> UInt64
typealias DisplaySpaces = @convention(c) (UInt32, Int32) -> Unmanaged<CFArray>?
let library = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
let connection = library.flatMap { dlsym($0, "SLSMainConnectionID") ?? dlsym($0, "CGSMainConnectionID") }
let active = library.flatMap { dlsym($0, "SLSGetActiveSpace") ?? dlsym($0, "CGSGetActiveSpace") }
let managed = library.flatMap { dlsym($0, "SLSCopyManagedDisplaySpaces") ?? dlsym($0, "CGSCopyManagedDisplaySpaces") }
func sample() {
    let app = NSWorkspace.shared.frontmostApplication
    let space: UInt64 = connection != nil && active != nil
        ? unsafeBitCast(active!, to: ActiveSpace.self)(unsafeBitCast(connection!, to: Connection.self)()) : 0
    var displays: [String: String] = [:]
    if let connection = connection, let managed = managed,
       let rows = unsafeBitCast(managed, to: DisplaySpaces.self)(unsafeBitCast(connection, to: Connection.self)(), 0)?.takeRetainedValue() as? [[String: Any]] {
        for row in rows {
            if let name = row["Display Identifier"] as? String, let current = row["Current Space"] as? [String: Any],
               let id = (current["ManagedSpaceID"] ?? current["id64"]) as? NSNumber {
                displays[name] = id.stringValue
            }
        }
    }
    let value: [String: Any] = ["at": Date().timeIntervalSince1970 * 1000,
        "pid": app?.processIdentifier ?? 0, "bundle": app?.bundleIdentifier ?? "",
        "space": String(space), "displays": displays]
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) {
        print(line); fflush(stdout)
    }
}
let end = Date().addingTimeInterval(CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 120 : 120)
repeat { sample(); RunLoop.current.run(until: Date().addingTimeInterval(0.05)) } while Date() < end
