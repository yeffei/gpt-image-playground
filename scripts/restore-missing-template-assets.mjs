import fs from 'node:fs'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { __promptTemplateImportInternals } from '../server/dist/promptTemplates.js'

const { parseMarkdownCandidates } = __promptTemplateImportInternals
const PROJECT_ROOT = process.cwd()
const ASSET_ROOT = path.join(PROJECT_ROOT, 'public', 'prompt-template-assets')

async function fetchText(url) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'gpt-image-playground-admin-importer' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

async function fetchBytes(url) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'gpt-image-playground-admin-importer' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) throw new Error(`not_image:${contentType}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

function getRelativeAssetPath(assetUrl) {
  return assetUrl.replace(/^\/prompt-template-assets\//, '')
}

const response = await fetch('http://127.0.0.1:3002/api/templates?limit=500&offset=0')
if (!response.ok) {
  throw new Error(`failed_to_load_templates:${response.status}`)
}
const payload = await response.json()
const templates = Array.isArray(payload.templates) ? payload.templates : []
const missingTemplates = templates.filter((item) => {
  const assetUrl = typeof item.previewImageUrl === 'string' ? item.previewImageUrl.trim() : ''
  if (!assetUrl.startsWith('/prompt-template-assets/')) return false
  return !fs.existsSync(path.join(ASSET_ROOT, getRelativeAssetPath(assetUrl)))
})

const candidatesBySource = new Map()
for (const template of missingTemplates) {
  const sourceUrl = typeof template.sourceUrl === 'string' ? template.sourceUrl.trim() : ''
  if (!sourceUrl || candidatesBySource.has(sourceUrl)) continue
  const text = await fetchText(sourceUrl)
  candidatesBySource.set(sourceUrl, parseMarkdownCandidates(text, sourceUrl))
}

const restored = []
const unresolved = []
for (const template of missingTemplates) {
  const sourceUrl = typeof template.sourceUrl === 'string' ? template.sourceUrl.trim() : ''
  const assetUrl = typeof template.previewImageUrl === 'string' ? template.previewImageUrl.trim() : ''
  const prompt = typeof template.prompt === 'string' ? template.prompt.trim() : ''
  const title = typeof template.title === 'string' ? template.title.trim() : ''
  const candidates = candidatesBySource.get(sourceUrl) ?? []
  const match = candidates.find((candidate) => candidate.prompt.trim() === prompt)
    ?? candidates.find((candidate) => candidate.title.trim() === title)
  if (!match?.imageUrl) {
    unresolved.push({ id: template.id, title, sourceUrl })
    continue
  }

  const bytes = await fetchBytes(match.imageUrl)
  const relativeAssetPath = getRelativeAssetPath(assetUrl)
  const outputPath = path.join(ASSET_ROOT, relativeAssetPath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, bytes)
  restored.push({ id: template.id, title, outputPath, imageUrl: match.imageUrl })
}

console.log(JSON.stringify({
  totalTemplates: templates.length,
  missingTemplates: missingTemplates.length,
  restoredCount: restored.length,
  unresolved,
  restored: restored.slice(0, 20),
}, null, 2))
