import { isVoiceId, type VoicePhase, type VoiceResult } from '../../shared/voice'
import type { VoiceEngine, VoiceSession } from './engine'

export class VoiceService {
  private active: { owner: object; id: string; session: VoiceSession } | undefined
  constructor(private readonly engine: VoiceEngine) {}

  async start(
    owner: object,
    id: unknown,
    state: (phase: VoicePhase) => void,
  ): Promise<VoiceResult> {
    if (!isVoiceId(id)) return { ok: false, error: 'protocol' }
    if (this.active) return { ok: false, error: 'busy' }
    try {
      const session = this.engine(state)
      const active = { owner, id, session }
      this.active = active
      try {
        return await session.result
      } finally {
        if (this.active === active) this.active = undefined
      }
    } catch {
      return { ok: false, error: 'unavailable' }
    }
  }
  stop(owner: object, id: unknown): void {
    if (this.active?.owner === owner && this.active.id === id) this.active.session.stop()
  }
  cancel(owner: object, id?: unknown): void {
    if (this.active?.owner === owner && (id === undefined || this.active.id === id))
      this.active.session.cancel()
  }
  close(): void {
    this.active?.session.cancel()
  }
}
