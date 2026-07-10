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
import {
  buildTemplateApprovalSuccessMessage,
  getImportRunVisibilityNotice,
  getTemplateApprovalTips,
  type TemplateVisibilityNoticeTone,
} from '../lib/adminTemplateVisibility'
import {
  formatPreflightStatusLabel,
  formatProbeAdmissionLabel,
  getPreflightStatusTone,
  getProbeAdmissionTone,
} from '../lib/gatewayRouteAdmission'
import { GPT_IMAGE_2_SUPPORTED_SIZES } from '../lib/modelSkus'
import {
  PROMPT_LIBRARY_CATEGORIES,
  PROMPT_LIBRARY_TEMPLATES,
  ensureSearchablePromptTemplate,
  mergeOfficialPromptTemplates,
  type PromptTemplateSearchableItem,
} from '../lib/promptLibrary'
import { fetchPublicPromptTemplates } from '../lib/promptTemplateApi'
import type {
  GatewayRoutePreflightResult,
  GatewayRoutePreflightSummary,
  GatewayRouteProbeBatchSummary,
  GatewayRouteProbeResult,
} from '../types'
import { CopyIcon } from './icons'

type AdminSectionKey =
  | 'dashboard'
  | 'users'
  | 'billingLedger'
  | 'rechargeCodes'
  | 'modelSkus'
  | 'tasks'
  | 'agentWorkflow'
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

type AdminQuickFilter = {
  label: string
  values: Record<string, string>
}

type AdminRecentViewEntry = {
  section: Exclude<AdminSectionKey, 'dashboard'>
  scope: string
  sectionLabel: string
  subsectionLabel: string
  filters: Record<string, string>
  updatedAt: string
}

const ADMIN_SESSION_STORAGE_KEY = 'sst-admin-session-token'
const ADMIN_FILTER_MEMORY_STORAGE_KEY = 'sst-admin-filter-memory'
const ADMIN_RECENT_VIEWS_STORAGE_KEY = 'sst-admin-recent-views'
const ADMIN_ACTIVE_SECTION_STORAGE_KEY = 'sst-admin-active-section'
const PROMPT_LIBRARY_CATEGORY_FILTER_OPTIONS = PROMPT_LIBRARY_CATEGORIES.filter((category) => category !== '全部')
const ADMIN_PRIMARY_FILTER_KEYS: Partial<Record<string, string[]>> = {
  users: ['email', 'status'],
  tasks: ['status', 'user'],
  inspiration: ['queue', 'status', 'category', 'user'],
  shares: ['status', 'user'],
  agentWorkflow: ['status', 'projectStatus', 'attention', 'user', 'search'],
}
const ADMIN_ADVANCED_FILTER_SUMMARY: Partial<Record<string, string>> = {
  users: '邮箱验证、充值与生成行为',
  tasks: '模型、线路、失败类型与扣点',
  agentWorkflow: '来源、失败类型、任务编号与时间',
  inspiration: 'AI 展示判断、审核结论与发布快照',
  shares: 'Token、记录编号、访问码与时间',
}
const TASK_FAILURE_KIND_OPTIONS = [
  'no_route',
  'route_exhausted',
  'upstream_timeout',
  'upstream_rate_limited',
  'upstream_server_error',
  'upstream_async_queued',
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
  canceled: '已取消',
  confirmed_not_started: '已确认未启动',
  running_stale: '运行超时',
  succeeded_without_recipe: '成功未沉淀',
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
  upstream_async_queued: '异步任务缺轮询',
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
  completed: '已完成',
  confirmed: '已确认',
  reference_image: '参考图',
  recipe: '配方',
  rerun: '重试',
  text: '文本',
  hero_featured: '主视觉精选',
  secondary_featured: '次级精选',
  latest_grid: '最新列表',
}

const READABLE_FIELD_KEYS: Record<string, string[]> = {
  userId: ['userLabel', 'userEmail', 'userDisplayName', 'email', 'displayName'],
  userLabel: ['userEmail', 'userDisplayName', 'email', 'displayName'],
  adminUserId: ['adminLabel', 'adminEmail', 'adminDisplayName'],
  createdByAdminId: ['createdByAdminLabel', 'createdByAdminEmail', 'createdByAdminDisplayName', 'adminEmail', 'adminDisplayName'],
  redeemedByUserId: ['redeemedByUserLabel', 'redeemedByUserEmail', 'redeemedByUserDisplayName'],
  redeemedByUserLabel: ['redeemedByUserLabel', 'redeemedByUserEmail', 'redeemedByUserDisplayName'],
  inviterUserId: ['inviterUserEmail', 'inviterUserDisplayName', 'inviterEmail', 'inviterDisplayName'],
  inviteeUserId: ['inviteeUserEmail', 'inviteeUserDisplayName', 'inviteeEmail', 'inviteeDisplayName'],
  targetId: ['targetLabel', 'targetName', 'targetEmail', 'taskLabel'],
  relatedId: ['relatedLabel', 'relatedName', 'codePreview', 'batchNo', 'taskLabel'],
  codeId: ['codePreview'],
  ledgerId: ['ledgerLabel'],
  taskId: ['taskLabel'],
  generationTaskId: ['taskLabel'],
  modelSku: ['modelLabel', 'modelDisplayName', 'displayName', 'name'],
  modelLabel: ['modelDisplayName', 'displayName', 'name'],
  routeLabel: ['routeName', 'name'],
  routeId: ['routeLabel', 'routeName', 'name'],
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

const AGENT_INTERVENTION_OPTIONS = [
  { value: 'needs_operator', label: '转人工复核' },
  { value: 'mark_reviewed', label: '标记已处理' },
  { value: 'request_recipe', label: '建议沉淀配方' },
  { value: 'ignore', label: '暂不处理' },
]

class AdminActionNotice extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminActionNotice'
  }
}

const ADMIN_SECTIONS: Array<{ key: AdminSectionKey; label: string; meta: string }> = [
  { key: 'dashboard', label: '后台首页', meta: '总览 / 待处理' },
  { key: 'users', label: '用户与余额', meta: '账号 / 点数' },
  { key: 'rechargeCodes', label: '充值码', meta: '批次 / 兑换' },
  { key: 'tasks', label: '任务与扣点', meta: '出图 / 扣点' },
  { key: 'agentWorkflow', label: 'Agent 观测', meta: 'Run / 成本 / 失败' },
  { key: 'gateway', label: '网关管理', meta: '线路 / 调度' },
  { key: 'content', label: '内容配置', meta: '模板 / 导入' },
  { key: 'inspiration', label: '灵感广场', meta: '展示 / 运营' },
  { key: 'shares', label: '分享审计', meta: '分享 / 风控' },
]

const ADMIN_HOME_ACTIONS: Array<{
  key: Exclude<AdminSectionKey, 'dashboard'>
  label: string
  title: string
  description: string
}> = [
  { key: 'rechargeCodes', label: '进入处理', title: '充值码批次管理', description: '生成新批次、导出可用兑换码，并继续追踪兑换成功和失败记录。' },
  { key: 'users', label: '进入处理', title: '用户与点数处理', description: '按邮箱或账号查用户，核对余额与流水，并处理点数调整和账号状态。' },
  { key: 'tasks', label: '进入处理', title: '任务与扣点排查', description: '查看出图任务、扣点结果和失败原因，确认该去看账务还是继续查上游线路。' },
  { key: 'agentWorkflow', label: '进入查看', title: 'Agent 运行观测', description: '查看 Agent 创作流、关联出图任务、配方沉淀和失败聚合，方便判断工作台运行质量。' },
  { key: 'content', label: '进入处理', title: '模板与候选维护', description: '维护正式模板，或从网址 / GitHub 导入候选后再做人工审核。' },
  { key: 'gateway', label: '进入处理', title: '线路与调度配置', description: '维护真实出图线路、模型和绑定规则，并继续做连通性和 2K / 4K 实测。' },
  { key: 'inspiration', label: '进入处理', title: '灵感广场运营', description: '查看 AI 初审和展示状态，处理公开信息、精选位和可见性。' },
  { key: 'shares', label: '进入查看', title: '分享记录审计', description: '查看用户分享、访问码要求、过期状态和撤销记录，方便继续风控排查。' },
]

function isAdminSectionKey(value: string): value is AdminSectionKey {
  return ADMIN_SECTIONS.some((section) => section.key === value)
}

function getStoredAdminSection(): AdminSectionKey {
  try {
    const value = window.localStorage.getItem(ADMIN_ACTIVE_SECTION_STORAGE_KEY) || ''
    return isAdminSectionKey(value) ? value : 'dashboard'
  } catch {
    return 'dashboard'
  }
}

const ADMIN_MODULES: Record<Exclude<AdminSectionKey, 'dashboard'>, AdminModuleConfig> = {
  users: {
    summaryPath: '/api/admin/users/summary',
    listPath: '/api/admin/users?limit=25&offset=0',
    listKey: 'users',
    detailBasePath: '/api/admin/users',
    detailIdKey: 'id',
    title: '用户与余额',
    description: '集中查看账号、点数、流水、任务、充值兑换和邀请关系，方便继续做用户侧处理。',
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
    description: '查看点数流水、扣点、充值兑换、补发和手动调整记录；这里处理的是平台点数，不是站内支付订单。',
    columns: [
      { key: 'type', label: '类型' },
      { key: 'amount', label: '金额' },
      { key: 'userEmail', label: '用户' },
      { key: 'relatedId', label: '关联对象' },
      { key: 'createdAt', label: '时间' },
    ],
  },
  rechargeCodes: {
    listPath: '/api/admin/recharge-codes?limit=25&offset=0',
    listKey: 'codes',
    detailBasePath: '/api/admin/recharge-codes',
    detailIdKey: 'id',
    title: '充值码',
    description: '按批次生成 30 / 100 / 300 点兑换码，导出可用码，并继续查看兑换状态或停用未使用的码。',
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
    description: '维护前台可选的生图模型。尺寸和质量主要影响前台可选项口径，不直接代表真实上游能力。',
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
    description: '查看出图任务、扣点结果和失败原因，快速判断这条任务该继续查账务、查线路还是查上游返回。',
    columns: [
      { key: 'userId', label: '用户' },
      { key: 'status', label: '状态' },
      { key: 'modelLabel', label: '模型' },
      { key: 'routeLabel', label: '线路' },
      { key: 'chargedPoints', label: '扣点' },
      { key: 'failureKind', label: '失败类型' },
      { key: 'createdAt', label: '提交时间' },
    ],
  },
  agentWorkflow: {
    summaryPath: '/api/admin/agent-runs/summary',
    listPath: '/api/admin/agent-runs?limit=25&offset=0',
    listKey: 'agentRuns',
    detailBasePath: '/api/admin/agent-runs',
    detailIdKey: 'id',
    title: 'Agent 观测',
    description: '查看 Agent 创作流、关联出图任务、配方沉淀和失败原因，判断工作台从计划到出图的真实运行质量。',
    columns: [
      { key: 'title', label: '项目' },
      { key: 'userLabel', label: '用户' },
      { key: 'status', label: 'Run 状态' },
      { key: 'projectStatus', label: '项目状态' },
      { key: 'sourceType', label: '来源' },
      { key: 'confirmedPoints', label: '确认点数' },
      { key: 'generationTaskStatus', label: '任务状态' },
      { key: 'failureKind', label: '失败类型' },
      { key: 'updatedAt', label: '更新时间' },
    ],
  },
  gateway: {
    listPath: '/api/admin/gateway-routes?limit=25&offset=0',
    listKey: 'routes',
    detailBasePath: '/api/admin/gateway-routes',
    detailIdKey: 'id',
    title: '网关管理',
    description: '维护真实出图线路接入信息。官方直连和常规中转都在这里管理，模型能走哪些线路则在“模型可用线路”里配置。',
    columns: [
      { key: 'name', label: '线路名称' },
      { key: 'isOfficial', label: '线路类型' },
      { key: 'healthStatus', label: '健康状态' },
      { key: 'enabled', label: '启用' },
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
    description: '正式模板、候选审核和导入任务都在这里统一管理；候选通过后才会进入前台模板库。',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'status', label: '状态' },
      { key: 'category', label: '分类' },
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
    description: '查看邀请关系、奖励流水、新用户启动礼包和增长相关点数记录，方便继续做运营处理。',
    columns: [
      { key: 'inviterUserId', label: '邀请人' },
      { key: 'inviteeUserId', label: '被邀请人' },
      { key: 'inviteCode', label: '邀请码' },
      { key: 'status', label: '状态' },
      { key: 'createdAt', label: '创建时间' },
    ],
  },
  inspiration: {
    summaryPath: '/api/admin/inspiration-posts/summary',
    listPath: '/api/admin/inspiration-posts?limit=25&offset=0',
    listKey: 'posts',
    detailBasePath: '/api/admin/inspiration-posts',
    detailIdKey: 'id',
    title: '灵感广场',
    description: '管理广场公开作品、AI 展示判断、公开信息修正和展示状态流转，统一处理广场运营。',
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
  shares: {
    summaryPath: '/api/admin/image-shares/summary',
    listPath: '/api/admin/image-shares?limit=25&offset=0',
    listKey: 'shares',
    detailBasePath: '/api/admin/image-shares',
    detailIdKey: 'id',
    title: '分享审计',
    description: '只读查看用户创建的图片分享、访问码要求、过期状态和撤销记录，方便继续风控排查。',
    columns: [
      { key: 'userId', label: '用户' },
      { key: 'status', label: '状态' },
      { key: 'reviewStatus', label: '审核' },
      { key: 'taskId', label: '任务' },
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
    description: '查看管理员操作、目标、原因和变更前后快照，用于后台追责和操作回溯。',
    columns: [
      { key: 'adminUserId', label: '管理员' },
      { key: 'action', label: '动作' },
      { key: 'targetType', label: '目标类型' },
      { key: 'reason', label: '原因' },
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
    description: '查看充值码兑换成功和失败记录，确认哪些码已被使用、哪些码因状态或条件不能再次兑换。',
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
    description: '给一个生图模型配置可用线路。一个模型可以挂多条线路做主备、分流和故障切换。',
    columns: [
      { key: 'modelDisplayName', label: '模型' },
      { key: 'routeName', label: '线路' },
      { key: 'healthState', label: '自愈状态' },
      { key: 'score', label: '信用分' },
      { key: 'nextProbeAt', label: '下次探测' },
      { key: 'enabled', label: '启用' },
      { key: 'priority', label: '线路顺序' },
      { key: 'weight', label: '分流比例' },
    ],
  },
  strategy: {
    listPath: '/api/admin/gateway-strategy',
    listKey: 'strategies',
    detailIdKey: 'id',
    title: '线路策略',
    description: '查看并调整后台可见的基础线路策略；更细的真实调度逻辑仍由后端执行。',
    columns: [
      { key: 'id', label: '项目' },
      { key: 'failoverEnabled', label: '故障切换' },
      { key: 'budgetWindowHours', label: '预算窗口(小时)' },
      { key: 'maxProbesPerRouteWindow', label: '单线窗口上限' },
      { key: 'maxProbesPerTrigger', label: '单次触发上限' },
      { key: 'observingSuccessThreshold', label: '恢复成功阈值' },
      { key: 'observingProbeDelayMinutes', label: '观察间隔(分钟)' },
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
    description: '查看邀请奖励和新用户启动礼包相关的点数流水，不包含每日免费点数等常规发放记录。',
    columns: [
      { key: 'userEmail', label: '用户' },
      { key: 'type', label: '类型' },
      { key: 'amount', label: '点数' },
      { key: 'relatedId', label: '关联对象' },
      { key: 'createdAt', label: '时间' },
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
    description: '导入后先沉淀候选，再人工确认标题、分类、图片和来源；通过后才进入正式模板库。',
    columns: [
      { key: 'title', label: '标题' },
      { key: 'status', label: '状态' },
      { key: 'category', label: '分类' },
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
    description: '输入一个网址或 GitHub 仓库链接后，系统会抓取候选、把图片转成本地资源，再交给人工审核。',
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
    { key: 'relatedId', label: '关联对象' },
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
    { key: 'name', label: '模型标识' },
    { key: 'displayName', label: '显示名称' },
    { key: 'enabled', label: '启用', type: 'select', options: ['true', 'false'] },
    { key: 'supportsEdit', label: '支持编辑', type: 'select', options: ['true', 'false'] },
    { key: 'supportsMask', label: '支持蒙版', type: 'select', options: ['true', 'false'] },
  ],
  routes: [
    { key: 'name', label: '线路名称' },
    { key: 'enabled', label: '启用', type: 'select', options: ['true', 'false'] },
  ],
  bindings: [
    { key: 'enabled', label: '启用', type: 'select', options: ['true', 'false'] },
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
  agentWorkflow: [
    { key: 'status', label: 'Run 状态', type: 'select', options: ['draft', 'planned', 'confirmed', 'running', 'succeeded', 'failed', 'canceled'] },
    { key: 'projectStatus', label: '项目状态', type: 'select', options: ['active', 'archived'] },
    { key: 'attention', label: '异常队列', type: 'select', options: ['confirmed_not_started', 'running_stale', 'failed', 'succeeded_without_recipe'] },
    { key: 'user', label: '用户', placeholder: '邮箱 / 昵称 / 用户ID' },
    { key: 'search', label: '搜索', placeholder: '标题 / 需求 / 分类' },
    { key: 'sourceType', label: '来源', type: 'select', options: ['text', 'reference_image', 'recipe', 'rerun'] },
    { key: 'failureKind', label: '失败类型', type: 'select', options: TASK_FAILURE_KIND_OPTIONS },
    { key: 'generationTaskId', label: '任务编号' },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
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
    { key: 'relatedId', label: '关联对象' },
    { key: 'createdByAdmin', label: '管理员' },
    { key: 'dateFrom', label: '开始日期', type: 'date' },
    { key: 'dateTo', label: '结束日期', type: 'date' },
  ],
  shares: [
    { key: 'status', label: '状态', type: 'select', options: ['shareActive', 'shareExpired', 'shareRevoked'] },
    { key: 'reviewStatus', label: '审核', type: 'select', options: ['auto_pass', 'attention', 'blocked'] },
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

function summarizeProbeResult(probe: GatewayRouteProbeResult) {
  const hasReal2k = probe.tests.some((test) => test.requestedSize === '2560x1440' && test.returnedImage && !test.shrunk)
  const hasReal4k = probe.tests.some((test) => test.requestedSize === '3840x2160' && test.returnedImage && !test.shrunk)
  if (hasReal4k) return '真实 2K / 4K'
  if (hasReal2k) return '真实 2K，4K 不稳定'
  const hasShrunk = probe.tests.some((test) => test.shrunk)
  if (hasShrunk) return '存在缩水'
  const allBroken = probe.tests.every((test) => !test.returnedImage)
  if (allBroken) return '无有效图片返回'
  return '需人工复核'
}

function formatProbeTestLine(test: GatewayRouteProbeResult['tests'][number]) {
  const status = test.returnedImage
    ? test.shrunk
      ? '缩水'
      : '正常'
    : '失败'
  const tier = test.requestedSize === '3840x2160' ? '4K' : test.requestedSize === '2560x1440' ? '2K' : '1K'
  const actual = test.actualSize ?? '无图'
  const http = test.statusCode == null ? 'HTTP -' : `HTTP ${test.statusCode}`
  const models = Array.isArray(test.attemptedModels) && test.attemptedModels.length
    ? test.attemptedModels.join(' -> ')
    : test.upstreamModel
      ? test.upstreamModel
      : ''
  const modelText = models ? ` · 模型 ${models}` : ''
  const extra = test.errorSummary ? ` · ${test.errorSummary}` : ''
  return `${tier} ${test.requestedSize} -> ${actual} · ${status} · ${http} · ${test.latencyMs}ms${modelText}${extra}`
}

function formatPreflightProbeLine(label: string, probe: GatewayRoutePreflightResult['baseProbe']) {
  const status = probe.status == null ? 'HTTP -' : `HTTP ${probe.status}`
  const result = probe.ok ? '正常' : '失败'
  const extra = probe.error ? ` · ${probe.error}` : ''
  return `${label} · ${result} · ${status} · ${probe.durationMs}ms${extra}`
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

function getPreferredAdminDisplayValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getDisplayValueForKey(row, key)
    if (value == null) continue
    if (typeof value === 'string') {
      const text = value.trim()
      if (!text) continue
      if (isLikelyAdminTechnicalId(text)) continue
      return text
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  for (const key of keys) {
    const value = getValueByPath(row, key)
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function getAdminTaskUserDisplay(row: Record<string, unknown>) {
  return getPreferredAdminDisplayValue(row, ['userLabel', 'userEmail', 'userDisplayName', 'email', 'displayName', 'userId'])
}

function getAdminTaskModelDisplay(row: Record<string, unknown>) {
  return getPreferredAdminDisplayValue(row, ['modelLabel', 'modelDisplayName', 'displayName', 'name', 'modelSku'])
}

function getAdminTaskRouteDisplay(row: Record<string, unknown>) {
  return getPreferredAdminDisplayValue(row, ['routeLabel', 'routeName', 'name', 'routeId'])
}

function isLikelyAdminTechnicalId(value: unknown) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  return /^(task|user|model|route|ledger|share|output|audit|referral|binding|code|run|recipe|step)_[a-z0-9]+/i.test(text)
}

function isAdminSecondaryIdentifierField(key: string) {
  return [
    'id',
    'requestId',
    'routeId',
    'modelSkuId',
    'taskId',
    'generationTaskId',
    'runId',
    'sourceRunId',
    'sourceTaskId',
    'sourceOutputId',
    'outputId',
    'shareId',
    'targetId',
    'relatedId',
    'ledgerId',
    'adminUserId',
    'userId',
  ].includes(key)
}

function shouldHideBusinessField(key: string, value: unknown) {
  if (value == null) return true
  if (isAdminSecondaryIdentifierField(key) && isLikelyAdminTechnicalId(value)) return true
  return false
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

function getOfficialTemplateAdminPayload(
  templatesSource: PromptTemplateSearchableItem[],
  limit: number,
  offset: number,
  filters: Record<string, string>,
  hiddenTemplateIds: string[] = [],
) {
  const search = filters.search?.trim().toLowerCase() ?? ''
  const category = filters.category?.trim() ?? ''
  const status = filters.status?.trim() ?? ''
  const hiddenIds = new Set(hiddenTemplateIds)
  const templates = templatesSource
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

async function loadAdminOfficialTemplates() {
  try {
    const serverTemplates = (await fetchPublicPromptTemplates()).map(ensureSearchablePromptTemplate)
    return mergeOfficialPromptTemplates(PROMPT_LIBRARY_TEMPLATES, serverTemplates)
  } catch {
    return PROMPT_LIBRARY_TEMPLATES
  }
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
    isOfficial: '线路类型',
    provider: '接口类型',
    baseUrl: '接口地址',
    apiKeyRef: '密钥环境变量',
    upstreamModel: '上游模型',
    modelAlias: '模型别名',
    defaultUpstreamModel: '默认模型名',
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
    runId: 'Run 编号',
    sourceRunId: '来源 Run',
    sourceTaskId: '来源任务',
    sourceOutputId: '来源图片',
    sourceType: '来源',
    projectStatus: '项目状态',
    generationTaskId: '出图任务',
    generationTaskStatus: '任务状态',
    generationTaskChargedPoints: '任务扣点',
    recommendedModelSku: '推荐模型',
    recommendedModelDisplayName: '推荐模型名称',
    recommendedModelLabel: '推荐模型',
    recommendedOutputCount: '建议出图数',
    estimatedPoints: '预估点数',
    confirmedPoints: '确认点数',
    recipeCount: '配方数',
    stepCount: '步骤数',
    failedStepCount: '失败步骤数',
    confirmedAt: '确认时间',
    startedAt: '开始时间',
    archivedAt: '归档时间',
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
  if (['active', 'enabled', 'published', 'succeeded', 'success', 'redeemed', 'ok', 'available', 'healthy', 'publish', 'recommend_featured', 'completed', 'confirmed'].includes(text)) return 'good'
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
    'upstream_async_queued',
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
  if (['queued', 'running', 'draft', 'pending', 'cooling', 'degraded', 'ai_reviewing', 'needs_review', 'featured_candidates', 'latest'].includes(text)) return 'warn'
  return 'neutral'
}

function shouldRenderAsBadge(key: string, value: unknown) {
  if (typeof value === 'boolean') return true
  return ['status', 'enabled', 'featured', 'result', 'failureKind', 'healthStatus', 'supportsEdit', 'supportsMask', 'cooldownActive', 'aiDecision', 'aiReviewStatus', 'queue', 'projectStatus', 'generationTaskStatus'].includes(key)
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

function formatAdminShortId(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
  if (!text) return '-'
  if (text.length <= 18) return text
  return `${text.slice(0, 10)}...${text.slice(-6)}`
}

function formatAdminTaskMode(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return '未知任务'
  if (text === 'generate') return '文生图'
  if (text === 'edit') return '图像编辑'
  if (text === 'agent') return '智能代理生成'
  if (text === 'agent_edit') return '智能代理编辑'
  return formatAdminValue(value)
}

function isAdminTaskRecord(record: Record<string, unknown>) {
  return (
    typeof getValueByPath(record, 'outputCount') === 'number' ||
    typeof getValueByPath(record, 'requestId') === 'string' ||
    typeof getValueByPath(record, 'modelLabel') === 'string' ||
    typeof getValueByPath(record, 'modelSku') === 'string'
  )
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

  const toCount = (key: string) => {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string' && value.trim()) return value
    return '0'
  }

  return [
    { label: '总分享', value: toCount('totalShareCount'), note: '当前筛选结果' },
    { label: '有效', value: toCount('activeCount'), note: '仍可访问' },
    { label: '已标记', value: toCount('attentionCount'), note: '边界内容' },
    { label: '已拦截', value: toCount('blockedCount'), note: '禁止公开分享' },
  ]
}

function getAgentWorkflowSummaryRecord(summary: unknown) {
  if (isRecord(summary) && isRecord(summary.summary)) return summary.summary
  return isRecord(summary) ? summary : null
}

function getAgentWorkflowSummaryCards(summary: unknown) {
  const record = getAgentWorkflowSummaryRecord(summary)
  if (!record) return [] as Array<{ label: string; value: string; note: string }>
  const getNumber = (key: string) => {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  }
  const formatRate = (value: number) => `${Math.round(value * 100)}%`
  return [
    { label: '总 Run', value: String(getNumber('totalRunCount')), note: `${getNumber('uniqueUsers')} 个用户` },
    { label: '成功率', value: formatRate(getNumber('successRate')), note: `${getNumber('succeededCount')} 成功 / ${getNumber('failedCount')} 失败` },
    { label: '进行中', value: String(getNumber('runningCount')), note: `${getNumber('plannedCount')} 个待确认或待启动` },
    { label: '点数', value: formatCellValue(getNumber('confirmedPoints')), note: `实扣 ${formatCellValue(getNumber('chargedPoints'))}` },
    { label: '配方', value: String(getNumber('recipeCount')), note: `${getNumber('linkedTaskCount')} 个任务链路` },
  ]
}

type AgentAttentionQueue = {
  key: string
  label: string
  count: number
  severity: string
  description: string
  filter: Record<string, string>
}

function getAgentAttentionQueues(summary: unknown): AgentAttentionQueue[] {
  const record = getAgentWorkflowSummaryRecord(summary)
  const queues = record?.attentionQueues
  if (!Array.isArray(queues)) return []
  return queues.filter(isRecord).map((queue) => {
    const filter = isRecord(queue.filter)
      ? Object.fromEntries(Object.entries(queue.filter).map(([key, value]) => [key, String(value ?? '')]))
      : {}
    return {
      key: String(queue.key ?? queue.label ?? ''),
      label: String(queue.label ?? queue.key ?? '队列'),
      count: typeof queue.count === 'number' ? queue.count : Number(queue.count ?? 0) || 0,
      severity: String(queue.severity ?? 'neutral'),
      description: String(queue.description ?? ''),
      filter,
    }
  }).filter((queue) => queue.key)
}

function getAgentRunOperationalReview(detail: Record<string, unknown>) {
  const run = getAgentRunDetailRecord(detail)
  const task = isRecord(getValueByPath(detail, 'generationTask')) ? getValueByPath(detail, 'generationTask') as Record<string, unknown> : null
  const steps = getValueByPath(detail, 'steps')
  const recipes = getValueByPath(detail, 'recipes')
  const stepRows = Array.isArray(steps) ? steps.filter(isRecord) : []
  const recipeRows = Array.isArray(recipes) ? recipes.filter(isRecord) : []
  const status = String(getValueByPath(run, 'status') ?? '')
  const taskStatus = String(getValueByPath(task ?? {}, 'status') ?? getValueByPath(run, 'generationTaskStatus') ?? '')
  const generationTaskId = getValueByPath(run, 'generationTaskId')
  const failedStep = stepRows.find((step) => String(getValueByPath(step, 'status') ?? '') === 'failed')
  const chargedPoints = getValueByPath(task ?? {}, 'chargedPoints') ?? getValueByPath(run, 'generationTaskChargedPoints')
  const confirmedPoints = getValueByPath(run, 'confirmedPoints')
  const hasRecipes = recipeRows.length > 0 || Number(getValueByPath(run, 'recipeCount') ?? 0) > 0

  if (status === 'failed' || taskStatus === 'failed' || taskStatus === 'timeout') {
    return {
      tone: 'danger',
      title: '失败 Run，优先查任务链路',
      detail: getValueByPath(run, 'errorSummary') || getValueByPath(task ?? {}, 'errorSummary') || getValueByPath(failedStep ?? {}, 'errorSummary') || '查看失败步骤和出图任务错误摘要。',
      items: [
        { label: '卡点', value: failedStep ? getValueByPath(failedStep, 'stepKey') : '出图任务' },
        { label: '失败类型', value: getValueByPath(run, 'failureKind') ?? getValueByPath(task ?? {}, 'failureKind') ?? getValueByPath(failedStep ?? {}, 'errorKind') },
        { label: '扣点', value: chargedPoints ?? confirmedPoints },
      ],
    }
  }
  if (status === 'confirmed' && !generationTaskId) {
    return {
      tone: 'warn',
      title: '已确认但未启动',
      detail: '用户已确认路线和点数，但尚未创建服务端出图任务。',
      items: [
        { label: '建议动作', value: '核对前台启动动作' },
        { label: '确认点数', value: confirmedPoints },
        { label: '任务', value: '未创建' },
      ],
    }
  }
  if (status === 'running') {
    return {
      tone: 'warn',
      title: generationTaskId ? '生成中，关注任务队列' : '运行中但任务未落库',
      detail: generationTaskId ? '继续核对任务状态、线路和上游返回。' : '需要检查 start 阶段是否创建任务失败。',
      items: [
        { label: '任务状态', value: taskStatus || '未知' },
        { label: '任务编号', value: generationTaskId },
        { label: '预留点数', value: getValueByPath(task ?? {}, 'reservedPoints') ?? confirmedPoints },
      ],
    }
  }
  if (status === 'succeeded' && !hasRecipes) {
    return {
      tone: 'neutral',
      title: '成功但未沉淀配方',
      detail: '结果已完成，但当前 Run 还没有可复用配方记录。',
      items: [
        { label: '建议动作', value: '评估是否引导保存配方' },
        { label: '任务扣点', value: chargedPoints },
        { label: '配方数', value: recipeRows.length },
      ],
    }
  }
  if (status === 'succeeded') {
    return {
      tone: 'good',
      title: '成功且有资产沉淀',
      detail: 'Run 已完成，任务和配方链路可用于复盘质量。',
      items: [
        { label: '任务状态', value: taskStatus || '已完成' },
        { label: '任务扣点', value: chargedPoints },
        { label: '配方数', value: recipeRows.length },
      ],
    }
  }
  return {
    tone: 'neutral',
    title: '等待用户继续流程',
    detail: '当前 Run 尚未进入出图或验收阶段。',
    items: [
      { label: 'Run 状态', value: status },
      { label: '确认点数', value: confirmedPoints },
      { label: '任务', value: generationTaskId || '待创建' },
    ],
  }
}

function getAgentInterventionTypeLabel(value: unknown) {
  const type = typeof value === 'string' ? value : ''
  return AGENT_INTERVENTION_OPTIONS.find((option) => option.value === type)?.label ?? formatAdminValue(value)
}

function getAgentRunAdminInterventions(run: Record<string, unknown>) {
  const metadata = getValueByPath(run, 'metadata')
  const history = getValueByPath(metadata, 'adminInterventionHistory')
  const rows = Array.isArray(history) ? history.filter(isRecord) : []
  const latest = getValueByPath(metadata, 'adminIntervention')
  if (rows.length) return rows
  return isRecord(latest) ? [latest] : []
}

function AdminValue(props: { fieldKey: string; value: unknown }) {
  if (props.fieldKey === 'isOfficial') {
    const isOfficial = props.value === true
    return <span className={`admin-status-badge is-${isOfficial ? 'good' : 'neutral'}`}>{isOfficial ? '【官方】' : '常规'}</span>
  }
  if (isAdminSecondaryIdentifierField(props.fieldKey) && typeof props.value === 'string' && props.value.trim()) {
    return <AdminCopyableValue value={props.value} displayText={formatAdminShortId(props.value)} />
  }
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

function AdminCopyableValue(props: { value: string; displayText?: string }) {
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
      <span className="admin-copyable-text" title={text}>{props.displayText ?? formatAdminDate(text)}</span>
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

function getTableShellClassName(section: Exclude<AdminSectionKey, 'dashboard'>, actionScope: string) {
  const names = ['admin-table-shell']
  if (section === 'tasks') names.push('is-task-list')
  if (section === 'agentWorkflow') names.push('is-agent-run-list')
  if (actionScope === 'routes') names.push('is-route-list')
  if (actionScope === 'modelSkus') names.push('is-model-list')
  if (actionScope === 'bindings') names.push('is-binding-list')
  if (actionScope === 'templates' || actionScope === 'candidates') names.push('is-template-list')
  if (section === 'users' && actionScope === 'users') names.push('is-user-list')
  return names.join(' ')
}

function hasMeaningfulAdminValue(value: unknown) {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function getFirstDetailRecord(detail: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getValueByPath(detail, key)
    if (isRecord(value)) return value
  }
  return detail
}

function getArrayCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function getDetailMetricValue(record: Record<string, unknown>, key: string) {
  return getDisplayValueForKey(record, key) ?? getValueByPath(record, key)
}

function AdminDetailMetricList(props: { items: Array<{ key: string; label: string; value: unknown }> }) {
  const items = props.items.filter((item) => hasMeaningfulAdminValue(item.value))
  if (!items.length) return null
  return (
    <div className="admin-summary-grid">
      {items.map((item) => (
        <article key={`${item.key}-${item.label}`} className="admin-summary-card">
          <span>{item.label}</span>
          <strong>
            <AdminValue fieldKey={item.key} value={item.value} />
          </strong>
        </article>
      ))}
    </div>
  )
}

function AdminBusinessFieldList(props: { record: Record<string, unknown>; fields: Array<{ key: string; label: string }>; hideEmpty?: boolean }) {
  const items = props.fields
    .map((field) => ({
      field,
      value: getDisplayValueForKey(props.record, field.key) ?? getValueByPath(props.record, field.key),
    }))
    .filter((item) => (!props.hideEmpty || hasMeaningfulAdminValue(item.value)) && !shouldHideBusinessField(item.field.key, item.value))

  if (!items.length) return <p className="admin-empty">暂无可直接展示的字段。</p>

  return (
    <div className="admin-field-grid admin-field-grid-compact">
      {items.map(({ field, value }) => (
        <div key={field.key} className="admin-field-item">
          <span>{field.label}</span>
          <strong>
            <AdminValue fieldKey={field.key} value={value} />
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
  if (isAdminTaskRecord(props.record)) {
    return <AdminTaskRecordPreview record={props.record} />
  }
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

function AdminTaskRecordPreview(props: { record: Record<string, unknown> }) {
  const userLabel = getAdminTaskUserDisplay(props.record)
  const modelLabel = getAdminTaskModelDisplay(props.record)
  const taskId = getValueByPath(props.record, 'id')
  const requestId = getValueByPath(props.record, 'requestId')
  const outputCount = getValueByPath(props.record, 'outputCount')
  const status = getValueByPath(props.record, 'status')
  const mode = getValueByPath(props.record, 'mode')
  const routeLabel = getAdminTaskRouteDisplay(props.record)
  const createdAt = getValueByPath(props.record, 'createdAt')
  const finishedAt = getValueByPath(props.record, 'finishedAt')

  return (
    <div className="admin-task-preview">
      <div className="admin-task-preview-main">
        <div className="admin-task-preview-title">
          <strong>{formatAdminValue(userLabel)}</strong>
          <span>提交了 1 条{formatAdminTaskMode(mode)}任务</span>
        </div>
        <div className="admin-task-preview-meta">
          <div>
            <span>任务状态</span>
            <strong><AdminValue fieldKey="status" value={status} /></strong>
          </div>
          <div>
            <span>使用模型</span>
            <strong>{formatAdminValue(modelLabel)}</strong>
          </div>
          <div>
            <span>出图结果</span>
            <strong>{typeof outputCount === 'number' ? `${outputCount} 张` : formatAdminValue(outputCount)}</strong>
          </div>
          <div>
            <span>执行线路</span>
            <strong>{formatAdminValue(routeLabel)}</strong>
          </div>
        </div>
      </div>
      <div className="admin-task-preview-side">
        <div><span>任务编号</span><strong title={String(taskId ?? '')}>{formatAdminShortId(taskId)}</strong></div>
        <div><span>请求编号</span><strong title={String(requestId ?? '')}>{formatAdminShortId(requestId)}</strong></div>
        <div><span>提交时间</span><strong>{formatAdminValue(createdAt)}</strong></div>
        <div><span>完成时间</span><strong>{formatAdminValue(finishedAt)}</strong></div>
      </div>
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

function getCurrentPageUrl() {
  return typeof window !== 'undefined' ? window.location.href : undefined
}

function TemplateVisibilityNotice(props: {
  title: string
  tone: TemplateVisibilityNoticeTone
  lines: string[]
  href: string
  ctaLabel: string
}) {
  return (
    <section className={`admin-template-visibility-card is-${props.tone}`}>
      <div className="admin-template-visibility-head">
        <strong>{props.title}</strong>
        <a href={props.href} target="_blank" rel="noreferrer">{props.ctaLabel}</a>
      </div>
      <div className="admin-template-visibility-lines">
        {props.lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </section>
  )
}

function AdminContentDetailView(props: { detail: Record<string, unknown>; selectedId: string; contentSubsection: ContentSubsectionKey }) {
  const record = getContentDetailRecord(props.detail, props.contentSubsection)
  const previewUrl = getTemplatePreviewUrl(record)

  if (props.contentSubsection === 'importRuns') {
    const visibilityNotice = getImportRunVisibilityNotice(record, getCurrentPageUrl())
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
              { key: 'diagnosticSummary', label: '导入诊断' },
              { key: 'errorSummary', label: '错误摘要' },
            ]}
          />
        </section>
        <TemplateVisibilityNotice {...visibilityNotice} />
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

function getTaskDetailRecord(detail: Record<string, unknown>) {
  const task = getValueByPath(detail, 'task')
  return isRecord(task) ? task : detail
}

function parseAdminTaskFailureSummary(errorSummary: unknown) {
  if (typeof errorSummary !== 'string' || !errorSummary.trim()) {
    return { message: '', attempts: [] as Array<Record<string, unknown>> }
  }
  try {
    const parsed = JSON.parse(errorSummary)
    if (!isRecord(parsed)) return { message: errorSummary, attempts: [] as Array<Record<string, unknown>> }
    return {
      message: typeof parsed.message === 'string' ? parsed.message : errorSummary,
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts.filter(isRecord) : [],
    }
  } catch {
    return { message: errorSummary, attempts: [] as Array<Record<string, unknown>> }
  }
}

function AdminTaskDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const task = getTaskDetailRecord(props.detail)
  const failureSummary = parseAdminTaskFailureSummary(getValueByPath(task, 'errorSummary'))
  const attempts = failureSummary.attempts
  const lastAttempt = [...attempts].reverse().find((attempt) => !getValueByPath(attempt, 'skippedByCooldown')) ?? attempts[attempts.length - 1]
  const resolvedRouteId = getValueByPath(task, 'routeId') ?? getValueByPath(lastAttempt ?? {}, 'routeId')
  const resolvedUpstreamModel = getValueByPath(task, 'upstreamModel') ?? getValueByPath(lastAttempt ?? {}, 'upstreamModel')
  const taskView = {
    ...task,
    routeId: resolvedRouteId,
    upstreamModel: resolvedUpstreamModel,
  }
  const outputs = getValueByPath(props.detail, 'outputs')
  const ledger = getValueByPath(props.detail, 'ledger')
  const auditLogs = getValueByPath(props.detail, 'auditLogs')

  return (
    <div className="admin-detail-stack">
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>任务概览</span>
          <strong>{props.selectedId || formatCellValue(getValueByPath(task, 'id'))}</strong>
        </div>
        <AdminBusinessFieldList
          record={taskView}
          fields={[
            { key: 'userLabel', label: '用户' },
            { key: 'status', label: '状态' },
            { key: 'modelLabel', label: '模型' },
            { key: 'routeLabel', label: '线路' },
            { key: 'upstreamModel', label: '上游模型' },
            { key: 'outputCount', label: '出图张数' },
            { key: 'chargedPoints', label: '扣点' },
            { key: 'failureKind', label: '失败类型' },
            { key: 'createdAt', label: '提交时间' },
            { key: 'finishedAt', label: '完成时间' },
          ]}
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>失败排查</span>
          <strong>{attempts.length ? `${attempts.length} 次尝试` : '无尝试记录'}</strong>
        </div>
        <div className="admin-strategy-list admin-record-list">
          <div><span>错误信息</span><strong>{formatAdminValue(failureSummary.message || getValueByPath(task, 'errorSummary'))}</strong></div>
          <div><span>线路标识</span><strong>{formatAdminValue(resolvedRouteId)}</strong></div>
          <div><span>上游模型</span><strong>{formatAdminValue(resolvedUpstreamModel)}</strong></div>
          <div><span>尝试次数</span><strong>{attempts.length ? `${attempts.length} 次` : '-'}</strong></div>
        </div>
        {attempts.length ? (
          <div className="admin-activity-list">
            {attempts.map((attempt, index) => (
              <article key={`${String(getValueByPath(attempt, 'routeId') ?? 'attempt')}-${index}`} className="admin-activity-item">
                <AdminBusinessFieldList
                  record={attempt}
                  fields={[
                    { key: 'routeId', label: '线路标识' },
                    { key: 'upstreamModel', label: '上游模型' },
                    { key: 'success', label: '成功' },
                    { key: 'latencyMs', label: '耗时(ms)' },
                    { key: 'failureKind', label: '失败类型' },
                    { key: 'errorMessage', label: '错误信息' },
                    { key: 'skippedByCooldown', label: '冷却跳过' },
                  ]}
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-empty">这条任务没有解析出额外尝试记录。</p>
        )}
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>相关记录</span>
        </div>
        <div className="admin-strategy-list admin-record-list">
          <div><span>出图记录</span><strong>{Array.isArray(outputs) ? `${outputs.length} 条` : '0 条'}</strong></div>
          <div><span>账务流水</span><strong>{Array.isArray(ledger) ? `${ledger.length} 条` : '0 条'}</strong></div>
          <div><span>审计日志</span><strong>{Array.isArray(auditLogs) ? `${auditLogs.length} 条` : '0 条'}</strong></div>
        </div>
      </section>

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function getAgentRunDetailRecord(detail: Record<string, unknown>) {
  const run = getValueByPath(detail, 'agentRun')
  return isRecord(run) ? run : detail
}

function AdminAgentWorkflowDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const run = getAgentRunDetailRecord(props.detail)
  const generationTask = getValueByPath(props.detail, 'generationTask')
  const task = isRecord(generationTask) ? generationTask : null
  const steps = getValueByPath(props.detail, 'steps')
  const recipes = getValueByPath(props.detail, 'recipes')
  const stepRows = Array.isArray(steps) ? steps.filter(isRecord) : []
  const recipeRows = Array.isArray(recipes) ? recipes.filter(isRecord) : []
  const runLabel = props.selectedId || String(getValueByPath(run, 'title') || getValueByPath(run, 'id') || '未命名 Run')
  const operationalReview = getAgentRunOperationalReview(props.detail)
  const adminInterventions = getAgentRunAdminInterventions(run)

  return (
    <div className="admin-detail-stack">
      <section className={`admin-detail-block admin-agent-operational-review is-${operationalReview.tone}`}>
        <div className="admin-detail-title">
          <span>运营判断</span>
          <strong>{operationalReview.title}</strong>
        </div>
        <p>{formatAdminValue(operationalReview.detail)}</p>
        <div className="admin-agent-operational-grid">
          {operationalReview.items.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong><AdminValue fieldKey={item.label} value={item.value} /></strong>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-detail-block admin-agent-intervention-block">
        <div className="admin-detail-title">
          <span>运营处理</span>
          <strong>{adminInterventions.length ? `${adminInterventions.length} 条记录` : '暂无处理记录'}</strong>
        </div>
        {adminInterventions.length ? (
          <div className="admin-activity-list">
            {adminInterventions.slice(0, 5).map((item, index) => (
              <article key={String(getValueByPath(item, 'id') ?? index)} className="admin-activity-item">
                <AdminBusinessFieldList
                  record={{
                    ...item,
                    typeLabel: getAgentInterventionTypeLabel(getValueByPath(item, 'type')),
                  }}
                  fields={[
                    { key: 'typeLabel', label: '处理类型' },
                    { key: 'note', label: '备注' },
                    { key: 'adminEmail', label: '管理员' },
                    { key: 'createdAt', label: '处理时间' },
                  ]}
                  hideEmpty
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-empty">选中 Run 后，可在操作面板记录人工复核、已处理或配方沉淀建议。</p>
        )}
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>Run 概览</span>
          <strong>{runLabel}</strong>
        </div>
        <AdminDetailMetricList
          items={[
            { key: 'status', label: 'Run 状态', value: getValueByPath(run, 'status') },
            { key: 'projectStatus', label: '项目状态', value: getValueByPath(run, 'projectStatus') },
            { key: 'sourceType', label: '来源', value: getValueByPath(run, 'sourceType') },
            { key: 'category', label: '分类', value: getValueByPath(run, 'category') },
            { key: 'confirmedPoints', label: '确认点数', value: getValueByPath(run, 'confirmedPoints') },
            { key: 'generationTaskChargedPoints', label: '任务扣点', value: getValueByPath(run, 'generationTaskChargedPoints') },
            { key: 'stepCount', label: '步骤数', value: getValueByPath(run, 'stepCount') },
            { key: 'recipeCount', label: '配方数', value: getValueByPath(run, 'recipeCount') },
          ]}
        />
        <AdminBusinessFieldList
          record={run}
          fields={[
            { key: 'title', label: '项目名称' },
            { key: 'userLabel', label: '用户' },
            { key: 'userPrompt', label: '创作需求' },
            { key: 'recommendedModelLabel', label: '推荐模型' },
            { key: 'recommendedOutputCount', label: '建议出图数' },
            { key: 'estimatedPoints', label: '预估点数' },
            { key: 'failureKind', label: '失败类型' },
            { key: 'errorSummary', label: '错误摘要' },
            { key: 'createdAt', label: '创建时间' },
            { key: 'updatedAt', label: '更新时间' },
          ]}
          hideEmpty
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>出图任务链路</span>
          <strong>{formatAdminShortId(getValueByPath(run, 'generationTaskId'))}</strong>
        </div>
        {task ? (
          <AdminBusinessFieldList
            record={task}
            fields={[
              { key: 'id', label: '任务编号' },
              { key: 'status', label: '任务状态' },
              { key: 'modelLabel', label: '模型' },
              { key: 'routeLabel', label: '线路' },
              { key: 'outputCount', label: '出图张数' },
              { key: 'reservedPoints', label: '预留点数' },
              { key: 'chargedPoints', label: '扣点' },
              { key: 'failureKind', label: '失败类型' },
              { key: 'errorSummary', label: '错误摘要' },
              { key: 'finishedAt', label: '完成时间' },
            ]}
            hideEmpty
          />
        ) : (
          <p className="admin-empty">当前 Run 尚未关联出图任务。</p>
        )}
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>步骤流</span>
          <strong>{stepRows.length} 步</strong>
        </div>
        {stepRows.length ? (
          <div className="admin-activity-list">
            {stepRows.map((step) => (
              <article key={String(getValueByPath(step, 'id') ?? getValueByPath(step, 'stepKey'))} className="admin-activity-item">
                <AdminBusinessFieldList
                  record={step}
                  fields={[
                    { key: 'stepIndex', label: '序号' },
                    { key: 'stepKey', label: '步骤' },
                    { key: 'status', label: '状态' },
                    { key: 'attemptCount', label: '尝试次数' },
                    { key: 'generationTaskId', label: '任务编号' },
                    { key: 'errorKind', label: '错误类型' },
                    { key: 'errorSummary', label: '错误摘要' },
                    { key: 'finishedAt', label: '完成时间' },
                  ]}
                  hideEmpty
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-empty">暂无步骤记录。</p>
        )}
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>配方沉淀</span>
          <strong>{recipeRows.length} 条</strong>
        </div>
        {recipeRows.length ? (
          <div className="admin-activity-list">
            {recipeRows.map((recipe) => (
              <article key={String(getValueByPath(recipe, 'id') ?? getValueByPath(recipe, 'title'))} className="admin-activity-item">
                <AdminBusinessFieldList
                  record={recipe}
                  fields={[
                    { key: 'title', label: '标题' },
                    { key: 'category', label: '分类' },
                    { key: 'status', label: '状态' },
                    { key: 'visibility', label: '可见性' },
                    { key: 'modelSkuId', label: '模型' },
                    { key: 'sourceOutputId', label: '来源图片' },
                    { key: 'useCount', label: '复用次数' },
                    { key: 'updatedAt', label: '更新时间' },
                  ]}
                  hideEmpty
                />
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-empty">当前 Run 尚未沉淀图片配方。</p>
        )}
      </section>

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminUserDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const user = getFirstDetailRecord(props.detail, ['user'])
  const billingLedger = getValueByPath(props.detail, 'billingLedger') ?? getValueByPath(props.detail, 'ledger')
  const referrals = getValueByPath(props.detail, 'referrals')
  const creditRecords = getValueByPath(props.detail, 'creditRecords')
  const tasks = getValueByPath(props.detail, 'tasks')
  const shares = getValueByPath(props.detail, 'shares')
  const userLabel = props.selectedId || formatCellValue(getDetailMetricValue(user, 'email') ?? getValueByPath(user, 'id'))
  const recentTasks = Array.isArray(tasks) ? tasks.slice(0, 1) : []
  const accountSummary = [
    { key: 'status', label: '账号状态', value: getDetailMetricValue(user, 'status') },
    { key: 'emailVerified', label: '邮箱验证', value: getDetailMetricValue(user, 'emailVerified') },
    { key: 'createdAt', label: '注册时间', value: getDetailMetricValue(user, 'createdAt') },
  ]
  const businessSummary = [
    { key: 'balance', label: '当前余额', value: getDetailMetricValue(user, 'balance') },
    { key: 'totalRechargePoints', label: '累计充值', value: getDetailMetricValue(user, 'totalRechargePoints') },
    { key: 'totalChargedPoints', label: '累计扣点', value: getDetailMetricValue(user, 'totalChargedPoints') },
    { key: 'tasks', label: '任务数', value: getArrayCount(tasks) },
  ]

  return (
    <div className="admin-detail-stack admin-user-detail-stack">
      <section className="admin-detail-block admin-user-detail-hero admin-user-detail-flat">
        <div className="admin-detail-title">
          <span>账号摘要</span>
          <strong>{userLabel}</strong>
        </div>
        <div className="admin-user-headline">
          <div>
            <span>显示名</span>
            <strong>{formatAdminValue(getDetailMetricValue(user, 'displayName'))}</strong>
          </div>
          <div>
            <span>当前余额</span>
            <strong>{formatAdminValue(getDetailMetricValue(user, 'balance'))}</strong>
          </div>
        </div>
        <div className="admin-user-inline-meta">
          {accountSummary.map((item) => (
            <div key={item.key}>
              <span>{item.label}</span>
              <strong><AdminValue fieldKey={item.key} value={item.value} /></strong>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-detail-block admin-user-detail-flat">
        <div className="admin-detail-title">
          <span>业务概况</span>
          <strong>{getArrayCount(tasks)} 条任务</strong>
        </div>
        <div className="admin-user-inline-meta admin-user-inline-meta-strong">
          {businessSummary.map((item) => (
            <div key={item.key}>
              <span>{item.label}</span>
              <strong><AdminValue fieldKey={item.key} value={item.value} /></strong>
            </div>
          ))}
        </div>
        <details className="admin-user-detail-collapse">
          <summary>查看更多</summary>
          <div className="admin-user-inline-meta admin-user-inline-meta-secondary">
            <div><span>邮箱</span><strong>{formatAdminValue(getDetailMetricValue(user, 'email'))}</strong></div>
            <div><span>流水</span><strong>{getArrayCount(billingLedger)} 条</strong></div>
            <div><span>分享</span><strong>{getArrayCount(shares)} 条</strong></div>
            <div><span>邀请奖励</span><strong>{getArrayCount(creditRecords)} 条</strong></div>
            <div><span>邀请关系</span><strong>{getArrayCount(referrals)} 条</strong></div>
          </div>
          {recentTasks.length ? (
            <div className="admin-activity-list">
              {recentTasks.map((task, index) => isRecord(task) ? (
                <article key={`${String(getValueByPath(task, 'id') ?? 'task')}-${index}`} className="admin-activity-item">
                  <AdminRecordPreview record={task} />
                </article>
              ) : null)}
            </div>
          ) : null}
        </details>
      </section>

      <details className="admin-user-detail-collapse admin-user-detail-collapse-raw">
        <summary>查看原始记录（排查用）</summary>
        <AdminRawData payload={props.detail} label="原始记录" />
      </details>
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
  const postLabel = String(getValueByPath(post, 'title') || getValueByPath(post, 'id') || props.selectedId || '未命名帖子')

  return (
    <div className="admin-detail-stack">
      {imageUrl ? (
        <section className="admin-detail-image-card">
          <img src={imageUrl} alt="" loading="lazy" />
        </section>
      ) : null}

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>展示概览</span>
          <strong>{postLabel}</strong>
        </div>
        <AdminDetailMetricList
          items={[
            { key: 'category', label: '分类', value: getValueByPath(post, 'category') },
            { key: 'processingLabel', label: '处理方式', value: getValueByPath(post, 'processingLabel') },
            { key: 'status', label: '展示状态', value: getValueByPath(post, 'status') },
            { key: 'featured', label: '精选状态', value: getValueByPath(post, 'featured') },
            { key: 'featuredRank', label: '精选位次', value: getValueByPath(post, 'featuredRank') },
            { key: 'aiDecision', label: 'AI 结论', value: getValueByPath(post, 'aiDecision') },
            { key: 'qualityScore', label: '质量分', value: getValueByPath(post, 'qualityScore') },
            { key: 'riskScore', label: '风险分', value: getValueByPath(post, 'riskScore') },
            { key: 'shareUrlPath', label: '公开链接', value: getValueByPath(post, 'shareUrlPath') },
            { key: 'viewCount', label: '浏览量', value: getValueByPath(post, 'viewCount') },
            { key: 'detailOpenCount', label: '详情打开', value: getValueByPath(post, 'detailOpenCount') },
            { key: 'enterStudioClickCount', label: '进入工作台', value: getValueByPath(post, 'enterStudioClickCount') },
          ]}
        />
        <AdminBusinessFieldList
          record={post}
          fields={[
            { key: 'title', label: '标题' },
            { key: 'caption', label: '说明' },
          ]}
          hideEmpty
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>发布资料</span>
        </div>
        <AdminBusinessFieldList
          record={post}
          fields={[
            { key: 'authorNameSnapshot', label: '发布昵称快照' },
            { key: 'userLabel', label: '发布账号' },
            { key: 'publishedAt', label: '发布时间' },
            { key: 'shareUrlPath', label: '公开链接' },
          ]}
          hideEmpty
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>图片规格与记录</span>
          <strong>{props.selectedId || formatCellValue(getValueByPath(post, 'id'))}</strong>
        </div>
        <AdminBusinessFieldList
          record={post}
          fields={[
            { key: 'outputId', label: '输出编号' },
            { key: 'shareId', label: '分享编号' },
            { key: 'width', label: '宽度' },
            { key: 'height', label: '高度' },
            { key: 'createdAt', label: '创建时间' },
            { key: 'updatedAt', label: '更新时间' },
          ]}
          hideEmpty
        />
      </section>

      {aiReviewRecord ? (
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>AI 审核意见</span>
          </div>
          <AdminBusinessFieldList
            record={aiReviewRecord}
            fields={[
              { key: 'decision', label: '决策' },
              { key: 'displayFit', label: '推荐展示位' },
              { key: 'categorySuggestion', label: '分类建议' },
              { key: 'internalNote', label: '内部备注' },
              { key: 'reviewedAt', label: '审核时间' },
            ]}
            hideEmpty
          />
          {strengths.length ? (
            <section className="admin-detail-block">
              <div className="admin-detail-title">
                <span>优点</span>
                <strong>{strengths.length} 条</strong>
              </div>
              <div className="admin-activity-list">
                {strengths.map((item, index) => (
                  <article key={`strength-${index}`} className="admin-activity-item">
                    <strong>{formatAdminValue(item)}</strong>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {risks.length ? (
            <section className="admin-detail-block">
              <div className="admin-detail-title">
                <span>风险提示</span>
                <strong>{risks.length} 条</strong>
              </div>
              <div className="admin-activity-list">
                {risks.map((item, index) => (
                  <article key={`risk-${index}`} className="admin-activity-item">
                    <strong>{formatAdminValue(item)}</strong>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminGatewayRouteDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const route = getFirstDetailRecord(props.detail, ['route'])
  const diagnostics = getValueByPath(props.detail, 'diagnostics')
  const diagnosticsRecord = isRecord(diagnostics) ? diagnostics : null
  const routeView = {
    ...route,
    cooldownActive: getValueByPath(diagnosticsRecord ?? {}, 'cooldownActive') ?? getValueByPath(route, 'cooldownActive'),
    cooldownUntil: getValueByPath(diagnosticsRecord ?? {}, 'cooldownUntil') ?? getValueByPath(route, 'cooldownUntil'),
    restoresAt: getValueByPath(diagnosticsRecord ?? {}, 'restoresAt') ?? getValueByPath(route, 'restoresAt') ?? getValueByPath(route, 'diagnostics.restoresAt'),
    lastFailureKind: getValueByPath(diagnosticsRecord ?? {}, 'lastFailureKind') ?? getValueByPath(route, 'lastFailureKind'),
  }
  const routeLabel = props.selectedId || formatCellValue(getDetailMetricValue(route, 'name') ?? getValueByPath(route, 'id'))

  return (
    <div className="admin-detail-stack">
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>线路概览</span>
          <strong>{routeLabel}</strong>
        </div>
        <AdminDetailMetricList
          items={[
            { key: 'healthStatus', label: '健康状态', value: getDetailMetricValue(routeView, 'healthStatus') },
            { key: 'isOfficial', label: '线路类型', value: getDetailMetricValue(routeView, 'isOfficial') },
            { key: 'enabled', label: '启用状态', value: getDetailMetricValue(routeView, 'enabled') },
            { key: 'cooldownActive', label: '失败冷却', value: getDetailMetricValue(routeView, 'cooldownActive') },
            { key: 'restoresAt', label: '预计恢复', value: getDetailMetricValue(routeView, 'restoresAt') },
          ]}
        />
        <AdminBusinessFieldList
          record={routeView}
          hideEmpty
          fields={[
            { key: 'name', label: '线路名称' },
            { key: 'isOfficial', label: '线路类型' },
            { key: 'healthStatus', label: '健康状态' },
            { key: 'enabled', label: '启用状态' },
            { key: 'cooldownActive', label: '失败冷却' },
            { key: 'cooldownUntil', label: '冷却到' },
            { key: 'restoresAt', label: '预计恢复' },
            { key: 'lastFailureKind', label: '最近失败类型' },
          ]}
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>接入配置</span>
          <strong>{formatAdminValue(getDetailMetricValue(route, 'apiKeyRef'))}</strong>
        </div>
        <AdminBusinessFieldList
          record={route}
          hideEmpty
          fields={[
            { key: 'name', label: '线路名称' },
            { key: 'isOfficial', label: '线路类型' },
            { key: 'defaultUpstreamModel', label: '默认模型名' },
            { key: 'apiKeyRef', label: '密钥环境变量' },
            { key: 'baseUrl', label: '基础地址' },
            { key: 'endpoint', label: '接口地址' },
            { key: 'provider', label: '服务商' },
            { key: 'notes', label: '备注' },
          ]}
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>恢复与诊断</span>
          <strong>{diagnosticsRecord ? '已返回诊断数据' : '暂无诊断数据'}</strong>
        </div>
        {diagnosticsRecord ? <AdminFieldGrid record={diagnosticsRecord} limit={12} /> : <p className="admin-empty">当前详情里没有额外诊断字段。</p>}
      </section>

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminGatewayBindingDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const binding = getFirstDetailRecord(props.detail, ['binding'])
  const route = getValueByPath(props.detail, 'route')
  const routeRecord = isRecord(route) ? route : null
  const model = getValueByPath(props.detail, 'modelSku') ?? getValueByPath(props.detail, 'model')
  const modelRecord = isRecord(model) ? model : null
  const bindingView = {
    ...binding,
    modelDisplayName: getValueByPath(modelRecord ?? {}, 'displayName') ?? getValueByPath(binding, 'modelDisplayName'),
    routeName: getValueByPath(routeRecord ?? {}, 'name') ?? getValueByPath(binding, 'routeName'),
    modelAlias: getValueByPath(binding, 'modelAlias') ?? getValueByPath(binding, 'upstreamModel'),
    healthStatus: getValueByPath(binding, 'healthStatus') ?? getValueByPath(routeRecord ?? {}, 'healthStatus'),
    healthState: getValueByPath(binding, 'healthState') ?? getValueByPath(routeRecord ?? {}, 'healthState'),
    restoresAt: getValueByPath(binding, 'restoresAt') ?? getValueByPath(routeRecord ?? {}, 'restoresAt') ?? getValueByPath(routeRecord ?? {}, 'diagnostics.restoresAt'),
    recoveryProbeWindowStartedAt: getValueByPath(binding, 'recoveryProbeWindowStartedAt') ?? '-',
    recoveryProbeBudgetResetAt: getValueByPath(binding, 'recoveryProbeBudgetResetAt') ?? '-',
  }
  const bindingLabel = props.selectedId || `${formatCellValue(getDetailMetricValue(bindingView, 'modelDisplayName'))} / ${formatCellValue(getDetailMetricValue(bindingView, 'routeName'))}`

  return (
    <div className="admin-detail-stack">
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>绑定概览</span>
          <strong>{bindingLabel}</strong>
        </div>
        <AdminDetailMetricList
          items={[
            { key: 'enabled', label: '启用', value: getDetailMetricValue(bindingView, 'enabled') },
            { key: 'healthStatus', label: '线路健康', value: getDetailMetricValue(bindingView, 'healthStatus') },
            { key: 'score', label: '信用分', value: getDetailMetricValue(bindingView, 'score') },
            { key: 'priority', label: '优先级', value: getDetailMetricValue(bindingView, 'priority') },
            { key: 'weight', label: '分流比例', value: getDetailMetricValue(bindingView, 'weight') },
          ]}
        />
        <AdminBusinessFieldList
          record={bindingView}
          hideEmpty
          fields={[
            { key: 'modelDisplayName', label: '模型' },
            { key: 'routeName', label: '线路' },
            { key: 'enabled', label: '启用' },
            { key: 'healthStatus', label: '健康状态' },
            { key: 'healthState', label: '自愈状态' },
            { key: 'score', label: '信用分' },
            { key: 'restoresAt', label: '预计恢复' },
            { key: 'nextProbeAt', label: '下次探测' },
            { key: 'probeFailureCount', label: '探测失败数' },
            { key: 'observingSuccessCount', label: '观察成功数' },
            { key: 'recoveryProbeWindowStartedAt', label: '预算窗口开始' },
            { key: 'recoveryProbeCount', label: '窗口已探测' },
            { key: 'recoveryProbeBudgetResetAt', label: '预算重置时间' },
          ]}
        />
      </section>

      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>调度规则</span>
          <strong>当前执行策略</strong>
        </div>
        <AdminBusinessFieldList
          record={binding}
          hideEmpty
          fields={[
            { key: 'modelAlias', label: '模型别名' },
            { key: 'priority', label: '线路顺序' },
            { key: 'weight', label: '分流比例' },
            { key: 'createdAt', label: '创建时间' },
            { key: 'updatedAt', label: '更新时间' },
          ]}
        />
      </section>

      {(modelRecord || routeRecord) ? (
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>关联资料</span>
            <strong>{modelRecord && routeRecord ? '模型 + 线路' : '单侧对象'}</strong>
          </div>
          <div className="admin-activity-list">
            {modelRecord ? (
              <article className="admin-activity-item">
                <AdminRecordPreview record={modelRecord} />
              </article>
            ) : null}
            {routeRecord ? (
              <article className="admin-activity-item">
                <AdminRecordPreview record={routeRecord} />
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminBillingLedgerDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const entry = getFirstDetailRecord(props.detail, ['ledger', 'entry'])
  const entryLabel = props.selectedId || formatCellValue(getDetailMetricValue(entry, 'id'))

  return (
    <div className="admin-detail-stack">
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>流水概览</span>
          <strong>{entryLabel}</strong>
        </div>
        <AdminDetailMetricList
          items={[
            { key: 'amount', label: '点数', value: getDetailMetricValue(entry, 'amount') },
            { key: 'type', label: '类型', value: getDetailMetricValue(entry, 'type') },
            { key: 'createdAt', label: '时间', value: getDetailMetricValue(entry, 'createdAt') },
          ]}
        />
        <AdminBusinessFieldList
          record={entry}
          hideEmpty
          fields={[
            { key: 'type', label: '类型' },
            { key: 'amount', label: '点数' },
            { key: 'userLabel', label: '用户' },
            { key: 'relatedId', label: '关联记录' },
            { key: 'createdByAdminLabel', label: '管理员' },
            { key: 'createdAt', label: '时间' },
          ]}
        />
      </section>

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminAuditLogDetailView(props: { detail: Record<string, unknown>; selectedId: string }) {
  const log = getFirstDetailRecord(props.detail, ['auditLog', 'log'])
  const before = getValueByPath(props.detail, 'before') ?? getValueByPath(log, 'before')
  const after = getValueByPath(props.detail, 'after') ?? getValueByPath(log, 'after')

  return (
    <div className="admin-detail-stack">
      <section className="admin-detail-block">
        <div className="admin-detail-title">
          <span>操作概览</span>
          <strong>{props.selectedId || formatCellValue(getDetailMetricValue(log, 'id'))}</strong>
        </div>
        <AdminDetailMetricList
          items={[
            { key: 'action', label: '动作', value: getDetailMetricValue(log, 'action') },
            { key: 'targetType', label: '目标类型', value: getDetailMetricValue(log, 'targetType') },
            { key: 'adminUserId', label: '管理员', value: getDetailMetricValue(log, 'adminUserId') },
            { key: 'createdAt', label: '时间', value: getDetailMetricValue(log, 'createdAt') },
          ]}
        />
        <AdminBusinessFieldList
          record={log}
          hideEmpty
          fields={[
            { key: 'action', label: '动作' },
            { key: 'targetType', label: '目标类型' },
            { key: 'adminUserId', label: '管理员' },
            { key: 'createdAt', label: '时间' },
            { key: 'reason', label: '原因' },
          ]}
        />
      </section>

      {isRecord(before) ? (
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>变更前快照</span>
          </div>
          <AdminFieldGrid record={before} limit={12} />
        </section>
      ) : null}

      {isRecord(after) ? (
        <section className="admin-detail-block">
          <div className="admin-detail-title">
            <span>变更后快照</span>
          </div>
          <AdminFieldGrid record={after} limit={12} />
        </section>
      ) : null}

      <AdminRawData payload={props.detail} />
    </div>
  )
}

function AdminDetailView(props: { detail: unknown; selectedId: string; detailLoading: boolean; emptyText: string; section: AdminSectionKey; actionScope: string; contentSubsection?: ContentSubsectionKey }) {
  if (props.detailLoading) return <p className="admin-empty">正在加载详情...</p>
  if (!props.detail) return <p className="admin-empty">{props.emptyText}</p>
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

  if (props.section === 'tasks') {
    return <AdminTaskDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.section === 'agentWorkflow') {
    return <AdminAgentWorkflowDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.section === 'inspiration') {
    return <AdminInspirationDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.actionScope === 'users') {
    return <AdminUserDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.actionScope === 'routes') {
    return <AdminGatewayRouteDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.actionScope === 'bindings') {
    return <AdminGatewayBindingDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.actionScope === 'billingLedger') {
    return <AdminBillingLedgerDetailView detail={props.detail} selectedId={props.selectedId} />
  }

  if (props.actionScope === 'auditLogs') {
    return <AdminAuditLogDetailView detail={props.detail} selectedId={props.selectedId} />
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

function buildSummaryPath(basePath: string, filters: Record<string, string>) {
  const [pathname, query = ''] = basePath.split('?')
  const params = new URLSearchParams(query)
  Object.entries(filters).forEach(([key, value]) => {
    const trimmed = value.trim()
    if (trimmed) params.set(key, trimmed)
    else params.delete(key)
  })
  const serialized = params.toString()
  return serialized ? `${pathname}?${serialized}` : pathname
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

function readAdminFilterMemory(): Record<string, Record<string, string>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(ADMIN_FILTER_MEMORY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => isRecord(value))
        .map(([key, value]) => {
          const recordValue = value as Record<string, unknown>
          return [key, Object.fromEntries(Object.entries(recordValue).map(([fieldKey, fieldValue]) => [fieldKey, String(fieldValue ?? '')]))]
        }),
    )
  } catch {
    return {}
  }
}

function writeAdminFilterMemory(scope: string, filters: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    const memory = readAdminFilterMemory()
    memory[scope] = filters
    window.localStorage.setItem(ADMIN_FILTER_MEMORY_STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // ignore storage failures
  }
}

function getRememberedFilters(scope: string) {
  const memory = readAdminFilterMemory()
  return memory[scope] ?? null
}

function readAdminRecentViews(): AdminRecentViewEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ADMIN_RECENT_VIEWS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => {
        const section = String(item.section ?? '')
        if (!section || section === 'dashboard') return null
        return {
          section: section as Exclude<AdminSectionKey, 'dashboard'>,
          scope: String(item.scope ?? ''),
          sectionLabel: String(item.sectionLabel ?? ''),
          subsectionLabel: String(item.subsectionLabel ?? ''),
          filters: isRecord(item.filters)
            ? Object.fromEntries(Object.entries(item.filters).map(([key, value]) => [key, String(value ?? '')]))
            : {},
          updatedAt: String(item.updatedAt ?? ''),
        }
      })
      .filter((item): item is AdminRecentViewEntry => Boolean(item?.scope))
  } catch {
    return []
  }
}

function writeAdminRecentView(entry: AdminRecentViewEntry) {
  if (typeof window === 'undefined') return
  try {
    const current = readAdminRecentViews()
    const next = [
      entry,
      ...current.filter((item) => !(item.section === entry.section && item.scope === entry.scope)),
    ].slice(0, 8)
    window.localStorage.setItem(ADMIN_RECENT_VIEWS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
}

function getRecentAdminViews(section: Exclude<AdminSectionKey, 'dashboard'>) {
  return readAdminRecentViews().filter((item) => item.section === section)
}

function areAdminFiltersEqual(left: Record<string, string>, right: Record<string, string>) {
  const leftEntries = Object.entries(left).filter(([, value]) => value)
  const rightEntries = Object.entries(right).filter(([, value]) => value)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => (right[key] ?? '') === value)
}

function formatAdminRecentViewSubtitle(entry: AdminRecentViewEntry) {
  const filters = getActiveFilterEntries(entry.filters)
  if (!filters.length) return '恢复默认列表范围'
  return filters.slice(0, 2).map(([key, value]) => formatAdminFilterLabel(key, value)).join(' · ')
}

function getAdminQuickFilters(scope: string): AdminQuickFilter[] {
  if (scope === 'users') {
    return [
      { label: '全部用户', values: {} },
      { label: '仅停用', values: { status: 'disabled' } },
      { label: '未验证邮箱', values: { emailVerified: 'false' } },
      { label: '有充值', values: { hasRecharged: 'true' } },
      { label: '有生成', values: { hasGenerated: 'true' } },
    ]
  }
  if (scope === 'billingLedger') {
    return [
      { label: '全部流水', values: {} },
      { label: '生图扣点', values: { type: 'image_generation_charge' } },
      { label: '后台调整', values: { type: 'admin_adjustment' } },
      { label: '充值兑换', values: { type: 'recharge_code_redeem' } },
    ]
  }
  if (scope === 'routes') {
    return [
      { label: '全部线路', values: {} },
      { label: '仅启用', values: { enabled: 'true' } },
    ]
  }
  if (scope === 'modelSkus') {
    return [
      { label: '全部模型', values: {} },
      { label: '仅启用', values: { enabled: 'true' } },
      { label: '支持编辑', values: { supportsEdit: 'true' } },
      { label: '支持蒙版', values: { supportsMask: 'true' } },
    ]
  }
  if (scope === 'bindings') {
    return [
      { label: '全部绑定', values: {} },
      { label: '按模型查', values: { modelSkuId: '' } },
      { label: '按线路查', values: { routeId: '' } },
    ]
  }
  if (scope === 'tasks') {
    return [
      { label: '全部任务', values: {} },
      { label: '失败任务', values: { status: 'failed' } },
      { label: '执行中', values: { status: 'running' } },
      { label: '仅扣点', values: { chargedOnly: 'true' } },
    ]
  }
  if (scope === 'agentWorkflow') {
    return [
      { label: '全部 Run', values: {} },
      { label: '失败 Run', values: { status: 'failed' } },
      { label: '运行中', values: { status: 'running' } },
      { label: '已确认未启动', values: { attention: 'confirmed_not_started' } },
      { label: '成功未沉淀', values: { attention: 'succeeded_without_recipe' } },
      { label: '归档项目', values: { projectStatus: 'archived' } },
    ]
  }
  if (scope === 'inspiration') {
    return [
      { label: '全部帖子', values: {} },
      { label: 'AI 推荐精选', values: { queue: 'featured_candidates' } },
      { label: '待复核', values: { queue: 'needs_review' } },
      { label: '自动隐藏', values: { queue: 'auto_hidden' } },
      { label: '最新展示', values: { queue: 'latest' } },
    ]
  }
  if (scope === 'templates') {
    return [
      { label: '全部模板', values: {} },
      { label: '海报插画', values: { category: '海报插画' } },
      { label: '人像摄影', values: { category: '人像摄影' } },
      { label: '产品静物', values: { category: '产品静物' } },
    ]
  }
  if (scope === 'candidates') {
    return [
      { label: '待审核', values: { status: 'pending' } },
      { label: '已通过', values: { status: 'approved' } },
      { label: '已拒绝', values: { status: 'rejected' } },
    ]
  }
  return []
}

function getSelectedLabel(section: Exclude<AdminSectionKey, 'dashboard'>, selectedId: string, selectedLabel: string, actionScope: string) {
  if (!selectedId) {
    if (actionScope === 'redemptionAttempts') return '这里主要用于查兑换记录、看失败原因和打开详情继续追踪。'
    if (section === 'rechargeCodes') return '生成批次和导出可以直接做；禁用某一条兑换码前，先在左侧选中记录。'
    if (section === 'gateway') return '新增可以直接做；更新线路、模型或绑定规则前，先在左侧选中对应记录。'
    if (section === 'content') return '先选中候选、模板或导入任务，再做通过、拒绝、更新或继续核对。'
    if (section === 'inspiration') return '先选中帖子，再做隐藏、恢复公开、分类修正或重跑 AI 初审。'
    if (section === 'agentWorkflow') return '先选中 Run，再查看任务链路、步骤流、配方沉淀和运营处理记录。'
    return '先在左侧选中一条记录，右侧才会显示对应操作。'
  }
  return `已选中：${selectedLabel || selectedId}`
}

function getModuleWorkflow(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>) {
  if (config.listKey === 'posts') {
    return [
      '先看 AI 初审和展示状态',
      '按队列、分类或发布账号缩小范围',
      '选中帖子后再处理公开信息和可见性',
    ]
  }
  if (config.listKey === 'shares') {
    return [
      '先看分享状态和审核结果',
      '按用户、任务或时间筛选',
      '选中记录后再核对分享内容',
    ]
  }
  if (config.listKey === 'agentRuns') {
    return [
      '先看 Run 状态和项目状态',
      '按用户、失败类型或来源缩小范围',
      '选中 Run 后核对任务链路与步骤流',
    ]
  }
  if (config.listKey === 'attempts') {
    return [
      '先看兑换成功还是失败',
      '按用户、失败原因或时间筛选',
      '选中记录后再看详情和上下文',
    ]
  }
  if (config.listKey === 'templates' || config.listKey === 'candidates' || config.listKey === 'importRuns') {
    return [
      '先导入或查看候选',
      '人工确认标题、分类、图片和来源',
      '通过后再进入前台模板库',
    ]
  }
  if (section === 'rechargeCodes') {
    return [
      '先看批次和兑换状态',
      '选中某条码核对当前状态',
      '再决定生成、导出还是禁用',
    ]
  }
  if (section === 'content') {
    return [
      `先查看和筛选${config.title}`,
      '选中记录后看详情和预览',
      '再在右侧做新增、导入或审核',
    ]
  }
  if (['rechargeCodes', 'gateway'].includes(section)) {
    return [
      `先查看和筛选${config.title}`,
      '选中记录后看当前状态',
      '再在右侧做创建、更新或删除',
    ]
  }
  return [
    `先定位要处理的${config.title}`,
    '选中记录后查看上下文',
    '再在右侧继续处理',
  ]
}

function getFilterTitle(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>) {
  if (config.listKey === 'posts') return '筛选广场内容'
  if (config.listKey === 'shares') return '筛选分享记录'
  if (config.listKey === 'agentRuns') return '筛选 Agent Run'
  if (config.listKey === 'attempts') return '筛选兑换记录'
  if (section === 'rechargeCodes') return '筛选充值码'
  return '筛选列表'
}

function getFilterHint(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>, filterCount: number) {
  if (config.listKey === 'posts') return '按队列、状态、分类或发布账号快速缩小范围'
  if (config.listKey === 'shares') return '按分享状态、用户、任务或时间快速定位记录'
  if (config.listKey === 'agentRuns') return '按用户、状态、来源、失败类型或项目关键词定位 Run'
  if (config.listKey === 'attempts') return '按充值码、用户、结果或时间快速定位兑换记录'
  if (section === 'rechargeCodes') return '按状态、批次或兑换用户快速定位兑换码'
  return filterCount ? `先缩小范围，再处理${config.title}记录` : '可以先按条件筛，再逐条查看'
}

function getActiveFilterEntries(filters: Record<string, string>) {
  return Object.entries(filters).filter(([, value]) => value.trim())
}

function formatAdminFilterLabel(key: string, value: string) {
  const labels: Record<string, string> = {
    email: '邮箱',
    status: '状态',
    emailVerified: '邮箱验证',
    hasRecharged: '有充值',
    hasGenerated: '有生成',
    user: '发布来源',
    type: '类型',
    relatedId: '关联记录',
    createdByAdmin: '管理员',
    dateFrom: '开始日期',
    dateTo: '结束日期',
    batchNo: '批次',
    redeemedByUser: '兑换用户',
    redeemedByUserLabel: '兑换用户',
    result: '结果',
    failureKind: '失败类型',
    modelSku: '模型标识',
    routeId: '线路标识',
    healthStatus: '健康状态',
    enabledOnly: '仅启用',
    category: '分类',
    title: '标题',
    sourceType: '来源类型',
    projectStatus: '项目状态',
    attention: '异常队列',
    generationTaskId: '任务编号',
    sourceUrl: '来源',
    q: '关键词',
    search: '搜索',
    queue: '队列',
    action: '动作',
    targetType: '目标类型',
    adminUserId: '管理员',
    requiresAccessCode: '访问码',
  }
  return `${labels[key] ?? humanizeAdminKey(key)}：${value}`
}

function getSubsectionLabel(params: {
  section: Exclude<AdminSectionKey, 'dashboard'>
  userSubsection: UserSubsectionKey
  rechargeSubsection: RechargeSubsectionKey
  gatewaySubsection: GatewaySubsectionKey
  contentSubsection: ContentSubsectionKey
  growthSubsection: GrowthSubsectionKey
}) {
  if (params.section === 'users') return USER_SUBSECTIONS.find((item) => item.key === params.userSubsection)?.label ?? ''
  if (params.section === 'rechargeCodes') return RECHARGE_SUBSECTIONS.find((item) => item.key === params.rechargeSubsection)?.label ?? ''
  if (params.section === 'gateway') return GATEWAY_SUBSECTIONS.find((item) => item.key === params.gatewaySubsection)?.label ?? ''
  if (params.section === 'content') return CONTENT_SUBSECTIONS.find((item) => item.key === params.contentSubsection)?.label ?? ''
  if (params.section === 'growth') return GROWTH_SUBSECTIONS.find((item) => item.key === params.growthSubsection)?.label ?? ''
  return ADMIN_SECTIONS.find((item) => item.key === params.section)?.label ?? ''
}

function getAdminSectionLabel(section: Exclude<AdminSectionKey, 'dashboard'>) {
  return ADMIN_SECTIONS.find((item) => item.key === section)?.label ?? ''
}

function getAdminScopeEmptyText(params: { error: string; loading: boolean; hasFilters: boolean }) {
  if (params.loading) return '列表正在加载，请稍候。'
  if (params.error) return '列表加载失败。建议先刷新当前列表；如果还是失败，再检查筛选条件或接口状态。'
  if (params.hasFilters) return '当前筛选范围内没有记录。可以清空筛选，或换一个快捷筛选再试。'
  return '当前列表还没有数据。可以先创建第一条记录，或切换到别的子模块看看。'
}

function getAdminDetailEmptyText(params: { error: string; selectedId: string }) {
  if (params.error && params.selectedId) return '详情加载失败。请重试，或重新选择一条记录。'
  if (params.selectedId) return '这条记录暂时没有更多可展示详情。'
  return '先从左侧列表选中一条记录，这里才会显示业务详情。'
}

function getAdminSummaryFallback(params: { error: string; loading: boolean }) {
  if (params.loading) return '模块摘要正在加载，请稍候。'
  if (params.error) return '模块摘要暂时不可用。你可以先继续看列表和详情，不影响处理。'
  return '当前模块暂时没有更多摘要信息。'
}

function getAdminModuleStatus(params: {
  error: string
  loading: boolean
  detailLoading: boolean
  hasRows: boolean
  hasFilters: boolean
  selectedId: string
}) {
  if (params.error) {
    return {
      tone: 'error' as const,
      title: '当前请求失败',
      detail: '建议先刷新当前列表；如果仍失败，再检查筛选条件、接口状态或数据库连接。',
    }
  }
  if (params.loading) {
    return {
      tone: 'loading' as const,
      title: '正在刷新当前列表',
      detail: '后台正在拉取最新数据，当前筛选和分页会继续保留。',
    }
  }
  if (params.detailLoading) {
    return {
      tone: 'loading' as const,
      title: '正在加载右侧详情',
      detail: '详情返回后会自动替换，无需重复点击。',
    }
  }
  if (!params.hasRows) {
    return {
      tone: 'neutral' as const,
      title: params.hasFilters ? '当前筛选下暂无结果' : '当前列表暂无数据',
      detail: params.hasFilters ? '可以清空筛选、切换快捷筛选，或返回最近使用入口。' : '可以先创建数据，或切换到更常用的子模块继续处理。',
    }
  }
  return {
    tone: 'ready' as const,
    title: params.selectedId ? '当前列表已可继续处理' : '当前列表已准备好',
    detail: params.selectedId ? '左侧列表、右侧详情和批量勾选可以并行使用。' : '点击列表行查看详情；需要批量操作时先勾选记录。',
  }
}

function getListTitle(config: AdminModuleConfig, section: Exclude<AdminSectionKey, 'dashboard'>) {
  if (config.listKey === 'posts') return '广场帖子'
  if (config.listKey === 'shares') return '分享记录'
  if (config.listKey === 'agentRuns') return 'Agent Run'
  if (config.listKey === 'attempts') return '兑换记录'
  if (section === 'rechargeCodes') return '充值码库存'
  return `${config.title}列表`
}

function getActionPanelTitle(actionScope: string) {
  if (actionScope === 'codes') return '制码 / 导出 / 禁用'
  if (actionScope === 'redemptionAttempts') return '兑换记录'
  if (actionScope === 'tasks') return '任务记录'
  if (actionScope === 'agentWorkflow') return '观测详情'
  if (actionScope === 'inspiration') return '精选 / 隐藏 / 恢复'
  if (actionScope === 'candidates') return '候选审核 / 发布'
  if (actionScope === 'importRuns') return '导入任务'
  return '主要操作'
}

function shouldShowActionPanelInWorkspace(actionScope: string) {
  return ['strategy'].includes(actionScope)
}

function getAdminDataLayoutClassName(params: {
  section: Exclude<AdminSectionKey, 'dashboard'>
  actionScope: string
  isContentModule: boolean
}) {
  const names = ['admin-data-layout']
  if (params.isContentModule) names.push('admin-content-data-layout')
  if (params.section === 'users' && params.actionScope === 'users') names.push('admin-user-workbench-layout')
  if (params.section === 'rechargeCodes') names.push('admin-recharge-workbench-layout')
  if (params.section === 'tasks') names.push('admin-task-workbench-layout')
  if (params.section === 'agentWorkflow') names.push('admin-task-workbench-layout')
  if (params.section === 'gateway') names.push('admin-gateway-data-layout')
  if (params.section === 'content') names.push('admin-content-workbench-layout')
  if (params.section === 'inspiration') names.push('admin-audit-workbench-layout')
  if (params.section === 'shares') names.push('admin-audit-workbench-layout')
  return names.join(' ')
}

function shouldUseInlineWorkbench(params: {
  section: Exclude<AdminSectionKey, 'dashboard'>
  actionScope: string
}) {
  return (params.section === 'users' && params.actionScope === 'users') || params.section === 'tasks' || params.section === 'agentWorkflow' || params.section === 'shares' || params.section === 'inspiration'
}

function AdminDetailQuickActions(props: {
  title?: string
  actions: Array<{ label: string; onClick: () => void }>
}) {
  if (!props.actions.length) return null
  return (
    <details className="admin-detail-actions-disclosure">
      <summary>
        <strong>{props.title || '关联操作'}</strong>
        <span>{props.actions.length} 项</span>
      </summary>
      <div className="admin-detail-actions">
        {props.actions.map((action) => (
          <button key={action.label} type="button" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
      </div>
    </details>
  )
}

function isReadOnlyActionScope(actionScope: string) {
  return ['billingLedger', 'referrals', 'creditRecords', 'growth', 'shares', 'auditLogs', 'redemptionAttempts'].includes(actionScope)
}

function getBulkDeleteConfig(params: {
  section: Exclude<AdminSectionKey, 'dashboard'>
  contentSubsection: ContentSubsectionKey
  gatewaySubsection: GatewaySubsectionKey
  isOfficialTemplateView: boolean
}) {
  if (params.section === 'users') {
    return {
      itemLabel: '用户',
      hint: '将按当前勾选顺序逐条删除用户，并同步清理该用户的余额、任务、分享等关联记录。',
      actionName: '批量删除用户',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/users/${encodeURIComponent(id)}`, token),
    }
  }

  if (params.section === 'gateway' && params.gatewaySubsection === 'routes') {
    return {
      itemLabel: '线路',
      hint: '将按当前勾选顺序逐条删除线路，并一并清理关联健康状态。',
      actionName: '批量删除线路',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/gateway-routes/${encodeURIComponent(id)}`, token),
    }
  }

  if (params.section === 'gateway' && params.gatewaySubsection === 'modelSkus') {
    return {
      itemLabel: '模型',
      hint: '将按当前勾选顺序逐条删除模型；相关模型可用线路绑定会由后端约束一起处理。',
      actionName: '批量删除模型',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/model-skus/${encodeURIComponent(id)}`, token),
    }
  }

  if (params.section === 'gateway' && params.gatewaySubsection === 'bindings') {
    return {
      itemLabel: '线路绑定',
      hint: '将按当前勾选顺序逐条删除模型和线路之间的可用绑定。',
      actionName: '批量删除绑定',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/model-route-bindings/${encodeURIComponent(id)}`, token),
    }
  }

  if (params.section === 'content' && params.contentSubsection === 'templates') {
    if (params.isOfficialTemplateView) {
      return {
        itemLabel: '官方模板',
        hint: '将把勾选模板从后台官方模板列表隐藏，不会改动前台静态模板源码。',
        actionName: '批量删除官方模板',
        deleteOne: (id: string, token: string) => adminDelete(`/api/admin/content/official-templates/${encodeURIComponent(id)}`, token),
      }
    }

    return {
      itemLabel: '模板',
      hint: '将按当前勾选顺序逐条删除已发布模板。',
      actionName: '批量删除模板',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/content/templates/${encodeURIComponent(id)}`, token),
    }
  }

  if (params.section === 'content' && params.contentSubsection === 'candidates') {
    return {
      itemLabel: '候选',
      hint: '将按当前勾选顺序逐条删除候选审核记录；已经通过并发布为模板的候选不会允许直接删除。',
      actionName: '批量删除候选',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/content/template-candidates/${encodeURIComponent(id)}`, token),
    }
  }

  if (params.section === 'content' && params.contentSubsection === 'importRuns') {
    return {
      itemLabel: '导入任务',
      hint: '将按当前勾选顺序逐条删除导入任务，同时清理该任务下的候选审核记录；已发布模板会保留，但会解除与导入任务的关联。',
      actionName: '批量删除导入任务',
      deleteOne: (id: string, token: string) => adminDelete(`/api/admin/content/template-import-runs/${encodeURIComponent(id)}`, token),
    }
  }

  return null
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
        <p>{props.loading ? '正在加载后台总览数据...' : props.error || '先从下方常用入口进入具体工作；首页的指标、任务和审计主要用于辅助判断当前优先级。'}</p>
      </div>

      <div className="admin-dashboard-overview">
        <section className="admin-panel admin-home-actions">
          <div className="admin-panel-head">
            <h2>常用处理入口</h2>
            <span>先进入当前最需要处理的一类工作</span>
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
            <h2>平台摘要</h2>
            <span>今日关键概况</span>
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
      </div>

      <div className="admin-dashboard-grid">
        <section className="admin-panel admin-dashboard-primary-panel">
          <div className="admin-panel-head">
            <h2>最新任务动态</h2>
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
        <section className="admin-panel admin-dashboard-secondary-panel">
          <div className="admin-panel-head">
            <h2>待关注风险</h2>
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
            <p className="admin-empty">当前没有需要额外关注的风险提醒。</p>
          )}
        </section>
        <section className="admin-panel admin-dashboard-secondary-panel">
          <div className="admin-panel-head">
            <h2>最近操作记录</h2>
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
      {actionScope === 'agentWorkflow' ? (
        <AgentWorkflowActions
          disabled={disabledBySubmit}
          selectedId={props.selectedId}
          selectedLabel={props.selectedLabel}
          selectedRecord={props.selectedRecord}
          onRun={runAction}
          token={props.token}
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
      {isReadOnlyActionScope(actionScope) ? (
        <p className="admin-empty">这个模块当前以查看、筛选和追踪详情为主，暂时没有额外写操作。</p>
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
    <div className="admin-action-grid admin-user-action-grid">
      <details className="admin-action-disclosure" open>
        <summary>
          <strong>余额调整</strong>
          <span>补发、扣回或修正点数</span>
        </summary>
        <form
          className="admin-action-form admin-user-action-form"
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
          <p className="admin-form-hint">正数加点，负数扣点。</p>
          <label>
            <span>点数变动</span>
            <input type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={disabled} />
          </label>
          <label>
            <span>原因</span>
            <textarea value={balanceReason} onChange={(event) => setBalanceReason(event.target.value)} required disabled={disabled} />
          </label>
          <button type="submit" disabled={disabled}>保存点数调整</button>
        </form>
      </details>

      <details className="admin-action-disclosure">
        <summary>
          <strong>账号状态</strong>
          <span>停用或恢复使用权限</span>
        </summary>
        <form
          className="admin-action-form admin-user-action-form"
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
          <p className="admin-form-hint">停用后前台不可继续使用。</p>
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
          <button type="submit" disabled={disabled}>保存账号状态</button>
        </form>
      </details>
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
  const featured = readRecordBoolean(props.selectedRecord, 'featured', false)
  const displayFit = readRecordString(props.selectedRecord, 'displayFit')
  const featuredRank = readRecordString(props.selectedRecord, 'featuredRank')
  const manualFeaturedSlot = readRecordString(props.selectedRecord, 'manualFeaturedSlot')
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
          <span>描述说明</span>
          <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={240} disabled={disabled} />
        </label>
        <button type="submit" disabled={disabled || !category.trim()}>保存公开信息</button>
      </form>

      <div className="admin-action-form">
        <h3>AI 展示结果与人工覆盖</h3>
        <p className="admin-form-hint">默认继续交给 AI 自动编排；只有首页门面需要干预时，才手动覆盖或恢复自动排序。</p>
        <div className="admin-summary-grid">
          <article className="admin-summary-card">
            <span>精选状态</span>
            <strong>{featured ? '已精选' : '未精选'}</strong>
          </article>
          <article className="admin-summary-card">
            <span>自动展示位</span>
            <strong>{displayFit ? formatAdminValue(displayFit) : '未计算'}</strong>
          </article>
          <article className="admin-summary-card">
            <span>精选位次</span>
            <strong>{featuredRank || '—'}</strong>
          </article>
          <article className="admin-summary-card">
            <span>控制来源</span>
            <strong>{manualFeaturedSlot ? `人工 ${manualFeaturedSlot === 'hero' ? '主视觉' : manualFeaturedSlot === 'secondary' ? '次级精选' : '排除精选'}` : 'AI 自动'}</strong>
          </article>
        </div>
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
          <div className="admin-inline-field">
            <select value={secondaryRank} onChange={(event) => setSecondaryRank(event.target.value)} disabled={disabled || status !== 'published'}>
              <option value="2">次级位 2</option>
              <option value="3">次级位 3</option>
              <option value="4">次级位 4</option>
            </select>
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
          </div>
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
            disabled={disabled || !manualFeaturedSlot}
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
            设为隐藏
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
            恢复公开展示
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
        <p className="admin-form-hint">当标题、说明或分类被修正后，可以重新跑一次初审分流，系统会刷新 AI 结论、质量分和状态。</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            void props.onRun('重跑 AI 初审', async () => {
              await adminPost(`/api/admin/inspiration-posts/${encodeURIComponent(props.selectedId)}/review-ai`, props.token)
            })
          }}
        >
          重新执行 AI 初审
        </button>
      </div>
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
        <p className="admin-empty">这里用于生成一整批可销售或可发放的兑换码。系统会自动生成批次号和兑换码编号，当前只支持 30 / 100 / 300 点。</p>
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

      <details className="admin-action-disclosure">
        <summary>
          <strong>禁用选中的码</strong>
          <span>{props.selectedId ? selectedCanBeDisabled ? '可处理当前选中码' : '当前状态不可禁用' : '选择记录后处理'}</span>
        </summary>
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
          <p className="admin-empty">
            {props.selectedId
              ? selectedCanBeDisabled
                ? `将禁用：${props.selectedLabel || props.selectedId}`
                : '只有启用状态的充值码可以停用。'
              : '先在左侧选择一条充值码。禁用后，这条码将不能再被用户继续兑换。'}
          </p>
          <label>
            <span>禁用原因</span>
            <textarea value={disableReason} onChange={(event) => setDisableReason(event.target.value)} required disabled={selectedDisabled} />
          </label>
          <button type="submit" disabled={selectedDisabled}>禁用充值码</button>
        </form>
      </details>

      <details className="admin-action-disclosure">
        <summary>
          <strong>导出批次 TXT</strong>
          <span>{exportBatchNo.trim() ? exportBatchNo.trim() : '按批次导出启用兑换码'}</span>
        </summary>
        <form className="admin-action-form">
          <p className="admin-empty">这里会按批次导出当前仍可用的完整兑换码。TXT 为一行一个码，适合给第三方店铺或渠道系统使用。</p>
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
      </details>
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
        <h3>任务处理面板</h3>
        <p className="admin-empty">先从左侧选中一条任务，右侧才会展示出图状态、扣点结果和失败排查信息。</p>
      </section>
    )
  }

  const failureKind = getValueByPath(props.selectedRecord, 'failureKind')
  const errorSummary = getValueByPath(props.selectedRecord, 'errorSummary')
  const chargedPoints = Number(getValueByPath(props.selectedRecord, 'chargedPoints') ?? 0)
  const ledgerId = getValueByPath(props.selectedRecord, 'ledgerId')
  const outputCount = getValueByPath(props.selectedRecord, 'outputCount')
  const userLabel = getAdminTaskUserDisplay(props.selectedRecord)
  const modelLabel = getAdminTaskModelDisplay(props.selectedRecord)
  const routeLabel = getAdminTaskRouteDisplay(props.selectedRecord)

  return (
    <div className="admin-action-grid">
      <section className="admin-action-form admin-action-form-wide">
        <h3>任务概况</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>任务编号</span><strong><AdminValue fieldKey="id" value={getValueByPath(props.selectedRecord, 'id')} /></strong></div>
          <div><span>用户</span><strong>{formatAdminValue(userLabel)}</strong></div>
          <div><span>状态</span><strong><AdminValue fieldKey="status" value={getValueByPath(props.selectedRecord, 'status')} /></strong></div>
          <div><span>模型</span><strong>{formatAdminValue(modelLabel)}</strong></div>
          <div><span>线路</span><strong>{formatAdminValue(routeLabel)}</strong></div>
        </div>
      </section>

      <section className="admin-action-form admin-action-form-wide">
        <h3>出图与扣点</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>扣点</span><strong>{chargedPoints > 0 ? `${chargedPoints} 点` : '未扣点'}</strong></div>
          <div><span>生成张数</span><strong>{formatAdminValue(outputCount ?? '-')}</strong></div>
          <div><span>流水记录</span><strong>{ledgerId ? <AdminValue fieldKey="ledgerId" value={ledgerId} /> : '无扣点流水'}</strong></div>
        </div>
        <p className="admin-form-hint">这里用于确认这条任务有没有成功出图、有没有发生扣点，以及后续该去看账务还是看失败排查。</p>
      </section>

      <section className="admin-action-form admin-action-form-wide">
        <h3>失败说明</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>失败类型</span><strong>{failureKind ? <AdminValue fieldKey="failureKind" value={failureKind} /> : '-'}</strong></div>
          <div><span>错误摘要</span><strong>{errorSummary ? formatAdminValue(errorSummary) : '-'}</strong></div>
        </div>
        <p className="admin-form-hint">如需继续定位线路、请求或上游报错，请在详情区查看“失败排查”和原始数据。</p>
      </section>
    </div>
  )
}

function AgentWorkflowActions(props: {
  disabled: boolean
  selectedId: string
  selectedLabel: string
  selectedRecord: Record<string, unknown> | null
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [type, setType] = useState('needs_operator')
  const [note, setNote] = useState('')
  const selectedDisabled = props.disabled || !props.selectedId
  const latestIntervention = props.selectedRecord ? getAgentRunAdminInterventions(props.selectedRecord)[0] : null

  useEffect(() => {
    setType('needs_operator')
    setNote('')
  }, [props.selectedId])

  if (!props.selectedId || !props.selectedRecord) {
    return (
      <section className="admin-action-form admin-action-form-wide">
        <h3>运营处理</h3>
        <p className="admin-empty">先从左侧选中一条 Agent Run，再记录人工复核、已处理或配方沉淀建议。</p>
      </section>
    )
  }

  return (
    <div className="admin-action-grid admin-agent-action-grid">
      <section className="admin-action-form admin-action-form-wide">
        <h3>Run 摘要</h3>
        <div className="admin-strategy-list admin-record-list">
          <div><span>Run</span><strong><AdminValue fieldKey="id" value={getValueByPath(props.selectedRecord, 'id')} /></strong></div>
          <div><span>用户</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'userLabel'))}</strong></div>
          <div><span>状态</span><strong><AdminValue fieldKey="status" value={getValueByPath(props.selectedRecord, 'status')} /></strong></div>
          <div><span>配方</span><strong>{formatAdminValue(getValueByPath(props.selectedRecord, 'recipeCount'))}</strong></div>
        </div>
        <p className="admin-form-hint">
          {latestIntervention
            ? `最近处理：${getAgentInterventionTypeLabel(getValueByPath(latestIntervention, 'type'))} / ${formatAdminValue(getValueByPath(latestIntervention, 'createdAt'))}`
            : '当前 Run 还没有人工处理记录。'}
        </p>
      </section>

      <form
        className="admin-action-form admin-action-form-wide"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('记录 Agent 处理', async () => {
            await adminPost(`/api/admin/agent-runs/${encodeURIComponent(props.selectedId)}/interventions`, props.token, {
              type,
              note: note.trim(),
            })
          })
        }}
      >
        <h3>记录处理</h3>
        <p className="admin-empty">{`将处理：${props.selectedLabel || props.selectedId}`}</p>
        <label>
          <span>处理类型</span>
          <select value={type} onChange={(event) => setType(event.target.value)} disabled={selectedDisabled}>
            {AGENT_INTERVENTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>处理备注</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
            disabled={selectedDisabled}
            placeholder="记录失败原因、人工复核结论或配方沉淀建议"
          />
        </label>
        <button type="submit" disabled={selectedDisabled || !note.trim()}>保存处理记录</button>
      </form>
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
  const [defaultUpstreamModel, setDefaultUpstreamModel] = useState('')
  const [notes, setNotes] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [isOfficial, setIsOfficial] = useState(false)
  const [preflightSummary, setPreflightSummary] = useState<GatewayRoutePreflightSummary | null>(null)
  const [preflightResults, setPreflightResults] = useState<GatewayRoutePreflightResult[]>([])
  const [probeSummary, setProbeSummary] = useState<GatewayRouteProbeBatchSummary | null>(null)
  const [probeResults, setProbeResults] = useState<GatewayRouteProbeResult[]>([])
  const [admissionHint, setAdmissionHint] = useState('')
  const selectedRouteName = readRecordString(props.selectedRecord, 'name') || props.selectedId

  const runSelectedRoutePreflight = (label: string) => {
    void props.onRun(label, async () => {
      const payload = await adminPost<{ route: GatewayRoutePreflightResult }>(
        `/api/admin/gateway-routes/${encodeURIComponent(props.selectedId)}/preflight`,
        props.token,
      )
      setPreflightSummary(null)
      setPreflightResults(payload.route ? [payload.route] : [])
    })
  }

  const runBatchRoutePreflight = (label: string) => {
    void props.onRun(label, async () => {
      const payload = await adminPost<{
        summary: GatewayRoutePreflightSummary
        routes: GatewayRoutePreflightResult[]
      }>('/api/admin/gateway-routes/preflight', props.token)
      setPreflightSummary(payload.summary ?? null)
      setPreflightResults(Array.isArray(payload.routes) ? payload.routes : [])
    })
  }

  const runSelectedRouteProbe = (label: string, sizes?: string[]) => {
    void props.onRun(label, async () => {
      const payload = await adminPost<{ probe: GatewayRouteProbeResult }>(
        `/api/admin/gateway-routes/${encodeURIComponent(props.selectedId)}/probe-high-res`,
        props.token,
        sizes ? { sizes } : undefined,
      )
      setProbeSummary(null)
      setProbeResults(payload.probe ? [payload.probe] : [])
    })
  }

  const runBatchRouteProbe = (label: string, sizes?: string[]) => {
    void props.onRun(label, async () => {
      const payload = await adminPost<{ summary: GatewayRouteProbeBatchSummary; probes: GatewayRouteProbeResult[] }>(
        '/api/admin/gateway-routes/probe-high-res',
        props.token,
        sizes ? { sizes } : undefined,
      )
      setProbeSummary(payload.summary ?? null)
      setProbeResults(Array.isArray(payload.probes) ? payload.probes : [])
    })
  }

  useEffect(() => {
    setAdmissionHint('')
    setPreflightSummary(null)
    setPreflightResults([])
    setProbeSummary(null)
    setProbeResults([])
  }, [props.selectedId])

  useEffect(() => {
    if (!props.selectedId) {
      setName('')
      setBaseUrl('')
      setApiKeyRef('')
      setShowApiKeyRef(false)
      setDefaultUpstreamModel('')
      setNotes('')
      setEnabled(true)
      setIsOfficial(false)
      return
    }
    setName(readRecordString(props.selectedRecord, 'name'))
    setBaseUrl(readRecordString(props.selectedRecord, 'baseUrl'))
    setApiKeyRef('')
    setShowApiKeyRef(false)
    setDefaultUpstreamModel(readRecordString(props.selectedRecord, 'defaultUpstreamModel'))
    setNotes(readRecordString(props.selectedRecord, 'notes'))
    setEnabled(readRecordBoolean(props.selectedRecord, 'enabled', true))
    setIsOfficial(readRecordBoolean(props.selectedRecord, 'isOfficial', false))
  }, [props.selectedId, props.selectedRecord])

  const buildRoutePayload = () => {
    const payload: {
      name: string
      provider: string
      baseUrl: string
      apiKeyRef?: string
      defaultUpstreamModel?: string
      notes?: string
      enabled: boolean
      isOfficial: boolean
    } = {
      name: name.trim(),
      provider: 'openai-compatible',
      baseUrl: baseUrl.trim(),
      defaultUpstreamModel: defaultUpstreamModel.trim(),
      notes: readOptionalText(notes),
      enabled,
      isOfficial,
    }
    const nextApiKeyRef = apiKeyRef.trim()
    if (!props.selectedId || nextApiKeyRef) {
      payload.apiKeyRef = nextApiKeyRef
    }
    return payload
  }

  return (
    <div className="admin-action-grid admin-gateway-action-grid">
      <div className="admin-gateway-action-column">
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
                setAdmissionHint('线路已创建。请在左侧列表选中新线路，先做“检查选中连通性”；通过后再执行真实 2K / 4K 实测。')
              }
            })
          }}
        >
          <h3>{props.selectedId ? '编辑选中线路' : '创建生成线路'}</h3>
          <div className="admin-form-row">
            <label>
              <span>线路名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
            </label>
          </div>
          <p className="admin-form-hint">这里维护“真实会被后端调用的出图入口”。先配置这条线路默认该调用哪个模型名；如果某个模型在这条线路上需要特殊别名，再去“模型可用线路”里单独填模型别名。</p>
          <label>
            <span>接口地址</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required={!props.selectedId} disabled={props.disabled} />
          </label>
          <label>
            <span>默认模型名</span>
            <input
              value={defaultUpstreamModel}
              onChange={(event) => setDefaultUpstreamModel(event.target.value)}
              placeholder="留空则按系统默认 gpt-image-2"
              disabled={props.disabled}
            />
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
          <div className="admin-checkbox-group">
            <label className="admin-checkbox-row">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={props.disabled} />
              <span>启用线路</span>
            </label>
            <label className="admin-checkbox-row">
              <input type="checkbox" checked={isOfficial} onChange={(event) => setIsOfficial(event.target.checked)} disabled={props.disabled} />
              <span>官方线路</span>
            </label>
          </div>
          <button type="submit" disabled={props.disabled}>{props.selectedId ? '更新线路' : '创建线路'}</button>
          {admissionHint ? <p className="admin-form-hint is-strong">{admissionHint}</p> : null}
        </form>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中线路"
        hint="删除线路会同时删除它关联的模型可用线路和健康状态。"
        actionName="删除线路"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/gateway-routes/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
      </div>

      <div className="admin-gateway-action-column admin-gateway-result-column">
        <details className="admin-action-disclosure admin-gateway-probe-disclosure">
          <summary>
            <strong>新线路准入检查</strong>
            <span>{preflightSummary ? `可烟测 ${preflightSummary.readyForSmokeCount} 条` : props.selectedId ? `当前选中：${selectedRouteName}` : '连通性检查'}</span>
          </summary>
          <section className="admin-action-form admin-action-form-wide">
            <div className="admin-gateway-section-head">
              <div>
                <h3>新线路准入检查</h3>
                <p className="admin-empty">先确认这条线路“能连上、能鉴权、能返回模型列表”，再决定要不要继续做真实出图测试。这里不会消耗生图额度。</p>
              </div>
              {props.selectedId ? <span className="admin-gateway-selection-tag">当前选中：{selectedRouteName}</span> : null}
            </div>
            <div className="admin-admission-flow" aria-label="新线路准入流程">
              <div><span>1</span><strong>创建线路</strong><small>填写名称、接口地址和密钥环境变量名。</small></div>
              <div><span>2</span><strong>检查连通性</strong><small>结果为“可做真实烟测”后再继续。</small></div>
              <div><span>3</span><strong>实测 2K / 4K</strong><small>真实出图后回写最高支持长边。</small></div>
              <div><span>4</span><strong>绑定模型上线</strong><small>前台尺寸档位跟随后端聚合能力开放。</small></div>
            </div>
            <div className="admin-button-row">
              <button
                type="button"
                disabled={props.disabled || !props.selectedId}
                onClick={() => runSelectedRoutePreflight('检查选中线路连通性')}
              >
                检查选中连通性
              </button>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => runBatchRoutePreflight('批量检查启用线路连通性')}
              >
                批量检查启用线路
              </button>
            </div>
            {preflightSummary ? (
              <div className="admin-strategy-list admin-record-list admin-probe-summary">
                <div><span>启用线路</span><strong>{preflightSummary.totalRoutes}</strong></div>
                <div><span>可做真实烟测</span><strong>{preflightSummary.readyForSmokeCount}</strong></div>
                <div><span>鉴权失败</span><strong>{preflightSummary.authFailedCount}</strong></div>
              </div>
            ) : null}
            {preflightResults.length ? (
              <div className="admin-probe-result-list">
                {preflightResults.map((route) => (
                  <article key={route.id} className="admin-probe-result-card">
                    <div className="admin-probe-result-head">
                      <strong>{route.name || route.id}</strong>
                      <span className={`admin-status-badge is-${getPreflightStatusTone(route)}`}>{formatPreflightStatusLabel(route)}</span>
                    </div>
                    <p>上游模型：{route.model || '-'} · 兼容策略：{route.compatibilityStrategy}</p>
                    <ul>
                      <li>{formatPreflightProbeLine('Base URL', route.baseProbe)}</li>
                      <li>{formatPreflightProbeLine('/models', route.modelsProbe)}</li>
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className="admin-form-hint">还没有本次连通性结果。新增线路建议先跑一次，通过后再做真实 2K / 4K 实测。</p>
            )}
          </section>
        </details>

        <details className="admin-action-disclosure admin-gateway-probe-disclosure">
          <summary>
            <strong>2K / 4K 线路实测</strong>
            <span>{probeSummary ? `2K ${probeSummary.available2kRouteCount} 条 · 4K ${probeSummary.available4kRouteCount} 条` : '真实请求上游，按需执行'}</span>
          </summary>
          <section className="admin-action-form admin-action-form-wide">
            <h3>2K / 4K 线路实测</h3>
            <p className="admin-empty">这里会真实请求上游出图，用来确认这条线路到底能不能稳定出 2K / 4K，而不是只看它宣称支持什么。</p>
            <div className="admin-button-row">
              <button
                type="button"
                disabled={props.disabled || !props.selectedId}
                onClick={() => runSelectedRouteProbe('测试选中线路 2K', ['2560x1440'])}
              >
                只测选中 2K
              </button>
              <button
                type="button"
                disabled={props.disabled || !props.selectedId}
                onClick={() => runSelectedRouteProbe('测试选中线路 4K', ['3840x2160'])}
              >
                只测选中 4K
              </button>
              <button
                type="button"
                disabled={props.disabled || !props.selectedId}
                onClick={() => runSelectedRouteProbe('完整测试选中线路 1K / 2K / 4K')}
              >
                完整测试选中
              </button>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => runBatchRouteProbe('批量筛选全部启用线路 2K', ['2560x1440'])}
              >
                批量只测 2K
              </button>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => runBatchRouteProbe('批量筛选全部启用线路 4K', ['3840x2160'])}
              >
                批量只测 4K
              </button>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => runBatchRouteProbe('批量完整筛选全部启用线路 1K / 2K / 4K')}
              >
                批量完整测试
              </button>
            </div>
            {probeSummary ? (
              <div className="admin-strategy-list admin-record-list admin-probe-summary admin-probe-summary-wide">
                <div><span>启用线路</span><strong>{probeSummary.totalRoutes}</strong></div>
                <div><span>真实 2K</span><strong>{probeSummary.available2kRouteCount}</strong></div>
                <div><span>真实 4K</span><strong>{probeSummary.available4kRouteCount}</strong></div>
                <div><span>无有效图片</span><strong>{probeSummary.brokenRouteCount}</strong></div>
              </div>
            ) : null}
            {probeResults.length ? (
              <div className="admin-probe-result-list">
                {probeResults.map((probe) => (
                  <article key={probe.routeId} className="admin-probe-result-card">
                    <div className="admin-probe-result-head">
                      <strong>{probe.routeName || probe.routeId}</strong>
                      <span className={`admin-status-badge is-${getProbeAdmissionTone(probe)}`}>{formatProbeAdmissionLabel(probe)}</span>
                    </div>
                    <p>上游模型：{probe.upstreamModel || '-'} · 结果摘要：{summarizeProbeResult(probe)}</p>
                    <ul>
                      {probe.tests.map((test) => (
                        <li key={`${probe.routeId}-${test.requestedSize}`}>{formatProbeTestLine(test)}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className="admin-form-hint">还没有本次探测结果。测试会真实请求上游并可能消耗额度，请只在需要筛线时执行。</p>
            )}
          </section>
        </details>
      </div>
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
        <h3>{props.selectedId ? '更新当前模型' : '创建生图模型'}</h3>
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
        <p className="admin-form-hint">模型标识是系统内部识别用的代号；显示名称才是后台和前台真正给人看的名字。通常保持简短、稳定、容易分辨即可。</p>
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
        <p className="admin-form-hint">如果你不想限制前台可选项，就保持“不限制”；只有当某个模型只想开放少数尺寸或质量档位时，才在这里收紧。</p>
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
  const [modelAlias, setModelAlias] = useState('')
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
      setModelAlias('')
      setPriority('100')
      setWeight('1')
      setTimeoutSeconds('60')
      setEnabled(true)
      return
    }
    const routeId = readRecordString(props.selectedRecord, 'routeId')
    setModelSkuId(readRecordString(props.selectedRecord, 'modelSkuId'))
    setSelectedRouteIds(routeId ? [routeId] : [])
    setModelAlias(readRecordString(props.selectedRecord, 'modelAlias') || readRecordString(props.selectedRecord, 'upstreamModel'))
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
  const selectedHealthState = readRecordString(props.selectedRecord, 'healthState') || readRecordString(props.selectedRecord, 'healthStatus')
  const selectedScore = readRecordString(props.selectedRecord, 'score')
  const runHealthAction = (action: 'schedule_probe' | 'force_observing' | 'isolate' | 'restore_primary', actionName: string) => {
    void props.onRun(actionName, async () => {
      if (!props.selectedId) throw new Error('请先选择一条模型可用线路')
      await adminPost(`/api/admin/model-route-bindings/${encodeURIComponent(props.selectedId)}/health-state`, props.token, { action })
    })
  }

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
              modelAlias: modelAlias.trim(),
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
          <p className="admin-empty">当前是在改“这一条已存在的绑定规则”。这里改的是调度参数，不会把模型或线路替换成别的对象。</p>
        ) : (
          <p className="admin-empty">当前是在给模型补可用线路。下面每勾选 1 条线路，保存后就会新增 1 条模型与线路的绑定关系。</p>
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
        <p className="admin-form-hint">同一个模型可以挂多条线路做主备和分流。前台用户只会选模型，真正走哪条线路由后端按你这里的顺序、权重和线路状态自动决定。</p>
        <label>
          <span>{props.selectedId ? '这条绑定的模型别名' : '这些绑定的模型别名'}</span>
          <input value={modelAlias} onChange={(event) => setModelAlias(event.target.value)} disabled={props.disabled} />
        </label>
        <p className="admin-form-hint">只有当某条线路要求这个模型使用特殊别名时才填写；留空时会直接使用该线路里的“默认模型名”。</p>
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
        actionName="删除模型可用线路"
        onRun={props.onRun}
        onDelete={() => adminDelete(`/api/admin/model-route-bindings/${encodeURIComponent(props.selectedId)}`, props.token)}
      />
      {props.selectedId ? (
        <section className="admin-action-form">
          <h3>线路自愈状态</h3>
          <div className="admin-strategy-list">
            <div><span>当前状态</span><strong>{selectedHealthState || '-'}</strong></div>
            <div><span>信用分</span><strong>{selectedScore || '-'}</strong></div>
          </div>
          <p className="admin-form-warning">安排探测会在下一次调度触发低成本真实上游 probe，可能消耗供应商额度；不会扣用户账户余额。</p>
          <div className="admin-action-button-row">
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => runHealthAction('schedule_probe', '安排线路探测')}
            >
              安排探测
            </button>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => runHealthAction('force_observing', '强制进入观察')}
            >
              强制观察
            </button>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => runHealthAction('restore_primary', '恢复主力状态')}
            >
              恢复主力
            </button>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => runHealthAction('isolate', '隔离模型线路')}
            >
              隔离线路
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function GatewayStrategyActions(props: {
  disabled: boolean
  token: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
}) {
  const [failoverEnabled, setFailoverEnabled] = useState(true)
  const [budgetWindowHours, setBudgetWindowHours] = useState('24')
  const [maxProbesPerRouteWindow, setMaxProbesPerRouteWindow] = useState('3')
  const [maxProbesPerTrigger, setMaxProbesPerTrigger] = useState('2')
  const [observingSuccessThreshold, setObservingSuccessThreshold] = useState('2')
  const [observingProbeDelayMinutes, setObservingProbeDelayMinutes] = useState('10')
  const [settingsError, setSettingsError] = useState('')

  useEffect(() => {
    let cancelled = false
    setSettingsError('')
    ;(async () => {
      try {
        const payload = await adminGet('/api/admin/gateway-strategy', props.token)
        if (cancelled) return
        const strategy = isRecord(getValueByPath(payload, 'strategy')) ? getValueByPath(payload, 'strategy') as Record<string, unknown> : {}
        const settings = isRecord(getValueByPath(strategy, 'recoveryProbeSettings')) ? getValueByPath(strategy, 'recoveryProbeSettings') as Record<string, unknown> : strategy
        setFailoverEnabled(readRecordBoolean(strategy, 'failoverEnabled', true))
        setBudgetWindowHours(readRecordString(settings, 'budgetWindowHours', '24'))
        setMaxProbesPerRouteWindow(readRecordString(settings, 'maxProbesPerRouteWindow', '3'))
        setMaxProbesPerTrigger(readRecordString(settings, 'maxProbesPerTrigger', '2'))
        setObservingSuccessThreshold(readRecordString(settings, 'observingSuccessThreshold', '2'))
        setObservingProbeDelayMinutes(readRecordString(settings, 'observingProbeDelayMinutes', '10'))
      } catch (error) {
        if (!cancelled) setSettingsError(getErrorMessage(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.token])

  const buildRecoveryProbeSettings = () => ({
    budgetWindowHours: Number(budgetWindowHours),
    maxProbesPerRouteWindow: Number(maxProbesPerRouteWindow),
    maxProbesPerTrigger: Number(maxProbesPerTrigger),
    observingSuccessThreshold: Number(observingSuccessThreshold),
    observingProbeDelayMinutes: Number(observingProbeDelayMinutes),
  })

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
            await adminPatch('/api/admin/gateway-strategy', props.token, {
              failoverEnabled,
              recoveryProbeSettings: buildRecoveryProbeSettings(),
            })
          })
        }}
      >
        <h3>故障切换</h3>
        {settingsError ? <p className="admin-form-error">{settingsError}</p> : null}
        <label className="admin-checkbox-row">
          <input type="checkbox" checked={failoverEnabled} onChange={(event) => setFailoverEnabled(event.target.checked)} disabled={props.disabled} />
          <span>线路失败时切换到其它可用线路</span>
        </label>
        <div className="admin-form-row">
          <label>
            <span>预算窗口(小时)</span>
            <input type="number" min="1" max="336" value={budgetWindowHours} onChange={(event) => setBudgetWindowHours(event.target.value)} disabled={props.disabled} />
          </label>
          <label>
            <span>单线路窗口 probe 上限</span>
            <input type="number" min="0" max="100" value={maxProbesPerRouteWindow} onChange={(event) => setMaxProbesPerRouteWindow(event.target.value)} disabled={props.disabled} />
          </label>
        </div>
        <div className="admin-form-row">
          <label>
            <span>单次触发线路数</span>
            <input type="number" min="0" max="20" value={maxProbesPerTrigger} onChange={(event) => setMaxProbesPerTrigger(event.target.value)} disabled={props.disabled} />
          </label>
          <label>
            <span>恢复成功阈值</span>
            <input type="number" min="1" max="20" value={observingSuccessThreshold} onChange={(event) => setObservingSuccessThreshold(event.target.value)} disabled={props.disabled} />
          </label>
        </div>
        <label>
          <span>观察探测间隔(分钟)</span>
          <input type="number" min="1" max="1440" value={observingProbeDelayMinutes} onChange={(event) => setObservingProbeDelayMinutes(event.target.value)} disabled={props.disabled} />
        </label>
        <p className="admin-form-hint">把单线路窗口 probe 上限或单次触发线路数设为 0，可临时停止自动恢复探测；手动隔离和恢复主力仍然可用。</p>
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
        <p className="admin-empty">左侧显示的是前台真实在用的官方模板。选中一条后，可以在这里核对图片、标题、提示词和来源。</p>
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
        <p className="admin-form-hint">这批模板来自前台官方模板库。删除只会让它不再出现在后台这份官方列表里，不会直接物理改动源码里的模板定义。</p>
      </section>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中官方模板"
        hint="删除后这条官方模板会从后台官方模板列表隐藏；前台静态模板源文件不会被物理改写。"
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
        <h3>{props.selectedId ? '更新当前模板' : '新增正式模板'}</h3>
        <p className="admin-form-hint">这里维护的是准备进入前台模板库的正式模板。标题、分类、提示词和图片路径尽量保持完整，方便前后台统一展示。</p>
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
        <button type="submit" disabled={props.disabled}>{props.selectedId ? '保存模板修改' : '创建正式模板'}</button>
      </form>
      <DeleteRecordAction
        disabled={props.disabled}
        selectedId={props.selectedId}
        label="删除选中模板"
        hint="删除后前台模板库不再显示这条模板；候选审核记录会保留，但不再关联该模板。"
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
  actionName: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
  onDelete: () => Promise<unknown>
}) {
  const disabled = props.disabled || !props.selectedId
  return (
    <form
      className="admin-action-form admin-action-form-danger"
      onSubmit={(event) => {
        event.preventDefault()
        void props.onRun(props.actionName, async () => {
          await props.onDelete()
        })
      }}
    >
      <h3>{props.label}</h3>
      <p className="admin-empty">{props.selectedId ? props.hint : '先在左侧选中一条记录，这里才能继续执行删除。'}</p>
      <button type="submit" disabled={disabled}>{props.label}</button>
    </form>
  )
}

function AdminModal(props: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!props.open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [props.onClose, props.open])

  if (!props.open) return null

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={props.title} onClick={props.onClose}>
      <div className="admin-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="admin-modal-head">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle ? <span>{props.subtitle}</span> : null}
          </div>
          <button type="button" className="admin-modal-close" onClick={props.onClose} aria-label="关闭详情弹窗">关闭</button>
        </div>
        <div className="admin-modal-body">{props.children}</div>
      </div>
    </div>
  )
}

function BulkDeleteRecordsAction(props: {
  disabled: boolean
  selectedIds: string[]
  itemLabel: string
  hint: string
  actionName: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
  onDelete: (selectedIds: string[]) => Promise<void>
}) {
  const disabled = props.disabled || !props.selectedIds.length

  return (
    <form
      className="admin-bulk-delete-bar"
      onSubmit={(event) => {
        event.preventDefault()
        void props.onRun(props.actionName, async () => {
          await props.onDelete(props.selectedIds)
        })
      }}
    >
      <div className="admin-bulk-delete-copy">
        <strong>{props.selectedIds.length ? `已勾选 ${props.selectedIds.length} 条${props.itemLabel}` : `先勾选要删除的${props.itemLabel}`}</strong>
        <span>{props.selectedIds.length ? props.hint : '勾选后仍然可以点行看详情；批量删除只会处理当前已勾选的记录。'}</span>
      </div>
      <button type="submit" disabled={disabled}>{props.actionName}</button>
    </form>
  )
}

function BulkUpdateRecordsAction(props: {
  disabled: boolean
  selectedIds: string[]
  itemLabel: string
  actionName: string
  hint: string
  onRun: (actionName: string, action: () => Promise<void>) => Promise<void>
  onUpdate: (selectedIds: string[]) => Promise<void>
}) {
  const disabled = props.disabled || !props.selectedIds.length
  return (
    <div className="admin-list-toolbar">
      <div className="admin-list-toolbar-head">
        <div>
          <strong>{props.selectedIds.length ? `准备处理 ${props.selectedIds.length} 条${props.itemLabel}` : `先勾选要处理的${props.itemLabel}`}</strong>
          <span>{props.selectedIds.length ? props.hint : '先勾选记录，随后就可以批量启用或停用。'}</span>
        </div>
      </div>
      <div className="admin-list-toolbar-actions">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            void props.onRun(props.actionName, async () => {
              await props.onUpdate(props.selectedIds)
            })
          }}
        >
          {props.actionName}
        </button>
      </div>
    </div>
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
    if (!props.selectedId || !props.selectedRecord) {
      setTitle('')
      setCategory('')
      setTags('')
      setReviewNote('')
      return
    }
    setTitle(readRecordString(props.selectedRecord, 'title'))
    setCategory(readRecordString(props.selectedRecord, 'category'))
    const rawTags = getValueByPath(props.selectedRecord, 'tags')
    setTags(Array.isArray(rawTags) ? rawTags.map(String).join('，') : readRecordString(props.selectedRecord, 'tags'))
    setReviewNote(readRecordString(props.selectedRecord, 'reviewNote'))
  }, [props.selectedId, props.selectedRecord])

  const pageUrl = getCurrentPageUrl()
  const approvalTips = getTemplateApprovalTips(pageUrl)
  const frontendVisibilityHref = getImportRunVisibilityNotice({}, pageUrl).href
  const disabled = props.disabled || !props.selectedId
  return (
    <div className="admin-action-grid">
      <CandidateReviewPreview selectedRecord={props.selectedRecord} />
      <form
        className="admin-action-form"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onRun('通过候选', async () => {
            const result = await adminPost(`/api/admin/content/template-candidates/${encodeURIComponent(props.selectedId)}/approve`, props.token, {
              title: readOptionalText(title),
              category: readOptionalText(category),
              tags: splitTextList(tags),
              reviewNote: readOptionalText(reviewNote),
            })
            const payload = isRecord(result) ? result : {}
            const publishedTitle = getValueByPath(payload, 'template.title')
              ?? getValueByPath(payload, 'candidate.title')
              ?? title
              ?? getValueByPath(props.selectedRecord ?? {}, 'title')
            throw new AdminActionNotice(buildTemplateApprovalSuccessMessage(publishedTitle, pageUrl))
          })
        }}
      >
        <h3>通过为模板</h3>
        <p className="admin-form-hint">通过前先把标题、分类和标签修顺。保存后，这条候选会转成正式模板，并进入前台模板库。</p>
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
        <TemplateVisibilityNotice
          title="通过后前台会看到什么"
          tone="info"
          lines={approvalTips}
          href={frontendVisibilityHref}
          ctaLabel="打开前台入口"
        />
        <button type="submit" disabled={disabled}>通过并生成模板</button>
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
        <p className="admin-form-hint">拒绝后，这条候选不会进入正式模板库。建议把拒绝原因写进审核备注，方便后续回看。</p>
        <button type="submit" disabled={disabled}>确认拒绝候选</button>
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
      <p className="admin-empty">粘贴一个网址或 GitHub 仓库链接后，系统会先抓取候选、下载图片并转成本地资源；只有人工审核通过后，才会进入前台模板库。</p>
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
  const actionScope = props.section === 'content'
    ? contentSubsection
    : props.section === 'users'
      ? userSubsection
      : props.section === 'rechargeCodes'
        ? rechargeSubsection
        : props.section === 'gateway'
          ? gatewaySubsection
          : props.section
  const showActionPanelInWorkspace = shouldShowActionPanelInWorkspace(actionScope)
  const shouldRenderActionPanel = !isReadOnlyActionScope(actionScope)
  const bulkDeleteConfig = getBulkDeleteConfig({
    section: props.section,
    contentSubsection,
    gatewaySubsection,
    isOfficialTemplateView,
  })
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [pageLimit, setPageLimit] = useState(25)
  const [pageOffset, setPageOffset] = useState(0)
  const [summary, setSummary] = useState<unknown>(null)
  const [listPayload, setListPayload] = useState<unknown>(null)
  const [detail, setDetail] = useState<unknown>(null)
  const [selectedId, setSelectedId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedLabel, setSelectedLabel] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null)
  const [userDetailModalOpen, setUserDetailModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [bulkSubmittingAction, setBulkSubmittingAction] = useState('')
  const [bulkActionMessage, setBulkActionMessage] = useState('')
  const [bulkActionTone, setBulkActionTone] = useState<'success' | 'error'>('success')
  const [inlineWorkbenchMode, setInlineWorkbenchMode] = useState<'detail' | 'action'>('detail')
  const rows = useMemo(() => getListRows(listPayload, config.listKey), [config.listKey, listPayload])
  const rowIds = useMemo(() => rows.map((row, index) => {
    const rawId = getValueByPath(row, config.detailIdKey)
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
    return id || `row-${index}`
  }), [config.detailIdKey, rows])
  const pagination = useMemo(() => getPagination(listPayload), [listPayload])
  const activeFilterEntries = useMemo(() => getActiveFilterEntries(filters), [filters])
  const filterFormKey = useMemo(() => (
    `${filterScope}:${activeFilterEntries.map(([key, value]) => `${key}=${value}`).join('&')}`
  ), [activeFilterEntries, filterScope])
  const subsectionLabel = useMemo(() => getSubsectionLabel({
    section: props.section,
    userSubsection,
    rechargeSubsection,
    gatewaySubsection,
    contentSubsection,
    growthSubsection,
  }), [contentSubsection, gatewaySubsection, growthSubsection, props.section, rechargeSubsection, userSubsection])
  const selectableRowIds = useMemo(() => rowIds.filter((id) => !id.startsWith('row-')), [rowIds])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedCount = selectedIds.length
  const allSelectableRowsSelected = selectableRowIds.length > 0 && selectableRowIds.every((id) => selectedIdSet.has(id))
  const listPath = useMemo(() => buildPath(config.listPath, pageLimit, pageOffset, filters), [config.listPath, filters, pageLimit, pageOffset])
  const summaryPath = useMemo(() => (
    config.summaryPath
      ? buildSummaryPath(config.summaryPath, props.section === 'agentWorkflow' ? filters : {})
      : ''
  ), [config.summaryPath, filters, props.section])
  const workflow = useMemo(() => getModuleWorkflow(config, props.section), [config, props.section])
  const quickFilters = useMemo(() => getAdminQuickFilters(filterScope), [filterScope])
  const recentViews = useMemo(() => getRecentAdminViews(props.section).filter((item) => !(item.scope === filterScope && areAdminFiltersEqual(item.filters, filters))).slice(0, 4), [filterScope, filters, props.section])
  const primaryFilterKeys = ADMIN_PRIMARY_FILTER_KEYS[filterScope] ?? []
  const splitFilterFields = primaryFilterKeys.length > 0
  const primaryFilterFields = useMemo(() => (
    splitFilterFields
      ? filterFields.filter((field) => primaryFilterKeys.includes(field.key))
      : filterFields
  ), [filterFields, primaryFilterKeys, splitFilterFields])
  const advancedFilterFields = useMemo(() => (
    splitFilterFields
      ? filterFields.filter((field) => !primaryFilterKeys.includes(field.key))
      : []
  ), [filterFields, primaryFilterKeys, splitFilterFields])
  const advancedFilterCount = useMemo(() => (
    advancedFilterFields.filter((field) => filters[field.key]?.trim()).length
  ), [advancedFilterFields, filters])
  const advancedFilterSummary = ADMIN_ADVANCED_FILTER_SUMMARY[filterScope] ?? '更多筛选条件'
  const moduleStatus = useMemo(() => getAdminModuleStatus({
    error,
    loading,
    detailLoading,
    hasRows: rows.length > 0,
    hasFilters: activeFilterEntries.length > 0,
    selectedId,
  }), [activeFilterEntries.length, detailLoading, error, loading, rows.length, selectedId])
  const detailEmptyText = useMemo(() => getAdminDetailEmptyText({ error, selectedId }), [error, selectedId])
  const summaryFallback = useMemo(() => getAdminSummaryFallback({ error, loading }), [error, loading])

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
    const officialTemplates = await loadAdminOfficialTemplates()
    const payload = getOfficialTemplateAdminPayload(officialTemplates, pageLimit, pageOffset, filters, hiddenIds)
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
      const summaryPayload = summaryPath ? await adminGet(summaryPath, props.token) : null
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
  }, [config.detailBasePath, config.listKey, isOfficialTemplateView, listPath, loadDetail, loadOfficialTemplateData, props.token, summaryPath])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSelectedId('')
    setSelectedIds([])
    setSelectedLabel('')
    setSelectedRecord(null)
    setDetail(null)
    const load = async () => {
      try {
        if (isOfficialTemplateView) {
          const overrides = await adminGet('/api/admin/content/official-template-overrides', props.token)
          const hiddenIds = getHiddenOfficialTemplateIds(overrides)
          const officialTemplates = await loadAdminOfficialTemplates()
          const payload = getOfficialTemplateAdminPayload(officialTemplates, pageLimit, pageOffset, filters, hiddenIds)
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
        const summaryPayload = summaryPath ? await adminGet(summaryPath, props.token) : null
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
  }, [filters, isOfficialTemplateView, listPath, pageLimit, pageOffset, props.token, summaryPath])

  useEffect(() => {
    const remembered = getRememberedFilters(filterScope)
    setFilters(remembered ? { ...getDefaultFiltersForScope(filterScope), ...remembered } : getDefaultFiltersForScope(filterScope))
    setPageOffset(0)
    setPageLimit(25)
  }, [filterScope])

  useEffect(() => {
    writeAdminFilterMemory(filterScope, filters)
  }, [filterScope, filters])

  useEffect(() => {
    setInlineWorkbenchMode('detail')
  }, [filterScope])

  useEffect(() => {
    writeAdminRecentView({
      section: props.section,
      scope: filterScope,
      sectionLabel: getAdminSectionLabel(props.section),
      subsectionLabel,
      filters,
      updatedAt: new Date().toISOString(),
    })
  }, [filterScope, filters, props.section, subsectionLabel])

  useEffect(() => {
    setSelectedIds((current) => {
      const next = current.filter((id) => rowIds.includes(id))
      return next.length === current.length ? current : next
    })
  }, [rowIds])

  const openDetail = async (row: Record<string, unknown>) => {
    const rawId = getValueByPath(row, config.detailIdKey)
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
    if (!id) return
    setSelectedRecord(row)
    setSelectedLabel(getRecordReadableLabel(row, config))
    if (!config.detailBasePath) {
      setSelectedId(id)
      setDetail(row)
      if (useUserDetailModal) setUserDetailModalOpen(true)
      return
    }
    if (isOfficialTemplateView) {
      setSelectedId(id)
      setDetail({ template: row })
      if (useUserDetailModal) setUserDetailModalOpen(true)
      return
    }
    await loadDetail(id)
    if (useUserDetailModal) setUserDetailModalOpen(true)
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

  const openLinkedList = (nextScope: string, nextFilters: Record<string, string>) => {
    if (props.section === 'users') {
      if (nextScope === 'billingLedger') setUserSubsection('billingLedger')
      if (nextScope === 'referrals') setUserSubsection('referrals')
      if (nextScope === 'creditRecords') setUserSubsection('creditRecords')
    }
    if (props.section === 'gateway') {
      if (nextScope === 'routes') setGatewaySubsection('routes')
      if (nextScope === 'bindings') setGatewaySubsection('bindings')
      if (nextScope === 'modelSkus') setGatewaySubsection('modelSkus')
    }
    setSelectedId('')
    setSelectedIds([])
    setSelectedLabel('')
    setSelectedRecord(null)
    setDetail(null)
    setUserDetailModalOpen(false)
    setPageOffset(0)
    setFilters({ ...getDefaultFiltersForScope(nextScope), ...nextFilters })
  }

  const openLinkedUserLedger = () => openLinkedList('billingLedger', { user: selectedId })
  const openLinkedUserReferrals = () => openLinkedList('referrals', { inviterUser: selectedId })
  const openLinkedUserCredits = () => openLinkedList('creditRecords', { user: selectedId })
  const openLinkedRouteBindings = () => openLinkedList('bindings', { routeId: selectedId })
  const openLinkedModels = () => openLinkedList('modelSkus', { enabled: 'true' })
  const openLinkedRoutes = () => openLinkedList('routes', { enabled: 'true' })

  const resetSubsectionState = () => {
    setFilters({})
    setPageOffset(0)
    setPageLimit(25)
    setSelectedId('')
    setSelectedIds([])
    setSelectedLabel('')
    setSelectedRecord(null)
    setDetail(null)
    setUserDetailModalOpen(false)
    setError('')
  }

  const switchSubsection = <T extends string>(current: T, next: T, setNext: (value: T) => void) => {
    if (current === next) return
    resetSubsectionState()
    setNext(next)
  }

  const handleActionComplete = async (actionName?: string) => {
    if (actionName?.includes('删除')) {
      setUserDetailModalOpen(false)
      await loadModuleData()
      return
    }
    await loadModuleData({ keepSelectedId: selectedId })
  }

  const runBulkAction = async (actionName: string, action: () => Promise<void>) => {
    setBulkSubmittingAction(actionName)
    setBulkActionMessage('')
    setBulkActionTone('success')
    try {
      await action()
      await handleActionComplete(actionName)
      setSelectedIds([])
      setBulkActionMessage(`${actionName}完成，已刷新列表。`)
      setBulkActionTone('success')
    } catch (requestError) {
      setBulkActionMessage(getErrorMessage(requestError))
      setBulkActionTone('error')
    } finally {
      setBulkSubmittingAction('')
    }
  }

  const toggleRowSelection = useCallback((rowId: string, checked: boolean) => {
    if (!rowId || rowId.startsWith('row-')) return
    setSelectedIds((current) => checked ? Array.from(new Set([...current, rowId])) : current.filter((id) => id !== rowId))
  }, [])

  const toggleSelectAllRows = useCallback((checked: boolean) => {
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => !selectableRowIds.includes(id))
      return Array.from(new Set([...current, ...selectableRowIds]))
    })
  }, [selectableRowIds])

  const handleRefresh = async () => {
    await loadModuleData({ keepSelectedId: selectedId })
  }

  const renderFilterField = (field: AdminFilterField) => (
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
  )

  const restoreRecentView = (entry: AdminRecentViewEntry) => {
    writeAdminFilterMemory(entry.scope, entry.filters)
    if (props.section === 'users' && USER_SUBSECTIONS.some((item) => item.key === entry.scope)) {
      switchSubsection(userSubsection, entry.scope as UserSubsectionKey, setUserSubsection)
    } else if (props.section === 'rechargeCodes' && RECHARGE_SUBSECTIONS.some((item) => item.key === entry.scope)) {
      switchSubsection(rechargeSubsection, entry.scope as RechargeSubsectionKey, setRechargeSubsection)
    } else if (props.section === 'gateway' && GATEWAY_SUBSECTIONS.some((item) => item.key === entry.scope)) {
      switchSubsection(gatewaySubsection, entry.scope as GatewaySubsectionKey, setGatewaySubsection)
    } else if (props.section === 'content' && CONTENT_SUBSECTIONS.some((item) => item.key === entry.scope)) {
      switchSubsection(contentSubsection, entry.scope as ContentSubsectionKey, setContentSubsection)
    } else if (props.section === 'growth' && GROWTH_SUBSECTIONS.some((item) => item.key === entry.scope)) {
      switchSubsection(growthSubsection, entry.scope as GrowthSubsectionKey, setGrowthSubsection)
    }

    if (entry.scope === filterScope) {
      setSelectedId('')
      setSelectedIds([])
      setSelectedLabel('')
      setSelectedRecord(null)
      setDetail(null)
      setPageOffset(0)
      setFilters({ ...getDefaultFiltersForScope(entry.scope), ...entry.filters })
    }
  }

  const actionPanel = (
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
  )

  const bulkStatusActions = actionScope === 'users' || actionScope === 'routes' || actionScope === 'modelSkus' || actionScope === 'bindings'
  const useBottomDetailWorkbench = props.section === 'shares' || props.section === 'inspiration'
  const useInlineWorkbench = shouldUseInlineWorkbench({ section: props.section, actionScope }) && !useBottomDetailWorkbench
  const useUserDetailModal = props.section === 'users' && actionScope === 'users'
  const useCompactTopSummary = props.section === 'users' && actionScope === 'users'
  const hasInlineActionPanel = useInlineWorkbench && shouldRenderActionPanel && !showActionPanelInWorkspace
  const shareAuditSummaryCards = useMemo(() => useBottomDetailWorkbench ? getShareAuditSummaryCards(summary) : [], [summary, useBottomDetailWorkbench])
  const inspirationSummaryCards = useMemo(() => props.section === 'inspiration' ? getInspirationSummaryCards(summary) : [], [props.section, summary])
  const agentWorkflowSummaryCards = useMemo(() => props.section === 'agentWorkflow' ? getAgentWorkflowSummaryCards(summary) : [], [props.section, summary])
  const agentAttentionQueues = useMemo(() => props.section === 'agentWorkflow' ? getAgentAttentionQueues(summary) : [], [props.section, summary])
  const shouldShowDetailPanel = props.section !== 'gateway' || gatewaySubsection !== 'strategy'

  const detailPanel = (
    <section className={isContentModule ? 'admin-detail-panel admin-content-detail-panel' : `admin-panel admin-detail-panel${useInlineWorkbench ? ' admin-inline-detail-panel' : ''}`}>
      <div className="admin-panel-head">
        <h2>记录详情</h2>
        <span>{detailLoading ? '加载中' : selectedLabel || selectedId || '未选择'}</span>
      </div>
      {props.section === 'users' && userSubsection === 'users' && selectedId ? (
        <AdminDetailQuickActions
          title="关联操作"
          actions={[
            { label: '用户流水', onClick: openLinkedUserLedger },
            { label: '邀请关系', onClick: openLinkedUserReferrals },
            { label: '奖励流水', onClick: openLinkedUserCredits },
            { label: '基础详情', onClick: () => void loadDetail(selectedId) },
          ]}
        />
      ) : null}
      {props.section === 'gateway' && gatewaySubsection === 'routes' && selectedId ? (
        <AdminDetailQuickActions
          title="关联操作"
          actions={[
            { label: '查看线路绑定', onClick: openLinkedRouteBindings },
            { label: '查看启用模型', onClick: openLinkedModels },
            { label: '基础详情', onClick: () => void loadDetail(selectedId) },
          ]}
        />
      ) : null}
      {props.section === 'gateway' && gatewaySubsection === 'bindings' && selectedRecord ? (
        <AdminDetailQuickActions
          title="关联操作"
          actions={[
            { label: '查看模型列表', onClick: openLinkedModels },
            { label: '查看线路列表', onClick: openLinkedRoutes },
            { label: '基础详情', onClick: () => void loadDetail(selectedId) },
          ]}
        />
      ) : null}
      {props.section === 'inspiration' && selectedId ? (
        <AdminDetailQuickActions
          title="快捷操作"
          actions={[
            { label: '刷新帖子详情', onClick: () => void loadDetail(selectedId) },
            { label: '查看最新展示', onClick: () => {
              setPageOffset(0)
              setFilters({ ...getDefaultFiltersForScope('inspiration'), queue: 'latest' })
            } },
            { label: '查看待复核', onClick: () => {
              setPageOffset(0)
              setFilters({ ...getDefaultFiltersForScope('inspiration'), queue: 'needs_review' })
            } },
          ]}
        />
      ) : null}
      <AdminDetailView
        detail={detail}
        selectedId={selectedLabel || selectedId}
        detailLoading={detailLoading}
        emptyText={detailEmptyText}
        section={props.section}
        actionScope={actionScope}
        contentSubsection={props.section === 'content' ? contentSubsection : undefined}
      />
    </section>
  )

  const summaryPanel = (
    <details className="admin-panel admin-summary-panel">
      <summary>
        <strong>模块摘要</strong>
        <span>{config.summaryPath ? '辅助数据，默认收起' : '当前模块暂无摘要'}</span>
      </summary>
      <AdminSummaryView
        summary={summary}
        fallback={summaryFallback}
      />
    </details>
  )

  return (
    <section className="admin-section" aria-label={config.title}>
      <div className="admin-section-head">
        <div>
          <span className="admin-kicker">{ADMIN_SECTIONS.find((item) => item.key === props.section)?.meta}</span>
          <h1>{config.title}</h1>
        </div>
        <p>{loading ? '正在加载数据...' : error || config.description}</p>
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
              className={activeFilterEntries.some(([key, value]) => key === 'queue' && value === (item.values.queue ?? '')) ? 'is-active' : ''}
              onClick={() => {
                setPageOffset(0)
                setFilters({ ...getDefaultFiltersForScope('inspiration'), ...item.values })
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {useCompactTopSummary ? (
        <details className="admin-inline-disclosure" aria-label="操作路径">
          <summary>
            <strong>操作路径</strong>
            <span>{workflow[0] || '查看当前流程'}</span>
          </summary>
          <div className="admin-workflow-strip admin-workflow-strip-compact">
            {workflow.map((item, index) => (
              <div key={item} className={index === 0 ? 'is-primary' : ''}>
                <span>{index + 1}</span>
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <div className="admin-workflow-strip" aria-label="操作路径">
          {workflow.map((item, index) => (
            <div key={item} className={index === 0 ? 'is-primary' : ''}>
              <span>{index + 1}</span>
              <strong>{item}</strong>
            </div>
          ))}
        </div>
      )}

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

      <div className={getAdminDataLayoutClassName({ section: props.section, actionScope, isContentModule })}>
        <div className="admin-workspace-column">
          {shouldRenderActionPanel && showActionPanelInWorkspace ? actionPanel : null}
          <form
            key={filterFormKey}
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
            {quickFilters.length ? (
              <div className="admin-filter-state" aria-label="快捷筛选">
                {quickFilters.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="admin-link-button"
                    onClick={() => {
                      setFilters({ ...getDefaultFiltersForScope(filterScope), ...item.values })
                      setPageOffset(0)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {activeFilterEntries.length ? (
              <div className="admin-filter-state" aria-label="当前筛选条件">
                {activeFilterEntries.map(([key, value]) => <span key={`${key}-${value}`}>{formatAdminFilterLabel(key, value)}</span>)}
              </div>
            ) : null}
            <div className={`admin-filter-grid${splitFilterFields ? ' admin-filter-grid-primary' : ''}`}>
              {primaryFilterFields.map(renderFilterField)}
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
            {advancedFilterFields.length ? (
              <details className="admin-filter-advanced">
                <summary>
                  <strong>高级筛选</strong>
                  <span>{advancedFilterCount ? `${advancedFilterCount} 项已生效` : advancedFilterSummary}</span>
                </summary>
                <div className="admin-filter-grid admin-filter-grid-secondary">
                  {advancedFilterFields.map(renderFilterField)}
                </div>
              </details>
            ) : null}
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

          {useInlineWorkbench && !useUserDetailModal ? (
            <section className="admin-inline-workbench" aria-label="当前记录操作台">
              <div className="admin-inline-workbench-toolbar">
                <div className="admin-inline-workbench-selection">
                  <strong>{selectedLabel || selectedId || '未选择记录'}</strong>
                  <span>{selectedCount ? `已勾选 ${selectedCount} 条` : '点表格行查看详情或处理当前记录'}</span>
                </div>
                <div className="admin-inline-workbench-switch" role="tablist" aria-label="当前记录工作台视图">
                  <button
                    type="button"
                    className={inlineWorkbenchMode === 'detail' ? 'is-active' : ''}
                    onClick={() => setInlineWorkbenchMode('detail')}
                  >
                    详情
                  </button>
                  {hasInlineActionPanel ? (
                    <button
                      type="button"
                      className={inlineWorkbenchMode === 'action' ? 'is-active' : ''}
                      onClick={() => setInlineWorkbenchMode('action')}
                    >
                      操作
                    </button>
                  ) : null}
                </div>
              </div>
              {inlineWorkbenchMode === 'detail' || !hasInlineActionPanel ? (
                <div className="admin-inline-workbench-main">
                  {shouldShowDetailPanel ? detailPanel : null}
                </div>
              ) : null}
              {hasInlineActionPanel && inlineWorkbenchMode === 'action' ? (
                <div className="admin-inline-workbench-side">
                  {actionPanel}
                </div>
              ) : null}
            </section>
          ) : null}

          {useBottomDetailWorkbench && (shareAuditSummaryCards.length || inspirationSummaryCards.length) ? (
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

          {props.section === 'agentWorkflow' && (agentWorkflowSummaryCards.length || agentAttentionQueues.length) ? (
            <section className="admin-panel admin-agent-observability-panel" aria-label="Agent 运行健康">
              <div className="admin-panel-head">
                <h2>运行健康</h2>
                <span>按当前筛选范围统计</span>
              </div>
              {agentWorkflowSummaryCards.length ? (
                <div className="admin-agent-health-grid">
                  {agentWorkflowSummaryCards.map((item) => (
                    <article key={item.label} className="admin-agent-health-card">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.note}</small>
                    </article>
                  ))}
                </div>
              ) : null}
              {agentAttentionQueues.length ? (
                <div className="admin-agent-attention-grid" aria-label="异常队列">
                  {agentAttentionQueues.map((queue) => (
                    <button
                      key={queue.key}
                      type="button"
                      className={`is-${queue.severity}`}
                      onClick={() => {
                        setFilters({ ...getDefaultFiltersForScope(filterScope), ...queue.filter })
                        setPageOffset(0)
                      }}
                    >
                      <span>{queue.label}</span>
                      <strong>{queue.count}</strong>
                      <small>{queue.description}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="admin-panel admin-data-panel">
            <div className="admin-panel-head">
              <h2>{getListTitle(config, props.section)}</h2>
              <span>{pagination.total ? `${pagination.offset + 1}-${Math.min(pagination.offset + pagination.limit, pagination.total)} / ${pagination.total}` : `${rows.length} 条`}</span>
            </div>
            {bulkDeleteConfig ? (
              <div className="admin-list-toolbar">
                <div className="admin-list-toolbar-head">
                  <div>
                    <strong>{selectedCount ? `已勾选 ${selectedCount} 条` : `当前页 ${rows.length} 条`}</strong>
        <span>{selectedCount ? '批量删除只会处理当前勾选记录，单条编辑与详情查看互不影响。' : '勾选后可批量删除；点行仍然用于打开详情和继续处理。'}</span>
                  </div>
                  <div className="admin-list-toolbar-actions">
                    <button type="button" onClick={() => toggleSelectAllRows(true)} disabled={loading || !selectableRowIds.length || allSelectableRowsSelected}>全选本页</button>
                    <button type="button" onClick={() => setSelectedIds([])} disabled={loading || !selectedCount}>清空勾选</button>
                  </div>
                </div>
                <BulkDeleteRecordsAction
                  disabled={loading || Boolean(bulkSubmittingAction)}
                  selectedIds={selectedIds}
                  itemLabel={bulkDeleteConfig.itemLabel}
                  hint={bulkDeleteConfig.hint}
                  actionName={bulkSubmittingAction || bulkDeleteConfig.actionName}
                  onRun={runBulkAction}
                  onDelete={async (ids) => {
                    for (const id of ids) {
                      await bulkDeleteConfig.deleteOne(id, props.token)
                    }
                  }}
                />
                {bulkActionMessage ? <p className={bulkActionTone === 'success' ? 'admin-form-success' : 'admin-form-error'}>{bulkActionMessage}</p> : null}
              </div>
            ) : null}
            {bulkStatusActions ? (
              <div className="admin-button-row">
                <button
                  type="button"
                  disabled={loading || Boolean(bulkSubmittingAction) || !selectedCount}
                  onClick={() => {
                    void runBulkAction('批量启用', async () => {
                      for (const id of selectedIds) {
                        if (actionScope === 'users') {
                          await adminPatch(`/api/admin/users/${encodeURIComponent(id)}/status`, props.token, { status: 'active', reason: '批量启用' })
                        } else if (actionScope === 'routes') {
                          await adminPatch(`/api/admin/gateway-routes/${encodeURIComponent(id)}`, props.token, { enabled: true })
                        } else if (actionScope === 'modelSkus') {
                          await adminPatch(`/api/admin/model-skus/${encodeURIComponent(id)}`, props.token, { enabled: true })
                        } else if (actionScope === 'bindings') {
                          await adminPatch(`/api/admin/model-route-bindings/${encodeURIComponent(id)}`, props.token, { enabled: true })
                        }
                      }
                    })
                  }}
                >
                  批量启用
                </button>
                <button
                  type="button"
                  disabled={loading || Boolean(bulkSubmittingAction) || !selectedCount}
                  onClick={() => {
                    void runBulkAction('批量停用', async () => {
                      for (const id of selectedIds) {
                        if (actionScope === 'users') {
                          await adminPatch(`/api/admin/users/${encodeURIComponent(id)}/status`, props.token, { status: 'disabled', reason: '批量停用' })
                        } else if (actionScope === 'routes') {
                          await adminPatch(`/api/admin/gateway-routes/${encodeURIComponent(id)}`, props.token, { enabled: false })
                        } else if (actionScope === 'modelSkus') {
                          await adminPatch(`/api/admin/model-skus/${encodeURIComponent(id)}`, props.token, { enabled: false })
                        } else if (actionScope === 'bindings') {
                          await adminPatch(`/api/admin/model-route-bindings/${encodeURIComponent(id)}`, props.token, { enabled: false })
                        }
                      }
                    })
                  }}
                >
                  批量停用
                </button>
              </div>
            ) : null}
            <div className={getTableShellClassName(props.section, actionScope)}>
              <table className="admin-table">
                <thead>
                  <tr>
                    {bulkDeleteConfig ? (
                      <th data-field="select">
                        <input
                          type="checkbox"
                          aria-label="全选本页"
                          checked={allSelectableRowsSelected}
                          onChange={(event) => toggleSelectAllRows(event.target.checked)}
                        />
                      </th>
                    ) : null}
                    {config.columns.map((column) => <th key={column.key} data-field={column.key}>{column.label}</th>)}
                    {isContentModule ? null : <th data-field="detail">详情</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const rowId = rowIds[index] ?? formatCellValue(getValueByPath(row, config.detailIdKey))
                    return (
                      <tr
                        key={`${rowId}-${index}`}
                        className={selectedId === rowId ? 'is-selected' : ''}
                        onClick={() => void openDetail(row)}
                      >
                        {bulkDeleteConfig ? (
                          <td data-field="select" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`勾选 ${getRecordReadableLabel(row, config) || rowId}`}
                              checked={selectedIdSet.has(rowId)}
                              onChange={(event) => toggleRowSelection(rowId, event.target.checked)}
                            />
                          </td>
                        ) : null}
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
                              查看
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!rows.length ? <p className="admin-empty">{getAdminScopeEmptyText({ error, loading, hasFilters: activeFilterEntries.length > 0 })}</p> : null}
            </div>
            <div className="admin-pagination">
              <button type="button" disabled={loading || pageOffset <= 0} onClick={() => setPageOffset(Math.max(0, pageOffset - pageLimit))}>上一页</button>
              <span>第 {Math.floor(pagination.offset / Math.max(1, pagination.limit)) + 1} 页</span>
              <button type="button" disabled={loading || pagination.offset + pagination.limit >= pagination.total} onClick={() => setPageOffset(pageOffset + pageLimit)}>下一页</button>
            </div>
          </section>

          {useBottomDetailWorkbench ? (
            <details className="admin-inline-disclosure admin-bottom-detail-disclosure" open={Boolean(selectedId)}>
              <summary>
                <strong>{selectedLabel || selectedId || '选中分享详情'}</strong>
                <span>{selectedId ? '下方展示当前分享记录详情' : '先在上方列表选择一条记录'}</span>
              </summary>
              <div className="admin-bottom-detail-shell">
                {shouldRenderActionPanel && selectedId ? actionPanel : null}
                {shouldShowDetailPanel ? detailPanel : null}
              </div>
            </details>
          ) : null}
        </div>

        {useInlineWorkbench || useBottomDetailWorkbench || useUserDetailModal ? null : (
          <aside className="admin-side-column">
            {shouldRenderActionPanel && !showActionPanelInWorkspace ? actionPanel : null}
            {shouldShowDetailPanel ? detailPanel : null}
            {summaryPanel}
          </aside>
        )}
      </div>

      {useUserDetailModal ? (
        <AdminModal
          open={userDetailModalOpen && Boolean(selectedId)}
          title="用户详情"
          subtitle={selectedLabel || selectedId || '当前用户'}
          onClose={() => setUserDetailModalOpen(false)}
        >
          <div className="admin-modal-layout">
            {shouldShowDetailPanel ? detailPanel : null}
            {shouldRenderActionPanel ? actionPanel : null}
          </div>
        </AdminModal>
      ) : null}
    </section>
  )
}

export default function AdminApp() {
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || '')
  const [admin, setAdmin] = useState<AdminProfile | null>(null)
  const [activeSection, setActiveSection] = useState<AdminSectionKey>(() => getStoredAdminSection())
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
    localStorage.removeItem(ADMIN_ACTIVE_SECTION_STORAGE_KEY)
    void logoutAdmin(token).catch(() => undefined)
  }

  const switchSection = (section: AdminSectionKey) => {
    setActiveSection(section)
    localStorage.setItem(ADMIN_ACTIVE_SECTION_STORAGE_KEY, section)
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
              onClick={() => switchSection(section.key)}
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
          <AdminDashboard dashboard={dashboard} loading={loading} error={error} onNavigate={switchSection} />
        ) : (
          <AdminDataModule section={activeSection} token={sessionToken} />
        )}
      </div>
    </main>
  )
}
