import { cp, readFile, writeFile } from 'node:fs/promises'

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['desktop/main.ts'],
  outDir: 'dist-desktop',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  external: ['electron', 'better-sqlite3', 'electron-updater'],
  onSuccess: async () => {
    await cp('src/db/migrations', 'dist-desktop/db/migrations', { recursive: true })
    await cp('panel/dist', 'dist-desktop/panel', { recursive: true })
    await cp('desktop/preload.cjs', 'dist-desktop/preload.cjs')
    await cp('build/icon.png', 'dist-desktop/icon.png')

    const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }

    await writeFile(
      'dist-desktop/package.json',
      `${JSON.stringify(
        { name: 'twitch-sorteo-desktop', version, type: 'module', main: 'main.js' },
        null,
        2,
      )}\n`,
    )
  },
})
