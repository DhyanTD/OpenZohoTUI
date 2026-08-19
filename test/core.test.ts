import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  elapsedMinutes,
  parseDuration,
  readCredential,
  resolveBrokerUrl,
  stopTimer,
  writeCredential,
} from '@dhyantd/open-zoho-tui-core'
import { resolveTask } from '@dhyantd/open-zoho-tui-zoho-client'

const originalDataDirectory = process.env.OZT_DATA_DIR
const originalCredentialKey = process.env.OZT_CREDENTIAL_KEY

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.OZT_DATA_DIR
  else process.env.OZT_DATA_DIR = originalDataDirectory
  if (originalCredentialKey === undefined) delete process.env.OZT_CREDENTIAL_KEY
  else process.env.OZT_CREDENTIAL_KEY = originalCredentialKey
})

describe('parseDuration', () => {
  it.each([['90', 90], ['1h30m', 90], ['2h', 120], ['45m', 45], ['01:30', 90]])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected)
  })

  it('rejects invalid minutes', () => expect(() => parseDuration('1:90')).toThrow('Invalid duration'))
})

describe('timers', () => {
  it('rounds elapsed time to the nearest minute with a one-minute minimum', () => {
    expect(elapsedMinutes('2026-08-10T10:00:00.000Z', new Date('2026-08-10T10:00:29.000Z'))).toBe(1)
    expect(elapsedMinutes('2026-08-10T10:00:00.000Z', new Date('2026-08-10T10:01:31.000Z'))).toBe(2)
  })

  it('converts an active timer into a pending log', () => {
    const log = stopTimer({
      id: crypto.randomUUID(), taskRef: 'ABC-T1', projectId: 'p1', startedAt: '2026-08-10T10:00:00.000Z', billing: 'Billable',
    }, new Date('2026-08-10T10:30:00.000Z'))
    expect(log).toMatchObject({ taskRef: 'ABC-T1', minutes: 30, state: 'pending', date: '2026-08-10' })
  })

  it('attributes a stopped timer to the configured local date', () => {
    const log = stopTimer({
      id: crypto.randomUUID(), taskRef: 'ABC-T1', projectId: 'p1', startedAt: '2026-08-10T23:30:00.000Z', billing: 'Billable',
    }, new Date('2026-08-11T00:30:00.000Z'), undefined, 'America/Los_Angeles')
    expect(log.date).toBe('2026-08-10')
  })
})

describe('resolveTask', () => {
  const tasks = [
    { id: '1', key: 'ABC-T1', name: 'Build command' },
    { id: '2', key: 'ABC-T2', name: 'Build broker' },
  ]

  it('prioritizes exact keys', () => expect(resolveTask('abc-t1', tasks).id).toBe('1'))
  it('resolves a unique name fragment', () => expect(resolveTask('broker', tasks).id).toBe('2'))
  it('rejects ambiguous fragments', () => expect(() => resolveTask('build', tasks)).toThrow('Ambiguous'))
})

describe('local configuration defaults', () => {
  it('uses runtime, saved, bundled, and localhost broker URLs in precedence order', () => {
    expect(resolveBrokerUrl({ runtime: 'https://runtime.example', saved: 'https://saved.example', bundled: 'https://bundled.example' }))
      .toBe('https://runtime.example')
    expect(resolveBrokerUrl({ saved: 'https://saved.example', bundled: 'https://bundled.example' })).toBe('https://saved.example')
    expect(resolveBrokerUrl({ bundled: 'https://bundled.example' })).toBe('https://bundled.example')
    expect(resolveBrokerUrl({})).toBe('http://127.0.0.1:8787')
  })

  it('generates and reuses a secure local credential key when the environment override is empty', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ozt-core-test-'))
    process.env.OZT_DATA_DIR = directory
    process.env.OZT_CREDENTIAL_KEY = ''
    const credential = {
      refreshToken: 'refresh', brokerCredential: 'binding',
      accountsServer: 'https://accounts.zoho.in', apiDomain: 'https://www.zohoapis.in',
      projectsApiOrigin: 'https://projectsapi.zoho.in',
    }
    try {
      await writeCredential(credential)
      await expect(readCredential()).resolves.toEqual(credential)
      const storedKey = (await readFile(join(directory, 'credential.key'), 'utf8')).trim()
      expect(Buffer.from(storedKey, 'base64url')).toHaveLength(32)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
