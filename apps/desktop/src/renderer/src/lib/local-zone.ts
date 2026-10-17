import { shallowRef } from 'vue'
import { readLocalTimeFrom, type LocalZone } from '../../../shared/local-time'

/**
 * # 🔴 D-031 · the Mac's time zone, in the window
 *
 * ⚑ **The window cannot read the Mac's zone file, so main hands over the zone it read**
 * (`app:local-zone`) and each one it reads after a move (`app:local-zone-moved`); every time the
 * window draws asks `shared/local-time.ts`, which reads it here. ⚑ A reactive copy: whatever drew a
 * time read it, so a move redraws every time on screen.
 */
const zone = shallowRef<LocalZone | null>(null)

/**
 * ⚑ **Ask main for the Mac's zone, and keep it** — `main.ts` waits for this before the app mounts,
 * so the first paint already says every time as the menu bar does.
 *
 * ⚑ **Subscribed BEFORE it asks**: one ordered pipe, so a move sent before the answer is superseded
 * by it, and one sent after arrives after it. ⚑ Unbounded, unlike the drafts' ask: main answers
 * from what it holds, and reads no file to answer. ⚠️ No bridge, a bridge without these doors (a
 * dev reload can run the preload built before them), or a refused ask, leaves the runtime's own
 * zone data — main's own fallback, and nothing a person could act on. ⛔ It never throws: the app
 * mounts after it.
 */
export async function keepTheMacZone(
  bridge: Pick<Window['api'], 'localZone' | 'onLocalZone'> | undefined,
): Promise<void> {
  readLocalTimeFrom(() => zone.value)
  if (bridge === undefined) return
  try {
    bridge.onLocalZone((moved) => {
      zone.value = moved
    })
    zone.value = await bridge.localZone()
  } catch {
    // ⚑ The runtime's own zone data, as when main could not read the Mac's.
  }
}
