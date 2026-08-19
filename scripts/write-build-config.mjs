import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryEnv = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(repositoryEnv)) loadEnvFile(repositoryEnv)

const configured = process.env.OZT_DEFAULT_BROKER_URL?.trim()
const brokerUrl = configured || 'http://127.0.0.1:8787'
const parsed = new URL(brokerUrl)
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
  throw new Error('OZT_DEFAULT_BROKER_URL must use http or https')
}

const output = fileURLToPath(new URL('../packages/core/dist/build-config.json', import.meta.url))
await writeFile(output, `${JSON.stringify({ brokerUrl }, null, 2)}\n`)
