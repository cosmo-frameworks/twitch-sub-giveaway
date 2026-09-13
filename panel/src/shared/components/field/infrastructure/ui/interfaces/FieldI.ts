import type { InputHTMLAttributes } from 'react'

export interface FieldPropsI extends InputHTMLAttributes<HTMLInputElement> {
  /** Ancho en caracteres. Más honesto que un ancho en píxeles para un campo. */
  chars?: number
}
