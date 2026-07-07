import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import sharp from 'sharp'

const projectRoot = process.cwd()
const serverEnvPath = path.join(projectRoot, 'server', '.env.local')
const generatedImagesRoot = path.join(projectRoot, 'server', 'storage', 'generated-images')

function readEnvFile(text) {
  const output = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    output[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return output
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function createShareToken() {
  return `share_${crypto.randomUUID().replace(/-/g, '')}`
}

function toPublicUrl(taskId, filename) {
  return `/api/generated-images/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`
}

const demoItems = [
  {
    slug: 'featured-aurora-poster',
    source: 'public/prompt-library-source/wuyoscar/aurora-oolong-poster.png',
    category: '品牌广告',
    title: '乌龙气泡茶品牌主视觉',
    caption: '以霓虹茶色与极简构图做品牌发布画面，适合海报、首页头图和 campaign KV 延展。',
    processingLabel: '文生图',
    featured: true,
    featuredRank: 1,
  },
  {
    slug: 'space-museum-atrium',
    source: 'public/prompt-library-source/wuyoscar/brutalist-concrete-museum-atrium.png',
    category: '空间氛围',
    title: '混凝土中庭与自然天光',
    caption: '保留材质张力和展陈尺度，让灵感页里有一张真正能压住气氛的大图。',
    processingLabel: '文生图',
    featured: true,
    featuredRank: 2,
  },
  {
    slug: 'infographic-animal-atlas',
    source: 'public/prompt-library-source/wuyoscar/endangered-animal-chinese-infographic.png',
    category: '信息图解',
    title: '濒危动物中文图鉴',
    caption: '信息组织清晰，适合验证灵感详情页的长标题、说明文案和相关作品联动。',
    processingLabel: '文生图',
    featured: true,
    featuredRank: 3,
  },
  {
    slug: 'fashion-organic-portrait',
    source: 'public/prompt-library-source/wuyoscar/avant-garde-organic-high-fashion.png',
    category: '人像摄影',
    title: '有机质感高定人像',
    caption: '用雕塑感服装和柔雾布光验证竖图卡片在首页和详情页里的视觉密度。',
    processingLabel: '文生图',
    featured: false,
  },
  {
    slug: 'ui-dashboard-interface',
    source: '.external/gpt-image-playground-customer/readme-images/interface.jpg',
    category: 'UI / 社媒视觉',
    title: '生成工作台界面样张',
    caption: '补一张偏产品界面的灵感图，避免灵感页全是插画或海报，方便后续看分类与节奏。',
    processingLabel: '图像编辑',
    featured: false,
  },
  {
    slug: 'role-comic-pet',
    source: 'public/prompt-library-source/wuyoscar/comic-pet.png',
    category: '角色设定',
    title: '拟人宠物角色设定稿',
    caption: '角色页要能承载单角色立绘和设定说明，这条数据专门用来验证这类内容。',
    processingLabel: '文生图',
    featured: false,
  },
  {
    slug: 'poster-city-tourism',
    source: 'public/prompt-library-source/wuyoscar/city-tourism-promo-poster.png',
    category: '海报插画',
    title: '城市旅游推广海报',
    caption: '用更典型的海报插画样式补足最新入选列表，方便后面继续调卡片和分类切换。',
    processingLabel: '文生图',
    featured: false,
  },
  {
    slug: 'poster-double-exposure',
    source: 'public/prompt-library-source/wuyoscar/dual-exposure-poster.png',
    category: '海报插画',
    title: '双重曝光城市海报',
    caption: '带一点更强叙事感的视觉，放进海报插画类里让广场更像真内容池。',
    processingLabel: '文生图',
    featured: false,
  },
  {
    slug: 'portrait-history-board',
    source: '.external/gpt-image-playground-customer/readme-images/history.jpg',
    category: 'UI / 社媒视觉',
    title: '历史记录信息面板',
    caption: '把偏产品截图的内容也纳入灵感池，补足 UI 类的视觉表达。',
    processingLabel: '图像编辑',
    featured: false,
  },
  {
    slug: 'password-dialog-ui',
    source: '.external/gpt-image-playground-customer/readme-images/password-dialog.jpg',
    category: 'UI / 社媒视觉',
    title: '密码弹窗交互视觉',
    caption: '小尺寸界面图能检验详情页里多种图像比例的适配能力。',
    processingLabel: '图像编辑',
    featured: false,
  },
]

async function ensureLocalImage(taskId, filename, sourceAbsolutePath) {
  const targetDir = path.join(generatedImagesRoot, taskId)
  const targetPath = path.join(targetDir, filename)
  await fs.mkdir(targetDir, { recursive: true })
  await fs.copyFile(sourceAbsolutePath, targetPath)
  const stat = await fs.stat(targetPath)
  const meta = await sharp(targetPath).metadata()
  return {
    storageKey: `${taskId}/${filename}`,
    publicUrl: toPublicUrl(taskId, filename),
    byteSize: stat.size,
    mimeType: meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'webp' ? 'image/webp' : 'image/png',
    width: meta.width ?? null,
    height: meta.height ?? null,
  }
}

async function main() {
  const envFile = await fs.readFile(serverEnvPath, 'utf8')
  const env = readEnvFile(envFile)
  const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const pool = new pg.Pool({ connectionString: databaseUrl })
  const user = (await pool.query(`
    SELECT id, email, display_name
    FROM users
    ORDER BY created_at ASC
    LIMIT 1
  `)).rows[0]
  if (!user) throw new Error('No users found; cannot seed inspiration demo')

  const now = new Date()
  let created = 0
  let updated = 0

  for (let index = 0; index < demoItems.length; index += 1) {
    const item = demoItems[index]
    const sourceAbsolutePath = path.join(projectRoot, item.source)
    const outputId = `seed_insp_output_${item.slug}`
    const taskId = `seed_insp_task_${item.slug}`
    const shareId = `seed_insp_share_${item.slug}`
    const postId = `seed_insp_post_${item.slug}`
    const outputIndex = 0
    const filename = path.basename(sourceAbsolutePath)
    const publishedAt = new Date(now.getTime() - (demoItems.length - index) * 36e5).toISOString()
    const createdAt = new Date(now.getTime() - (demoItems.length - index) * 54e5).toISOString()
    const featuredAt = item.featured ? publishedAt : null
    const localImage = await ensureLocalImage(taskId, filename, sourceAbsolutePath)

    await pool.query('BEGIN')
    try {
      await pool.query(`
        INSERT INTO generation_tasks (
          id, user_id, status, mode, model_sku, request_id, route_id, upstream_model,
          requested_output_count, reserved_points, output_count, charged_points, request_json, created_at, finished_at
        ) VALUES (
          $1, $2, 'succeeded', 'generate', 'seed-demo', NULL, NULL, NULL,
          1, 0, 1, 0, $3::jsonb, $4, $5
        )
        ON CONFLICT (id) DO UPDATE SET
          request_json = EXCLUDED.request_json,
          finished_at = EXCLUDED.finished_at
      `, [
        taskId,
        user.id,
        JSON.stringify({ prompt: item.title, negativePrompt: '', seedDemo: true }),
        createdAt,
        publishedAt,
      ])

      await pool.query(`
        INSERT INTO generation_task_outputs (
          id, task_id, user_id, output_index, storage_provider, storage_key, public_url,
          mime_type, byte_size, width, height, revised_prompt, raw_source_url, created_at
        ) VALUES (
          $1, $2, $3, $4, 'local', $5, $6,
          $7, $8, $9, $10, $11, NULL, $12
        )
        ON CONFLICT (id) DO UPDATE SET
          storage_key = EXCLUDED.storage_key,
          public_url = EXCLUDED.public_url,
          mime_type = EXCLUDED.mime_type,
          byte_size = EXCLUDED.byte_size,
          width = EXCLUDED.width,
          height = EXCLUDED.height,
          revised_prompt = EXCLUDED.revised_prompt
      `, [
        outputId,
        taskId,
        user.id,
        outputIndex,
        localImage.storageKey,
        localImage.publicUrl,
        localImage.mimeType,
        localImage.byteSize,
        localImage.width,
        localImage.height,
        item.caption,
        createdAt,
      ])

      await pool.query(`
        INSERT INTO generation_output_shares (
          id, token, output_id, user_id, purpose, review_status, review_summary,
          access_code_hash, access_code_salt, expires_at, revoked_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'inspiration_public', 'auto_pass', NULL,
          NULL, NULL, NULL, NULL, $5, $5
        )
        ON CONFLICT (id) DO UPDATE SET
          token = EXCLUDED.token,
          review_status = EXCLUDED.review_status,
          revoked_at = NULL,
          updated_at = EXCLUDED.updated_at
      `, [shareId, createShareToken(), outputId, user.id, createdAt])

      const existing = await pool.query(`SELECT id FROM inspiration_posts WHERE id = $1`, [postId])
      await pool.query(`
        INSERT INTO inspiration_posts (
          id, share_id, output_id, user_id, author_name_snapshot, category, title, caption,
          processing_label, status, featured, featured_rank, published_at, featured_at,
          ai_review_status, ai_review_result, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, 'published', $10, $11, $12, $13,
          'passed', $14::jsonb, $15, $15
        )
        ON CONFLICT (id) DO UPDATE SET
          share_id = EXCLUDED.share_id,
          output_id = EXCLUDED.output_id,
          author_name_snapshot = EXCLUDED.author_name_snapshot,
          category = EXCLUDED.category,
          title = EXCLUDED.title,
          caption = EXCLUDED.caption,
          processing_label = EXCLUDED.processing_label,
          status = 'published',
          featured = EXCLUDED.featured,
          featured_rank = EXCLUDED.featured_rank,
          published_at = EXCLUDED.published_at,
          featured_at = EXCLUDED.featured_at,
          ai_review_status = 'passed',
          ai_review_result = EXCLUDED.ai_review_result,
          updated_at = EXCLUDED.updated_at
      `, [
        postId,
        shareId,
        outputId,
        user.id,
        user.display_name,
        item.category,
        item.title,
        item.caption,
        item.processingLabel,
        item.featured,
        item.featured ? item.featuredRank : null,
        publishedAt,
        featuredAt,
        JSON.stringify({ seededBy: 'scripts/seed-inspiration-demo.mjs', passedAt: publishedAt }),
        createdAt,
      ])

      await pool.query('COMMIT')
      if (existing.rowCount > 0) updated += 1
      else created += 1
    } catch (error) {
      await pool.query('ROLLBACK')
      throw error
    }
  }

  await pool.query(`
    DELETE FROM inspiration_posts
    WHERE id = 'seed_insp_post_product-salad-static'
  `)
  await pool.query(`
    DELETE FROM generation_output_shares
    WHERE output_id = 'seed_insp_output_product-salad-static'
  `)
  await pool.query(`
    DELETE FROM generation_task_outputs
    WHERE id = 'seed_insp_output_product-salad-static'
  `)
  await pool.query(`
    DELETE FROM generation_tasks
    WHERE id = 'seed_insp_task_product-salad-static'
  `)

  const summary = await pool.query(`
    SELECT
      count(*) FILTER (WHERE status = 'published')::int AS published_count,
      count(*) FILTER (WHERE featured = true AND status = 'published')::int AS featured_count
    FROM inspiration_posts
    WHERE id LIKE 'seed_insp_post_%'
  `)

  console.log(JSON.stringify({
    ok: true,
    created,
    updated,
    user: { id: user.id, email: user.email, displayName: user.display_name },
    summary: summary.rows[0],
  }, null, 2))

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
