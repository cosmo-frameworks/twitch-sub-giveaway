/** En una pestaña del navegador todo esto es `undefined` y la interfaz cae. */
interface DesktopWindowI {
  minimize: () => Promise<void>
  /** Devuelve cómo queda la ventana después de alternar. */
  toggleMaximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  /** Avisa de los cambios que no vienen de estos botones. Devuelve el "deja de escuchar". */
  onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
}

/** Lo mismo que `UpdateStateT` en desktop/updater.ts. */
export type UpdateStateT =
  | { state: 'idle' }
  | { state: 'disabled'; reason: string }
  | { state: 'checking' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

interface DesktopUpdateI {
  state: () => Promise<UpdateStateT>
  /** Cierra la aplicación e instala. Solo cuando lo pulsa el streamer. */
  installNow: () => Promise<void>
  onChange: (listener: (state: UpdateStateT) => void) => () => void
}

interface DesktopBridgeI {
  pickDbFolder: () => Promise<string | null>
  window: DesktopWindowI
  update: DesktopUpdateI
}

declare global {
  interface Window {
    sorteo?: DesktopBridgeI
  }
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && Boolean(window.sorteo)

export const pickDbFolder = async (): Promise<string | null> =>
  (await window.sorteo?.pickDbFolder()) ?? null

/**
 * Los mandos de la ventana, o null en el navegador.
 *
 * Se devuelve null en vez de un objeto con funciones vacías para que quien lo
 * use tenga que decidir qué enseñar cuando no hay ventana.
 */
export const desktopWindow = (): DesktopWindowI | null =>
  typeof window === 'undefined' ? null : (window.sorteo?.window ?? null)

/** Las actualizaciones, o null en el navegador: ahí no hay nada que actualizar. */
export const desktopUpdate = (): DesktopUpdateI | null =>
  typeof window === 'undefined' ? null : (window.sorteo?.update ?? null)
