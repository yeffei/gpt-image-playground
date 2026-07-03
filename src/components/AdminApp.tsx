import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import './AdminApp.css'
import {
  AdminApiError,
  adminDelete,
  adminGet,
  adminPatch,
  adminPost,
  buildAdminApiUrl,
  getAdminDashboard,
  getCurrentAdmin,
  loginAdmin,
  logoutAdmin,
  type AdminDashboardPayload,
  type AdminProfile,
} from '../lib/adminApi'
import { getInspirationSummaryCards } from '../lib/adminInspirationDisplay'
import { GPT_IMAGE_2_SUPPORTED_SIZES } from '../lib/modelSkus'
import { PROMPT_LIBRARY_CATEGORIES, PROMPT_LIBRARY_TEMPLATES } from '../lib/promptLibrary'
import { CopyIcon } from './icons'

type AdminSectionKey =
  | 'dashboard'
  | 'users'
  | 'billingLedger'
  | 'rechargeCodes'
  | 'modelSkus'
  | 'tasks'
  | 'gateway'
  | 'content'
  | 'growth'
  | 'inspiration'
  | 'shares'
  | 'auditLogs'

type RechargeSubsectionKey =
  | 'codes'
  | 'redemptionAttempts'

type UserSubsectionKey =
  | 'users'
  | 'billingLedger'
  | 'referrals'
  | 'creditRecords'

type ContentSubsectionKey =
  | 'templates'
  | 'candidates'
  | 'importRuns'

type GatewaySubsectionKey =
  | 'routes'
  | 'modelSkus'
  | 'bindings'
  | 'strategy'

type GrowthSubsectionKey =
  | 'referrals'
  | 'creditRecords'

type AdminModuleConfig = {
  summaryPath?: string
  listPath: string
  listKey: string
  detailBasePath?: string
  detailIdKey: string
  title: string
  description: string
  columns: Array<{ key: string; label: string }>
}

type AdminTableColumn = AdminModuleConfig['columns'][number]

type AdminFilterField = {
  key: string
  label: string
  type?: 'text' | 'select' | 'date' | 'checkbox'
  options?: string[]
  placeholder?: string
  defaultValue?: string
  hideAllOption?: boolean
}

const ADMIN_SESSION_STORAGE_KEY = 'sst-admin-session-token'
const PROMPT_LIBRARY_CATEGORY_FILTER_OPTIONS = PROMPT_LIBRARY_CATEGORIES.filter((category) => category !== '全部')
const TASK_FAILURE_KIND_OPTIONS = [
  'no_route',
  'route_exhausted',
  'upstream_timeout',
  'upstream_rate_limited',
  'upstream_server_error',
  'upstream_bad_request',
  'upstream_auth_error',
  'content_policy_violation',
  'unsupported_model',
  'parameter_incompatible',
  'network',
  'unknown',
  'admin_cancelled',
]

const ADMIN_VALUE_LABELS: Record<string, string> = {
  active: '启用',
  enabled: '启用',
  available: '可用',
  disabled: '停用',
  expired: '已过期',
  archived: '已归档',
  draft: '草稿',
  published: '已发布',
  pending: '待处理',
  approved: '已通过',
  rejected: '已拒绝',
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
  success: '成功',
  failed: '失败',
  error: '错误',
  timeout: '超时',
  cancelled: '已取消',
  redeemed: '已兑换',
  invalid: '无效',
  ok: '正常',
  healthy: '健康',
  cooling: '冷却中',
  degraded: '降级',
  true: '是',
  false: '否',
  signup_bonus: '新用户礼包',
  compensation_credit: '补偿点数',
  recharge_code_redeem: '充值码兑换',
  admin_adjustment: '后台调整',
  image_generation_charge: '生图扣点',
  code_not_found: '兑换码不存在',
  code_expired: '兑换码已过期',
  code_already_redeemed: '已兑换，不能重复使用',
  code_disabled: '兑换码已停用',
  code_not_active: '兑换码不可用',
  no_route: '无可用线路',
  route_exhausted: '线路额度不足',
  upstream_timeout: '上游超时',
  upstream_rate_limited: '上游限流',
  upstream_server_error: '上游服务错误',
  upstream_bad_request: '上游拒绝请求',
  upstream_auth_error: '上游鉴权失败',
  content_policy_violation: '内容审核未通过',
  unsupported_model: '模型不支持',
  parameter_incompatible: '参数不兼容',
  network: '网络连接失败',
  unknown: '未知失败',
  admin_cancelled: '后台取消',
  shareActive: '有效',
  shareExpired: '已过期',
  shareRevoked: '已撤销',
  auto_pass: '自动通过',
  attention: '已标记',
  blocked: '已拦截',
  ai_reviewing: 'AI 初审中',
  needs_review: '待人工复核',
  hidden: '已隐藏',
  removed: '已移除',
  recommend_featured: '推荐精选',
  publish: '公开展示',
  auto_hidden: '自动隐藏',
  reject: '不适合公开',
  featured_candidates: 'AI 推荐精选',
  latest: '最新展示',
  hero_featured: '主视觉精选',
  secondary_featured: '次级精选',
  latest_grid: '最新列表',
}

const READABLE_FIELD_KEYS: Record<string, string[]> = {
  userId: ['userLabel', 'userEmail', 'userDisplayName', 'email', 'displayName'],
  adminUserId: ['adminLabel', 'adminEmail', 'adminDisplayName'],
  createdByAdminId: ['createdByAdminLabel', 'createdByAdminEmail', 'createdByAdminDisplayName', 'adminEmail', 'adminDisplayName'],
  redeemedByUserId: ['redeemedByUserLabel', 'redeemedByUserEmail', 'redeemedByUserDisplayName'],
  redeemedByUserLabel: ['redeemedByUserLabel', 'redeemedByUserEmail', 'redeemedByUserDisplayName'],
  inviterUserId: ['inviterUserEmail', 'inviterUserDisplayName', 'inviterEmail', 'inviterDisplayName'],
  inviteeUserId: ['inviteeUserEmail', 'inviteeUserDisplayName', 'inviteeEmail', 'inviteeDisplayName'],
  targetId: ['targetLabel', 'targetName', 'targetEmail'],
  relatedId: ['relatedLabel', 'relatedName', 'codePreview', 'batchNo'],
  codeId: ['codePreview'],
  ledgerId: ['ledgerLabel'],
}

type ModelPreset = {
  id: string
  label: string
  description: string
  supportedSizes?: string[]
  supportedQualities?: string[]
}

const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    description: 'OpenAI 主流生图模型',
    supportedSizes: GPT_IMAGE_2_SUPPORTED_SIZES,
    supportedQualities: ['low', 'medium', 'high'],
  },
  { id: 'gemini', label: 'Gemini', description: 'Google 生图模型' },
  { id: 'grok', label: 'Grok', description: 'xAI 生图模型' },
]

const MODEL_SIZE_OPTIONS = [
  { value: '*', label: '不限制' },
  ...GPT_IMAGE_2_SUPPORTED_SIZES.map((size) => ({ value: size, label: size })),
]

const MODEL_QUALITY_OPTIONS = [
  { value: '*', label: '不限制' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

class AdminActionNotice extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminActionNotice'
  }
}

const ADMIN_SECTIONS: Array<{ key: AdminSectionKey; label: string; meta: string }> = [
  { key: 'dashboard', label: '后台首页', meta: '入口 / 待办' },
  { key: 'users', label: '用户与余额', meta: '用户 / 流水' },
  { key: 'rechargeCodes', label: '充值码', meta: '生成 / 兑换' },
  { key: 'tasks', label: '任务与扣点', meta: '任务 / 补偿' },
  { key: 'gateway', label: '网关管理', meta: '线路 / 模型' },
  { key: 'content', label: '内容配置', meta: '模板 / 审核' },
  { key: 'inspiration', label: '灵感广场', meta: '展示 / 审核' },
  { key: 'shares', label: '分享审计', meta: '分享 / 状态' },
]

const ADMIN_HOME_ACTIONS: Array<{
  key: Exclude<AdminSectionKey, 'dashboard'>
  label: string
  title: string
  description: string
}> = [
  { key: 'rechargeCodes', label: '去处理', title: '充值码批次生成', description: '按 30/100/300 点生成兑换码，按批次导出 TXT，并查看兑换记录。' },
  { key: 'users', label: '去处理', title: '用户余额处理', description: '按邮箱查用户，查看余额与流水，对选中用户做余额调整或状态处理。' },
  { key: 'tasks', label: '去处理', title: '任务扣点追踪', description: '查看生成任务、扣点、失败原因，并对需要处理的任务做补偿或取消。' },
  { key: 'content', label: '去处理', title: '提示词模板维护', description: '手工新增模板，或从 URL/GitHub 导入候选后人工审核。' },
  { key: 'gateway', label: '去处理', title: '网关线路与模型', description: '添加中转站线路、添加生图模型，并给每个模型选择可用线路。' },
  { key: 'inspiration', label: '去处理', title: '灵感广场运营台', description: '查看 AI 初审结果、自动推荐展示、隐藏记录，并对广场帖子做可见性处理和分类修正。' },
  { key: 'shares', label: '去查看', title: '分享链接审计', description: '查看用户创建的结果分享、访问码要求、过期和撤销状态。' },
]

const ADMIN_MODULES: Record<Exclude<AdminSectionKey, 'dashboard'>, AdminModuleConfig> = {
  users: {
    summaryPath: '/api/admin/users/summary',
    listPath: '/api/admin/users?limit=25&offset=0',
    listKey: 'users',
    detailBasePath: '/api/admin/users',
    detailIdKey: 'id',
    title: '用户与余额',
    description: '查看用户、余额、流水、生成任务、充值兑换和邀请关系。',
    columns: [
      { key: 'email', label: '邮箱' },
      { key: 'status', label: '状态' },
      { key: 'balance', label: '余额' },
      { key: 'totalRechargePoints', label: '累计充值' },
      { key: 'totalChargedPoints', label: '累计扣点' },
    ],
  },
  billingLedger: {
    summaryPath: '/api/admin/billing/ledger/summary',
    listPath: '/api/admin/billing/ledger?limit=25&offset=0',
    listKey: 'ledger',
    detailBasePath: '/api/admin/billing/ledger',
    detailIdKey: 'id',
    title: '账务流水',
    description: '查看余额流水、扣点、充值码兑换、管理员补偿与手动调整记录；这里不是站内支付订单系统。',
    columns: [
      { key: 'id', label: '流水编号' },
      { key: 'type', label: '类型' },
      { key: 'amount', label: '金额' },
      { key: 'userEmail', label: '用户' },
      { key: 'relatedId', label: '关联记录' },
    ],
  },
  rechargeCodes: {
    listPath: '/api/admin/recharge-codes?limit=25&offset=0',
    listKey: 'codes',
    detailBasePath: '/api/admin/recharge-codes',
    detailIdKey: 'id',
    title: '充值码',
    description: '按批次生成 30/100/300 点兑换码，导出 TXT，查看兑换状态并禁用未使用的码。',
    columns: [
      { key: 'codePreview', label: '码预览' },
      { key: 'points', label: '点数' },
      { key: 'status', label: '状态' },
      { key: 'batchNo', label: '批次' },
      { key: 'redeemedByUserLabel', label: '兑换用户' },
    ],
  },
  modelSkus: {
    listPath: '/api/admin/model-skus?limit=25&offset=0',
    listKey: 'models',
    detailBasePath: '/api/admin/model-skus',
    detailIdKey: 'id',
    title: '生图模型',
    description: '维护前台可选的生图模型。尺寸和质量只是前台选项口径，不用于限制真实模型能力。',
    columns: [
      { key: 'displayName', label: '模型名称' },
      { key: 'name', label: '模型标识' },
      { key: 'enabled', label: '启用' },
      { key: 'supportsEdit', label: '编辑' },
      { key: 'sortOrder', label: '排序' },
    ],
  },
  tasks: {
    summaryPath: '/api/admin/tasks/summary',
    listPath: '/api/admin/tasks?limit=25&offset=0',
    listKey: 'tasks',
    detailBasePath: '/api/admin/tasks',
    detailIdKey: 'id',
    title: '任务与扣点',
    description: '查看生成任务、扣点流水、失败原因，并支持后续补偿与取消操作。',
    columns: [
      { key: 'id', label: '任务编号' },
      { key: 'status', label: '状态' },
      { key: 'userId', label: '用户' },
      { key: 'modelLabel', label: '模型' },
      { key: 'routeLabel', label: '线路' },
      { key: 'failureKind', label: '失败类型' },
      { key: 'chargedPoints', label: '扣点' },
      { key: 'errorSummary', label: '错误摘要' },
    ],
  },
  inspiration: {
    summaryPath: '/api/admin/inspiration-posts/summary',
    listPath: '/api/admin/inspiration-posts?limit=25&offset=0',
    listKey: 'posts',
    detailBasePath: '/api/admin/inspiration-posts',
    detailIdKey: 'id',
    title: '灵感广场',
    description: '管理广场公开作品、AI 展示判断，以及发布信息修正与展示状态流转。',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'category', label: '分类' },
      { key: 'status', label: '状态' },
      { key: 'featured', label: '精选' },
      { key: 'aiDecision', label: 'AI 结论' },
      { key: 'qualityScore', label: '质量分' },
      { key: 'userLabel', label: '发布账号' },
      { key: 'publishedAt', label: '发布时间' },
    ],
  },
  gateway: {
    listPath: '/api/admin/gateway-routes?limit=25&offset=0',
    listKey: 'routes',
    detailBasePath: '/api/admin/gateway-routes',
    detailIdKey: 'id',
    title: '网关管理',
    description: '管理中转站线路接入信息。每个模型能走哪些线路，在“模型可用线路”里设置。',
    columns: [
      { key: 'name', label: '线路名称' },
      { key: 'enabled', label: '启用' },
      { key: 'healthStatus', label: '健康状态' },
      { key: 'diagnostics.restoresAt', label: '预计恢复' },
      { key: 'apiKeyRef', label: '密钥环境变量' },
    ],
  },
  content: {
    listPath: '/api/admin/content/templates?limit=25&offset=0',
    listKey: 'templates',
    detailBasePath: '/api/admin/content/templates',
    detailIdKey: 'id',
    title: '提示词模板',
    description: '已发布模板、候选审核和导入任务都在这里管理，候选通过后才会进入前台。',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'category', label: '分类' },
      { key: 'status', label: '状态' },
      { key: 'imagePath', label: '本地图片' },
      { key: 'sourceUrl', label: '来源' },
    ],
  },
  growth: {
    summaryPath: '/api/admin/growth/referrals/summary',
    listPath: '/api/admin/growth/referrals?limit=25&offset=0',
    listKey: 'referrals',
    detailBasePath: '/api/admin/growth/referrals',
    detailIdKey: 'id',
    title: '增长与运营',
    description: '查看邀请关系、奖励流水、新用户启动礼包和增长相关余额记录。',
    columns: [
      { key: 'id', label: '邀请编号' },
      { key: 'inviteCode', label: '邀请码' },
      { key: 'status', label: '状态' },
      { key: 'inviterUserId', label: '邀请人' },
      { key: 'inviteeUserId', label: '被邀请人' },
    ],
  },
  shares: {
    summaryPath: '/api/admin/image-shares/summary',
    listPath: '/api/admin/image-shares?limit=25&offset=0',
    listKey: 'shares',
    detailBasePath: '/api/admin/image-shares',
    detailIdKey: 'id',
    title: '分享审计',
    description: '只读查看用户创建的图片分享、访问码要求、过期与撤销状态。',
    columns: [
      { key: 'tokenPreview', label: 'Token' },
      { key: 'status', label: '状态' },
      { key: 'reviewStatus', label: '审核' },
      { key: 'userId', label: '用户' },
      { key: 'taskId', label: '任务' },
      { key: 'outputIndex', label: '序号' },
      { key: 'requiresAccessCode', label: '访问码' },
      { key: 'createdAt', label: '创建时间' },
    ],
  },
  auditLogs: {
    summaryPath: '/api/admin/audit-logs/summary?groupBy=targetType',
    listPath: '/api/admin/audit-logs?limit=25&offset=0',
    listKey: 'auditLogs',
    detailBasePath: '/api/admin/audit-logs',
    detailIdKey: 'id',
    title: '审计日志',
    description: '查看管理员操作、目标、原因和变更前后记录。',
    columns: [
      { key: 'action', label: '动作' },
      { key: 'targetType', label: '目标类型' },
      { key: 'targetId', label: '目标记录' },
      { key: 'adminUserId', label: '管理员' },
      { key: 'createdAt', label: '时间' },
    ],
  },
}

const CONTENT_SUBSECTIONS: Array<{ key: ContentSubsectionKey; label: string }> = [
  { key: 'candidates', label: '候选审核' },
  { key: 'importRuns', label: '导入任务' },
  { key: 'templates', label: '已发布模板' },
]

const USER_SUBSECTIONS: Array<{ key: UserSubsectionKey; label: string }> = [
  { key: 'users', label: '用户列表' },
  { key: 'billingLedger', label: '账务流水' },
  { key: 'referrals', label: '邀请关系' },
  { key: 'creditRecords', label: '奖励流水' },
]

const RECHARGE_SUBSECTIONS: Array<{ key: RechargeSubsectionKey; label: string }> = [
  { key: 'codes', label: '充值码' },
  { key: 'redemptionAttempts', label: '兑换记录' },
]

const RECHARGE_MODULES: Record<RechargeSubsectionKey, AdminModuleConfig> = {
  codes: ADMIN_MODULES.rechargeCodes,
  redemptionAttempts: {
    summaryPath: '/api/admin/recharge-code-redemption-attempts/summary',
    listPath: '/api/admin/recharge-code-redemption-attempts?limit=25&offset=0',
    listKey: 'attempts',
    detailBasePath: '/api/admin/recharge-code-redemption-attempts',
    detailIdKey: 'id',
    title: '兑换记录',
    description: '查看充值码兑换成功和失败记录，方便确认哪些码已兑换、哪些码不可重复兑换。',
    columns: [
      { key: 'codePreview', label: '码预览' },
      { key: 'result', label: '结果' },
      { key: 'failureKind', label: '失败类型' },
      { key: 'userEmail', label: '用户' },
      { key: 'createdAt', label: '时间' },
    ],
  },
}

const GATEWAY_SUBSECTIONS: Array<{ key: GatewaySubsectionKey; label: string }> = [
  { key: 'routes', label: '中转站线路' },
  { key: 'modelSkus', label: '模型' },
  { key: 'bindings', label: '模型可用线路' },
  { key: 'strategy', label: '策略' },
]

const GATEWAY_MODULES: Record<GatewaySubsectionKey, AdminModuleConfig> = {
  routes: ADMIN_MODULES.gateway,
  modelSkus: ADMIN_MODULES.modelSkus,
  bindings: {
    listPath: '/api/admin/model-route-bindings?limit=25&offset=0',
    listKey: 'bindings',
    detailBasePath: '/api/admin/model-route-bindings',
    detailIdKey: 'id',
    title: '模型可用线路',
    description: '给一个生图模型选择可用中转站线路。一个模型可以配置多条线路作为备用。',
    columns: [
      { key: 'modelDisplayName', label: '模型' },
      { key: 'routeName', label: '线路' },
      { key: 'healthStatus', label: '健康状态' },
      { key: 'restoresAt', label: '预计恢复' },
      { key: 'priority', label: '线路顺序' },
      { key: 'weight', label: '分流比例' },
      { key: 'enabled', label: '启用' },
    ],
  },
  strategy: {
    listPath: '/api/admin/gateway-strategy',
    listKey: 'strategies',
    detailIdKey: 'id',
    title: '线路策略',
    description: '管理后台可见的简单线路策略。具体调度算法仍由后端代码执行。',
    columns: [
      { key: 'id', label: '项目' },
      { key: 'failoverEnabled', label: '故障切换' },
    ],
  },
}

const GROWTH_SUBSECTIONS: Array<{ key: GrowthSubsectionKey; label: string }> = [
  { key: 'referrals', label: '邀请关系' },
  { key: 'creditRecords', label: '奖励流水' },
]

const GROWTH_MODULES: Record<GrowthSubsectionKey, AdminModuleConfig> = {
  referrals: ADMIN_MODULES.growth,
  creditRecords: {
    summaryPath: '/api/admin/growth/credit-records/summary',
    listPath: '/api/admin/growth/credit-records?limit=25&offset=0',
    listKey: 'creditRecords',
    detailBasePath: '/api/admin/growth/credit-records',
    detailIdKey: 'id',
    title: '增长奖励流水',
    description: '查看邀请奖励和新用户启动礼包相关的点数流水，不包含每日免费点数。',
    columns: [
      { key: 'id', label: '流水编号' },
      { key: 'type', label: '类型' },
      { key: 'amount', label: '点数' },
      { key: 'userEmail', label: '用户' },
      { key: 'relatedId', label: '关联记录' },
    ],
  },
}

const USER_MODULES: Record<UserSubsectionKey, AdminModuleConfig> = {
  users: ADMIN_MODULES.users,
  billingLedger: ADMIN_MODULES.billingLedger,
  referrals: ADMIN_MODULES.growth,
  creditRecords: GROWTH_MODULES.creditRecords,
}

const CONTENT_MODULES: Record<ContentSubsectionKey, AdminModuleConfig> = {
  templates: ADMIN_MODULES.content,
  candidates: {
    listPath: '/api/admin/content/template-candidates?status=pending&limit=25&offset=0',
    listKey: 'candidates',
    detailBasePath: '/api/admin/content/template-candidates',
    detailIdKey: 'id',
    title: '候选审核',
    description: '导入后只保留候选精品，人工确认通过后才进入网站模板库。',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'category', label: '分类' },
      { key: 'status', label: '状态' },
      { key: 'imagePath', label: '本地图片' },
      { key: 'sourceUrl', label: '来源' },
    ],
  },
  importRuns: {
    listPath: '/api/admin/content/template-import-runs?limit=25&offset=0',
    listKey: 'importRuns',
    detailBasePath: '/api/admin/content/template-import-runs',
    detailIdKey: 'id',
    title: '来源导入',
    description: '输入一个网址或 GitHub 仓库链接，系统抓取候选、图片转本地，然后交给人工审核。',
    columns: [
      { key: 'sourceType', label: '类型' },
      { key: 'status', label: '状态' },
      { key: 'totalCandidates', label: '候选' },
      { key: 'approvedCount', label: '通过' },
      { key: 'sourceUrl', label: '来源' },
    ],
  },
}

const ADMIN_FILTERS: Partial<Record<Exclude<AdminSectionKey, 'dashboard'> | UserSubsectionKey | RechargeSubsectionKey | GatewaySubsectionKey | GrowthSubsectionKey | ContentSubsectionKey, AdminFilterField[]>> = {
  users: [
    { key: 'email', label: '邮箱' },
    { key: 'status', label: '状态', type: 'select', options: ['active', 'disabled'] },
    { key: 'emailVerified', label: '邮箱验证', type: 'select', options: ['true', 'false'] },
    { key: 'hasRecharged', label: '有充值', type: 'select', options: ['true', 'false'] },
    { key: 'hasGenerated', label: '有生成', type: 'select', options: ['true', 'false'] },
  ],
  billingLedger: [
    { key: 'user', label: '用户' },
    { key: 'type', label: '类型' },
    { key: 'relatedId', label: '关联记录' },
    { key: 'createdByAdmin', label: '管理员' },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
  ],
  rechargeCodes: [
    { key: 'status', label: '状态', type: 'select', options: ['active', 'disabled', 'redeemed', 'expired'] },
    { key: 'batchNo', label: '批次' },
    { key: 'redeemedByUser', label: '兑换用户' },
  ],
  codes: [
    { key: 'status', label: '状态', type: 'select', options: ['active', 'disabled', 'redeemed', 'expired'] },
    { key: 'batchNo', label: '批次' },
    { key: 'redeemedByUser', label: '兑换用户' },
  ],
  redemptionAttempts: [
    { key: 'codePreview', label: '码预览' },
    { key: 'user', label: '用户' },
    { key: 'failureKind', label: '失败类型' },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
  ],
  modelSkus: [
    { key: 'enabled', label: '启用', type: 'select', options: ['true', 'false'] },
    { key: 'supportsEdit', label: '支持编辑', type: 'select', options: ['true', 'false'] },
    { key: 'supportsMask', label: '支持蒙版', type: 'select', options: ['true', 'false'] },
  ],
  routes: [
    { key: 'enabled', label: '启用', type: 'select', options: ['true', 'false'] },
  ],
  bindings: [
    { key: 'modelSkuId', label: '模型' },
    { key: 'routeId', label: '线路' },
  ],
  tasks: [
    { key: 'status', label: '状态', type: 'select', options: ['queued', 'running', 'succeeded', 'failed', 'timeout', 'cancelled'] },
    { key: 'user', label: '用户', placeholder: '邮箱 / 昵称 / 用户ID' },
    { key: 'modelSku', label: '模型', placeholder: '模型标识 / 名称' },
    { key: 'routeId', label: '线路标识', placeholder: '线路标识 / 名称' },
    { key: 'failureKind', label: '失败类型', type: 'select', options: TASK_FAILURE_KIND_OPTIONS },
    { key: 'chargedOnly', label: '仅扣点', type: 'checkbox' },
  ],
  inspiration: [
    { key: 'queue', label: '队列', type: 'select', options: ['featured_candidates', 'needs_review', 'auto_hidden', 'latest'] },
    { key: 'status', label: '状态', type: 'select', options: ['ai_reviewing', 'published', 'needs_review', 'hidden', 'removed'] },
    { key: 'category', label: '分类', type: 'select', options: PROMPT_LIBRARY_CATEGORY_FILTER_OPTIONS },
    { key: 'user', label: '发布来源', placeholder: '邮箱 / 昵称 / 用户ID' },
  ],
  templates: [
    { key: 'search', label: '搜索' },
    { key: 'category', label: '分类', type: 'select', options: PROMPT_LIBRARY_CATEGORY_FILTER_OPTIONS },
    { key: 'status', label: '状态', type: 'select', options: ['published'] },
  ],
  candidates: [
    { key: 'status', label: '状态', type: 'select', options: ['pending', 'approved', 'rejected'], defaultValue: 'pending', hideAllOption: true },
    { key: 'importRunId', label: '导入任务编号' },
  ],
  growth: [
    { key: 'status', label: '状态' },
    { key: 'inviteCode', label: '邀请码' },
    { key: 'inviterUser', label: '邀请人' },
    { key: 'inviteeUser', label: '被邀请人' },
  ],
  referrals: [
    { key: 'status', label: '状态' },
    { key: 'inviteCode', label: '邀请码' },
    { key: 'inviterUser', label: '邀请人' },
    { key: 'inviteeUser', label: '被邀请人' },
  ],
  creditRecords: [
    { key: 'user', label: '用户' },
    { key: 'type', label: '类型' },
    { key: 'relatedId', label: '关联记录' },
    { key: 'createdByAdmin', label: '管理员' },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
  ],
  shares: [
    { key: 'reviewStatus', label: '审核', type: 'select', options: ['auto_pass', 'attention', 'blocked'] },
    { key: 'status', label: '状态', type: 'select', options: ['shareActive', 'shareExpired', 'shareRevoked'] },
    { key: 'user', label: '用户', placeholder: '邮箱 / 昵称 / 用户ID' },
    { key: 'token', label: 'Token' },
    { key: 'outputId', label: '输出编号' },
    { key: 'taskId', label: '任务编号' },
    { key: 'requiresAccessCode', label: '访问码', type: 'select', options: ['true', 'false'] },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
  ],
  auditLogs: [
    { key: 'action', label: '动作' },
    { key: 'targetType', label: '目标类型' },
    { key: 'targetId', label: '目标记录' },
    { key: 'adminUserId', label: '管理员' },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
  ],
}

function getErrorMessage(error: unknown) {
  if (error instanceof AdminApiError || error instanceof Error) return error.message
  return '后台请求失败，请稍后重试'
}

function formatMetricValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  if (typeof value === 'string' && value.trim()) return value
  return '0'
}

function getValueByPath(row: unknown, key: string): unknown {
  if (!row || typeof row !== 'object') return undefined
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, row)
}

function getFirstReadableValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getValueByPath(row, key)
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function getDisplayValueForColumn(row: Record<string, unknown>, column: AdminTableColumn) {
  const key = column.key
  return getFirstReadableValue(row, READABLE_FIELD_KEYS[key] ?? []) ?? getValueByPath(row, key)
}

function getDisplayValueForKey(row: Record<string, unknown>, key: string) {
  return getFirstReadableValue(row, READABLE_FIELD_KEYS[key] ?? []) ?? getValueByPath(row, key)
}

function decodeDataTextUrl(value: string) {
  const match = value.match(/^data:text\/[^,]*,(.*)$/i)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function extractMarkdownImageUrl(markdown: string) {
  const match = markdown.match(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/)
  return match?.[1] ?? null
}

function normalizePreviewImageUrl(value: unknown) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) return null
  return /^(data:image\/|https?:\/\/|\/)/i.test(url) ? url : null
}

function getTemplatePreviewUrls(row: Record<string, unknown>) {
  const urls: string[] = []
  const addUrl = (value: unknown) => {
    const url = normalizePreviewImageUrl(value)
    if (url && !urls.includes(url)) urls.push(url)
  }
  addUrl(getValueByPath(row, 'imagePath'))
  addUrl(getValueByPath(row, 'originalImageUrl'))
  addUrl(getValueByPath(row, 'previewImageUrl'))
  const sourceUrl = getValueByPath(row, 'sourceUrl')
  if (typeof sourceUrl === 'string' && sourceUrl.startsWith('data:text/')) {
    const markdown = decodeDataTextUrl(sourceUrl)
    if (markdown) addUrl(extractMarkdownImageUrl(markdown))
  }
  return urls
}

function getTemplatePreviewUrl(row: Record<string, unknown>) {
  return getTemplatePreviewUrls(row)[0] ?? null
}

function getOfficialTemplateAdminPayload(limit: number, offset: number, filters: Record<string, string>, hiddenTemplateIds: string[] = []) {
  const search = filters.search?.trim().toLowerCase() ?? ''
  const category = filters.category?.trim() ?? ''
  const status = filters.status?.trim() ?? ''
  const hiddenIds = new Set(hiddenTemplateIds)
  const templates = PROMPT_LIBRARY_TEMPLATES
    .filter((template) => !hiddenIds.has(template.id))
    .filter((template) => (!status || status === 'published'))
    .filter((template) => (!category || template.category === category))
    .filter((template) => {
      if (!search) return true
      return template.searchText.includes(search)
    })
    .map((template) => ({
      id: template.id,
      title: template.title,
      category: template.category,
      status: 'published',
      imagePath: template.thumbnailImageUrl || template.previewImageUrl || null,
      sourceUrl: template.sourceUrl ?? 'frontend-prompt-library',
      tags: template.tags,
      prompt: template.prompt,
      summary: template.summary,
      negativePrompt: template.negativePrompt,
      guidance: template.guidance,
      ratio: template.ratio,
      sourceName: template.sourceName ?? '官方模板库',
      sourceAuthor: template.sourceAuthor ?? null,
      license: template.license ?? null,
      previewImageUrl: template.previewImageUrl ?? null,
      templateType: template.templateType ?? null,
      featured: Boolean(template.featured),
    }))
  return {
    ok: true,
    templates: templates.slice(offset, offset + limit),
    pagination: { limit, offset, total: templates.length },
  }
}

function getHiddenOfficialTemplateIds(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('hiddenTemplateIds' in payload)) return []
  const ids = (payload as { hiddenTemplateIds?: unknown }).hiddenTemplateIds
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : []
}

function getRecordReadableLabel(row: Record<string, unknown>, config: AdminModuleConfig) {
  const preferredKeys = [
    'email',
    'userLabel',
    'userEmail',
    'displayName',
    'title',
    'codePreview',
    'batchNo',
    'name',
    'displayName',
    'modelDisplayName',
    'routeName',
    'inviteCode',
    'sourceUrl',
  ]
  const columnKeys = config.columns.map((column) => column.key)
  const rawId = getValueByPath(row, config.detailIdKey)
  const rawIdText = rawId == null ? '' : String(rawId)
  for (const key of [...preferredKeys, ...columnKeys]) {
    const value = getDisplayValueForKey(row, key)
    if (typeof value === 'string' && value.trim() && value !== rawIdText) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return rawIdText
}

function formatCellValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (Array.isArray(value)) {
    if (!value.length) return '-'
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map((item) => formatCellValue(item)).join('、')
    }
  }
  if (typeof value === 'string' && value.trim()) return value
  if (value == null) return '-'
  return JSON.stringify(value)
}

function maskSecretValue(value: string) {
  const text = value.trim()
  if (!text) return text
  if (text.length <= 8) return '*'.repeat(Math.max(4, text.length))
  return `${text.slice(0, 4)}${'*'.repeat(Math.max(4, text.length - 8))}${text.slice(-4)}`
}

function shouldMaskAdminField(key: string) {
  return ['apiKeyRef', 'apiKey', 'secret', 'secretKey', 'token', 'accessToken'].includes(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function humanizeAdminKey(key: string) {
  const labels: Record<string, string> = {
    id: '编号',
    userId: '用户',
    userLabel: '用户',
    userEmail: '用户邮箱',
    userDisplayName: '用户昵称',
    email: '邮箱',
    displayName: '显示名',
    status: '状态',
    balance: '余额',
    amount: '点数',
    points: '点数',
    type: '类型',
    action: '动作',
    targetType: '目标类型',
    targetId: '目标记录',
    targetLabel: '目标',
    targetName: '目标名称',
    targetEmail: '目标邮箱',
    adminUserId: '管理员',
    adminEmail: '管理员邮箱',
    adminDisplayName: '管理员名称',
    createdByAdminId: '创建管理员',
    createdByAdminEmail: '创建管理员邮箱',
    createdByAdminDisplayName: '创建管理员名称',
    codePreview: '码预览',
    redeemedByUserLabel: '兑换用户',
    redeemedByUserEmail: '兑换用户邮箱',
    redeemedByUserDisplayName: '兑换用户昵称',
    redeemedByUserId: '兑换用户',
    inviterUserId: '邀请人',
    inviterUserEmail: '邀请人邮箱',
    inviterUserDisplayName: '邀请人昵称',
    inviteeUserId: '被邀请人',
    inviteeUserEmail: '被邀请人邮箱',
    inviteeUserDisplayName: '被邀请人昵称',
    inviterEmail: '邀请人邮箱',
    inviterDisplayName: '邀请人昵称',
    inviteeEmail: '被邀请人邮箱',
    inviteeDisplayName: '被邀请人昵称',
    batchName: '批次',
    batchNo: '批次',
    modelSku: '模型',
    modelSkuId: '模型',
    modelDisplayName: '模型名称',
    name: '名称',
    routeId: '线路标识',
    routeName: '线路名称',
    provider: '接口类型',
    baseUrl: '接口地址',
    apiKeyRef: '密钥环境变量',
    upstreamModel: '线路实际模型名',
    defaultUpstreamModel: '默认上游模型',
    supportedSizes: '前台尺寸选项',
    supportedQualities: '前台质量选项',
    supportsEdit: '支持编辑',
    supportsMask: '支持蒙版',
    priority: '线路顺序',
    weight: '分流比例',
    timeoutSeconds: '等待秒数',
    failoverEnabled: '故障切换',
    routeOrdering: '线路选择顺序',
    cooldownPolicy: '冷却策略',
    retryPolicy: '重试策略',
    editableControls: '可调参数',
    currentAlgorithm: '当前算法',
    health: '线路健康',
    diagnostics: '线路诊断',
    healthStatus: '健康状态',
    boundModelCount: '绑定模型数',
    coolingModelCount: '冷却模型数',
    maxConsecutiveFailures: '最大连续失败',
    lastSuccessAt: '最近成功',
    lastFailureAt: '最近失败',
    lastFailureKind: '最近失败类型',
    lastError: '最近错误',
    cooldownActive: '冷却中',
    cooldownUntil: '冷却到',
    lastRecoveryAt: '预计恢复时间',
    restoresAt: '预计恢复时间',
    requestId: '请求编号',
    outputCount: '出图张数',
    outputs: '结果图',
    outputIndex: '图片序号',
    publicUrl: '图片地址',
    storageProvider: '存储方式',
    storageKey: '存储键',
    mimeType: '图片类型',
    byteSize: '文件大小',
    rawSourceUrl: '上游原图地址',
    revisedPrompt: '改写提示词',
    failureKind: '失败类型',
    errorSummary: '错误摘要',
    chargedPoints: '扣点',
    ledgerId: '扣点流水',
    ledgerLabel: '扣点流水',
    modelLabel: '模型',
    routeLabel: '线路',
    createdAt: '创建时间',
    updatedAt: '更新时间',
    redeemedAt: '兑换时间',
    finishedAt: '完成时间',
    lastLoginAt: '最近登录',
    title: '标题',
    category: '分类',
    tags: '标签',
    prompt: '提示词',
    imagePath: '本地图片',
    sourceUrl: '来源 URL',
    importRunId: '导入任务',
    reviewNote: '审核备注',
    publishedAt: '发布时间',
    source: '来源',
    enabled: '启用',
    featured: '精选',
    viewCount: '浏览',
    reason: '原因',
    note: '备注',
  }
  if (labels[key]) return labels[key]
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase())
}

function getStatusTone(value: unknown) {
  const text = String(value ?? '').toLowerCase()
  if (['active', 'enabled', 'published', 'succeeded', 'success', 'redeemed', 'ok', 'available', 'healthy', 'publish', 'recommend_featured'].includes(text)) return 'good'
  if ([
    'disabled',
    'expired',
    'archived',
    'cancelled',
    'failed',
    'timeout',
    'error',
    'invalid',
    'no_route',
    'route_exhausted',
    'upstream_timeout',
    'upstream_rate_limited',
    'upstream_server_error',
    'upstream_bad_request',
    'upstream_auth_error',
    'content_policy_violation',
    'unsupported_model',
    'parameter_incompatible',
    'network',
    'unknown',
    'admin_cancelled',
    'hidden',
    'removed',
    'auto_hidden',
    'reject',
  ].includes(text)) return 'bad'
  if (['queued', 'running', 'draft', 'pending', 'cooling', 'degraded', 'ai_reviewing', 'needs_review', 'featured_candidates', 'latest', 'attention'].includes(text)) return 'warn'
  return 'neutral'
}

function shouldRenderAsBadge(key: string, value: unknown) {
  if (typeof value === 'boolean') return true
  return ['status', 'enabled', 'featured', 'result', 'failureKind', 'healthStatus', 'supportsEdit', 'supportsMask', 'cooldownActive', 'reviewStatus', 'aiDecision'].includes(key)
}

function formatAdminDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]|$)/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAdminValue(value: unknown) {
  if (typeof value === 'string') {
    const mapped = ADMIN_VALUE_LABELS[value.toLowerCase()]
    if (mapped) return mapped
    return formatAdminDate(value)
  }
  return formatCellValue(value)
}

function getSelectOptionLabel(option: string) {
  return ADMIN_VALUE_LABELS[option.toLowerCase()] ?? option
}

function getPrimitiveEntries(record: Record<string, unknown>, limit = 18) {
  return Object.entries(record)
    .filter(([key]) => key !== 'ok')
    .filter(([, value]) => (
      value == null ||
      ['string', 'number', 'boolean'].includes(typeof value) ||
      (Array.isArray(value) && value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item)))
    ))
    .slice(0, limit)
}

function getObjectEntries(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'ok' && key !== 'pagination')
    .filter(([, value]) => isRecord(value))
}

function getArrayEntries(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'ok')
    .filter(([, value]) => Array.isArray(value)) as Array<[string, unknown[]]>
}

function pickPrimaryRecord(payload: unknown) {
  if (!isRecord(payload)) return null
  const objectEntries = getObjectEntries(payload)
  const preferred = objectEntries.find(([key]) => !['summary', 'metrics'].includes(key))
  if (preferred && isRecord(preferred[1])) return { key: preferred[0], label: humanizeAdminKey(preferred[0]), record: preferred[1] }
  return { key: 'record', label: '记录', record: payload }
}

function collectSummaryMetrics(payload: unknown) {
  if (!isRecord(payload)) return []
  const source = isRecord(payload.summary) ? payload.summary : payload
  const metrics: Array<[string, unknown]> = []
  const walk = (record: Record<string, unknown>, prefix = '', depth = 0) => {
    Object.entries(record).forEach(([key, value]) => {
      if (key === 'ok' || key === 'pagination') return
      const label = prefix ? `${prefix} / ${humanizeAdminKey(key)}` : humanizeAdminKey(key)
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
        metrics.push([label, value])
      } else if (Array.isArray(value)) {
        metrics.push([label, value.length])
      } else if (isRecord(value) && depth < 1) {
        walk(value, label, depth + 1)
      }
    })
  }
  walk(source)
  return metrics.slice(0, 12)
}

function getShareAuditSummaryCards(summary: unknown) {
  const record = isRecord(summary) && isRecord(summary.summary)
    ? summary.summary
    : isRecord(summary)
      ? summary
      : null
  if (!record) return [] as Array<{ label: string; value: string; note?: string }>

  const readCount = (key: string) => {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string' && value.trim()) return value
    return '0'
  }

  return [
    { label: '总分享', value: readCount('totalShareCount'), note: '当前筛选结果' },
    { label: '有效', value: readCount('activeCount'), note: '仍可访问' },
    { label: '已标记', value: readCount('attentionCount'), note: '边界内容' },
    { label: '已拦截', value: readCount('blockedCount'), note: '禁止公开分享' },
  ]
}

function AdminValue(props: { fieldKey: string; value: unknown }) {
  if (typeof props.value === 'string' && shouldMaskAdminField(props.fieldKey)) {
    return <span>{maskSecretValue(props.value)}</span>
  }
  if (shouldRenderAsCopyableValue(props.fieldKey, props.value)) {
    return <AdminCopyableValue value={String(props.value)} />
  }
  if (shouldRenderAsBadge(props.fieldKey, props.value)) {
    return <span className={`admin-status-badge is-${getStatusTone(props.value)}`}>{formatAdminValue(props.value)}</span>
  }
  return <span>{formatAdminValue(props.value)}</span>
}

function shouldRenderAsCopyableValue(fieldKey: string, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false
  if (['sourceUrl', 'rawSourceUrl', 'publicUrl'].includes(fieldKey)) return true
  return /^https?:\/\//i.test(value.trim())
}

function AdminCopyableValue(props: { value: string }) {
  const text = props.value.trim()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const handleCopy = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      const { copyTextToClipboard } = await import('../lib/clipboard')
      await copyTextToClipboard(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1400)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 1800)
    }
  }

  return (
    <span className="admin-copyable-value">
      <span className="admin-copyable-text" title={text}>{formatAdminDate(text)}</span>
      <button type="button" className="admin-copyable-button" onClick={handleCopy} aria-label="复制完整内容" title="复制完整内容">
        <CopyIcon className="admin-copyable-icon" />
        <span>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '失败' : '复制'}</span>
      </button>
    </span>
  )
}

function AdminTemplatePreview(props: { row: Record<string, unknown> }) {
  const previewUrls = getTemplatePreviewUrls(props.row)
  const previewKey = previewUrls.join('\n')
  const [previewIndex, setPreviewIndex] = useState(0)

  useEffect(() => {
    setPreviewIndex(0)
  }, [previewKey])

  if (!previewUrls.length) return <span className="admin-template-preview-empty">无图</span>
  const previewUrl = previewUrls[previewIndex]
  if (!previewUrl) return <span className="admin-template-preview-empty is-missing">图片缺失</span>
  return (
    <span className="admin-template-preview">
      <img src={previewUrl} alt="" loading="lazy" onError={() => setPreviewIndex((index) => index + 1)} />
      <span>有图</span>
    </span>
  )
}

function AdminTableCell(props: { row: Record<string, unknown>; column: AdminTableColumn }) {
  if (props.column.key === 'imagePath') {
    return <AdminTemplatePreview row={props.row} />
  }
  return <AdminValue fieldKey={props.column.key} value={getDisplayValueForColumn(props.row, props.column)} />
}

function AdminBusinessFieldList(props: { record: Record<string, unknown>; fields: Array<{ key: string; label: string }> }) {
  return (
    <div className="admin-field-grid admin-field-grid-compact">
      {props.fields.map((field) => (
        <div key={field.key} className="admin-field-item">
          <span>{field.label}</span>
          <strong>
            <AdminValue fieldKey={field.key} value={getDisplayValueForKey(props.record, field.key) ?? getValueByPath(props.record, field.key)} />
          </strong>
        </div>
      ))}
    </div>
  )
}

function AdminFieldGrid(props: { record: Record<string, unknown>; limit?: number }) {
  const entries = getPrimitiveEntries(props.record, props.limit ?? 18)
  if (!entries.length) return <p className="admin-empty">暂无可直接展示的字段。</p>
  return (
    <div className="admin-field-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="admin-field-item">
          <span>{humanizeAdminKey(key)}</span>
          <strong>
            <AdminValue fieldKey={key} value={getDisplayValueForKey(props.record, key) ?? value} />
          </strong>
        </div>
      ))}
    </div>
  )
}

function AdminRecordPreview(props: { record: Record<string, unknown> }) {
  const entries = getPrimitiveEntries(props.record, 6)
  return (
    <div className="admin-record-preview">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{humanizeAdminKey(key)}</span>
          <strong>
            <AdminValue fieldKey={key} value={getDisplayValueForKey(props.record, key) ?? value} />
          </strong>
        </div>
      ))}
    </div>
  )
}

function AdminRawData(props: { payload: unknown; label?: string }) {
  return (
    <details className="admin-raw-data">
      <summary>{props.label ?? '查看原始数据'}</summary>
      <pre>{JSON.stringify(props.payload, null, 2)}</pre>
    </details>
  )
}

function AdminSummaryView(props: { summary: unknown; fallback: string }) {
  const metrics = collectSummaryMetrics(props.summary)
  if (!props.summary) return <p className="admin-empty">{props.fallback}</p>
  return (
    <details className="admin-summary-disclosure">
      <summary>展开辅助摘要</summary>
      <div className="admin-summary-view">
        {metrics.length ? (
          <div className="admin-summary-grid">
            {metrics.map(([label, value]) => (
              <article key={label} className="admin-summary-card">
                <span>{label}</span>
                <strong>{formatMetricValue(value)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-empty">摘要接口暂无可展示指标。</p>
        )}
        <AdminRawData payload={props.summary} label="原始摘要数据" />
      </div>
    </details>
  )
}

function getContentDetailRecord(detail: Record<string, unknown>, contentSubsection: ContentSubsectionKey) {
  const key = contentSubsection === 'templates'
    ? 'template'
    : contentSubsection === 'candidates'
      ? 'candidate'
      : 'importRun'
  const record = detail[key]
  if (isRecord(record)) return record
  return detail
}

function AdminContentDetailView(props: { detail: Record<string, unknown>; selectedId: string; contentSubsection: ContentSubsectionKey }) {
  const record = getContentDetailRecord(props.detail, props.contentSubsection)
  const previewUrl = getTemplatePreviewUrl(record)

  if (props.contentSubsection === 'importRuns') {
    return (
      <div className="admin-detail-stack">
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>导入任务详情</span>
            <strong>{formatCellValue(getValueByPath(record, 'id'))}</strong>
          </div>
          <AdminBusinessFieldList
            record={record}
            fields={[
              { key: 'status', label: '状态' },
              { key: 'sourceType', label: '来源类型' },
              { key: 'totalCandidates', label: '候选数' },
              { key: 'approvedCount', label: '已通过' },
              { key: 'rejectedCount', label: '已拒绝' },
              { key: 'createdAt', label: '创建时间' },
              { key: 'updatedAt', label: '更新时间' },
              { key: 'sourceUrl', label: '来源链接' },
              { key: 'localAssetRoot', label: '本地图片目录' },
              { key: 'errorSummary', label: '错误摘要' },
            ]}
          />
        </section>
        <AdminRawData payload={props.detail} />
      </div>
    )
  }

  return (
    <div className="admin-detail-stack">
      {previewUrl ? (
        <section className="admin-detail-image-card">
          <img src={previewUrl} alt="" loading="lazy" />
        </section>
      ) : null}
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>{props.contentSubsection === 'candidates' ? '候选详情' : '模板详情'}</span>
          <strong>{props.selectedId || formatCellValue(getValueByPath(record, 'id'))}</strong>
        </div>
        <AdminBusinessFieldList
          record={record}
          fields={[
            { key: 'title', label: '标题' },
            { key: 'category', label: '分类' },
            { key: 'status', label: '状态' },
            { key: 'imagePath', label: '图片' },
            { key: 'sourceUrl', label: '来源' },
            { key: 'importRunId', label: '导入任务' },
          ]}
        />
      </section>
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>提示词</span>
        </div>
        <textarea className="admin-readonly-prompt" value={String(getValueByPath(record, 'prompt') ?? '')} readOnly />
      </section>
      <AdminRawData payload={props.detail} />
    </div>
  )
}

function getInspirationDetailRecord(detail: Record<string, unknown>) {
  const post = getValueByPath(detail, 'post')
  return isRecord(post) ? post : detail
}

function AdminInspirationDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const post = getInspirationDetailRecord(props.detail)
  const aiReviewResult = getValueByPath(props.detail, 'aiReviewResult')
  const aiReviewRecord = isRecord(aiReviewResult) ? aiReviewResult : null
  const strengths = Array.isArray(aiReviewRecord?.strengths) ? aiReviewRecord.strengths : []
  const risks = Array.isArray(aiReviewRecord?.risks) ? aiReviewRecord.risks : []
  const imageUrl = typeof getValueByPath(post, 'imageUrl') === 'string' ? String(getValueByPath(post, 'imageUrl')) : ''

  return (
    <div className="admin-detail-stack">
      {imageUrl ? (
        <section className="admin-detail-image-card">
          <img src={imageUrl} alt="" loading="lazy" />
        </section>
      ) : null}

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>展示决策</span>
          <strong>{props.selectedId || formatCellValue(getValueByPath(post, 'id'))}</strong>
        </div>
        <AdminBusinessFieldList
          record={post}
          fields={[
            { key: 'title', label: '标题' },
            { key: 'category', label: '分类' },
            { key: 'status', label: '状态' },
            { key: 'featured', label: '精选' },
            { key: 'featuredRank', label: '精选位次' },
            { key: 'aiDecision', label: 'AI 结论' },
            { key: 'qualityScore', label: '质量分' },
            { key: 'riskScore', label: '风险分' },
            { key: 'processingLabel', label: '处理方式' },
            { key: 'publishedAt', label: '发布时间' },
          ]}
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>发布信息</span>
        </div>
        <AdminBusinessFieldList
          record={post}
          fields={[
            { key: 'caption', label: '说明' },
            { key: 'authorNameSnapshot', label: '发布显示名' },
            { key: 'userLabel', label: '发布账号' },
            { key: 'shareUrlPath', label: '公开链接' },
            { key: 'viewCount', label: '浏览量' },
            { key: 'detailOpenCount', label: '详情打开' },
            { key: 'enterStudioClickCount', label: '进入工作台' },
          ]}
        />
      </section>

      {aiReviewRecord ? (
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>AI 初审结果</span>
          </div>
          <AdminBusinessFieldList
            record={aiReviewRecord}
            fields={[
              { key: 'decision', label: '决策' },
              { key: 'reviewStatus', label: '审核状态' },
              { key: 'reviewSummary', label: '审核摘要' },
            ]}
          />
          {strengths.length ? (
            <div className="admin-activity-list">
              {strengths.map((item, index) => (
                <article key={`strength-${index}`} className="admin-activity-item">
                  <strong>{String(item)}</strong>
                </article>
              ))}
            </div>
          ) : null}
          {risks.length ? (
            <div className="admin-activity-list">
              {risks.map((item, index) => (
                <article key={`risk-${index}`} className="admin-activity-item">
                  <strong>{String(item)}</strong>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminDetailView(props: { detail: unknown; selectedId: string; detailLoading: boolean; contentSubsection?: ContentSubsectionKey }) {
  if (props.detailLoading) return <p className="admin-empty">正在加载详情...</p>
  if (!props.detail) return <p className="admin-empty">从左侧列表选择一条记录查看业务详情。</p>
  if (!isRecord(props.detail)) {
    return (
      <div className="admin-detail-stack">
        <p className="admin-empty">{formatAdminValue(props.detail)}</p>
        <AdminRawData payload={props.detail} />
      </div>
    )
  }
  if (props.contentSubsection) {
    return <AdminContentDetailView detail={props.detail} selectedId={props.selectedId} contentSubsection={props.contentSubsection} />
  }

  const primary = pickPrimaryRecord(props.detail)
  const arrays = getArrayEntries(props.detail)
  const nested = getObjectEntries(props.detail).filter(([key]) => key !== primary?.key)

  return (
    <div className="admin-detail-stack">
      {primary ? (
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>{primary.label}</span>
            <strong>{props.selectedId || formatCellValue(primary.record.id)}</strong>
          </div>
          <AdminFieldGrid record={primary.record} />
        </section>
      ) : null}

      {arrays.slice(0, 5).map(([key, value]) => (
        <section key={key} className="admin-detail-block">
          <div className="admin-detail-title">
            <span>{humanizeAdminKey(key)}</span>
            <strong>{value.length} 条</strong>
          </div>
          {value.length ? (
            <div className="admin-activity-list">
              {value.slice(0, 5).map((item, index) => isRecord(item) ? (
                <article key={index} className="admin-activity-item">
                  <AdminRecordPreview record={item} />
                </article>
              ) : (
                <article key={index} className="admin-activity-item">
                  <strong>{formatAdminValue(item)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">暂无记录。</p>
          )}
        </section>
      ))}

      {nested.slice(0, 4).map(([key, value]) => isRecord(value) ? (
        <section key={key} className="admin-detail-block">
          <div className="admin-detail-title">
            <span>{humanizeAdminKey(key)}</span>
          </div>
          <AdminFieldGrid record={value} limit={10} />
        </section>
      ) : null)}

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function getListRows(payload: unknown, listKey: string): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return []
  const value = (payload as Record<string, unknown>)[listKey]
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []
}

function getPagination(payload: unknown) {
  if (!payload || typeof payload !== 'object') return { limit: 25, offset: 0, total: 0 }
  const pagination = (payload as Record<string, unknown>).pagination
  if (!pagination || typeof pagination !== 'object') return { limit: 25, offset: 0, total: 0 }
  const record = pagination as Record<string, unknown>
  return {
    limit: typeof record.limit === 'number' ? record.limit : 25,
    offset: typeof record.offset === 'number' ? record.offset : 0,
    total: typeof record.total === 'number' ? record.total : 0,
  }
}

function buildPath(basePath: string, limit: number, offset: number, filters: Record<string, string>) {
  const [pathname, query = ''] = basePath.split('?')
  const params = new URLSearchParams(query)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  Object.entries(filters).forEach(([key, value]) => {
    const trimmed = value.trim()
    if (trimmed) params.set(key, trimmed)
    else params.delete(key)
  })
  return `${pathname}?${params.toString()}`
}

function getFilterValues(fields: AdminFilterField[], form: HTMLFormElement) {
  return fields.reduce<Record<string, string>>((values, field) => {
    const control = form.elements.namedItem(field.key)
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      values[field.key] = control.checked ? 'true' : ''
    } else if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      values[field.key] = control.value
    }
    return values
  }, {})
}

function getDefaultFiltersForScope(scope: string): Record<string, string> {
  if (scope === 'candidates') return { status: 'pending' }
  return {}
}

function getSelectedLabel(section: Exclude<AdminSectionKey, 'dashboard'>, selectedId: string, selectedLabel: string, actionScope: string) {
  if (!selectedId) {
    if (actionScope === 'redemptionAttempts') return '查看、筛选和打开详情即可追踪兑换记录。'
    if (section === 'rechargeCodes') return '生成和导出可直接执行；禁用充值码前先在列表选择记录。'
    if (section === 'gateway') return '创建可直接执行；更新线路、模型或绑定前先选中记录。'
    if (section === 'content') return '先选中候选或模板，再执行通过、拒绝、更新或导入任务。'
    if (section === 'inspiration') return '先选择帖子，再做隐藏、恢复公开或分类修正。'
    return '先在左侧列表选择记录，再执行对应操作。'
  }
  return `已选中：${selectedLabel || selectedId}`
}

function getModuleWorkflow(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>) {
  if (config.listKey === 'posts') {
    return [
      '查看 AI 初审结果',
      '按队列、分类或发布来源筛选',
      '选择帖子处理可见性或修正公开信息',
    ]
  }
  if (config.listKey === 'shares') {
    return [
      '查看分享记录',
      '按状态或用户筛选',
      '选择记录确认输出信息',
    ]
  }
  if (config.listKey === 'attempts') {
    return [
      '查看兑换记录',
      '按用户或失败类型筛选',
      '选择记录查看详情',
    ]
  }
  if (config.listKey === 'templates' || config.listKey === 'candidates' || config.listKey === 'importRuns') {
    return [
      '导入后进入候选',
      '人工审核标题、分类、图片',
      '通过后发布到前台模板库',
    ]
  }
  if (section === 'rechargeCodes') {
    return [
      '查看充值码库存',
      '选择一条码查看状态',
      '右侧生成、导出或禁用',
    ]
  }
  if (section === 'content') {
    return [
      `查看和筛选 ${config.title}`,
      '选择记录查看详情',
      '在右侧新增、导入或审核',
    ]
  }
  if (['rechargeCodes', 'gateway'].includes(section)) {
    return [
      `查看和筛选 ${config.title}`,
      '选择记录查看详情',
      '在右侧执行创建或更新',
    ]
  }
  return [
    `查找 ${config.title}`,
    '选择记录查看上下文',
    '在右侧处理选中记录',
  ]
}

function getFilterTitle(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>) {
  if (config.listKey === 'posts') return '筛选广场帖子'
  if (config.listKey === 'shares') return '筛选分享记录'
  if (config.listKey === 'attempts') return '筛选兑换记录'
  if (section === 'rechargeCodes') return '筛选充值码库存'
  return '筛选'
}

function getFilterHint(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>, filterCount: number) {
  if (config.listKey === 'posts') return '按队列、状态、分类或发布来源查找广场帖子'
  if (config.listKey === 'shares') return '按分享状态、用户、任务或时间查找记录'
  if (config.listKey === 'attempts') return '按充值码、用户、结果或时间查找兑换记录'
  if (section === 'rechargeCodes') return '按状态、批次或兑换用户查找兑换码'
  return filterCount ? `定位要处理的 ${config.title} 记录` : '调整每页数量后浏览记录'
}

function getListTitle(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>) {
  if (config.listKey === 'posts') return '广场帖子'
  if (config.listKey === 'shares') return '分享记录'
  if (config.listKey === 'attempts') return '兑换记录'
  if (section === 'rechargeCodes') return '充值码库存'
  return `${config.title}列表`
}

function getActionPanelTitle(actionScope: string) {
  if (actionScope === 'codes') return '制码 / 导出 / 禁用'
  if (actionScope === 'redemptionAttempts') return '兑换记录'
  if (actionScope === 'tasks') return '任务记录'
  if (actionScope === 'inspiration') return '精选 / 隐藏 / 恢复'
  if (actionScope === 'candidates') return '候选审核 / 发布'
  if (actionScope === 'importRuns') return '导入任务'
  return '主要操作'
}

function readOptionalText(value: string) {
  const text = value.trim()
  return text ? text : undefined
}

function readRecordString(record: Record<string, unknown> | null, key: string, fallback = '') {
  const value = record ? getValueByPath(record, key) : undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function readRecordBoolean(record: Record<string, unknown> | null, key: string, fallback: boolean) {
  const value = record ? getValueByPath(record, key) : undefined
  return typeof value === 'boolean' ? value : fallback
}

function readRecordList(record: Record<string, unknown> | null, key: string, fallback = '*') {
  const value = record ? getValueByPath(record, key) : undefined
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item ?? '').trim()).filter(Boolean)
    return items.length ? items.join(',') : fallback
  }
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

function splitTextList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitModelOptionList(value: string) {
  const items = splitTextList(value)
  return items.length ? items : ['*']
}

function toggleModelOptionValue(currentValue: string, optionValue: string) {
  if (optionValue === '*') return '*'
  const current = splitModelOptionList(currentValue).filter((item) => item !== '*')
  const next = current.includes(optionValue)
    ? current.filter((item) => item !== optionValue)
    : [...current, optionValue]
  return next.length ? next.join(',') : '*'
}

function ModelOptionPicker(props: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled: boolean
  onChange: (value: string) => void
}) {
  const selectedValues = splitModelOptionList(props.value)
  const selectedSet = new Set(selectedValues)

  return (
    <div className="admin-model-option-field">
      <div className="admin-model-option-head">
        <span>{props.label}</span>
        <small>{selectedSet.has('*') ? '不限制' : `${selectedValues.length} 项`}</small>
      </div>
      <div className="admin-model-option-grid" role="group" aria-label={props.label}>
        {props.options.map((option) => {
          const active = selectedSet.has(option.value)
          return (
            <button
              key={option.value}
              type="button"
              className={active ? 'admin-model-option-pill is-selected' : 'admin-model-option-pill'}
              aria-pressed={active}
              disabled={props.disabled}
              onClick={() => props.onChange(toggleModelOptionValue(props.value, option.value))}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

async function downloadAdminFile(path: string, token: string, filename: string) {
  const sessionCheck = await fetch(buildAdminApiUrl('/api/admin/me'), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!sessionCheck.ok) {
    throw new AdminApiError('后台登录已失效，请退出后台后重新登录。')
  }

  const safeFilename = getAdminExportFilename(filename)
  const response = await fetch(buildAdminApiUrl(path), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new AdminApiError('导出失败，请稍后重试。')
  }
  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = safeFilename
  link.style.display = 'none'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  return safeFilename
}

function getAdminExportFilename(filename: string) {
  const safeFilename = ensureDownloadExtension(filename, null, filename)
  const extension = safeFilename.match(/\.(json|csv|txt)$/i)?.[1]?.toLowerCase() ?? 'json'
  if (/^recharge-codes-\d{4}-\d{2}-\d{2}\.(json|csv|txt)$/i.test(safeFilename)) return safeFilename
  if (/^recharge-codes\.(json|csv|txt)$/i.test(safeFilename)) {
    return `recharge-codes-${formatDownloadDate(new Date())}.${extension}`
  }
  return safeFilename
}

function formatDownloadDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ensureDownloadExtension(filename: string, contentType: string | null, fallback: string) {
  const safeName = filename.trim() || fallback
  if (/\.(json|csv|txt)$/i.test(safeName)) return safeName
  if (contentType?.includes('text/csv') || /\.csv$/i.test(fallback)) return `${safeName}.csv`
  if (contentType?.includes('text/plain') || /\.txt$/i.test(fallback)) return `${safeName}.txt`
  return `${safeName}.json`
}

function parseJsonRecord(value: string) {
  const text = value.trim()
  if (!text) return undefined
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请输入 JSON 对象')
  return parsed as Record<string, unknown>
}

function getDashboardMetrics(dashboard: AdminDashboardPayload | null) {
  const metrics = dashboard?.metrics && typeof dashboard.metrics === 'object' ? dashboard.metrics : {}
  return [
    ['新增用户', metrics.todayNewUsers ?? metrics.newUsers ?? 0],
    ['活跃用户', metrics.todayActiveUsers ?? metrics.activeUsers ?? 0],
    ['生成任务', metrics.todayTasks ?? metrics.tasks ?? 0],
    ['成功任务', metrics.todaySuccessfulTasks ?? metrics.successfulTasks ?? 0],
    ['失败任务', metrics.todayFailedTasks ?? metrics.failedTasks ?? 0],
    ['今日扣点', metrics.todayChargedPoints ?? metrics.chargedPoints ?? 0],
  ] as const
}

function AdminLoginView(props: { onLogin: (token: string, admin: AdminProfile) => void }) {
  const [email, setEmail] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const payload = await loginAdmin({
        email: email.trim().toLowerCase(),
        bootstrapToken: bootstrapToken.trim() || undefined,
        displayName: displayName.trim() || undefined,
      })
      props.onLogin(payload.session.token, payload.admin)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card" aria-label="后台登录">
        <div className="admin-login-copy">
          <span className="admin-kicker">后台入口</span>
          <h1>后台管理</h1>
          <p>使用管理员邮箱进入后台。首次创建管理员时填写首次管理员口令，之后只需要管理员账号存在且未停用。</p>
        </div>
        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label>
            <span>管理员邮箱</span>
            <input
              value={email}
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              required
            />
          </label>
          <label>
            <span>首次管理员口令</span>
            <input
              value={bootstrapToken}
              type="password"
              autoComplete="one-time-code"
              placeholder="首次创建管理员时填写"
              onChange={(event) => setBootstrapToken(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            <span>显示名</span>
            <input
              value={displayName}
              type="text"
              autoComplete="name"
              placeholder="可选"
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={submitting}
            />
          </label>
          {message ? <p className="admin-form-error" role="alert">{message}</p> : null}
          <button type="submit" disabled={submitting}>{submitting ? '登录中...' : '进入后台'}</button>
        </form>
      </section>
    </main>
  )
}

function AdminDashboard(props: {
  dashboard: AdminDashboardPayload | null
  loading: boolean
  error: string
  onNavigate: (section: Exclude<AdminSectionKey, 'dashboard'>) => void
}) {
  const metrics = useMemo(() => getDashboardMetrics(props.dashboard), [props.dashboard])
  const riskReminders = Array.isArray(props.dashboard?.riskReminders) ? props.dashboard.riskReminders : []
  const recentTasks = Array.isArray(props.dashboard?.recentTasks) ? props.dashboard.recentTasks : []
  const recentAuditLogs = Array.isArray(props.dashboard?.recentAuditLogs) ? props.dashboard.recentAuditLogs : []

  return (
    <section className="admin-section" aria-label="后台首页">
      <div className="admin-section-head">
        <div>
          <span className="admin-kicker">总览</span>
          <h1>后台首页</h1>
        </div>
        <p>{props.loading ? '正在加载后台数据...' : props.error || '先从常用管理入口进入具体工作，指标和审计只做辅助观察。'}</p>
      </div>

      <section className="admin-panel admin-home-actions">
        <div className="admin-panel-head">
          <h2>常用管理入口</h2>
          <span>先选一件要处理的事</span>
        </div>
        <div className="admin-home-action-grid">
          {ADMIN_HOME_ACTIONS.map((action) => (
            <article key={action.key} className="admin-home-action-card">
              <div>
                <strong>{action.title}</strong>
                <p>{action.description}</p>
              </div>
              <button type="button" onClick={() => props.onNavigate(action.key)}>
                {action.label}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-compact-metrics">
        <div className="admin-panel-head">
          <h2>运营摘要</h2>
          <span>辅助判断</span>
        </div>
        <div className="admin-metric-grid">
          {metrics.map(([label, value]) => (
            <article key={label} className="admin-metric-card">
              <span>{label}</span>
              <strong>{formatMetricValue(value)}</strong>
            </article>
          ))}
        </div>
      </section>

      <div className="admin-dashboard-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>最近任务</h2>
            <span>{recentTasks.length} 条</span>
          </div>
          {recentTasks.length ? (
            <div className="admin-placeholder-list">
              {recentTasks.slice(0, 5).map((item, index) => isRecord(item) ? (
                <article key={String(item.id ?? index)} className="admin-activity-item">
                  <AdminRecordPreview record={item} />
                </article>
              ) : (
                <article key={index} className="admin-activity-item">
                  <strong>{formatAdminValue(item)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">暂无生成任务。</p>
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>风险提醒</h2>
            <span>{riskReminders.length} 条</span>
          </div>
          {riskReminders.length ? (
            <div className="admin-placeholder-list">
              {riskReminders.slice(0, 5).map((item, index) => isRecord(item) ? (
                <article key={index} className="admin-activity-item">
                  <AdminRecordPreview record={item} />
                </article>
              ) : (
                <article key={index} className="admin-activity-item">
                  <strong>{formatAdminValue(item)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">暂无风险提醒。</p>
          )}
        </section>
        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>最近审计</h2>
            <span>{recentAuditLogs.length} 条</span>
          </div>
          {recentAuditLogs.length ? (
            <div className="admin-placeholder-list">
              {recentAuditLogs.slice(0, 5).map((item, index) => isRecord(item) ? (
                <article key={index} className="admin-activity-item">
                  <AdminRecordPreview record={item} />
                </article>
              ) : (
                <article key={index} className="admin-activity-item">
                  <strong>{formatAdminValue(item)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">暂无审计记录。</p>
          )}
        </section>
      </div>
    </section>
  )
}

function AdminActionPanel(props: {
  section: Exclude<AdminSectionKey, 'dashboard'>
  contentSubsection?: ContentSubsectionKey
  rechargeSubsection?: RechargeSubsectionKey
  userSubsection?: UserSubsectionKey
  gatewaySubsection?: GatewaySubsectionKey
  token: string
  selectedId: string
  selectedLabel: string
  selectedRecord: Record<string, unknown> | null
  onActionComplete: (message: string) => Promise<void>
}) {
  const actionScope = props.section === 'content'
    ? props.contentSubsection ?? 'candidates'
    : props.section === 'users'
      ? props.userSubsection ?? 'users'
    : props.section === 'rechargeCodes'
      ? props.rechargeSubsection ?? 'codes'
      : props.section === 'gateway'
        ? props.gatewaySubsection ?? 'routes'
      : props.section
  const [submittingAction, setSubmittingAction] = useState('')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')

  useEffect(() => {
    setSubmittingAction('')
    setMessage('')
    setMessageTone('success')
  }, [actionScope])

  const runAction = async (actionName: string, action: () => Promise<void>) => {
    setSubmittingAction(actionName)
    setMessage('')
    setMessageTone('success')
    try {
      await action()
      await props.onActionComplete(actionName)
      setMessage(`${actionName}完成，已刷新数据。`)
      setMessageTone('success')
    } catch (error) {
      if (error instanceof AdminActionNotice) {
        await props.onActionComplete(actionName)
        setMessage(error.message)
        setMessageTone('success')
      } else {
        setMessage(getErrorMessage(error))
        setMessageTone('error')
      }
    } finally {
      setSubmittingAction('')
    }
  }

  const disabledBySubmit = Boolean(submittingAction)

  return (
    <section className="admin-panel admin-action-panel">
      <div className="admin-panel-head">
        <h2>{getActionPanelTitle(actionScope)}</h2>
        <span>{submittingAction || getSelectedLabel(props.section, props.selectedId, props.selectedLabel, actionScope)}</span>
      </div>
      {message ? <p className={messageTone === 'success' ? 'admin-form-success' : 'admin-form-error'}>{message}</p> : null}

      {actionScope === 'users' ? (
        <UserActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'codes' ? (
        <RechargeCodeActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedLabel={props.selectedLabel}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'tasks' ? (
        <TaskActions
          selectedId={props.selectedId}
          selectedRecord={props.selectedRecord}
        />
      ) : null}
      {actionScope === 'inspiration' ? (
        <InspirationPostActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'routes' ? (
        <GatewayActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'modelSkus' ? (
        <ModelSkuActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'bindings' ? (
        <ModelRouteBindingActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'strategy' ? (
        <GatewayStrategyActions
          disabled={disabledBySubmit}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'templates' ? (
        <OfficialTemplateActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'candidates' ? (
        <CandidateReviewActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedLabel={props.selectedLabel}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'importRuns' ? (
        <TemplateImportActions
          disabled={disabledBySubmit}
          onRun={runAction}
          token={props.token}
        />
      ) : null}
      {actionScope === 'billingLedger' || actionScope === 'referrals' || actionScope === 'creditRecords' || actionScope === 'growth' || actionScope === 'shares' || actionScope === 'auditLogs' || actionScope === 'redemptionAttempts' ? (
        <p className="admin-empty">当前模块后端以查看、筛选和详情追踪为主，没有额外写操作。</p>
      ) : null}
    </section>
  )
}

function UserActions(props: {
  disabled: boolean
  selectedId: string
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [balanceReason, setBalanceReason] = useState('')
  const [status, setStatus] = useState('active')
  const [statusReason, setStatusReason] = useState('')
  const disabled = props.disabled || !props.selectedId

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          const numericAmount = Number(amount)
          void props.onRun('余额调整', async () => {
            await adminPost(`/api/admin/users/${encodeURIComponent(props.selectedId)}/balance-adjustments`, props.token, {
              amount: numericAmount,
              reason: balanceReason.trim(),
            })
          })
        }}
      >
        <h3>余额调整</h3>
        <label>
          <span>点数变动</span>
          <input type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={disabled} />
        </label>
        <label>
          <span>原因</span>
          <textarea value={balanceReason} onChange={(event) => setBalanceReason(event.target.value)} required disabled={disabled} />
        </label>
        <button type="submit" disabled={disabled}>提交调整</button>
      </form>

      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('用户状态更新', async () => {
            await adminPatch(`/api/admin/users/${encodeURIComponent(props.selectedId)}/status`, props.token, {
              status,
              reason: statusReason.trim(),
            })
          })
        }}
      >
        <h3>用户状态</h3>
        <label>
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={disabled}>
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
        </label>
        <label>
          <span>原因</span>
          <textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} required disabled={disabled} />
        </label>
        <button type="submit" disabled={disabled}>更新状态</button>
      </form>
    </div>
  )
}

function RechargeCodeActions(props: {
  disabled: boolean
  selectedId: string
  selectedLabel: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [points, setPoints] = useState('30')
  const [count, setCount] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [disableReason, setDisableReason] = useState('')
  const [exportBatchNo, setExportBatchNo] = useState('')
  const selectedStatus = readRecordString(props.selectedRecord, 'status')
  const selectedCanBeDisabled = !props.selectedId || selectedStatus === 'active'
  const selectedDisabled = props.disabled || !props.selectedId || !selectedCanBeDisabled

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('生成充值码批次', async () => {
            const payload = await adminPost<{ batch?: { batchNo?: string } }>('/api/admin/recharge-codes', props.token, {
              points: Number(points),
              count: Number(count),
              expiresAt: readOptionalText(expiresAt),
            })
            if (payload.batch?.batchNo) setExportBatchNo(payload.batch.batchNo)
          })
        }}
      >
        <h3>生成可售充值码</h3>
        <p className="admin-empty">系统自动生成批次号和兑换码编号，只支持 30 / 100 / 300 点。</p>
        <div className="admin-form-row">
          <label>
            <span>面额</span>
            <select value={points} onChange={(event) => setPoints(event.target.value)} disabled={props.disabled}>
              <option value="30">30 点</option>
              <option value="100">100 点</option>
              <option value="300">300 点</option>
            </select>
          </label>
          <label>
            <span>自动生成数量</span>
            <input type="number" min="1" max="500" value={count} onChange={(event) => setCount(event.target.value)} disabled={props.disabled} />
          </label>
        </div>
        <label>
          <span>过期时间</span>
          <input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} placeholder="可选，例如 2026-07-01T00:00:00Z" disabled={props.disabled} />
        </label>
        <button type="submit" disabled={props.disabled}>生成新批次</button>
      </form>

      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('禁用充值码', async () => {
            await adminPatch(`/api/admin/recharge-codes/${encodeURIComponent(props.selectedId)}`, props.token, {
              status: 'disabled',
              reason: disableReason.trim(),
            })
          })
        }}
      >
        <h3>禁用选中的码</h3>
        <p className="admin-empty">
          {props.selectedId
            ? selectedCanBeDisabled
              ? `将禁用：${props.selectedLabel || props.selectedId}`
              : '只有启用状态的充值码可以停用。'
            : '先在左侧库存列表选择一条充值码。禁用后这条码不能再被用户兑换。'}
        </p>
        <label>
          <span>禁用原因</span>
          <textarea value={disableReason} onChange={(event) => setDisableReason(event.target.value)} required disabled={selectedDisabled} />
        </label>
        <button type="submit" disabled={selectedDisabled}>禁用充值码</button>
      </form>

      <form className="admin-action-form">
        <h3>导出批次 TXT</h3>
        <p className="admin-empty">按批次导出仍处于启用状态的完整兑换码，TXT 每行一个码，适合导入第三方店铺。</p>
        <label>
          <span>批次号</span>
          <input value={exportBatchNo} onChange={(event) => setExportBatchNo(event.target.value)} placeholder="例如 RCB-20260609-001" disabled={props.disabled} />
        </label>
        <div className="admin-button-row">
          <button
            type="button"
            disabled={props.disabled || !exportBatchNo.trim()}
            onClick={() => {
              void props.onRun('导出充值码 TXT', async () => {
                const batchNo = exportBatchNo.trim()
                const downloadedFilename = await downloadAdminFile(`/api/admin/recharge-codes/export?batchNo=${encodeURIComponent(batchNo)}`, props.token, `${batchNo}.txt`)
                throw new AdminActionNotice(`导出已开始：${downloadedFilename}`)
              })
            }}
          >
            导出 TXT
          </button>
        </div>
      </form>
    </div>
  )
}

function TaskActions(props: {
  selectedId: string
  selectedRecord: Record<string, unknown> | null
}) {
  if (!props.selectedId || !props.selectedRecord) {
    return (
      <section className="admin-action-form admin-action-form-wide">
        <h3>任务记录</h3>
        <p className="admin-empty">先从左侧选择一条任务，右侧会展示生成状态、扣点结果和失败说明。</p>
      </section>
    )
  }

  const failureKind = getValueByPath(props.selectedRecord, 'failureKind')
  const errorSummary = getValueByPath(props.selectedRecord, 'errorSummary')
  const chargedPoints = Number(getValueByPath(props.selectedRecord, 'chargedPoints') ?? 0)
  const ledgerId = getValueByPath(props.selectedRecord, 'ledgerId')
  const outputCount = getValueByPath(props.selectedRecord, 'outputCount')

  return (
    <div className="admin-action-grid">
      <section className="admin-action-form admin-action-form-wide">
        <h3>任务概览</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>任务编号</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'id'))}</strong></div>
          <div><span>用户</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'userLabel') ?? getValueByPath(props.selectedRecord, 'userId'))}</strong></div>
          <div><span>状态</span><strong><AdminValue fieldKey="status" value={getValueByPath(props.selectedRecord, 'status')} /></strong></div>
          <div><span>模型</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'modelLabel') ?? getValueByPath(props.selectedRecord, 'modelSku'))}</strong></div>
          <div><span>线路</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'routeLabel') ?? getValueByPath(props.selectedRecord, 'routeId'))}</strong></div>
        </div>
      </section>

      <section className="admin-action-form admin-action-form-wide">
        <h3>扣点结果</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>扣点</span><strong>{chargedPoints > 0 ? `${chargedPoints} 点` : '未扣点'}</strong></div>
          <div><span>生成张数</span><strong>{formatAdminValue(outputCount ?? '-')}</strong></div>
          <div><span>流水编号</span><strong>{ledgerId ? formatAdminValue(ledgerId) : '无扣点流水'}</strong></div>
        </div>
        <p className="admin-form-hint">这里只展示任务与账务记录，不在此页执行加点、扣点或取消任务。</p>
      </section>

      <section className="admin-action-form admin-action-form-wide">
        <h3>失败说明</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>失败类型</span><strong>{failureKind ? <AdminValue fieldKey="failureKind" value={failureKind} /> : '-'}</strong></div>
          <div><span>错误摘要</span><strong>{errorSummary ? formatAdminValue(errorSummary) : '-'}</strong></div>
        </div>
      </section>
    </div>
  )
}

function InspirationPostActions(props: {
  disabled: boolean
  selectedId: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [category, setCategory] = useState(readRecordString(props.selectedRecord, 'category'))
  const [title, setTitle] = useState(readRecordString(props.selectedRecord, 'title'))
  const [caption, setCaption] = useState(readRecordString(props.selectedRecord, 'caption'))
  const [secondaryRank, setSecondaryRank] = useState(readRecordString(props.selectedRecord, 'manualFeaturedRank') || '2')
  const status = readRecordString(props.selectedRecord, 'status')
  const disabled = props.disabled || !props.selectedId

  useEffect(() => {
    setCategory(readRecordString(props.selectedRecord, 'category'))
    setTitle(readRecordString(props.selectedRecord, 'title'))
    setCaption(readRecordString(props.selectedRecord, 'caption'))
    setSecondaryRank(readRecordString(props.selectedRecord, 'manualFeaturedRank') || '2')
  }, [props.selectedId, props.selectedRecord])

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('更新帖子信息', async () => {
            await adminPatch(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}`, props.token, {
              category: category.trim(),
              title: title.trim(),
              caption: caption.trim(),
            })
          })
        }}
      >
        <h3>公开信息修正</h3>
        <label>
          <span>分类</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} disabled={disabled} required>
            <option value="">选择分类</option>
            {PROMPT_LIBRARY_CATEGORY_FILTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span>标题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} disabled={disabled} />
        </label>
        <label>
          <span>说明</span>
          <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={240} disabled={disabled} />
        </label>
        <button type="submit" disabled={disabled || !category.trim()}>保存修改</button>
      </form>

      <div className="admin-action-form">
        <h3>精选位与人工覆盖</h3>
        <p className="admin-form-hint">只在首页展示位需要人工干预时才覆盖；否则保持 AI 自动排序。</p>
        <label>
          <span>次级精选位次</span>
          <select value={secondaryRank} onChange={(event) => setSecondaryRank(event.target.value)} disabled={disabled || status !== 'published'}>
            <option value="2">次级位 2</option>
            <option value="3">次级位 3</option>
            <option value="4">次级位 4</option>
          </select>
        </label>
        <div className="admin-button-row">
          <button
            type="button"
            disabled={disabled || status !== 'published'}
            onClick={() => {
              void props.onRun('设为主视觉', async () => {
                await adminPost(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}/feature`, props.token, { slot: 'hero' })
              })
            }}
          >
            设为主视觉
          </button>
          <button
            type="button"
            disabled={disabled || status !== 'published'}
            onClick={() => {
              void props.onRun('设为次级精选', async () => {
                await adminPost(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}/feature`, props.token, {
                  slot: 'secondary',
                  rank: Number(secondaryRank),
                })
              })
            }}
          >
            设为次级精选
          </button>
          <button
            type="button"
            disabled={disabled || status !== 'published'}
            onClick={() => {
              void props.onRun('移出精选池', async () => {
                await adminPost(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}/feature`, props.token, { slot: 'exclude' })
              })
            }}
          >
            移出精选池
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              void props.onRun('恢复自动排序', async () => {
                await adminDelete(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}/feature`, props.token)
              })
            }}
          >
            恢复自动排序
          </button>
        </div>
      </div>

      <div className="admin-action-form">
        <h3>可见性控制</h3>
        <p className="admin-form-hint">隐藏后不会出现在广场前台；恢复公开会重新回到公开列表。</p>
        <div className="admin-button-row">
          <button
            type="button"
            disabled={disabled || status === 'hidden'}
            onClick={() => {
              void props.onRun('隐藏帖子', async () => {
                await adminPatch(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}`, props.token, { status: 'hidden' })
              })
            }}
          >
            隐藏
          </button>
          <button
            type="button"
            disabled={disabled || status === 'published'}
            onClick={() => {
              void props.onRun('恢复公开', async () => {
                await adminPatch(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}`, props.token, { status: 'published' })
              })
            }}
          >
            恢复公开
          </button>
          <button
            type="button"
            disabled={disabled || status === 'needs_review'}
            onClick={() => {
              void props.onRun('转待复核', async () => {
                await adminPatch(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}`, props.token, { status: 'needs_review' })
              })
            }}
          >
            转待复核
          </button>
        </div>
      </div>

      <div className="admin-action-form">
        <h3>AI 初审</h3>
        <p className="admin-form-hint">当标题、说明或分类被修正后，可以重新跑一次初审分流，刷新 AI 结论与审核状态。</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            void props.onRun('重跑 AI 初审', async () => {
              await adminPost(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}/review-ai`, props.token)
            })
          }}
        >
          重跑 AI 初审
        </button>
      </div>
    </div>
  )
}

function GatewayActions(props: {
  disabled: boolean
  selectedId: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKeyRef, setApiKeyRef] = useState('')
  const [showApiKeyRef, setShowApiKeyRef] = useState(false)
  const [notes, setNotes] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!props.selectedId) {
      setName('')
      setBaseUrl('')
      setApiKeyRef('')
      setShowApiKeyRef(false)
      setNotes('')
      setEnabled(true)
      return
    }
    setName(readRecordString(props.selectedRecord, 'name'))
    setBaseUrl(readRecordString(props.selectedRecord, 'baseUrl'))
    setApiKeyRef('')
    setShowApiKeyRef(false)
    setNotes(readRecordString(props.selectedRecord, 'notes'))
    setEnabled(readRecordBoolean(props.selectedRecord, 'enabled', true))
  }, [props.selectedId, props.selectedRecord])

  const buildRoutePayload = () => {
    const payload: {
      name: string
      provider: string
      baseUrl: string
      apiKeyRef?: string
      notes?: string
      enabled: boolean
    } = {
      name: name.trim(),
      provider: 'openai-compatible',
      baseUrl: baseUrl.trim(),
      notes: readOptionalText(notes),
      enabled,
    }
    const nextApiKeyRef = apiKeyRef.trim()
    if (!props.selectedId || nextApiKeyRef) {
      payload.apiKeyRef = nextApiKeyRef
    }
    return payload
  }

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form admin-action-form-wide"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun(props.selectedId ? '更新线路' : '创建线路', async () => {
            const payload = buildRoutePayload()
            if (props.selectedId) {
              await adminPatch(`/api/admin/gateway-routes/${encodeURIComponent(props.selectedId)}`, props.token, payload)
            } else {
              await adminPost('/api/admin/gateway-routes', props.token, payload)
            }
          })
        }}
      >
        <h3>{props.selectedId ? '更新选中线路' : '创建中转站线路'}</h3>
        <div className="admin-form-row">
          <label>
            <span>线路名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
          </label>
        </div>
        <p className="admin-form-hint">线路默认按 OpenAI 兼容接口调用，后台只需要填写中转站名称、接口地址和密钥环境变量名。</p>
        <label>
          <span>接口地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
        </label>
        <div className="admin-form-row">
          <label>
            <span>密钥环境变量名</span>
            <input
              value={apiKeyRef}
              type={showApiKeyRef ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={props.selectedId ? '留空则保留当前密钥' : ''}
              onChange={(event) => setApiKeyRef(event.target.value)}
              required={!props.selectedId}
              disabled={props.disabled}
            />
          </label>
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={showApiKeyRef} onChange={(event) => setShowApiKeyRef(event.target.checked)} disabled={props.disabled} />
            <span>显示密钥</span>
          </label>
        </div>
        <label>
          <span>备注</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={props.disabled} />
        </label>
        <label className="admin-checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={props.disabled} />
          <span>启用线路</span>
        </label>
        <button type="submit" disabled={props.disabled}>{props.selectedId ? '更新线路' : '创建线路'}</button>
      </form>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中线路"
        hint="删除线路会同时删除它关联的模型可用线路和健康状态。"
        confirmText="删除线路"
        actionName="删除线路"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/gateway-routes/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
    </div>
  )
}

function ModelSkuActions(props: {
  disabled: boolean
  selectedId: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [supportedSizes, setSupportedSizes] = useState('*')
  const [supportedQualities, setSupportedQualities] = useState('*')
  const [supportsEdit, setSupportsEdit] = useState(true)
  const [supportsMask, setSupportsMask] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [sortOrder, setSortOrder] = useState('100')

  useEffect(() => {
    if (!props.selectedId) {
      setName('')
      setDisplayName('')
      setDescription('')
      setSupportedSizes('*')
      setSupportedQualities('*')
      setSupportsEdit(true)
      setSupportsMask(true)
      setEnabled(true)
      setSortOrder('100')
      return
    }
    setName(readRecordString(props.selectedRecord, 'name'))
    setDisplayName(readRecordString(props.selectedRecord, 'displayName'))
    setDescription(readRecordString(props.selectedRecord, 'description'))
    setSupportedSizes(readRecordList(props.selectedRecord, 'supportedSizes'))
    setSupportedQualities(readRecordList(props.selectedRecord, 'supportedQualities'))
    setSupportsEdit(readRecordBoolean(props.selectedRecord, 'supportsEdit', true))
    setSupportsMask(readRecordBoolean(props.selectedRecord, 'supportsMask', true))
    setEnabled(readRecordBoolean(props.selectedRecord, 'enabled', true))
    setSortOrder(readRecordString(props.selectedRecord, 'sortOrder', '100'))
  }, [props.selectedId, props.selectedRecord])

  const applyPreset = (preset: typeof MODEL_PRESETS[number]) => {
    setName(preset.id)
    setDisplayName(preset.label)
    if (preset.supportedSizes?.length) setSupportedSizes(preset.supportedSizes.join(','))
    if (preset.supportedQualities?.length) setSupportedQualities(preset.supportedQualities.join(','))
    if (!description.trim()) setDescription(preset.description)
  }

  const buildPayload = () => ({
    name: name.trim(),
    displayName: displayName.trim(),
    description: readOptionalText(description),
    supportedSizes: splitModelOptionList(supportedSizes),
    supportedQualities: splitModelOptionList(supportedQualities),
    supportsEdit,
    supportsMask,
    enabled,
    sortOrder: Number(sortOrder),
  })

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form admin-action-form-wide"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun(props.selectedId ? '更新生图模型' : '创建生图模型', async () => {
            const payload = buildPayload()
            if (props.selectedId) {
              await adminPatch(`/api/admin/model-skus/${encodeURIComponent(props.selectedId)}`, props.token, payload)
            } else {
              await adminPost('/api/admin/model-skus', props.token, payload)
            }
          })
        }}
      >
        <h3>{props.selectedId ? '更新选中模型' : '创建生图模型'}</h3>
        {!props.selectedId ? (
          <div className="admin-preset-group" aria-label="常用模型">
            {MODEL_PRESETS.map((preset) => (
              <button type="button" key={preset.id} onClick={() => applyPreset(preset)} disabled={props.disabled}>
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="admin-form-row">
          <label>
            <span>模型标识</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 gpt-image-2" required={!props.selectedId} disabled={props.disabled} />
          </label>
          <label>
            <span>显示名称</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 GPT Image 2" required={!props.selectedId} disabled={props.disabled} />
          </label>
        </div>
        <p className="admin-form-hint">模型标识给系统识别用，可以填 gpt-image-2、gemini、grok，也可以填以后新增模型的代号；显示名称给后台和前台看。</p>
        <label>
          <span>描述</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={props.disabled} />
        </label>
        <div className="admin-form-row">
          <ModelOptionPicker
            label="尺寸选项"
            value={supportedSizes}
            options={MODEL_SIZE_OPTIONS}
            disabled={props.disabled}
            onChange={setSupportedSizes}
          />
          <ModelOptionPicker
            label="质量选项"
            value={supportedQualities}
            options={MODEL_QUALITY_OPTIONS}
            disabled={props.disabled}
            onChange={setSupportedQualities}
          />
        </div>
        <p className="admin-form-hint">选“不限制”表示后台不限制真实模型能力；只有需要前台固定少数选项时，才选择具体尺寸或质量。</p>
        <div className="admin-form-row">
          <label>
            <span>排序</span>
            <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} disabled={props.disabled} />
          </label>
        </div>
        <div className="admin-checkbox-group">
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={props.disabled} />
            <span>启用模型</span>
          </label>
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={supportsEdit} onChange={(event) => setSupportsEdit(event.target.checked)} disabled={props.disabled} />
            <span>前台显示编辑入口</span>
          </label>
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={supportsMask} onChange={(event) => setSupportsMask(event.target.checked)} disabled={props.disabled} />
            <span>前台显示蒙版入口</span>
          </label>
        </div>
        <button type="submit" disabled={props.disabled}>{props.selectedId ? '更新模型' : '创建模型'}</button>
      </form>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中模型"
        hint="删除模型会同时删除该模型的可用线路绑定和健康状态；已有历史任务不会被删除。"
        confirmText="删除模型"
        actionName="删除模型"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/model-skus/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
    </div>
  )
}

function ModelRouteBindingActions(props: {
  disabled: boolean
  selectedId: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [modelSkuId, setModelSkuId] = useState('')
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([])
  const [upstreamModel, setUpstreamModel] = useState('')
  const [priority, setPriority] = useState('100')
  const [weight, setWeight] = useState('1')
  const [timeoutSeconds, setTimeoutSeconds] = useState('60')
  const [enabled, setEnabled] = useState(true)
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([])
  const [routeOptions, setRouteOptions] = useState<Array<{ id: string; label: string }>>([])
  const [boundRouteIds, setBoundRouteIds] = useState<string[]>([])
  const [bindingLookupLoading, setBindingLookupLoading] = useState(false)
  const [optionsError, setOptionsError] = useState('')

  useEffect(() => {
    if (!props.selectedId) {
      setModelSkuId('')
      setSelectedRouteIds([])
      setUpstreamModel('')
      setPriority('100')
      setWeight('1')
      setTimeoutSeconds('60')
      setEnabled(true)
      return
    }
    const routeId = readRecordString(props.selectedRecord, 'routeId')
    setModelSkuId(readRecordString(props.selectedRecord, 'modelSkuId'))
    setSelectedRouteIds(routeId ? [routeId] : [])
    setUpstreamModel(readRecordString(props.selectedRecord, 'upstreamModel'))
    setPriority(readRecordString(props.selectedRecord, 'priority', '100'))
    setWeight(readRecordString(props.selectedRecord, 'weight', '1'))
    setTimeoutSeconds(readRecordString(props.selectedRecord, 'timeoutSeconds', '60'))
    setEnabled(readRecordBoolean(props.selectedRecord, 'enabled', true))
  }, [props.selectedId, props.selectedRecord])

  useEffect(() => {
    let cancelled = false
    setOptionsError('')
    const loadOptions = async () => {
      try {
        const modelsPayload = await adminGet('/api/admin/model-skus?limit=200&offset=0', props.token)
        const routesPayload = await adminGet('/api/admin/gateway-routes?limit=200&offset=0', props.token)
        if (cancelled) return
        setModelOptions(getListRows(modelsPayload, 'models').map((model) => {
          const id = String(model.id ?? '')
          const displayName = String(model.displayName ?? model.name ?? id)
          return { id, label: displayName }
        }).filter((item) => item.id))
        setRouteOptions(getListRows(routesPayload, 'routes').map((route) => {
          const id = String(route.id ?? '')
          const name = String(route.name ?? id)
          return { id, label: name }
        }).filter((item) => item.id))
      } catch (error) {
        if (!cancelled) setOptionsError(getErrorMessage(error))
      }
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [props.token])

  useEffect(() => {
    if (props.selectedId || !modelSkuId.trim()) {
      setBoundRouteIds([])
      return
    }
    let cancelled = false
    const loadExistingBindings = async () => {
      setBindingLookupLoading(true)
      setOptionsError('')
      try {
        const normalizedModelSkuId = modelSkuId.trim()
        const payload = await adminGet(`/api/admin/model-route-bindings?modelSkuId=${encodeURIComponent(normalizedModelSkuId)}&limit=200&offset=0`, props.token)
        if (cancelled) return
        const routeIds = getListRows(payload, 'bindings')
          .filter((binding) => String(binding.modelSkuId ?? '') === normalizedModelSkuId)
          .map((binding) => String(binding.routeId ?? ''))
          .filter(Boolean)
        setBoundRouteIds(Array.from(new Set(routeIds)))
      } catch (error) {
        if (!cancelled) {
          setBoundRouteIds([])
          setOptionsError(getErrorMessage(error))
        }
      } finally {
        if (!cancelled) setBindingLookupLoading(false)
      }
    }
    void loadExistingBindings()
    return () => {
      cancelled = true
    }
  }, [modelSkuId, props.selectedId, props.token])

  useEffect(() => {
    if (!boundRouteIds.length) return
    setSelectedRouteIds((current) => current.filter((routeId) => !boundRouteIds.includes(routeId)))
  }, [boundRouteIds])

  const boundRouteIdSet = useMemo(() => new Set(boundRouteIds), [boundRouteIds])
  const newBindingCount = selectedRouteIds.length
  const addableRouteCount = Math.max(0, routeOptions.length - boundRouteIds.length)

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form admin-action-form-wide"
        onSubmit={(event) => {
          event.preventDefault()
          const isEditing = Boolean(props.selectedId)
          const routeIdsToCreate = selectedRouteIds.filter((routeId) => !boundRouteIdSet.has(routeId))
          void props.onRun(isEditing ? '更新模型可用线路' : `创建模型可用线路（${routeIdsToCreate.length} 条）`, async () => {
            const sharedPayload = {
              upstreamModel: readOptionalText(upstreamModel),
              priority: Number(priority),
              weight: Number(weight),
              timeoutSeconds: Number(timeoutSeconds),
              enabled,
            }
            if (isEditing) {
              await adminPatch(`/api/admin/model-route-bindings/${encodeURIComponent(props.selectedId)}`, props.token, sharedPayload)
            } else {
              const normalizedModelSkuId = modelSkuId.trim()
              if (!normalizedModelSkuId) throw new Error('请选择模型')
              if (routeIdsToCreate.length === 0) throw new Error('请选择至少一条尚未绑定的线路')
              for (const selectedRouteId of routeIdsToCreate) {
                await adminPost('/api/admin/model-route-bindings', props.token, {
                  ...sharedPayload,
                  modelSkuId: normalizedModelSkuId,
                  routeId: selectedRouteId,
                })
              }
            }
          })
        }}
      >
        <h3>{props.selectedId ? '更新这条模型可用线路' : '新增模型可用线路绑定'}</h3>
        {optionsError ? <p className="admin-form-error">{optionsError}</p> : null}
        {props.selectedId ? (
          <p className="admin-empty">当前是更新模式：只修改左侧已选中这条绑定的顺序、分流、等待时间和启用状态；模型和线路不会被替换。</p>
        ) : (
          <p className="admin-empty">当前是新增模式：保存后会给所选模型新增下面勾选的线路绑定；每勾选 1 条线路就创建 1 条绑定记录。</p>
        )}
        <div className="admin-form-row admin-form-row-single">
          <label>
            <span>选择模型</span>
            <select
              value={modelSkuId}
              onChange={(event) => {
                setModelSkuId(event.target.value)
                setSelectedRouteIds([])
              }}
              required={!props.selectedId}
              disabled={props.disabled || Boolean(props.selectedId)}
            >
              <option value="">请选择模型</option>
              {modelOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
        {!props.selectedId ? (
          <div className="admin-route-picker">
            <div className="admin-route-picker-head">
              <span>新增绑定的线路（可多选）</span>
              <small>{bindingLookupLoading ? '正在检查已有绑定' : newBindingCount > 0 ? `本次新增 ${newBindingCount} 条` : boundRouteIds.length > 0 ? `已绑定 ${boundRouteIds.length} 条，可新增 ${addableRouteCount} 条` : '至少选择 1 条'}</small>
            </div>
            {routeOptions.length > 0 ? (
              <div className="admin-route-checkbox-list">
                {routeOptions.map((item) => {
                  const checked = selectedRouteIds.includes(item.id)
                  const alreadyBound = boundRouteIdSet.has(item.id)
                  const optionClassName = [
                    'admin-route-option',
                    alreadyBound ? 'is-bound' : '',
                    checked ? 'is-selected' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <label key={item.id} className={optionClassName}>
                      <input
                        type="checkbox"
                        checked={alreadyBound || checked}
                        onChange={(event) => {
                          if (alreadyBound) return
                          setSelectedRouteIds((current) => (
                            event.target.checked
                              ? Array.from(new Set([...current, item.id]))
                              : current.filter((id) => id !== item.id)
                          ))
                        }}
                        disabled={props.disabled || bindingLookupLoading || !modelSkuId || alreadyBound}
                      />
                      <span className="admin-route-option-name">{item.label}</span>
                      <small>{alreadyBound ? '已绑定' : checked ? '本次新增' : '可新增'}</small>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="admin-empty">暂无中转站线路，请先在“中转站线路”里创建线路。</p>
            )}
          </div>
        ) : null}
        <p className="admin-form-hint">同一个模型可以绑定多条线路；前台只选模型，生成时后端按线路顺序、同级权重、冷却状态和故障切换自动调度。</p>
        <label>
          <span>{props.selectedId ? '这条线路实际调用的模型名' : '这些线路实际调用的模型名'}</span>
          <input value={upstreamModel} onChange={(event) => setUpstreamModel(event.target.value)} disabled={props.disabled} />
        </label>
        <p className="admin-form-hint">如果中转站里的模型名和后台模型标识一致，可以留空；不一致时在这里填写中转站要求的实际模型名。批量绑定时会应用到所有勾选线路。</p>
        <div className="admin-form-row">
          <label>
            <span>线路顺序</span>
            <input type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} disabled={props.disabled} />
            <small className="admin-field-hint">数字越小越优先；主线路填小，备用线路填大。</small>
          </label>
          <label>
            <span>同顺序分流比例</span>
            <input type="number" min="1" value={weight} onChange={(event) => setWeight(event.target.value)} disabled={props.disabled} />
            <small className="admin-field-hint">顺序相同时按比例分流；数值越大请求越多。</small>
          </label>
        </div>
        <label>
          <span>等待秒数</span>
          <input type="number" min="1" max="600" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} disabled={props.disabled} />
          <small className="admin-field-hint">单次调用最多等待多久；超时后记录失败并切换线路。</small>
        </label>
        <label className="admin-checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={props.disabled} />
          <span>{props.selectedId ? '启用这条可用线路' : '启用这些可用线路'}</span>
        </label>
        <button type="submit" disabled={props.disabled || (!props.selectedId && (bindingLookupLoading || newBindingCount === 0))}>{props.selectedId ? '更新这条绑定参数' : newBindingCount > 0 ? `新增 ${newBindingCount} 条绑定` : '选择可新增线路'}</button>
      </form>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中可用线路"
        hint="只删除模型与线路的绑定，不删除模型或中转站线路本身。"
        confirmText="删除绑定"
        actionName="删除模型可用线路"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/model-route-bindings/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
    </div>
  )
}

function GatewayStrategyActions(props: {
  disabled: boolean
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [failoverEnabled, setFailoverEnabled] = useState(true)
  return (
    <div className="admin-action-grid">
      <section className="admin-action-form">
        <h3>当前调度能力</h3>
        <div className="admin-strategy-list">
          <div><span>线路顺序</span><strong>按模型可用线路的 priority 从小到大选择</strong></div>
          <div><span>同级分流</span><strong>同一优先级按 weight 权重轮转</strong></div>
          <div><span>失败冷却</span><strong>失败线路自动 cooldown，冷却期跳过</strong></div>
          <div><span>等待秒数</span><strong>每条绑定可单独设置 timeoutSeconds</strong></div>
        </div>
      </section>
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('更新线路策略', async () => {
            await adminPatch('/api/admin/gateway-strategy', props.token, { failoverEnabled })
          })
        }}
      >
        <h3>故障切换</h3>
        <label className="admin-checkbox-row">
          <input type="checkbox" checked={failoverEnabled} onChange={(event) => setFailoverEnabled(event.target.checked)} disabled={props.disabled} />
          <span>线路失败时切换到其它可用线路</span>
        </label>
        <p className="admin-form-hint">更细的策略已经分布在“模型可用线路”里：线路顺序、分流比例和等待秒数。后续如要做健康探测、成本优先、成功率优先，可以在这里继续扩展。</p>
        <button type="submit" disabled={props.disabled}>保存策略</button>
      </form>
    </div>
  )
}

function OfficialTemplateActions(props: {
  disabled: boolean
  selectedId: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  if (!props.selectedRecord) {
    return (
      <section className="admin-action-form admin-action-form-wide">
        <h3>前台官方模板</h3>
        <p className="admin-empty">左侧列表现在显示前台真实使用的官方模板库。选择一条模板后，可在这里核对图片、标题、提示词和来源信息。</p>
      </section>
    )
  }

  const previewUrl = getTemplatePreviewUrl(props.selectedRecord)
  return (
    <div className="admin-action-grid">
      <section className="admin-action-form admin-action-form-wide">
        <h3>前台官方模板详情</h3>
        {previewUrl ? (
          <div className="admin-template-action-preview">
            <img src={previewUrl} alt="" />
          </div>
        ) : null}
        <div className="admin-strategy-list">
          <div><span>标题</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'title'))}</strong></div>
          <div><span>分类</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'category'))}</strong></div>
          <div><span>图片</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'imagePath'))}</strong></div>
          <div><span>来源</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'sourceName') ?? getValueByPath(props.selectedRecord, 'sourceUrl'))}</strong></div>
        </div>
        <label>
          <span>提示词</span>
          <textarea className="admin-textarea-tall" value={String(getValueByPath(props.selectedRecord, 'prompt') ?? '')} readOnly />
        </label>
        <p className="admin-form-hint">这批模板来自前台静态官方模板库。删除会从后台官方列表隐藏这条模板，不会物理删除源码里的模板定义。</p>
      </section>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中官方模板"
        hint="删除后这条官方模板会从后台官方模板列表隐藏；前台静态模板源文件不会被物理改写。"
        confirmText="删除官方模板"
        actionName="删除官方模板"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/content/official-templates/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
    </div>
  )
}

function TemplateActions(props: {
  disabled: boolean
  selectedId: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [prompt, setPrompt] = useState('')
  const [tags, setTags] = useState('')
  const [imagePath, setImagePath] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [status, setStatus] = useState('published')
  const [reviewNote, setReviewNote] = useState('')

  useEffect(() => {
    if (!props.selectedId || !props.selectedRecord) {
      setTemplateId('')
      setTitle('')
      setCategory('')
      setPrompt('')
      setTags('')
      setImagePath('')
      setSourceUrl('')
      setStatus('published')
      setReviewNote('')
      return
    }
    setTemplateId(String(getValueByPath(props.selectedRecord, 'id') ?? ''))
    setTitle(String(getValueByPath(props.selectedRecord, 'title') ?? ''))
    setCategory(String(getValueByPath(props.selectedRecord, 'category') ?? ''))
    setPrompt(String(getValueByPath(props.selectedRecord, 'prompt') ?? ''))
    const rawTags = getValueByPath(props.selectedRecord, 'tags')
    setTags(Array.isArray(rawTags) ? rawTags.map(String).join('，') : String(rawTags ?? ''))
    setImagePath(String(getValueByPath(props.selectedRecord, 'imagePath') ?? ''))
    setSourceUrl(String(getValueByPath(props.selectedRecord, 'sourceUrl') ?? ''))
    setStatus(String(getValueByPath(props.selectedRecord, 'status') ?? 'published'))
    setReviewNote(String(getValueByPath(props.selectedRecord, 'reviewNote') ?? ''))
  }, [props.selectedId, props.selectedRecord])

  const buildPayload = () => ({
    id: readOptionalText(templateId),
    title: title.trim(),
    category: category.trim(),
    prompt: prompt.trim(),
    tags: splitTextList(tags),
    imagePath: readOptionalText(imagePath),
    sourceUrl: readOptionalText(sourceUrl),
    status,
    reviewNote: readOptionalText(reviewNote),
  })

  return (
    <div className="admin-action-grid">
      <form
        className="admin-action-form admin-action-form-wide"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun(props.selectedId ? '更新模板' : '创建模板', async () => {
            const payload = buildPayload()
            if (props.selectedId) {
              await adminPatch(`/api/admin/content/templates/${encodeURIComponent(props.selectedId)}`, props.token, payload)
            } else {
              await adminPost('/api/admin/content/templates', props.token, payload)
            }
          })
        }}
      >
        <h3>{props.selectedId ? '更新选中模板' : '手工添加一个模板'}</h3>
        <div className="admin-form-row">
          <label>
            <span>模板编号</span>
            <input value={templateId} onChange={(event) => setTemplateId(event.target.value)} placeholder="创建时可选，不填则系统生成" disabled={props.disabled || Boolean(props.selectedId)} />
          </label>
          <label>
            <span>分类</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
          </label>
        </div>
        <label>
          <span>标题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
        </label>
        <label>
          <span>提示词</span>
          <textarea className="admin-textarea-tall" value={prompt} onChange={(event) => setPrompt(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
        </label>
        <div className="admin-form-row">
          <label>
            <span>标签</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" disabled={props.disabled} />
          </label>
          <label>
            <span>状态</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={props.disabled}>
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="archived">已归档</option>
            </select>
          </label>
        </div>
        <div className="admin-form-row">
          <label>
            <span>本地图片路径</span>
            <input value={imagePath} onChange={(event) => setImagePath(event.target.value)} placeholder="/prompt-template-assets/..." disabled={props.disabled} />
          </label>
          <label>
            <span>来源 URL</span>
            <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} disabled={props.disabled} />
          </label>
        </div>
        <label>
          <span>审核备注</span>
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} disabled={props.disabled} />
        </label>
        <button type="submit" disabled={props.disabled}>{props.selectedId ? '更新模板' : '保存这个模板'}</button>
      </form>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中模板"
        hint="删除后前台模板库不再显示这条模板；候选审核记录会保留，但不再关联该模板。"
        confirmText="删除模板"
        actionName="删除模板"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/content/templates/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
    </div>
  )
}

function DeleteRecordAction(props: {
  disabled: boolean
  selectedId: string
  label: string
  hint: string
  confirmText: string
  actionName: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
  onDelete: () => Promise<unknown>
}) {
  const [confirmText, setConfirmText] = useState('')
  const disabled = props.disabled || !props.selectedId || confirmText.trim() !== props.confirmText
  return (
    <form
      className="admin-action-form admin-action-form-danger"
      onSubmit={(event) => {
        event.preventDefault()
        void props.onRun(props.actionName, async () => {
          await props.onDelete()
          setConfirmText('')
        })
      }}
    >
      <h3>{props.label}</h3>
      <p className="admin-empty">{props.selectedId ? props.hint : '先在左侧列表选择一条记录。'}</p>
      <label>
        <span>确认文本</span>
        <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder={props.confirmText} disabled={props.disabled || !props.selectedId} />
      </label>
      <button type="submit" disabled={disabled}>{props.label}</button>
    </form>
  )
}

function CandidateReviewActions(props: {
  disabled: boolean
  selectedId: string
  selectedLabel: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState('')
  const [reviewNote, setReviewNote] = useState('')

  useEffect(() => {
    setTitle('')
    setCategory('')
    setTags('')
    setReviewNote('')
  }, [props.selectedId])

  const disabled = props.disabled || !props.selectedId
  return (
    <div className="admin-action-grid">
      <CandidateReviewPreview selectedRecord={props.selectedRecord} />
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('通过候选', async () => {
            await adminPost(`/api/admin/content/template-candidates/${encodeURIComponent(props.selectedId)}/approve`, props.token, {
              title: readOptionalText(title),
              category: readOptionalText(category),
              tags: splitTextList(tags),
              reviewNote: readOptionalText(reviewNote),
            })
          })
        }}
      >
        <h3>通过为模板</h3>
        <label>
          <span>标题修正</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={disabled} />
        </label>
        <label>
          <span>分类修正</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} disabled={disabled} />
        </label>
        <label>
          <span>标签</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" disabled={disabled} />
        </label>
        <label>
          <span>审核备注</span>
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} disabled={disabled} />
        </label>
        <button type="submit" disabled={disabled}>通过候选</button>
      </form>
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('拒绝候选', async () => {
            await adminPost(`/api/admin/content/template-candidates/${encodeURIComponent(props.selectedId)}/reject`, props.token, {
              reviewNote: readOptionalText(reviewNote),
            })
          })
        }}
      >
        <h3>拒绝候选</h3>
        <p className="admin-empty">{props.selectedId ? `将拒绝：${props.selectedLabel || props.selectedId}` : '先在左侧候选列表选择一条记录。'}</p>
        <button type="submit" disabled={disabled}>拒绝候选</button>
      </form>
    </div>
  )
}

function CandidateReviewPreview(props: { selectedRecord: Record<string, unknown> | null }) {
  const previewUrls = props.selectedRecord ? getTemplatePreviewUrls(props.selectedRecord) : []
  const previewKey = previewUrls.join('\n')
  const [previewIndex, setPreviewIndex] = useState(0)

  useEffect(() => {
    setPreviewIndex(0)
  }, [previewKey])

  if (!props.selectedRecord) {
    return (
      <section className="admin-action-form admin-action-form-wide">
        <h3>候选预览</h3>
        <p className="admin-empty">先在左侧候选列表选择一条记录，再查看图片、标题、分类和来源。</p>
      </section>
    )
  }

  const title = getValueByPath(props.selectedRecord, 'title')
  const category = getValueByPath(props.selectedRecord, 'category')
  const sourceUrl = getValueByPath(props.selectedRecord, 'sourceUrl')
  const previewUrl = previewUrls[previewIndex] ?? null
  const hasUsablePreview = Boolean(previewUrl)

  return (
    <section className="admin-action-form admin-action-form-wide">
      <h3>候选预览</h3>
      {hasUsablePreview ? (
        <div className="admin-template-action-preview admin-template-review-preview">
          <img src={previewUrl} alt={typeof title === 'string' ? title : '候选图片预览'} onError={() => setPreviewIndex((index) => index + 1)} />
        </div>
      ) : (
        <p className="admin-template-review-missing">{previewUrls.length ? '图片加载失败，请核对本地图片或来源链接。' : '这条候选没有可预览图片。'}</p>
      )}
      <div className="admin-strategy-list">
        <div><span>标题</span><strong>{formatAdminValue(title)}</strong></div>
        <div><span>分类</span><strong>{formatAdminValue(category)}</strong></div>
        <div><span>来源</span><strong><AdminValue fieldKey="sourceUrl" value={sourceUrl} /></strong></div>
      </div>
    </section>
  )
}

function TemplateImportActions(props: {
  disabled: boolean
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [sourceUrl, setSourceUrl] = useState('')
  return (
    <form
      className="admin-action-form admin-action-form-wide"
      onSubmit={(event) => {
        event.preventDefault()
        void props.onRun('导入模板候选', async () => {
          await adminPost('/api/admin/content/template-import-runs', props.token, {
            sourceUrl: sourceUrl.trim(),
          })
        })
      }}
    >
      <h3>导入候选</h3>
      <p className="admin-empty">粘贴一个网址或 GitHub 仓库链接。系统会筛掉太弱的内容，并把图片转成本地文件；人工通过后才发布。</p>
      <label>
        <span>来源链接</span>
        <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} required disabled={props.disabled} />
      </label>
      <button type="submit" disabled={props.disabled}>开始导入</button>
    </form>
  )
}

function AdminDataModule(props: { section: Exclude<AdminSectionKey, 'dashboard'>; token: string }) {
  const [userSubsection, setUserSubsection] = useState<UserSubsectionKey>('users')
  const [rechargeSubsection, setRechargeSubsection] = useState<RechargeSubsectionKey>('codes')
  const [gatewaySubsection, setGatewaySubsection] = useState<GatewaySubsectionKey>('routes')
  const [growthSubsection, setGrowthSubsection] = useState<GrowthSubsectionKey>('referrals')
  const [contentSubsection, setContentSubsection] = useState<ContentSubsectionKey>('candidates')
  const config = props.section === 'content'
    ? CONTENT_MODULES[contentSubsection]
    : props.section === 'users'
      ? USER_MODULES[userSubsection]
      : props.section === 'rechargeCodes'
      ? RECHARGE_MODULES[rechargeSubsection]
      : props.section === 'gateway'
        ? GATEWAY_MODULES[gatewaySubsection]
        : props.section === 'growth'
          ? GROWTH_MODULES[growthSubsection]
          : ADMIN_MODULES[props.section]
  const filterScope = props.section === 'content'
    ? contentSubsection
    : props.section === 'users'
      ? userSubsection
      : props.section === 'rechargeCodes'
      ? rechargeSubsection
      : props.section === 'gateway'
        ? gatewaySubsection
        : props.section === 'growth'
          ? growthSubsection
          : props.section
  const filterFields = ADMIN_FILTERS[filterScope] ?? []
  const isOfficialTemplateView = props.section === 'content' && contentSubsection === 'templates'
  const isContentModule = props.section === 'content'
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [pageLimit, setPageLimit] = useState(25)
  const [pageOffset, setPageOffset] = useState(0)
  const [summary, setSummary] = useState<unknown>(null)
  const [listPayload, setListPayload] = useState<unknown>(null)
  const [detail, setDetail] = useState<unknown>(null)
  const [selectedId, setSelectedId] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const rows = useMemo(() => getListRows(listPayload, config.listKey), [config.listKey, listPayload])
  const pagination = useMemo(() => getPagination(listPayload), [listPayload])
  const listPath = useMemo(() => buildPath(config.listPath, pageLimit, pageOffset, filters), [config.listPath, filters, pageLimit, pageOffset])
  const workflow = useMemo(() => getModuleWorkflow(config, props.section), [config, props.section])
  const shareAuditSummaryCards = useMemo(() => props.section === 'shares' ? getShareAuditSummaryCards(summary) : [], [props.section, summary])
  const inspirationSummaryCards = useMemo(() => props.section === 'inspiration' ? getInspirationSummaryCards(summary) : [], [props.section, summary])

  const loadDetail = useCallback(async (id: string) => {
    if (!id || !config.detailBasePath) return
    setSelectedId(id)
    setDetailLoading(true)
    setDetail(null)
    setError('')
    try {
      setDetail(await adminGet(`${config.detailBasePath}/${encodeURIComponent(id)}`, props.token))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setDetailLoading(false)
    }
  }, [config.detailBasePath, props.token])

  const loadOfficialTemplateData = useCallback(async (keepSelectedId = '') => {
    const overrides = await adminGet('/api/admin/content/official-template-overrides', props.token)
    const hiddenIds = getHiddenOfficialTemplateIds(overrides)
    const payload = getOfficialTemplateAdminPayload(pageLimit, pageOffset, filters, hiddenIds)
    setSummary({
      ok: true,
      total: payload.pagination.total,
      published: payload.pagination.total,
      source: 'frontend-prompt-library',
    })
    setListPayload(payload)
    if (keepSelectedId) {
      const nextRecord = payload.templates.find((row) => String(row.id) === keepSelectedId) ?? null
      if (nextRecord) {
        setSelectedRecord(nextRecord)
        setDetail({ template: nextRecord })
        setSelectedLabel(getRecordReadableLabel(nextRecord, config))
      } else {
        setSelectedId('')
        setSelectedLabel('')
        setSelectedRecord(null)
        setDetail(null)
      }
    }
  }, [config, filters, pageLimit, pageOffset, props.token])

  const loadModuleData = useCallback(async (options?: { keepSelectedId?: string }) => {
    setLoading(true)
    setError('')
    const keepSelectedId = options?.keepSelectedId ?? ''
    if (!keepSelectedId) {
      setSelectedId('')
      setSelectedLabel('')
      setSelectedRecord(null)
      setDetail(null)
    }
    try {
      if (isOfficialTemplateView) {
        await loadOfficialTemplateData(keepSelectedId)
        return
      }
      const summaryPayload = config.summaryPath ? await adminGet(config.summaryPath, props.token) : null
      const list = await adminGet(listPath, props.token)
      setSummary(summaryPayload)
      setListPayload(list)
      let shouldLoadDetail = Boolean(keepSelectedId && config.detailBasePath)
      if (keepSelectedId) {
        const nextRows = getListRows(list, config.listKey)
        const nextRecord = nextRows.find((row) => String(getValueByPath(row, config.detailIdKey) ?? '') === keepSelectedId) ?? null
        if (nextRecord) {
          setSelectedRecord(nextRecord)
          setSelectedLabel(getRecordReadableLabel(nextRecord, config))
        } else {
          setSelectedId('')
          setSelectedLabel('')
          setSelectedRecord(null)
          setDetail(null)
          shouldLoadDetail = false
        }
      }
      if (shouldLoadDetail) {
        await loadDetail(keepSelectedId)
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [config.detailBasePath, config.listKey, config.summaryPath, isOfficialTemplateView, listPath, loadDetail, loadOfficialTemplateData, props.token])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSelectedId('')
    setSelectedLabel('')
    setSelectedRecord(null)
    setDetail(null)
    const load = async () => {
      try {
        if (isOfficialTemplateView) {
          const overrides = await adminGet('/api/admin/content/official-template-overrides', props.token)
          const hiddenIds = getHiddenOfficialTemplateIds(overrides)
          const payload = getOfficialTemplateAdminPayload(pageLimit, pageOffset, filters, hiddenIds)
          if (cancelled) return
          setSummary({
            ok: true,
            total: payload.pagination.total,
            published: payload.pagination.total,
            source: 'frontend-prompt-library',
          })
          setListPayload(payload)
          return
        }
        const summaryPayload = config.summaryPath ? await adminGet(config.summaryPath, props.token) : null
        const list = await adminGet(listPath, props.token)
        if (cancelled) return
        setSummary(summaryPayload)
        setListPayload(list)
      } catch (requestError) {
        if (!cancelled) setError(getErrorMessage(requestError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [config.summaryPath, filters, isOfficialTemplateView, listPath, pageLimit, pageOffset, props.token])

  useEffect(() => {
    setFilters(getDefaultFiltersForScope(filterScope))
    setPageOffset(0)
    setPageLimit(25)
  }, [filterScope])

  const openDetail = async (row: Record<string, unknown>) => {
    const rawId = getValueByPath(row, config.detailIdKey)
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
    if (!id) return
    setSelectedRecord(row)
    setSelectedLabel(getRecordReadableLabel(row, config))
    if (!config.detailBasePath) {
      setSelectedId(id)
      setDetail(row)
      return
    }
    if (isOfficialTemplateView) {
      setSelectedId(id)
      setDetail({ template: row })
      return
    }
    await loadDetail(id)
  }

  const openRelatedDetail = async (path: string) => {
    setDetailLoading(true)
    setError('')
    try {
      setDetail(await adminGet(path, props.token))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setDetailLoading(false)
    }
  }

  const resetSubsectionState = () => {
    setFilters({})
    setPageOffset(0)
    setPageLimit(25)
    setSelectedId('')
    setSelectedLabel('')
    setSelectedRecord(null)
    setDetail(null)
    setError('')
  }

  const switchSubsection = <T extends string>(current: T, next: T, setNext: (value: T) => void) => {
    if (current === next) return
    resetSubsectionState()
    setNext(next)
  }

  const handleActionComplete = async (actionName?: string) => {
    if (actionName?.startsWith('删除')) {
      await loadModuleData()
      return
    }
    await loadModuleData({ keepSelectedId: selectedId })
  }

  return (
    <section className="admin-section" aria-label={config.title}>
      <div className="admin-section-head">
        <div>
          <span className="admin-kicker">{ADMIN_SECTIONS.find((item) => item.key === props.section)?.meta}</span>
          <h1>{config.title}</h1>
        </div>
        <p>{loading ? '正在加载数据...' : error || config.description}</p>
      </div>

      <div className="admin-workflow-strip" aria-label="操作路径">
        {workflow.map((item, index) => (
          <div key={item} className={index === 0 ? 'is-primary' : ''}>
            <span>{index + 1}</span>
            <strong>{item}</strong>
          </div>
        ))}
      </div>

      {props.section === 'inspiration' ? (
        <div className="admin-tabs" aria-label="灵感广场队列">
          {[
            { label: '全部帖子', values: {} as Record<string, string> },
            { label: 'AI 推荐精选', values: { queue: 'featured_candidates' } },
            { label: '待复核', values: { queue: 'needs_review' } },
            { label: '自动隐藏', values: { queue: 'auto_hidden' } },
            { label: '最新展示', values: { queue: 'latest' } },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              className={(filters.queue || '') === (item.values.queue ?? '') ? 'is-active' : ''}
              onClick={() => {
                setFilters({ ...item.values })
                setPageOffset(0)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.section === 'users' ? (
        <div className="admin-tabs" aria-label="用户与余额子模块">
          {USER_SUBSECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={userSubsection === item.key ? 'is-active' : ''}
              onClick={() => switchSubsection(userSubsection, item.key, setUserSubsection)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.section === 'content' ? (
        <div className="admin-tabs" aria-label="内容配置子模块">
          {CONTENT_SUBSECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={contentSubsection === item.key ? 'is-active' : ''}
              onClick={() => switchSubsection(contentSubsection, item.key, setContentSubsection)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.section === 'rechargeCodes' ? (
        <div className="admin-tabs" aria-label="充值码子模块">
          {RECHARGE_SUBSECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={rechargeSubsection === item.key ? 'is-active' : ''}
              onClick={() => switchSubsection(rechargeSubsection, item.key, setRechargeSubsection)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.section === 'gateway' ? (
        <div className="admin-tabs" aria-label="网关子模块">
          {GATEWAY_SUBSECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={gatewaySubsection === item.key ? 'is-active' : ''}
              onClick={() => switchSubsection(gatewaySubsection, item.key, setGatewaySubsection)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {props.section === 'growth' ? (
        <div className="admin-tabs" aria-label="增长子模块">
          {GROWTH_SUBSECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={growthSubsection === item.key ? 'is-active' : ''}
              onClick={() => switchSubsection(growthSubsection, item.key, setGrowthSubsection)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className={isContentModule ? 'admin-data-layout admin-content-data-layout' : 'admin-data-layout'}>
        <div className="admin-workspace-column">
          <form
            key={filterScope}
            className="admin-panel admin-filter-panel"
            onSubmit={(event) => {
              event.preventDefault()
              setFilters({ ...getDefaultFiltersForScope(filterScope), ...getFilterValues(filterFields, event.currentTarget) })
              setPageOffset(0)
            }}
          >
            <div className="admin-panel-head">
              <h2>{getFilterTitle(config, props.section)}</h2>
              <span>{getFilterHint(config, props.section, filterFields.length)}</span>
            </div>
            <div className="admin-filter-grid">
              {filterFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  {field.type === 'select' ? (
                    <select name={field.key} defaultValue={filters[field.key] ?? field.defaultValue ?? ''}>
                      {field.hideAllOption ? null : <option value="">全部</option>}
                      {field.options?.map((option) => <option key={option} value={option}>{getSelectOptionLabel(option)}</option>)}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input name={field.key} type="checkbox" defaultChecked={filters[field.key] === 'true'} />
                  ) : (
                    <input name={field.key} type={field.type === 'date' ? 'date' : 'text'} placeholder={field.placeholder} defaultValue={filters[field.key] ?? ''} />
                  )}
                </label>
              ))}
              <label>
                <span>每页</span>
                <select value={pageLimit} onChange={(event) => {
                  setPageLimit(Number(event.target.value))
                  setPageOffset(0)
                }}>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
            </div>
            <div className="admin-filter-actions">
              <button type="submit">应用筛选</button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.form?.reset()
                  setFilters(getDefaultFiltersForScope(filterScope))
                  setPageOffset(0)
                }}
              >
                清空
              </button>
            </div>
          </form>

          {(props.section === 'shares' || props.section === 'inspiration') && (shareAuditSummaryCards.length || inspirationSummaryCards.length) ? (
            <section className="admin-panel admin-audit-overview-panel" aria-label={props.section === 'inspiration' ? '灵感广场概况' : '分享审计概况'}>
              <div className="admin-panel-head">
                <h2>{props.section === 'inspiration' ? '运营概况' : '审计概况'}</h2>
                <span>只看当前筛选结果</span>
              </div>
              <div className="admin-audit-overview-grid">
                {(props.section === 'inspiration' ? inspirationSummaryCards : shareAuditSummaryCards).map((item) => (
                  <article key={item.label} className="admin-audit-overview-card">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.note ? <small>{item.note}</small> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="admin-panel admin-data-panel">
            <div className="admin-panel-head">
              <h2>{getListTitle(config, props.section)}</h2>
              <span>{pagination.total ? `${pagination.offset + 1}-${Math.min(pagination.offset + pagination.limit, pagination.total)} / ${pagination.total}` : `${rows.length} 条`}</span>
            </div>
            <div className="admin-table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    {config.columns.map((column) => <th key={column.key} data-field={column.key}>{column.label}</th>)}
                    {isContentModule ? null : <th data-field="detail">详情</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const rowId = formatCellValue(getValueByPath(row, config.detailIdKey))
                    return (
                      <tr
                        key={`${rowId}-${index}`}
                        className={selectedId === rowId ? 'is-selected' : ''}
                        onClick={() => void openDetail(row)}
                      >
                          {config.columns.map((column) => (
                            <td key={column.key} data-field={column.key}>
                              <AdminTableCell row={row} column={column} />
                            </td>
                          ))}
                        {isContentModule ? null : (
                          <td data-field="detail">
                            <button
                              type="button"
                              className="admin-link-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                void openDetail(row)
                              }}
                            >
                              选择
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!rows.length ? <p className="admin-empty">{loading ? '加载中...' : '暂无数据。'}</p> : null}
            </div>
            <div className="admin-pagination">
              <button type="button" disabled={loading || pageOffset <= 0} onClick={() => setPageOffset(Math.max(0, pageOffset - pageLimit))}>上一页</button>
              <span>第 {Math.floor(pagination.offset / Math.max(1, pagination.limit)) + 1} 页</span>
              <button type="button" disabled={loading || pagination.offset + pagination.limit >= pagination.total} onClick={() => setPageOffset(pageOffset + pageLimit)}>下一页</button>
            </div>
          </section>
        </div>

        <aside className="admin-side-column">
          <AdminActionPanel
            section={props.section}
            contentSubsection={props.section === 'content' ? contentSubsection : undefined}
            rechargeSubsection={props.section === 'rechargeCodes' ? rechargeSubsection : undefined}
            userSubsection={props.section === 'users' ? userSubsection : undefined}
            gatewaySubsection={props.section === 'gateway' ? gatewaySubsection : undefined}
            token={props.token}
            selectedId={selectedId}
            selectedLabel={selectedLabel}
            selectedRecord={selectedRecord}
            onActionComplete={handleActionComplete}
          />

          <section className={isContentModule ? 'admin-detail-panel admin-content-detail-panel' : 'admin-panel admin-detail-panel'}>
            <div className="admin-panel-head">
              <h2>记录详情</h2>
              <span>{detailLoading ? '加载中' : selectedLabel || selectedId || '未选择'}</span>
            </div>
            {props.section === 'users' && userSubsection === 'users' && selectedId ? (
              <div className="admin-detail-actions">
                <button type="button" onClick={() => void openRelatedDetail(`/api/admin/users/${encodeURIComponent(selectedId)}/ledger?limit=25&offset=0`)}>
                  用户流水
                </button>
                <button type="button" onClick={() => void openRelatedDetail(`/api/admin/users/${encodeURIComponent(selectedId)}/referrals?limit=25&offset=0`)}>
                  邀请关系
                </button>
                <button type="button" onClick={() => void loadDetail(selectedId)}>
                  基础详情
                </button>
              </div>
            ) : null}
            {props.section === 'inspiration' && selectedId ? (
              <div className="admin-detail-actions">
                <button type="button" onClick={() => void loadDetail(selectedId)}>
                  刷新帖子详情
                </button>
                <button type="button" onClick={() => {
                  setFilters({ queue: 'latest' })
                  setPageOffset(0)
                }}>
                  查看最新展示
                </button>
                <button type="button" onClick={() => {
                  setFilters({ queue: 'needs_review' })
                  setPageOffset(0)
                }}>
                  查看待复核
                </button>
              </div>
            ) : null}
            {props.section === 'inspiration' && isRecord(detail) ? (
              <AdminInspirationDetailView detail={detail} selectedId={selectedLabel || selectedId} />
            ) : (
              <AdminDetailView
                detail={detail}
                selectedId={selectedLabel || selectedId}
                detailLoading={detailLoading}
                contentSubsection={props.section === 'content' ? contentSubsection : undefined}
              />
            )}
          </section>

          <section className="admin-panel admin-summary-panel">
            <div className="admin-panel-head">
              <h2>模块摘要</h2>
              <span>{config.summaryPath ? '不作为主要操作入口' : '当前模块暂无摘要'}</span>
            </div>
            <AdminSummaryView
              summary={summary}
              fallback="当前模块暂无更多摘要。"
            />
          </section>
        </aside>
      </div>
    </section>
  )
}

export default function AdminApp() {
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || '')
  const [admin, setAdmin] = useState<AdminProfile | null>(null)
  const [activeSection, setActiveSection] = useState<AdminSectionKey>('dashboard')
  const [dashboard, setDashboard] = useState<AdminDashboardPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false
    setLoading(true)
    const loadSession = async () => {
      try {
        const adminProfile = await getCurrentAdmin(sessionToken)
        const dashboardPayload = await getAdminDashboard(sessionToken)
        if (cancelled) return
        setAdmin(adminProfile)
        setDashboard(dashboardPayload)
        setError('')
      } catch (requestError) {
        if (cancelled) return
        setError(getErrorMessage(requestError))
        setAdmin(null)
        setSessionToken('')
        localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadSession()
    return () => {
      cancelled = true
    }
  }, [sessionToken])

  const handleLogin = (token: string, adminProfile: AdminProfile) => {
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token)
    setSessionToken(token)
    setAdmin(adminProfile)
  }

  const handleLogout = () => {
    const token = sessionToken
    setSessionToken('')
    setAdmin(null)
    setDashboard(null)
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
    void logoutAdmin(token).catch(() => undefined)
  }

  if (!sessionToken || !admin) {
    return <AdminLoginView onLogin={handleLogin} />
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar" aria-label="后台导航">
        <div className="admin-brand">
          <span className="admin-logo" aria-hidden="true" />
          <div>
            <strong>平台后台</strong>
            <small>{admin.displayName || admin.email}</small>
          </div>
        </div>
        <nav className="admin-nav">
          {ADMIN_SECTIONS.map((section) => (
            <button
              key={section.key}
              type="button"
              className={activeSection === section.key ? 'is-active' : ''}
              onClick={() => setActiveSection(section.key)}
            >
              <span>{section.label}</span>
              <small>{section.meta}</small>
            </button>
          ))}
        </nav>
        <button type="button" className="admin-logout" onClick={handleLogout}>退出后台</button>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span>当前管理员</span>
          <strong>{admin.email}</strong>
        </header>
        {activeSection === 'dashboard' ? (
          <AdminDashboard dashboard={dashboard} loading={loading} error={error} onNavigate={setActiveSection} />
        ) : (
          <AdminDataModule section={activeSection} token={sessionToken} />
        )}
      </div>
    </main>
  )
}
