import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { Redis } from 'ioredis'
import { z } from 'zod'

const env = z.object({
  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  REDIS_URL: z.url(),
  BROKER_HOST: z.string().default('127.0.0.1'),
  BROKER_PORT: z.coerce.number().int().positive().default(8787),
  ZOHO_ACCOUNTS_SERVER: z.url().default('https://accounts.zoho.com'),
  ZOHO_PROJECTS_API_ORIGIN: z.url().default('https://projectsapi.zoho.com'),
}).parse(process.env)

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 })
const app = Fastify({
  logger: { redact: ['req.headers.authorization', 'req.body', 'res.body'] },
  bodyLimit: 16 * 1024,
  requestTimeout: 15_000,
})
await app.register(rateLimit, { global: true, max: 60, timeWindow: '1 minute' })

const scopes = [
  'ZohoProjects.portals.READ',
  'ZohoProjects.projects.READ',
  'ZohoProjects.users.READ',
  'ZohoProjects.tasklists.READ',
  'ZohoProjects.tasks.ALL',
  'ZohoProjects.timesheets.ALL',
  'ZohoProjects.custom_fields.READ',
  'AaaServer.profile.Read',
].join(',')

const accountsServers: Record<string, string> = {
  us: 'https://accounts.zoho.com', eu: 'https://accounts.zoho.eu', in: 'https://accounts.zoho.in',
  au: 'https://accounts.zoho.com.au', jp: 'https://accounts.zoho.jp', ca: 'https://accounts.zohocloud.ca',
  sa: 'https://accounts.zoho.sa', uk: 'https://accounts.zoho.uk',
}
const projectsOrigins: Record<string, string> = {
  us: 'https://projectsapi.zoho.com', eu: 'https://projectsapi.zoho.eu', in: 'https://projectsapi.zoho.in',
  au: 'https://projectsapi.zoho.com.au', jp: 'https://projectsapi.zoho.jp', ca: 'https://projectsapi.zohocloud.ca',
  sa: 'https://projectsapi.zoho.sa', uk: 'https://projectsapi.zoho.uk',
}

function locationForAccountsServer(accountsServer: string): string | undefined {
  return Object.entries(accountsServers).find(([, server]) => server === accountsServer)?.[0]
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function credentialMatches(expectedHash: string, credential: string): boolean {
  const actual = Buffer.from(tokenHash(credential))
  const expected = Buffer.from(expectedHash)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

app.get('/health', async () => ({ status: 'ok' }))

app.post('/v1/oauth/device/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_request, reply) => {
  const accountsServer = env.ZOHO_ACCOUNTS_SERVER
  const body = new URLSearchParams({
    grant_type: 'device_request', client_id: env.ZOHO_CLIENT_ID, scope: scopes, access_type: 'offline', prompt: 'consent',
  })
  const response = await fetch(new URL('/oauth/v3/device/code', accountsServer), { method: 'POST', body, signal: AbortSignal.timeout(10_000) })
  const data = z.object({
    user_code: z.string(), device_code: z.string(), interval: z.number(), expires_in: z.number(),
    verification_url: z.url(), verification_uri_complete: z.url().optional(),
  }).parse(await response.json())
  if (!response.ok) return reply.code(502).send({ error: 'Zoho rejected device initiation' })
  const attemptId = randomUUID()
  await redis.set(`device:${attemptId}`, JSON.stringify({ deviceCode: data.device_code, accountsServer }), 'PX', data.expires_in)
  return {
    attemptId, userCode: data.user_code, verificationUrl: data.verification_url,
    verificationUrlComplete: data.verification_uri_complete, intervalMs: data.interval, expiresInMs: data.expires_in,
  }
})

app.get('/v1/oauth/device/:attemptId', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
  const { attemptId } = z.object({ attemptId: z.uuid() }).parse(request.params)
  const raw = await redis.get(`device:${attemptId}`)
  if (!raw) return reply.code(404).send({ error: 'Device attempt expired or consumed' })
  const attempt = z.object({ deviceCode: z.string(), accountsServer: z.url() }).parse(JSON.parse(raw))
  const body = new URLSearchParams({
    client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, grant_type: 'device_token', code: attempt.deviceCode,
  })
  const response = await fetch(new URL('/oauth/v3/device/token', attempt.accountsServer), { method: 'POST', body, signal: AbortSignal.timeout(10_000) })
  const data: unknown = await response.json()
  const pending = z.object({ error: z.enum(['authorization_pending', 'slow_down', 'access_denied', 'expired']) }).safeParse(data)
  if (pending.success) return reply.code(pending.data.error === 'authorization_pending' || pending.data.error === 'slow_down' ? 202 : 400).send(pending.data)
  const otherDc = z.object({ error: z.literal('other_dc'), user_location: z.string() }).safeParse(data)
  if (otherDc.success) {
    const accountsServer = accountsServers[otherDc.data.user_location.toLowerCase()]
    if (!accountsServer) return reply.code(502).send({ error: 'Unsupported Zoho datacenter' })
    const ttl = await redis.pttl(`device:${attemptId}`)
    await redis.set(`device:${attemptId}`, JSON.stringify({ ...attempt, accountsServer }), 'PX', Math.max(ttl, 5_000))
    return reply.code(202).send({ error: 'authorization_pending' })
  }
  const tokens = z.object({ access_token: z.string(), refresh_token: z.string(), api_domain: z.url(), expires_in: z.number() }).parse(data)
  const brokerCredential = randomBytes(32).toString('base64url')
  const location = locationForAccountsServer(attempt.accountsServer)
  const projectsApiOrigin = location ? projectsOrigins[location] : env.ZOHO_PROJECTS_API_ORIGIN
  await redis.multi()
    .del(`device:${attemptId}`)
    .set(`binding:${tokenHash(tokens.refresh_token)}`, tokenHash(brokerCredential), 'EX', 60 * 60 * 24 * 365)
    .exec()
  return {
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token, apiDomain: tokens.api_domain,
    accountsServer: attempt.accountsServer, projectsApiOrigin,
    brokerCredential, expiresIn: tokens.expires_in,
  }
})

const refreshBody = z.object({ refreshToken: z.string().min(1), brokerCredential: z.string().min(1), accountsServer: z.url() })
app.post('/v1/oauth/refresh', { config: { rateLimit: { max: 15, timeWindow: '10 minutes' } } }, async (request, reply) => {
  const input = refreshBody.parse(request.body)
  const binding = await redis.get(`binding:${tokenHash(input.refreshToken)}`)
  if (!binding || !credentialMatches(binding, input.brokerCredential)) return reply.code(401).send({ error: 'Invalid broker credential' })
  const body = new URLSearchParams({
    grant_type: 'refresh_token', client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, refresh_token: input.refreshToken,
  })
  const response = await fetch(new URL('/oauth/v2/token', input.accountsServer), { method: 'POST', body, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) return reply.code(502).send({ error: 'Zoho rejected token refresh' })
  const data = z.object({ access_token: z.string(), api_domain: z.url(), expires_in: z.number() }).parse(await response.json())
  return { accessToken: data.access_token, apiDomain: data.api_domain, expiresIn: data.expires_in }
})

app.post('/v1/oauth/revoke', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
  const input = refreshBody.parse(request.body)
  const key = `binding:${tokenHash(input.refreshToken)}`
  const binding = await redis.get(key)
  if (!binding || !credentialMatches(binding, input.brokerCredential)) return reply.code(401).send({ error: 'Invalid broker credential' })
  const authorization = Buffer.from(`${env.ZOHO_CLIENT_ID}:${env.ZOHO_CLIENT_SECRET}`).toString('base64')
  const response = await fetch(new URL('/oauth/v2/revoke/token', input.accountsServer), {
    method: 'POST', headers: { authorization: `Basic ${authorization}` },
    body: new URLSearchParams({ token: input.refreshToken, token_type: 'refresh_token' }), signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return reply.code(502).send({ error: 'Zoho rejected token revocation' })
  await redis.del(key)
  return reply.code(204).send()
})

await redis.connect()
await app.listen({ host: env.BROKER_HOST, port: env.BROKER_PORT })
