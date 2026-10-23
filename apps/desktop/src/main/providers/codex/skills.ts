import { join } from 'node:path'
import { z } from 'zod'
import type { SkillPolicy } from '../skill-policy'

export const skills: SkillPolicy = {
  discoveryRoot: 'codex/skills',
  initialFiles: () => new Map<string, string>(),
  fileFor: (name) => `codex/skills/${name}/SKILL.md`,
  launchedEntry: (root, skill) => ({
    name: skill.name,
    description: skill.description,
    path: join(root, skill.name, 'SKILL.md'),
  }),
  legacyReminder: {
    field: 'codex',
    schema: z.string().min(1).max(240),
    canonical(name, text) {
      return text.startsWith(`${name} — `) && !/[\r\n]/.test(text) ? text : null
    },
  },
}

/** Existing shared-skill migration receipts refer to this provider's old skill store. */
export const legacySharedSkillProvider = 'codex' as const
