import { describe, expect, it } from 'vitest'
import { projectUserSchema } from '@dhyantd/open-zoho-tui-zoho-client'
import { buildTaskCreatePayload, findProjectUserByEmail, formatTimeLogHours } from '../packages/cli/src/services.js'

describe('task creator assignment', () => {
  it('matches the authenticated email case-insensitively and ignores inactive users', () => {
    const users = [
      projectUserSchema.parse({ zpuid: 'inactive', email: 'me@example.com', active: false }),
      projectUserSchema.parse({ zpuid: 'active', email: 'ME@example.com', active: true }),
    ]

    expect(findProjectUserByEmail(users, ' me@example.com ')?.zpuid).toBe('active')
  })

  it('sends the authenticated project user as the v3 task assignee', () => {
    const user = projectUserSchema.parse({ zpuid: '4000000002143', email: 'me@example.com' })

    expect(buildTaskCreatePayload({ name: 'New ticket', tasklistId: '12' }, user)).toEqual({
      name: 'New ticket',
      tasklist: { id: '12' },
      assignee: { zpuid: '4000000002143' },
    })
  })

  it('creates an unassigned payload when the authenticated user is not a project member', () => {
    expect(buildTaskCreatePayload({
      name: 'New ticket',
      tasklistId: '12',
      description: 'Investigate',
      fields: { cf_priority: 'High' },
    })).toEqual({
      cf_priority: 'High',
      name: 'New ticket',
      tasklist: { id: '12' },
      description: 'Investigate',
    })
  })

  it('formats time-log hours using Zoho v3 hour.minute notation', () => {
    expect(formatTimeLogHours(1)).toBe('00.01')
    expect(formatTimeLogHours(90)).toBe('01.30')
  })
})
