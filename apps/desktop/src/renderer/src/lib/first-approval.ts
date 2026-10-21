import { ref } from 'vue'

type Mode = 'ask' | 'auto'

/** Save only a successful first launch; failed starts keep the choice local to the form. */
export async function saveFirstApproval(
  opened: string | null | undefined,
  mode: Mode | undefined,
  chosen: boolean | undefined,
  save: (mode: Mode) => Promise<string | null>,
): Promise<string | null> {
  return opened && mode && chosen === false ? save(mode) : null
}

/** Hold the front door through creation, saving its first choice, and navigation. */
export function createLaunchGuard() {
  const busy = ref(false)
  let owner: symbol | null = null
  async function run(launch: (release: () => void) => Promise<void>): Promise<void> {
    if (owner !== null) return
    const token = Symbol()
    owner = token
    busy.value = true
    const release = (): void => {
      if (owner !== token) return
      owner = null
      busy.value = false
    }
    try {
      await launch(release)
    } finally {
      release()
    }
  }
  return { busy, run }
}
