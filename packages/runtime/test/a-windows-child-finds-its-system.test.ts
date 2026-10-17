import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildChildEnv, WINDOWS_ESSENTIAL_ENV_KEYS } from '../src/internal/child-env'
import { codexAuthHealth } from '../src/internal/auth'

/**
 * # F072 — what an agent's process needs on Windows
 *
 * ⚑ Measured from the code, not on Windows: the allow-list compared names exactly, and Windows
 * spells the search path `Path` — so a Windows child would have found no program at all, and lost
 * `SystemRoot`, without which a Windows program cannot load its system libraries. And Codex's
 * credential check asked for a `0600` file, which Windows never reports.
 *
 *  - §1 · the environment, on Windows and off it.
 *  - §2 · Codex's credential file, on Windows and off it.
 */

describe('F072 · a Windows child finds its system', () => {
  describe('§1 · the environment', () => {
    const windows = {
      Path: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\tester',
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      TEMP: 'C:\\Users\\tester\\AppData\\Local\\Temp',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Program Files\\Git\\bin\\bash.exe',
      // ⛔ never carried, on any platform
      GITHUB_TOKEN: 'ghp_not_real',
      OPENAI_API_KEY: 'sk-not-real',
      SOME_TOOL_SETTING: 'x',
    }

    it('🔴 on Windows the search path and the system folders cross, whatever their case', () => {
      const env = buildChildEnv({ CLAUDE_CONFIG_DIR: 'C:\\home' }, windows, 'win32')
      expect(env).toMatchObject({
        Path: windows.Path,
        SystemRoot: windows.SystemRoot,
        USERPROFILE: windows.USERPROFILE,
        APPDATA: windows.APPDATA,
        LOCALAPPDATA: windows.LOCALAPPDATA,
        PATHEXT: windows.PATHEXT,
        ComSpec: windows.ComSpec,
        TEMP: windows.TEMP,
        CLAUDE_CODE_GIT_BASH_PATH: windows.CLAUDE_CODE_GIT_BASH_PATH,
        CLAUDE_CONFIG_DIR: 'C:\\home',
      })
    })

    it('⛔ …and the credential veto and the allow-list still hold there', () => {
      const env = buildChildEnv({}, windows, 'win32')
      expect(env).not.toHaveProperty('GITHUB_TOKEN')
      expect(env).not.toHaveProperty('OPENAI_API_KEY')
      expect(env).not.toHaveProperty('SOME_TOOL_SETTING')
      // ⚑ None of Windows' own names is credential-shaped, so the veto never had to make room.
      for (const key of WINDOWS_ESSENTIAL_ENV_KEYS) {
        expect(key, key).not.toMatch(/TOKEN|KEY|SECRET|PASS|CREDENTIAL|AUTH|SESSION|BEARER|PRIVATE/)
      }
    })

    it('⛔ the control — off Windows, names stay exact and Windows’ own do not cross', () => {
      const env = buildChildEnv({}, windows, 'darwin')
      expect(env).not.toHaveProperty('Path')
      expect(env).not.toHaveProperty('SystemRoot')
      expect(env).not.toHaveProperty('USERPROFILE')
      expect(env).toHaveProperty('TEMP')
    })
  })

  describe('§2 · Codex’s credential file', () => {
    let home: string
    afterEach(() => rmSync(home, { recursive: true, force: true }))

    it('🔴 on Windows a regular auth.json is enough — the system reports no owner-only mode', () => {
      home = mkdtempSync(join(tmpdir(), 'brobot-f072-codex-'))
      writeFileSync(join(home, 'auth.json'), '{}')
      chmodSync(join(home, 'auth.json'), 0o644)
      expect(codexAuthHealth(home, 'win32')).toEqual({ ok: true })
      // ⛔ The control: elsewhere the same file is refused for its mode.
      expect(codexAuthHealth(home, 'darwin')).toMatchObject({ ok: false })
      expect(codexAuthHealth(home, 'darwin').reason).toContain('!= 0600')
    })

    it('⛔ on Windows a missing file is still refused', () => {
      home = mkdtempSync(join(tmpdir(), 'brobot-f072-codex-'))
      expect(codexAuthHealth(home, 'win32')).toMatchObject({ ok: false })
    })
  })
})
