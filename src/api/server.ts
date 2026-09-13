/** Sirve también el panel compilado: en producción todo sale del mismo puerto. */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { AuthStatus } from '../auth/status.js'
import type { AppConfig } from '../config.js'
import type { Db } from '../db/client.js'
import { entriesByParticipant, giveawayTotals } from '../db/repositories/entries.js'
import {
  closeGiveaway,
  getGiveaway,
  listGiveawaysWithTotals,
  openNewGiveaway,
  reopenGiveaway,
} from '../db/repositories/giveaways.js'
import { addManualEntries } from '../db/manual.js'
import {
  latestEntryAt,
  pastWinnerRefs,
  recordDraw,
  ticketsForDraw,
  winnersBySeed,
  winnersForGiveaway,
  winnersInInsertionOrder,
} from '../db/repositories/winners.js'
import { draw } from '../draw/draw.js'
import { generateSeed } from '../draw/rng.js'
import { writeSettings } from '../settings.js'
import { exportFilename, participantsToCsv, winnersToCsv } from './export.js'
import type { DeviceSessionStateT } from '../auth/device-session.js'
import type { PanelEvents } from './events.js'

export interface ApiServerOptions {
  db: Db
  config: AppConfig
  authStatus: AuthStatus
  events: PanelEvents
  eventSubConnected: () => boolean
  /** `null` mientras no haya canal conectado: no se sabría de quién es el sorteo. */
  activeGiveawayId: () => string | null
  broadcasterLogin?: () => string | null
  deviceSession?: {
    state: DeviceSessionStateT
    start: () => Promise<DeviceSessionStateT>
    cancel: () => void
  }
  /** Lo inyecta index.ts para no acoplar la API al auth. */
  reauthorize?: () => Promise<void>
  /** Para las entradas manuales: `entries` guarda `user_id`, no nombres. */
  resolveUser?: (
    login: string,
  ) => Promise<{ userId: string; login: string; displayName: string } | null>
  /** `undefined` = búscala; `null` = no hay panel (tests). */
  panelDist?: string | null
}

/** Cambia de sitio entre desarrollo y bundle. */
function findPanelDist(): string | null {
  const candidates = [
    fileURLToPath(new URL('../../panel/dist', import.meta.url)),
    fileURLToPath(new URL('./panel', import.meta.url)),
    resolve(process.cwd(), 'panel/dist'),
  ]
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? null
}

export async function createApiServer(options: ApiServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  // El dev server de Vite corre en otro puerto. En producción el panel sale de
  // este mismo servidor y CORS no llega a usarse.
  await app.register(cors, { origin: true })
  await app.register(websocket)

  app.get('/api/status', () => {
    const auth = options.authStatus.current
    const giveawayId = options.activeGiveawayId()
    return {
      ok: true,
      status: {
        broadcaster: options.broadcasterLogin?.() ?? null,
        // El panel necesita saber a qué sorteo conectarse; es lo primero que pide.
        giveaway: giveawayId ? (getGiveaway(options.db, giveawayId) ?? null) : null,
        auth: {
          state: auth.state,
          detail: auth.detail,
          expiresAt: auth.expiresAt?.toISOString() ?? null,
        },
        eventSub: { connected: options.eventSubConnected() },
        device: options.deviceSession?.state ?? { state: 'idle' },
        storage: {
          dataDir: options.config.dataDir,
          dbPath: options.config.db.path,
          dbSource: options.config.db.source,
        },
      },
    }
  })

  /**
   * Devuelve en cuanto tiene el código: ir a twitch.tv/activate puede llevar
   * minutos y la petición HTTP no puede esperar. El progreso se consulta con GET.
   */
  app.post('/api/auth/device', async (_request, reply) => {
    if (!options.deviceSession) {
      return await reply.code(501).send({ ok: false, error: 'No disponible en este proceso.' })
    }
    return { ok: true, device: await options.deviceSession.start() }
  })

  app.get('/api/auth/device', () => ({
    ok: true,
    device: options.deviceSession?.state ?? { state: 'idle' },
  }))

  app.delete('/api/auth/device', () => {
    options.deviceSession?.cancel()
    return { ok: true }
  })

  /** OAuth por navegador: el camino de servidor. La app instalada usa dispositivo. */
  app.post('/api/auth/reauthorize', async (_request, reply) => {
    if (!options.reauthorize) {
      return await reply.code(501).send({ ok: false, error: 'No disponible en este proceso.' })
    }

    if (!options.config.twitch.clientSecret) {
      return await reply.code(400).send({
        ok: false,
        error:
          'Esta aplicación no lleva client secret. Vuelve a conectar desde Ajustes, ' +
          'que usa el código de activación de Twitch.',
      })
    }

    void options.reauthorize().catch((error: unknown) => {
      app.log.error(`la re-autorización falló: ${(error as Error).message}`)
    })
    return { ok: true }
  })

  /**
   * Solo escribe `settings.json`: mover la base en caliente con el listener
   * escribiendo sería pedir problemas. Hace falta reiniciar, y se dice.
   */
  app.put<{ Body: { dbPath?: unknown } }>('/api/settings/db-path', async (request, reply) => {
    const dbPath = request.body?.dbPath

    if (dbPath !== null && typeof dbPath !== 'string') {
      return await reply
        .code(400)
        .send({ ok: false, error: 'dbPath debe ser una ruta, o null para volver a la de por defecto.' })
    }

    if (typeof dbPath === 'string' && dbPath.trim() === '') {
      return await reply.code(400).send({ ok: false, error: 'La ruta no puede estar vacía.' })
    }

    try {
      await writeSettings(
        options.config.dataDir,
        dbPath === null ? {} : { dbPath: dbPath as string },
      )
    } catch (error) {
      return await reply.code(500).send({ ok: false, error: (error as Error).message })
    }

    return {
      ok: true,
      restartRequired: true,
      message: 'Guardado. Reinicia la aplicación para empezar a usar la carpeta nueva.',
    }
  })

  app.get<{ Params: { id: string } }>('/api/giveaways/:id', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }
    return { ok: true, giveaway, totals: giveawayTotals(options.db, giveaway.id) }
  })

  app.get<{ Params: { id: string } }>('/api/giveaways/:id/entries', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }

    return {
      ok: true,
      giveaway,
      participants: entriesByParticipant(options.db, giveaway.id),
      totals: giveawayTotals(options.db, giveaway.id),
    }
  })

  const drawBodySchema = z.object({
    winners: z.number().int().min(1).max(100).default(1),
    excludePastWinners: z.boolean().default(true),
    /**
     * Semilla explícita. Si se anuncia ANTES de sortear —en el chat, por
     * ejemplo— el resultado queda comprometido de antemano y nadie puede decir
     * que se repitió la tirada hasta que salió quien tenía que salir.
     */
    seed: z.string().trim().min(1).max(200).optional(),
  })

  app.post<{ Params: { id: string } }>('/api/giveaways/:id/draw', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }

    const parsed = drawBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return await reply.code(400).send({
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
    }

    const body = parsed.data
    const seed = body.seed ?? generateSeed()

    // Repetir la misma semilla devuelve la misma tirada en vez de volver a
    // sortear: evita que un doble clic parezca un segundo sorteo.
    const already = winnersBySeed(options.db, giveaway.id, seed)
    if (already.length > 0) {
      return { ok: true, alreadyDrawn: true, seed, winners: already }
    }

    /**
     * El corte del bote. Se toma el mayor entre "ahora" y la papeleta más
     * reciente para que un reloj desajustado no deje fuera papeletas que sí
     * existen — y para que `verify` pueda recomponer este mismo bote luego.
     */
    const latest = latestEntryAt(options.db, giveaway.id)
    const now = new Date().toISOString()
    const drawnAt = latest && latest > now ? latest : now

    const tickets = ticketsForDraw(options.db, giveaway.id, drawnAt)
    const result = draw({
      tickets,
      winners: body.winners,
      seed,
      exclude: body.excludePastWinners ? pastWinnerRefs(options.db, giveaway.id) : [],
    })

    if (result.winners.length === 0) {
      return await reply.code(409).send({
        ok: false,
        error:
          tickets.length === 0
            ? 'No hay papeletas en este sorteo todavía.'
            : 'No queda nadie por sortear: todos los participantes ya han ganado.',
      })
    }

    const stored = recordDraw(options.db, {
      giveawayId: giveaway.id,
      seed,
      drawnAt,
      winners: result.winners,
    })

    for (const winner of result.winners) {
      options.events.publish({
        type: 'winner.drawn',
        giveawayId: giveaway.id,
        position: winner.position,
        platform: winner.platform,
        userId: winner.userId,
        displayName: winner.displayName,
        seed,
      })
    }

    return { ok: true, alreadyDrawn: false, seed, drawnAt, pool: result.pool, winners: stored }
  })

  /**
   * El bote se acota a las papeletas que existían cuando se sorteó: si no, un
   * sub nuevo posterior haría "fallar" la verificación de una tirada legítima.
   */
  app.get<{ Params: { id: string }; Querystring: { seed?: string } }>(
    '/api/giveaways/:id/verify',
    async (request, reply) => {
      const giveaway = getGiveaway(options.db, request.params.id)
      if (!giveaway) {
        return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
      }

      const seed = request.query.seed
      if (!seed) {
        return await reply
          .code(400)
          .send({ ok: false, error: 'Falta la semilla de la tirada que quieres comprobar.' })
      }

      const stored = winnersBySeed(options.db, giveaway.id, seed)
      if (stored.length === 0) {
        return await reply
          .code(404)
          .send({ ok: false, error: 'No hay ninguna tirada guardada con esa semilla.' })
      }

      const drawnAt = stored[0]?.drawnAt
      const tickets = ticketsForDraw(options.db, giveaway.id, drawnAt)

      // Quién había ganado ya cuando se hizo esta tirada, por orden de
      // registro: dos tiradas seguidas pueden compartir `drawn_at`.
      const history = winnersInInsertionOrder(options.db, giveaway.id)
      const firstOfThisDraw = history.find((w) => w.seed === seed)?.order ?? Infinity
      const previousWinners = history
        .filter((w) => w.order < firstOfThisDraw)
        .map((w) => ({ platform: w.platform, userId: w.userId }))

      const sameAsStored = (candidate: ReturnType<typeof draw>): boolean =>
        candidate.winners.length === stored.length &&
        candidate.winners.every(
          (w, i) =>
            stored[i]?.platform === w.platform &&
            stored[i]?.userId === w.userId &&
            stored[i]?.position === w.position,
        )

      // No se guarda si la tirada excluyó a los ganadores anteriores, así que se
      // prueban las dos posibilidades. Cualquiera de las dos que reproduzca el
      // resultado demuestra que la semilla lo explica.
      const conExclusion = draw({ tickets, winners: stored.length, seed, exclude: previousWinners })
      const sinExclusion = draw({ tickets, winners: stored.length, seed })

      const recomputed = sameAsStored(conExclusion) ? conExclusion : sinExclusion
      const matches = sameAsStored(recomputed)

      return {
        ok: true,
        matches,
        seed,
        drawnAt,
        pool: recomputed.pool,
        stored: stored.map((w) => ({ position: w.position, platform: w.platform, userId: w.userId })),
        recomputed: recomputed.winners.map((w) => ({
          position: w.position,
          platform: w.platform,
          userId: w.userId,
        })),
        explanation: matches
          ? 'La tirada se reproduce exactamente con esta semilla.'
          : 'El resultado no coincide. O el bote de papeletas cambió después de sortear, o alguien tocó la base de datos.',
      }
    },
  )

  app.get<{ Params: { id: string } }>('/api/giveaways/:id/winners', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }
    return { ok: true, winners: winnersForGiveaway(options.db, giveaway.id) }
  })

  const exportQuerySchema = z.object({
    what: z.enum(['participantes', 'ganadores']).default('participantes'),
    format: z.enum(['csv', 'json']).default('csv'),
  })

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/giveaways/:id/export',
    async (request, reply) => {
      const giveaway = getGiveaway(options.db, request.params.id)
      if (!giveaway) {
        return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
      }

      const parsed = exportQuerySchema.safeParse(request.query)
      if (!parsed.success) {
        return await reply
          .code(400)
          .send({ ok: false, error: 'Formato no válido. Usa csv o json.' })
      }

      const { what, format } = parsed.data
      const filename = exportFilename(what, giveaway.name, new Date(), format)

      // `attachment` para que el navegador descargue en vez de pintar el CSV.
      void reply.header('content-disposition', `attachment; filename="${filename}"`)

      if (what === 'ganadores') {
        const rows = winnersForGiveaway(options.db, giveaway.id)
        if (format === 'json') return { ok: true, giveaway, winners: rows }
        return await reply.type('text/csv; charset=utf-8').send(winnersToCsv(rows))
      }

      const rows = entriesByParticipant(options.db, giveaway.id)
      if (format === 'json') {
        return {
          ok: true,
          giveaway,
          totals: giveawayTotals(options.db, giveaway.id),
          participants: rows,
        }
      }
      return await reply.type('text/csv; charset=utf-8').send(participantsToCsv(rows))
    },
  )

  app.get('/api/giveaways', () => ({ ok: true, giveaways: listGiveawaysWithTotals(options.db) }))

  app.post<{ Body: { name?: unknown } }>('/api/giveaways', async (request, reply) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
    if (!name) {
      return await reply.code(400).send({ ok: false, error: 'El sorteo necesita un nombre.' })
    }

    const { opened, closed } = openNewGiveaway(options.db, {
      name,
      at: new Date().toISOString(),
    })

    return {
      ok: true,
      giveaway: opened,
      closed,
      // Ya no hace falta reiniciar: el sorteo al que van las papeletas se
      // resuelve en cada evento, así que el cambio entra en caliente.
      restartRequired: false,
      message: closed
        ? `"${closed.name}" queda archivado. Las papeletas nuevas van al sorteo nuevo.`
        : 'Sorteo abierto. Las papeletas nuevas ya van aquí.',
    }
  })

  app.post<{ Params: { id: string } }>('/api/giveaways/:id/close', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }
    closeGiveaway(options.db, giveaway.id, new Date().toISOString())
    return { ok: true, giveaway: getGiveaway(options.db, giveaway.id) }
  })

  app.post<{ Params: { id: string } }>('/api/giveaways/:id/reopen', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }
    return { ok: true, giveaway: reopenGiveaway(options.db, giveaway.id, new Date().toISOString()) }
  })

  const manualBodySchema = z.object({
    login: z.string().trim().min(1).max(25),
    entries: z.number().int().min(1).max(100).default(1),
    reason: z.string().trim().min(1).max(500),
  })

  /**
   * El motivo es obligatorio: estas papeletas no las respalda ningún evento de
   * Twitch, así que es la única explicación que quedará si alguien pregunta.
   */
  app.post<{ Params: { id: string } }>('/api/giveaways/:id/manual-entries', async (request, reply) => {
    const giveaway = getGiveaway(options.db, request.params.id)
    if (!giveaway) {
      return await reply.code(404).send({ ok: false, error: 'Sorteo no encontrado.' })
    }

    const parsed = manualBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return await reply.code(400).send({
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      })
    }

    const { login, entries: count, reason } = parsed.data

    if (!options.resolveUser) {
      return await reply
        .code(501)
        .send({ ok: false, error: 'Este proceso no puede buscar usuarios en Twitch.' })
    }

    let user: Awaited<ReturnType<NonNullable<ApiServerOptions['resolveUser']>>>
    try {
      user = await options.resolveUser(login)
    } catch (error) {
      return await reply
        .code(502)
        .send({ ok: false, error: `No se pudo consultar Twitch: ${(error as Error).message}` })
    }

    if (!user) {
      return await reply
        .code(404)
        .send({ ok: false, error: `En Twitch no existe ningún canal "${login}".` })
    }

    const added = addManualEntries(options.db, {
      giveawayId: giveaway.id,
      platform: 'twitch',
      userId: user.userId,
      login: user.login,
      displayName: user.displayName,
      entries: count,
      reason,
      addedAt: new Date().toISOString(),
    })

    const row = entriesByParticipant(options.db, giveaway.id).find(
      (p) => p.platform === 'twitch' && p.userId === user?.userId,
    )
    if (row) {
      options.events.publish({
        type: 'entry.added',
        giveawayId: giveaway.id,
        participant: row,
        added,
        totals: giveawayTotals(options.db, giveaway.id),
      })
    }

    return { ok: true, added, participant: row }
  })

  app.get('/api/giveaways/:id/stream', { websocket: true }, (socket) => {
    const send = (payload: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
    }

    // Estado inicial, para que el panel pueda pintar sin esperar a un evento.
    send({
      type: 'auth.status',
      state: options.authStatus.current.state,
      detail: options.authStatus.current.detail,
    })
    send({
      type: 'eventsub.status',
      connected: options.eventSubConnected(),
      detail: options.eventSubConnected() ? 'conectado' : 'sin conexión',
    })

    const forward = (event: unknown): void => send(event)
    options.events.on('event', forward)

    socket.on('close', () => options.events.off('event', forward))
    socket.on('error', () => options.events.off('event', forward))
  })

  const panelDist = options.panelDist === undefined ? findPanelDist() : options.panelDist
  if (panelDist) {
    await app.register(fastifyStatic, { root: panelDist })

    // SPA: cualquier ruta que no sea /api cae en el index.html.
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api')) {
        return await reply.code(404).send({ ok: false, error: 'No encontrado.' })
      }
      return await reply.sendFile('index.html')
    })
  } else {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api')) {
        return await reply.code(404).send({ ok: false, error: 'No encontrado.' })
      }
      return await reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send(
          'El panel no está compilado.\n\n' +
            'En desarrollo:  pnpm panel:dev  (y abre el puerto que diga Vite)\n' +
            'Para producción: pnpm panel:build\n',
        )
    })
  }

  return app
}
