import { z } from 'zod'
import {
  SkillDraft,
  SkillSelection,
  type SkillDetail,
  type SkillPage,
  type SkillResolution,
  type SkillRefusal,
} from './skills-catalogue'

const id = z.string().min(1).max(256)
const revision = z.number().int().nonnegative().safe()
export const SkillEditor = SkillDraft.omit({ path: true, bytes: true, sha256: true })
export type SkillEditor = z.infer<typeof SkillEditor>
export const SkillsRequest = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('list'), offset: z.number().int().min(0).max(200) }),
  z.strictObject({ operation: z.literal('detail'), id }),
  z.strictObject({ operation: z.literal('choices'), identityId: id }),
  z.strictObject({
    operation: z.literal('save'),
    draft: SkillEditor,
    revision,
    versionId: id.nullable(),
  }),
  z.strictObject({
    operation: z.literal('select'),
    identityId: id,
    id,
    selection: SkillSelection,
    revision,
  }),
  z.strictObject({ operation: z.literal('import') }),
  z.strictObject({ operation: z.literal('shared-list') }),
  z.strictObject({
    operation: z.literal('shared-toggle'),
    folder: z.string().min(1).max(256),
    enabled: z.boolean(),
  }),
])
export type SkillsRequest = z.infer<typeof SkillsRequest>
export interface ImportedSkill {
  readonly name: string
  readonly description: string
  readonly body: string
}
export interface SharedSkill {
  readonly folder: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly builtIn: boolean
  readonly enabled: boolean
}
export type SkillsReply =
  | { operation: 'shared-list'; skills: readonly SharedSkill[] }
  | { operation: 'shared-toggle' }
  | { operation: 'list'; page: SkillPage }
  | { operation: 'detail'; skill: SkillDetail | null }
  | { operation: 'choices'; reading: SkillResolution }
  | { operation: 'save'; revision: number }
  | { operation: 'select'; revision: number; reading: SkillResolution }
  | { operation: 'import'; skill: ImportedSkill | null }
  | { operation: 'refused'; reason: SkillRefusal }

export type SkillsWindow = (request: SkillsRequest) => Promise<SkillsReply>
