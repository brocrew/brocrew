# Plugin tool broker core

`createPluginToolBroker` in `apps/desktop/src/main/plugins/tool-broker.ts` is one in-memory broker for one verified plugin installation and operational epoch. It performs no transport, filesystem, process, provider, supervisor or home operation. The owner must construct only one executing broker for that installation; this module does not establish global ownership.

## Authority and integration

The authenticated owner supplies immutable installation identity, curated tool definitions/resource declarations, current policy, and a private server port. It retains `owner`, registers an already authenticated workspace, and mints an agent-incarnation capability. Every agent in every attached workspace receives the same discovery inventory; there is no per-agent tool allowlist. Granting the same live incarnation returns its existing handle. A revoked incarnation cannot be granted again under its old name.

Capabilities are opaque object identities in private WeakMaps, bound to workspace attachment, agent incarnation, installation and epoch. Labels, serialized copies, forged objects and handles from another broker grant nothing. The later authenticated wire adapter must bind its own scoped capabilities to these local handles; this core creates no network token. It must never expose the owner or person surface through an agent endpoint. Revocation/detachment cancels queued/active work. Invalidating the broker permanently denies its epoch; late success/proof never revives it.

Agent methods are `discover` and `call` only, with exact published qualified tool names. Resources/prompts are unsupported and absent. Person administration has a separate capability map check, exact operation inventory and server method; agent input cannot select that path. Admin requests use the same serial queue and data lock as tool calls.

Publication reuses `externalMcpNameRefusal` and `collidingToolNames` with host-supplied reserved/occupied inventories. Namespace is `plugin-<id>`; long catalogue IDs use a bounded readable prefix plus a SHA-256 suffix, then undergo the same collision checks. Both namespaces and qualified names are checked. Neither a bare tool name nor a caller-selected endpoint is authority.

## Resource boundary

Each curated tool requires a trusted `prepare` function: it validates/normalizes its arguments and names every resource/key/read-or-write effect that the operation may use. A global metadata-only tool may explicitly return an empty claim list. These bindings are reviewed host configuration, never accepted from a plugin reply or caller-supplied claims.

Before dispatch, the broker freezes copied normalized arguments/claims, checks claims against verified resource declarations and consults current person-selected read/write policy. `isAllowed` must be a synchronous pure lookup; only literal true allows a claim. There is no cached enqueue-time permission. Attachment validity and the queue deadline are checked again after preparation. No await or diagnostic callback intervenes between authorization and dispatch. The trusted transport/plugin must honor those admitted arguments and claims; the broker cannot sandbox curated Node code running with the person's rights.

## Queue and stopping

One executing request per broker. Waiting limits: 64 total, eight per workspace, two per agent/person incarnation; the executing request is separate from those waiting counts. Round-robin selection first chooses a workspace, then one of its agents/person callers. Cancelled/empty buckets are removed, and a returning busy caller cannot take a second consecutive turn while another caller is waiting.

Queue admission and execution each have a 120-second monotonic deadline. The default clock uses `performance.now`; tests inject a clock and do not sleep. Queued abort/expiry never reaches the server. An active abort, revocation or deadline answers the caller immediately, requests cancellation once and retains the execution slot. A successful cancellation request and a returned result are independently insufficient to release it.

The trusted transport supplies separate `result` and `quiescent` promises. Quiescence means that request and its streams have stopped, proved by the host/transport rather than asserted in a plugin payload. Normal completion requires both. Cancellation gives the transport a bounded one-second proof grace; no successor runs during it. Missing/rejected proof makes the plugin unavailable and rejects queued/new calls. Late proof may clear the retained slot, but cannot make that broker available again. A new broker/epoch requires the external owner to have repaired/proved the prior execution stopped. No process exit is inferred or implemented here.

A tool asking a person to act later must return a normal result and a genuine quiescence receipt; a waiting-status field by itself cannot release execution. No login/session wait is modelled by the core.

## Data and diagnostics

Inputs are copied strict JSON, at most 64 KiB; result data is copied/frozen strict JSON, at most 8 MiB to accommodate browser images. The later wire adapter must cap bytes before decoding too. It tags all transport/MCP errors as failed outcomes, never successful error payloads. The core is not a secret scanner for ordinary successful tool data.

Errors have closed internal codes and only the approved “Plugin unavailable. Try again.” / “Plugin busy. Try again.” messages. Raw exceptions, causes, stacks, identity labels, arguments, results, server credentials and resource keys are never sent to diagnostics. Optional audit events contain only a closed event/operation/code vocabulary and a queue count; audit failure cannot change the request result. The port owns any downstream credential privately; no credential field exists on the broker API.

## Verification

`pnpm exec vitest run --project desktop apps/desktop/test/plugin-tool-broker.test.ts` exercises an inert fake server and deterministic clock. No process, browser, provider, real token or filesystem state is involved. The fixtures cover reach, capability forgery/revocation/epoch boundaries, person-only admin, execution-time resource changes, immutable arguments, both fairness levels, all queue caps, abort/expiry, result-versus-proof separation, failed/late proof and secret-bearing upstream errors.

Host ownership, authentication probes, adapters, real server cancellation/exit receipts and UI/person admission remain separate integration gates under the main plugins contract.
