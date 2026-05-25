const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Monorepo-Support: packages/shared aus Root auflösen
config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// TypeScript aus Workspace-Paketen auflösen
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx', 'cjs', 'mjs']

module.exports = config
