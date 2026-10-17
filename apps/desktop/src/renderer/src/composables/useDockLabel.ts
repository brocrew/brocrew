import { onMounted, ref, type Ref } from 'vue'
import {
  DOCK_LABEL_COLOURS,
  dockLabelName,
  type DockLabel,
  type DockLabelChange,
  type DockLabelColour,
} from '../../../shared/dock-label'

/** Said when the label can't be read or saved: the words Themes already uses. */
export const DOCK_LABEL_FAILED = "That didn't work. Try again."

/**
 * This workspace's Dock label (`shared/dock-label.ts`), as Settings shows it. Every change is
 * saved by the main process in the workspace's own data folder, and the icon is painted again.
 *
 * A reply never overwrites what was typed since its request went out, and a reply to an older
 * request doesn't replace what a newer one shows. A failure shows what the main process last
 * confirmed it saved (an older request may have saved after the label was last shown), keeps the
 * typed draft and says so in `statusLine`.
 */
export interface DockLabelSetting {
  readonly label: Ref<DockLabel | null>
  /** The name as typed so far, kept to what the band can show. */
  readonly typed: Ref<string>
  /** What a person is told when the label could not be read or saved; empty otherwise. */
  readonly statusLine: Ref<string>
  /** Keeps a typed name to capital letters and digits, as the band shows it. */
  enter(value: string): string
  /** Saves the typed name; an empty one goes back to the default. */
  saveName(): Promise<void>
  choose(colour: DockLabelColour): Promise<void>
  turn(on: boolean): Promise<void>
  /** The colour one step along the swatches from `colour`. */
  step(colour: DockLabelColour, by: 1 | -1): DockLabelColour
}

export function useDockLabel(bridge = window.api?.dockLabel): DockLabelSetting {
  const label = ref<DockLabel | null>(null)
  const typed = ref('')
  const statusLine = ref('')
  // Counts what was typed, and the requests sent: a reply is shown only if neither has moved.
  let draft = 0
  let sent = 0
  // What the main process last said it holds, and which request said so; and the newest request
  // that failed.
  let confirmed: DockLabel | null = null
  let confirmedBy = 0
  let failedAt = 0

  const apply = async (change: DockLabelChange): Promise<void> => {
    if (!bridge) return
    const mine = ++sent
    const typedBefore = draft
    try {
      const reply = await bridge.set(change)
      if (mine > confirmedBy) {
        confirmed = reply
        confirmedBy = mine
      }
      if (mine === sent) {
        label.value = reply
        statusLine.value = ''
        if (draft === typedBefore) typed.value = reply.name
      } else if (failedAt > mine && confirmedBy === mine) {
        // A newer request already failed: what this one saved is what the main process holds.
        label.value = reply
      }
    } catch (error) {
      console.warn('The Dock label could not be saved.', error)
      failedAt = Math.max(failedAt, mine)
      if (mine === sent) {
        statusLine.value = DOCK_LABEL_FAILED
        if (confirmed) label.value = confirmed
      }
    }
  }

  onMounted(async () => {
    const asked = sent
    try {
      const read = (await bridge?.read()) ?? null
      if (sent !== asked) return
      label.value = read
      if (read && confirmedBy === 0) confirmed = read
      if (read && draft === 0) typed.value = read.name
    } catch (error) {
      console.warn('The Dock label could not be read.', error)
      statusLine.value = DOCK_LABEL_FAILED
    }
  })

  return {
    label,
    typed,
    statusLine,
    enter: (value) => {
      draft++
      return (typed.value = dockLabelName(value))
    },
    saveName: async () => {
      if (!label.value || typed.value === label.value.name) return
      await apply({ name: typed.value === '' ? null : typed.value })
    },
    choose: (colour) => apply({ colour }),
    turn: (on) => apply({ on }),
    step: (colour, by) => {
      const at = DOCK_LABEL_COLOURS.findIndex((c) => c.id === colour)
      return DOCK_LABEL_COLOURS[(at + by + DOCK_LABEL_COLOURS.length) % DOCK_LABEL_COLOURS.length]!
        .id
    },
  }
}
