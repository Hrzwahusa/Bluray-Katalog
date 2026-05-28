#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

const argv = process.argv.slice(2)

function parseVersion(value) {
	const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/)
	if (!match) {
		throw new Error(`Invalid version "${value}". Expected format: x.y.z`)
	}

	return {
		major: Number.parseInt(match[1], 10),
		minor: Number.parseInt(match[2], 10),
		patch: Number.parseInt(match[3], 10),
	}
}

function toVersionString(version) {
	return `${version.major}.${version.minor}.${version.patch}`
}

function bumpVersion(base, mode) {
	if (mode === 'major') return { major: base.major + 1, minor: 0, patch: 0 }
	if (mode === 'minor') return { major: base.major, minor: base.minor + 1, patch: 0 }
	return { major: base.major, minor: base.minor, patch: base.patch + 1 }
}

function resolveTargetVersion(currentVersion) {
	const setIndex = argv.indexOf('--set')
	if (setIndex !== -1) {
		const rawTarget = argv[setIndex + 1]
		if (!rawTarget) {
			throw new Error('Missing value for --set. Example: npm run version:set -- 1.0.6')
		}
		return rawTarget
	}

	if (argv.includes('--major')) {
		return toVersionString(bumpVersion(parseVersion(currentVersion), 'major'))
	}

	if (argv.includes('--minor')) {
		return toVersionString(bumpVersion(parseVersion(currentVersion), 'minor'))
	}

	return toVersionString(bumpVersion(parseVersion(currentVersion), 'patch'))
}

async function readJson(relativePath) {
	const absolutePath = path.join(repoRoot, relativePath)
	const raw = await fs.readFile(absolutePath, 'utf8')
	return {
		absolutePath,
		data: JSON.parse(raw),
	}
}

async function writeJson(absolutePath, data) {
	await fs.writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function main() {
	const rootPkg = await readJson('package.json')
	const currentVersion = rootPkg.data.version
	if (!currentVersion) {
		throw new Error('Root package.json has no version field.')
	}

	const targetVersion = resolveTargetVersion(currentVersion)
	parseVersion(targetVersion)

	const androidPkg = await readJson('apps/android/package.json')
	const desktopPkg = await readJson('apps/desktop/package.json')
	const appJson = await readJson('apps/android/app.json')

	rootPkg.data.version = targetVersion
	androidPkg.data.version = targetVersion
	desktopPkg.data.version = targetVersion
	if (!appJson.data.expo) {
		throw new Error('apps/android/app.json is missing expo object.')
	}
	appJson.data.expo.version = targetVersion

	await writeJson(rootPkg.absolutePath, rootPkg.data)
	await writeJson(androidPkg.absolutePath, androidPkg.data)
	await writeJson(desktopPkg.absolutePath, desktopPkg.data)
	await writeJson(appJson.absolutePath, appJson.data)

	const gradlePath = path.join(repoRoot, 'apps/android/android/app/build.gradle')
	const gradleRaw = await fs.readFile(gradlePath, 'utf8')
	const updatedGradle = gradleRaw.replace(/versionName\s+"[^"]+"/, `versionName "${targetVersion}"`)
	if (updatedGradle === gradleRaw) {
		throw new Error('Could not update versionName in apps/android/android/app/build.gradle')
	}
	await fs.writeFile(gradlePath, updatedGradle, 'utf8')

	console.log(`Version updated: ${currentVersion} -> ${targetVersion}`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})
