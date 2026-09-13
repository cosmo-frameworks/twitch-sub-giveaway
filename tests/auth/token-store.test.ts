import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { beforeEach, describe, expect, it } from 'vitest'

import { readToken, TokenStoreError, writeToken, type StoredToken } from '../../src/auth/token-store.js'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'twitch-tokens-'))
  path = join(dir, 'tokens.json')
})

const token: StoredToken = {
  userId: '123456',
  userLogin: 'elstreamer',
  accessToken: 'access-abc',
  refreshToken: 'refresh-def',
  scope: ['channel:read:subscriptions'],
  expiresIn: 14_400,
  obtainmentTimestamp: 1_700_000_000_000,
  grant: 'authorization_code',
}

describe('readToken / writeToken', () => {
  it('guarda y recupera el token intacto', async () => {
    await writeToken(path, token)
    expect(await readToken(path)).toEqual(token)
  })

  it('devuelve null si todavía no se ha hecho "pnpm auth"', async () => {
    expect(await readToken(join(dir, 'no-existe.json'))).toBeNull()
  })

  it('crea el directorio si hace falta', async () => {
    const nested = join(dir, 'a', 'b', 'tokens.json')
    await writeToken(nested, token)
    expect(await readToken(nested)).toEqual(token)
  })

  it('no deja ficheros temporales tras escribir', async () => {
    await writeToken(path, token)
    const files = await readdir(dir)
    expect(files).toEqual(['tokens.json'])
  })

  it('sobrescribe el token anterior (cada refresco invalida el refresh token previo)', async () => {
    await writeToken(path, token)
    await writeToken(path, { ...token, accessToken: 'access-nuevo', refreshToken: 'refresh-nuevo' })

    const read = await readToken(path)
    expect(read?.accessToken).toBe('access-nuevo')
    expect(read?.refreshToken).toBe('refresh-nuevo')
  })

  it('explica qué hacer si el fichero no es JSON válido', async () => {
    await writeFile(path, '{ esto no es json')
    await expect(readToken(path)).rejects.toThrow(TokenStoreError)
    await expect(readToken(path)).rejects.toThrow(/pnpm auth/)
  })

  it('explica qué hacer si al fichero le faltan campos', async () => {
    await writeFile(path, JSON.stringify({ accessToken: 'solo-esto' }))
    await expect(readToken(path)).rejects.toThrow(/formato inesperado/)
  })

  it('acepta refreshToken null (tokens antiguos que no caducan)', async () => {
    await writeToken(path, { ...token, refreshToken: null, expiresIn: null })
    const read = await readToken(path)
    expect(read?.refreshToken).toBeNull()
    expect(read?.expiresIn).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('guarda el fichero como 600', async () => {
    const { stat } = await import('node:fs/promises')
    await writeToken(path, token)
    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('escribe JSON legible, por si hay que mirarlo a mano', async () => {
    await writeToken(path, token)
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('\n  "userId"')
    expect(raw.endsWith('\n')).toBe(true)
  })
})
