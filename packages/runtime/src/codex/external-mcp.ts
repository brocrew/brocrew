import { MAX_PERMISSION_DETAIL_CHARS } from '../events'
import type { ExternalMcpReach } from '../external-mcp'
import { wordsForACard } from '../words-on-a-card'
import type { KeptToolApproval } from './kept-tool-approvals'
import type { JsonValue } from './protocol/serde_json/JsonValue'

/**
 * 🔴 **Codex's half of the external-MCP asymmetry: servers declared IN THE PROTOCOL, as a
 * per-thread config overlay** (605, `HO-090` §1).
 *
 * ## ⛔ `516` said Codex had no door. It has three, and this is the one that writes no file
 *
 * `runtime.ts` said in as many words that `externalMcp` was *"the CLAUDE half only"* and that
 * *"the Codex adapter reads no such field"*, and `348` had already refused the route everybody
 * assumed was the only one: *"`[mcp_servers]` in the home's `config.toml` … that file has already
 * cost this project a hard parse failure (`-32600 duplicate key`) and a deleted `trust_level`; the
 * best outcome available was never to touch it."*
 *
 * ⚑ **`ThreadStartParams.config` is a per-thread configuration overlay, and `ThreadResumeParams`
 * carries the same field** — so a granted server is re-declared on every launch of the
 * conversation, from the store, and nothing is ever written into a file Codex co-owns. ⛔ **That is
 * the exact shape `348` found for `dynamicTools`**, one field over.
 *
 * ## ⚑ Measured against the bundled 0.146.0 binary before it was built — `probe:codex-external-mcp`
 *
 * Through an owned loopback Responses endpoint and a real streamable-HTTP MCP server on
 * `127.0.0.1`, so **no model account, no token and no spend** (§6.1's recipe, `581`'s shape):
 *
 * | arm | how the server was offered | the child's `mcpServerStatus/list` |
 * |---|---|---|
 * | **A · nested overlay** | `config: { mcp_servers: { x: { url } } }` | `x`, with its tool |
 * | **B · dotted overlay** | `config: { 'mcp_servers.x.url': url }` | `x`, with its tool |
 * | **C · home file** | `[mcp_servers.x]` in `config.toml` | `x`, with its tool |
 * | **D · control** | nothing offered | **empty** |
 *
 * ⚠️ **D is what makes A, B and C measurements.** `thread/start` accepts unknown params silently —
 * `348` measured `{brobotNotAField: "nonsense"}` accepted — so a call that succeeds is evidence of
 * nothing on its own.
 *
 * ⛔ **A is the one this uses**, because C writes the file `348` ruled against and B is the same
 * door spelled as the CLI's `-c` overrides: a flat key is one typo away from writing a top-level
 * `mcp_servers.x.url` string, and the nested form is what the protocol's own type describes.
 *
 * ## 🔴 How far reach was measured, and the line it STOPS at
 *
 * ⛔ **A server the app-server connected to whose tools never reach the model is a grant that does
 * nothing by a longer road** — so the probe went past the status list, and the answer has two
 * halves that must not be run together.
 *
 * ⚑ **What IS measured.** `mcpServer/tool/call` reaches the tool and it answers, so the plumbing
 * runs. The leaf is called as **`mcp__<server>__<tool>`** — the same `<server>__<tool>` shape
 * `tool-inventory.ts` measured on Claude — and `exec`'s model-visible instructions teach that
 * spelling in as many words (*"Tool names are exposed as normalized JavaScript identifiers, for
 * example `await tools.mcp__ologs__get_profile(...)`"*). ⚠️ So an agent that KNOWS the name can
 * call it. ⚑ Bundled 0.160.0 defers the tool: its name is nowhere in the model-bound turn (0.146.0
 * still carried it in the turn's API telemetry), and `exec`'s instructions add that a deferred tool
 * is *"still available on the global `tools` object and listed in `ALL_TOOLS`"*.
 *
 * 🔴 **What is measured to be ABSENT, and it is the half a reader will assume.** ⛔ **The server's
 * tools are not enumerated to the model.** `exec`'s catalogue lists every built-in nested tool
 * under its own `### <name>` heading; the granted server appears in NEITHER turn of a two-turn
 * arm — `inTheDeveloperMessage: false`, over the whole `input` the model receives. ⚑ The only
 * place the leaf occurs in the model-bound body is `client_metadata['x-codex-turn-metadata']`,
 * which is API telemetry and reaches no model.
 *
 * ⚠️ **Found by reviewing this dispatch's own diff**: a whole-body grep answered *the model sees
 * it* and the question it had actually answered was *the request mentions it somewhere* —
 * `a-negative-is-only-as-strong-as-the-search-shape`, in the positive direction.
 *
 * ⛔ **The bound on that negative**: one model family, through one loopback provider, on the
 * bundled 0.146.0 binary. ⚑ **A capture proves what the provider was given, never what a hosted
 * model was offered by a different route.** See `605`'s response — it is a finding, not a
 * settled property of Codex.
 *
 * ## ⚠️ What this does NOT carry, and each absence is a decision
 *
 * ⛔ **No `enabled_tools`.** It is the only tool filter the bundled binary has, it is an ALLOW list,
 * and this app holds no roster to build one from — `ExternalMcpServer` is *"two fields and no
 * third … no tool cache"* on purpose. ⚑ See {@link ExternalMcpReach.reservedToolNames} and this
 * dispatch's response for what that costs and what still guards it.
 *
 * ⛔ **No credential and no header.** Stage 1 is unauthenticated loopback only (`507` §8), which is
 * the registry's own bound and not this function's.
 */
export function codexExternalMcpConfig(
  reach: ExternalMcpReach | undefined,
  /**
   * 🔴 **736 · R95 — the *Always allow*s kept in this conversation's provider home**
   * (`kept-tool-approvals.ts`), put in the server's OWN table — `tools.<tool>.approval_mode =
   * "approve"`, where the Codex terminal keeps one — and only for a server this launch declares.
   */
  kept: readonly KeptToolApproval[] = [],
): Record<string, JsonValue> | undefined {
  // ⚑ **Absent and empty answer the same thing**, the rule {@link claudeMcpServersFor} is written
  // under: a launch that was granted nothing must send exactly what it sent before this existed.
  if (reach === undefined || reach.servers.length === 0) return undefined
  const servers: Record<string, JsonValue> = {}
  for (const one of reach.servers) {
    // ⚑ The name AND the address: a server registered again under this name elsewhere is another program.
    const always = kept.filter(
      (approval) => approval.server === one.name && approval.url === one.url,
    )
    servers[one.name] =
      always.length === 0
        ? { url: one.url }
        : {
            url: one.url,
            tools: Object.fromEntries(
              always.map((approval) => [approval.tool, { approval_mode: 'approve' }]),
            ),
          }
  }
  return { mcp_servers: servers }
}

/**
 * 🔴 **One `mcpServer/elicitation/request`, read off the wire** (605) — or `null` when the frame is
 * not one this app can present.
 *
 * ## ⛔ What the frame carries, MEASURED rather than read off the generated type
 *
 * `044`'s standing rule is that presence in a generated type is a SCHEMA verdict. Against the
 * bundled 0.146.0 binary, driven by a real streamable-HTTP MCP server and `mcpServer/tool/call`
 * (`probe:codex-external-mcp`, arm F):
 *
 * ```json
 * { "threadId": "01a0c170-2775-76c1-80c1-fa72b85c8874", "turnId": null,
 * "serverName": "brobotprobe", "mode": "form",
 *   "_meta": null, "message": "The 605 probe would like a word.",
 *   "requestedSchema": { "type": "object", "properties": { "confirm": { "type": "boolean",
 *     "title": "Go ahead?" } }, "required": ["confirm"] } }
 * ```
 *
 * ⚑ **`serverName` arrives and is not nullable — that is `HO-090` §3.1's second route.** `507` F2
 * had recorded it and nothing had ever used it.
 *
 * 🔴 **`turnId` is `null`, and the protocol says why**: *"MCP models elicitation as a standalone
 * server-to-client request … turn context is app-server correlation rather than part of the
 * protocol identity of the elicitation itself."* ⛔ **So the frame names the SERVER and nothing
 * smaller** — not the tool, not the call, and on this evidence not even the turn. ⚠️ **`720`
 * corrected the last clause**: this frame came from a tool call the CLIENT made outside any turn.
 * A MODEL's call inside a turn (`probe:codex-external-mcp` arms H–J, url mode) carried the bound
 * turn's id — still not the tool or the call, but the turn, which is what an elicitation Cancel
 * was addressed by from `720` (R74) until `736` (R97: the Cancel asks no stop of its own).
 *
 * ## ⚠️ And in `auto` it never arrives at all — measured, not reasoned
 *
 * ⛔ **Arm E ran the identical tool call under `approvalPolicy: 'never'` and the app-server
 * answered the elicitation ITSELF**: the MCP server's `elicitInput` returned `{action:"decline"}`
 * and no `mcpServer/elicitation/request` reached the client. ⚑ That is `HO-090` §2 — *the card
 * never appears in yolo* — measured on the wire rather than assumed, and it is a fact about the
 * PROVIDER rather than about this app's own `auto` handling.
 */
export interface CodexElicitation {
  /** ⛔ The one thing the frame names. Never composed, never guessed. */
  readonly serverName: string
  /** The server's own words. Shown as the server's, never as this app's. */
  readonly message: string
  /**
   * `form`, `openai/form`, `url`, or 0.160.0's `openaiForm` and `openai/userVerification` — the
   * discriminant that decides which card this can be. Only `form` has fields this app draws.
   */
  readonly mode: string
  /**
   * ⚑ **The page a `url` request asks the person to open**, exactly as the server sent it — or
   * absent: never on another mode, never composed, and never when it is longer than
   * {@link MAX_ELICITATION_URL} (a cut url is a wrong one), or carrying hidden characters. Shown as
   * the server's (provider follow-ups 1), and since W4.28 answered by a person's *I opened it*.
   */
  readonly url?: string
  /**
   * ⚑ **True when the server sent a link this app will not show** — longer than
   * {@link MAX_ELICITATION_URL}, or carrying control or direction-changing characters, which would
   * make the line a person copies differ from the one they read. The card says a link was withheld
   * rather than leaving no trace of it.
   */
  readonly urlWithheld?: true
  /** The form's fields in the order the server declared them; empty for a non-`form` mode. */
  readonly fields: readonly ElicitationField[]
}

/** One property of an elicitation's `requestedSchema`, kept with the key it is answered under. */
export interface ElicitationField {
  readonly key: string
  readonly schema: Record<string, unknown>
  /**
   * ⛔ **Whether the server listed this key in `requestedSchema.required`** (605, found reviewing
   * this dispatch's diff).
   *
   * 🔴 **It was read by nothing, and the cost was that every declared property became
   * mandatory.** `answerToForward` refuses a submission with any question unanswered or blank, so
   * a form with one required field and one optional one could not be submitted at all — the
   * person's only exit was declining the whole request. ⚠️ **The probe's own frame is that
   * shape**, which is how the defect reached a photograph.
   */
  readonly required: boolean
}

/**
 * ⚑ **What a person picks to leave an optional field alone**, spelled once — the card offers it
 * and {@link elicitationContent} reads it back, so the two cannot come apart.
 *
 * ⛔ **Only ever on a field the server did NOT require.** On a required one it would be a way to
 * submit a form the server will reject.
 */
export const SKIPPED = 'Leave this one out'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(from: Record<string, unknown>, key: string): string {
  const value = from[key]
  return typeof value === 'string' ? value : ''
}

/** The keys the server marked required; everything else may be left out. */
function requiredKeys(schema: unknown): Set<string> {
  const listed = isRecord(schema) ? schema['required'] : undefined
  return new Set(
    Array.isArray(listed) ? listed.filter((one): one is string => typeof one === 'string') : [],
  )
}

/** The longest server url carried whole; a longer one is not carried at all. */
export const MAX_ELICITATION_URL = 4096

/** Control and direction-changing characters: a line that holds one reads unlike what it copies. */
const HIDDEN_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- the control characters ARE the subject
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/

export function codexElicitation(params: unknown): CodexElicitation | null {
  if (!isRecord(params)) return null
  const serverName = readString(params, 'serverName')
  // ⛔ **No server name, no card.** The whole claim this surface makes is *which server asked*;
  // a frame that does not name one is one this app has nothing true to say about.
  if (serverName === '') return null
  const schema = params['requestedSchema']
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  const url = readString(params, 'mode') === 'url' ? readString(params, 'url').trim() : ''
  const shown = url !== '' && url.length <= MAX_ELICITATION_URL && !HIDDEN_CHARACTERS.test(url)
  return {
    serverName,
    message: readString(params, 'message'),
    mode: readString(params, 'mode'),
    ...(shown ? { url } : url !== '' ? { urlWithheld: true as const } : {}),
    // ⚠️ **Only a `form` has fields this app can draw.** `openai/form` carries an untyped
    // `requestedSchema` (`JsonValue`), and `url` carries no schema at all — see
    // {@link CodexSessionHandle.handleExternalMcpElicitation} for the card each of those gets.
    fields:
      readString(params, 'mode') === 'form'
        ? Object.entries(properties).flatMap(([key, one]) =>
            isRecord(one) ? [{ key, schema: one, required: requiredKeys(schema).has(key) }] : [],
          )
        : [],
  }
}

/**
 * ⛔ **The choices a field offers, each as the LABEL a person reads and the VALUE that goes back.**
 *
 * ⚠️ **They are not always the same string, and collapsing them is the defect this shape avoids.**
 * MCP's titled forms — `oneOf` for one choice, `anyOf` inside `items` for several — carry
 * `{const, title}`: the title is written for a person and the const is what the server parses.
 * ⚑ A card that sent the title back would answer a different question than the one it asked.
 */
function enumChoices(schema: Record<string, unknown>): { label: string; value: string }[] | null {
  const items = isRecord(schema['items']) ? schema['items'] : schema
  const bare = items['enum']
  if (Array.isArray(bare)) {
    const plain = bare.filter((one): one is string => typeof one === 'string')
    // ⚑ The legacy titled form puts the display strings in a PARALLEL array, so a missing or short
    // `enumNames` falls back to the value itself rather than to an empty label.
    const names = items['enumNames']
    return plain.map((value, index) => ({
      label:
        Array.isArray(names) && typeof names[index] === 'string' && names[index] !== ''
          ? names[index]
          : value,
      value,
    }))
  }
  const titled = items['oneOf'] ?? items['anyOf']
  if (!Array.isArray(titled)) return null
  const choices = titled.flatMap((one) => {
    if (!isRecord(one)) return []
    const value = readString(one, 'const')
    return value === '' ? [] : [{ label: readString(one, 'title') || value, value }]
  })
  return distinctLabels(choices)
}

/**
 * ⛔ **Two choices with the same title become two choices with their own values** (605, found
 * reviewing this dispatch's diff).
 *
 * 🔴 **An answer crosses the card boundary as a LABEL and nothing else.** So a server offering
 * `[{const:'prod-eu-1', title:'Production'}, {const:'prod-us-1', title:'Production'}]` drew two
 * identical options, and whichever the person clicked, the reverse lookup found the FIRST —
 * BroBot would have told them their answer was sent and the server would have acted on the other
 * region. ⚠️ `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`, on a set this
 * app does not author.
 *
 * ⚑ **The repair shows the value rather than refusing the card**: when titles collide, every
 * choice on that field is labelled with the value the server will actually receive. A person then
 * reads something less pretty and strictly more true, and no answer can mean two things.
 */
function distinctLabels(
  choices: { label: string; value: string }[],
): { label: string; value: string }[] {
  const seen = new Set(choices.map((choice) => choice.label))
  if (seen.size === choices.length) return choices
  return choices.map((choice) => ({ label: choice.value, value: choice.value }))
}

/** Whether this field takes several of its choices at once. */
function isMultiSelect(schema: Record<string, unknown>): boolean {
  return schema['type'] === 'array'
}

/**
 * 🔴 **The elicitation's form, as the questions BroBot already knows how to ask** (605).
 *
 * ## ⛔ Why `user_input_request` and not a new card
 *
 * ⚠️ `events.ts` already defines this event as *"a server-initiated request that is NOT a plain
 * command/file approval … surfaced (never silently dropped) and MUST be answered"*. ⚑ **An MCP
 * elicitation is exactly that**, and the `348` precedent is written down one file over: a dynamic
 * tool call publishes `kind: 'command'` *"because that is what a tool call already IS in this
 * vocabulary … no neutral enum had to be widened to get it."*
 *
 * ⛔ **So no event type is added, no discriminant is widened, and `UserInputCard` draws it** —
 * which also means criterion 20's per-answer line and `WHAT_COMES_AFTER_IS_NOT_OURS` come with it
 * rather than being written again for one provider.
 *
 * ## ⚠️ What each JSON type becomes, and why a free-form field is not an `Other`
 *
 * | the server declared | the question |
 * |---|---|
 * | `boolean` | two options, `Yes` and `No`, no free-form escape |
 * | `enum` / `oneOf` | those choices, no free-form escape |
 * | `array` of an enum | those choices, `multiSelect` |
 * | `string`, `number`, `integer` | no options at all, which IS the free-form field |
 *
 * ⛔ **`allowOther` is left FALSE on every one of them**, and that is deliberate: `answerToForward`
 * reads it as *this question accepts an answer that is not on the list*, and a server that
 * declared an enum will not parse one. ⚑ A field with no options is free-form by
 * `options.length === 0`, which that function already treats as the free case — see its own
 * comment, *"a question with no options offers no labels, so every member misses"*.
 */
export function elicitationQuestions(elicitation: CodexElicitation): {
  id: string
  prompt: string
  header?: string
  options: { label: string }[]
  multiSelect?: boolean
  description?: string
}[] {
  return elicitation.fields.map((field) => {
    // ⛔ **A boolean offers the two labels and nothing else.** `enumChoices` finds no list on one,
    // and an empty list is the FREE-FORM case downstream — so without this a `boolean` field
    // would have been asked as a text box and answered with whatever a person typed.
    const choices =
      field.schema['type'] === 'boolean'
        ? BOOLEAN_CHOICES.map((label) => ({ label, value: label }))
        : enumChoices(field.schema)
    const title = readString(field.schema, 'title')
    const description = readString(field.schema, 'description')
    // ⛔ **An OPTIONAL field gets a way to be left alone, and a required one never does.**
    // `answerToForward` refuses a submission with any question unanswered or blank, so without
    // this every property the server declared was mandatory and a form with one optional field
    // could not be submitted at all. ⚑ On a free-form field the escape rides beside the text box
    // (`allowOther`); on a list it is simply another choice.
    const offered = field.required
      ? (choices ?? [])
      : [{ label: SKIPPED, value: SKIPPED }, ...(choices ?? [])]
    return {
      id: field.key,
      // ⚑ **The server's own title, and the KEY when it wrote none** — never a sentence this app
      // composed about a field it has never seen.
      prompt: title || field.key,
      // ⚠️ **The key as the chip**, because it is the one string the answer is filed under and a
      // person reading the server's own docs will see it there.
      header: field.key,
      options: offered.map((choice) => ({ label: choice.label })),
      // ⚠️ **`allowOther` is TRUE only where the escape needs one to sit beside.** A free-form
      // field otherwise has `options.length === 1` — the escape alone — and `answerToForward`
      // reads that as *labels only*, which would refuse the very text the field exists to take.
      // ⛔ On a field that declared a list it stays FALSE: a server that declared an enum will
      // not parse a value outside it.
      ...(!field.required && choices === null ? { allowOther: true } : {}),
      ...(isMultiSelect(field.schema) ? { multiSelect: true } : {}),
      ...(description === '' ? {} : { description }),
    }
  })
}

/**
 * 🔴 **The person's answers, back in the JSON types the server asked for** (605) — or the reason
 * they cannot be.
 *
 * ⛔ **A card answers in strings and MCP asked for types.** `Yes` is not `true` and `"3"` is not
 * `3`; sending the string would hand the server a value its own schema rejects, and it would do
 * it after this app had told the person their answer was sent.
 *
 * ⚠️ **A number that will not parse is a REFUSAL, not a zero.** `answerToForward` already refuses
 * an empty or multiple answer; this is the one conversion that can fail on a well-formed one, and
 * `AnswerRefused` is how the card is kept open rather than spent (`141`'s HIGH 1: a refusal is not
 * a decline).
 */
export function elicitationContent(
  elicitation: CodexElicitation,
  approved: ReadonlyMap<string, readonly string[]>,
): { readonly content: Record<string, JsonValue> } | { readonly refusal: string } {
  // ⛔ **`Object.create(null)`, because the KEY is a SERVER-chosen property name** — `146`'s rule
  // on a new provider surface: `__proto__` is a legal JSON key, and on an ordinary object that
  // assignment sets the prototype instead of creating a property, so the server would receive an
  // empty form while BroBot recorded the question as answered.
  const content: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const field of elicitation.fields) {
    const chosen = approved.get(field.key)
    if (chosen === undefined || chosen.length === 0) continue
    // ⛔ **The key is OMITTED, which is what an optional field left alone means.** ⚠️ Never sent
    // as the sentinel string and never as an empty value: the server's schema says the property
    // may be absent, and absent is the only thing that says so.
    if (!field.required && chosen.length === 1 && chosen[0] === SKIPPED) continue
    const type = field.schema['type']
    if (type === 'boolean') {
      content[field.key] = chosen[0] === BOOLEAN_CHOICES[0]
      continue
    }
    if (type === 'number' || type === 'integer') {
      const parsed = Number(chosen[0])
      if (!Number.isFinite(parsed)) {
        return { refusal: `${field.key} takes a number and "${chosen[0]}" is not one` }
      }
      // ⛔ **`integer` is a different type from `number`, and the schema says which one it is.**
      // ⚠️ `1.5` in an `integer` field parses perfectly and is rejected by the SERVER, so without
      // this the person is told their answer was sent and the server answers an error nobody can
      // trace back to the field. ⚑ Same refusal, same reason: a value this app cannot state is
      // refused to the caller rather than declined to the provider (`141`'s HIGH 1).
      if (type === 'integer' && !Number.isInteger(parsed)) {
        return { refusal: `${field.key} takes a whole number and "${chosen[0]}" is not one` }
      }
      content[field.key] = parsed
      continue
    }
    const choices = enumChoices(field.schema)
    const valueOf = (label: string): string =>
      choices?.find((choice) => choice.label === label)?.value ?? label
    if (!isMultiSelect(field.schema)) {
      content[field.key] = valueOf(chosen[0] ?? '')
      continue
    }
    // ⛔ **An ARRAY carries its own member type, and the scalar branches above never see it**
    // (605, found reviewing this dispatch's diff). ⚠️ `{type:'array', items:{type:'number'}}`
    // fell through to a list of STRINGS, so a server that asked for `[1, 2]` received
    // `["1", "2"]` — the same lie the boolean branch exists to stop, one nesting level down.
    const members: JsonValue[] = []
    const memberType = isRecord(field.schema['items']) ? field.schema['items']['type'] : undefined
    for (const one of chosen) {
      if (memberType === 'boolean') {
        members.push(one === BOOLEAN_CHOICES[0])
        continue
      }
      if (memberType === 'number' || memberType === 'integer') {
        const parsed = Number(one)
        if (!Number.isFinite(parsed) || (memberType === 'integer' && !Number.isInteger(parsed))) {
          return { refusal: `${field.key} takes numbers and "${one}" is not one` }
        }
        members.push(parsed)
        continue
      }
      members.push(valueOf(one))
    }
    content[field.key] = members
  }
  return { content }
}

/**
 * ⛔ **The two labels a boolean field is asked with, spelled ONCE** — the card offers them and
 * {@link elicitationContent} reads them back, so the two cannot come apart.
 */
export const BOOLEAN_CHOICES = ['Yes', 'No'] as const

/**
 * 🔴 **What the card says about WHO is asking and what this app cannot tell you** (605,
 * `HO-090` §1.2 — *it admits the gap IN the card, visibly*).
 *
 * ## ⛔ The admission goes FIRST, and `414` is why
 *
 * ⚠️ **`414` ruled it on a message's sender and the shape is the same:** *"an attribution that
 * follows the words it attributes is a footnote."* ⚑ **And `593` measured what a footnote costs
 * on a desktop app** — a hover nobody performs is invisible and a keyboard never reaches it. So
 * this app's own sentence is the first thing read, and the server's words follow it, marked as
 * the server's.
 *
 * ## ⚑ It names the SERVER because the frame does, and nothing smaller because the frame does not
 *
 * ⛔ **Never a tool, never a call, never a guess** (`HO-090` §3.2). ⚠️ **And no clause claims this
 * app checked, verified or bounded anything** — it reports one field of one frame. ⚑ *"We can
 * prove what was SENT. We can never prove what was HEEDED"* cuts the other way too: this app did
 * not ask the server anything, and the sentence must not read as though it had.
 *
 * ## ⚠️ It spells a provider's name, and that is allowed HERE and nowhere downstream
 *
 * ⛔ **`039`'s rule is about the RENDERER** — *"if you find yourself writing `provider === 'claude'`
 * to decide whether to show something, the answer is a new entry"* in the capability table, and
 * `provider-neutrality.test.ts` holds the renderer to it. ⚑ **This is the Codex adapter**, the one
 * place that is entitled to know which provider's limitation it is describing, exactly as that
 * provider's own `externalMcpServers` entry is.
 */
export function externalMcpElicitationPrompt(elicitation: CodexElicitation): string {
  const admission =
    `${elicitation.serverName} is asking you something. Codex names the server and not the ` +
    `call, so BroCrew cannot tell you which of this server\u2019s tools you are answering for.`
  // ⚑ **A server that sent no message gets no empty quotation.** An absent sentence is not a
  // blank one, and drawing `brobotprobe says:` over nothing would invent a silence.
  return `${admission}${elicitationWords(elicitation)}`
}

/**
 * The server's own words for a card, after this app's admission: the page it asks the person to open,
 * then its message — each said as the SERVER's, and absent rather than blank (provider follow-ups 1).
 * ⛔ **The link comes FIRST** (W4.28 review): the card's text is bounded (`boundPermissionDetail`),
 * and a long message after a short admission could otherwise cut the very link *I opened it* is
 * about. A link is at most {@link MAX_ELICITATION_URL} characters, far under the bound.
 */
export function elicitationWords(elicitation: CodexElicitation): string {
  const said =
    elicitation.message === '' ? '' : `\n\n${elicitation.serverName} says: ${elicitation.message}`
  const link =
    elicitation.url !== undefined
      ? `\n\n${elicitation.serverName}’s link: ${elicitation.url}`
      : elicitation.urlWithheld === true
        ? `\n\n${elicitation.serverName} sent a link BroCrew does not show — too long, or with hidden characters in it.`
        : ''
  return `${link}${said}`
}

/**
 * Offer I opened it (`accept`) only for a URL request whose card displays the link. Exclude withheld links, `openai/form` and user-verification cards.
 */
export function opensALink(elicitation: CodexElicitation): boolean {
  return elicitation.mode === 'url' && elicitation.url !== undefined
}

/** `mcpServerAsks` for a card a server's own request raises — its name, and its url when it sent one. */
export function serverAsks(elicitation: CodexElicitation): { server: string; url?: string } {
  return {
    server: elicitation.serverName,
    ...(elicitation.url === undefined ? {} : { url: elicitation.url }),
  }
}

/**
 * ⚑ **The one approval kind this reads** — the `_meta.codex_approval_kind` Codex marks its own
 * approval of an external MCP tool call with (`probe:codex-mcp-tool-approval`, bundled 0.146.0).
 */
export const CODEX_TOOL_APPROVAL_KIND = 'mcp_tool_call'

/**
 * ⚑ **Codex's own question, as it asks it** — *"Allow the <server> MCP server to run tool
 * "<tool>"?"*, measured on the bundled 0.146.0 (`probe:codex-mcp-tool-approval`; the binary's
 * template is `Allow ` · the server's label · ` to run tool "` · the tool · `"?`).
 *
 * ⚠️ **The tool is named nowhere else in the frame**, so it is read out of this sentence, and only
 * when the sentence is about the server the frame names — never guessed from a looser match.
 */
const CODEX_TOOL_QUESTION = /^Allow the (.+) MCP server to run tool "(.+)"\?$/s

/** One parameter of a tool call, as Codex displays it — the name and the value, cleaned. */
export interface ToolParameter {
  readonly name: string
  readonly value: string
}

/**
 * 🔴 **723 · R80 — Codex asking a PERSON before an external MCP server's tool runs.**
 *
 * ⛔ **It arrives on the elicitation method and it is not the server's elicitation.** Measured by
 * `probe:codex-mcp-tool-approval` (bundled 0.146.0, BroBot's `ask` profile), before a model's call
 * to a granted server's tool:
 *
 * ```json
 * { "threadId": "…", "turnId": "<the bound turn>", "serverName": "brobot723", "mode": "form",
 *   "_meta": { "codex_approval_kind": "mcp_tool_call", "persist": ["session", "always"],
 *     "tool_description": "…", "tool_params": { "note": "one" },
 *     "tool_params_display": [{ "name": "note", "value": "one", "display_name": "note" }] },
 *   "message": "Allow the brobot723 MCP server to run tool \"note_it\"?",
 *   "requestedSchema": { "type": "object", "properties": {} } }
 * ```
 *
 * ⚠️ **A zero-field `form`** — the shape `142` §2 declines as *a question nobody asked*, which is how
 * `720` F-A found this app refusing every such call with no card, and Codex telling the model *"user
 * rejected MCP tool call"*. ⚑ R80: *"It is never declined silently again; `142` §2's silent decline
 * stays for a zero-field form that is NOT this kind."* ⚑ **`728` (R93) removed that decline too**: a
 * server's own zero-field form is shown, as the Codex CLI's own terminal UI shows it.
 */
export interface CodexToolApproval {
  /** ⛔ The server, as the frame names it. Never composed. */
  readonly serverName: string
  /**
   * The tool, as Codex's own question names it — raw, for matching the running call; `null` when the
   * question is not that sentence about that server.
   */
  readonly tool: string | null
  /** Codex's own question, whole. */
  readonly question: string
  /** `tool_params_display`, cleaned, inside {@link MAX_PERMISSION_DETAIL_CHARS}. */
  readonly parameters: readonly ToolParameter[]
  /** How many display parameters were left out to stay inside the bound. */
  readonly parametersOmitted: number
  /** ⚑ The call's own parameters (`tool_params`), whole — the disclosure. `undefined` when absent. */
  readonly toolParams: JsonValue | undefined
  /**
   * ⚑ **Whether Codex offers `persist: 'session'`** — its terminal's *Allow for this session*.
   */
  readonly offersSession: boolean
  /**
   * 🔴 **736 · R95 — whether Codex offers `persist: 'always'`** — its terminal's *Always allow*,
   * which the terminal keeps in the provider home's `config.toml` (`[mcp_servers.<server>.tools.
   * <tool>] approval_mode = "approve"`, measured in `736`'s scratch of the Codex terminal) and this
   * app keeps beside it, in the same home (`kept-tool-approvals.ts` says why not in that file).
   * ⛔ Until `736` never read: R80's *"a person's grant here never outlives the conversation"*,
   * which R95 withdrew.
   */
  readonly offersAlways: boolean
}

/** A display value: a string as it is, anything else as its JSON. */
function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? ''
}

/**
 * ⚑ **Codex's `tool_params_display`, as `{name, value}` a surface can draw** — each name the
 * parameter's display name (its own name where Codex gave none), each value cleaned by
 * {@link wordsForACard}, and the list cut at {@link MAX_PERMISSION_DETAIL_CHARS} with the count of
 * what was left out, never silently.
 *
 * ⛔ **A parameter this app cannot show WHOLE ends the list there, and is counted with the rest**
 * (`723`'s review): {@link wordsForACard} drops a string longer than the bound rather than cut it, and
 * the first draft turned that into `''` — a 70 KB `content` drawn as an empty one, with no count
 * beside it. ⚑ An entry that is not a `{name, value}` record is counted too; only the empty string
 * a server really sent is shown as empty.
 */
function displayedParameters(listed: unknown): { kept: ToolParameter[]; omitted: number } {
  const entries: unknown[] = Array.isArray(listed) ? listed : []
  const kept: ToolParameter[] = []
  let used = 0
  for (const [at, entry] of entries.entries()) {
    if (!isRecord(entry)) return { kept, omitted: entries.length - at }
    const shown = readString(entry, 'display_name') || readString(entry, 'name')
    const said = displayValue(entry['value'])
    const name = shown === '' ? '' : wordsForACard(shown)
    const value = said === '' ? '' : wordsForACard(said)
    if (name === null || value === null) return { kept, omitted: entries.length - at }
    used += name.length + value.length
    if (used > MAX_PERMISSION_DETAIL_CHARS) return { kept, omitted: entries.length - at }
    kept.push({ name, value })
  }
  return { kept, omitted: 0 }
}

/**
 * 🔴 **723 · R80 — read Codex's own approval of an external MCP tool call**, or `null` when the frame
 * is not one: another approval kind, another mode, a form that asks something, or no server name.
 *
 * ⛔ **Fail-closed toward the server.** A `null` here sends the frame to
 * {@link CodexSessionHandle.handleExternalMcpElicitation}'s other branches, which draw it as the
 * server's own request: since `728` (R93) a zero-field form is a card with Allow, as the Codex CLI
 * shows it; a form with fields is a question card; a url visit whose link is shown offers *I opened
 * it* (W4.28), and one withheld offers no way to allow. ⚠️ A frame
 * this DOES read can still be the server's — {@link McpCallsInFlight}'s residual.
 */
export function codexToolApproval(params: unknown): CodexToolApproval | null {
  if (!isRecord(params)) return null
  const meta = params['_meta']
  if (!isRecord(meta) || meta['codex_approval_kind'] !== CODEX_TOOL_APPROVAL_KIND) return null
  const serverName = readString(params, 'serverName')
  if (serverName === '' || readString(params, 'mode') !== 'form') return null
  // ⚠️ **A zero-field form, as measured.** One that asks something is a question with fields, and
  // accepting it with `{}` would answer none of them — so it is not read as this approval.
  const schema = params['requestedSchema']
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  if (Object.keys(properties).length > 0) return null
  const question = readString(params, 'message')
  const asked = CODEX_TOOL_QUESTION.exec(question)
  // ⚠️ **Raw, for matching** against Codex's own item ({@link McpCallsInFlight.claim}); the card
  // cleans what it draws.
  const tool = asked !== null && asked[1] === serverName ? (asked[2] ?? null) : null
  const { kept, omitted } = displayedParameters(meta['tool_params_display'])
  const persist = meta['persist']
  return {
    serverName,
    tool,
    question,
    parameters: kept,
    parametersOmitted: omitted,
    toolParams: 'tool_params' in meta ? (meta['tool_params'] as JsonValue) : undefined,
    offersSession: Array.isArray(persist) && persist.includes('session'),
    offersAlways: Array.isArray(persist) && persist.includes('always'),
  }
}

/**
 * ⚑ **A {@link CodexToolApproval} tied to the call it is about** — its tool is the one Codex's OWN
 * item names ({@link McpCallsInFlight.claim}), never a string read out of a question alone.
 */
export type ClaimedToolApproval = CodexToolApproval & { readonly tool: string }

/**
 * ⚑ **What Allow runs, whole** — the tool and every parameter it is given, as JSON: the shape of
 * the Codex agent-tool card's disclosure (`${tool} ${JSON.stringify(arguments)}`), for the same
 * reason. ⛔ Where Codex sent no parameters, the card says so rather than showing `{}`.
 */
export function codexToolApprovalDetail(approval: ClaimedToolApproval): string {
  const parameters =
    approval.toolParams === undefined
      ? '(Codex did not say which parameters)'
      : (JSON.stringify(approval.toolParams) ?? '(Codex did not say which parameters)')
  return `${approval.tool} ${parameters}`
}

/**
 * 🔴 **723 · which MCP tool calls are running, and which of them Codex has already asked about** —
 * what tells Codex's own approval from a server's form WEARING it.
 *
 * ## ⛔ The marker is not Codex's to keep — measured
 *
 * `probe:codex-mcp-tool-approval`'s `spoof` arm: a server's own zero-field form, sent with
 * `_meta.codex_approval_kind: 'mcp_tool_call'` and *"Allow the brobot723 MCP server to run tool
 * "delete_everything"?"*, reached this app **byte for byte** — the app-server passes a server's
 * `_meta` through. ⚠️ On the first draft of `723` that was a Codex tool-approval card, with Allow, for
 * a call the model never made (`723`'s review, r80-adapter-4). ⛔ So the marker alone proves nothing.
 *
 * ## ⚑ What does — measured on the same run
 *
 * The order Codex sends: `item/started` for the `mcpToolCall` (`inProgress`, naming its server and
 * tool), THEN its approval, and only once that is answered does the tool run — so any form the
 * SERVER sends comes after the approval, while the same item is still running. ⚑ **Codex asks once
 * per call, before it runs.** So a frame wearing the marker is Codex's only when a call to that server
 * and tool is running and has NOT been asked about — and not granted for the conversation, because
 * a granted tool is not asked about again (the `session` arm, `session-2`). Everything else wearing
 * it is the server's own form, and is drawn as one (`728`: shown, as the Codex CLI shows it).
 *
 * ⚠️ **What this cannot tell apart, stated** (`723` F-2's residual, MEASURED by `728`'s
 * `spoof-unasked` arm): a server's form wearing the marker, sent during a call Codex did NOT ask
 * about — a tool the server marks `readOnlyHint`, or `destructiveHint: false` with `openWorldHint:
 * false` (both measured to run with no ask; each hint ALONE is asked about) — looks exactly like
 * Codex's ask, and is drawn as one: its parameters shown as the call's, its message as Codex's
 * question. ⚠️ **Worded any way at all** (`728`'s review): a message naming that same tool claims
 * that call, and one that matches no Codex wording (`tool: null`) claims the server's ONLY unasked
 * running call — `723`'s fallback for a question in other words; `spoof-unasked` measures the first
 * variant. ⛔ **Nothing on the wire tells them
 * apart**: Codex's frame carries no call id, and every source of the tool's annotations is the
 * server's own word — `mcpServerStatus/list` opens a fresh session to the server and asks it again
 * (`605`'s evidence), so a server can say one thing to Codex and another to the list. `728` tried
 * the list and withdrew it in review for exactly that. ⚑ And two calls to one tool running at once
 * can be told apart only in the order Codex asks about them.
 */
export class McpCallsInFlight {
  /** Running `mcpToolCall` items by id — their server, tool, and whether Codex has asked yet. */
  private readonly running = new Map<string, { server: string; tool: string; asked: boolean }>()
  /** The tools this conversation granted for itself, in the order granted. */
  private readonly granted: { server: string; tool: string }[] = []

  /** Feed every turn-scoped notification; only an `mcpToolCall` item's start and end are read. */
  note(method: string, params: unknown): void {
    if (method !== 'item/started' && method !== 'item/completed') return
    const item = isRecord(params) ? params['item'] : undefined
    if (!isRecord(item) || item['type'] !== 'mcpToolCall') return
    const id = readString(item, 'id')
    if (id === '') return
    if (method === 'item/completed') {
      this.running.delete(id)
      return
    }
    this.running.set(id, {
      server: readString(item, 'server'),
      tool: readString(item, 'tool'),
      asked: false,
    })
  }

  /**
   * ⚑ **Claim the running call Codex is asking about**, and answer its tool — or `null` when no
   * running call can be it, which makes the frame a server's own form.
   *
   * ⛔ A question that names a tool must name the running call's; one Codex worded otherwise is
   * tied to its server's ONE unasked running call, and to none if there are several.
   */
  claim(server: string, tool: string | null): string | null {
    const unasked = [...this.running.values()].filter(
      (call) =>
        !call.asked &&
        call.server === server &&
        (tool === null || call.tool === tool) &&
        !this.isGranted(call.server, call.tool),
    )
    const call = tool === null && unasked.length !== 1 ? undefined : unasked[0]
    if (call === undefined) return null
    call.asked = true
    return call.tool
  }

  /** Record the conversation's grant of one tool — Codex will not ask about it again. */
  grant(server: string, tool: string): void {
    if (!this.isGranted(server, tool)) this.granted.push({ server, tool })
  }

  /**
   * ⚑ **The granted tools, by the name the model calls them** — `mcp__<server>__<tool>`, the leaf
   * `probe:codex-external-mcp` measured in the turn's registry — for `blanketGrants`.
   */
  get grants(): readonly string[] {
    return this.granted.map((one) => `mcp__${one.server}__${one.tool}`)
  }

  private isGranted(server: string, tool: string): boolean {
    return this.granted.some((one) => one.server === server && one.tool === tool)
  }
}
