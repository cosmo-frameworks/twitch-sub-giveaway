import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'
import type * as ElectronApi from 'electron'

import { startApp, StartupError, type RunningApp } from '../src/app.js'
import { resolveDataDir } from '../src/paths.js'
import { startUpdater, type UpdaterI, type UpdateStateT } from './updater.js'


const electron = createRequire(import.meta.url)('electron') as typeof ElectronApi
const { app, BrowserWindow, dialog, ipcMain, shell } = electron

const here = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = join(resolveDataDir(), 'arranque.log')

function logLine(text: string): void {
  try {
    mkdirSync(resolveDataDir(), { recursive: true })
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${text}\n`, 'utf8')
  } catch {
    /* Si ni siquiera se puede escribir el log, no hay nada más que hacer. */
  }
}

for (const level of ['log', 'error', 'warn'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]): void => {
    original(...args)
    logLine(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }
}

process.on('uncaughtException', (error: Error) => {
  logLine(`EXCEPCIÓN NO CAPTURADA: ${error.stack ?? error.message}`)
  try {
    dialog.showErrorBox(
      'El sorteo se ha cerrado solo',
      `${error.message}\n\nHay más detalle en:\n${LOG_PATH}`,
    )
  } catch {
    /* Puede pasar antes de que Electron esté listo. */
  }
  process.exit(1)
})

logLine(`--- arranque (electron ${process.versions.electron ?? '?'}) ---`)


function loadDesktopConfig(): void {
  const candidates = [join(process.cwd(), '.env'), join(resolveDataDir(), '.env')]
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, quiet: true })
      return
    }
  }
}

loadDesktopConfig()

let running: RunningApp | null = null
let window: ElectronApi.BrowserWindow | null = null
let updater: UpdaterI | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
}

function createWindow(url: string): ElectronApi.BrowserWindow {
  const icon = join(here, 'icon.png')

  const created = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#10131c',
    title: 'Sorteo de subs',
    ...(existsSync(icon) ? { icon } : {}),
    show: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const announce = (): void => {
    if (!created.isDestroyed()) created.webContents.send('window:maximized', created.isMaximized())
  }
  created.on('maximize', announce)
  created.on('unmaximize', announce)

  created.once('ready-to-show', () => created.show())
  void created.loadURL(url)

  created.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })

  return created
}

function showStartupError(error: unknown): void {
  const startup = error instanceof StartupError ? error : null

  const title =
    startup?.problem === 'port'
      ? 'La aplicación ya está abierta'
      : 'No se pudo abrir el sorteo'

  dialog.showErrorBox(title, startup ? startup.message : String(error))
}

app.whenReady().then(
  async () => {
    try {
      running = await startApp()
    } catch (error) {
      showStartupError(error)
      app.quit()
      return
    }

    window = createWindow(running.panelUrl)

    updater = startUpdater({
      app,
      log: logLine,
      onChange: (state) => {
        if (window && !window.isDestroyed()) window.webContents.send('update:state', state)
      },
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && running) {
        window = createWindow(running.panelUrl)
      }
    })
  },
  (error: unknown) => {
    showStartupError(error)
    app.quit()
  },
)

ipcMain.handle('pick-db-folder', async (): Promise<string | null> => {
  if (!window) return null

  const result = await dialog.showOpenDialog(window, {
    title: 'Dónde guardar el sorteo',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Usar esta carpeta',
  })

  if (result.canceled || !result.filePaths[0]) return null
  return join(result.filePaths[0], 'sorteos.db')
})

function senderWindow(event: ElectronApi.IpcMainInvokeEvent): ElectronApi.BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

ipcMain.handle('window:minimize', (event) => {
  senderWindow(event)?.minimize()
})

ipcMain.handle('window:toggle-maximize', (event): boolean => {
  const target = senderWindow(event)
  if (!target) return false
  if (target.isMaximized()) target.unmaximize()
  else target.maximize()
  return target.isMaximized()
})

ipcMain.handle('window:close', (event) => {
  senderWindow(event)?.close()
})

ipcMain.handle('window:is-maximized', (event): boolean => senderWindow(event)?.isMaximized() ?? false)

ipcMain.handle(
  'update:state',
  (): UpdateStateT => updater?.state() ?? { state: 'disabled', reason: 'todavía arrancando' },
)

ipcMain.handle('update:install', () => {
  updater?.installNow()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  updater?.stop()
  void running?.stop()
})
