import { degradeEvent, parseRuntimeEvent, type RuntimeEvent } from '@brobot2/runtime'

/**
 * The main→renderer half of the boundary. Every event an adapter emits is
 * re-validated here before it crosses IPC, and made safe to send:
 *
 *  - a **malformed** event (an adapter bug) degrades to an `unknown` event rather
 *    than crashing the pump or reaching the renderer as a half-typed value;
 *  - an `unknown` event's `raw` is arbitrary provider data, and Electron sends it
 *    through the structured-clone algorithm — a value that cannot be cloned would
 *    otherwise throw inside `webContents.send`, killing the stream for a payload
 *    we only ever render as text. It is degraded to a cloneable projection instead.
 *
 * Validation also strips anything outside the schema, so only contract fields
 * cross to the renderer.
 *
 * ## ⛔ A degraded frame SAYS it was degraded (235, from 230 M3)
 *
 * The replacement above is the design — 235 kept it — but until 235 the replacement was an
 * ordinary-looking `unknown`. 230 H1 named exactly what that costs: *"a log that dropped
 * `tool_call` rows specifically, while still recording turns and messages, would be invisible to
 * them — and `snapshot().tools` reads the same list, so there is no third surface to ask."* A
 * regression that emitted a `tool_call` without its `summary` would be erased HERE, the assistant
 * message and the turn beside it would survive, and every surface would then agree that no tool was
 * called. {@link degradeEvent} is the third surface: it stamps what the frame claimed to be.
 *
 * ⚠️ **`wrapUnknown` is deliberately not used here any more.** It is for provider payloads the
 * adapter could not map — chatter, honestly labelled. This path is for OUR OWN events failing OUR
 * OWN schema, which is a bug on our side of the line, and the two must not arrive looking alike.
 */
export function toWireEvent(provider: string, event: RuntimeEvent): RuntimeEvent {
  // ⛔ **Through the shared parse, not `safeParse` directly** (235). Zod reads the discriminant off
  // the candidate to pick a union arm, and that read is not guarded — a throwing getter or a
  // revoked proxy escapes as an exception, out of this function and into the event pump. It is the
  // same hazard `toRuntimeEvent` has, so it is the same guard, in one place.
  const parsed = parseRuntimeEvent(event)
  if (!parsed.ok) {
    const degraded = degradeEvent(provider, event, toCloneable(event))
    // ⚠️ **085's rule: a degradation nobody logs is a silent one.** The ledger row is what an
    // instrument counts; this is what tells whoever is looking at a terminal that an adapter is
    // emitting frames the contract refuses. Per event, because it should never happen at all — no
    // shipped adapter path can emit a malformed `tool_call`, which is the variant 230 M3 is about
    // and the only one 235 measured (`tool-call-integrity.test.ts`) — so a stream of these is
    // itself the news.
    console.warn(
      `runtime wire: ${provider} emitted an event that failed the contract and was replaced by ` +
        `\`unknown\` — ${degraded.type === 'unknown' ? degraded.label : '?'}: ${parsed.reason}`,
    )
    return degraded
  }
  if (parsed.event.type === 'unknown')
    return { ...parsed.event, raw: toCloneable(parsed.event.raw) }
  return parsed.event
}

/**
 * The value if it survives structured cloning (Electron's own IPC serialization),
 * else its JSON projection (which drops functions), else a description. Never throws.
 */
function toCloneable(value: unknown): unknown {
  try {
    return structuredClone(value)
  } catch {
    // not cloneable — fall through to the JSON projection
  }
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return JSON.parse(json)
  } catch {
    // circular, throwing getter, or BigInt — fall through to the description
  }
  return `[unserializable ${typeof value}]`
}
