import { cp } from 'node:fs/promises'

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/auth/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  onSuccess: async () => {
    await cp('src/db/migrations', 'dist/db/migrations', { recursive: true })
  },
})
