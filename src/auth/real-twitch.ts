import process from 'node:process'

/**
 * Twurple lee `TWURPLE_MOCK_API_PORT` en cada petición y desvía TODAS al mock
 * del Twitch CLI, incluidas las de autenticación — que el mock no sirve (404) y
 * que además no puede emitir ni validar un token del canal real.
 *
 * Se quita durante la llamada y se restaura: el listener sí debe seguir en el mock.
 */
export async function withRealTwitch<T>(fn: () => Promise<T>): Promise<T> {
  const mockPort = process.env.TWURPLE_MOCK_API_PORT
  if (mockPort === undefined) return await fn()

  delete process.env.TWURPLE_MOCK_API_PORT
  try {
    return await fn()
  } finally {
    process.env.TWURPLE_MOCK_API_PORT = mockPort
  }
}
