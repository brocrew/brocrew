import { describe, expect, it } from 'vitest'
import { join, win32 } from 'node:path'
import {
  claudeBuiltInSkillOptions,
  isTheSamePath,
  mayBeTheSamePath,
  registerCodexBuiltInSkills,
  verifyClaudeBuiltInSkills,
  verifyCodexBuiltInSkills,
} from '../src/built-in-skills'
import type { BuiltInSkillsContext } from '../src/runtime'

const names = ['delegate', 'hand-back', 'split-work', 'ask-and-wait', 'remember', 'build-software']
// The default fixtures must be absolute on the machine running the test; explicit Windows and
// Darwin path cases below still use their own literal platform paths.
const FICTIONAL = process.platform === 'win32' ? 'C:\\tmp\\fictional' : '/tmp/fictional'
const WORK = process.platform === 'win32' ? 'C:\\tmp\\work' : '/tmp/work'
function context(provider: 'claude' | 'codex'): BuiltInSkillsContext {
  const root = join(FICTIONAL, provider)
  return {
    root,
    skills: names.map((name) => ({
      name: provider === 'claude' ? `brobot:${name}` : name,
      description: `Description of ${name}.`,
      path: join(root, provider === 'claude' ? 'skills' : '', name, 'SKILL.md'),
    })),
  }
}
function codexList() {
  return {
    data: [
      {
        cwd: WORK,
        errors: [],
        skills: context('codex').skills.map((skill) => ({ ...skill, enabled: true })),
      },
    ],
  }
}
describe('built-in skill discovery in fictional protocol responses', () => {
  for (const name of ['build-a-team', 'add-a-capability', 'unknown-owned']) {
    it(`rejects an unexpected Claude brobot:${name}`, () => {
      const offered = context('claude')
      expect(() =>
        verifyClaudeBuiltInSkills(
          {
            plugins: [{ name: 'brobot', path: offered.root }],
            skills: [...offered.skills.map((skill) => skill.name), `brobot:${name}`],
          },
          offered,
        ),
      ).toThrow()
    })
    it(`rejects an unexpected Codex ${name} before thread continuation`, async () => {
      const offered = context('codex'),
        response = codexList(),
        calls: string[] = []
      response.data[0]!.skills.push({
        name,
        description: 'Unexpected owned entry.',
        path: join(offered.root, name, 'SKILL.md'),
        enabled: true,
      })
      await expect(
        registerCodexBuiltInSkills(offered, WORK, async (method) => {
          calls.push(method)
          return method === 'skills/list' ? response : {}
        }),
      ).rejects.toThrow()
      expect(calls).toEqual(['skills/extraRoots/set', 'skills/list'])
    })
  }
  it('retains unrelated Claude skills and plugin diagnostics', () => {
    const offered = context('claude')
    expect(() =>
      verifyClaudeBuiltInSkills(
        {
          plugins: [{ name: 'brobot', path: offered.root }],
          skills: [...offered.skills.map((skill) => skill.name), 'native-skill', 'personal:extra'],
          plugin_errors: [
            { plugin: 'personal@local', type: 'unknown-error', message: 'Fictional diagnostic.' },
          ],
        },
        offered,
      ),
    ).not.toThrow()
  })
  for (const error of [
    { plugin: 'brobot', type: 'hook-load-failed', message: 'Fictional diagnostic.' },
    { plugin: 'brobot@local', type: 'unknown-new-type', message: 'Fictional diagnostic.' },
    { plugin: 'inline[0]', type: 'manifest-validation-error', message: 'Fictional diagnostic.' },
    {
      plugin: 'synced[2]',
      path: context('claude').root,
      type: 'unknown-new-type',
      message: 'Fictional diagnostic.',
    },
  ]) {
    it(`rejects the owned ${error.plugin} diagnostic even with a complete skills list`, () => {
      const offered = context('claude')
      expect(() =>
        verifyClaudeBuiltInSkills(
          {
            plugins: [{ name: 'brobot', path: offered.root }],
            skills: offered.skills.map((skill) => skill.name),
            plugin_errors: [error],
          },
          offered,
        ),
      ).toThrow()
    })
  }
  it('retains unrelated Codex personal/native skills through registration', async () => {
    const offered = context('codex'),
      response = codexList()
    response.data[0]!.skills.push({
      name: 'personal-skill',
      description: 'Unrelated personal skill.',
      path: join(FICTIONAL, '..', 'personal', 'SKILL.md'),
      enabled: true,
    })
    Object.assign(response.data[0]!, {
      errors: [
        {
          path: join(FICTIONAL, '..', 'personal', 'invalid', 'SKILL.md'),
          message: 'Unrelated diagnostic.',
        },
      ],
    })
    await expect(
      registerCodexBuiltInSkills(offered, WORK, async (method) =>
        method === 'skills/list' ? response : {},
      ),
    ).resolves.toBeUndefined()
  })
  it('passes only the explicit local plugin path to Claude', () => {
    expect(claudeBuiltInSkillOptions(context('claude'))).toEqual({
      plugins: [{ type: 'local', path: context('claude').root }],
    })
  })
  it('accepts the named plugin and exact offered skill names', () => {
    expect(() =>
      verifyClaudeBuiltInSkills(
        {
          plugins: [{ name: 'brobot', path: context('claude').root }],
          skills: context('claude').skills.map((skill) => skill.name),
        },
        context('claude'),
      ),
    ).not.toThrow()
  })
  for (const change of [
    'missing-plugin',
    'wrong-path',
    'missing-skill',
    'duplicate-skill',
  ] as const) {
    it(`rejects Claude's ${change}`, () => {
      const message = {
        plugins: [{ name: 'brobot', path: context('claude').root }],
        skills: context('claude').skills.map((skill) => skill.name),
      }
      if (change === 'missing-plugin') message.plugins = []
      if (change === 'wrong-path') message.plugins[0]!.path = join(FICTIONAL, '..', 'other')
      if (change === 'missing-skill') message.skills.pop()
      if (change === 'duplicate-skill') message.skills.push(message.skills[0]!)
      expect(() => verifyClaudeBuiltInSkills(message, context('claude'))).toThrow()
    })
  }
  describe('Claude Code reports the plugin folder resolved, in the system’s own form', () => {
    const reported = (path: string, offered = context('claude')) => ({
      plugins: [{ name: 'brobot', path }],
      skills: offered.skills.map((skill) => skill.name),
    })
    it('accepts the offered folder spelled another way', () => {
      for (const path of [`${FICTIONAL}/./claude`, `${FICTIONAL}/claude/`])
        expect(() => verifyClaudeBuiltInSkills(reported(path), context('claude'))).not.toThrow()
    })
    it('accepts a resolved report of a folder offered unresolved', () => {
      const root = `${FICTIONAL}//claude`
      const offered = {
        root,
        skills: context('claude').skills.map((skill) => ({
          ...skill,
          path: join(root, 'skills', skill.name.replace(/^brobot:/, ''), 'SKILL.md'),
        })),
      }
      expect(() =>
        verifyClaudeBuiltInSkills(reported(context('claude').root, offered), offered),
      ).not.toThrow()
    })
    for (const path of ['fictional/claude', `${FICTIONAL}/claude/..`, `${FICTIONAL}/claude-old`])
      it(`rejects ${path}, which is not the offered folder`, () => {
        expect(() => verifyClaudeBuiltInSkills(reported(path), context('claude'))).toThrow()
      })
    it('rejects an owned diagnostic whose path spells the offered folder another way', () => {
      expect(() =>
        verifyClaudeBuiltInSkills(
          {
            ...reported(context('claude').root),
            plugin_errors: [
              {
                plugin: 'synced[0]',
                path: `${FICTIONAL}/./claude`,
                type: 'path-not-found',
                message: 'Fictional diagnostic.',
              },
            ],
          },
          context('claude'),
        ),
      ).toThrow()
    })
    describe('on Windows', () => {
      const offered = 'C:\\Users\\fixture\\provider-homes\\brobot-skills-x/claude-plugin'
      it('takes the same folder with other separators, drive letter or case', () => {
        for (const path of [
          'C:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          'c:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          'C:\\USERS\\fixture\\Provider-Homes\\BROBOT-skills-x\\claude-plugin\\',
          'C:/Users/fixture/provider-homes/brobot-skills-x/claude-plugin',
        ])
          expect(isTheSamePath(path, offered, 'win32')).toBe(true)
      })
      it('refuses a sibling, a longer name, its parent, a relative path and another drive', () => {
        for (const path of [
          'C:\\Users\\fixture\\provider-homes\\brobot-skills-y\\claude-plugin',
          'C:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin-old',
          'C:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin\\..',
          'brobot-skills-x\\claude-plugin',
          'D:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
        ])
          expect(isTheSamePath(path, offered, 'win32')).toBe(false)
      })
      it('refuses a path that names no drive, or a drive without its root, before resolving it', () => {
        for (const path of [
          '\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          '/Users/fixture/provider-homes/brobot-skills-x/claude-plugin',
          'C:Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
        ])
          expect(isTheSamePath(path, offered, 'win32')).toBe(false)
        expect(
          isTheSamePath(
            'C:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
            '\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
            'win32',
          ),
        ).toBe(false)
      })
      it('takes a folder on a share by its server and share, in any case, and no other', () => {
        const shared = '\\\\server\\share\\brobot-skills-x/claude-plugin'
        for (const path of [
          '\\\\server\\share\\brobot-skills-x\\claude-plugin',
          '\\\\SERVER\\Share\\brobot-skills-x\\claude-plugin\\',
          '//server/share/brobot-skills-x/claude-plugin',
        ])
          expect(isTheSamePath(path, shared, 'win32')).toBe(true)
        for (const path of [
          '\\\\server\\other\\brobot-skills-x\\claude-plugin',
          '\\\\other\\share\\brobot-skills-x\\claude-plugin',
          'C:\\share\\brobot-skills-x\\claude-plugin',
        ])
          expect(isTheSamePath(path, shared, 'win32')).toBe(false)
      })
      it('reads a plugin error’s path to fail closed: any spelling that may be the offered folder', () => {
        for (const path of [
          'c:/users/fixture/provider-homes/brobot-skills-x/claude-plugin/',
          '\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          '/users/fixture/provider-homes/brobot-skills-x/claude-plugin',
          'C:Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          'Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
        ])
          expect(mayBeTheSamePath(path, offered, 'win32')).toBe(true)
        for (const path of [
          'D:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          'C:\\Users\\fixture\\provider-homes\\brobot-skills-y\\claude-plugin',
          '\\Users\\fixture\\personal\\plugin',
        ])
          expect(mayBeTheSamePath(path, offered, 'win32')).toBe(false)
      })
      describe('through the whole check', () => {
        const root = 'C:\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin'
        const windows: BuiltInSkillsContext = {
          root,
          skills: context('claude').skills.map((skill) => ({
            ...skill,
            path: win32.join(root, 'skills', skill.name.replace(/^brobot:/, ''), 'SKILL.md'),
          })),
        }
        const start = (path: string, errors?: object[]) => ({
          plugins: [{ name: 'brobot', path }],
          skills: windows.skills.map((skill) => skill.name),
          ...(errors ? { plugin_errors: errors } : {}),
        })
        const checked = (message: object) => () =>
          verifyClaudeBuiltInSkills(message, windows, 'win32')
        it('takes the plugin row in another case and with forward slashes', () => {
          expect(
            checked(start('c:/users/fixture/provider-homes/brobot-skills-x/claude-plugin')),
          ).not.toThrow()
        })
        it('refuses a plugin row that names no drive', () => {
          expect(
            checked(start('\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin')),
          ).toThrow()
        })
        it('refuses an unknown-type error under an unknown marker whose path may be the folder', () => {
          for (const path of [
            'c:\\USERS\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
            '/Users/fixture/provider-homes/brobot-skills-x/claude-plugin/',
            '\\Users\\fixture\\provider-homes\\brobot-skills-x\\claude-plugin',
          ])
            expect(
              checked(
                start(root, [
                  { plugin: 'synced[3]', path, type: 'a-new-type', message: 'Fictional.' },
                ]),
              ),
            ).toThrow()
        })
        it('keeps an unrelated plugin error', () => {
          expect(
            checked(
              start(root, [
                {
                  plugin: 'personal@local',
                  path: 'C:\\Users\\fixture\\personal\\plugin',
                  type: 'a-new-type',
                  message: 'Fictional.',
                },
              ]),
            ),
          ).not.toThrow()
        })
      })
    })
    it('keeps case on other systems', () => {
      expect(isTheSamePath('/tmp/Fictional/claude', '/tmp/fictional/claude', 'darwin')).toBe(false)
    })
  })
  describe('Codex reports the cwd and each skill’s file in the system’s own form', () => {
    it('takes them spelled another way, and keeps case on other systems', () => {
      const response = codexList()
      response.data[0]!.cwd = `${WORK}/`
      response.data[0]!.skills[0]!.path = `${FICTIONAL}/./codex/delegate/SKILL.md`
      expect(() => verifyCodexBuiltInSkills(response, context('codex'), WORK)).not.toThrow()
      for (const change of ['cwd', 'path'] as const) {
        const cased = codexList()
        if (change === 'cwd') cased.data[0]!.cwd = '/tmp/Work'
        else cased.data[0]!.skills[0]!.path = '/tmp/Fictional/codex/delegate/SKILL.md'
        expect(() => verifyCodexBuiltInSkills(cased, context('codex'), WORK, 'darwin')).toThrow()
      }
    })
    describe('on Windows', () => {
      const home = 'C:\\Users\\fixture\\provider-homes\\brobot\\codex'
      const root = `${home}\\brobot-skills-x\\codex\\skills`
      const cwd = 'C:\\Users\\fixture\\work'
      const windows: BuiltInSkillsContext = {
        root,
        skills: context('codex').skills.map((skill) => ({
          ...skill,
          path: win32.join(root, skill.name, 'SKILL.md'),
        })),
      }
      const listed = (
        change: { cwd?: string; path?: string; errors?: object[]; extra?: object } = {},
        offered = windows,
      ) => ({
        data: [
          {
            cwd: change.cwd ?? cwd,
            errors: change.errors ?? [],
            skills: [
              ...offered.skills.map((skill, at) => ({
                ...skill,
                ...(at === 0 && change.path !== undefined ? { path: change.path } : {}),
                enabled: true,
              })),
              ...(change.extra ? [change.extra] : []),
            ],
          },
        ],
      })
      const checked =
        (response: object, offered = windows, sent = cwd) =>
        () =>
          verifyCodexBuiltInSkills(response, offered, sent, 'win32')
      const skill = (path: string, name = 'build-a-team') => ({
        name,
        description: 'Fictional.',
        path,
        enabled: true,
      })
      it('takes the cwd and a skill’s file with other separators, drive letter or case', () => {
        expect(checked(listed())).not.toThrow()
        for (const one of ['c:/users/fixture/work/', 'C:\\USERS\\fixture\\WORK'])
          expect(checked(listed({ cwd: one }))).not.toThrow()
        for (const path of [
          'c:/users/fixture/provider-homes/brobot/codex/brobot-skills-x/codex/skills/delegate/SKILL.md',
          `${home.toUpperCase()}\\brobot-skills-x\\codex\\skills\\DELEGATE\\skill.md`,
        ])
          expect(checked(listed({ path }))).not.toThrow()
      })
      it('refuses a sibling cwd, a longer name, one without its drive or root, and another drive', () => {
        for (const one of [
          'C:\\Users\\fixture\\other',
          'C:\\Users\\fixture\\work-old',
          '\\Users\\fixture\\work',
          'C:Users\\fixture\\work',
          'work',
          'D:\\Users\\fixture\\work',
        ])
          expect(checked(listed({ cwd: one }))).toThrow()
        const driveless = '\\Users\\fixture\\work'
        expect(checked(listed({ cwd: driveless }), windows, driveless)).toThrow()
      })
      it('refuses a skill’s file in a sibling folder, its parent, without its drive, or on another drive', () => {
        for (const path of [
          `${home}\\brobot-skills-y\\codex\\skills\\delegate\\SKILL.md`,
          `${root}\\..\\delegate\\SKILL.md`,
          windows.skills[0]!.path.slice(2),
          `D${windows.skills[0]!.path.slice(1)}`,
        ])
          expect(checked(listed({ path }))).toThrow()
      })
      it('refuses an unexpected skill that may be in the offered folder, in any spelling', () => {
        for (const path of [
          'c:/users/fixture/provider-homes/brobot/codex/brobot-skills-x/codex/skills/build-a-team/SKILL.md',
          `${root.slice(2)}\\build-a-team\\SKILL.md`,
        ])
          expect(checked(listed({ extra: skill(path) }))).toThrow()
      })
      it('keeps an unexpected skill in a sibling folder, on another drive, or elsewhere', () => {
        for (const path of [
          `${home}\\brobot-skills-y\\codex\\skills\\build-a-team\\SKILL.md`,
          `D${root.slice(1)}\\build-a-team\\SKILL.md`,
          'C:\\Users\\fixture\\.agents\\skills\\personal\\SKILL.md',
        ])
          expect(checked(listed({ extra: skill(path, 'personal') }))).not.toThrow()
      })
      it('reads an error’s path to fail closed: any spelling that may be in the offered folder', () => {
        for (const path of [
          'c:/USERS/fixture/provider-homes/brobot/codex/brobot-skills-x/codex/skills/delegate/SKILL.md',
          `${root.slice(2)}\\delegate`,
          `C:${root.slice(3)}`,
          '/Users/fixture/provider-homes/brobot/codex/brobot-skills-x/codex/skills/',
        ])
          expect(checked(listed({ errors: [{ path, message: 'Fictional.' }] }))).toThrow()
        for (const path of [
          `${home}\\brobot-skills-y\\codex\\skills\\delegate\\SKILL.md`,
          `${root}-old\\delegate\\SKILL.md`,
          `D${root.slice(1)}\\delegate\\SKILL.md`,
          'C:\\Users\\fixture\\.agents\\skills\\broken\\SKILL.md',
        ])
          expect(checked(listed({ errors: [{ path, message: 'Fictional.' }] }))).not.toThrow()
      })
      it('refuses an offered folder that names no drive, even as Codex echoes it', () => {
        const driveless = {
          root: root.slice(2),
          skills: windows.skills.map((one) => ({ ...one, path: one.path.slice(2) })),
        }
        expect(checked(listed({}, driveless), driveless)).toThrow()
      })
    })
  })
  it('registers roots then forces a catalogue read, before the caller opens a thread', async () => {
    const calls: { method: string; params: object }[] = []
    await registerCodexBuiltInSkills(context('codex'), WORK, async (method, params) => {
      calls.push({ method, params })
      return method === 'skills/list' ? codexList() : {}
    })
    calls.push({ method: 'thread/start', params: {} })
    expect(calls).toEqual([
      { method: 'skills/extraRoots/set', params: { extraRoots: [context('codex').root] } },
      { method: 'skills/list', params: { cwds: [WORK], forceReload: true } },
      { method: 'thread/start', params: {} },
    ])
  })
  for (const change of [
    'missing',
    'disabled',
    'path',
    'description',
    'duplicate',
    'errors',
    'cwd',
  ] as const) {
    it(`rejects Codex's ${change} catalogue`, () => {
      const response = codexList(),
        entry = response.data[0]!
      if (change === 'missing') entry.skills.pop()
      if (change === 'disabled') entry.skills[0]!.enabled = false
      if (change === 'path') entry.skills[0]!.path = join(FICTIONAL, '..', 'foreign', 'SKILL.md')
      if (change === 'description') entry.skills[0]!.description = 'Other text'
      if (change === 'duplicate') entry.skills.push(entry.skills[0]!)
      if (change === 'errors')
        Object.assign(entry, {
          errors: [{ path: join(context('codex').root, 'invalid', 'SKILL.md') }],
        })
      if (change === 'cwd') entry.cwd = join(FICTIONAL, '..', 'other')
      expect(() => verifyCodexBuiltInSkills(response, context('codex'), WORK)).toThrow()
    })
  }
  it('a failed registration never reads the list or continues', async () => {
    const calls: string[] = []
    await expect(
      registerCodexBuiltInSkills(context('codex'), WORK, async (method) => {
        calls.push(method)
        throw new Error('fictional refusal')
      }),
    ).rejects.toThrow('fictional refusal')
    expect(calls).toEqual(['skills/extraRoots/set'])
  })
})
