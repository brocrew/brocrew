# Windows process birth helper

Standalone standard-library-only Go module. Toolchain: `go1.27.2`;
remote commands must verify that exact version and set `GOTOOLCHAIN=local`.
No third-party modules, cgo, daemon, profile writes, fallback or helper timer.

`chrome-process-birth.exe <pid>` accepts one ASCII decimal positive uint32
(leading zeroes allowed). Exit 0 writes exactly one decimal .NET UTC tick
value and LF. Argument, OS, conversion, handle-close or output-write errors
exit 1 and describe the failure on stderr. OS errors include the operation,
PID and original Windows error. No successful identity is emitted before
the process handle has been closed successfully.

The helper opens the requested PID with `PROCESS_QUERY_LIMITED_INFORMATION`
(`0x1000`, non-inheritable), reads creation FILETIME with `GetProcessTimes`
using that same handle, and closes it on every return path. It combines the
high and low words as uint64, rejects values greater than
`2650467743999999999`, then adds `504911232000000000`. No floating point,
Unix-time conversion, Go nanosecond conversion or local-zone conversion is
involved.

Creation-time lookup does not itself prove liveness. In particular, an
exited process with a retained handle can remain queryable. OS permission
failures remain failures; the caller must apply its existing conservative
ownership rules.

## Build and test

Use the pinned Go compiler with `GOTOOLCHAIN=local CGO_ENABLED=0`.
Run `go test ./...` on Windows for the native API tests; other platforms
run the integer conversion and PID parser tests. The Chrome package builder
cross-compiles this module for Windows amd64 into `bin/chrome-process-birth.exe`.
The archive manifest records the executable bytes and SHA-256.

A successful native creation-time query must be compared with the legacy
PowerShell 5.1 UTC tick string before claiming old-reader compatibility.
Neither integer unit tests nor an unreadable owner prove that compatibility.
