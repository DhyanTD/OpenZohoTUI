import { z } from 'zod'

export class ZohoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly uncertain = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

const idSchema = z.union([z.string(), z.number()]).transform(String)
export const portalSchema = z.object({
  id: idSchema,
  portal_name: z.string().optional(),
  org_name: z.string().optional(),
  timezone: z.string().optional(),
  is_default_portal: z.boolean().optional(),
}).passthrough()
export type Portal = z.infer<typeof portalSchema>

export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
}).passthrough()
export type Project = z.infer<typeof projectSchema>

const userSchema = z.object({
  zpuid: idSchema,
  email: z.string(),
  name: z.string().optional(),
  display_name: z.string().optional(),
  full_name: z.string().optional(),
  active: z.boolean().optional(),
}).passthrough()

export const projectUserSchema = z.union([
  userSchema,
  z.object({ user: userSchema }).passthrough().transform(({ user }) => user),
])
export type ProjectUser = z.infer<typeof projectUserSchema>

export const taskListSchema = z.object({
  id: idSchema,
  name: z.string(),
}).passthrough()
export type TaskList = z.infer<typeof taskListSchema>

export const taskStatusSchema = z.object({
  id: idSchema,
  name: z.string(),
  color: z.string().optional(),
  color_hexcode: z.string().optional(),
  type: z.string().optional(),
  is_closed_type: z.boolean().optional(),
}).passthrough()
export type TaskStatus = z.infer<typeof taskStatusSchema>

const fieldOptionSchema = z.union([
  z.string().transform((value) => ({ id: value, value })),
  z.object({
    id: idSchema.optional(),
    value: z.string().optional(),
    name: z.string().optional(),
    display_value: z.string().optional(),
  }).passthrough().transform((option) => ({
    id: option.id ?? option.value ?? option.name ?? option.display_value ?? '',
    value: option.display_value ?? option.value ?? option.name ?? option.id ?? '',
  })),
])

export const moduleFieldSchema = z.object({
  id: idSchema,
  api_name: z.string(),
  display_name: z.string(),
  type: z.string(),
  is_custom_field: z.boolean().optional(),
  is_mandatory: z.boolean().optional(),
  pick_list_values: z.array(fieldOptionSchema).optional(),
  options: z.array(fieldOptionSchema).optional(),
}).passthrough()
export type ModuleField = z.infer<typeof moduleFieldSchema>

const moduleSchema = z.object({
  id: idSchema,
  api_name: z.string(),
  singular_name: z.string().optional(),
  plural_name: z.string().optional(),
}).passthrough()

export const taskSchema = z.object({
  id: idSchema,
  key: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  due_date: z.string().optional(),
  priority: z.string().optional(),
  status: z.object({ id: idSchema.optional(), name: z.string(), type: z.string().optional() }).optional(),
  project: z.object({ id: idSchema, name: z.string() }).optional(),
  tasklist: z.object({ id: idSchema, name: z.string() }).optional(),
}).passthrough()
export type Task = z.infer<typeof taskSchema>

const booleanSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
])

interface ClientOptions {
  origin: string
  accessToken: () => Promise<string>
  fetch?: typeof fetch
}

function nestedErrorMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 3) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) {
    const messages = value.map((item) => nestedErrorMessage(item, depth + 1)).filter(Boolean)
    return messages.length > 0 ? messages.join('; ') : undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['message', 'error_description', 'detail', 'title']) {
    const message = nestedErrorMessage(record[key], depth + 1)
    if (message) return message
  }
  for (const key of ['error', 'errors', 'details']) {
    const message = nestedErrorMessage(record[key], depth + 1)
    if (message) return message
  }
  return undefined
}

function nestedErrorCode(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || !value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = nestedErrorCode(item, depth + 1)
      if (code) return code
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of ['code', 'errorCode', 'error_code']) {
    const code = record[key]
    if (typeof code === 'string' || typeof code === 'number') return String(code)
  }
  return nestedErrorCode(record.error ?? record.errors ?? record.details, depth + 1)
}

export function describeZohoError(body: unknown, fallback: string): string {
  const message = nestedErrorMessage(body)
  const code = nestedErrorCode(body)
  if (code && message && !message.includes(code)) return `${code}: ${message}`
  return message ?? code ?? fallback
}

const singleTaskSchema = z.union([
  taskSchema,
  z.array(taskSchema).min(1).transform(([task]) => task!),
  z.object({ tasks: z.array(taskSchema).min(1) }).transform(({ tasks }) => tasks[0]!),
])

const timeLogSchema = z.object({ id: idSchema }).passthrough()
const singleTimeLogSchema = z.union([
  timeLogSchema,
  z.array(timeLogSchema).min(1).transform(([log]) => log!),
  z.object({ time_logs: z.array(timeLogSchema).min(1) }).transform(({ time_logs }) => time_logs[0]!),
  z.object({
    time_logs: z.array(z.object({ log_details: z.array(timeLogSchema).min(1) })).min(1),
  }).transform(({ time_logs }) => time_logs[0]!.log_details[0]!),
  z.object({
    timelogs: z.object({ tasklogs: z.array(timeLogSchema).min(1) }),
  }).transform(({ timelogs }) => timelogs.tasklogs[0]!),
])

export class ZohoProjectsClient {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetch ?? fetch
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(new URL(path, this.options.origin), {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${await this.options.accessToken()}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    }).catch((error: unknown) => {
      throw new ZohoError(error instanceof Error ? error.message : 'Network request failed', 0, true, init.method === 'POST')
    })
    const body: unknown = await response.json().catch(() => ({}))
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'))
      throw new ZohoError(
        describeZohoError(body, response.statusText || `Zoho request failed (${response.status})`),
        response.status,
        response.status === 429 || response.status >= 500,
        false,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      )
    }
    return schema.parse(body)
  }

  private async paged<T>(
    path: string,
    key: string,
    itemSchema: z.ZodType<T>,
    options: { skipInvalidItems?: boolean } = {},
  ): Promise<T[]> {
    const items: T[] = []
    const parseItems = (value: unknown): T[] => {
      const rawItems = z.array(z.unknown()).parse(value)
      if (options.skipInvalidItems) {
        return rawItems.flatMap((item) => {
          const parsed = itemSchema.safeParse(item)
          return parsed.success ? [parsed.data] : []
        })
      }
      return z.array(itemSchema).parse(rawItems)
    }
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const body = await this.request(
        `${path}${separator}page=${page}&per_page=200`,
        z.unknown(),
      )
      if (Array.isArray(body)) {
        items.push(...parseItems(body))
        break
      }
      const result = z.object({
        page_info: z.object({ has_next_page: booleanSchema.optional() }).optional(),
      }).passthrough().parse(body)
      const rawPageItems = z.array(z.unknown()).parse(result[key])
      const pageItems = parseItems(rawPageItems)
      items.push(...pageItems)
      if (result.page_info?.has_next_page !== true && rawPageItems.length < 200) break
    }
    return items
  }

  async listPortals(): Promise<Portal[]> {
    const result = await this.request(
      '/api/v3/portals',
      z.union([z.array(portalSchema), z.object({ portals: z.array(portalSchema) }).transform(({ portals }) => portals)]),
    )
    return result
  }

  async listProjects(portalId: string): Promise<Project[]> {
    return this.paged(`/api/v3/portal/${encodeURIComponent(portalId)}/projects`, 'projects', projectSchema)
  }

  async listProjectUsers(portalId: string, projectId: string): Promise<ProjectUser[]> {
    return this.paged(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/users`,
      'users',
      projectUserSchema,
      { skipInvalidItems: true },
    )
  }

  async listTasks(portalId: string, projectId?: string): Promise<Task[]> {
    const base = projectId
      ? `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks`
      : `/api/v3/portal/${encodeURIComponent(portalId)}/mytasks`
    return this.paged(base, 'tasks', taskSchema)
  }

  async listTaskLists(portalId: string, projectId: string): Promise<TaskList[]> {
    return this.paged(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasklists`,
      'tasklists',
      taskListSchema,
    )
  }

  async listTaskStatuses(portalId: string): Promise<TaskStatus[]> {
    const path = `/api/v3/portal/${encodeURIComponent(portalId)}/settings/global-statuses?module=tasks`
    const result = await this.request(
      `${path}&page=1&per_page=200`,
      z.union([
        z.array(taskStatusSchema),
        z.object({ statuses: z.array(taskStatusSchema) }).transform(({ statuses }) => statuses),
        z.object({ global_statuses: z.array(taskStatusSchema) }).transform(({ global_statuses }) => global_statuses),
      ]),
    )
    return result
  }

  async listTaskFields(portalId: string): Promise<ModuleField[]> {
    const modules = await this.paged(
      `/api/v3/portal/${encodeURIComponent(portalId)}/settings/modules`,
      'modules',
      moduleSchema,
    )
    const taskModule = modules.find(({ api_name }) => api_name.toLowerCase() === 'tasks')
    if (!taskModule) return []
    const result = await this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/module/${encodeURIComponent(taskModule.id)}/fields`,
      z.object({ fields: z.array(moduleFieldSchema) }).transform(({ fields }) => fields),
    )
    return result
  }

  async showTask(portalId: string, projectId: string, taskId: string): Promise<Task> {
    return this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      singleTaskSchema,
    )
  }

  async createTask(portalId: string, projectId: string, input: Record<string, unknown>): Promise<Task> {
    return this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks`,
      singleTaskSchema,
      { method: 'POST', body: JSON.stringify(input) },
    )
  }

  async updateTask(portalId: string, projectId: string, taskId: string, input: Record<string, unknown>): Promise<Task> {
    return this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      singleTaskSchema,
      { method: 'PATCH', body: JSON.stringify(input) },
    )
  }

  async moveTask(portalId: string, projectId: string, taskId: string, tasklistId: string): Promise<void> {
    await this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/move`,
      z.unknown(),
      { method: 'POST', body: JSON.stringify({ target_tasklist_id: tasklistId }) },
    )
  }

  async addTimeLog(portalId: string, projectId: string, taskId: string, input: Record<string, unknown>): Promise<string> {
    const result = await this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/log`,
      singleTimeLogSchema,
      {
        method: 'POST',
        body: JSON.stringify({ ...input, module: { id: taskId, type: 'task' } }),
      },
    )
    return result.id
  }
}

export function resolveTask(reference: string, tasks: Task[]): Task {
  const normalized = reference.toLowerCase()
  const exact = tasks.filter((task) => task.id === reference || task.key?.toLowerCase() === normalized)
  if (exact.length === 1) return exact[0]!
  const candidates = tasks.filter((task) => task.name.toLowerCase().includes(normalized))
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length === 0) throw new Error(`No task matches ${reference}`)
  throw new Error(`Ambiguous task reference ${reference}: ${candidates.map((task) => task.key ?? task.id).join(', ')}`)
}
