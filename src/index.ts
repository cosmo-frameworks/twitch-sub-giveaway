/**
 * Arranque desde la terminal.
 *
 * Es el camino de desarrollo (`pnpm dev`) y el de un despliegue en servidor. El
 * streamer no usa esto: abre la aplicación de escritorio, que arranca lo mismo
 * desde `desktop/main.ts`.
 */

import process from 'node:process'

import { config as loadDotenv } from 'dotenv'

import { startApp, StartupError } from './app.js'

loadDotenv({ quiet: true })

async function main(): Promise<number> {
  let app
  try {
    app = await startApp()
  } catch (error) {
    if (error instanceof StartupError) {
      console.error(`\n✖ ${error.message}\n`)
      return 1
    }
    throw error
  }

  console.log('Ctrl+C para salir.\n')

  // Mantiene el proceso vivo: el timer del validador está `unref`-eado a
  // propósito para que no sea él quien decida la vida del proceso.
  const keepAlive = setInterval(() => {}, 1 << 30)

  await new Promise<void>((resolveShutdown) => {
    const shutdown = (signal: string): void => {
      console.log(`\n${signal} recibido, cerrando…`)
      void app.stop().finally(() => {
        clearInterval(keepAlive)
        resolveShutdown()
      })
    }
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
  })

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
