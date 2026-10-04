import { build } from 'esbuild'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

await build({
  entryPoints: ['scripts/verify-save.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '/tmp/verify-save-bundle.mjs',
  alias: {
    '@': path.resolve('src'),
  },
})

await import(pathToFileURL('/tmp/verify-save-bundle.mjs').href)
