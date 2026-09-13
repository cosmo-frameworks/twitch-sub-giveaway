import { join } from 'node:path'
import process from 'node:process'

import { z } from 'zod'

import { appDataDir, DEFAULT_DB_FILENAME, resolveDataDir, TOKENS_FILENAME } from './paths.js'
import { readSettings, type Settings } from './settings.js'

/**
 * NO existe un tier `"prime"`: una suscripción Prime llega como `"1000"`.
 * Verificado en https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types
 */
export const TWITCH_TIERS = ['1000', '2000', '3000'] as const
export type TwitchTier = (typeof TWITCH_TIERS)[number]

export const ENTRY_SOURCES = [
  'sub',
  'resub',
  'gift_sent',
  'gift_received',
  'keyword',
  'manual',
] as const
export type EntrySource = (typeof ENTRY_SOURCES)[number]

/**
 * Compilado porque identifica a la aplicación, no al streamer, y es público por
 * diseño: viaja en cada URL de autorización y en cada petición a Helix.
 *
 * El client SECRET no se compila: la aplicación instalada usa el flujo de
 * dispositivo, que no lo necesita.
 */
export const BUNDLED_CLIENT_ID = '9v9qbtqsdx6wrzwls8ugbdy7mzt4hn'

export const REQUIRED_SCOPES = ['channel:read:subscriptions'] as const

const entryCount = z.number().int().min(0).max(1000)

export const entryRulesSchema = z.object({
  /** `channel.subscribe` con `is_gift = false`. */
  sub: z.object({ entries: entryCount }),

  /**
   * `channel.subscription.message`. Es el ÚNICO evento de una renovación:
   * `channel.subscribe` no salta en resubs.
   */
  resub: z.object({ entries: entryCount }),

  /**
   * `channel.subscription.gift` → entra el REGALADOR.
   * `per_sub` multiplica por el `total` del evento; `fixed` no.
   */
  giftSent: z.object({
    mode: z.enum(['per_sub', 'fixed']),
    entries: entryCount,
  }),

  /**
   * `channel.subscribe` con `is_gift = true` → el RECEPTOR. Ponerlo a >0 junto
   * con `giftSent` premia el mismo regalo por los dos lados; es legítimo, y no
   * es el doble conteo clásico: al regalador nunca se le suma este evento.
   */
  giftReceived: z.object({ entries: entryCount }),

  /**
   * En un gift anónimo Twitch manda `user_id` a `null`, así que no hay a quién
   * premiar: o se descarta, o se acumula en un participante sintético.
   */
  anonymousGift: z.enum(['ignore', 'bucket']),

  anonymousBucketUserId: z.string().trim().min(1),

  /**
   * Por defecto todos valen 1. El tier se GUARDA siempre en `entries.tier`
   * aunque no pese, para poder cambiar de idea sin perder información.
   */
  tierWeights: z.object({
    '1000': z.number().int().min(1).max(100),
    '2000': z.number().int().min(1).max(100),
    '3000': z.number().int().min(1).max(100),
  }),
})

export type EntryRules = z.infer<typeof entryRulesSchema>

export const DEFAULT_ENTRY_RULES = {
  sub: { entries: 1 },
  resub: { entries: 1 },
  giftSent: { mode: 'per_sub', entries: 1 },
  giftReceived: { entries: 0 },
  anonymousGift: 'ignore',
  anonymousBucketUserId: '__anonymous__',
  tierWeights: { '1000': 1, '2000': 1, '3000': 1 },
} satisfies EntryRules

/** Trata `""` como "no definida", para que los defaults se apliquen. */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema)

export const envSchema = z.object({
  TWITCH_CLIENT_ID: optional(z.string().trim().min(1).default(BUNDLED_CLIENT_ID)),

  /** Solo para el flujo Authorization Code (`pnpm auth` y despliegue en servidor). */
  TWITCH_CLIENT_SECRET: optional(z.string().trim().min(1).optional()),

  /**
   * Normalmente NO se define: el canal es quien autorice. Definirla aborta si se
   * autoriza con otra cuenta.
   */
  TWITCH_BROADCASTER_LOGIN: optional(
    z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9_]{3,25}$/,
        'TWITCH_BROADCASTER_LOGIN debe ser un login de Twitch válido: 3-25 caracteres, solo letras, números y "_".',
      )
      .transform((value) => value.toLowerCase())
      .optional(),
  ),

  /** Vacío en producción; en local, el mock del Twitch CLI. */
  TWITCH_WS_URL: optional(
    z
      .string()
      .trim()
      .regex(
        /^wss?:\/\/\S+$/,
        'TWITCH_WS_URL debe empezar por ws:// o wss:// (p.ej. ws://127.0.0.1:8080/ws). Déjala vacía en producción.',
      )
      .optional(),
  ),

  OAUTH_REDIRECT_URI: optional(
    z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, 'OAUTH_REDIRECT_URI debe ser una URL http(s) absoluta.')
      .optional(),
  ),

  /** Override de desarrollo. El streamer elige la ruta desde la app. */
  DB_PATH: optional(z.string().trim().min(1).optional()),

  TOKENS_PATH: optional(z.string().trim().min(1).optional()),

  /**
   * Lo lee Twurple de `process.env`, no de aquí; se declara para validarlo.
   * `TWITCH_WS_URL` sola NO basta para probar con el CLI: solo redirige el
   * WebSocket, y las suscripciones se seguirían creando contra Twitch real.
   */
  TWURPLE_MOCK_API_PORT: optional(
    z.coerce
      .number('TWURPLE_MOCK_API_PORT debe ser un número de puerto.')
      .int()
      .min(1)
      .max(65535)
      .optional(),
  ),

  TWITCH_SORTEOS_DATA_DIR: optional(z.string().trim().min(1).optional()),

  PORT: optional(
    z.coerce
      .number('PORT debe ser un número entre 1 y 65535.')
      .int('PORT debe ser un entero.')
      .min(1, 'PORT debe estar entre 1 y 65535.')
      .max(65535, 'PORT debe estar entre 1 y 65535.')
      .default(3000),
  ),

  LOG_LEVEL: optional(
    z
      .enum(
        ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
        'LOG_LEVEL debe ser uno de: fatal, error, warn, info, debug, trace.',
      )
      .default('info'),
  ),
})

export type Env = z.infer<typeof envSchema>

export type DbPathSource = 'default' | 'settings' | 'env'

export interface AppConfig {
  twitch: {
    clientId: string
    /** `undefined` en la aplicación instalada: el flujo de dispositivo no lo usa. */
    clientSecret: string | undefined
    /** `null` si es "quien autorice". */
    expectedBroadcasterLogin: string | null
    /** `undefined` = EventSub real. Definido = mock del Twitch CLI. */
    eventSubUrl: string | undefined
    mockApiPort: number | undefined
  }
  auth: {
    redirectUri: string
    scopes: readonly string[]
    tokensPath: string
  }
  db: {
    path: string
    source: DbPathSource
  }
  dataDir: string
  server: { port: number }
  logLevel: Env['LOG_LEVEL']
  entryRules: EntryRules
}

export interface ResolvedPaths {
  dataDir: string
  dbPath: string
  dbSource: DbPathSource
  tokensPath: string
}

/**
 * Precedencia: variable de entorno → `settings.json` → carpeta del sistema.
 *
 * Los tokens no miran `settings.json` a propósito: son credenciales de Twitch y
 * no deben acabar en una carpeta sincronizada ni en el escritorio.
 */
export function resolvePaths(options: {
  env: Pick<Env, 'DB_PATH' | 'TOKENS_PATH' | 'TWITCH_SORTEOS_DATA_DIR'>
  settings: Settings
  defaultDataDir?: string
}): ResolvedPaths {
  const dataDir = options.env.TWITCH_SORTEOS_DATA_DIR ?? options.defaultDataDir ?? appDataDir()

  const dbPath = options.env.DB_PATH ?? options.settings.dbPath ?? join(dataDir, DEFAULT_DB_FILENAME)
  const dbSource: DbPathSource = options.env.DB_PATH
    ? 'env'
    : options.settings.dbPath
      ? 'settings'
      : 'default'

  return {
    dataDir,
    dbPath,
    dbSource,
    tokensPath: options.env.TOKENS_PATH ?? join(dataDir, TOKENS_FILENAME),
  }
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError'

  constructor(
    message: string,
    readonly problems: readonly string[],
  ) {
    super(message)
  }
}

function configError(error: z.ZodError, heading: string): ConfigError {
  const problems = error.issues.map((issue) => {
    const path = issue.path.join('.')
    // Muchos mensajes ya empiezan por el nombre de la variable; no lo repitas.
    if (!path || issue.message.startsWith(path)) return issue.message
    return `${path}: ${issue.message}`
  })

  const body = [
    '',
    `✖ ${heading}`,
    '',
    ...problems.map((p) => `  • ${p}`),
    '',
    '  Tienes una plantilla en .env.example:  cp .env.example .env',
    '',
  ].join('\n')

  return new ConfigError(body, problems)
}

export interface ParseConfigOptions {
  rules?: unknown
  settings?: Settings
  /** Solo para tests: sustituye el cálculo de la carpeta del sistema. */
  defaultDataDir?: string
}

/** Pura: no lee ficheros ni toca `process.env`, para poder testearla. */
export function parseConfig(
  source: Record<string, string | undefined>,
  options: ParseConfigOptions = {},
): AppConfig {
  const parsedEnv = envSchema.safeParse(source)
  if (!parsedEnv.success) {
    throw configError(parsedEnv.error, 'Configuración inválida: revisa estas variables de entorno')
  }

  const parsedRules = entryRulesSchema.safeParse(options.rules ?? DEFAULT_ENTRY_RULES)
  if (!parsedRules.success) {
    throw configError(parsedRules.error, 'Reglas de entrada inválidas en src/config.ts (entryRules)')
  }

  const env = parsedEnv.data
  const paths = resolvePaths({
    env,
    settings: options.settings ?? {},
    ...(options.defaultDataDir === undefined ? {} : { defaultDataDir: options.defaultDataDir }),
  })

  return {
    twitch: {
      clientId: env.TWITCH_CLIENT_ID,
      clientSecret: env.TWITCH_CLIENT_SECRET,
      expectedBroadcasterLogin: env.TWITCH_BROADCASTER_LOGIN ?? null,
      eventSubUrl: env.TWITCH_WS_URL,
      mockApiPort: env.TWURPLE_MOCK_API_PORT,
    },
    auth: {
      redirectUri: env.OAUTH_REDIRECT_URI ?? `http://localhost:${env.PORT}/callback`,
      scopes: REQUIRED_SCOPES,
      tokensPath: paths.tokensPath,
    },
    db: { path: paths.dbPath, source: paths.dbSource },
    dataDir: paths.dataDir,
    server: { port: env.PORT },
    logLevel: env.LOG_LEVEL,
    entryRules: parsedRules.data,
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const dataDir = resolveDataDir()
  const settings = await readSettings(dataDir)
  return parseConfig(process.env, { settings, defaultDataDir: dataDir })
}

function describeEventSub(config: AppConfig): string {
  const { eventSubUrl, mockApiPort } = config.twitch
  if (mockApiPort) return `mock del Twitch CLI en el puerto ${mockApiPort} (WS + Helix)`
  if (eventSubUrl) return `${eventSubUrl} — ¡ojo! Helix sigue apuntando a Twitch real`
  return 'wss://eventsub.wss.twitch.tv/ws (Twitch real)'
}

const DB_SOURCE_LABEL: Record<DbPathSource, string> = {
  default: 'por defecto',
  settings: 'elegida en la app',
  env: 'override de DB_PATH',
}

/** Nunca incluye el client secret. */
export function describeConfig(config: AppConfig): string {
  const r = config.entryRules
  return [
    `canal          : ${config.twitch.expectedBroadcasterLogin ?? '(el de quien autorice)'}`,
    `client id      : ${config.twitch.clientId.slice(0, 6)}…`,
    `client secret  : ${config.twitch.clientSecret ? `${'*'.repeat(8)} (oculto)` : 'no configurado (flujo de dispositivo)'}`,
    `eventsub       : ${describeEventSub(config)}`,
    `redirect oauth : ${config.auth.redirectUri}`,
    `carpeta datos  : ${config.dataDir}`,
    // Para soporte: si dicen que "se han borrado los participantes", esta línea
    // dice si están mirando otra base de datos.
    `base de datos  : ${config.db.path} (${DB_SOURCE_LABEL[config.db.source]})`,
    `tokens         : ${config.auth.tokensPath}`,
    `puerto http    : ${config.server.port}`,
    `log level      : ${config.logLevel}`,
    `reglas         : sub=${r.sub.entries} resub=${r.resub.entries}` +
      ` giftSent=${r.giftSent.entries}/${r.giftSent.mode}` +
      ` giftReceived=${r.giftReceived.entries} anónimos=${r.anonymousGift}`,
  ].join('\n')
}
