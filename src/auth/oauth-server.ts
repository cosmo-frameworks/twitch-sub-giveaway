/**
 * Token de USUARIO y no de app: `channel:read:subscriptions` solo lo puede
 * conceder el propio streamer, y un token de app nunca sirve para leer los subs
 * de un canal.
 */

import { timingSafeEqual } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { exchangeCode as twurpleExchangeCode, getTokenInfo as twurpleGetTokenInfo } from '@twurple/auth'
import type { AccessToken } from '@twurple/auth'

import type { AppConfig } from '../config.js'
import { withRealTwitch } from './real-twitch.js'
import type { StoredToken } from './token-store.js'

/** URL del endpoint de autorización de Twitch. */
const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize'

/** Lo que necesitamos de `TokenInfo`, para poder sustituirlo en tests. */
export interface TokenInfoLike {
  userId: string | null
  userName: string | null
  scopes: string[]
}

export interface OAuthDeps {
  exchangeCode: (
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ) => Promise<AccessToken>
  getTokenInfo: (accessToken: string, clientId?: string) => Promise<TokenInfoLike>
}

const defaultDeps: OAuthDeps = {
  exchangeCode: async (clientId, clientSecret, code, redirectUri) =>
    await withRealTwitch(
      async () => await twurpleExchangeCode(clientId, clientSecret, code, redirectUri),
    ),
  getTokenInfo: async (accessToken, clientId) =>
    await withRealTwitch(async () => await twurpleGetTokenInfo(accessToken, clientId)),
}

export class AuthError extends Error {
  override readonly name = 'AuthError'
}

export interface RunOAuthFlowOptions {
  config: AppConfig
  /** Se llama con la URL a abrir. Por defecto no hace nada (el CLI abre el navegador). */
  onAuthorizeUrl?: (url: string) => void
  /** Corta el flujo si el streamer no autoriza. Por defecto 5 minutos. */
  timeoutMs?: number
  deps?: Partial<OAuthDeps>
}

/**
 * `force_verify=true` obliga a Twitch a enseñar siempre la pantalla de permisos
 * con la cuenta a la vista: sin eso es facilísimo autorizar con la cuenta del
 * bot, y ese token no puede leer los subs del canal.
 */
export function buildAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  state: string
}): string {
  const url = new URL(TWITCH_AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('force_verify', 'true')
  return url.toString()
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}

function page(title: string, body: string, accent: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.6 system-ui,sans-serif;background:#10131c;color:#e8dcc0;
       display:grid;place-items:center;height:100vh;margin:0;text-align:center}
  main{max-width:34rem;padding:2rem}
  h1{color:${accent};font-size:1.5rem;margin:0 0 .5rem}
</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`
}

const SUCCESS_PAGE = (login: string): string =>
  page(
    '✔ Autorizado',
    `<p>Token guardado para <strong>${escapeHtml(login)}</strong>.</p>
     <p>Ya puedes cerrar esta pestaña.</p>`,
    '#46d39a',
  )

const FAILURE_PAGE = (reason: string): string =>
  page('✖ No se pudo autorizar', `<p>${escapeHtml(reason)}</p>`, '#ff6b5e')

/**
 * El flujo, separado de quién sirve el callback: hay dos servidores que pueden
 * atenderlo y no caben a la vez en el mismo puerto —el efímero de `pnpm auth` y
 * la API del panel, que ya está escuchando cuando se pulsa "Conectar".
 */
export interface OAuthFlow {
  authorizeUrl: string
  callbackPath: string
  handleCallback: (params: URLSearchParams) => Promise<{ status: number; html: string }>
  result: Promise<StoredToken>
  cancel: (reason: string) => void
}

export function createOAuthFlow(options: {
  config: AppConfig
  deps?: Partial<OAuthDeps>
}): OAuthFlow {
  const { config } = options
  const deps = { ...defaultDeps, ...options.deps }

  // Este flujo es el de cliente confidencial: sin secreto no hay nada que hacer.
  // La aplicación instalada usa el flujo de dispositivo, que no lo necesita.
  const clientSecret = config.twitch.clientSecret
  if (!clientSecret) {
    throw new AuthError(
      'Este flujo necesita TWITCH_CLIENT_SECRET. Para la aplicación de escritorio ' +
        'se usa el flujo de código de dispositivo, que no lo requiere.',
    )
  }

  const state = randomBytes(32).toString('hex')
  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.twitch.clientId,
    redirectUri: config.auth.redirectUri,
    scopes: config.auth.scopes,
    state,
  })

  let settled = false
  let resolveResult!: (token: StoredToken) => void
  let rejectResult!: (error: Error) => void

  const result = new Promise<StoredToken>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // Quien lanza el flujo puede no esperar el resultado —el botón del panel no lo
  // hace—; sin esto sería un unhandled rejection que tumbaría el proceso.
  result.catch(() => undefined)

  const succeed = (token: StoredToken): void => {
    if (settled) return
    settled = true
    resolveResult(token)
  }

  const fail = (message: string): void => {
    if (settled) return
    settled = true
    rejectResult(new AuthError(message))
  }

  const handleCallback = async (
    params: URLSearchParams,
  ): Promise<{ status: number; html: string }> => {
    // Twitch devuelve ?error=access_denied si el streamer pulsa "Cancelar".
    const oauthError = params.get('error')
    if (oauthError) {
      const description = params.get('error_description') ?? oauthError
      fail(`Twitch denegó la autorización: ${description}`)
      return { status: 400, html: FAILURE_PAGE(description) }
    }

    if (!safeEquals(params.get('state') ?? '', state)) {
      fail('El parámetro "state" no coincide: posible CSRF. Repite el flujo.')
      return { status: 400, html: FAILURE_PAGE('El parámetro "state" no coincide.') }
    }

    const code = params.get('code')
    if (!code) {
      fail('Twitch no devolvió ningún código de autorización.')
      return { status: 400, html: FAILURE_PAGE('Twitch no devolvió ningún código.') }
    }

    let token: AccessToken
    let info: TokenInfoLike
    try {
      token = await deps.exchangeCode(
        config.twitch.clientId,
        clientSecret,
        code,
        config.auth.redirectUri,
      )
      info = await deps.getTokenInfo(token.accessToken, config.twitch.clientId)
    } catch (error) {
      const message = (error as Error).message
      fail(`No se pudo canjear el código por un token: ${message}`)
      return { status: 500, html: FAILURE_PAGE(message) }
    }

    if (!info.userId) {
      fail('El token devuelto no pertenece a ningún usuario (¿token de app?).')
      return { status: 500, html: FAILURE_PAGE('El token no pertenece a ningún usuario.') }
    }

    // El scope lo concede el streamer; si lo desmarca en la pantalla de Twitch
    // el token llega sin él y no serviría para leer subs.
    const missing = config.auth.scopes.filter((s) => !info.scopes.includes(s))
    if (missing.length > 0) {
      const reason = `Al token le faltan scopes: ${missing.join(', ')}`
      fail(`${reason}. Repite el flujo sin desmarcar permisos.`)
      return { status: 403, html: FAILURE_PAGE(reason) }
    }

    // Trampa 5: el scope solo sirve si lo autoriza el PROPIO streamer. Solo se
    // comprueba si hay un canal esperado configurado; si no, el canal ES quien
    // acaba de autorizar.
    const login = info.userName?.toLowerCase() ?? null
    const expected = config.twitch.expectedBroadcasterLogin
    if (expected !== null && login !== expected) {
      const reason =
        `Has autorizado con la cuenta "${info.userName ?? '?'}", ` +
        `pero el canal configurado es "${expected}".`
      fail(
        `${reason} El scope channel:read:subscriptions solo lo puede conceder el propio ` +
          'streamer: cierra sesión en Twitch, o usa una ventana privada, y vuelve a intentarlo.',
      )
      return { status: 403, html: FAILURE_PAGE(reason) }
    }

    succeed({
      userId: info.userId,
      userLogin: info.userName,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      scope: token.scope,
      expiresIn: token.expiresIn,
      obtainmentTimestamp: token.obtainmentTimestamp,
      grant: 'authorization_code',
    })

    return { status: 200, html: SUCCESS_PAGE(info.userName ?? 'tu canal') }
  }

  return {
    authorizeUrl,
    callbackPath: new URL(config.auth.redirectUri).pathname,
    handleCallback,
    result,
    cancel: fail,
  }
}

/**
 * El camino de `pnpm auth`, con servidor propio. El panel usa `createOAuthFlow`
 * y enruta el callback por su propia API.
 *
 * @throws {AuthError} si deniega, si autoriza con otra cuenta, si falta el
 *   scope, o si pasa el timeout.
 */
export async function runOAuthFlow(options: RunOAuthFlowOptions): Promise<StoredToken> {
  const flow = createOAuthFlow({ config: options.config, deps: options.deps })
  const timeoutMs = options.timeoutMs ?? 5 * 60_000

  const redirect = new URL(options.config.auth.redirectUri)
  const port = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80))

  /**
   * El flujo resuelve DENTRO de `handleCallback`, es decir, antes de que la
   * respuesta llegue al navegador. Sin esperar a que se escriba, el `finally`
   * cerraría el socket y el streamer vería un error de conexión en vez de la
   * página de "Autorizado".
   */
  let markResponseWritten: () => void = () => undefined
  const responseWritten = new Promise<void>((resolve) => {
    markResponseWritten = resolve
  })

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (url.pathname === '/' || url.pathname === '/login') {
      res.writeHead(302, { location: flow.authorizeUrl })
      res.end()
      return
    }

    if (url.pathname === flow.callbackPath) {
      void flow.handleCallback(url.searchParams).then(({ status, html }) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html, () => markResponseWritten())
      })
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404')
  })

  const listening = new Promise<void>((resolve, reject) => {
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(
          new AuthError(
            `El puerto ${port} ya está ocupado. Cierra lo que lo esté usando o cambia PORT en .env ` +
              '(y el Redirect URL de la app en https://dev.twitch.tv/console/apps).',
          ),
        )
        return
      }
      reject(new AuthError(`Error del servidor de callback: ${error.message}`))
    })

    server.listen(port, '127.0.0.1', () => resolve())
  })

  const timer = setTimeout(() => {
    flow.cancel(`Nadie autorizó en ${Math.round(timeoutMs / 1000)}s. Vuelve a intentarlo.`)
  }, timeoutMs)
  timer.unref()

  try {
    await listening
    options.onAuthorizeUrl?.(flow.authorizeUrl)
    return await flow.result
  } finally {
    clearTimeout(timer)
    // Si nadie llegó a autorizar (timeout), `responseWritten` no resuelve nunca:
    // de ahí el tope.
    await Promise.race([
      responseWritten,
      new Promise<void>((resolve) => setTimeout(resolve, 1000).unref()),
    ])
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
