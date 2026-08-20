import { z } from 'zod'

const credentialHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const storedOAuthBindingSchema = z.object({
  credentialHash: credentialHashSchema,
  accountsServer: z.url(),
})

export type OAuthBinding = z.infer<typeof storedOAuthBindingSchema>

export function accountsServerOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Accounts server must use HTTP or HTTPS')
  return url.origin
}

export function createTrustedAccountsServerOrigins(values: Iterable<string>): ReadonlySet<string> {
  return new Set(Array.from(values, accountsServerOrigin))
}

export function trustedAccountsServerOrigin(value: string, trustedOrigins: ReadonlySet<string>): string | undefined {
  try {
    const origin = accountsServerOrigin(value)
    return trustedOrigins.has(origin) ? origin : undefined
  } catch {
    return undefined
  }
}

export function serializeOAuthBinding(binding: OAuthBinding): string {
  return JSON.stringify(storedOAuthBindingSchema.parse({
    ...binding,
    accountsServer: accountsServerOrigin(binding.accountsServer),
  }))
}

export function resolveOAuthBinding(
  raw: string | null,
  requestedAccountsServer: string | undefined,
  trustedOrigins: ReadonlySet<string>,
): OAuthBinding | undefined {
  if (!raw) return undefined

  try {
    const stored = storedOAuthBindingSchema.safeParse(JSON.parse(raw))
    if (stored.success) {
      const accountsServer = trustedAccountsServerOrigin(stored.data.accountsServer, trustedOrigins)
      if (!accountsServer) return undefined
      return { credentialHash: stored.data.credentialHash, accountsServer }
    }
  } catch {
    // Bindings created before the accounts-server hardening were stored as a bare credential hash.
  }

  const legacyHash = credentialHashSchema.safeParse(raw)
  if (!legacyHash.success || !requestedAccountsServer) return undefined
  const accountsServer = trustedAccountsServerOrigin(requestedAccountsServer, trustedOrigins)
  if (!accountsServer) return undefined
  return { credentialHash: legacyHash.data, accountsServer }
}
