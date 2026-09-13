import axios from 'axios'

/** Une clases ignorando las vacías. */
export const cn = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ')

/**
 * Convierte cualquier error en un mensaje que el streamer pueda leer.
 *
 * Nunca devuelve un objeto de Axios crudo: el panel va en una segunda pantalla
 * y lo que salga ahí tiene que decir qué pasa, no un stack.
 */
export const handleErrorResponse = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const apiError = (error.response?.data as { error?: string } | undefined)?.error
    if (apiError) return apiError
    if (error.code === 'ECONNABORTED') return 'El servidor del sorteo tardó demasiado en responder.'
    if (!error.response) return 'No hay conexión con el servidor del sorteo.'
    return `El servidor respondió ${error.response.status}.`
  }
  if (error instanceof Error) return error.message
  return 'Ha fallado algo inesperado.'
}

/** 1234 → "1.234" */
export const formatNumber = (value: number): string => value.toLocaleString('es-ES')
