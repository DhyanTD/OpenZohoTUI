import { describe, expect, it } from 'vitest'
import { moduleFieldSchema } from '@dhyantd/open-zoho-tui-zoho-client'
import {
  fieldOptions,
  filterTasks,
  formatElapsed,
  formatMinutes,
  isSaveShortcut,
  manualTimeChoices,
  taskForTimeLog,
  timeLogDetailRows,
} from '../packages/cli/src/tui.js'

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

describe('TUI manual time selector', () => {
  const choices = [
    { id: '1', label: 'ABC-T1 · Build authentication' },
    { id: '2', label: 'ABC-T2 · Document command line' },
  ]

  it('fuzzy-searches tasks while keeping general time available', () => {
    expect(manualTimeChoices(choices, 'authentcation').map(({ label }) => label)).toEqual([
      'ABC-T1 · Build authentication',
      'General time log · authentcation',
    ])
  })

  it('turns an unmatched search into the selectable general activity name', () => {
    expect(manualTimeChoices(choices, 'Team meeting')).toEqual([
      expect.objectContaining({ label: 'General time log · Team meeting' }),
    ])
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

describe('TUI time-log details', () => {
  it('shows every stored detail for the selected time log', () => {
    const log = {
      id: 'b29abe8a-8315-4eb5-9c2a-3c4bb52b1a70',
      taskRef: '329135000001154011',
      projectId: 'project-1',
      date: '2026-08-20',
      minutes: 95,
      notes: 'Finished the integration',
      billing: 'Billable',
      state: 'submitted',
      createdAt: '2026-08-20T10:00:00.000Z',
      zohoId: 'zoho-1',
      lastError: 'Previous attempt timed out',
    } as const
    const task = taskForTimeLog(log, [{
      id: '329135000001154011',
      key: 'ABC-T1',
      name: 'Build authentication',
    }])
    const rows = timeLogDetailRows(log, task)

    expect(Object.fromEntries(rows)).toEqual({
      'Target type': 'Task',
      'Task name': 'Build authentication',
      'Task ID': '329135000001154011',
      'Task key': 'ABC-T1',
      State: 'submitted',
      Date: '2026-08-20',
      Duration: '1h 35m (95 minutes)',
      Billing: 'Billable',
      Notes: 'Finished the integration',
      'Project ID': 'project-1',
      Created: '2026-08-20T10:00:00.000Z',
      'Zoho ID': 'zoho-1',
      'Local ID': 'b29abe8a-8315-4eb5-9c2a-3c4bb52b1a70',
      'Last error': 'Previous attempt timed out',
    })
  })

  it('labels general logs and empty optional details clearly', () => {
    const rows = Object.fromEntries(timeLogDetailRows({
      id: 'b29abe8a-8315-4eb5-9c2a-3c4bb52b1a70',
      generalName: 'Team meeting',
      projectId: 'project-1',
      date: '2026-08-20',
      minutes: 30,
      notes: '',
      billing: 'Non Billable',
      state: 'pending',
      createdAt: '2026-08-20T10:00:00.000Z',
    }))

    expect(rows).toMatchObject({
      'Target type': 'General activity',
      Activity: 'Team meeting',
      Notes: 'No notes',
      'Zoho ID': 'Not submitted',
      'Last error': 'None',
    })
  })

  it('matches a time log to a task by either Zoho ID or visible key', () => {
    const tasks = [{ id: '329135000001154011', key: 'ABC-T1', name: 'Build authentication' }]
    const log = {
      id: 'b29abe8a-8315-4eb5-9c2a-3c4bb52b1a70',
      projectId: 'project-1',
      date: '2026-08-20',
      minutes: 30,
      notes: '',
      billing: 'Billable' as const,
      state: 'pending' as const,
      createdAt: '2026-08-20T10:00:00.000Z',
    }

    expect(taskForTimeLog({ ...log, taskRef: '329135000001154011' }, tasks)?.name).toBe('Build authentication')
    expect(taskForTimeLog({ ...log, taskRef: 'abc-t1' }, tasks)?.name).toBe('Build authentication')
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
