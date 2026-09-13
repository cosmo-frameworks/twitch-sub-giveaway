/**
 * Twurple no pasa el `message_id` del sobre de EventSub al handler —solo lo usa
 * para su deduplicación en memoria— y hace falta para deduplicar entre
 * reinicios. Por eso se intercepta `_handleSingleEventPayload`, que es API
 * interna: se tipa con `Parameters<...>` para que un cambio de firma al
 * actualizar Twurple rompa la compilación, y hay un test que lo vigila.
 */

import type { ApiClient } from '@twurple/api'
import { EventSubWsListener } from '@twurple/eventsub-ws'

import {
  normalizeGift,
  normalizeResub,
  normalizeSubscribe,
  type SubEvent,
} from './normalize.js'

/** Una entrada con este prefijo no se puede deduplicar entre reinicios. */
export const MISSING_MESSAGE_ID_PREFIX = 'no-message-id:'

/**
 * Funciona porque la entrega es síncrona: `_handleSingleEventPayload` llama a
 * `_handleData`, que llama al handler sin ceder el turno antes.
 */
export class MessageIdCapturingListener extends EventSubWsListener {
  #currentMessageId: string | undefined

  get currentMessageId(): string | undefined {
    return this.#currentMessageId
  }

  override _handleSingleEventPayload(
    ...args: Parameters<EventSubWsListener['_handleSingleEventPayload']>
  ): void {
    this.#currentMessageId = args[2]
    try {
      super._handleSingleEventPayload(...args)
    } finally {
      this.#currentMessageId = undefined
    }
  }
}

export interface SubEventListenerOptions {
  apiClient: ApiClient
  broadcasterId: string
  /** `undefined` = EventSub real. Definido = mock del Twitch CLI. */
  eventSubUrl?: string | undefined

  onEvent: (event: SubEvent) => void
  onConnect?: () => void
  onDisconnect?: (error?: Error) => void
  onRevoke?: (detail: string) => void
  /** La captura del `message_id` falló: hay que mirar si Twurple cambió. */
  onMissingMessageId?: (event: SubEvent) => void

  /**
   * `cliCommand` solo viene contra el mock del CLI, y lleva el `--session` y el
   * `--subscription-id` correctos: sin ellos `twitch event trigger` manda un id
   * inventado y Twurple lo descarta con "Notification from unknown event received".
   */
  onSubscriptionReady?: (info: { type: string; cliCommand: string | null }) => void

  /** Sin esto, una suscripción fallida deja el socket mudo en silencio. */
  onSubscriptionFailed?: (type: string, error: Error) => void

  now?: () => Date
  createListener?: (config: { apiClient: ApiClient; url?: string }) => MessageIdCapturingListener
}

export class SubEventListener {
  readonly #listener: MessageIdCapturingListener
  readonly #options: SubEventListenerOptions
  readonly #now: () => Date
  #started = false

  constructor(options: SubEventListenerOptions) {
    this.#options = options
    this.#now = options.now ?? (() => new Date())
    const config = {
      apiClient: options.apiClient,
      ...(options.eventSubUrl === undefined ? {} : { url: options.eventSubUrl }),
    }
    this.#listener = (options.createListener ?? ((c) => new MessageIdCapturingListener(c)))(config)
  }

  /**
   * Si Twurple dejara de entregarlo de forma síncrona, se genera un id sintético
   * y se avisa: perder un sub en directo es peor que arriesgarse a contar dos
   * veces un reenvío, que además Twurple filtra en memoria 10 minutos.
   */
  #messageId(): { id: string; missing: boolean } {
    const id = this.#listener.currentMessageId
    if (id) return { id, missing: false }

    return {
      id: `${MISSING_MESSAGE_ID_PREFIX}${crypto.randomUUID()}`,
      missing: true,
    }
  }

  async #reportSubscriptionReady(
    subscription: Parameters<
      Parameters<MessageIdCapturingListener['onSubscriptionCreateSuccess']>[0]
    >[0],
  ): Promise<void> {
    if (!this.#options.onSubscriptionReady) return

    let cliCommand: string | null = null
    try {
      cliCommand = await this.#listener._getCliTestCommandForSubscription(subscription)
    } catch {
      /* no estamos contra el mock del CLI: no hay comando que enseñar */
    }

    this.#options.onSubscriptionReady({ type: subscription.id, cliCommand })
  }

  #emit(build: (messageId: string, at: Date) => SubEvent): void {
    const { id, missing } = this.#messageId()
    const event = build(id, this.#now())

    if (missing) this.#options.onMissingMessageId?.(event)
    this.#options.onEvent(event)
  }

  start(): void {
    if (this.#started) return
    this.#started = true

    const { broadcasterId } = this.#options

    // Suscripciones NUEVAS. No salta en renovaciones.
    this.#listener.onChannelSubscription(broadcasterId, (event) => {
      this.#emit((id, at) => normalizeSubscribe(event, id, at))
    })

    this.#listener.onChannelSubscriptionGift(broadcasterId, (event) => {
      this.#emit((id, at) => normalizeGift(event, id, at))
    })

    // Los resubs. Sin esto se pierden todas las renovaciones mensuales.
    this.#listener.onChannelSubscriptionMessage(broadcasterId, (event) => {
      this.#emit((id, at) => normalizeResub(event, id, at))
    })

    this.#listener.onSubscriptionCreateSuccess((subscription) => {
      void this.#reportSubscriptionReady(subscription)
    })

    this.#listener.onSubscriptionCreateFailure((subscription, error) => {
      this.#options.onSubscriptionFailed?.(subscription.id, error)
    })

    this.#listener.onUserSocketConnect(() => this.#options.onConnect?.())

    this.#listener.onUserSocketDisconnect((_userId, error) => {
      this.#options.onDisconnect?.(error)
    })

    this.#listener.onRevoke((subscription, status) => {
      this.#options.onRevoke?.(`${subscription.id} (${status})`)
    })

    this.#listener.start()
  }

  stop(): void {
    if (!this.#started) return
    this.#listener.stop()
    this.#started = false
  }

  get isActive(): boolean {
    return this.#listener.isActive
  }
}
