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
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  stream: path.resolve(monorepoRoot, 'node_modules/stream-browserify'),
  ws: path.resolve(projectRoot, 'shims/ws.js'),
}

// TypeScript aus Workspace-Paketen auflösen
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx', 'cjs', 'mjs']

module.exports = config
