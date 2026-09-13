import React from 'react'

import { Button } from '@shared/components/button'

import type { DeviceStateT } from '@status/domain/models/StatusI'

export interface ConnectScreenPropsI {
  device: DeviceStateT
  starting: boolean
  onStart: () => void
  onCancel: () => void
}

/**
 * Lo primero que ve el streamer al abrir la aplicación por primera vez.
 *
 * No hay nada que rellenar: ni claves, ni nombre de canal, ni ficheros. Sale un
 * código, se teclea en twitch.tv/activate y el canal pasa a ser el de quien
 * acaba de autorizar.
 */
export const ConnectScreen: React.FC<ConnectScreenPropsI> = ({
  device,
  starting,
  onStart,
  onCancel,
}) => (
  <main
    style={{
      height: '100%',
      overflowY: 'auto',
      display: 'grid',
      placeItems: 'center',
      padding: 'calc(var(--step) * 8)',
      textAlign: 'center',
    }}
  >
    <div style={{ maxWidth: '34rem' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 400,
          fontSize: 'clamp(1.8rem, 5vw, 2.6rem)',
          margin: 0,
          lineHeight: 1.1,
        }}
      >
        Conecta tu canal de Twitch
      </h1>

      {device.state === 'waiting' ? (
        <>
          <p
            style={{
              color: 'var(--paper-dim)',
              fontSize: 'var(--t-lead)',
              marginTop: 'calc(var(--step) * 4)',
            }}
          >
            Entra en <strong style={{ color: 'var(--paper)' }}>twitch.tv/activate</strong> y escribe
            este código:
          </p>

          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2.6rem, 11vw, 5rem)',
              letterSpacing: '0.12em',
              margin: 'calc(var(--step) * 4) 0',
              // Se lee en voz alta a menudo; que no se confunda O con 0.
              fontVariantNumeric: 'slashed-zero',
            }}
          >
            {device.userCode}
          </p>

          <div
            style={{
              display: 'flex',
              gap: 'calc(var(--step) * 3)',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <a
              className="btn btn--primary btn--lg"
              href={device.verificationUri}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              Abrir twitch.tv/activate
            </a>
            <Button size="lg" onClick={onCancel}>
              Cancelar
            </Button>
          </div>

          <p
            style={{
              color: 'var(--paper-faint)',
              fontSize: 'var(--t-small)',
              marginTop: 'calc(var(--step) * 5)',
            }}
          >
            En cuanto autorices, esta pantalla pasa sola al tablero.
          </p>
        </>
      ) : (
        <>
          <p
            style={{
              color: 'var(--paper-dim)',
              fontSize: 'var(--t-lead)',
              marginTop: 'calc(var(--step) * 4)',
              marginBottom: 'calc(var(--step) * 6)',
            }}
          >
            Para apuntar a quien se suscriba o regale subs, la aplicación necesita permiso para
            leer la lista de suscriptores de tu canal. Solo hay que hacerlo una vez.
          </p>

          <Button tone="primary" size="lg" onClick={onStart} disabled={starting}>
            {starting ? 'Pidiendo código…' : 'Conectar con Twitch'}
          </Button>

          {device.state === 'error' && (
            <p
              role="status"
              style={{
                color: 'var(--alert)',
                fontSize: 'var(--t-small)',
                marginTop: 'calc(var(--step) * 5)',
              }}
            >
              {device.message}
            </p>
          )}
        </>
      )}
    </div>
  </main>
)
