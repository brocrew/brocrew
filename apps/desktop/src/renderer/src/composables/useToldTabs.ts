import { computed, ref, useId, type ComputedRef } from 'vue'
import { tabDestination } from '../lib/tab-destination'
import type { whoseGroups } from '../lib/whose-groups'

/** The told sheet's tab strip: one tab per owner, the landing tab, its picture, and arrow keys. */
export function useToldTabs(
  props: { readonly instructions: { readonly refused: readonly unknown[] } },
  grouped: ComputedRef<ReturnType<typeof whoseGroups>>,
) {
  /**
   * 🔴 **One tab per owner, and the last of them is the prompt itself** (583, relay 2).
   *
   * Group instruction owners into tabs with light text and visual summaries, and offer the final rendered input as sent.
   *
   * ⚠️ **Six headings stacked down one column is the same wall with rules drawn in it.** ⚑ A tab
   * shows one owner's rows and nothing else, so the page a person is on is always short — and
   * {@link AS_SENT} is the thing the sheet never had: the composed prompt, whole, on paper.
   */
  const AS_SENT = 'as-sent'
  /** Files the walk refused. They have no owner — nothing was read, so there is nothing whose. */
  const NOT_READ = 'not-read'

  /**
   * Which tab a person has PICKED — empty until they pick one.
   *
   * ⛔ **Empty rather than a default spelled twice.** {@link current} answers *which tab is on
   * screen* from the live list, so the landing tab is decided in one place and a selection that
   * stops existing falls back rather than drawing an empty sheet.
   */
  const tab = ref<string>('')

  /**
   * One tab: what it is called, how much is under it, and its share of what this sheet holds.
   *
   * ⚠️ **{@link Tab.count} counts LAYERS AND BLOCKS, which is not every element on the tab** (found
   * in review). The `not shown` tab also draws one row per file the provider reported, and those
   * are counted by their own layer's own count — so the badge says *three things named here* and
   * the layer under it says *two of them are files*. ⛔ A badge that summed both would count the
   * same files twice.
   */
  interface Tab {
    readonly key: string
    readonly label: string
    readonly count: number | null
    readonly bytes: number
  }

  /**
   * ⛔ **Derived from the groups, never typed** — a tab whose group is not drawn is not a tab, and
   * the two cannot come apart because there is one list.
   */
  const tabs = computed<Tab[]>(() => {
    const out: Tab[] = grouped.value.groups
      .filter((group) => group.drawn)
      .map((group) => ({
        key: group.whose,
        label: group.heading,
        count: group.layers.length + group.blocks.length,
        bytes: group.bytes,
      }))
    if (props.instructions.refused.length > 0) {
      out.push({
        key: NOT_READ,
        label: 'not read',
        count: props.instructions.refused.length,
        bytes: 0,
      })
    }
    out.push({ key: AS_SENT, label: 'as sent', count: null, bytes: 0 })
    return out
  })

  /**
   * ⚑ **The tab a person lands on: the first owner with something in it.**
   *
   * ⛔ **Not {@link AS_SENT}**, which is 2.5 KB of markdown — the wall this dispatch exists to take
   * down, restored as a default. ⚠️ It is one press away and it is the last tab, which is where a
   * *show me the whole thing* affordance belongs.
   */
  function firstTab(): string {
    return tabs.value[0]?.key ?? AS_SENT
  }

  /**
   * 🔴 **The tab actually on screen.**
   *
   * ⛔ **Resolved against the live list rather than trusted**, because the list moves under it: a
   * conversation's memory arriving makes `the agent's own` appear and nothing removes a tab, but a
   * host one build behind can send a shape where the selected owner has nothing in it. ⚠️ A
   * selection pointing at a tab that is not there would draw an empty sheet with no way back.
   */
  const current = computed(() =>
    tabs.value.some((one) => one.key === tab.value) ? tab.value : firstTab(),
  )

  /** The group the current tab is showing, or `null` on the two tabs that are not a group. */
  const showing = computed(
    () => grouped.value.groups.find((group) => group.whose === current.value) ?? null,
  )

  /**
   * ⚑ **A tab's share of what this app appended, as a percentage** — the one picture on this sheet.
   *
   * ⛔ **Of what this sheet HOLDS, and the caption says so beside itself.** The provider's own layer
   * is the largest part of a real prompt and has no size we can put in a bar; a bar that omitted it
   * while looking like the whole prompt would be `442` §2.1's false claim drawn rather than written.
   *
   * ⚠️ **`<1%` rather than `0%` for a group that has something** (found in review). `Math.round`
   * printed the same number and the same empty bar for a 40-byte file as for the group that holds
   * nothing at all, which is the one distinction this picture exists to make.
   */
  function share(bytes: number): string {
    const whole = grouped.value.held
    if (whole === 0 || bytes === 0) return '0%'
    const part = Math.round((bytes / whole) * 100)
    return part === 0 ? '<1%' : `${String(part)}%`
  }

  /** How wide to draw the fill. A group with something always draws a sliver. */
  function fill(bytes: number): string {
    const whole = grouped.value.held
    if (whole === 0 || bytes === 0) return '0%'
    return `${String(Math.max(1, Math.round((bytes / whole) * 100)))}%`
  }
  /** Whether the current tab's full membership sentence is open. One press, `356` §1's rule. */
  const whyGroup = ref(false)

  /**
   * ⚑ **Move to a tab, and close the sentence that belonged to the last one.**
   *
   * ⛔ **One `whyGroup` for all of them rather than a set keyed by tab**, because only one tab is on
   * screen: a set would remember a fold nobody can see and reopen it under a different heading.
   */
  function pick(key: string): void {
    tab.value = key
    whyGroup.value = false
  }

  /**
   * 🔴 **A `role="tablist"` PROMISES arrow keys, and a promise a control does not keep is worse
   * than a plainer control** (`a-custom-focus-trap-is-the-tab-order`, one pattern over).
   *
   * ⛔ **Roving tabindex with it**: the strip is ONE stop in the page's tab order and the arrows
   * move within it, which is what the role tells a screen reader to expect. ⚠️ Without both halves
   * the announcement and the behaviour disagree, and the one a person can check is the behaviour.
   */
  function steer(event: KeyboardEvent, at: number): void {
    const keys = tabs.value.map((one) => one.key)
    const keyPressed =
      event.key === 'ArrowDown' ? 'ArrowRight' : event.key === 'ArrowUp' ? 'ArrowLeft' : event.key
    const to = tabDestination(keyPressed, at, keys.length)
    if (to === null || to < 0) return
    event.preventDefault()
    const key = keys[to]
    if (key === undefined) return
    pick(key)
    // ⚑ **Focus follows selection**, which is the pattern's own default for a tablist whose panels
    // are already in the document — nothing is fetched, so there is no reason to make a person
    // press twice.
    strip.value?.querySelector<HTMLButtonElement>(`[data-cy="told-tab-${key}"]`)?.focus()
  }

  /** The strip itself, so {@link steer} can move focus inside it without a document-wide query. */
  const strip = ref<HTMLElement | null>(null)

  /**
   * ⚑ **Ids for the tab/panel pairing**, minted per mount — this component can be on screen beside
   * another copy of itself and two `id="told-tab"`s would make `aria-controls` ambiguous.
   */
  const tabId = useId()
  const panelId = useId()

  return {
    NOT_READ,
    tab,
    tabs,
    current,
    showing,
    share,
    fill,
    whyGroup,
    pick,
    steer,
    strip,
    tabId,
    panelId,
  }
}
