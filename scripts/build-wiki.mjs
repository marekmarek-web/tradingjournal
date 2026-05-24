import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'training')

const wikiCandidates = [
  join(root, 'wiki-app'),
  join(root, '..', 'Developer', 'ai-trading-wiki-live'),
]

const wikiDir = wikiCandidates.find((p) => existsSync(join(p, 'package.json')))
if (!wikiDir) {
  if (existsSync(join(outDir, 'index.html'))) {
    console.log('[build-wiki] Wiki source missing — using committed public/training')
    process.exit(0)
  }
  console.error('[build-wiki] No wiki source and no public/training fallback')
  process.exit(1)
}

console.log(`[build-wiki] Building from ${wikiDir}`)
execSync('npm run build', {
  cwd: wikiDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: '/training/' },
})

const dist = join(wikiDir, 'dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('[build-wiki] dist/index.html not found')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(dist, outDir, { recursive: true })
console.log(`[build-wiki] Copied to ${outDir}`)
