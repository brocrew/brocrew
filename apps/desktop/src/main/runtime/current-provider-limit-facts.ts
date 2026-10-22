import type { RuntimeEvent } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { LedgerWalk } from '../../shared/questions'
import {
  PROVIDER_WALL_LOOKBACK_MS,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../../shared/provider-limit'
import type {
  ConversationProviderBlock,
  LastKnownProviderBlock,
  ProviderLimitHoldReason,
} from '../../shared/runtime-ipc'

export type CurrentFact<T> =
  { readonly status: 'current'; readonly value: T | null } | { readonly status: 'unavailable' }

type Wall = Pick<ProviderLimitSeen, 'window' | 'standing' | 'resetsAt' | 'at' | 'account'>
type Prepared = {
  readonly at: number
  readonly complete: boolean
  readonly walls: ReadonlyMap<Provider, readonly Wall[]>
  readonly expires: readonly {
    readonly provider: Provider
    readonly wall: Wall
    readonly at: number
  }[]
}
type Episode = {
  readonly life: object
  readonly provider: Provider
  readonly known: boolean
  readonly wall?: Wall
  readonly confirmed?: boolean
  readonly awaitingEnding?: boolean
  readonly historyCaptured?: boolean
}

type History = {
  readonly life: object
  readonly provider: Provider
  readonly account: string | null
  readonly wall: Wall
  readonly value: LastKnownProviderBlock
  readonly confirmedThrough: number
}

const UNKNOWN_HISTORY_MS = 5 * 60_000
const HISTORY_LIMIT = 2_048

const unavailable = { status: 'unavailable' } as const
const clear = { status: 'current', value: null } as const

const matchesAccount = (wall: Wall, account: string | null) =>
  account === null || wall.account === undefined || wall.account === account

function standingWall(walls: readonly Wall[] | undefined, window: string, account: string | null) {
  let held: Wall | undefined
  for (const wall of walls ?? []) {
    if (wall.window !== window || !matchesAccount(wall, account)) continue
    if (
      held === undefined ||
      (held.standing !== 'stopped' && wall.standing === 'stopped') ||
      (held.standing === wall.standing && wall.at > held.at)
    )
      held = wall
  }
  return held
}

/** Display evidence only. Admission uses the host's account-aware limits gate. */
export class CurrentProviderLimitFacts {
  private prepared: Prepared | null = null
  private preparedKey: string | null = null
  private readonly expired = new Set<Wall>()
  private readonly episodes = new Map<string, Episode>()
  private readonly accounts = new Map<
    string,
    { readonly life: object; readonly account: string | null }
  >()
  private readonly history = new Map<string, History>()
  private historyClock: number | null = null
  private readonly gates = new Map<
    Provider,
    { readonly at: number; readonly until: number | null }
  >()

  begin(
    conversation: string,
    life: object,
    provider: Provider,
    fresh: boolean,
    account: string | null = null,
  ): void {
    this.history.delete(conversation)
    this.episodes.set(conversation, { life, provider, known: fresh })
    this.accounts.set(conversation, { life, account })
  }

  bindAccount(conversation: string, life: object, account: string | null): void {
    const episode = this.episodes.get(conversation)
    if (episode?.life !== life) return
    if (this.accounts.get(conversation)?.account !== account) {
      this.history.delete(conversation)
      this.episodes.set(conversation, { ...episode, confirmed: false, historyCaptured: false })
    }
    this.accounts.set(conversation, { life, account })
  }

  forget(conversation: string): void {
    this.episodes.delete(conversation)
    this.accounts.delete(conversation)
    this.history.delete(conversation)
  }

  invalidate(): void {
    this.prepared = null
    this.preparedKey = null
    this.gates.clear()
  }

  prepare(
    walk: LedgerWalk<ProviderLimitSeen>,
    at: number,
    confirmationFinished: number | (() => number) = at,
  ): boolean {
    if (
      !Number.isFinite(at) ||
      walk.walk === 'no-ledger' ||
      walk.rows.length > 2_048 ||
      walk.rows.some(
        (row) =>
          !Number.isFinite(row.at) || (row.resetsAt !== null && !Number.isFinite(row.resetsAt)),
      )
    ) {
      this.invalidate()
      return true
    }
    const key = JSON.stringify({
      complete: walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0,
      rows: walk.rows.map(({ provider, window, standing, resetsAt, at, account }) => ({
        provider,
        window,
        standing,
        resetsAt,
        at,
        account,
      })),
    })
    const changed =
      key !== this.preparedKey || this.expired.size > 0 || at < (this.prepared?.at ?? at)
    const captured: string[] = []
    this.preparedKey = key
    const walls = new Map<Provider, Wall[]>()
    const expires: { provider: Provider; wall: Wall; at: number }[] = []
    for (const row of walk.rows) {
      const wall = Object.freeze({
        window: row.window,
        standing: row.standing,
        resetsAt: row.resetsAt,
        at: row.at,
        ...(row.account === undefined ? {} : { account: row.account }),
      })
      const held = walls.get(row.provider) ?? []
      held.push(wall)
      walls.set(row.provider, held)
      const until = row.resetsAt ?? row.at + PROVIDER_WALL_LOOKBACK_MS
      expires.push({ provider: row.provider, wall, at: until })
    }
    this.expired.clear()
    this.prepared = {
      at,
      complete: walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0,
      walls,
      expires,
    }
    if (this.prepared.complete) {
      for (const [conversation, episode] of this.episodes) {
        if (episode.wall === undefined || episode.wall.at > at) continue
        const account = this.accounts.get(conversation)?.account ?? null
        const standing = standingWall(walls.get(episode.provider), episode.wall.window, account)
        if (standing?.standing === 'stopped' && standing.at >= episode.wall.at) {
          this.episodes.set(conversation, { ...episode, confirmed: true, historyCaptured: true })
          if (
            episode.historyCaptured !== true &&
            (standing.resetsAt === null || standing.resetsAt > at) &&
            standing.at + PROVIDER_WALL_LOOKBACK_MS > at
          ) {
            if (this.history.size >= HISTORY_LIMIT)
              this.history.delete(this.history.keys().next().value!)
            this.history.set(conversation, {
              life: episode.life,
              provider: episode.provider,
              account,
              wall: standing,
              confirmedThrough: at,
              value: Object.freeze({
                provider: episode.provider,
                resetsAt: standing.resetsAt,
                asOf: at,
              }),
            })
            captured.push(conversation)
          }
        } else if (episode.confirmed === true && standing?.standing !== 'stopped') {
          this.history.delete(conversation)
          this.episodes.set(conversation, {
            life: episode.life,
            provider: episode.provider,
            known: true,
          })
        }
      }
    }
    const finished =
      typeof confirmationFinished === 'function' ? confirmationFinished() : confirmationFinished
    for (const conversation of captured) {
      const history = this.history.get(conversation)
      if (history === undefined) continue
      if (
        !Number.isFinite(finished) ||
        finished < at ||
        (history.value.resetsAt !== null && history.value.resetsAt <= finished) ||
        history.wall.at + PROVIDER_WALL_LOOKBACK_MS <= finished
      )
        this.history.delete(conversation)
      else this.history.set(conversation, { ...history, confirmedThrough: finished })
    }
    return changed
  }

  observe(
    conversation: string,
    life: object,
    provider: Provider,
    event: RuntimeEvent,
    at: number,
  ): boolean {
    const before = this.episodes.get(conversation)
    const previousHistory = this.history.get(conversation)
    this.observeEvent(conversation, life, provider, event, at)
    const after = this.episodes.get(conversation)
    const historical = this.history.get(conversation)
    if (
      historical !== undefined &&
      (after?.life !== historical.life ||
        after.provider !== historical.provider ||
        after.wall === undefined ||
        after.wall.window !== historical.wall.window ||
        after.wall.at > historical.wall.at)
    )
      this.history.delete(conversation)
    return (
      previousHistory !== this.history.get(conversation) ||
      before?.known !== after?.known ||
      before?.awaitingEnding !== after?.awaitingEnding ||
      JSON.stringify(before?.wall) !== JSON.stringify(after?.wall)
    )
  }

  private observeEvent(
    conversation: string,
    life: object,
    provider: Provider,
    event: RuntimeEvent,
    at: number,
  ): void {
    const episode = this.episodes.get(conversation)
    if (episode?.life !== life) return
    if (event.type === 'conversation_reset') {
      this.episodes.set(conversation, { life, provider, known: false })
      return
    }
    if (event.type === 'error') {
      const wall = readProviderLimit(event.message, at)
      if (wall?.provider === provider && wall.standing === 'stopped') {
        this.episodes.set(conversation, { life, provider, known: true, wall, awaitingEnding: true })
      } else if (wall === null && event.fatal && episode.wall !== undefined) {
        this.episodes.set(conversation, { life, provider, known: true })
      }
      return
    }
    if (event.type === 'turn') {
      if (event.limit?.provider === provider) {
        const window = event.limit.window ?? ''
        const earlier = episode.wall
        const wall = {
          window,
          resetsAt: event.limit.resetsAt ?? null,
          standing: 'stopped' as const,
          at: earlier !== undefined && earlier.window === window ? earlier.at : at,
        }
        const same = earlier?.at === wall.at && earlier.window === wall.window
        this.episodes.set(conversation, {
          life,
          provider,
          known: true,
          wall,
          ...(same && episode.historyCaptured === true ? { historyCaptured: true } : {}),
          ...(same && episode.confirmed === true ? { confirmed: true } : {}),
        })
      } else if (event.state === 'failed' && episode.awaitingEnding === true) {
        this.episodes.set(conversation, { ...episode, awaitingEnding: false })
      } else if (event.wordOf !== 'this-app') {
        this.episodes.set(conversation, { life, provider, known: true })
      }
      return
    }
    if (event.type === 'provider_limit_clear') {
      if (
        episode.wall === undefined ||
        event.window === episode.wall.window ||
        event.window === ''
      ) {
        this.episodes.set(conversation, { life, provider, known: true })
      }
      return
    }
    if (
      event.type === 'provider_turn' ||
      (event.type === 'assistant_delta' && event.text.length > 0) ||
      (event.type === 'assistant_message' &&
        event.parentToolCallId === undefined &&
        event.text.length > 0) ||
      (event.type === 'tool_call' && event.parentToolCallId === undefined)
    ) {
      this.episodes.set(conversation, { life, provider, known: true })
    }
  }

  signInChanged(conversations: readonly string[]): void {
    this.invalidate()
    this.retireHistory(conversations)
    for (const conversation of conversations) {
      const episode = this.episodes.get(conversation)
      if (episode !== undefined)
        this.episodes.set(conversation, {
          life: episode.life,
          provider: episode.provider,
          known: false,
        })
    }
  }

  gate(provider: Provider, until: number | null, at: number): boolean {
    const before = this.gates.get(provider)
    this.gates.set(provider, { at, until })
    return before === undefined || before.until !== until || at < before.at
  }

  expire(now: number): void {
    if (!Number.isFinite(now) || (this.historyClock !== null && now < this.historyClock))
      this.history.clear()
    if (Number.isFinite(now)) this.historyClock = now
    for (const { wall, at } of this.prepared?.expires ?? []) {
      if (!Number.isFinite(now) || now < this.prepared!.at || now >= at) this.expired.add(wall)
    }
    for (const [provider, gate] of this.gates) {
      if (!Number.isFinite(now) || now < gate.at || (gate.until !== null && now >= gate.until))
        this.gates.delete(provider)
    }
    for (const [conversation, history] of this.history) {
      const deadline = history.value.resetsAt ?? history.value.asOf + UNKNOWN_HISTORY_MS
      if (!Number.isFinite(now) || now < history.value.asOf || now >= deadline)
        this.history.delete(conversation)
    }
  }

  nextChange(now: number): number | null {
    const instants = [
      ...(this.prepared?.expires.map(({ at }) => at) ?? []),
      ...[...this.gates.values()].flatMap((gate) => (gate.until === null ? [] : [gate.until])),
      ...[...this.history.values()].map(
        (history) => history.value.resetsAt ?? history.value.asOf + UNKNOWN_HISTORY_MS,
      ),
    ].filter((at) => at > now)
    return instants.length === 0 ? null : Math.min(...instants)
  }

  /** Each deadline can retire only the historical value that supplied it. */
  historyExpirations(): readonly {
    readonly value: LastKnownProviderBlock
    readonly at: number
    readonly retire: () => void
  }[] {
    return [...this.history].map(([conversation, history]) => ({
      value: history.value,
      at: history.value.resetsAt ?? history.value.asOf + UNKNOWN_HISTORY_MS,
      retire: () => {
        if (this.history.get(conversation) === history) this.history.delete(conversation)
      },
    }))
  }

  retireHistory(conversations?: readonly string[]): void {
    if (conversations === undefined) this.history.clear()
    else for (const conversation of conversations) this.history.delete(conversation)
  }

  /** Newer complete canonical evidence may withdraw history without preparing a current fact. */
  retireUnsupportedHistory(
    walk: LedgerWalk<ProviderLimitSeen>,
    pinStartedAt: number,
    evaluatedAt: number,
  ): boolean {
    if (
      walk.walk === 'no-ledger' ||
      walk.rowsUnread !== 0 ||
      (walk.ledgersSkipped ?? 0) !== 0 ||
      walk.rows.length > 2_048 ||
      !Number.isFinite(pinStartedAt) ||
      !Number.isFinite(evaluatedAt) ||
      pinStartedAt > evaluatedAt ||
      walk.rows.some(
        (row) =>
          !Number.isFinite(row.at) || (row.resetsAt !== null && !Number.isFinite(row.resetsAt)),
      )
    )
      return false
    let changed = false
    for (const [conversation, history] of this.history) {
      if (pinStartedAt <= history.confirmedThrough) continue
      const supported = walk.rows.some(
        (row) =>
          row.provider === history.provider &&
          matchesAccount(row, history.account) &&
          row.window === history.wall.window &&
          row.standing === 'stopped' &&
          row.at >= history.wall.at,
      )
      if (!supported) {
        this.history.delete(conversation)
        changed = true
      }
    }
    return changed
  }

  lastKnown(
    conversation: string,
    life: object | null,
    provider: Provider | undefined,
    active: boolean,
    now: number,
  ): LastKnownProviderBlock | null {
    this.expire(now)
    const history = this.history.get(conversation)
    if (active || history?.life !== life || history?.provider !== provider) return null
    return history?.value ?? null
  }

  hold(
    provider: Provider,
    aPersonsOwn: boolean,
    now: number,
    account: string | null = null,
  ): CurrentFact<ProviderLimitHoldReason> {
    if (aPersonsOwn) return clear
    this.expire(now)
    const gate = this.gates.get(provider)
    if (gate === undefined || !Number.isFinite(now) || now < gate.at) return unavailable
    if (gate.until === null) return clear
    if (gate.until <= now) return unavailable
    if (account !== null) {
      const prepared = this.ready(provider, now, account)
      if (prepared === null || !prepared.complete) return unavailable
      let until: number | null = null
      for (const wall of prepared.walls.get(provider) ?? []) {
        if (wall.standing !== 'stopped' || !matchesAccount(wall, account)) continue
        if (wall.resetsAt !== null && wall.resetsAt > now)
          until = Math.max(until ?? wall.resetsAt, wall.resetsAt)
      }
      return until === null
        ? clear
        : { status: 'current', value: { is: 'provider-limit', provider, resetsAt: until } }
    }
    return { status: 'current', value: { is: 'provider-limit', provider, resetsAt: gate.until } }
  }

  hasStoppedEpisode(conversation: string, life: object | null, provider: Provider): boolean {
    const episode = this.episodes.get(conversation)
    return (
      life !== null &&
      episode?.life === life &&
      episode.provider === provider &&
      episode.wall !== undefined
    )
  }

  block(
    conversation: string,
    life: object | null,
    provider: Provider,
    active: boolean,
    automaticWordsWait: boolean,
    now: number,
  ): CurrentFact<ConversationProviderBlock> {
    if (active) return clear
    const account = this.accounts.get(conversation)?.account ?? null
    const hold = automaticWordsWait ? this.hold(provider, false, now, account) : clear
    if (hold.status === 'current' && hold.value !== null) {
      return { status: 'current', value: { provider, resetsAt: hold.value.resetsAt } }
    }
    const episode = this.episodes.get(conversation)
    if (life === null || episode?.life !== life || episode.provider !== provider) return clear
    if (episode.wall === undefined) return clear
    if (!episode.known) return unavailable
    const prepared = this.ready(provider, now, account, episode.wall.window)
    if (prepared === null || !prepared.complete || prepared.at < episode.wall.at) return unavailable
    const wall = standingWall(prepared.walls.get(provider), episode.wall.window, account)
    if (wall?.standing !== 'stopped') return episode.confirmed === true ? clear : unavailable
    if (wall.at < episode.wall.at) return unavailable
    return { status: 'current', value: { provider, resetsAt: wall.resetsAt } }
  }

  private ready(
    provider: Provider,
    now: number,
    account: string | null,
    window?: string,
  ): Prepared | null {
    this.expire(now)
    const prepared = this.prepared
    if (
      prepared === null ||
      !Number.isFinite(now) ||
      now < prepared.at ||
      prepared.expires.some(
        (expiry) =>
          expiry.provider === provider &&
          matchesAccount(expiry.wall, account) &&
          (window === undefined || expiry.wall.window === window) &&
          this.expired.has(expiry.wall),
      )
    )
      return null
    return prepared
  }
}
