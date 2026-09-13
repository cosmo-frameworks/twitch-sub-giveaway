/**
 * El camino de la aplicación instalada: sin client secret —que sería extraíble
 * del ejecutable— y sin redirect URI ni puerto libre, porque no hay callback.
 *
 * Twitch NO sigue el RFC 8628 en los errores: donde el estándar dice
 * `{"error":"authorization_pending"}`, responde
 * `{"status":400,"message":"authorization_pending"}`. Verificado contra
 * id.twitch.tv. Se aceptan las dos formas.
 */

const DEVICE_ENDPOINT = 'https://id.twitch.tv/oauth2/device'
const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token'
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/** Cuánto se alarga el intervalo cada vez que Twitch pide calma. */
const SLOW_DOWN_STEP_MS = 5_000

export interface DeviceCodeStartT {
  /** Secreto que identifica esta espera. No se le enseña al usuario. */
  deviceCode: string
  /** El código corto que el streamer teclea en twitch.tv/activate. */
  userCode: string
  /** URL a la que mandarlo. Twitch ya le mete el código en la query. */
  verificationUri: string
  expiresAt: Date
  intervalMs: number
}

/** Token tal y como lo devuelve Twitch, en la forma que usa Twurple. */
export interface DeviceTokenT {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
  scope: string[]
  obtainmentTimestamp: number
}

export type DevicePollResultT =
  /** El streamer todavía no ha ido a activar. */
  | { status: 'pending' }
  /** Sondeamos demasiado rápido. */
  | { status: 'slow_down' }
  /** El código caducó, o no vale. */
  | { status: 'expired' }
  /** El streamer dijo que no. */
  | { status: 'denied'; detail: string }
  /** Algo que no sabemos interpretar: no se puede seguir sondeando a ciegas. */
  | { status: 'failed'; detail: string }
  | { status: 'ok'; token: DeviceTokenT }

export class DeviceFlowError extends Error {
  override readonly name = 'DeviceFlowError'
}

export function parseDeviceCodeResponse(body: unknown, now: Date): DeviceCodeStartT {
  const data = body as Partial<{
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }>

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new DeviceFlowError(
      'Twitch no devolvió un código de activación válido. Vuelve a intentarlo en un momento.',
    )
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: new Date(now.getTime() + (data.expires_in ?? 1800) * 1000),
    intervalMs: (data.interval ?? 5) * 1000,
  }
}

export function parsePollResponse(
  httpStatus: number,
  body: unknown,
  now: Date = new Date(),
): DevicePollResultT {
  const data = body as Partial<{
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string[]
    // Forma de Twitch.
    message: string
    // Forma del RFC.
    error: string
  }>

  if (httpStatus >= 200 && httpStatus < 300 && data.access_token) {
    return {
      status: 'ok',
      token: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresIn: data.expires_in ?? null,
        scope: data.scope ?? [],
        obtainmentTimestamp: now.getTime(),
      },
    }
  }

  const reason = (data.message ?? data.error ?? '').toLowerCase()

  if (reason.includes('authorization_pending')) return { status: 'pending' }
  if (reason.includes('slow_down')) return { status: 'slow_down' }
  if (reason.includes('access_denied')) {
    return { status: 'denied', detail: data.message ?? data.error ?? 'access_denied' }
  }
  // "invalid device code" es lo que Twitch devuelve cuando caduca.
  if (reason.includes('expired_token') || reason.includes('invalid device code')) {
    return { status: 'expired' }
  }

  return { status: 'failed', detail: data.message ?? data.error ?? `HTTP ${httpStatus}` }
}

export interface PollDeps {
  poll: () => Promise<DevicePollResultT>
  sleep: (ms: number) => Promise<void>
  now: () => Date
  /** Permite abortar desde fuera: cerrar la ventana, cancelar desde el panel. */
  signal?: AbortSignal
}

/**
 * Espera a que el streamer active el código.
 *
 * Sondea cada `intervalMs`, alargando el intervalo si Twitch pide calma —
 * ignorarlo acabaría en un bloqueo temporal.
 */
export async function pollForToken(
  start: DeviceCodeStartT,
  deps: PollDeps,
): Promise<DeviceTokenT> {
  let interval = start.intervalMs

  for (;;) {
    if (deps.signal?.aborted) {
      throw new DeviceFlowError('Conexión cancelada.')
    }

    if (deps.now().getTime() >= start.expiresAt.getTime()) {
      throw new DeviceFlowError(
        'El código ha caducado. Pulsa otra vez en conectar para pedir uno nuevo.',
      )
    }

    await deps.sleep(interval)

    if (deps.signal?.aborted) {
      throw new DeviceFlowError('Conexión cancelada.')
    }

    const result = await deps.poll()

    switch (result.status) {
      case 'ok':
        return result.token

      case 'pending':
        break

      case 'slow_down':
        interval += SLOW_DOWN_STEP_MS
        break

      case 'expired':
        throw new DeviceFlowError(
          'El código ha caducado. Pulsa otra vez en conectar para pedir uno nuevo.',
        )

      case 'denied':
        throw new DeviceFlowError(
          'No autorizaste la aplicación en Twitch. Si fue sin querer, vuelve a intentarlo.',
        )

      case 'failed':
        throw new DeviceFlowError(`Twitch respondió algo inesperado: ${result.detail}`)
    }
  }
}

async function postForm(url: string, params: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    /* Twitch siempre devuelve JSON; si no, `body` queda a null y se trata como fallo. */
  }

  return { status: response.status, body }
}

/** Pide un código nuevo. No necesita client secret. */
export async function requestDeviceCode(input: {
  clientId: string
  scopes: readonly string[]
  now?: () => Date
}): Promise<DeviceCodeStartT> {
  const { status, body } = await postForm(DEVICE_ENDPOINT, {
    client_id: input.clientId,
    scopes: input.scopes.join(' '),
  })

  if (status < 200 || status >= 300) {
    const message = (body as { message?: string } | null)?.message ?? `HTTP ${status}`
    throw new DeviceFlowError(
      `Twitch no dio un código de activación: ${message}. ` +
        'Si esto se repite, puede que la aplicación de Twitch esté mal configurada.',
    )
  }

  return parseDeviceCodeResponse(body, (input.now ?? (() => new Date()))())
}

/** Una pasada de sondeo. La repite `pollForToken`. */
export async function requestDeviceToken(input: {
  clientId: string
  deviceCode: string
  scopes: readonly string[]
}): Promise<DevicePollResultT> {
  const { status, body } = await postForm(TOKEN_ENDPOINT, {
    client_id: input.clientId,
    scopes: input.scopes.join(' '),
    device_code: input.deviceCode,
    grant_type: DEVICE_GRANT_TYPE,
  })

  return parsePollResponse(status, body)
}
