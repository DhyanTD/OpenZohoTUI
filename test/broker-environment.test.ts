import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadBrokerEnvFile, parseBrokerEnvironment } from '../packages/broker/src/environment.js'

const shellKey = 'OZT_TEST_EXPORTED_VALUE'
const fileKey = 'OZT_TEST_FILE_VALUE'

afterEach(() => {
  delete process.env[shellKey]
  delete process.env[fileKey]
})

describe('broker environment', () => {
  it('loads .env values without overriding values exported by the shell', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ozt-broker-env-'))
    const path = join(directory, '.env')
    process.env[shellKey] = 'from-shell'
    try {
      await writeFile(path, `${shellKey}=from-file\n${fileKey}=from-file\n`)
      loadBrokerEnvFile(path)
      expect(process.env[shellKey]).toBe('from-shell')
      expect(process.env[fileKey]).toBe('from-file')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('applies broker defaults after loading required values', () => {
    expect(parseBrokerEnvironment({
      ZOHO_CLIENT_ID: 'client', ZOHO_CLIENT_SECRET: 'secret', REDIS_URL: 'redis://127.0.0.1:6379',
    })).toMatchObject({
      BROKER_HOST: '127.0.0.1', BROKER_PORT: 8787,
      ZOHO_ACCOUNTS_SERVER: 'https://accounts.zoho.com',
      ZOHO_PROJECTS_API_ORIGIN: 'https://projectsapi.zoho.com',
    })
  })
})
