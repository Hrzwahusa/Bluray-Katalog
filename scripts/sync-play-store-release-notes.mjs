#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

function parseArgs(argv) {
  const args = {
    source: path.join(repoRoot, 'apps/android/play-store-release-notes.txt'),
    target: path.join(repoRoot, 'apps/android/android/app/build/outputs/bundle/release/play-store-release-notes.txt'),
  }

  for (let i = 2; i < argv.length; i++) {
    const current = argv[i]
    const next = argv[i + 1]

    if (current === '--source' && next) {
      args.source = path.resolve(repoRoot, next)
      i++
      continue
    }

    if (current === '--target' && next) {
      args.target = path.resolve(repoRoot, next)
      i++
      continue
    }
  }

  return args
}

async function main() {
  const { source, target } = parseArgs(process.argv)
  const content = await fs.readFile(source, 'utf8')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
  console.log(`Release notes copied to ${target}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})