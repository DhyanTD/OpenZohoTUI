import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { z } from 'zod'

export const brokerEnvironmentSchema = z.object({
  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  REDIS_URL: z.url(),
  BROKER_HOST: z.string().default('127.0.0.1'),
  BROKER_PORT: z.coerce.number().int().positive().default(8787),
  ZOHO_ACCOUNTS_SERVER: z.url().default('https://accounts.zoho.com'),
  ZOHO_PROJECTS_API_ORIGIN: z.url().default('https://projectsapi.zoho.com'),
})

export function loadBrokerEnvFile(path = '.env'): void {
  if (existsSync(path)) loadEnvFile(path)
}

export function parseBrokerEnvironment(source: NodeJS.ProcessEnv = process.env) {
  return brokerEnvironmentSchema.parse(source)
}
