import { join } from 'node:path'
import { z } from 'zod'
import { providerDescriptor } from '@brobot2/shared'
import type { SkillPolicy } from '../skill-policy'

export const skills: SkillPolicy = {
  discoveryRoot: 'claude-plugin',
  initialFiles: () =>
    new Map([
      [
        'claude-plugin/.claude-plugin/plugin.json',
        JSON.stringify({ name: 'brobot', version: '0.0.6', description: 'Built-in skills' }) + '\n',
      ],
    ]),
  fileFor: (name) => `claude-plugin/skills/${name}/SKILL.md`,
  launchedEntry: (root, skill) => ({
    name: `${providerDescriptor('claude').skillReminderPrefix}${skill.name}`,
    description: skill.description,
    path: join(root, 'skills', skill.name, 'SKILL.md'),
  }),
  legacyReminder: {
    field: 'claude',
    schema: z.string().min(1).max(247),
    canonical(name, text) {
      return text.startsWith(`brobot:${name} — `) && !/[\r\n]/.test(text)
        ? text.slice('brobot:'.length)
        : null
    },
  },
}
