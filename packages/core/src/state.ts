import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import { configSchema, localStateSchema, type Config, type LocalState } from './schemas.js'

export function dataDirectory(): string {
  if (process.env.OZT_DATA_DIR) return process.env.OZT_DATA_DIR
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? homedir(), 'open-zoho-tui')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'open-zoho-tui')
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'open-zoho-tui')
}

async function readValidated<T>(path: string, schema: ZodType<T>, fallback: T): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let lock
  try {
    lock = await open(`${path}.lock`, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another ozt process is modifying local state')
    throw error
  }
  try {
    return await action()
  } finally {
    await lock.close()
    await rm(`${path}.lock`, { force: true })
  }
}

export async function readConfig(): Promise<Config> {
  return readValidated(join(dataDirectory(), 'config.json'), configSchema, {
    brokerUrl: process.env.OZT_BROKER_URL ?? 'http://127.0.0.1:8787',
  })
}

export async function writeConfig(config: Config): Promise<void> {
  await atomicWrite(join(dataDirectory(), 'config.json'), configSchema.parse(config))
}

export async function readState(): Promise<LocalState> {
  return readValidated(join(dataDirectory(), 'state.json'), localStateSchema, { pendingLogs: [] })
}

export async function updateState(change: (state: LocalState) => LocalState): Promise<LocalState> {
  const path = join(dataDirectory(), 'state.json')
  return withLock(path, async () => {
    const next = localStateSchema.parse(change(await readValidated(path, localStateSchema, { pendingLogs: [] })))
    await atomicWrite(path, next)
    return next
  })
}
