import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialSchema, type Credential } from './schemas.js'
import { dataDirectory } from './state.js'

function key(): Buffer {
  const secret = process.env.OZT_CREDENTIAL_KEY
  if (!secret || secret.length < 16) throw new Error('OZT_CREDENTIAL_KEY must contain at least 16 characters')
  return scryptSync(secret, 'open-zoho-tui-v1', 32)
}

export async function writeCredential(value: Credential): Promise<void> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const plaintext = Buffer.from(JSON.stringify(credentialSchema.parse(value)))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
  await mkdir(dataDirectory(), { recursive: true, mode: 0o700 })
  await writeFile(join(dataDirectory(), 'credentials.enc'), payload, { mode: 0o600 })
}

export async function readCredential(): Promise<Credential | undefined> {
  try {
    const payload = Buffer.from(await readFile(join(dataDirectory(), 'credentials.enc'), 'utf8'), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key(), payload.subarray(0, 12))
    decipher.setAuthTag(payload.subarray(12, 28))
    const plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()])
    return credentialSchema.parse(JSON.parse(plaintext.toString('utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function deleteCredential(): Promise<void> {
  await rm(join(dataDirectory(), 'credentials.enc'), { force: true })
}
