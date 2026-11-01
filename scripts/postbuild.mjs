// Strips files the Sites uploader refuses (hidden files and source maps)
// from the build output, so `deploy.json` can point straight at dist/.
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function clean(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name.startsWith('.') || name.endsWith('.map')) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (statSync(path).isDirectory()) clean(path)
  }
}

const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const clientDir = join(distDir, 'client')

// Clean hidden / map files
clean(distDir)

// Copy client assets to dist root for platforms expecting dist/index.html (e.g. Vercel)
if (existsSync(clientDir)) {
  for (const item of readdirSync(clientDir)) {
    cpSync(join(clientDir, item), join(distDir, item), { recursive: true })
  }
}
