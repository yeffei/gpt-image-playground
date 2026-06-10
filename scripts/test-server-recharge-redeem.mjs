#!/usr/bin/env node

import { Client } from 'pg'

const databaseUrl = process.env.DATABASE_URL || 'postgres://gpt_image:gpt_image_dev_password@127.0.0.1:55432/gpt_image'
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

async function main() {
  const login = await request('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `redeem-${stamp}@admin.local`,
      displayName: 'Redeem Verify Admin',
      bootstrapToken,
    }),
  })
  assert(login.response.status === 200, `admin login failed: ${login.response.status} ${JSON.stringify(login.payload)}`)

  const adminToken = login.payload.session.token
  const generated = await request('/api/admin/recharge-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ points: 30, count: 3 }),
  })
  assert(generated.response.status === 201, `generate failed: ${generated.response.status} ${JSON.stringify(generated.payload)}`)

  const [redeemable, spare, disabled] = generated.payload.codes
  const expiredGenerated = await request('/api/admin/recharge-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ points: 30, count: 1, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
  })
  assert(expiredGenerated.response.status === 201, `generate expired code failed: ${expiredGenerated.response.status} ${JSON.stringify(expiredGenerated.payload)}`)
  const [expired] = expiredGenerated.payload.codes

  const exported = await request(`/api/admin/recharge-codes/export?batchNo=${encodeURIComponent(generated.payload.batch.batchNo)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert(exported.response.status === 200, `export failed: ${exported.response.status} ${JSON.stringify(exported.payload)}`)
  assert(typeof exported.payload === 'string', `export should return TXT body: ${JSON.stringify(exported.payload)}`)
  const exportedCodes = exported.payload.trim().split(/\n+/).filter(Boolean)
  assert(exportedCodes.length === 3, `export should include 3 active codes before redeem/disable: ${exported.payload}`)
  assert(exportedCodes.includes(redeemable.code) && exportedCodes.includes(spare.code) && exportedCodes.includes(disabled.code), `export missing generated codes: ${exported.payload}`)

  const disabledResult = await request(`/api/admin/recharge-codes/${disabled.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'disabled', reason: 'redeem self-test' }),
  })
  assert(disabledResult.response.status === 200, `disable failed: ${disabledResult.response.status} ${JSON.stringify(disabledResult.payload)}`)

  const db = new Client({ connectionString: databaseUrl })
  await db.connect()

  const now = new Date().toISOString()
  const userId = `user_redeem_${stamp}`
  const token = `sess_redeem_${stamp}`
  await db.query('BEGIN')
  try {
    await db.query(`
      INSERT INTO users (id, email, display_name, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'active', $4, $4)
    `, [userId, `redeem-${stamp}@user.local`, 'Redeem Verify User', now])
    await db.query('INSERT INTO accounts (user_id, balance, frozen_balance, updated_at) VALUES ($1, 5, 0, $2)', [userId, now])
    await db.query('INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      token,
      userId,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    ])
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }

  async function redeem(code) {
    return request('/api/recharge-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    })
  }

  const firstRedeem = await redeem(redeemable.code)
  assert(firstRedeem.response.status === 200, `first redeem failed: ${firstRedeem.response.status} ${JSON.stringify(firstRedeem.payload)}`)
  assert(
    firstRedeem.payload.balanceBefore === 5 && firstRedeem.payload.balanceAfter === 35,
    `unexpected balance payload: ${JSON.stringify(firstRedeem.payload)}`,
  )

  const secondRedeem = await redeem(redeemable.code)
  assert(
    secondRedeem.response.status === 409 && secondRedeem.payload.error === 'code_already_redeemed',
    `second redeem should fail as redeemed: ${secondRedeem.response.status} ${JSON.stringify(secondRedeem.payload)}`,
  )

  const disabledRedeem = await redeem(disabled.code)
  assert(
    disabledRedeem.response.status === 409 && disabledRedeem.payload.error === 'code_disabled',
    `disabled redeem should fail: ${disabledRedeem.response.status} ${JSON.stringify(disabledRedeem.payload)}`,
  )
  const expiredRedeem = await redeem(expired.code)
  assert(
    expiredRedeem.response.status === 409 && expiredRedeem.payload.error === 'code_expired',
    `expired redeem should fail: ${expiredRedeem.response.status} ${JSON.stringify(expiredRedeem.payload)}`,
  )

  const exportedAfterUse = await request(`/api/admin/recharge-codes/export?batchNo=${encodeURIComponent(generated.payload.batch.batchNo)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert(exportedAfterUse.response.status === 200, `export after use failed: ${exportedAfterUse.response.status} ${JSON.stringify(exportedAfterUse.payload)}`)
  const exportedAfterUseCodes = exportedAfterUse.payload.trim().split(/\n+/).filter(Boolean)
  assert(exportedAfterUseCodes.length === 1 && exportedAfterUseCodes[0] === spare.code, `export after redeem/disable should only include spare active code: ${exportedAfterUse.payload}`)

  const account = (await db.query('SELECT balance::text FROM accounts WHERE user_id = $1', [userId])).rows[0]
  const ledger = (await db.query(`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::text AS total
    FROM balance_ledger
    WHERE user_id = $1 AND type = 'recharge_code_redeem'
  `, [userId])).rows[0]
  const attempts = (await db.query(`
    SELECT result, COALESCE(failure_kind, '') AS failure_kind, COUNT(*)::int AS count
    FROM recharge_code_redemption_attempts
    WHERE user_id = $1
    GROUP BY result, failure_kind
    ORDER BY result, failure_kind
  `, [userId])).rows

  const attemptsSummary = await request('/api/admin/recharge-code-redemption-attempts/summary', {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert(
    attemptsSummary.response.status === 200 && attemptsSummary.payload.summary.totalAttempts >= 4,
    `attempt summary failed: ${attemptsSummary.response.status} ${JSON.stringify(attemptsSummary.payload)}`,
  )

  const attemptsList = await request(`/api/admin/recharge-code-redemption-attempts?userId=${encodeURIComponent(userId)}&limit=25&offset=0`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert(
    attemptsList.response.status === 200 && attemptsList.payload.attempts.length === 4,
    `attempt list failed: ${attemptsList.response.status} ${JSON.stringify(attemptsList.payload)}`,
  )
  assert(
    attemptsList.payload.attempts.some((attempt) => attempt.result === 'succeeded' && attempt.points === 30),
    `attempt list missing success: ${JSON.stringify(attemptsList.payload.attempts)}`,
  )
  assert(
    attemptsList.payload.attempts.every((attempt) => attempt.userEmail === `redeem-${stamp}@user.local` && attempt.userDisplayName === 'Redeem Verify User'),
    `attempt list should expose readable user fields: ${JSON.stringify(attemptsList.payload.attempts)}`,
  )

  const attemptDetailId = attemptsList.payload.attempts[0].id
  const attemptDetail = await request(`/api/admin/recharge-code-redemption-attempts/${encodeURIComponent(attemptDetailId)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  assert(
    attemptDetail.response.status === 200 && attemptDetail.payload.attempt.id === attemptDetailId,
    `attempt detail failed: ${attemptDetail.response.status} ${JSON.stringify(attemptDetail.payload)}`,
  )

  await request('/api/admin/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } })
  await db.query('DELETE FROM user_sessions WHERE token = $1', [token])
  await db.end()

  assert(Number(account.balance) === 35, `db balance mismatch: ${JSON.stringify(account)}`)
  assert(ledger.count === 1 && Number(ledger.total) === 30, `ledger mismatch: ${JSON.stringify(ledger)}`)

  console.log(JSON.stringify({
    ok: true,
    batchNo: generated.payload.batch.batchNo,
    redeemableCodeId: redeemable.id,
    spareCodeId: spare.id,
    disabledCodeId: disabled.id,
    expiredCodeId: expired.id,
    firstRedeem: firstRedeem.payload,
    secondRedeem: secondRedeem.payload,
    disabledRedeem: disabledRedeem.payload,
    expiredRedeem: expiredRedeem.payload,
    exportedCodesBeforeUse: exportedCodes.length,
    exportedCodesAfterUse: exportedAfterUseCodes.length,
    accountBalance: Number(account.balance),
    ledger,
    attempts,
    attemptsSummary: attemptsSummary.payload.summary,
    attemptsListCount: attemptsList.payload.attempts.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
