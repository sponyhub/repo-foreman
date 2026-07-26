import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true, mode: 0o700 })
  await chmod(dirPath, 0o700)
}

export async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

export async function readTextFile(filePath) {
  return await readFile(filePath, 'utf8')
}

export async function writeTextFile(filePath, content) {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 })
  await chmod(filePath, 0o600)
}

export async function writeTextFileAtomic(filePath, content) {
  await ensureDir(path.dirname(filePath))
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )

  try {
    await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function readJsonFile(filePath) {
  const raw = await readTextFile(filePath)
  return JSON.parse(raw)
}

export async function writeJsonFile(filePath, data) {
  await writeTextFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

export async function writeJsonFileAtomic(filePath, data) {
  await writeTextFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

export function toPosixPath(filePath) {
  return filePath.replaceAll('\\', '/')
}

export function formatMarkdownList(items) {
  if (!items || items.length === 0) {
    return ''
  }
  return `${items.map((item) => `- ${item}`).join('\n')}\n`
}

export async function appendMarkdownUnique(filePath, items) {
  if (!items || items.length === 0) {
    return
  }
  const existing = (await fileExists(filePath)) ? await readTextFile(filePath) : ''
  const existingItems = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean),
  )
  const nextItems = items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item && !existingItems.has(item))

  const content = formatMarkdownList(nextItems)
  if (!content) {
    return
  }
  await writeTextFile(filePath, `${existing}${content}`)
}
