import React, { useState } from 'react'

import { Button } from '@shared/components/button'
import { Field } from '@shared/components/field'

import { isDesktop, pickDbFolder } from '@lib/desktop'

import type { PanelStatusI } from '@status/domain/models/StatusI'

const DB_SOURCE_LABEL: Record<PanelStatusI['storage']['dbSource'], string> = {
  default: 'carpeta por defecto',
  settings: 'elegida aquí',
  env: 'fijada por variable de entorno',
}

export interface StatusPanelPropsI {
  status: PanelStatusI
  reauthorizing: boolean
  saving: boolean
  notice: string | null
  error: string | null
  onReauthorize: () => void
  onSaveDbPath: (dbPath: string | null) => void
  onDismissNotice: () => void
}

const heading: React.CSSProperties = {
  fontSize: 'var(--t-body)',
  fontWeight: 600,
  marginBottom: 'calc(var(--step) * 1)',
}

const explain: React.CSSProperties = {
  margin: 0,
  color: 'var(--paper-dim)',
  fontSize: 'var(--t-small)',
  maxWidth: '70ch',
}

export const StatusPanel: React.FC<StatusPanelPropsI> = ({
  status,
  reauthorizing,
  saving,
  notice,
  error,
  onReauthorize,
  onSaveDbPath,
  onDismissNotice,
}) => {
  const [draftPath, setDraftPath] = useState<string>(status.storage.dbPath)

  const authNeedsAction = status.auth.state === 'revoked' || status.auth.state === 'unauthenticated'

  return (
    <section
      style={{
        borderTop: '1px solid var(--rule)',
        background: 'var(--ink-sunken)',
        padding: 'calc(var(--step) * 5) calc(var(--step) * 6)',
        display: 'grid',
        gap: 'calc(var(--step) * 5)',
      }}
    >
      <div>
        <div style={heading}>Conexión con Twitch</div>
        <p style={explain}>{status.auth.detail}</p>

        {authNeedsAction && (
          <Button
            tone="alert"
            onClick={onReauthorize}
            disabled={reauthorizing}
            style={{ marginTop: 'calc(var(--step) * 3)' }}
          >
            {reauthorizing ? 'Abriendo el navegador…' : 'Conectar con Twitch'}
          </Button>
        )}
      </div>

      <div>
        <div style={heading}>Dónde se guarda el sorteo</div>
        <p style={{ ...explain, marginBottom: 'calc(var(--step) * 3)' }}>
          {DB_SOURCE_LABEL[status.storage.dbSource]}
        </p>

        <div style={{ display: 'flex', gap: 'calc(var(--step) * 2)', flexWrap: 'wrap' }}>
          <Field
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            spellCheck={false}
            aria-label="Ruta del fichero del sorteo"
            style={{ flex: '1 1 32ch', minWidth: '20ch' }}
          />
          {/* En el navegador no hay selector: la ruta se pega a mano. */}
          {isDesktop() && (
            <Button
              disabled={saving}
              onClick={() => {
                void pickDbFolder().then((picked) => {
                  if (picked) setDraftPath(picked)
                })
              }}
            >
              Elegir carpeta…
            </Button>
          )}
          <Button
            disabled={saving || draftPath === status.storage.dbPath}
            onClick={() => onSaveDbPath(draftPath)}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          {status.storage.dbSource === 'settings' && (
            <Button disabled={saving} onClick={() => onSaveDbPath(null)}>
              Volver a la de por defecto
            </Button>
          )}
        </div>
      </div>

      {(notice ?? error) && (
        <p
          role="status"
          onClick={onDismissNotice}
          style={{
            margin: 0,
            fontSize: 'var(--t-small)',
            color: error ? 'var(--alert)' : 'var(--live)',
            cursor: 'pointer',
          }}
        >
          {error ?? notice}
        </p>
      )}
    </section>
  )
}
