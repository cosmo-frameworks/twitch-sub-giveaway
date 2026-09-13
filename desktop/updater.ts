import { createRequire } from 'node:module'

import type * as ElectronApi from 'electron'
import type { AppUpdater } from 'electron-updater'

const require = createRequire(import.meta.url)

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 30_000

export type UpdateStateT =
  | { state: 'idle' }
  | { state: 'disabled'; reason: string }
  | { state: 'checking' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface UpdaterI {
  state: () => UpdateStateT
  check: () => void
  installNow: () => void
  stop: () => void
}

export function startUpdater(options: {
  app: ElectronApi.App
  log: (text: string) => void
  onChange: (state: UpdateStateT) => void
}): UpdaterI {
  let current: UpdateStateT = { state: 'idle' }
  let timer: NodeJS.Timeout | null = null

  const set = (next: UpdateStateT): void => {
    current = next
    options.onChange(next)
  }

  const inerte = (): UpdaterI => ({
    state: () => current,
    check: () => undefined,
    installNow: () => undefined,
    stop: () => undefined,
  })

  if (!options.app.isPackaged) {
    const reason = 'sin empaquetar: las actualizaciones solo funcionan en la aplicación instalada'
    options.log(`· actualizaciones: ${reason}`)
    set({ state: 'disabled', reason })
    return inerte()
  }

  let autoUpdater: AppUpdater

  try {
    ;({ autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater })
  } catch (error) {
    const message = (error as Error).message
    options.log(`⚠ actualizaciones: no se pudo cargar el actualizador (${message})`)
    set({ state: 'error', message })
    return inerte()
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))

  autoUpdater.on('update-not-available', () => {
    options.log('· actualizaciones: ya está en la última versión')
    set({ state: 'idle' })
  })

  autoUpdater.on('update-available', (info: { version: string }) => {
    options.log(`· actualizaciones: hay una ${info.version}, descargando`)
    set({ state: 'downloading', percent: 0 })
  })

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    set({ state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    options.log(`· actualizaciones: ${info.version} lista; se instalará al cerrar`)
    set({ state: 'ready', version: info.version })
  })

  autoUpdater.on('error', (error: Error) => {
    options.log(`· actualizaciones: no se pudo comprobar (${error.message})`)
    set({ state: 'error', message: error.message })
  })

  const check = (): void => {
    if (current.state === 'ready' || current.state === 'downloading') return
    void autoUpdater.checkForUpdates()?.catch(() => undefined)
  }

  const first = setTimeout(check, FIRST_CHECK_DELAY_MS)
  timer = setInterval(check, CHECK_EVERY_MS)

  return {
    state: () => current,
    check,
    installNow: () => {
      if (current.state !== 'ready') return
      options.log('· actualizaciones: instalando a petición del usuario')
      autoUpdater.quitAndInstall()
    },
    stop: () => {
      clearTimeout(first)
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
