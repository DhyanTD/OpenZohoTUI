import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { credentialSchema, type Credential } from './schemas.js'
import { dataDirectory } from './state.js'

const keyFileName = 'credential.key'

async function localKey(): Promise<Buffer> {
  const path = join(dataDirectory(), keyFileName)
  try {
    const value = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64url')
    if (value.length !== 32) throw new Error(`Invalid local credential key at ${path}`)
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(dataDirectory(), { recursive: true, mode: 0o700 })
  const generated = randomBytes(32)
  try {
    await writeFile(path, `${generated.toString('base64url')}\n`, { mode: 0o600, flag: 'wx' })
    return generated
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return localKey()
    throw error
  }
}

async function key(): Promise<Buffer> {
  const secret = process.env.OZT_CREDENTIAL_KEY?.trim()
  if (!secret) return localKey()
  if (secret.length < 16) throw new Error('OZT_CREDENTIAL_KEY must contain at least 16 characters when provided')
  return scryptSync(secret, 'open-zoho-tui-v1', 32)
}

export async function writeCredential(value: Credential): Promise<void> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await key(), iv)
  const plaintext = Buffer.from(JSON.stringify(credentialSchema.parse(value)))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
  await mkdir(dataDirectory(), { recursive: true, mode: 0o700 })
  await writeFile(join(dataDirectory(), 'credentials.enc'), payload, { mode: 0o600 })
}

export async function readCredential(): Promise<Credential | undefined> {
  try {
    const payload = Buffer.from(await readFile(join(dataDirectory(), 'credentials.enc'), 'utf8'), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', await key(), payload.subarray(0, 12))
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
