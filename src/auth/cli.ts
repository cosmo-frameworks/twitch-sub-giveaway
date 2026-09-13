/**
 * `pnpm auth` — autoriza la aplicación con la cuenta del streamer y guarda el
 * token en disco. Solo hay que ejecutarlo una vez (y otra vez si el streamer
 * retira el acceso).
 */

import process from 'node:process'

import { config as loadDotenv } from 'dotenv'

import { ConfigError, loadConfig } from '../config.js'
import { SettingsError } from '../settings.js'
import { openBrowser } from './open-browser.js'
import { AuthError, runOAuthFlow } from './oauth-server.js'
import { readToken, writeToken, TokenStoreError } from './token-store.js'

loadDotenv({ quiet: true })

async function main(): Promise<number> {
  let config
  try {
    config = await loadConfig()
  } catch (error) {
    if (error instanceof ConfigError || error instanceof SettingsError) {
      console.error(error.message)
      return 1
    }
    throw error
  }

  // Si el fichero está corrupto no es motivo para no poder re-autorizar: lo
  // vamos a sobrescribir de todas formas.
  const existing = await readToken(config.auth.tokensPath).catch((error: unknown) => {
    if (error instanceof TokenStoreError) return null
    throw error
  })

  if (existing) {
    console.log(
      `ℹ Ya hay un token guardado para "${existing.userLogin ?? existing.userId}". ` +
        'Se sustituirá cuando termines.\n',
    )
  }

  console.log(
    `Canal        : ${config.twitch.expectedBroadcasterLogin ?? '(será el de quien autorice)'}`,
  )
  console.log(`Scopes       : ${config.auth.scopes.join(', ')}`)
  console.log(`Redirect URI : ${config.auth.redirectUri}`)
  console.log(
    '\n⚠ Ese Redirect URI tiene que estar dado de alta, tal cual, en la app de\n' +
      '  https://dev.twitch.tv/console/apps — si no, Twitch responderá "redirect mismatch".\n',
  )

  let token
  try {
    token = await runOAuthFlow({
      config,
      onAuthorizeUrl: (url) => {
        const opened = openBrowser(url)
        console.log(
          opened
            ? '→ Te he abierto el navegador. Autoriza con la cuenta del STREAMER.'
            : '→ No he podido abrir el navegador. Abre esta URL a mano:',
        )
        console.log(`\n  ${url}\n`)
        console.log('Esperando a que autorices…')
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(`\n✖ ${error.message}`)
      return 1
    }
    throw error
  }

  await writeToken(config.auth.tokensPath, token)

  const expiresAt =
    token.expiresIn === null
      ? 'nunca'
      : new Date(token.obtainmentTimestamp + token.expiresIn * 1000).toISOString()

  console.log(`\n✔ Token guardado en ${config.auth.tokensPath}`)
  console.log(`  usuario  : ${token.userLogin ?? '?'} (id ${token.userId})`)
  console.log(`  scopes   : ${token.scope.join(', ')}`)
  console.log(`  caduca   : ${expiresAt} (se refresca solo)`)
  console.log('\nYa puedes arrancar el proceso con "pnpm dev".')

  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
