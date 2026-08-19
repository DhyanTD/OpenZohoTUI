import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  billingSchema,
  configSchema,
  deleteCredential,
  parseDuration,
  readConfig,
  readCredential,
  readState,
  stopTimer as buildStoppedLog,
  updateState,
  writeConfig,
  writeCredential,
  type ActiveTimer,
  type Config,
  type PendingLog,
} from '@open-zoho-tui/core'
import {
  describeZohoError,
  resolveTask,
  ZohoError,
  ZohoProjectsClient,
  type ModuleField,
  type Portal,
  type Project,
  type ProjectUser,
  type Task,
  type TaskList,
  type TaskStatus,
} from '@open-zoho-tui/zoho-client'

export interface DeviceLogin {
  attemptId: string
  userCode: string
  verificationUrl: string
  verificationUrlComplete?: string | undefined
  intervalMs: number
  expiresInMs: number
}

interface CompletedLogin {
  accessToken: string
  refreshToken: string
  brokerCredential: string
  apiDomain: string
  accountsServer: string
  projectsApiOrigin: string
  expiresIn: number
}

interface CacheEntry<T> {
  expiresAt: number
  value: Promise<T>
}

export interface TaskCreateInput {
  name: string
  tasklistId?: string
  description?: string
  fields?: Record<string, unknown>
}

export interface TaskUpdateInput {
  name?: string
  statusId?: string
  description?: string
}

export interface StartTimerInput {
  notes?: string
  billing?: 'Billable' | 'Non Billable'
}

export interface StopTimerInput {
  duration?: string
  date?: string
  notes?: string
  billing?: 'Billable' | 'Non Billable'
}

export interface AddTimeInput extends StartTimerInput {
  duration: string
  date?: string
}

const deviceStartSchema = z.object({
  attemptId: z.uuid(),
  userCode: z.string(),
  verificationUrl: z.url(),
  verificationUrlComplete: z.url().optional(),
  intervalMs: z.number(),
  expiresInMs: z.number(),
})

const completedLoginSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  brokerCredential: z.string(),
  apiDomain: z.url(),
  accountsServer: z.url(),
  projectsApiOrigin: z.url(),
  expiresIn: z.number(),
})

const accountUserSchema = z.object({
  Email: z.string().optional(),
  email: z.string().optional(),
}).passthrough()

export function findProjectUserByEmail(users: ProjectUser[], email: string): ProjectUser | undefined {
  const normalized = email.trim().toLowerCase()
  return users.find((user) => user.active !== false && user.email.trim().toLowerCase() === normalized)
}

export function buildTaskCreatePayload(
  input: TaskCreateInput & { tasklistId: string },
  assignee?: ProjectUser,
): Record<string, unknown> {
  return {
    ...(input.fields ?? {}),
    name: input.name,
    tasklist: { id: input.tasklistId },
    ...(assignee ? { assignee: { zpuid: assignee.zpuid } } : {}),
    ...(input.description ? { description: input.description } : {}),
  }
}

export function formatTimeLogHours(minutes: number): string {
  const hours = Math.floor(minutes / 60).toString().padStart(2, '0')
  const remainder = (minutes % 60).toString().padStart(2, '0')
  return `${hours}.${remainder}`
}

export class OztServices {
  private cachedAccessToken: { token: string; expiresAt: number } | undefined
  private readonly cache = new Map<string, CacheEntry<unknown>>()

  private async brokerRequest<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const config = await readConfig()
    const response = await fetch(new URL(path, config.brokerUrl), {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    })
    const body: unknown = response.status === 204 ? {} : await response.json()
    if (!response.ok) {
      const message = z.object({ error: z.string() }).safeParse(body)
      throw new Error(message.success ? message.data.error : `Broker request failed (${response.status})`)
    }
    return schema.parse(body)
  }

  private async accessToken(): Promise<string> {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now() + 30_000) {
      return this.cachedAccessToken.token
    }
    const credential = await readCredential()
    if (!credential) throw new Error('Not authenticated. Sign in from Settings or run ozt auth login')
    const result = await this.brokerRequest('/v1/oauth/refresh', {
      method: 'POST',
      body: JSON.stringify({
        refreshToken: credential.refreshToken,
        brokerCredential: credential.brokerCredential,
        accountsServer: credential.accountsServer,
      }),
    }, z.object({ accessToken: z.string(), apiDomain: z.url(), expiresIn: z.number() }))
    this.cachedAccessToken = { token: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1_000 }
    return result.accessToken
  }

  private async client(): Promise<ZohoProjectsClient> {
    const [config, credential] = await Promise.all([readConfig(), readCredential()])
    if (!credential) throw new Error('Not authenticated. Sign in from Settings or run ozt auth login')
    return new ZohoProjectsClient({
      origin: config.projectsApiOrigin ?? credential.projectsApiOrigin,
      accessToken: () => this.accessToken(),
    })
  }

  private async context(requireProject = false): Promise<{
    client: ZohoProjectsClient
    portalId: string
    projectId?: string
  }> {
    const config = await readConfig()
    if (!config.portalId) throw new Error('Select a portal in Settings')
    if (requireProject && !config.projectId) throw new Error('Select a project in Settings')
    return {
      client: await this.client(),
      portalId: config.portalId,
      ...(config.projectId ? { projectId: config.projectId } : {}),
    }
  }

  private currentUserEmail(): Promise<string> {
    return this.cached('oauth-user-email', 3_600_000, false, async () => {
      const credential = await readCredential()
      if (!credential) throw new Error('Not authenticated. Sign in from Settings or run ozt auth login')
      const response = await fetch(new URL('/oauth/user/info', credential.accountsServer), {
        headers: {
          accept: 'application/json',
          authorization: `Zoho-oauthtoken ${await this.accessToken()}`,
        },
        signal: AbortSignal.timeout(15_000),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Zoho cannot identify your account with the current authorization. Run `ozt auth logout`, then sign in again to grant the profile scope.')
        }
        throw new ZohoError(
          describeZohoError(body, `Zoho account lookup failed (${response.status})`),
          response.status,
          response.status === 429 || response.status >= 500,
        )
      }
      const account = accountUserSchema.parse(body)
      const email = account.Email ?? account.email
      if (!email) throw new Error('Zoho account lookup did not return an email address for the authenticated user')
      return email
    })
  }

  private async currentProjectUser(
    client: ZohoProjectsClient,
    portalId: string,
    projectId: string,
  ): Promise<ProjectUser | undefined> {
    try {
      const [email, users] = await Promise.all([
        this.currentUserEmail(),
        this.cached(
          `users:${portalId}:${projectId}`,
          300_000,
          false,
          () => client.listProjectUsers(portalId, projectId),
        ),
      ])
      return findProjectUserByEmail(users, email)
    } catch {
      // Assignment is a convenience, not a prerequisite for creating a task.
      // Zoho accepts task creation without an assignee, so discovery failures
      // should not prevent the user's primary action.
      return undefined
    }
  }

  private cached<T>(key: string, ttlMs: number, refresh: boolean, load: () => Promise<T>): Promise<T> {
    const existing = this.cache.get(key) as CacheEntry<T> | undefined
    if (!refresh && existing && existing.expiresAt > Date.now()) return existing.value
    const value = load()
    this.cache.set(key, { expiresAt: Date.now() + ttlMs, value })
    void value.catch(() => this.cache.delete(key))
    return value
  }

  clearCache(prefix?: string): void {
    if (!prefix) return this.cache.clear()
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key)
  }

  getConfig(): Promise<Config> {
    return readConfig()
  }

  async setConfig(key: keyof Config, value: string): Promise<Config> {
    const current = await readConfig()
    const next = configSchema.parse({
      ...current,
      [key]: key === 'billing' ? billingSchema.parse(value) : value,
    })
    await writeConfig(next)
    this.clearCache()
    return next
  }

  async unsetConfig(key: keyof Config): Promise<Config> {
    if (key === 'brokerUrl') throw new Error('brokerUrl cannot be unset')
    const current = { ...await readConfig() } as Record<string, unknown>
    delete current[key]
    const next = configSchema.parse(current)
    await writeConfig(next)
    this.clearCache()
    return next
  }

  async initialize(input: {
    portalId: string
    projectId?: string
    tasklistId?: string
    billing?: 'Billable' | 'Non Billable'
    timezone?: string
  }): Promise<Config> {
    const current = await readConfig()
    const next = configSchema.parse({ ...current, ...input })
    await writeConfig(next)
    this.clearCache()
    return next
  }

  async selectPortal(portalId: string): Promise<Config> {
    const current = await readConfig()
    const next = configSchema.parse({ ...current, portalId, projectId: undefined, tasklistId: undefined })
    await writeConfig(next)
    this.clearCache()
    return next
  }

  async selectProject(projectId: string): Promise<Config> {
    const current = await readConfig()
    const next = configSchema.parse({ ...current, projectId, tasklistId: undefined })
    await writeConfig(next)
    this.clearCache('tasks:')
    return next
  }

  async authStatus(): Promise<boolean> {
    return Boolean(await readCredential())
  }

  beginLogin(): Promise<DeviceLogin> {
    return this.brokerRequest('/v1/oauth/device/start', { method: 'POST' }, deviceStartSchema)
  }

  async pollLogin(attemptId: string): Promise<'pending' | 'authenticated'> {
    const config = await readConfig()
    const response = await fetch(new URL(`/v1/oauth/device/${attemptId}`, config.brokerUrl), {
      signal: AbortSignal.timeout(15_000),
    })
    const body: unknown = await response.json()
    if (response.status === 202) return 'pending'
    if (!response.ok) throw new Error(z.object({ error: z.string() }).parse(body).error)
    const result: CompletedLogin = completedLoginSchema.parse(body)
    await writeCredential(result)
    this.cachedAccessToken = { token: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1_000 }
    this.clearCache()
    return 'authenticated'
  }

  async login(onStart?: (login: DeviceLogin) => void): Promise<void> {
    const login = await this.beginLogin()
    onStart?.(login)
    const deadline = Date.now() + login.expiresInMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(5_000, login.intervalMs)))
      if (await this.pollLogin(login.attemptId) === 'authenticated') return
    }
    throw new Error('Device authorization expired')
  }

  async logout(): Promise<void> {
    const credential = await readCredential()
    if (credential) {
      await this.brokerRequest('/v1/oauth/revoke', {
        method: 'POST',
        body: JSON.stringify({
          refreshToken: credential.refreshToken,
          brokerCredential: credential.brokerCredential,
          accountsServer: credential.accountsServer,
        }),
      }, z.object({}))
    }
    await deleteCredential()
    this.cachedAccessToken = undefined
    this.clearCache()
  }

  async listPortals(refresh = false): Promise<Portal[]> {
    return this.cached('portals', 300_000, refresh, async () => (await this.client()).listPortals())
  }

  async listProjects(refresh = false): Promise<Project[]> {
    const { client, portalId } = await this.context()
    return this.cached(`projects:${portalId}`, 300_000, refresh, () => client.listProjects(portalId))
  }

  async listTasks(refresh = false): Promise<Task[]> {
    const { client, portalId, projectId } = await this.context()
    const key = `tasks:${portalId}:${projectId ?? 'mine'}`
    return this.cached(key, 60_000, refresh, () => client.listTasks(portalId, projectId))
  }

  async showTask(reference: string): Promise<Task> {
    const { client, portalId, projectId } = await this.context(true)
    const match = resolveTask(reference, await this.listTasks())
    return client.showTask(portalId, projectId!, match.id)
  }

  async listTaskLists(refresh = false): Promise<TaskList[]> {
    const { client, portalId, projectId } = await this.context(true)
    return this.cached(
      `tasklists:${portalId}:${projectId}`,
      300_000,
      refresh,
      () => client.listTaskLists(portalId, projectId!),
    )
  }

  async listTaskStatuses(refresh = false): Promise<TaskStatus[]> {
    const { client, portalId } = await this.context()
    return this.cached(`statuses:${portalId}`, 300_000, refresh, () => client.listTaskStatuses(portalId))
  }

  async listTaskFields(refresh = false): Promise<ModuleField[]> {
    const { client, portalId } = await this.context()
    return this.cached(`fields:${portalId}`, 300_000, refresh, () => client.listTaskFields(portalId))
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const tasklistId = input.tasklistId ?? (await readConfig()).tasklistId
    if (!tasklistId) {
      throw new Error('Select a task list or configure a default task list before creating a task')
    }
    const { client, portalId, projectId } = await this.context(true)
    const assignee = await this.currentProjectUser(client, portalId, projectId!)
    const task = await client.createTask(
      portalId,
      projectId!,
      buildTaskCreatePayload({ ...input, tasklistId }, assignee),
    )
    this.clearCache('tasks:')
    return task
  }

  async updateTask(reference: string, input: TaskUpdateInput): Promise<Task> {
    const { client, portalId, projectId } = await this.context(true)
    const match = resolveTask(reference, await this.listTasks())
    const task = await client.updateTask(portalId, projectId!, match.id, {
      ...(input.name ? { name: input.name } : {}),
      ...(input.statusId ? { status: { id: input.statusId } } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    this.clearCache('tasks:')
    return task
  }

  async moveTask(reference: string, tasklistId: string): Promise<Task> {
    const { client, portalId, projectId } = await this.context(true)
    const match = resolveTask(reference, await this.listTasks())
    await client.moveTask(portalId, projectId!, match.id, tasklistId)
    const task = await client.showTask(portalId, projectId!, match.id)
    this.clearCache('tasks:')
    return task
  }

  async startTimer(taskRef: string, input: StartTimerInput = {}): Promise<ActiveTimer> {
    const config = await readConfig()
    if (!config.projectId) throw new Error('Select a project before starting a timer')
    const timer: ActiveTimer = {
      id: randomUUID(),
      taskRef,
      projectId: config.projectId,
      startedAt: new Date().toISOString(),
      billing: input.billing ?? config.billing ?? 'Non Billable',
      ...(input.notes ? { notes: input.notes } : {}),
    }
    await updateState((state) => {
      if (state.activeTimer) throw new Error(`A timer is already active for ${state.activeTimer.taskRef}`)
      return { ...state, activeTimer: timer }
    })
    return timer
  }

  async timerStatus(): Promise<ActiveTimer | undefined> {
    return (await readState()).activeTimer
  }

  async cancelTimer(): Promise<void> {
    await updateState(({ activeTimer: _activeTimer, ...state }) => state)
  }

  async stopTimer(input: StopTimerInput = {}): Promise<PendingLog> {
    let pending: PendingLog | undefined
    const config = await readConfig()
    await updateState((state) => {
      if (!state.activeTimer) throw new Error('No active timer')
      const base = buildStoppedLog(
        state.activeTimer,
        new Date(),
        input.duration ? parseDuration(input.duration) : undefined,
        config.timezone,
      )
      pending = {
        ...base,
        ...(input.date ? { date: input.date } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.billing ? { billing: input.billing } : {}),
      }
      const { activeTimer: _activeTimer, ...rest } = state
      return { ...rest, pendingLogs: [...state.pendingLogs, pending] }
    })
    return pending!
  }

  async addTime(taskRef: string, input: AddTimeInput): Promise<PendingLog> {
    const config = await readConfig()
    if (!config.projectId) throw new Error('Select a project before adding time')
    const pending: PendingLog = {
      id: randomUUID(),
      taskRef,
      projectId: config.projectId,
      date: input.date ?? new Date().toISOString().slice(0, 10),
      minutes: parseDuration(input.duration),
      notes: input.notes ?? '',
      billing: input.billing ?? config.billing ?? 'Non Billable',
      state: 'pending',
      createdAt: new Date().toISOString(),
    }
    await updateState((state) => ({ ...state, pendingLogs: [...state.pendingLogs, pending] }))
    return pending
  }

  async listTimeLogs(): Promise<PendingLog[]> {
    return (await readState()).pendingLogs
  }

  async syncTimeLogs(onUpdate?: (log: PendingLog) => void): Promise<PendingLog[]> {
    const { client, portalId } = await this.context()
    const state = await readState()
    const results: PendingLog[] = []
    for (const log of state.pendingLogs.filter(({ state: logState }) => logState === 'pending')) {
      await updateState((current) => ({
        ...current,
        pendingLogs: current.pendingLogs.map((item) => item.id === log.id ? { ...item, state: 'submitting' } : item),
      }))
      try {
        const tasks = await client.listTasks(portalId, log.projectId)
        const match = resolveTask(log.taskRef, tasks)
        const zohoId = await client.addTimeLog(portalId, log.projectId, match.id, {
          date: log.date,
          hours: formatTimeLogHours(log.minutes),
          bill_status: log.billing,
          notes: log.notes,
        })
        const { lastError: _lastError, ...successfulLog } = log
        const next: PendingLog = { ...successfulLog, state: 'submitted', zohoId }
        await updateState((current) => ({
          ...current,
          pendingLogs: current.pendingLogs.map((item) => item.id === log.id ? next : item),
        }))
        results.push(next)
        onUpdate?.(next)
      } catch (error) {
        const next: PendingLog = {
          ...log,
          state: error instanceof ZohoError && error.uncertain ? 'uncertain' : 'pending',
          lastError: error instanceof Error ? error.message : String(error),
        }
        await updateState((current) => ({
          ...current,
          pendingLogs: current.pendingLogs.map((item) => item.id === log.id ? next : item),
        }))
        results.push(next)
        onUpdate?.(next)
      }
    }
    return results
  }
}

export const configKeys = [
  'brokerUrl',
  'portalId',
  'projectId',
  'tasklistId',
  'billing',
  'timezone',
  'projectsApiOrigin',
  'accountsServer',
] as const satisfies readonly (keyof Config)[]

export function isConfigKey(value: string): value is keyof Config {
  return (configKeys as readonly string[]).includes(value)
}
