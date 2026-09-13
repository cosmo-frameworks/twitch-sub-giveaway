/**
 * Lo usan `src/index.ts` y `desktop/main.ts`, así que aquí no hay `process.exit`
 * ni handlers de señales: se devuelve un asa y que cada uno la cierre.
 *
 * Arranca ANTES de estar conectado a Twitch y se conecta después: es la
 * diferencia entre ver una pantalla que dice qué hacer y ver una ventana
 * cerrarse sola. Hasta entonces `activeGiveawayId` devuelve `null`.
 */

import { ApiClient } from '@twurple/api'

import { PanelEvents } from './api/events.js'
import { createApiServer } from './api/server.js'
import { DeviceSession } from './auth/device-session.js'
import { createOAuthFlow } from './auth/oauth-server.js'
import { openBrowser } from './auth/open-browser.js'
import { createAuthProvider, MissingSecretError, MissingTokenError } from './auth/provider.js'
import { AuthStatus } from './auth/status.js'
import { readToken, TokenStoreError, writeToken, type StoredToken } from './auth/token-store.js'
import { TokenValidator } from './auth/validate.js'
import { ConfigError, describeConfig, loadConfig, type AppConfig } from './config.js'
import { openDb, type Db } from './db/client.js'
import { processEvent } from './db/process-event.js'
import { countEntries, entriesByParticipant, giveawayTotals } from './db/repositories/entries.js'
import { ensureOpenGiveaway, findOpenGiveaway } from './db/repositories/giveaways.js'
import type { Giveaway } from './db/schema.js'
import { applyRules } from './rules/apply.js'
import { SettingsError } from './settings.js'
import { SubEventListener } from './twitch/listener.js'
import { formatSubEvent } from './twitch/normalize.js'
import { describeReconcile, helixSubscribers, reconcile } from './twitch/reconcile.js'
import { writeDailySnapshot } from './twitch/snapshot.js'

export type StartupProblemT =
  /** Falta configuración o está mal. */
  | 'config'
  /** No se pudo abrir la base de datos. */
  | 'db'
  /** El puerto está ocupado: casi siempre, otra ventana ya abierta. */
  | 'port'

export class StartupError extends Error {
  override readonly name = 'StartupError'
  constructor(
    message: string,
    readonly problem: StartupProblemT,
  ) {
    super(message)
  }
}

export interface RunningApp {
  port: number
  panelUrl: string
  summary: string
  /** `true` si ya había token guardado y el canal quedó conectado al arrancar. */
  connected: boolean
  stop: () => Promise<void>
}

const ICON: Record<string, string> = {
  ok: '✔',
  pending: '·',
  error: '⚠',
  revoked: '✖',
  unauthenticated: '✖',
}

/** Todo lo que solo existe mientras hay un canal conectado. */
interface TwitchSession {
  broadcasterId: string
  broadcasterLogin: string | null
  /** Se pregunta, no se guarda: el sorteo activo cambia sin reiniciar. */
  giveawayId: () => string | null
  stop: () => void
}

export async function startApp(): Promise<RunningApp> {

  let config: AppConfig
  try {
    config = await loadConfig()
  } catch (error) {
    if (error instanceof ConfigError || error instanceof SettingsError) {
      throw new StartupError(error.message, 'config')
    }
    throw error
  }

  const summary = describeConfig(config)
  console.log('▶ sorteo de subs de Twitch\n')
  console.log(summary)
  console.log()

  if (config.twitch.eventSubUrl && !config.twitch.mockApiPort) {
    console.error(
      '⚠ TWITCH_WS_URL está definida pero TWURPLE_MOCK_API_PORT no.\n' +
        '  Para probar con el Twitch CLI hacen falta las dos.\n',
    )
  }

  let database
  try {
    database = openDb({ path: config.db.path })
  } catch (error) {
    throw new StartupError(
      `No se pudo abrir el fichero del sorteo:\n${config.db.path}\n\n${(error as Error).message}`,
      'db',
    )
  }

  const events = new PanelEvents()
  const status = new AuthStatus()
  let session: TwitchSession | null = null
  /** Leer por función evita que TypeScript estreche el tipo a `never`. */
  const currentSession = (): TwitchSession | null => session
  let eventSubConnected = false

  status.on('change', (snapshot) => {
    const line = `${ICON[snapshot.state] ?? '·'} auth: ${snapshot.state} — ${snapshot.detail}`
    if (snapshot.state === 'ok' || snapshot.state === 'pending') console.log(line)
    else console.error(line)
    events.publish({ type: 'auth.status', state: snapshot.state, detail: snapshot.detail })
  })

  /** Al arrancar si ya había token, y cada vez que se conecta desde el panel. */
  const connect = async (): Promise<void> => {
    currentSession()?.stop()
    session = null

    const auth = await createAuthProvider({ config, status })

    const validator = new TokenValidator({
      authProvider: auth.authProvider,
      userId: auth.userId,
      config,
      status,
    })
    const first = await validator.start()
    if (first.state === 'revoked') {
      validator.stop()
      throw new Error(first.detail)
    }

    const login = auth.userLogin ?? auth.userId
    console.log(`\nAutenticado como ${login} (id ${auth.userId}).`)

    /**
     * Se resuelve en CADA evento. Con el id capturado una sola vez, archivar un
     * sorteo en mitad del directo dejaba las papeletas nuevas cayendo en el
     * viejo y obligaba a reiniciar.
     */
    const currentGiveaway = (): Giveaway => {
      const { giveaway: resolved, created } = ensureOpenGiveaway(database.db, {
        name: `Sorteo de ${login}`,
        at: new Date().toISOString(),
      })
      if (created) {
        console.log(`· no quedaba ningún sorteo abierto; se abre "${resolved.name}".`)
      }
      return resolved
    }

    const giveaway = currentGiveaway()

    console.log(
      `Sorteo activo: "${giveaway.name}" (${giveaway.id.slice(0, 8)}…) — ` +
        `${countEntries(database.db, giveaway.id)} entradas guardadas.`,
    )

    const apiClient = new ApiClient({ authProvider: auth.authProvider })
    const fetchSubscribers = helixSubscribers(apiClient, auth.userId)

    let reconciling = false
    const runReconciliation = async (reason: string): Promise<void> => {
      if (reconciling) return
      reconciling = true
      try {
        const subscribers = await fetchSubscribers()

        // Se resuelve ahora, no al conectar: entre el arranque y una reconexión
        // el streamer puede haber archivado el sorteo y abierto otro.
        const giveawayId = currentGiveaway().id

        const result = await reconcile({
          db: database.db,
          giveawayId,
          broadcasterId: auth.userId,
          rules: config.entryRules,
          fetchSubscribers: async () => subscribers,
        })

        console.log(`· reconciliación (${reason}): ${describeReconcile(result)}`)

        if (result.giftersNotCredited > 0) {
          console.log(
            `  ${result.giftersNotCredited} subs regalados: Helix no dice cuándo se regalaron,\n` +
              '  así que no se puede acreditar al regalador sin darle crédito por su histórico.',
          )
        }

        if (result.entriesAdded > 0) {
          events.publish({
            type: 'reconciled',
            giveawayId,
            entriesAdded: result.entriesAdded,
            totals: giveawayTotals(database.db, giveawayId),
          })
        }

        const snapshot = await writeDailySnapshot({ dataDir: config.dataDir, subscribers })
        if (snapshot.path) console.log(`  copia del día: ${snapshot.path}`)
      } catch (error) {
        console.error(
          `⚠ la reconciliación (${reason}) falló: ${(error as Error).message}\n` +
            '  Se reintentará en la próxima reconexión. Los eventos en directo siguen entrando.',
        )
      } finally {
        reconciling = false
      }
    }

    await runReconciliation('arranque')

    let connects = 0
    const listener = new SubEventListener({
      apiClient,
      broadcasterId: auth.userId,
      eventSubUrl: config.twitch.eventSubUrl,

      onEvent: (event) => onSubEvent(database.db, config, currentGiveaway().id, events, event),

      onConnect: () => {
        console.log('✔ eventsub: conectado, escuchando subs')
        eventSubConnected = true
        events.publish({ type: 'eventsub.status', connected: true, detail: 'conectado' })
        // Tras una caída hay un hueco de eventos que EventSub no reenvía.
        if (++connects > 1) void runReconciliation('reconexión')
      },

      onDisconnect: (error) => {
        eventSubConnected = false
        events.publish({
          type: 'eventsub.status',
          connected: false,
          detail: error?.message ?? 'desconectado',
        })
        console.error(
          error
            ? `⚠ eventsub: desconectado (${error.message}). Twurple reconectará solo.`
            : '· eventsub: desconectado limpiamente',
        )
      },

      onRevoke: (detail) => {
        console.error(
          `✖ eventsub: Twitch canceló la suscripción ${detail}. ` +
            'Suele significar que el streamer retiró el acceso.',
        )
      },

      onMissingMessageId: (event) => {
        console.error(
          `⚠ no se pudo leer el message_id de un evento ${event.type}. ` +
            'Probablemente Twurple cambió de versión: revisa src/twitch/listener.ts.',
        )
      },

      onSubscriptionReady: ({ type, cliCommand }) => {
        console.log(`  · suscrito a ${type}`)
        if (cliCommand) console.log(`      ${cliCommand}`)
      },

      onSubscriptionFailed: (type, error) => {
        console.error(
          `✖ no se pudo dar de alta la suscripción ${type}: ${error.message}\n` +
            '  Sin ella el socket queda conectado pero mudo para ese evento.',
        )
      },
    })

    listener.start()

    session = {
      broadcasterId: auth.userId,
      broadcasterLogin: auth.userLogin,
      giveawayId: () => findOpenGiveaway(database.db)?.id ?? null,
      stop: () => {
        listener.stop()
        validator.stop()
        eventSubConnected = false
      },
    }
  }

  const deviceSession = new DeviceSession({
    config,
    onConnected: async (token: StoredToken) => {
      await writeToken(config.auth.tokensPath, token)
      await connect()
    },
  })

  // eslint-disable-next-line prefer-const -- se asigna abajo; `reauthorize` solo corre después.
  let api: Awaited<ReturnType<typeof createApiServer>>

  const reauthorize = async (): Promise<void> => {
    const flow = createOAuthFlow({ config })

    const opened = openBrowser(flow.authorizeUrl)
    console.log(
      opened
        ? '→ Navegador abierto para autorizar con Twitch.'
        : `→ Abre esta URL para autorizar:\n  ${flow.authorizeUrl}`,
    )

    api.get(flow.callbackPath, async (request, reply) => {
      const url = new URL(request.url, 'http://localhost')
      const { status: code, html } = await flow.handleCallback(url.searchParams)
      return await reply.code(code).type('text/html; charset=utf-8').send(html)
    })

    try {
      await writeToken(config.auth.tokensPath, await flow.result)
      await connect()
    } catch (error) {
      status.set('revoked', `la re-autorización falló: ${(error as Error).message}`)
    }
  }

  api = await createApiServer({
    db: database.db,
    config,
    authStatus: status,
    events,
    activeGiveawayId: () => currentSession()?.giveawayId() ?? null,
    broadcasterLogin: () => currentSession()?.broadcasterLogin ?? null,
    eventSubConnected: () => eventSubConnected,
    deviceSession: {
      get state() {
        return deviceSession.state
      },
      start: async () => await deviceSession.start(),
      cancel: () => deviceSession.cancel(),
    },
    reauthorize,
    resolveUser: async (login) => {
      if (!currentSession()) return null
      const apiClient = new ApiClient({ authProvider: (await createAuthProvider({ config, status })).authProvider })
      const user = await apiClient.users.getUserByName(login)
      if (!user) return null
      return { userId: user.id, login: user.name, displayName: user.displayName }
    },
  })

  try {
    await api.listen({ port: config.server.port, host: '127.0.0.1' })
  } catch (error) {
    currentSession()?.stop()
    database.close()

    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new StartupError(
        `El puerto ${config.server.port} ya está ocupado.\n\n` +
          'Lo más probable es que la aplicación ya esté abierta en otra ventana. ' +
          'Ciérrala antes de volver a abrirla: dos copias escribiendo en el mismo ' +
          'sorteo se pisan entre ellas.',
        'port',
      )
    }
    throw error
  }

  let connected = false
  try {
    const existing = await readToken(config.auth.tokensPath)
    if (existing) {
      await connect()
      connected = true
    } else {
      status.set('unauthenticated', 'todavía no hay ningún canal conectado')
    }
  } catch (error) {
    // Arrancar sin conexión NO es un fallo de arranque: el panel enseña la
    // pantalla de conectar y el streamer lo resuelve desde ahí.
    const message =
      error instanceof MissingTokenError || error instanceof TokenStoreError
        ? 'todavía no hay ningún canal conectado'
        : error instanceof MissingSecretError
          ? error.message
          : `no se pudo conectar: ${(error as Error).message}`
    status.set(error instanceof MissingTokenError ? 'unauthenticated' : 'revoked', message)
  }

  const panelUrl = `http://localhost:${config.server.port}`
  console.log(`\n▸ Panel en ${panelUrl}`)
  if (!connected) {
    console.log('  Ningún canal conectado todavía: ábrelo y pulsa "Conectar con Twitch".')
  }

  return {
    port: config.server.port,
    panelUrl,
    summary,
    connected,
    stop: async () => {
      deviceSession.cancel()
      currentSession()?.stop()
      await api.close()
      database.close()
    },
  }
}

/** Procesa un evento en directo: reglas → persistencia → panel. */
function onSubEvent(
  db: Db,
  config: AppConfig,
  giveawayId: string,
  events: PanelEvents,
  event: Parameters<NonNullable<ConstructorParameters<typeof SubEventListener>[0]['onEvent']>>[0],
): void {
  const drafts = applyRules(event, config.entryRules)

  let outcome: string
  try {
    const result = processEvent(db, { giveawayId, event, drafts })
    outcome =
      result.status === 'duplicate'
        ? 'duplicado, ignorado'
        : result.status === 'no-entries'
          ? 'sin papeletas'
          : `+${result.entriesInserted} papeleta${result.entriesInserted === 1 ? '' : 's'}`

    // El panel recibe la fila ya agregada: así no recarga la lista entera por
    // cada papeleta de un gift bomb.
    if (result.status === 'inserted') {
      const first = drafts[0]
      if (first) {
        const row = entriesByParticipant(db, giveawayId).find(
          (p) => p.platform === first.platform && p.userId === first.userId,
        )
        if (row) {
          events.publish({
            type: 'entry.added',
            giveawayId,
            participant: row,
            added: result.entriesInserted,
            totals: giveawayTotals(db, giveawayId),
          })
        }
      }
    }
  } catch (error) {
    // Un fallo de escritura no puede tumbar el listener: se pierde esta
    // papeleta, pero la reconciliación la recupera.
    outcome = `✖ ERROR al guardar: ${(error as Error).message}`
  }

  console.log(`${formatSubEvent(event)}  → ${outcome}`)
}
