import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema.js'

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenDbOptions {
  /** Ruta del fichero, o `':memory:'` en tests. */
  path: string
  /** Carpeta de migraciones. Por defecto se busca sola. */
  migrationsFolder?: string
}

export interface DbHandle {
  db: Db
  /** Conexión cruda, para pragmas y para cerrar. */
  sqlite: Database.Database
  close: () => void
}

/**
 * Localiza la carpeta de migraciones.
 *
 * Se prueban varias rutas porque el fichero que ejecuta esto vive en sitios
 * distintos según el caso: `src/db/client.ts` con tsx, `dist/index.js` cuando
 * tsup lo empaqueta todo en un bundle.
 */
function findMigrationsFolder(): string {
  const candidates = [
    // Desarrollo: junto a este mismo fichero.
    fileURLToPath(new URL('./migrations', import.meta.url)),
    // Bundle: `import.meta.url` apunta a dist/index.js.
    fileURLToPath(new URL('./db/migrations', import.meta.url)),
    // Último recurso: desde la raíz del proyecto.
    resolve(process.cwd(), 'src/db/migrations'),
  ]

  const found = candidates.find((c) => existsSync(c))
  if (!found) {
    throw new Error(
      `No se encontró la carpeta de migraciones. Rutas probadas:\n  ${candidates.join('\n  ')}\n` +
        'Si esto pasa en una versión empaquetada, es que el build no copió src/db/migrations.',
    )
  }
  return found
}

/**
 * Abre la base de datos, aplica las migraciones pendientes y devuelve el
 * cliente de Drizzle.
 */
export function openDb(options: OpenDbOptions): DbHandle {
  if (options.path !== ':memory:') {
    mkdirSync(dirname(resolve(options.path)), { recursive: true })
  }

  const sqlite = new Database(options.path)

  // WAL: deja leer mientras se escribe. El panel consulta la lista en directo
  // mientras el listener inserta entradas.
  if (options.path !== ':memory:') sqlite.pragma('journal_mode = WAL')

  // Sin esto las claves ajenas del esquema son decorativas: SQLite las ignora
  // por compatibilidad hacia atrás, y hay que pedirlo en CADA conexión.
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: options.migrationsFolder ?? findMigrationsFolder() })

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  }
}
