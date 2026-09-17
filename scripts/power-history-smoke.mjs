import { buildSync } from 'esbuild'
import electron from 'electron'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const output = resolve('node_modules/.cache/power-history-smoke.cjs')
buildSync({
  entryPoints: ['scripts/power-history-smoke.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: output
})
// Use the application's Node ABI for its existing better-sqlite3 native dependency.
const result = spawnSync(electron, [output], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  timeout: 30_000
})
if (result.error) throw result.error
if (result.signal) throw new Error(`Power history checks exited with ${result.signal}`)
process.exitCode = result.status ?? 1
