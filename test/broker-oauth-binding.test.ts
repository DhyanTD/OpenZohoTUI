import { describe, expect, it } from 'vitest'
import {
  createTrustedAccountsServerOrigins,
  resolveOAuthBinding,
  serializeOAuthBinding,
} from '../packages/broker/src/oauth-binding.js'

const credentialHash = 'a'.repeat(64)
const trustedOrigins = createTrustedAccountsServerOrigins([
  'https://accounts.zoho.com',
  'https://accounts.zoho.in',
])

describe('broker OAuth bindings', () => {
  it('uses the server stored during login instead of a client-supplied server', () => {
    const stored = serializeOAuthBinding({ credentialHash, accountsServer: 'https://accounts.zoho.in' })

    expect(resolveOAuthBinding(stored, 'https://attacker.example', trustedOrigins)).toEqual({
      credentialHash,
      accountsServer: 'https://accounts.zoho.in',
    })
  })

  it('rejects an untrusted server injected into a stored binding', () => {
    const stored = JSON.stringify({ credentialHash, accountsServer: 'https://attacker.example' })

    expect(resolveOAuthBinding(stored, 'https://accounts.zoho.in', trustedOrigins)).toBeUndefined()
  })

  it('allows legacy hash-only bindings only with a trusted accounts-server origin', () => {
    expect(resolveOAuthBinding(credentialHash, 'https://accounts.zoho.com/oauth/v2/token', trustedOrigins)).toEqual({
      credentialHash,
      accountsServer: 'https://accounts.zoho.com',
    })
    expect(resolveOAuthBinding(credentialHash, 'https://accounts.zoho.com.attacker.example', trustedOrigins)).toBeUndefined()
    expect(resolveOAuthBinding(credentialHash, 'https://accounts.zoho.com@attacker.example', trustedOrigins)).toBeUndefined()
  })
})
