import { describe, expect, it } from 'vitest'
import { moduleFieldSchema } from '@dhyantd/open-zoho-tui-zoho-client'
import { fieldOptions, filterTasks, formatElapsed, formatMinutes, isSaveShortcut } from '../packages/cli/src/tui.js'

describe('TUI task search', () => {
  const tasks = [
    { id: '1', key: 'ABC-T1', name: 'Build authentication', status: { name: 'Open' } },
    { id: '2', key: 'ABC-T2', name: 'Document command line', status: { name: 'In Progress' } },
  ]

  it('returns the complete task list for an empty query', () => {
    expect(filterTasks(tasks, '')).toEqual(tasks)
  })

  it('finds tasks by name, key, and nested status', () => {
    expect(filterTasks(tasks, 'authentication').map(({ id }) => id)).toEqual(['1'])
    expect(filterTasks(tasks, 'ABC-T2').map(({ id }) => id)).toEqual(['2'])
    expect(filterTasks(tasks, 'progress').map(({ id }) => id)).toEqual(['2'])
  })
})

describe('TUI time formatting', () => {
  it('formats a live timer with zero-padded units', () => {
    expect(formatElapsed('2026-08-18T10:00:00.000Z', Date.parse('2026-08-18T11:02:03.000Z'))).toBe('01:02:03')
  })

  it('formats queued minutes for human display', () => {
    expect(formatMinutes(95)).toBe('1h 35m')
  })
})

describe('TUI save shortcut', () => {
  it('requires Shift when saving with Ctrl+S', () => {
    expect(isSaveShortcut('s', { ctrl: true, shift: true, meta: false })).toBe(true)
    expect(isSaveShortcut('s', { ctrl: true, shift: false, meta: false })).toBe(false)
  })

  it('supports Alt+S when a terminal cannot report Ctrl+Shift+S separately', () => {
    expect(isSaveShortcut('s', { ctrl: false, shift: false, meta: true })).toBe(true)
  })
})

describe('TUI custom fields', () => {
  it('submits a pick-list display value instead of its metadata ID', () => {
    const field = moduleFieldSchema.parse({
      id: '7', api_name: 'cf_priority', display_name: 'Priority', type: 'picklist',
      pick_list_values: [{ id: 'option-1', value: 'High' }],
    })

    expect(fieldOptions(field)).toEqual([{ id: 'High', label: 'High' }])
  })
})
