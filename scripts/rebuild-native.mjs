// Fetch the Electron-ABI prebuilt binary for better-sqlite3 — no C++ compiler needed.
//
// Why: the app runs inside Electron, not Node. better-sqlite3's own install script
// compiles for the *Node* ABI (and on Node v24 there's no prebuild → it needs MSVC).
// We disable that script (pnpm-workspace.yaml allowBuilds) and instead download the
// matching *Electron* prebuild here via prebuild-install (a transitive dep that ships
// with better-sqlite3). Runs automatically on postinstall.
//
// Mirrors agent-orchestrator's scripts/rebuild-node-pty.js pattern.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)

const target = require('electron/package.json').version
const bsPkgJson = require.resolve('better-sqlite3/package.json')
const bsDir = dirname(bsPkgJson)
const prebuildBin = createRequire(bsPkgJson).resolve('prebuild-install/bin.js')

console.log(`[rebuild-native] better-sqlite3 → Electron ${target} prebuilt`)
execFileSync(
  process.execPath,
  [prebuildBin, '--runtime', 'electron', '--target', target, '--dist-url', 'https://electronjs.org/headers'],
  { cwd: bsDir, stdio: 'inherit' }
)
console.log('[rebuild-native] done')
