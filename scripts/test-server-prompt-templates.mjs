#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { join } from 'node:path'

const baseUrl = process.env.SERVER_BASE_URL || 'http://127.0.0.1:3001'
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || 'local-admin-bootstrap-token'
const stamp = Date.now().toString(36)

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, options)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  return { response, payload }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function buildDataSourceUrl() {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
  const markdown = [
    `# Cinematic Product Poster ${stamp}`,
    `![preview](${image})`,
    '',
    '```prompt',
    `Create a premium cinematic product poster ${stamp} for a translucent smart speaker on a reflective black table, with crisp rim light, controlled typography area, tactile material details, and a polished commercial photography finish.`,
    '```',
    '',
    '# Too Short',
    '',
    '```prompt',
    'test',
    '```',
    '',
    `# Editorial Brand Scene ${stamp}`,
    '',
    '```prompt',
    `Create a detailed cinematic brand photography scene ${stamp} with layered lighting, refined material texture, realistic shadows, editorial composition, premium background styling, and enough structure to become a prompt library candidate.`,
    '```',
    '',
    `# Minimal Interior Scene ${stamp}`,
    '',
    '```prompt',
    `Design a calm minimalist interior scene ${stamp} with a linen sofa, walnut side table, morning window light, restrained color accents, realistic shadows, and editorial magazine composition suitable for an image generation prompt library.`,
    '```',
  ].join('\n')
  return `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`
}

async function main() {
  const login = await request('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `prompt-${stamp}@admin.local`,
      displayName: 'Prompt Verify Admin',
      bootstrapToken,
    }),
  })
  assert(login.response.status === 200, `admin login failed: ${login.response.status} ${JSON.stringify(login.payload)}`)
  const token = login.payload.session.token
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const manual = await request('/api/admin/content/templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `Manual Template ${stamp}`,
      category: '产品静物',
      tags: ['manual', 'verify'],
      prompt: 'Create a high-end product still life image with a matte ceramic bottle, precise studio lighting, gentle reflections, neutral background, and clear commercial composition for a prompt library entry.',
      imagePath: '/prompt-template-assets/manual-placeholder.jpg',
      sourceUrl: 'manual-admin-entry',
      status: 'published',
    }),
  })
  assert(manual.response.status === 201, `manual template failed: ${manual.response.status} ${JSON.stringify(manual.payload)}`)

  const importRun = await request('/api/admin/content/template-import-runs', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceUrl: buildDataSourceUrl() }),
  })
  assert(importRun.response.status === 201, `import run failed: ${importRun.response.status} ${JSON.stringify(importRun.payload)}`)
  assert(importRun.payload.createdCandidates === 2, `expected 2 quality candidates, got ${JSON.stringify(importRun.payload)}`)

  const candidates = await request(`/api/admin/content/template-candidates?importRunId=${encodeURIComponent(importRun.payload.importRun.id)}&status=pending`, { headers })
  assert(candidates.response.status === 200, `candidate list failed: ${candidates.response.status} ${JSON.stringify(candidates.payload)}`)
  assert(candidates.payload.candidates.length === 2, `expected 2 pending candidates, got ${JSON.stringify(candidates.payload)}`)

  const withImage = candidates.payload.candidates.find((item) => item.imagePath)
  assert(withImage?.imagePath, `expected one localized image candidate: ${JSON.stringify(candidates.payload.candidates)}`)
  const localImagePath = join(process.cwd(), 'public', String(withImage.imagePath).replace(/^\//, ''))
  assert(existsSync(localImagePath), `localized image missing on disk: ${localImagePath}`)

  const approve = await request(`/api/admin/content/template-candidates/${encodeURIComponent(candidates.payload.candidates[0].id)}/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ category: '品牌广告', tags: ['imported', 'approved'], reviewNote: 'verify approve' }),
  })
  assert(approve.response.status === 200, `approve failed: ${approve.response.status} ${JSON.stringify(approve.payload)}`)
  assert(approve.payload.template.status === 'published', `approved template not published: ${JSON.stringify(approve.payload)}`)

  const reject = await request(`/api/admin/content/template-candidates/${encodeURIComponent(candidates.payload.candidates[1].id)}/reject`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reviewNote: 'verify reject' }),
  })
  assert(reject.response.status === 200, `reject failed: ${reject.response.status} ${JSON.stringify(reject.payload)}`)
  assert(reject.payload.candidate.status === 'rejected', `candidate not rejected: ${JSON.stringify(reject.payload)}`)

  const runDetail = await request(`/api/admin/content/template-import-runs/${encodeURIComponent(importRun.payload.importRun.id)}`, { headers })
  assert(runDetail.response.status === 200, `run detail failed: ${runDetail.response.status} ${JSON.stringify(runDetail.payload)}`)
  assert(
    runDetail.payload.importRun.approvedCount === 1 && runDetail.payload.importRun.rejectedCount === 1,
    `run counts mismatch: ${JSON.stringify(runDetail.payload)}`,
  )

  const templateList = await request(`/api/admin/content/templates?search=${encodeURIComponent(stamp)}&limit=25&offset=0`, { headers })
  assert(templateList.response.status === 200, `template list failed: ${templateList.response.status} ${JSON.stringify(templateList.payload)}`)
  assert(templateList.payload.templates.some((item) => item.id === manual.payload.template.id), 'manual template missing from list')

  const deleteManual = await request(`/api/admin/content/templates/${encodeURIComponent(manual.payload.template.id)}`, {
    method: 'DELETE',
    headers,
  })
  assert(deleteManual.response.status === 200, `template delete failed: ${deleteManual.response.status} ${JSON.stringify(deleteManual.payload)}`)

  const deletedDetail = await request(`/api/admin/content/templates/${encodeURIComponent(manual.payload.template.id)}`, { headers })
  assert(deletedDetail.response.status === 404, `deleted template still readable: ${deletedDetail.response.status} ${JSON.stringify(deletedDetail.payload)}`)

  await request('/api/admin/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

  console.log(JSON.stringify({
    ok: true,
    manualTemplateId: manual.payload.template.id,
    importRunId: importRun.payload.importRun.id,
    localizedImagePath: withImage.imagePath,
    approvedTemplateId: approve.payload.template.id,
    rejectedCandidateId: reject.payload.candidate.id,
    deletedTemplateId: manual.payload.template.id,
    importRunCounts: {
      approved: runDetail.payload.importRun.approvedCount,
      rejected: runDetail.payload.importRun.rejectedCount,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
