import type { ButtonHTMLAttributes } from 'react'

/**
 * Qué tan fuerte habla el botón.
 *
 * `primary` va en crema y es la acción que importa de la pantalla. Solo una por
 * pantalla: si lo llevan cuatro botones deja de señalar nada.
 */
export type ButtonToneT = 'primary' | 'quiet' | 'ghost' | 'alert'

export interface ButtonPropsI extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonToneT
  size?: 'md' | 'sm' | 'lg'
  /** Para los que encienden un modo, como el de OBS: se queda hundido. */
  on?: boolean
}
