export type StatusToneT = 'live' | 'warn' | 'alert' | 'idle'

export interface StatusDotPropsI {
  tone: StatusToneT
  /** El texto va siempre: el color solo no es accesible. */
  label: string
  title?: string
}
