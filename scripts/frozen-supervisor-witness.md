# Frozen production supervisor component witness

This opt-in command is a host macOS arm64 component witness. It keeps the owner in the
actual once-built `build-plugin-supervisor.mjs` production artifact, launched with the
production launcher and the pinned shipped Node **24.22.0**. It is source-first work:
**the build, packages and runtime journey have not been executed by the author**.

The source driver uses the real Settings client, person socket, PageTools, MCP stack,
verifier and Settings card validator. Those app-side modules are bundled from source
separately and are **outside the frozen owner artifact**. An inert Electron import
boundary throws if a view or session is mounted. No source owner is admitted in the
driver bundle. This does not qualify mounted Configure/buttons/notifications/hooks,
provider turns/adapters, native Chrome/WhatsApp, accounts, whole Electron, signed
`.app`/`.dmg`, packaged app replacement/handover, guardian SIGKILL or Windows. All
whole-app and W4 gates remain pending.

## Preparation, performed once by the integration owner after independent review

Use a clean checkout of the exact reviewed integrated commit. The two new source files
are `scripts/frozen-supervisor-witness.mjs` and
`apps/desktop/smoke/frozen-supervisor-witness.ts`; this document accompanies them.
Do not install dependencies or prepare resources inside a test run. Existing locked
workspace dependencies must already be prepared by the separately authorized setup.
The script resolves the locked desktop Vite/esbuild exactly as the production builder
does and records its version, lock digest, Git SHA/tree and driver dependency metafile.

Set `WITNESS_SHA` to the **literal reviewed integrated 40-character SHA**; using a
moving branch here defeats review. Supply an absolute, nonexistent, short path you own
for `WITNESS_OUT`, for example `/tmp/frozen-lantern-<unique-id>`. The shell must have a
Node >=24 executable and Git on PATH. Preparation can fetch only the shipped runtime
via the existing pinned `preparePluginNode` function. It neither installs packages nor
touches tracked resources or plugin data.

```sh
WITNESS_SHA=<reviewed-40-character-sha>
WITNESS_OUT=/tmp/frozen-lantern-<unique-id>
node scripts/frozen-supervisor-witness.mjs prepare "$WITNESS_OUT" "$WITNESS_SHA"
```

`prepare` refuses a dirty/wrong checkout or an existing output directory. It copies
every shipped `plugin-host` resource, explicitly prepares the pinned runtime into
`resources/plugin-node`, calls the actual production supervisor build **once**, and
builds the separate source driver. The common fictional package builder creates and
production-verifies two independent real tar archives. They differ in entry bytes,
tools/schema, settings HTML/fields, version and data schema. Neither package is an
installed Chrome/WhatsApp artifact. `prepared.json` retains SHA256 and size for **every**
produced file/resource, package, driver, preload, runtime executable, metadata and
license; the receipt itself is not part of its own digest map. Treat that receipt as
reviewed evidence, retain it externally with the output, and do not edit it. Failed
preparation leaves its partial output; correct the cause and choose a new directory,
never rebuild over a prepared witness.

## Execution, explicitly offline

Run from that exact source checkout, with ambient `NODE_OPTIONS` unset. Use the
prepared shipped Node for the driver as well:

```sh
"$WITNESS_OUT/resources/plugin-node/node" scripts/frozen-supervisor-witness.mjs run "$WITNESS_OUT"
```

`run` never calls a builder, downloader, installer or native compiler. It refuses a
missing/wrong version or binary digest with a preparation-specific error and never
falls back to system Node. It checks all frozen inputs before and after the journey,
checks the durable runtime copy against every packaged runtime/host file, hashes the
content-addressed supervisor copy, checks the actual captured spawn executable and
argv, and retains the runtime id and spawn records. A test-only inherited preload
throws on fetch/HTTP/HTTPS/TLS/TCP connections, permitting local Unix sockets. Production
owner bytes are unchanged; the preload is separately hashed instrumentation.

Each execution allocates a new short `/tmp/fl-*` fictional global/workspace/data root;
there is no root-selection argument, live root discovery, credentials, plugin installs
in personal roots, GUI, provider or network access. The sequence is:

1. Launch through the real launcher, attach the real workspace lease/person client,
   and prove a second actual artifact process gets the owner's `busy` refusal.
2. Inspect/install v1 through the production local package selection and verifier,
   validate actual Settings cards, and invoke PageTools through real person frames
   and MCP. Write opaque bytes and one action record; assert a real protocol error.
3. Inspect/update v2. Its fictional runtime pauses during MCP initialize. Capture the
   durable prepared update effect and previous version/schema, prove v1's exact exit
   receipt and empty physical process group, then SIGKILL **the captured owner child**.
4. Prove the interrupted package process group is empty. The killed owner cannot write
   its own package exit receipt: no synthetic receipt is accepted for that run. Remove
   only the fixture gate and relaunch the same frozen artifact/root. Assert that the
   same pending operation becomes committed at v2, with the same installId, previous
   version/schema, changed tool and settings bytes, preserved data and no action replay.
   The fictional runtime additionally refuses startup if any earlier recorded runtime
   PID is still alive. Old page bindings, contribution handles and tool names fail.
5. Close person control and the last workspace lease; prove normal owner exit, stopped
   record, exact-run positive exit receipt and physical group absence. Relaunch once
   more, prove committed v2 recovery/no replay, uninstall through person control and
   assert `dataOnRemove: keep`, then prove final package and owner exits.

Evidence is appended in a new `run-*/result.json` below the prepared output, including
the exact source SHA/tree, resource map, runtime id/version, spawn argv and captured
run metadata. Failure writes `failure.json` and returns nonzero. All fictional roots
and evidence are retained on success and failure; the fixture never erases a root
with uncertain cleanup. A failed run may still hold captured processes until normal
lease expiry/drain; inspect the saved failure and owned process records before any
manual cleanup. No broad `pkill`, personal-root cleanup or speculative kill is part of
these instructions. To stop an active journey, retain its output and use its captured
owner process information; do not delete its guards while processes remain.

## Supported hosts and coverage

Shipped Node target metadata lists `darwin-arm64` and `win32-x64`. This command selects
the actual host and explicitly refuses Linux and the current Windows supervisor fence
limitation; it does not fake a shipped Linux target. It adds no default Vitest/CI glob,
deletes no test, and skips no existing coverage. Integrators can invoke these commands
in a separately authorized macOS arm64 job. Separate CI source wiring, Windows support
and all whole-Electron gates need their own integration ownership and evidence.
