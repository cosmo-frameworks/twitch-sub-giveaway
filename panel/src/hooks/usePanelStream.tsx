import { useEffect, useRef, useState } from 'react'

/** Eventos que el backend publica por el WebSocket. */
export type PanelEventT =
  | { type: 'entry.added'; giveawayId: string; participant: unknown; added: number; totals: unknown }
  | { type: 'winner.drawn'; giveawayId: string; position: number; displayName: string }
  | { type: 'auth.status'; state: string; detail: string }
  | { type: 'eventsub.status'; connected: boolean; detail: string }
  | { type: 'reconciled'; giveawayId: string; entriesAdded: number; totals: unknown }

export type StreamStateT = 'connecting' | 'live' | 'reconnecting'

/**
 * Conexión al stream del sorteo.
 *
 * Reconecta sola: el panel va a estar abierto horas en una segunda pantalla y
 * un reinicio del backend no puede dejarlo mudo para siempre. El backoff sube
 * hasta 10s para no machacar el servidor mientras esté caído.
 */
export const usePanelStream = (
  giveawayId: string | null,
  onEvent: (event: PanelEventT) => void,
): { streamState: StreamStateT } => {
  const [streamState, setStreamState] = useState<StreamStateT>('connecting')

  // El handler cambia en cada render; guardarlo en una ref evita reabrir el
  // socket cada vez.
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!giveawayId) return

    let socket: WebSocket | null = null
    let retryTimer: number | undefined
    let attempt = 0
    let closed = false

    const connect = (): void => {
      if (closed) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/giveaways/${giveawayId}/stream`,
      )

      socket.onopen = () => {
        attempt = 0
        setStreamState('live')
      }

      socket.onmessage = (message: MessageEvent<string>) => {
        try {
          onEventRef.current(JSON.parse(message.data) as PanelEventT)
        } catch {
          // Un mensaje mal formado no puede tumbar el panel en directo.
        }
      }

      socket.onclose = () => {
        if (closed) return
        setStreamState('reconnecting')
        const delay = Math.min(10_000, 500 * 2 ** attempt++)
        retryTimer = window.setTimeout(connect, delay)
      }

      socket.onerror = () => socket?.close()
    }

    connect()

    return () => {
      closed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      socket?.close()
    }
  }, [giveawayId])

  return { streamState }
}
