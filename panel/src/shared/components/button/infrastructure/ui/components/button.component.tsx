import { forwardRef } from 'react'

import type { ButtonPropsI } from '../interfaces/ButtonI'

/**
 * El botón de la aplicación.
 *
 * Existe porque antes no existía: había cuatro tamaños distintos conviviendo
 * (`8px 12px`, `8px 16px`, `10px 18px`, `12px 22px`), cada uno inventado en su
 * fichero, y ninguno respondía al ratón. Todos los estados viven en `.btn` de
 * index.css, porque un estilo en línea no puede tener `:hover` ni `:disabled`.
 *
 * `type="button"` por defecto a propósito: dentro de un formulario, un botón
 * sin `type` envía el formulario, y eso aquí sería sortear sin querer.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonPropsI>(function Button(
  { tone = 'quiet', size = 'md', on = false, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['btn', `btn--${tone}`]
  if (size !== 'md') classes.push(`btn--${size}`)
  if (on) classes.push('btn--on')
  if (className) classes.push(className)

  return <button ref={ref} type={type} className={classes.join(' ')} {...rest} />
})
