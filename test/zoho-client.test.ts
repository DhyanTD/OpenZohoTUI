import { describe, expect, it, vi } from 'vitest'
import { ZohoProjectsClient } from '@open-zoho-connect/zoho-client'

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('ZohoProjectsClient discovery APIs', () => {
  it('discovers portals and paginates projects without exposing IDs to callers', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/v3/portals') {
        return json([{ id: 7, portal_name: 'Acme', timezone: 'Asia/Kolkata' }])
      }
      return json([{ id: 9, name: 'Platform' }])
    })
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.listPortals()).resolves.toEqual([expect.objectContaining({ id: '7', portal_name: 'Acme' })])
    await expect(client.listProjects('7')).resolves.toEqual([expect.objectContaining({ id: '9', name: 'Platform' })])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('accepts top-level task arrays returned by some Zoho tenants', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json([
      { id: 31, key: 'ABC-T1', name: 'Tenant-shaped task' },
    ]))
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.listTasks('7', '9')).resolves.toEqual([
      expect.objectContaining({ id: '31', key: 'ABC-T1', name: 'Tenant-shaped task' }),
    ])
  })

  it('loads task lists and named task statuses for selectors', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/tasklists')) {
        return json({ tasklists: [{ id: 11, name: 'Backend' }], page_info: { has_next_page: false } })
      }
      return json([{ id: 12, name: 'In Progress', color_hexcode: '#00aaff' }])
    })
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.listTaskLists('7', '9')).resolves.toEqual([expect.objectContaining({ id: '11', name: 'Backend' })])
    await expect(client.listTaskStatuses('7')).resolves.toEqual([expect.objectContaining({ id: '12', name: 'In Progress' })])
  })

  it('loads project users with the ZPUID required for task assignment', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({
      users: [
        { user: { zpuid: 44, email: 'developer@example.com', full_name: 'Developer' } },
        { team: { id: 45, name: 'Platform' } },
        { contact: { id: 46, email: 'external@example.com' } },
      ],
      page_info: { has_next_page: false },
    }))
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.listProjectUsers('7', '9')).resolves.toEqual([
      expect.objectContaining({ zpuid: '44', email: 'developer@example.com', full_name: 'Developer' }),
    ])
  })

  it('resolves the tasks module before loading typed custom fields', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/settings/modules')) {
        return json({ modules: [{ id: 20, api_name: 'tasks' }], page_info: { has_next_page: false } })
      }
      return json({ fields: [{
        id: 21,
        api_name: 'release_train',
        display_name: 'Release Train',
        type: 'picklist',
        is_custom_field: true,
        pick_list_values: [{ id: 'r1', display_value: 'R1' }],
      }] })
    })
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.listTaskFields('7')).resolves.toEqual([
      expect.objectContaining({
        id: '21', api_name: 'release_train', display_name: 'Release Train',
        pick_list_values: [{ id: 'r1', value: 'R1' }],
      }),
    ])
  })

  it('shows nested Zoho error codes and messages', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      error: { code: 'INVALID_ASSIGNEE', message: 'The selected user is not in this project' },
    }), { status: 400, statusText: 'Bad Request', headers: { 'content-type': 'application/json' } }))
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.createTask('7', '9', { name: 'New task' })).rejects.toMatchObject({
      message: 'INVALID_ASSIGNEE: The selected user is not in this project',
      status: 400,
    })
  })

  it('uses the v3 project log route and task module payload for time logs', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ id: 71, log_hour: '00:30' }))
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await expect(client.addTimeLog('7', '9', '31', {
      date: '2026-08-19', hours: '00.30', bill_status: 'Billable', notes: 'Review',
    })).resolves.toBe('71')
    const [request, init] = fetcher.mock.calls[0]!
    expect(new URL(String(request)).pathname).toBe('/api/v3/portal/7/projects/9/log')
    expect(JSON.parse(String(init?.body))).toEqual({
      date: '2026-08-19',
      hours: '00.30',
      bill_status: 'Billable',
      notes: 'Review',
      module: { id: '31', type: 'task' },
    })
  })

  it('uses the v3 move action and target task-list parameter', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({}))
    const client = new ZohoProjectsClient({ origin: 'https://projectsapi.example.com', accessToken: async () => 'token', fetch: fetcher })

    await client.moveTask('7', '9', '31', '12')
    const [request, init] = fetcher.mock.calls[0]!
    expect(new URL(String(request)).pathname).toBe('/api/v3/portal/7/projects/9/tasks/31/move')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ target_tasklist_id: '12' })
  })
})
