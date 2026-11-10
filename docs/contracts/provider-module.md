# Provider module contract

Provider packages implement `ProviderModule<HostValues>` from
`@brobot2/runtime/provider-module`. This type-only entrypoint owns the complete bound operation
interfaces: runtime creation and prepared launches, home and auth operations, transcript and
knowledge policies, discovery, snapshots, skills, kept rules, and optional program services.
It imports no desktop code or IPC types and loads no native adapter at runtime.

The runtime package owns the canonical runtime events, sessions, authentication results,
program/version facts, kept-rule facts, and operation signatures. Providers keep native protocol
handling and their existing lifecycle requirements. A module with its own harness need not expose
an external executable or publish a version. `program` and `program.version` are optional; absent
version services produce `{ version: null, reason: ... }` in the desktop version collection, without
claiming an executable is missing or blocking a launch. Bound readers retain their receiver, cache,
registry ordering, and actual failures.

## Host-owned values

`ProviderHostValues` supplies the consuming host's value shapes. It does not replace whole policy
interfaces or weaken their method types. Its fields are:

- `event`: host transcript event extension, alongside the concrete canonical `RuntimeEvent`.
- `retentionCandidate`, `session`, `file`, `memoryNote`: the host's retained files and session rows.
- `childPart`, `childResult`, `turnAsked`, `turnAnswer`: the host's child-work and turn-read protocol.
- `discovery`, `protectedPlaceKind`: adoption results and the host's folder vocabulary.
- `instructionInputs`, `launchRead`, `instruction`, `origin`: launch composition
  inputs/results and instruction provenance values.
- `memoryStore`, `memoryPage`, `givenSkills`, `deferral`, `partSize`, `snapshot`: host read models.

The desktop specializes these fields once in `providers/desktop-values.ts`. Its existing import
surfaces remain compatible aliases to the runtime-owned operation interfaces. The host value DTOs
stay in their existing owners; this change does not move desktop persistence, transcript events,
IPC endpoints, or the provider registry. An external package can instead bind its own host value
protocol, as the fictional package consumer test does in an already registered provider slot.

This is a portable contract, not a new provider loader or registry. Connecting external packages
to a particular host still requires agreement on that host's value protocol. Existing shared
provider/connections dependencies and their separate cycle work remain unchanged.
