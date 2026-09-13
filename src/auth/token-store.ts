/** Los campos del `AccessToken` de Twurple más el `userId`. Fuera de git. */

import { constants as fsConstants } from 'node:fs'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { z } from 'zod'

export const storedTokenSchema = z.object({
  /** ID numérico del usuario, inmutable. Es la clave para `addUser()`. */
  userId: z.string().min(1),
  /** Login del usuario en el momento de autorizar. Informativo: puede cambiar. */
  userLogin: z.string().nullable().default(null),
  accessToken: z.string().min(1),
  /** `null` solo en tokens muy antiguos que no se pueden refrescar. */
  refreshToken: z.string().nullable(),
  scope: z.array(z.string()),
  expiresIn: z.number().nullable(),
  obtainmentTimestamp: z.number(),
  /**
   * Con qué flujo se obtuvo.
   *
   * Importa para refrescarlo: un token de `device` pertenece a un cliente
   * público y se refresca SIN client secret; uno de `authorization_code`
   * necesita el secreto. Los tokens guardados antes de que existiera este campo
   * son del segundo tipo.
   */
  grant: z.enum(['device', 'authorization_code']).default('authorization_code'),
})

export type StoredToken = z.infer<typeof storedTokenSchema>

export class TokenStoreError extends Error {
  override readonly name = 'TokenStoreError'
}

/**
 * Lee el token guardado.
 *
 * @returns `null` si el fichero no existe todavía (aún no se ha hecho `pnpm auth`).
 * @throws {TokenStoreError} si existe pero está corrupto, para no arrancar a ciegas.
 */
export async function readToken(path: string): Promise<StoredToken | null> {
  const full = resolve(path)

  let raw: string
  try {
    raw = await readFile(full, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new TokenStoreError(`No se pudo leer ${full}: ${(error as Error).message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new TokenStoreError(
      `${full} no es JSON válido. Bórralo y vuelve a ejecutar "pnpm auth".`,
    )
  }

  const parsed = storedTokenSchema.safeParse(json)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('; ')
    throw new TokenStoreError(
      `${full} tiene un formato inesperado (${detail}). Bórralo y vuelve a ejecutar "pnpm auth".`,
    )
  }

  return parsed.data
}

/**
 * Guarda el token de forma atómica: escribe a un temporal y renombra, para que
 * un corte a mitad de escritura no deje un `tokens.json` truncado.
 *
 * Se llama en cada refresco (cada ~4h), así que tiene que ser barato y seguro.
 */
export async function writeToken(path: string, token: StoredToken): Promise<void> {
  const full = resolve(path)
  const tmp = `${full}.tmp`

  await mkdir(dirname(full), { recursive: true })
  await writeFile(tmp, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, full)

  // En Windows es prácticamente un no-op; en POSIX evita dejar el token legible
  // por otros usuarios de la máquina.
  try {
    await chmod(full, fsConstants.S_IRUSR | fsConstants.S_IWUSR)
  } catch {
    /* sin permisos para cambiar el modo: no es motivo para fallar */
  }
}
