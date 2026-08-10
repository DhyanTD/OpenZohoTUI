#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { Command, Option } from 'commander'
import { z } from 'zod'
import {
  billingSchema, configSchema, deleteCredential, parseDuration, readConfig, readCredential, readState,
  stopTimer, updateState, writeConfig, writeCredential, type ActiveTimer, type PendingLog,
} from '@open-zoho-connect/core'
import { resolveTask, ZohoError, ZohoProjectsClient, type Task } from '@open-zoho-connect/zoho-client'
import { runTui } from './tui.js'

const program = new Command().name('ozc').description('Zoho Projects team CLI').version('0.1.0')
program.option('--json', 'emit machine-readable JSON').option('--no-input', 'never prompt')

function output(value: unknown): void {
  if (program.opts().json) process.stdout.write(`${JSON.stringify(value)}\n`)
  else if (typeof value === 'string') process.stdout.write(`${value}\n`)
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function brokerRequest<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const config = await readConfig()
  const response = await fetch(new URL(path, config.brokerUrl), {
    ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })
  const body: unknown = response.status === 204 ? {} : await response.json()
  if (!response.ok) {
    const message = z.object({ error: z.string() }).safeParse(body)
    throw new Error(message.success ? message.data.error : `Broker request failed (${response.status})`)
  }
  return schema.parse(body)
}

let cachedAccessToken: { token: string; expiresAt: number } | undefined
async function accessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) return cachedAccessToken.token
  const credential = await readCredential()
  if (!credential) throw new Error('Not authenticated. Run ozc auth login')
  const result = await brokerRequest('/v1/oauth/refresh', {
    method: 'POST', body: JSON.stringify({
      refreshToken: credential.refreshToken, brokerCredential: credential.brokerCredential, accountsServer: credential.accountsServer,
    }),
  }, z.object({ accessToken: z.string(), apiDomain: z.url(), expiresIn: z.number() }))
  cachedAccessToken = { token: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1_000 }
  return result.accessToken
}

async function clientContext(): Promise<{ client: ZohoProjectsClient; portalId: string; projectId?: string }> {
  const [config, credential] = await Promise.all([readConfig(), readCredential()])
  if (!credential) throw new Error('Not authenticated. Run ozc auth login')
  if (!config.portalId) throw new Error('portalId is not configured')
  return {
    client: new ZohoProjectsClient({ origin: config.projectsApiOrigin ?? credential.projectsApiOrigin, accessToken }),
    portalId: config.portalId,
    ...(config.projectId ? { projectId: config.projectId } : {}),
  }
}

async function tasks(): Promise<Task[]> {
  const { client, portalId, projectId } = await clientContext()
  return client.listTasks(portalId, projectId)
}

const auth = program.command('auth')
auth.command('login').action(async () => {
  const start = await brokerRequest('/v1/oauth/device/start', { method: 'POST' }, z.object({
    attemptId: z.uuid(), userCode: z.string(), verificationUrl: z.url(), verificationUrlComplete: z.url().optional(),
    intervalMs: z.number(), expiresInMs: z.number(),
  }))
  if (program.opts().json) output(start)
  else output(`Open ${start.verificationUrlComplete ?? start.verificationUrl}\nVerification code: ${start.userCode}`)
  const deadline = Date.now() + start.expiresInMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(5_000, start.intervalMs)))
    const config = await readConfig()
    const response = await fetch(new URL(`/v1/oauth/device/${start.attemptId}`, config.brokerUrl), { signal: AbortSignal.timeout(15_000) })
    const body: unknown = await response.json()
    if (response.status === 202) continue
    if (!response.ok) throw new Error(z.object({ error: z.string() }).parse(body).error)
    const result = z.object({
      accessToken: z.string(), refreshToken: z.string(), brokerCredential: z.string(), apiDomain: z.url(),
      accountsServer: z.url(), projectsApiOrigin: z.url(), expiresIn: z.number(),
    }).parse(body)
    await writeCredential(result)
    cachedAccessToken = { token: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1_000 }
    output(program.opts().json ? { authenticated: true } : 'Authenticated')
    return
  }
  throw new Error('Device authorization expired')
})
auth.command('status').action(async () => output({ authenticated: Boolean(await readCredential()) }))
auth.command('logout').action(async () => {
  const credential = await readCredential()
  if (credential) await brokerRequest('/v1/oauth/revoke', {
    method: 'POST', body: JSON.stringify({
      refreshToken: credential.refreshToken, brokerCredential: credential.brokerCredential, accountsServer: credential.accountsServer,
    }),
  }, z.object({}))
  await deleteCredential()
  output(program.opts().json ? { authenticated: false } : 'Logged out')
})

const config = program.command('config')
const configKeys = new Set(['brokerUrl', 'portalId', 'projectId', 'tasklistId', 'billing', 'timezone', 'projectsApiOrigin', 'accountsServer'])
config.command('get').argument('[key]').action(async (key?: string) => {
  if (key && !configKeys.has(key)) throw new Error(`Unknown configuration key: ${key}`)
  const value = await readConfig()
  output(key ? value[key as keyof typeof value] ?? null : value)
})
config.command('set').argument('<key>').argument('<value>').action(async (key: string, value: string) => {
  if (!configKeys.has(key)) throw new Error(`Unknown configuration key: ${key}`)
  const current = await readConfig()
  const next = configSchema.parse({ ...current, [key]: key === 'billing' ? billingSchema.parse(value) : value })
  await writeConfig(next)
  output(program.opts().json ? next : `Set ${key}`)
})
config.command('unset').argument('<key>').action(async (key: string) => {
  if (!configKeys.has(key) || key === 'brokerUrl') throw new Error(`Configuration key cannot be unset: ${key}`)
  const current = { ...await readConfig() } as Record<string, unknown>
  delete current[key]
  const next = configSchema.parse(current)
  await writeConfig(next)
  output(program.opts().json ? next : `Unset ${key}`)
})

program.command('init').requiredOption('--portal <id>').option('--project <id>').option('--tasklist <id>')
  .addOption(new Option('--billing <value>').choices(['Billable', 'Non Billable']))
  .option('--timezone <iana>').action(async (options) => {
    const current = await readConfig()
    const next = configSchema.parse({
      ...current, portalId: options.portal, projectId: options.project, tasklistId: options.tasklist,
      billing: options.billing, timezone: options.timezone,
    })
    await writeConfig(next)
    output(program.opts().json ? next : 'Configuration initialized')
  })

const task = program.command('task')
task.command('list').action(async () => output(await tasks()))
task.command('show').argument('<reference>').action(async (reference: string) => {
  const context = await clientContext()
  if (!context.projectId) throw new Error('projectId is required to show a task')
  const match = resolveTask(reference, await context.client.listTasks(context.portalId, context.projectId))
  output(await context.client.showTask(context.portalId, context.projectId, match.id))
})
task.command('create').requiredOption('--name <name>').option('--tasklist <id>').option('--description <text>')
  .option('--field <name=value...>').action(async (options) => {
    const context = await clientContext()
    if (!context.projectId) throw new Error('projectId is required to create a task')
    const fields = Object.fromEntries((options.field ?? []).map((entry: string) => {
      const index = entry.indexOf('=')
      if (index < 1) throw new Error(`Invalid custom field: ${entry}`)
      return [entry.slice(0, index), entry.slice(index + 1)]
    }))
    output(await context.client.createTask(context.portalId, context.projectId, {
      name: options.name, ...(options.tasklist ? { tasklist_id: options.tasklist } : {}),
      ...(options.description ? { description: options.description } : {}), custom_fields: fields,
    }))
  })
task.command('update').argument('<reference>').option('--name <name>').option('--status <id>').option('--description <text>')
  .action(async (reference: string, options) => {
    const context = await clientContext()
    if (!context.projectId) throw new Error('projectId is required to update a task')
    const match = resolveTask(reference, await context.client.listTasks(context.portalId, context.projectId))
    output(await context.client.updateTask(context.portalId, context.projectId, match.id, {
      ...(options.name ? { name: options.name } : {}), ...(options.status ? { status_id: options.status } : {}),
      ...(options.description ? { description: options.description } : {}),
    }))
  })
task.command('move').argument('<reference>').requiredOption('--tasklist <id>').action(async (reference: string, options) => {
  const context = await clientContext()
  if (!context.projectId) throw new Error('projectId is required to move a task')
  const match = resolveTask(reference, await context.client.listTasks(context.portalId, context.projectId))
  output(await context.client.updateTask(context.portalId, context.projectId, match.id, { tasklist_id: options.tasklist }))
})

const time = program.command('time')
time.command('start').argument('<task>').option('--notes <text>').addOption(new Option('--billing <value>').choices(['Billable', 'Non Billable']))
  .action(async (taskRef: string, options) => {
    const config = await readConfig()
    if (!config.projectId) throw new Error('projectId is required to start a timer')
    const timer: ActiveTimer = {
      id: randomUUID(), taskRef, projectId: config.projectId, startedAt: new Date().toISOString(),
      billing: options.billing ?? config.billing ?? 'Non Billable', ...(options.notes ? { notes: options.notes } : {}),
    }
    await updateState((state) => {
      if (state.activeTimer) throw new Error(`Timer ${state.activeTimer.id} is already active`)
      return { ...state, activeTimer: timer }
    })
    output(timer)
  })
time.command('status').action(async () => output((await readState()).activeTimer ?? { active: false }))
time.command('cancel').action(async () => {
  await updateState(({ activeTimer: _activeTimer, ...state }) => state)
  output(program.opts().json ? { active: false } : 'Timer cancelled')
})
time.command('stop').option('--duration <duration>').action(async (options) => {
  let pending: PendingLog | undefined
  const config = await readConfig()
  await updateState((state) => {
    if (!state.activeTimer) throw new Error('No active timer')
    pending = stopTimer(state.activeTimer, new Date(), options.duration ? parseDuration(options.duration) : undefined, config.timezone)
    const { activeTimer: _activeTimer, ...rest } = state
    return { ...rest, pendingLogs: [...state.pendingLogs, pending] }
  })
  output(pending)
})
time.command('add').argument('<task>').requiredOption('--duration <duration>').option('--date <yyyy-mm-dd>')
  .option('--notes <text>').addOption(new Option('--billing <value>').choices(['Billable', 'Non Billable']))
  .action(async (taskRef: string, options) => {
    const config = await readConfig()
    if (!config.projectId) throw new Error('projectId is required to add time')
    const pending: PendingLog = {
      id: randomUUID(), taskRef, projectId: config.projectId, date: options.date ?? new Date().toISOString().slice(0, 10),
      minutes: parseDuration(options.duration), notes: options.notes ?? '', billing: options.billing ?? config.billing ?? 'Non Billable',
      state: 'pending', createdAt: new Date().toISOString(),
    }
    await updateState((state) => ({ ...state, pendingLogs: [...state.pendingLogs, pending] }))
    output(pending)
  })
time.command('list').action(async () => output((await readState()).pendingLogs))
time.command('sync').action(async () => {
  const context = await clientContext()
  const state = await readState()
  const results: PendingLog[] = []
  for (const log of state.pendingLogs.filter(({ state }) => state === 'pending')) {
    await updateState((current) => ({ ...current, pendingLogs: current.pendingLogs.map((item) => item.id === log.id ? { ...item, state: 'submitting' } : item) }))
    try {
      const match = resolveTask(log.taskRef, await context.client.listTasks(context.portalId, log.projectId))
      const zohoId = await context.client.addTimeLog(context.portalId, log.projectId, match.id, {
        date: log.date, hours: `${Math.floor(log.minutes / 60).toString().padStart(2, '0')}:${(log.minutes % 60).toString().padStart(2, '0')}`,
        bill_status: log.billing, notes: log.notes, unique_key: log.id,
      })
      const next = { ...log, state: 'submitted' as const, zohoId }
      await updateState((current) => ({ ...current, pendingLogs: current.pendingLogs.map((item) => item.id === log.id ? next : item) }))
      results.push(next)
    } catch (error) {
      const next = {
        ...log, state: error instanceof ZohoError && error.uncertain ? 'uncertain' as const : 'pending' as const,
        lastError: error instanceof Error ? error.message : String(error),
      }
      await updateState((current) => ({ ...current, pendingLogs: current.pendingLogs.map((item) => item.id === log.id ? next : item) }))
      results.push(next)
    }
  }
  output(results)
})

async function main(): Promise<void> {
  if (process.argv.length === 2) return runTui(tasks)
  await program.parseAsync(process.argv)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (program.opts().json) process.stdout.write(`${JSON.stringify({ error: message })}\n`)
  else process.stderr.write(`Error: ${message}\n`)
  process.exitCode = error instanceof ZohoError && error.retryable ? 75 : 1
})
