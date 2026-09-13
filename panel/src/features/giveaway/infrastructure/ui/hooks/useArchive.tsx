import { useCallback, useMemo, useState } from 'react'

import { GiveawayAdapter } from '@giveaway/application/adapters/giveaway.adapter'
import { GiveawayUseCases } from '@giveaway/infrastructure/usecases/giveaway.usecases'

import { handleErrorResponse } from '@lib/utils'

import type { ArchivedGiveawayI } from '@giveaway/domain/models/ParticipantI'

/** Un día con los sorteos que se hicieron ese día, del más reciente al más antiguo. */
export interface ArchiveDayI {
  /** `2026-09-13`, para usar como clave. */
  key: string
  label: string
  giveaways: ArchivedGiveawayI[]
}

/**
 * Por día local, no UTC: un sorteo de las 00:30 pertenece al directo de la
 * noche anterior para quien lo hizo, y en UTC caería en otro día.
 */
function groupByDay(giveaways: ArchivedGiveawayI[]): ArchiveDayI[] {
  const days = new Map<string, ArchiveDayI>()

  for (const giveaway of giveaways) {
    const date = new Date(giveaway.openedAt)
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')

    const existing = days.get(key)
    if (existing) {
      existing.giveaways.push(giveaway)
      continue
    }

    // Solo la primera letra: `text-transform: capitalize` daría
    // "Lunes, 12 De Enero De 2026", que en español está mal.
    const label = date.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    days.set(key, {
      key,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      giveaways: [giveaway],
    })
  }

  return [...days.values()]
}

export const useArchive = () => {
  const [days, setDays] = useState<ArchiveDayI[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  /** Id del sorteo sobre el que hay una acción en curso, para bloquear su fila. */
  const [busyId, setBusyId] = useState<string | null>(null)

  const giveawayUseCases = useMemo(() => new GiveawayUseCases(new GiveawayAdapter()), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await giveawayUseCases.listGiveaways()
      setDays(groupByDay(response.giveaways))
      setError(null)
    } catch (caught) {
      setError(handleErrorResponse(caught))
    } finally {
      setLoading(false)
    }
  }, [giveawayUseCases])

  const reopen = useCallback(
    async (giveawayId: string): Promise<boolean> => {
      setBusyId(giveawayId)
      try {
        await giveawayUseCases.reopenGiveaway(giveawayId)
        await load()
        return true
      } catch (caught) {
        setError(handleErrorResponse(caught))
        return false
      } finally {
        setBusyId(null)
      }
    },
    [giveawayUseCases, load],
  )

  return { days, loading, error, busyId, load, reopen }
}
