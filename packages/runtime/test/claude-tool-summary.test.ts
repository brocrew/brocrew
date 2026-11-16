import { describe, expect, it } from 'vitest'
import {
  summarizeToolInput,
  summarizeToolResult,
  textParts,
  truncateToolSummary,
} from '../src/claude/tool-summary'

describe('Claude tool summaries', () => {
  it('keeps selection precedence, including empty commands and uncut file paths', () => {
    const path = '/folder/' + 'x'.repeat(220)
    expect(summarizeToolInput('Task', { command: '', file_path: path, description: 'work' })).toBe(
      '',
    )
    expect(summarizeToolInput('Read', { file_path: path, description: 'work' })).toBe(path)
    expect(summarizeToolInput('Task', { description: 'work', prompt: 'details' })).toBe('work')
    expect(summarizeToolInput('Task', { description: '' })).toBe('{"description":""}')
  })

  it('keeps JSON fallback and serialization failures distinct', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(summarizeToolInput('tool', undefined)).toBe('tool')
    expect(summarizeToolInput('tool', null)).toBe('null')
    expect(summarizeToolInput('tool', { count: 2 })).toBe('{"count":2}')
    expect(summarizeToolInput('tool', circular)).toBe('tool')
    expect(summarizeToolInput('tool', 1n)).toBe('tool')
  })

  it('cuts at 200 UTF-16 code units and appends an ellipsis only beyond the boundary', () => {
    const boundary = 'a'.repeat(200)
    expect(truncateToolSummary(boundary)).toBe(boundary)
    expect(summarizeToolInput('Bash', { command: boundary + 'b' })).toBe(boundary + '…')
    expect(summarizeToolInput('Task', { description: boundary + 'b' })).toBe(boundary + '…')
    expect(summarizeToolResult(boundary + 'b')).toBe(boundary + '…')
    expect(truncateToolSummary('a'.repeat(199) + '😀')).toBe('a'.repeat(199) + '\ud83d…')
  })

  it('selects the first nonblank text without trimming or welding receipt blocks', () => {
    const content = [
      { type: 'image', source: {} },
      { type: 'text', text: ' \n' },
      { type: 'text', text: ' words ' },
      { type: 'text', text: '{"payload":true}' },
    ]
    expect(summarizeToolResult(content)).toBe(' words ')
    expect(textParts(content)).toEqual([' \n', ' words ', '{"payload":true}'])
    expect(summarizeToolResult([{ type: 'text', text: ' ' }])).toBe('done')
    expect(summarizeToolResult([{ type: 'image', source: {} }])).toBe('done')
    expect(summarizeToolResult('File created.')).toBe('File created.')
    expect(textParts({ content: 'not a block list' })).toEqual([])
  })
})
