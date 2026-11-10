import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUPS, groupArgs, groupCount } from '../test-dom-in-groups.mjs'

describe('scripts/test-dom-in-groups.mjs', () => {
  it('🔴 runs the DOM project once per group, every group a shard of the same count, in order', () => {
    expect(groupArgs(3)).toEqual([
      ['run', '--project', 'dom', '--shard=1/3'],
      ['run', '--project', 'dom', '--shard=2/3'],
      ['run', '--project', 'dom', '--shard=3/3'],
    ])
    // ⚑ What is passed through reaches every group, after its shard.
    expect(groupArgs(2, ['--reporter=dot']).map((args) => args.at(-1))).toEqual([
      '--reporter=dot',
      '--reporter=dot',
    ])
  })

  it('⚑ sixteen groups unless BROBOT_DOM_GROUPS says otherwise; a count that is not one is refused', () => {
    expect(DEFAULT_GROUPS).toBe(16)
    expect(groupCount({})).toBe(16)
    expect(groupCount({ BROBOT_DOM_GROUPS: '' })).toBe(16)
    expect(groupCount({ BROBOT_DOM_GROUPS: '4' })).toBe(4)
    for (const bad of ['0', '-2', '1.5', 'four', ' 3']) {
      expect(() => groupCount({ BROBOT_DOM_GROUPS: bad }), bad).toThrow('BROBOT_DOM_GROUPS')
    }
  })
})
