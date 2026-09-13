import { forwardRef } from 'react'

import type { FieldPropsI } from '../interfaces/FieldI'

/**
 * El campo de texto de la aplicación.
 *
 * Comparte alto con el botón (`--control`), que es lo que hace que una fila de
 * acciones se lea como una fila y no como piezas sueltas.
 */
export const Field = forwardRef<HTMLInputElement, FieldPropsI>(function Field(
  { chars, className, style, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={className ? `field ${className}` : 'field'}
      style={chars ? { width: `${chars}ch`, ...style } : style}
      {...rest}
    />
  )
})
