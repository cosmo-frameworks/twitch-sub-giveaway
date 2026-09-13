import { spawn } from 'node:child_process'
import process from 'node:process'

/**
 * Abre una URL en el navegador por defecto.
 *
 * @returns `false` si no se pudo lanzar; el que llama debe enseñar la URL para
 *   copiarla a mano (pasa en WSL, en servidores sin escritorio, por SSH…).
 */
export function openBrowser(url: string): boolean {
  try {
    if (process.platform === 'win32') {
      // `start` es un builtin de cmd, no un ejecutable. El `""` es el título de
      // la ventana: sin él, cmd interpreta la URL entrecomillada como título.
      // `windowsVerbatimArguments` evita que Node re-escape los `&` de la query.
      spawn('cmd.exe', ['/c', `start "" "${url}"`], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
    return true
  } catch {
    return false
  }
}
