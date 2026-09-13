/**
 * Tests del flujo de código de dispositivo — escritos ANTES de la implementación.
 *
 * Las formas de respuesta de aquí están tomadas de llamadas reales a
 * id.twitch.tv, no del RFC: Twitch NO usa el formato estándar de OAuth para los
 * errores. Donde el estándar dice `{"error":"authorization_pending"}`, Twitch
 * responde `{"status":400,"message":"authorization_pending"}`. Dar por buena la
 * forma estándar deja el sondeo colgado para siempre.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  parseDeviceCodeResponse,
  parsePollResponse,
  pollForToken,
  type DeviceCodeStartT,
} from '../../src/auth/device-flow.js'

/** Respuesta real de POST https://id.twitch.tv/oauth2/device */
const DEVICE_RESPONSE = {
  device_code: 'Lh1WsJGMWsmyNZzuauECp3i3GVPMtwUmendZ1TMX',
  expires_in: 1800,
  interval: 5,
  user_code: 'RCSKBYCN',
  verification_uri: 'https://www.twitch.tv/activate?device-code=RCSKBYCN',
}

const now = new Date('2026-09-13T03:00:00.000Z')

describe('parseDeviceCodeResponse', () => {
  it('lee la respuesta real de Twitch', () => {
    const start = parseDeviceCodeResponse(DEVICE_RESPONSE, now)

    expect(start).toEqual({
      deviceCode: 'Lh1WsJGMWsmyNZzuauECp3i3GVPMtwUmendZ1TMX',
      userCode: 'RCSKBYCN',
      verificationUri: 'https://www.twitch.tv/activate?device-code=RCSKBYCN',
      expiresAt: new Date('2026-09-13T03:30:00.000Z'),
      intervalMs: 5000,
    })
  })

  it('usa 5 segundos si Twitch no dice cada cuánto sondear', () => {
    const { interval: _omitted, ...sinIntervalo } = DEVICE_RESPONSE
    expect(parseDeviceCodeResponse(sinIntervalo, now).intervalMs).toBe(5000)
  })

  it('rechaza una respuesta a la que le falta el código', () => {
    expect(() => parseDeviceCodeResponse({ expires_in: 1800 }, now)).toThrow()
  })
})

describe('parsePollResponse', () => {
  /** El caso normal: el streamer aún no ha ido a twitch.tv/activate. */
  it('reconoce que sigue pendiente, con el formato propio de Twitch', () => {
    expect(parsePollResponse(400, { status: 400, message: 'authorization_pending' })).toEqual({
      status: 'pending',
    })
  })

  it('reconoce también el formato estándar, por si Twitch se alinea algún día', () => {
    expect(parsePollResponse(400, { error: 'authorization_pending' })).toEqual({ status: 'pending' })
  })

  it('reconoce que hay que sondear más despacio', () => {
    expect(parsePollResponse(400, { status: 400, message: 'slow_down' })).toEqual({
      status: 'slow_down',
    })
  })

  /** Pasa cuando caduca el código o cuando se manda uno que no existe. */
  it('reconoce un código caducado o inválido', () => {
    expect(parsePollResponse(400, { status: 400, message: 'invalid device code' })).toEqual({
      status: 'expired',
    })
    expect(parsePollResponse(400, { error: 'expired_token' })).toEqual({ status: 'expired' })
  })

  it('reconoce que el usuario ha dicho que no', () => {
    expect(parsePollResponse(400, { status: 400, message: 'access_denied' })).toMatchObject({
      status: 'denied',
    })
  })

  it('convierte el token cuando sale bien', () => {
    const result = parsePollResponse(
      200,
      {
        access_token: 'acceso',
        refresh_token: 'refresco',
        expires_in: 14_400,
        scope: ['channel:read:subscriptions'],
        token_type: 'bearer',
      },
      now,
    )

    expect(result).toEqual({
      status: 'ok',
      token: {
        accessToken: 'acceso',
        refreshToken: 'refresco',
        expiresIn: 14_400,
        scope: ['channel:read:subscriptions'],
        obtainmentTimestamp: now.getTime(),
      },
    })
  })

  /** Un mensaje que no conocemos no puede tratarse como "sigue esperando". */
  it('trata un error desconocido como fallo, no como pendiente', () => {
    const result = parsePollResponse(400, { status: 400, message: 'algo que no esperábamos' })
    expect(result.status).toBe('failed')
  })
})

describe('pollForToken', () => {
  const start: DeviceCodeStartT = {
    deviceCode: 'abc',
    userCode: 'RCSKBYCN',
    verificationUri: 'https://www.twitch.tv/activate',
    expiresAt: new Date(now.getTime() + 1800_000),
    intervalMs: 1000,
  }

  const token = {
    accessToken: 'acceso',
    refreshToken: 'refresco',
    expiresIn: 14_400,
    scope: ['channel:read:subscriptions'],
    obtainmentTimestamp: now.getTime(),
  }

  it('sondea hasta que el streamer autoriza', async () => {
    const respuestas = [
      { status: 'pending' as const },
      { status: 'pending' as const },
      { status: 'ok' as const, token },
    ]
    const poll = vi.fn(async () => respuestas.shift() ?? { status: 'pending' as const })

    const result = await pollForToken(start, {
      poll,
      sleep: async () => undefined,
      now: () => now,
    })

    expect(result).toEqual(token)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('espera el intervalo que pide Twitch entre sondeos', async () => {
    const esperas: number[] = []
    const respuestas = [{ status: 'pending' as const }, { status: 'ok' as const, token }]

    await pollForToken(start, {
      poll: async () => respuestas.shift() ?? { status: 'pending' as const },
      sleep: async (ms) => {
        esperas.push(ms)
      },
      now: () => now,
    })

    expect(esperas).toEqual([1000, 1000])
  })

  /** Si Twitch pide calma, hay que hacerle caso o acabará bloqueando. */
  it('alarga el intervalo cuando Twitch dice slow_down', async () => {
    const esperas: number[] = []
    const respuestas = [{ status: 'slow_down' as const }, { status: 'ok' as const, token }]

    await pollForToken(start, {
      poll: async () => respuestas.shift() ?? { status: 'pending' as const },
      sleep: async (ms) => {
        esperas.push(ms)
      },
      now: () => now,
    })

    expect(esperas[1]).toBeGreaterThan(1000)
  })

  it('se rinde cuando el código caduca', async () => {
    let current = now
    await expect(
      pollForToken(start, {
        poll: async () => ({ status: 'pending' }),
        sleep: async () => {
          // Cada espera adelanta el reloj un minuto.
          current = new Date(current.getTime() + 60_000)
        },
        now: () => current,
      }),
    ).rejects.toThrow(/caduc/i)
  })

  it('se rinde si Twitch dice que el código ya no vale', async () => {
    await expect(
      pollForToken(start, {
        poll: async () => ({ status: 'expired' }),
        sleep: async () => undefined,
        now: () => now,
      }),
    ).rejects.toThrow(/caduc/i)
  })

  it('avisa si el streamer deniega el acceso', async () => {
    await expect(
      pollForToken(start, {
        poll: async () => ({ status: 'denied', detail: 'access_denied' }),
        sleep: async () => undefined,
        now: () => now,
      }),
    ).rejects.toThrow(/no autorizaste|denegó|cancel/i)
  })

  it('propaga un error desconocido en vez de sondear para siempre', async () => {
    await expect(
      pollForToken(start, {
        poll: async () => ({ status: 'failed', detail: 'vaya' }),
        sleep: async () => undefined,
        now: () => now,
      }),
    ).rejects.toThrow(/vaya/)
  })

  it('se puede cancelar desde fuera', async () => {
    const controller = new AbortController()
    const promise = pollForToken(start, {
      poll: async () => ({ status: 'pending' }),
      sleep: async () => controller.abort(),
      now: () => now,
      signal: controller.signal,
    })

    await expect(promise).rejects.toThrow(/cancel/i)
  })
})
