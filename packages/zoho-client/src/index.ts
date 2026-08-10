import { z } from 'zod'

export class ZohoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly uncertain = false,
  ) {
    super(message)
  }
}

const idSchema = z.union([z.string(), z.number()]).transform(String)
const taskSchema = z.object({
  id: idSchema,
  key: z.string().optional(),
  name: z.string(),
  status: z.object({ id: idSchema.optional(), name: z.string(), type: z.string().optional() }).optional(),
  project: z.object({ id: idSchema, name: z.string() }).optional(),
  tasklist: z.object({ id: idSchema, name: z.string() }).optional(),
}).passthrough()
export type Task = z.infer<typeof taskSchema>

const pageSchema = z.object({
  tasks: z.array(taskSchema),
  page_info: z.object({ has_next_page: z.boolean().optional() }).optional(),
}).passthrough()

interface ClientOptions {
  origin: string
  accessToken: () => Promise<string>
  fetch?: typeof fetch
}

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
      const detail = z.object({ message: z.string().optional(), error: z.string().optional() }).passthrough().safeParse(body)
      const message = detail.success ? detail.data.message ?? detail.data.error ?? response.statusText : response.statusText
      throw new ZohoError(message, response.status, response.status === 429 || response.status >= 500)
    }
    return schema.parse(body)
  }

  async listTasks(portalId: string, projectId?: string): Promise<Task[]> {
    const base = projectId
      ? `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks`
      : `/api/v3/portal/${encodeURIComponent(portalId)}/mytasks`
    const tasks: Task[] = []
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.request(`${base}?page=${page}&per_page=100`, pageSchema)
      tasks.push(...result.tasks)
      if (result.page_info?.has_next_page !== true && result.tasks.length < 100) break
    }
    return tasks
  }

  async showTask(portalId: string, projectId: string, taskId: string): Promise<Task> {
    const result = await this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      z.union([taskSchema, z.object({ tasks: z.array(taskSchema).min(1) }).transform(({ tasks }) => tasks[0]!)]),
    )
    return result
  }

  async createTask(portalId: string, projectId: string, input: Record<string, unknown>): Promise<Task> {
    return this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks`,
      z.union([taskSchema, z.object({ tasks: z.array(taskSchema).min(1) }).transform(({ tasks }) => tasks[0]!)]),
      { method: 'POST', body: JSON.stringify(input) },
    )
  }

  async updateTask(portalId: string, projectId: string, taskId: string, input: Record<string, unknown>): Promise<Task> {
    return this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      z.union([taskSchema, z.object({ tasks: z.array(taskSchema).min(1) }).transform(({ tasks }) => tasks[0]!)]),
      { method: 'PATCH', body: JSON.stringify(input) },
    )
  }

  async addTimeLog(portalId: string, projectId: string, taskId: string, input: Record<string, unknown>): Promise<string> {
    const result = await this.request(
      `/api/v3/portal/${encodeURIComponent(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/timelogs`,
      z.object({ id: idSchema }).passthrough(),
      { method: 'POST', body: JSON.stringify(input) },
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
