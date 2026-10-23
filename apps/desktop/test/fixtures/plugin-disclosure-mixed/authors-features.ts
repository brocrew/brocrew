import { z } from 'zod'

export const PLUGIN_FRAMEWORK_FEATURES = ['contributions-v1', 'hooks-v1', 'authors-v1'] as const
const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
export const HookDeclaration = z
  .strictObject({
    id: identifier,
    kind: z
      .string()
      .max(100)
      .regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,3}$/),
    api: z.number().int().min(1).max(100),
    optional: z.literal(true),
    inputs: z.array(z.enum(['resource-titles', 'audio', 'transcript', 'vocabulary'])).max(4),
  })
  .superRefine((hook, context) => {
    const expected: Record<string, readonly string[]> = {
      'turn.context.titles': ['resource-titles'],
      'speech.transcribe': ['audio', 'vocabulary'],
      'transcript.cleanup': ['transcript', 'vocabulary'],
    }
    if (
      new Set(hook.inputs).size !== hook.inputs.length ||
      hook.inputs.some((input) => expected[hook.kind] && !expected[hook.kind]!.includes(input))
    )
      context.addIssue({ code: 'custom', message: 'Unsupported hook inputs' })
  })
export type HookDeclaration = z.infer<typeof HookDeclaration>
export function hookSupport(hook: HookDeclaration) {
  // Recognition of a declaration never enables its transport or grants a capability.
  return Object.freeze({
    ...hook,
    inputs: Object.freeze([...hook.inputs]),
    supported: false as const,
  })
}

/** Reserved contracts only. No speech transport, core capture, vault or invocation exists here. */
export const SPEECH_LIMITS = Object.freeze({
  sampleRate: 16_000,
  channels: 1,
  frameBytes: 3200,
  utteranceBytes: 2 * 1024 * 1024,
  seconds: 60,
  textBytes: 16 * 1024,
  requestBytes: 32 * 1024,
  vocabularyTerms: 64,
  termCharacters: 64,
  vocabularyBytes: 8 * 1024,
})
interface UtteranceIdentity {
  utteranceId: string
  attempt: number
  draftGeneration: number
  api: 1
}
export type SpeechTranscribeInput = UtteranceIdentity &
  (
    | {
        kind: 'start'
        language: string
        vocabulary: readonly string[]
        sampleRate: 16000
        channels: 1
        encoding: 'pcm16le'
      }
    | { kind: 'frame'; sequence: number; sampleOffset: number; audio: Uint8Array }
    | { kind: 'finish' | 'cancel' }
  )
export type SpeechTranscribeOutput = UtteranceIdentity &
  (
    | { kind: 'partial'; revision: number; text: string }
    | { kind: 'final'; text: string; language: string }
  )
export interface TranscriptCleanupInput extends UtteranceIdentity {
  transcript: string
  transcriptRevision: string
  language: string
  vocabulary: readonly string[]
}
export type TranscriptCleanupOutput = UtteranceIdentity & {
  kind: 'partial' | 'final'
  text: string
  inputTranscriptRevision: string
}
