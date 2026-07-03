import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { buildApp } from './app'

type TestCommentRow = {
  id: unknown
  post_id: unknown
  user_id: unknown
  author_name_snapshot: unknown
  content: unknown
  status: unknown
  created_at: unknown
  updated_at: unknown
}

type TestFavoriteRow = {
  id: unknown
  post_id: unknown
  user_id: unknown
  created_at: unknown
  updated_at: unknown
}

type TestFavoriteListRow = Record<string, unknown> & {
  token: unknown
  public_url: string
  like_count: number
  favorite_count: number
  favorited_at: unknown
}

export function createTestDb() {
  const state = {
    shares: [] as Array<Record<string, unknown>>,
    posts: [] as Array<Record<string, unknown>>,
    favorites: [] as TestFavoriteRow[],
    comments: [] as TestCommentRow[],
    taskPrompt: '商业海报样片',
    outputOverrides: {} as Record<string, Partial<Record<string, unknown>>>,
    failAiReview: false,
    updatedOutputSizes: [] as Array<{ id: string; width: number; height: number }>,
  }

  const buildOwnedOutputRow = (outputId: string, userId: unknown) => {
    if (userId !== 'user_owner') return null

    const baseByOutputId: Record<string, Record<string, unknown>> = {
      output_2k: {
        id: 'output_2k',
        task_id: 'task_2k',
        user_id: 'user_owner',
        output_index: 0,
        public_url: '/api/generated-images/task_2k/00.jpg',
        mime_type: 'image/jpeg',
        byte_size: 4096,
        width: 2048,
        height: 1536,
        storage_provider: 'local',
        storage_key: 'task_2k/00.jpg',
        created_at: '2026-06-30T03:00:00.000Z',
        mode: 'generate',
        review_status: 'auto_pass',
        author_name_snapshot: 'Owner',
        task_prompt: state.taskPrompt,
        task_negative_prompt: '',
        revised_prompt: null,
      },
      output_1k: {
        id: 'output_1k',
        task_id: 'task_1k',
        user_id: 'user_owner',
        output_index: 0,
        public_url: '/api/generated-images/task_1k/00.jpg',
        mime_type: 'image/jpeg',
        byte_size: 1024,
        width: 1024,
        height: 1024,
        storage_provider: 'local',
        storage_key: 'task_1k/00.jpg',
        created_at: '2026-06-30T02:00:00.000Z',
        mode: 'generate',
        review_status: 'auto_pass',
        author_name_snapshot: 'Owner',
        task_prompt: state.taskPrompt,
        task_negative_prompt: '',
        revised_prompt: null,
      },
      output_no_size: {
        id: 'output_no_size',
        task_id: 'task_no_size',
        user_id: 'user_owner',
        output_index: 0,
        public_url: '/api/generated-images/task_no_size/00.jpg',
        mime_type: 'image/jpeg',
        byte_size: 4096,
        width: null,
        height: null,
        storage_provider: 'local',
        storage_key: 'task_no_size/00.jpg',
        created_at: '2026-06-30T02:30:00.000Z',
        mode: 'generate',
        review_status: 'auto_pass',
        author_name_snapshot: 'Owner',
        task_prompt: state.taskPrompt,
        task_negative_prompt: '',
        revised_prompt: null,
      },
      output_bad_ratio: {
        id: 'output_bad_ratio',
        task_id: 'task_bad_ratio',
        user_id: 'user_owner',
        output_index: 0,
        public_url: '/api/generated-images/task_bad_ratio/00.jpg',
        mime_type: 'image/jpeg',
        byte_size: 4096,
        width: 4096,
        height: 1200,
        storage_provider: 'local',
        storage_key: 'task_bad_ratio/00.jpg',
        created_at: '2026-06-30T02:45:00.000Z',
        mode: 'generate',
        review_status: 'auto_pass',
        author_name_snapshot: 'Owner',
        task_prompt: state.taskPrompt,
        task_negative_prompt: '',
        revised_prompt: null,
      },
      output_content_missing: {
        id: 'output_content_missing',
        task_id: 'task_content_missing',
        user_id: 'user_owner',
        output_index: 0,
        public_url: '',
        mime_type: 'image/jpeg',
        byte_size: 4096,
        width: 2048,
        height: 1536,
        storage_provider: 'local',
        storage_key: 'task_content_missing/00.jpg',
        created_at: '2026-06-30T02:50:00.000Z',
        mode: 'generate',
        review_status: 'auto_pass',
        author_name_snapshot: 'Owner',
        task_prompt: state.taskPrompt,
        task_negative_prompt: '',
        revised_prompt: null,
      },
    }

    const base = baseByOutputId[outputId]
    if (!base) return null
    return {
      ...base,
      ...state.outputOverrides[outputId],
      task_prompt: state.taskPrompt,
      task_negative_prompt: '',
      revised_prompt: null,
    }
  }

  const queryImpl = async (text: string, values?: unknown[]) => {
      if (text.includes('FROM user_sessions')) {
        const token = values?.[0]
        return {
          rows:
            token === 'sess_owner'
              ? [{
                  token,
                  user_id: 'user_owner',
                  email: 'owner@example.com',
                  display_name: 'Owner',
                  status: 'active',
                  invite_code: null,
                }]
              : [],
        }
      }

      if (text.includes('FROM users') && text.includes('LIMIT 1') && text.includes('display_name')) {
        const [userId] = values ?? []
        return {
          rows:
            userId === 'user_owner'
              ? [{
                  id: 'user_owner',
                  display_name: 'Owner',
                }]
              : [],
        }
      }

      if (text.includes('FROM generation_task_outputs o') && text.includes('COALESCE((')) {
        const [outputId, userId] = values ?? []
        const output = typeof outputId === 'string' ? buildOwnedOutputRow(outputId, userId) : null
        return { rows: output ? [output] : [] }
      }

      if (text.includes('FROM generation_task_outputs o') && text.includes('WHERE o.id = $1 AND o.user_id = $2') && !text.includes('COALESCE((')) {
        const [outputId, userId] = values ?? []
        const output = typeof outputId === 'string' ? buildOwnedOutputRow(outputId, userId) : null
        if (!output) return { rows: [] }
        return { rows: [output] }
      }

      if (text === 'UPDATE generation_task_outputs SET width = $1, height = $2 WHERE id = $3') {
        const [width, height, id] = values ?? []
        state.updatedOutputSizes.push({
          id: String(id),
          width: Number(width),
          height: Number(height),
        })
        return { rows: [] }
      }

      if (text.includes('FROM inspiration_posts') && text.includes('status <> \'removed\'')) {
        const [outputId, userId] = values ?? []
        const post = state.posts.find((item) => {
          const share = state.shares.find((shareItem) => shareItem.id === item.share_id)
          return item.output_id === outputId
            && item.user_id === userId
            && item.status !== 'removed'
            && share?.purpose === 'inspiration_public'
            && !share?.revoked_at
        })
        return { rows: post ? [post] : [] }
      }

      if (text.includes('UPDATE inspiration_posts p') && text.includes("s.purpose <> 'inspiration_public'")) {
        const removed = state.posts
          .filter((item) => {
            const share = state.shares.find((shareItem) => shareItem.id === item.share_id)
            return item.status !== 'removed' && share?.purpose !== 'inspiration_public'
          })
          .map((item) => {
            item.status = 'removed'
            item.featured = false
            item.featured_rank = null
            item.featured_at = null
            item.updated_at = '2026-06-30T06:00:00.000Z'
            return { id: String(item.id) }
          })
        return { rows: removed }
      }

      if (text.includes('MAX(p.author_name_snapshot) AS author_name_snapshot') && text.includes('FROM inspiration_posts p') && text.includes('JOIN generation_output_shares s ON s.id = p.share_id') && text.includes('GROUP BY p.user_id')) {
        const [userId] = values ?? []
        const filtered = state.posts.filter((item) => {
          const share = state.shares.find((shareItem) => shareItem.id === item.share_id)
          return item.user_id === userId && item.status === 'published' && !share?.revoked_at
        })
        if (!filtered.length) return { rows: [] }
        return {
          rows: [{
            user_id: userId,
            author_name_snapshot: filtered[0].author_name_snapshot,
            post_count: String(filtered.length),
            total_view_count: String(filtered.reduce((sum, item) => sum + Number(item.view_count ?? 0), 0)),
            total_favorite_count: String(filtered.reduce((sum, item) => sum + Number(item.favorite_count ?? 0), 0)),
            follower_count: '0',
            following_count: '0',
            comment_count: '0',
            reward_points: '0',
            latest_published_at: filtered[0].published_at ?? null,
          }],
        }
      }

      if (text.includes('FROM inspiration_post_favorites') && text.includes('WHERE post_id = $1 AND user_id = $2') && text.includes('LIMIT 1')) {
        const [postId, userId] = values ?? []
        const favorite = state.favorites.find((item) => item.post_id === postId && item.user_id === userId)
        return { rows: favorite ? [favorite] : [] }
      }

      if (text.includes('FROM inspiration_author_follows') && text.includes('WHERE follower_user_id = $1 AND author_user_id = $2') && text.includes('LIMIT 1')) {
        const [followerUserId, authorUserId] = values ?? []
        return { rows: followerUserId === authorUserId ? [] : [] }
      }

      if (text.includes('INSERT INTO inspiration_author_follows')) {
        const [id, followerUserId, authorUserId, createdAt] = values ?? []
        return {
          rows: [{
            id,
            follower_user_id: followerUserId,
            author_user_id: authorUserId,
            created_at: createdAt,
            updated_at: createdAt,
          }],
        }
      }

      if (text.includes('INSERT INTO accounts (user_id, balance, frozen_balance, updated_at)')) {
        return { rows: [] }
      }

      if (text.includes('SELECT balance::text') && text.includes('FROM accounts') && text.includes('FOR UPDATE')) {
        return { rows: [{ balance: '0' }] }
      }

      if (text.includes('UPDATE accounts') && text.includes('SET balance = $1, updated_at = $2')) {
        return { rows: [] }
      }

      if (text.includes('INSERT INTO balance_ledger')) {
        const [id, userId, amount, balanceBefore, balanceAfter, relatedId, note, createdAt] = values ?? []
        return {
          rows: [{
            id,
            user_id: userId,
            amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            related_id: relatedId,
            note,
            created_at: createdAt,
          }],
        }
      }

      if (text.includes('INSERT INTO inspiration_reward_events')) {
        const [id, authorUserId, sourceUserId, sourceType, sourceId, points, note, ledgerId, createdAt] = values ?? []
        return {
          rows: [{
            id,
            author_user_id: authorUserId,
            source_user_id: sourceUserId,
            source_type: sourceType,
            source_id: sourceId,
            points,
            note,
            ledger_id: ledgerId,
            created_at: createdAt,
          }],
        }
      }

      if (text.includes('COUNT(*)::text AS total_count') && text.includes('FROM inspiration_posts p') && text.includes("s.purpose = 'inspiration_public'")) {
        const filtered = state.posts.filter((item) => {
          const share = state.shares.find((shareItem) => shareItem.id === item.share_id)
          return share?.purpose === 'inspiration_public' && !share?.revoked_at
        })
        return {
          rows: [{
            total_count: String(filtered.length),
            published_count: String(filtered.filter((item) => item.status === 'published').length),
            featured_count: String(filtered.filter((item) => item.featured && item.status === 'published').length),
            needs_review_count: String(filtered.filter((item) => item.status === 'needs_review').length),
            hidden_count: String(filtered.filter((item) => item.status === 'hidden').length),
            ai_reviewing_count: String(filtered.filter((item) => item.status === 'ai_reviewing').length),
            total_view_count: String(filtered.reduce((sum, item) => sum + Number(item.view_count ?? 0), 0)),
            total_detail_open_count: String(filtered.reduce((sum, item) => sum + Number(item.detail_open_count ?? 0), 0)),
            total_enter_studio_click_count: String(filtered.reduce((sum, item) => sum + Number(item.enter_studio_click_count ?? 0), 0)),
            publish_success_count: String(filtered.filter((item) => item.ai_review_status === 'completed' && item.status === 'published').length),
            ai_hidden_count: String(filtered.filter((item) => item.status === 'hidden').length),
          }],
        }
      }

      if (text.includes('FROM inspiration_posts p') && text.includes('JOIN generation_task_outputs o ON o.id = p.output_id') && text.includes('JOIN generation_output_shares s ON s.id = p.share_id') && text.includes('WHERE p.id = $1')) {
        const postId = values?.[0]
        const post = state.posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        if (text.includes('LIMIT 1') && !text.includes("p.status = 'published'")) {
          const share = state.shares.find((item) => item.id === post.share_id)
          const output = buildOwnedOutputRow(String(post.output_id), String(post.user_id))
          return {
            rows: [{
              id: post.id,
              status: post.status,
              category: post.category,
              title: post.title ?? null,
              caption: post.caption ?? null,
              processing_label: post.processing_label,
              author_name_snapshot: post.author_name_snapshot,
              published_at: post.published_at ?? null,
              view_count: post.view_count ?? 0,
              width: Number(output?.width ?? 2048),
              height: Number(output?.height ?? 1536),
              revoked_at: share?.revoked_at ?? null,
            }],
          }
        }
        const share = state.shares.find((item) => item.id === post.share_id)
        if (!share || share.purpose !== 'inspiration_public' || share.revoked_at || post.status !== 'published') return { rows: [] }
        const output = buildOwnedOutputRow(String(post.output_id), String(post.user_id))
        return {
          rows: [{
            ...post,
            width: Number(output?.width ?? 2048),
            height: Number(output?.height ?? 1536),
            revoked_at: share.revoked_at ?? null,
            token: share.token,
            public_url: '/api/generated-images/task_2k/00.jpg',
          }],
        }
      }

      if (text.includes('WHERE p.status = \'published\'') && text.includes('p.featured = true') && text.includes("s.purpose = 'inspiration_public'") && text.includes('s.revoked_at IS NULL')) {
        return {
          rows: [{
            id: 'insp_public_a',
            share_id: 'share_public_a',
            output_id: 'output_public_a',
            user_id: 'user_owner',
            author_name_snapshot: 'Owner',
            category: '品牌广告',
            title: '公开作品 A',
            caption: '公开作品说明',
            processing_label: '文生图',
            status: 'published',
            featured: true,
            featured_rank: 1,
            published_at: '2026-06-30T03:00:00.000Z',
            featured_at: '2026-06-30T03:10:00.000Z',
            ai_review_status: 'completed',
            ai_review_result: { decision: 'recommend_featured' },
            created_at: '2026-06-30T02:00:00.000Z',
            updated_at: '2026-06-30T03:10:00.000Z',
            token: 'share_public_a_token',
            public_url: '/api/generated-images/task_public_a/00.jpg',
            view_count: 11,
            favorite_count: 3,
          }],
        }
      }

      if (text.includes('WHERE p.status = \'published\'') && text.includes("s.purpose = 'inspiration_public'") && text.includes('s.revoked_at IS NULL') && text.includes('ORDER BY COALESCE(p.published_at, p.created_at) DESC') && text.includes('LIMIT 9')) {
        return {
          rows: [{
            id: 'insp_public_b',
            share_id: 'share_public_b',
            output_id: 'output_public_b',
            user_id: 'user_owner',
            author_name_snapshot: 'Owner',
            category: '产品静物',
            title: '公开作品 B',
            caption: '公开作品 B 说明',
            processing_label: '图像编辑',
            status: 'published',
            featured: false,
            featured_rank: null,
            published_at: '2026-06-30T04:00:00.000Z',
            featured_at: null,
            ai_review_status: 'completed',
            ai_review_result: { decision: 'publish' },
            created_at: '2026-06-30T03:30:00.000Z',
            updated_at: '2026-06-30T04:00:00.000Z',
            token: 'share_public_b_token',
            public_url: '/api/generated-images/task_public_b/00.jpg',
            view_count: 7,
            favorite_count: 1,
          }],
        }
      }

      if (text.includes('WHERE p.status = \'published\'') && text.includes("s.purpose = 'inspiration_public'") && text.includes('s.revoked_at IS NULL') && text.includes('AND p.id <> $1') && text.includes('AND (p.category = $2 OR p.featured = true)')) {
        return {
          rows: [{
            id: 'insp_related_a',
            share_id: 'share_related_a',
            output_id: 'output_related_a',
            user_id: 'user_owner',
            author_name_snapshot: 'Owner',
            category: '品牌广告',
            title: '相关作品 A',
            caption: '相关作品说明',
            processing_label: '图像编辑',
            status: 'published',
            featured: false,
            featured_rank: null,
            published_at: '2026-06-30T05:00:00.000Z',
            featured_at: null,
            ai_review_status: 'completed',
            ai_review_result: { decision: 'publish' },
            created_at: '2026-06-30T04:30:00.000Z',
            updated_at: '2026-06-30T05:00:00.000Z',
            token: 'share_related_a_token',
            public_url: '/api/generated-images/task_related_a/00.jpg',
            view_count: 4,
            favorite_count: 2,
          }],
        }
      }

      if (
        text.includes('FROM inspiration_posts p')
        && text.includes("WHERE p.status = 'published' AND s.purpose = 'inspiration_public' AND s.revoked_at IS NULL")
        && text.includes('ORDER BY COALESCE(p.published_at, p.created_at) DESC')
        && (text.includes('OFFSET $2') || text.includes('OFFSET $3'))
        && (text.includes('LIMIT $1') || text.includes('LIMIT $2'))
      ) {
        const category = typeof values?.[0] === 'string' ? values[0] : null
        const rows = [
          {
            id: 'insp_public_b',
            share_id: 'share_public_b',
            output_id: 'output_public_b',
            user_id: 'user_owner',
            author_name_snapshot: 'Owner',
            category: '产品静物',
            title: '公开作品 B',
            caption: '公开作品 B 说明',
            processing_label: '图像编辑',
            status: 'published',
            featured: false,
            featured_rank: null,
            published_at: '2026-06-30T04:00:00.000Z',
            featured_at: null,
            ai_review_status: 'completed',
            ai_review_result: { decision: 'publish' },
            created_at: '2026-06-30T03:30:00.000Z',
            updated_at: '2026-06-30T04:00:00.000Z',
            token: 'share_public_b_token',
            public_url: '/api/generated-images/task_public_b/00.jpg',
            view_count: 7,
            favorite_count: 1,
          },
          {
            id: 'insp_public_a',
            share_id: 'share_public_a',
            output_id: 'output_public_a',
            user_id: 'user_owner',
            author_name_snapshot: 'Owner',
            category: '品牌广告',
            title: '公开作品 A',
            caption: '公开作品说明',
            processing_label: '文生图',
            status: 'published',
            featured: true,
            featured_rank: 1,
            published_at: '2026-06-30T03:00:00.000Z',
            featured_at: '2026-06-30T03:10:00.000Z',
            ai_review_status: 'completed',
            ai_review_result: { decision: 'recommend_featured' },
            created_at: '2026-06-30T02:00:00.000Z',
            updated_at: '2026-06-30T03:10:00.000Z',
            token: 'share_public_a_token',
            public_url: '/api/generated-images/task_public_a/00.jpg',
            view_count: 11,
            favorite_count: 3,
          },
        ]
        return {
          rows: category ? rows.filter((item) => item.category === category) : rows,
        }
      }

      if (text.includes('FROM generation_output_shares') && text.includes("purpose = 'inspiration_public'") && text.includes('revoked_at IS NULL')) {
        const [outputId, userId] = values ?? []
        const share = state.shares.find((item) => item.output_id === outputId && item.user_id === userId && item.purpose === 'inspiration_public' && !item.revoked_at)
        return { rows: share ? [share] : [] }
      }

      if (text.includes('INSERT INTO generation_output_shares')) {
        const [id, token, outputId, userId, createdAt] = values ?? []
        const share = {
          id,
          token,
          output_id: outputId,
          user_id: userId,
          purpose: 'inspiration_public',
          review_status: 'auto_pass',
          review_summary: null,
          access_code_hash: null,
          access_code_salt: null,
          expires_at: null,
          revoked_at: null,
          created_at: createdAt,
          updated_at: createdAt,
        }
        state.shares.push(share)
        return { rows: [share] }
      }

      if (text.includes('INSERT INTO inspiration_posts')) {
        const [id, shareId, outputId, userId, authorNameSnapshot, category, title, caption, processingLabel, createdAt] = values ?? []
        const output = typeof outputId === 'string' ? buildOwnedOutputRow(outputId, userId) : null
        const post = {
          id,
          share_id: shareId,
          output_id: outputId,
          user_id: userId,
          author_name_snapshot: authorNameSnapshot,
          category,
          title,
          caption,
          processing_label: processingLabel,
          status: 'ai_reviewing',
          featured: false,
          featured_rank: null,
          published_at: null,
          featured_at: null,
          ai_review_status: 'pending',
          ai_review_result: null,
          created_at: createdAt,
          updated_at: createdAt,
          width: output?.width ?? null,
          height: output?.height ?? null,
        }
        state.posts.push(post)
        return { rows: [post] }
      }

      if (text.includes('INSERT INTO inspiration_post_comments')) {
        const [id, postId, userId, authorNameSnapshot, content, createdAt] = values ?? []
        const comment = {
          id,
          post_id: postId,
          user_id: userId,
          author_name_snapshot: authorNameSnapshot,
          content,
          status: 'published',
          created_at: createdAt,
          updated_at: createdAt,
        }
        state.comments.push(comment)
        return { rows: [comment] }
      }

      if (text.includes('INSERT INTO inspiration_post_favorites')) {
        const [id, postId, userId, createdAt] = values ?? []
        const favorite = {
          id,
          post_id: postId,
          user_id: userId,
          created_at: createdAt,
          updated_at: createdAt,
        }
        state.favorites.push(favorite)
        return { rows: [favorite] }
      }

      if (text.includes('DELETE FROM inspiration_post_favorites')) {
        const [postId, userId] = values ?? []
        state.favorites = state.favorites.filter((item) => !(item.post_id === postId && item.user_id === userId))
        return { rows: [] }
      }

      if (text.includes('UPDATE inspiration_posts') && text.includes('SET detail_open_count = COALESCE(detail_open_count, 0) + 1')) {
        const [postId] = values ?? []
        const post = state.posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.detail_open_count = Number(post.detail_open_count ?? 0) + 1
        post.updated_at = '2026-06-30T05:20:00.000Z'
        return { rows: [{ id: post.id, detail_open_count: post.detail_open_count }] }
      }

      if (text.includes('FROM inspiration_post_comments') && text.includes('ORDER BY created_at DESC, id DESC') && text.includes('LIMIT $2')) {
        const [postId, limit] = values ?? []
        const comments = state.comments.filter((item) => item.post_id === postId && item.status === 'published')
        return { rows: comments.slice(0, Number(limit ?? 12)) }
      }

      if (text.includes('FROM inspiration_post_comments') && text.includes('SELECT COUNT(*)::text AS count')) {
        const [postId] = values ?? []
        const comments = state.comments.filter((item) => item.post_id === postId && item.status === 'published')
        return { rows: [{ count: String(comments.length) }] }
      }

      if (text.includes('FROM inspiration_post_favorites uf') && text.includes('ORDER BY uf.created_at DESC')) {
        const [userId] = values ?? []
        const rows = state.favorites
          .filter((item) => item.user_id === userId)
          .map((favorite) => {
            const post = state.posts.find((item) => item.id === favorite.post_id)
            const share = state.shares.find((item) => item.id === post?.share_id)
            if (!post || !share || share.revoked_at || post.status !== 'published') return null
            return {
              ...post,
              token: share.token,
              public_url: '/api/generated-images/task_2k/00.jpg',
              like_count: 0,
              favorite_count: 1,
              favorited_at: favorite.created_at,
            }
          })
          .filter((item): item is TestFavoriteListRow => Boolean(item))
        return { rows }
      }

      if (text.includes('FROM inspiration_posts') && text.includes('WHERE id = $1 AND user_id = $2')) {
        const [postId, userId] = values ?? []
        const post = state.posts.find((item) => item.id === postId && item.user_id === userId)
        return { rows: post ? [post] : [] }
      }

      if (text.includes('UPDATE inspiration_posts') && text.includes("SET status = 'removed'")) {
        const [updatedAt, postId, userId] = values ?? []
        const post = state.posts.find((item) => item.id === postId && item.user_id === userId)
        if (!post) return { rows: [] }
        post.status = 'removed'
        post.featured = false
        post.featured_rank = null
        post.featured_at = null
        post.updated_at = updatedAt
        return { rows: [post] }
      }

      if (text.includes('UPDATE inspiration_posts p') && text.includes("ai_review_status = 'completed'")) {
        if (state.failAiReview) throw new Error('mock ai review failure')
        const [title, status, aiReviewResultJson, postId] = values ?? []
        const post = state.posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.title = post.title || title
        post.status = status
        post.ai_review_status = 'completed'
        post.ai_review_result = typeof aiReviewResultJson === 'string' ? JSON.parse(aiReviewResultJson) : aiReviewResultJson
        if (status === 'published' && !post.published_at) {
          post.published_at = '2026-06-30T04:00:00.000Z'
        }
        if (status === 'published' && post.ai_review_result?.decision === 'recommend_featured') {
          post.featured = true
          post.featured_rank = 1
          post.featured_at = post.featured_at ?? '2026-06-30T05:02:00.000Z'
        }
        return { rows: [{ id: post.id, title: post.title, status: post.status, ai_review_status: post.ai_review_status, ai_review_result: post.ai_review_result }] }
      }

      if (text.includes('SELECT p.id, p.category, p.status, p.featured, p.featured_rank, p.featured_at::text') && text.includes('FROM inspiration_posts p')) {
        const rows = state.posts
          .filter((item) => item.status === 'published' && isReconcileEligibleReviewStatus(item.ai_review_status))
          .map((item) => ({
            id: item.id,
            category: item.category,
            status: item.status,
            featured: item.featured,
            featured_rank: item.featured_rank,
            featured_at: item.featured_at,
            published_at: item.published_at,
            created_at: item.created_at,
            updated_at: item.updated_at,
            view_count: item.view_count ?? 0,
            detail_open_count: item.detail_open_count ?? 0,
            enter_studio_click_count: item.enter_studio_click_count ?? 0,
            width: item.width,
            height: item.height,
            ai_review_result: item.ai_review_result,
          }))
        return { rows }
      }

      if (text.includes('SELECT COUNT(*)::text AS count') && text.includes('FROM inspiration_posts p')) {
        const category = values?.[0]
        const count = state.posts.filter((item) =>
          item.status === 'published'
          && item.ai_review_status === 'completed'
          && (!category || item.category === category)
        ).length
        return { rows: [{ count: String(count) }] }
      }

      if (text.includes('SET featured = false,') && text.includes('WHERE featured = true')) {
        for (const post of state.posts) {
          if (post.featured) {
            post.featured = false
            post.featured_rank = null
            post.featured_at = null
            post.updated_at = '2026-06-30T05:01:00.000Z'
          }
        }
        return { rows: [] }
      }

      if (text.includes('SET featured = false,') && text.includes('id <> ALL($1::text[])')) {
        const selectedIds = values?.[0] as string[] | undefined
        for (const post of state.posts) {
          if (post.featured && !selectedIds?.includes(String(post.id))) {
            post.featured = false
            post.featured_rank = null
            post.featured_at = null
            post.updated_at = '2026-06-30T05:01:00.000Z'
          }
        }
        return { rows: [] }
      }

      if (text.includes('SET featured = true,') && text.includes('WHERE id = $2')) {
        const [rank, postId] = values ?? []
        const post = state.posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.featured = true
        post.featured_rank = typeof rank === 'number' ? rank : 1
        post.featured_at = post.featured_at ?? '2026-06-30T05:02:00.000Z'
        post.updated_at = '2026-06-30T05:02:00.000Z'
        return { rows: [post] }
      }

      if (text.includes('UPDATE inspiration_posts') && text.includes("ai_review_status = 'failed'")) {
        const [message, postId] = values ?? []
        const post = state.posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.status = post.status === 'ai_reviewing' ? 'needs_review' : post.status
        post.ai_review_status = 'failed'
        post.ai_review_result = {
          ...(typeof post.ai_review_result === 'object' && post.ai_review_result ? post.ai_review_result : {}),
          decision: 'needs_review',
          internalNote: message,
        }
        return { rows: [] }
      }

      if (text.includes('UPDATE inspiration_posts') && text.includes('SET view_count = COALESCE(view_count, 0) + 1')) {
        const [postId] = values ?? []
        const post = state.posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.view_count = Number(post.view_count ?? 0) + 1
        post.updated_at = '2026-06-30T05:20:00.000Z'
        return { rows: [{ id: post.id, view_count: post.view_count }] }
      }

      if (text.includes('UPDATE generation_output_shares') && text.includes("purpose = 'inspiration_public'")) {
        const [revokedAt, shareId, userId] = values ?? []
        const share = state.shares.find((item) => item.id === shareId && item.user_id === userId && item.purpose === 'inspiration_public')
        if (!share) return { rows: [] }
        share.revoked_at = share.revoked_at ?? revokedAt
        share.updated_at = revokedAt
        return { rows: [] }
      }

      if (text.includes('FROM model_skus')) return { rows: [] }
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
      console.error('Unhandled query:', text, values)
      throw new Error(`Unhandled query: ${text}`)
    }

  const db = {
    query: queryImpl,
    async connect() {
      return {
        query: queryImpl,
        release() {},
      } as unknown as PoolClient
    },
  } as unknown as Pool & { shares?: unknown[] }

  return { db, state }
}

function isReconcileEligibleReviewStatus(status: unknown) {
  return status === 'completed' || status === 'passed'
}

export function buildTestApp(db: Pool) {
  return buildApp(db, {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir: 'D:/tmp/images',
    imagePublicBasePath: '/api/generated-images',
    expiredShareCleanupEnabled: false,
    expiredShareRetentionDays: 90,
    expiredShareCleanupLimit: 5000,
    expiredShareCleanupIntervalMinutes: 360,
    expiredShareCleanupRunOnStartup: true,
  })
}

async function createPngFixture(width: number, height: number) {
  const sharpModule = await import('sharp')
  const sharp = 'default' in sharpModule ? sharpModule.default : sharpModule
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 64, g: 96, b: 160 },
    },
  }).png().toBuffer()
}

describe('inspiration posts', () => {
  it('returns eligibility failure for sub-2k outputs', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_1k/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        eligible: false,
        reason: 'size_too_small',
        width: 1024,
        height: 1024,
        longEdge: 1024,
      })
    } finally {
      await app.close()
    }
  })

  it('returns size_unavailable when server-side dimensions are missing', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_no_size/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        eligible: false,
        reason: 'size_unavailable',
        width: null,
        height: null,
        longEdge: null,
      })
    } finally {
      await app.close()
    }
  })

  it('recovers missing dimensions from the stored local image file', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'insp-size-recover-'))
    await mkdir(join(storageDir, 'task_no_size'), { recursive: true })
    await writeFile(join(storageDir, 'task_no_size', '00.jpg'), await createPngFixture(2560, 1440))

    const { db, state } = createTestDb()
    const app = buildApp(db, {
      databaseUrl: 'postgres://test',
      adminBootstrapToken: '',
      port: 3001,
      host: '127.0.0.1',
      nodeEnv: 'test',
      imageStorageDir: storageDir,
      imagePublicBasePath: '/api/generated-images',
      expiredShareCleanupEnabled: false,
      expiredShareRetentionDays: 90,
      expiredShareCleanupLimit: 5000,
      expiredShareCleanupIntervalMinutes: 360,
      expiredShareCleanupRunOnStartup: true,
    })

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_no_size/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        eligible: true,
        reason: 'ok',
        width: 2560,
        height: 1440,
        longEdge: 2560,
      })
      expect(state.updatedOutputSizes).toEqual([{ id: 'output_no_size', width: 2560, height: 1440 }])
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('returns ratio_out_of_range for extreme aspect ratios', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_bad_ratio/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        eligible: false,
        reason: 'ratio_out_of_range',
        width: 4096,
        height: 1200,
        longEdge: 4096,
      })
    } finally {
      await app.close()
    }
  })

  it('returns content_unavailable when public file metadata is missing', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_content_missing/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        eligible: false,
        reason: 'content_unavailable',
        width: 2048,
        height: 1536,
        longEdge: 2048,
      })
    } finally {
      await app.close()
    }
  })

  it('rejects publish attempts for 1K outputs with size_too_small messaging', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_1k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '1K 样片',
          caption: '这条不应公开',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(403)
      expect(created.body).toContain('仅支持发布 2K 及以上作品')
    } finally {
      await app.close()
    }
  })

  it('creates inspiration post, reuses existing one, and revokes on delete', async () => {
    const { db, state } = createTestDb()
    state.shares.push({
      id: 'share_manual_existing',
      token: 'share_manual_existing_token',
      output_id: 'output_2k',
      user_id: 'user_owner',
      purpose: 'manual',
      review_status: 'auto_pass',
      review_summary: null,
      access_code_hash: null,
      access_code_salt: null,
      expires_at: null,
      revoked_at: null,
      created_at: '2026-06-30T02:40:00.000Z',
      updated_at: '2026-06-30T02:40:00.000Z',
    })
    const app = buildTestApp(db)
    try {
      const eligibility = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_2k/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(eligibility.statusCode).toBe(200)
      expect(eligibility.json()).toMatchObject({
        eligible: true,
        reason: 'ok',
        width: 2048,
        height: 1536,
        longEdge: 2048,
        existingPost: null,
      })

      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '商业海报样片',
          caption: '冷调材质与反射控制',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({
        post: {
          status: 'ai_reviewing',
          category: '品牌广告',
          processingLabel: '文生图',
        },
      })
      expect(state.shares).toHaveLength(2)
      expect(state.posts).toHaveLength(1)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.posts[0]?.status).toBe('published')
      expect((state.posts[0]?.ai_review_result as Record<string, unknown>)?.decision).toBe('publish')

      const reused = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '重复发布',
          caption: '不会重复创建',
          category: '品牌广告',
        },
      })
      expect(reused.statusCode).toBe(200)
      expect(state.shares).toHaveLength(2)
      expect(state.posts).toHaveLength(1)

      const postId = created.json().post.id
      const revoked = await app.inject({
        method: 'DELETE',
        url: `/api/inspiration/posts/${postId}`,
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(revoked.statusCode).toBe(200)
      expect(revoked.json()).toMatchObject({
        success: true,
        post: {
          id: postId,
          status: 'removed',
        },
      })
      expect(state.posts[0]?.status).toBe('removed')
      const manualShare = state.shares.find((item) => item.id === 'share_manual_existing')
      const inspirationShare = state.shares.find((item) => item.id !== 'share_manual_existing')
      expect(manualShare?.revoked_at).toBeNull()
      expect(inspirationShare?.revoked_at).toBeTruthy()

      const detailAfterRevoke = await app.inject({
        method: 'GET',
        url: `/api/inspiration/posts/${postId}`,
      })
      expect(detailAfterRevoke.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('lists published inspiration posts for public browsing', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/inspiration/posts?limit=12&category=品牌广告',
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        ok: true,
        posts: [{
          id: 'insp_public_a',
          title: '公开作品 A',
          category: '品牌广告',
          processingLabel: '文生图',
          imageUrl: '/api/generated-images/task_public_a/00.jpg',
        }],
      })
      expect(response.json().posts[0]).not.toHaveProperty('share_id')
      expect(response.json().posts[0]).not.toHaveProperty('output_id')
      expect(response.json().posts[0]).not.toHaveProperty('user_id')
      expect(response.json().posts[0]).not.toHaveProperty('ai_review_result')
      expect(response.json().posts[0]).not.toHaveProperty('prompt')
      expect(response.json().posts[0]).not.toHaveProperty('negativePrompt')
      expect(response.json().posts[0]).not.toHaveProperty('route')
      expect(response.json().posts[0]).not.toHaveProperty('model')
    } finally {
      await app.close()
    }
  })

  it('orders public list results by latest published time instead of featured rank', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/inspiration/posts?limit=12',
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().posts.map((item: { id: string }) => item.id)).toEqual([
        'insp_public_b',
        'insp_public_a',
      ])
    } finally {
      await app.close()
    }
  })

  it('returns public home/detail payloads without leaking internal fields', async () => {
    const { db, state } = createTestDb()
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '商业海报样片',
          caption: '冷调材质与反射控制',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(201)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const createdPostId = created.json().post.id as string

      const home = await app.inject({
        method: 'GET',
        url: '/api/inspiration/home',
      })
      expect(home.statusCode).toBe(200)
      const homeJson = home.json()
      expect(homeJson).toMatchObject({
        ok: true,
        heroFeatured: {
          id: 'insp_public_a',
          title: '公开作品 A',
        },
        secondaryFeatured: [],
        latest: [{
          id: 'insp_public_b',
          title: '公开作品 B',
          processingLabel: '图像编辑',
        }],
      })
      expect(homeJson.heroFeatured).not.toHaveProperty('share_id')
      expect(homeJson.heroFeatured).not.toHaveProperty('output_id')
      expect(homeJson.heroFeatured).not.toHaveProperty('user_id')
      expect(homeJson.heroFeatured).not.toHaveProperty('ai_review_result')
      expect(homeJson.latest[0]).not.toHaveProperty('prompt')
      expect(homeJson.latest[0]).not.toHaveProperty('negativePrompt')
      expect(homeJson.latest[0]).not.toHaveProperty('route')
      expect(homeJson.latest[0]).not.toHaveProperty('model')

      const detail = await app.inject({
        method: 'GET',
        url: `/api/inspiration/posts/${createdPostId}`,
      })
      expect(detail.statusCode).toBe(200)
      const detailJson = detail.json()
      expect(detailJson).toMatchObject({
        ok: true,
        post: {
          id: createdPostId,
          title: '商业海报样片',
          caption: '冷调材质与反射控制',
          category: '品牌广告',
          authorName: 'Owner',
          processingLabel: '文生图',
          featured: false,
          enterStudioUrl: '/',
        },
      })
      expect(detailJson.post).not.toHaveProperty('shareId')
      expect(detailJson.post).not.toHaveProperty('share_id')
      expect(detailJson.post).not.toHaveProperty('outputId')
      expect(detailJson.post).not.toHaveProperty('output_id')
      expect(detailJson.post).not.toHaveProperty('userId')
      expect(detailJson.post).not.toHaveProperty('user_id')
      expect(detailJson.post).not.toHaveProperty('authorId')
      expect(detailJson.post).not.toHaveProperty('likeCount')
      expect(detailJson.post).not.toHaveProperty('liked')
      expect(detailJson.post).not.toHaveProperty('favoriteCount')
      expect(detailJson.post).not.toHaveProperty('favorited')
      expect(detailJson.post).not.toHaveProperty('commentCount')
      expect(detailJson.post).not.toHaveProperty('followingAuthor')
      expect(detailJson.post).not.toHaveProperty('aiReviewResult')
      expect(detailJson.post).not.toHaveProperty('ai_review_result')
      expect(detailJson.post).not.toHaveProperty('prompt')
      expect(detailJson.post).not.toHaveProperty('negativePrompt')
      expect(detailJson.post).not.toHaveProperty('route')
      expect(detailJson.post).not.toHaveProperty('model')
      expect(detailJson).not.toHaveProperty('comments')
      expect(state.posts.find((item) => item.id === createdPostId)?.status).toBe('published')
    } finally {
      await app.close()
    }
  })

  it('removes legacy manual-share inspiration posts from eligibility and public detail', async () => {
    const { db, state } = createTestDb()
    state.shares.push({
      id: 'share_manual_legacy',
      token: 'share_manual_legacy_token',
      output_id: 'output_2k',
      user_id: 'user_owner',
      purpose: 'manual',
      review_status: 'auto_pass',
      review_summary: null,
      access_code_hash: null,
      access_code_salt: null,
      expires_at: null,
      revoked_at: null,
      created_at: '2026-06-30T02:20:00.000Z',
      updated_at: '2026-06-30T02:20:00.000Z',
    })
    state.posts.push({
      id: 'insp_legacy_manual',
      share_id: 'share_manual_legacy',
      output_id: 'output_2k',
      user_id: 'user_owner',
      author_name_snapshot: 'Owner',
      category: '品牌广告',
      title: '旧手动入口作品',
      caption: '这条应该被清掉',
      processing_label: '文生图',
      status: 'published',
      featured: true,
      featured_rank: 1,
      published_at: '2026-06-30T02:30:00.000Z',
      featured_at: '2026-06-30T02:35:00.000Z',
      ai_review_status: 'completed',
      ai_review_result: { decision: 'publish' },
      created_at: '2026-06-30T02:25:00.000Z',
      updated_at: '2026-06-30T02:35:00.000Z',
      view_count: 9,
      detail_open_count: 4,
      enter_studio_click_count: 1,
    })
    const app = buildTestApp(db)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.posts.find((item) => item.id === 'insp_legacy_manual')?.status).toBe('removed')

      const eligibility = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_2k/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(eligibility.statusCode).toBe(200)
      expect(eligibility.json()).toMatchObject({
        existingPost: null,
      })

      const detail = await app.inject({
        method: 'GET',
        url: '/api/inspiration/posts/insp_legacy_manual',
      })
      expect(detail.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('runs startup reconcile even when legacy cleanup removes nothing', async () => {
    const { db, state } = createTestDb()
    state.shares.push(
      {
        id: 'share_public_featured_hero',
        token: 'share_public_featured_hero_token',
        output_id: 'output_2k',
        user_id: 'user_owner',
        purpose: 'inspiration_public',
        review_status: 'auto_pass',
        review_summary: null,
        access_code_hash: null,
        access_code_salt: null,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-06-30T02:20:00.000Z',
        updated_at: '2026-06-30T02:20:00.000Z',
      },
      {
        id: 'share_public_featured_legacy_secondary',
        token: 'share_public_featured_legacy_secondary_token',
        output_id: 'output_2k',
        user_id: 'user_owner',
        purpose: 'inspiration_public',
        review_status: 'auto_pass',
        review_summary: null,
        access_code_hash: null,
        access_code_salt: null,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-06-30T02:25:00.000Z',
        updated_at: '2026-06-30T02:25:00.000Z',
      },
      {
        id: 'share_public_stale_featured',
        token: 'share_public_stale_featured_token',
        output_id: 'output_2k',
        user_id: 'user_owner',
        purpose: 'inspiration_public',
        review_status: 'auto_pass',
        review_summary: null,
        access_code_hash: null,
        access_code_salt: null,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-06-30T02:30:00.000Z',
        updated_at: '2026-06-30T02:30:00.000Z',
      },
    )
    state.posts.push(
      {
        id: 'insp_auto_hero',
        share_id: 'share_public_featured_hero',
        output_id: 'output_2k',
        user_id: 'user_owner',
        author_name_snapshot: 'Owner',
        category: '品牌广告',
        title: '自动主视觉候选',
        caption: '应在启动时被重新选回 hero',
        processing_label: '文生图',
        status: 'published',
        featured: false,
        featured_rank: null,
        published_at: '2026-06-30T03:30:00.000Z',
        featured_at: null,
        ai_review_status: 'completed',
        ai_review_result: {
          decision: 'recommend_featured',
          displayFit: 'hero_featured',
          qualityScore: 92,
          riskScore: 8,
        },
        created_at: '2026-06-30T03:00:00.000Z',
        updated_at: '2026-06-30T03:30:00.000Z',
        view_count: 12,
        detail_open_count: 3,
        enter_studio_click_count: 1,
      },
      {
        id: 'insp_legacy_passed_secondary',
        share_id: 'share_public_featured_legacy_secondary',
        output_id: 'output_2k',
        user_id: 'user_owner',
        author_name_snapshot: 'Owner',
        category: '空间氛围',
        title: 'Legacy 次级精选',
        caption: '应在启动时保留 secondary rank=2',
        processing_label: '文生图',
        status: 'published',
        featured: false,
        featured_rank: null,
        published_at: '2026-06-30T03:20:00.000Z',
        featured_at: null,
        ai_review_status: 'passed',
        ai_review_result: {
          decision: 'recommend_featured',
          displayFit: 'secondary_featured',
          qualityScore: 85,
          riskScore: 10,
          manualFeaturedSlot: 'secondary',
          manualFeaturedRank: 2,
        },
        created_at: '2026-06-30T03:10:00.000Z',
        updated_at: '2026-06-30T03:20:00.000Z',
        view_count: 7,
        detail_open_count: 2,
        enter_studio_click_count: 1,
      },
      {
        id: 'insp_stale_featured_flag',
        share_id: 'share_public_stale_featured',
        output_id: 'output_2k',
        user_id: 'user_owner',
        author_name_snapshot: 'Owner',
        category: '产品静物',
        title: '陈旧精选标记',
        caption: '启动时应清掉旧 featured 标记',
        processing_label: '图像编辑',
        status: 'published',
        featured: true,
        featured_rank: 4,
        published_at: '2026-06-30T01:30:00.000Z',
        featured_at: '2026-06-30T01:40:00.000Z',
        ai_review_status: 'completed',
        ai_review_result: {
          decision: 'publish',
          displayFit: 'latest_grid',
          qualityScore: 72,
          riskScore: 12,
        },
        created_at: '2026-06-30T01:20:00.000Z',
        updated_at: '2026-06-30T01:40:00.000Z',
        view_count: 1,
        detail_open_count: 0,
        enter_studio_click_count: 0,
      },
    )
    const app = buildTestApp(db)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(state.posts.find((item) => item.id === 'insp_auto_hero')).toMatchObject({
        featured: true,
        featured_rank: 1,
      })
      expect(state.posts.find((item) => item.id === 'insp_legacy_passed_secondary')).toMatchObject({
        featured: true,
        featured_rank: 2,
      })
      expect(state.posts.find((item) => item.id === 'insp_stale_featured_flag')).toMatchObject({
        featured: false,
        featured_rank: null,
      })
    } finally {
      await app.close()
    }
  })

  it('auto-fills a default title and publishes low-information content after async AI pass', async () => {
    const { db, state } = createTestDb()
    state.taskPrompt = 'minimal brand advertising poster'
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '',
          caption: '',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(201)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.posts[0]?.status).toBe('published')
      expect(state.posts[0]?.title).toBe('极简品牌')
      expect((state.posts[0]?.ai_review_result as Record<string, unknown>)?.decision).toBe('publish')
    } finally {
      await app.close()
    }
  })

  it('auto-infers category when publish payload leaves category empty', async () => {
    const { db, state } = createTestDb()
    state.taskPrompt = 'mobile app dashboard ui with analytics cards, clean interface, modal interaction'
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '',
          caption: '',
        },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({
        post: {
          category: 'UI / 社媒视觉',
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.posts[0]?.category).toBe('UI / 社媒视觉')
      expect((state.posts[0]?.ai_review_result as Record<string, unknown>)?.categorySuggestion).toBe('UI / 社媒视觉')
    } finally {
      await app.close()
    }
  })

  it('publishes standard 2560x1440 wide-screen work without forcing manual review', async () => {
    const { db, state } = createTestDb()
    state.taskPrompt = '16:9 horizontal interior photography of a bedroom in natural light, wabi-sabi, warm wood, beige neutral tones'
    state.outputOverrides.output_2k = {
      width: 2560,
      height: 1440,
      public_url: '/api/generated-images/task_2k/00.png',
      mime_type: 'image/png',
      storage_key: 'task_2k/00.png',
    }
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '',
          caption: '',
          category: '空间氛围',
        },
      })
      expect(created.statusCode).toBe(201)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.posts[0]?.status).toBe('published')
      expect(state.posts[0]?.title).toBe('侘寂暖木卧室')
      expect((state.posts[0]?.ai_review_result as Record<string, unknown>)?.decision).toBe('publish')
      expect((state.posts[0]?.ai_review_result as Record<string, unknown>)?.displayFit).toBe('latest_grid')
      expect(state.posts[0]?.featured).toBe(false)
      expect(state.posts[0]?.featured_rank).toBeNull()
    } finally {
      await app.close()
    }
  })

  it('auto-features strong long-edge work after AI review', async () => {
    const { db, state } = createTestDb()
    state.taskPrompt = 'premium brand advertising poster, luxury campaign, clean typography, editorial layout'
    state.outputOverrides.output_2k = {
      width: 4096,
      height: 2160,
      public_url: '/api/generated-images/task_4k/00.png',
      mime_type: 'image/png',
      storage_key: 'task_4k/00.png',
    }
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '商业主视觉样片',
          caption: '高完成度品牌发布画面',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(201)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      const post = state.posts.at(-1)
      expect(post?.status).toBe('published')
      expect(post?.featured).toBe(true)
      expect(post?.featured_rank).toBe(1)
      expect((post?.ai_review_result as Record<string, unknown>)?.decision).toBe('recommend_featured')
      expect((post?.ai_review_result as Record<string, unknown>)?.displayFit).toBe('hero_featured')
    } finally {
      await app.close()
    }
  })

  it('falls back to needs_review when async AI review fails', async () => {
    const { db, state } = createTestDb()
    state.failAiReview = true
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '商业海报样片',
          caption: '冷调材质与反射控制',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(201)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(state.posts[0]).toMatchObject({
        status: 'needs_review',
        ai_review_status: 'failed',
      })
      expect((state.posts[0]?.ai_review_result as Record<string, unknown>)?.decision).toBe('needs_review')
      expect(String((state.posts[0]?.ai_review_result as Record<string, unknown>)?.internalNote ?? '')).toContain('mock ai review failure')
    } finally {
      await app.close()
    }
  })

  it('blocks attention-level content from inspiration publishing even without manual share records', async () => {
    const { db, state } = createTestDb()
    state.taskPrompt = '性感写真，情趣内衣棚拍'
    const app = buildTestApp(db)
    try {
      const eligibility = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_2k/inspiration-eligibility',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(eligibility.statusCode).toBe(200)
      expect(eligibility.json()).toMatchObject({
        eligible: false,
        reason: 'review_not_passed',
      })

      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_2k/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '边界内容样片',
          caption: '这条不应公开',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(403)
      expect(created.body).toContain('暂不适合公开展示')
    } finally {
      await app.close()
    }
  })

  it('rejects publish attempts when public file content is unavailable', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_content_missing/inspiration-post',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          title: '缺文件样片',
          caption: '这条不应公开',
          category: '品牌广告',
        },
      })
      expect(created.statusCode).toBe(403)
      expect(created.body).toContain('当前作品文件暂不可公开读取')
    } finally {
      await app.close()
    }
  })

})
