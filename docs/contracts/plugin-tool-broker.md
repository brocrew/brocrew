# Plugin tool broker core

`createPluginToolBroker` in `apps/desktop/src/main/plugins/tool-broker.ts` is one in-memory broker for one verified plugin installation and operational epoch. It performs no transport, filesystem, process, provider, supervisor or home operation. The owner must construct only one executing broker for that installation; this module does not establish global ownership.

## Authority and integration

The authenticated owner supplies immutable installation identity, curated tool definitions/resource declarations, current policy, and a private server port. It retains `owner`, registers an already authenticated workspace, and mints an agent-incarnation capability. Every agent in every attached workspace receives the same discovery inventory; there is no per-agent tool allowlist. Granting the same live incarnation returns its existing handle. A revoked incarnation cannot be granted again under its old name.

Capabilities are opaque object identities in private WeakMaps, bound to workspace attachment, agent incarnation, installation and epoch. Labels, serialized copies, forged objects and handles from another broker grant nothing. The later authenticated wire adapter must bind its own scoped capabilities to these local handles; this core creates no network token. It must never expose the owner surface through an agent endpoint. Revocation/detachment cancels that caller's running work. Invalidating the broker permanently denies its epoch; late success/proof never revives it.

Agent methods are `discover` and `call` only, with exact published qualified tool names. Resources/prompts are unsupported and absent.

Publication reuses `externalMcpNameRefusal` and `collidingToolNames` with host-supplied reserved/occupied inventories. Namespace is `plugin-<id>`; long catalogue IDs use a bounded readable prefix plus a SHA-256 suffix, then undergo the same collision checks. Both namespaces and qualified names are checked. Neither a bare tool name nor a caller-selected endpoint is authority.

## Resource boundary

Each curated tool requires a trusted `prepare` function: it validates/normalizes its arguments and names every resource/key/read-or-write effect that the operation may use. A global metadata-only tool may explicitly return an empty claim list. These bindings are reviewed host configuration, never accepted from a plugin reply or caller-supplied claims.

Before dispatch, the broker freezes copied normalized arguments/claims, checks claims against verified resource declarations and consults current person-selected read/write policy. `isAllowed` must be a synchronous pure lookup; only literal true allows a claim. There is no cached enqueue-time permission. Attachment validity is checked again after preparation. No await or diagnostic callback intervenes between authorization and dispatch. The trusted transport/plugin must honor those admitted arguments and claims; the broker cannot sandbox curated Node code running with the person's rights.

## Running and stopping

Every admitted request starts at once, each on its own transport connection, so one slow or hung call never delays another caller in any workspace. The plugin orders its own work, for example per browser tab or profile. Limit: 64 in flight, counting running requests plus requests whose completion is unknown; beyond it a call is refused as busy. The broker keeps no timers: the transport owns call timeouts.

An abort, revocation, detachment or invalidation answers that caller immediately and requests cancellation once. The trusted transport supplies separate `result` and `quiescent` promises. Quiescence means that request and its streams have stopped, proved by the host/transport rather than asserted in a plugin payload. Normal completion requires both. A call that ends without proof (cancelled, failed, or with rejected proof) is retained as completion unknown and keeps counting toward the limit until it proves quiescence or its exact host exits; other calls keep running. A malformed execution contract makes the plugin unavailable and stops every running call. Late proof may clear a retained call, but cannot make an invalidated broker available again. A new broker/epoch requires the external owner to have repaired/proved the prior execution stopped. No process exit is inferred or implemented here.

A tool asking a person to act later must return a normal result and a genuine quiescence receipt; a waiting-status field by itself does not complete the call. No login/session wait is modelled by the core.

## Data and diagnostics

Inputs are copied strict JSON, at most 64 KiB; result data is copied/frozen strict JSON, at most 8 MiB to accommodate browser images. The later wire adapter must cap bytes before decoding too. It tags all transport/MCP errors as failed outcomes, never successful error payloads. The core is not a secret scanner for ordinary successful tool data.

Errors have closed internal codes and only the approved “Plugin unavailable. Try again.” / “Plugin busy. Try again.” messages. Raw exceptions, causes, stacks, identity labels, arguments, results, server credentials and resource keys are never sent to diagnostics. Optional audit events contain only a closed event/code/reason vocabulary; audit failure cannot change the request result. The port owns any downstream credential privately; no credential field exists on the broker API.

## Verification

`pnpm exec vitest run --project desktop apps/desktop/test/plugin-tool-broker.test.ts` exercises an inert fake server. No process, browser, provider, real token or filesystem state is involved. The fixtures cover reach, capability forgery/revocation/epoch boundaries, execution-time resource changes, immutable arguments, parallel calls that a hung call never delays, the in-flight cap, abort, result-versus-proof separation, failed/late proof and secret-bearing upstream errors.

Host ownership, authentication probes, adapters, real server cancellation/exit receipts and UI/person admission remain separate integration gates under the main plugins contract.


Tool failures go to the calling process's log: `logs/brocrew.log` for the app or `service.log` in the plugin root for the separate service. Settings > General > Debug mode shows both paths. Each line records the host-owned plugin ID, a fixed failure-reason code and, when known, the failing stage, cause, correlation ID and real error message. Both admission refusals and failures after dispatch are logged. Proof rejection and cancellation failure are distinct. Logging never changes execution or ownership. See [Logging](../logging.md) for detail and rotation settings.
