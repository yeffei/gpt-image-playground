import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendReviewTagToNote, buildAgentReferencePayload, buildBranchInspectorSummary, buildCreativeReviewItems, buildDerivedRoutePlanInput, buildExecutionAssetActionNotice, buildExecutionControlSummary, buildHistoryAssetNextStepSummary, buildLocalEditDraftSummary, buildOutputActionSummary, buildOutputAssetActionNotice, buildOutputAssetActions, buildRecoverableAssetSummary, buildRecoveryActionSummary, buildRetryPromptFromRun, buildRouteSourceSummary, buildTimelineStepSections, buildVersionComparisonSummary, buildWorkflowNodeStates, findAgentLibraryDetailTask, findOutputSelectionTarget, getActiveOutputReviewSummary, getInlineReferenceAssetFromRecipe, getInputImageFromReferenceAsset, getLocalEditDraftCopy, getPlanOverrideState, getProjectVersionHistory, getRecipeSourceReferenceRole, getReviewIterationOutputReference, getReviewIterationRouteState, getRouteLifecycleCopy, getRunPrimaryOutput, getSelectedOutputOpenTarget, getStageVersionStripItems, loadServerOutputAsLocalImage, mergeAgentReferenceImages } from './AgentWorkflowView'
import { storeImage } from '../lib/db'
import type { AgentRun, AgentRunOutput, AgentStep } from '../lib/agentWorkflowApi'

vi.mock('../lib/db', () => ({
  storeImage: vi.fn(async () => 'stored_image_1'),
}))

const planSummary = {
  category: '品牌广告',
  purpose: '商业图像创作',
  audience: '待判断',
  subject: '保温杯推广图',
  style: '由 Agent 推断',
  aspectRatio: '4:5',
  outputSize: '1K',
  outputCount: '2',
  model: 'Default Model',
  prompt: 'commercial key visual prompt',
  negativePrompt: 'low quality',
  estimatedPoints: '2.00 点',
}

class MockFileReader {
  result: string | ArrayBuffer | null = null
  error: Error | null = null
  onload: null | (() => void) = null
  onerror: null | (() => void) = null

  readAsDataURL() {
    this.result = 'data:image/png;base64,c2VydmVy'
    this.onload?.()
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(storeImage).mockResolvedValue('stored_image_1')
  vi.stubGlobal('FileReader', MockFileReader)
})

describe('AgentWorkflowView creative review helpers', () => {
  it('finds a source output through the local task image mapping first', () => {
    expect(findOutputSelectionTarget({
      sourceOutputId: 'output_2',
      task: {
        outputImages: ['image_1', 'image_2'],
        serverOutputByImageId: {
          image_1: { outputId: 'output_1', taskId: 'task_1', outputIndex: 0 },
          image_2: { outputId: 'output_2', taskId: 'task_1', outputIndex: 1 },
        },
      },
      serverOutputs: [{ id: 'output_2', taskId: 'task_1', outputIndex: 1 }],
    })).toEqual({
      imageId: 'image_2',
      serverOutputId: null,
      found: true,
    })
  })

  it('falls back to server-only outputs when locating a source output', () => {
    expect(findOutputSelectionTarget({
      sourceOutputId: 'output_server',
      task: {
        outputImages: [],
        serverOutputByImageId: {},
      },
      serverOutputs: [{ id: 'output_server', taskId: 'task_1', outputIndex: 0 }],
    })).toEqual({
      imageId: null,
      serverOutputId: 'output_server',
      found: true,
    })
  })

  it('returns an empty source output target when nothing matches', () => {
    expect(findOutputSelectionTarget({
      sourceOutputId: 'output_missing',
      task: {
        outputImages: ['image_1'],
        serverOutputByImageId: { image_1: { outputId: 'output_1', taskId: 'task_1', outputIndex: 0 } },
      },
      serverOutputs: [{ id: 'output_2', taskId: 'task_1', outputIndex: 0 }],
    })).toEqual({
      imageId: null,
      serverOutputId: null,
      found: false,
    })
  })

  it('reads persisted primary output before falling back to review selection', () => {
    expect(getRunPrimaryOutput({
      id: 'run_1',
      status: 'succeeded',
      userPrompt: '保温杯推广图',
      brief: {},
      plan: {},
      planVersion: 1,
      metadata: {
        primaryOutput: {
          selectedOutputId: 'output_primary',
          selectedTaskId: 'task_primary',
          selectedAt: '2026-07-06T06:00:00.000Z',
        },
        review: {
          selectedOutputId: 'output_review',
          selectedTaskId: 'task_review',
        },
      },
    })).toEqual({
      selectedOutputId: 'output_primary',
      selectedTaskId: 'task_primary',
      selectedAt: '2026-07-06T06:00:00.000Z',
    })
  })

  it('falls back to the reviewed output as primary when no explicit primary exists', () => {
    expect(getRunPrimaryOutput({
      id: 'run_1',
      status: 'succeeded',
      userPrompt: '保温杯推广图',
      brief: {},
      plan: {},
      planVersion: 1,
      metadata: {
        review: {
          selectedOutputId: 'output_review',
          selectedTaskId: 'task_review',
        },
      },
    })).toEqual({
      selectedOutputId: 'output_review',
      selectedTaskId: 'task_review',
      selectedAt: null,
    })
  })

  it('describes local edit draft states', () => {
    expect(getLocalEditDraftCopy(false)).toEqual({
      title: '正在准备局部修改',
      detail: '保存遮罩后即可创建局部修改路线。',
      reopenLabel: '继续绘制',
    })
    expect(getLocalEditDraftCopy(true)).toEqual({
      title: '局部修改遮罩已就绪',
      detail: '可基于当前描述生成一条新的局部修改路线。',
      reopenLabel: '调整遮罩',
    })
  })

  it('builds local edit draft summaries with source and mask state', () => {
    expect(buildLocalEditDraftSummary({
      isReady: false,
      outputId: 'output_local_edit',
      taskId: 'task_1',
    })).toEqual({
      title: '正在准备局部修改',
      detail: 'Output output_...edit 已载入，保存遮罩后才能创建局部修改路线。',
      reopenLabel: '继续绘制',
      chips: ['Output output_...edit', 'Mask editing'],
      tone: 'editing',
    })

    expect(buildLocalEditDraftSummary({
      isReady: true,
      outputId: 'output_local_edit',
      maskUpdatedAt: '2026-07-06T07:00:00.000Z',
    })).toEqual({
      title: '局部修改遮罩已就绪',
      detail: 'Output output_...edit 的遮罩已保存，可创建待确认局部修改路线。',
      reopenLabel: '调整遮罩',
      chips: ['Output output_...edit', 'Mask ready', expect.stringMatching(/^更新 /)],
      tone: 'ready',
    })
  })

  it('appends review feedback tags without duplicate notes or automatic actions', () => {
    const tag = {
      key: 'local_defect' as const,
      label: '局部瑕疵',
      note: '存在局部瑕疵，需要针对问题区域做局部修改。',
    }

    expect(appendReviewTagToNote('', tag)).toBe('存在局部瑕疵，需要针对问题区域做局部修改。')
    expect(appendReviewTagToNote('主体不错。', tag)).toBe('主体不错。 存在局部瑕疵，需要针对问题区域做局部修改。')
    expect(appendReviewTagToNote('主体不错。 存在局部瑕疵，需要针对问题区域做局部修改。', tag)).toBe('主体不错。 存在局部瑕疵，需要针对问题区域做局部修改。')
    expect(appendReviewTagToNote('x'.repeat(590), tag)).toHaveLength(600)
  })

  it('summarizes a local selected output for review binding', () => {
    expect(getActiveOutputReviewSummary({
      selectedImageId: 'image_2',
      outputImageIds: ['image_1', 'image_2'],
      selectedServerOutput: { outputId: 'output_2', taskId: 'task_1' },
      selectedServerOnlyOutput: null,
      serverOutputs: [],
      fallbackTaskId: 'task_fallback',
      hasSucceededRun: true,
    })).toEqual({
      label: '候选 2',
      outputId: 'output_2',
      taskId: 'task_1',
      canSelectPrimary: true,
    })
  })

  it('summarizes a server-only selected output for review binding', () => {
    const serverOutput: AgentRunOutput = {
      id: 'output_server_1',
      taskId: 'task_server',
      outputIndex: 0,
      url: '/api/generated-images/task_server/00.png',
    }

    expect(getActiveOutputReviewSummary({
      selectedImageId: null,
      outputImageIds: [],
      selectedServerOutput: null,
      selectedServerOnlyOutput: serverOutput,
      serverOutputs: [serverOutput],
      fallbackTaskId: 'task_fallback',
      hasSucceededRun: true,
    })).toEqual({
      label: '候选 1',
      outputId: 'output_server_1',
      taskId: 'task_server',
      canSelectPrimary: true,
    })
  })

  it('summarizes an empty review output state', () => {
    expect(getActiveOutputReviewSummary({
      selectedImageId: null,
      outputImageIds: [],
      selectedServerOutput: null,
      selectedServerOnlyOutput: null,
      serverOutputs: [],
      fallbackTaskId: 'task_1',
      hasSucceededRun: true,
    })).toEqual({
      label: '等待选择候选图',
      outputId: null,
      taskId: 'task_1',
      canSelectPrimary: false,
    })
  })

  it('builds compact output action summaries', () => {
    expect(buildOutputActionSummary({
      active: true,
      primary: false,
      outputId: 'output_1234567890',
      canOpen: true,
    })).toEqual({
      title: '当前候选',
      detail: '可设为主图，也可继续局改、变体或适配。',
      chips: ['可设主图', '可查看', '可派生'],
      tone: 'active',
    })

    expect(buildOutputActionSummary({
      active: false,
      primary: true,
      outputId: 'output_primary',
    })).toEqual({
      title: '已设为主图',
      detail: 'Output output_primary',
      chips: ['主图', '可派生'],
      tone: 'primary',
    })

    expect(buildOutputActionSummary({
      active: false,
      primary: false,
      outputId: 'output_candidate',
    })).toEqual({
      title: '候选可用',
      detail: 'Output output_...date 可作为参考或分支来源。',
      chips: ['可选中', '可参考', '可派生'],
      tone: 'idle',
    })

    expect(buildOutputActionSummary({
      active: true,
      primary: false,
    })).toEqual({
      title: '当前候选',
      detail: '等待服务端输出 ID 后可沉淀为主图。',
      chips: ['同步中'],
      tone: 'active',
    })
  })

  it('builds consistent output asset action notices', () => {
    expect(buildOutputAssetActionNotice({
      target: 'Result Stage',
      action: 'primary',
      outputId: 'output_primary_123456',
    })).toEqual({
      target: 'Result Stage',
      title: '主图已更新',
      detail: 'Output output_...3456',
    })

    expect(buildOutputAssetActionNotice({
      target: 'Brief',
      action: 'reference',
      outputId: 'output_ref',
    })).toEqual({
      target: 'Brief',
      title: '参考图已加入 Brief',
      detail: 'Output output_ref',
    })

    expect(buildOutputAssetActionNotice({
      target: 'Project Assets',
      action: 'review',
      taskId: 'task_1',
      decision: 'needs_iteration',
    })).toEqual({
      target: 'Project Assets',
      title: '迭代反馈已记录',
      detail: 'Task task_1',
    })

    expect(buildOutputAssetActionNotice({
      target: 'Project Assets',
      action: 'library',
    })).toEqual({
      target: 'Project Assets',
      title: '作品库已同步',
      detail: '当前输出',
    })

    expect(buildOutputAssetActionNotice({
      target: 'Routes',
      action: 'local_edit_route',
      outputId: 'output_edit_123456',
    })).toEqual({
      target: 'Routes',
      title: '局部修改路线已创建',
      detail: 'Output output_...3456 · 遮罩已随路线保存，确认费用后才会启动生成。',
    })
  })

  it('builds complete output asset actions for project asset cards', () => {
    expect(buildOutputAssetActions({
      hasOutputReference: true,
      isBusy: false,
    })).toEqual([
      { key: 'select', label: '选中', disabled: false },
      { key: 'reference', label: '参考', disabled: false },
      { key: 'variant', label: '变体', disabled: false },
      { key: 'layout', label: '适配', disabled: false },
      { key: 'upscale', label: '精修', disabled: false },
      { key: 'commerce', label: '转化', disabled: false },
    ])

    expect(buildOutputAssetActions({
      hasOutputReference: false,
      isBusy: false,
    }).filter((action) => action.key !== 'select' && action.key !== 'reference').every((action) => action.disabled)).toBe(true)

    expect(buildOutputAssetActions({
      hasOutputReference: true,
      isBusy: true,
    })).toEqual([
      { key: 'select', label: '选中', disabled: false },
      { key: 'reference', label: '参考', disabled: true },
      { key: 'variant', label: '变体', disabled: true },
      { key: 'layout', label: '适配', disabled: true },
      { key: 'upscale', label: '精修', disabled: true },
      { key: 'commerce', label: '转化', disabled: true },
    ])
  })

  it('finds the best library detail task for the selected Agent output', () => {
    const tasks = [
      {
        id: 'local_task_a',
        serverImageTaskId: 'generation_task_a',
        serverOutputByImageId: {
          image_a: { outputId: 'output_a', taskId: 'generation_task_a' },
        },
      },
      {
        id: 'local_task_b',
        serverImageTaskId: 'generation_task_b',
        serverOutputByImageId: {
          image_b: { outputId: 'output_b', taskId: 'generation_task_b' },
        },
      },
    ] as any[]

    expect(findAgentLibraryDetailTask(tasks, {
      generationTaskId: 'generation_task_a',
      outputId: 'output_b',
    })?.id).toBe('local_task_b')

    expect(findAgentLibraryDetailTask(tasks, {
      generationTaskId: 'generation_task_a',
      outputId: 'missing_output',
    })?.id).toBe('local_task_a')

    expect(findAgentLibraryDetailTask(tasks, {
      generationTaskId: null,
      outputId: null,
    })).toBeNull()
  })

  it('builds execution action notices without implying automatic generation', () => {
    const confirmedRun: AgentRun = {
      id: 'run_1',
      status: 'confirmed',
      userPrompt: '保温杯推广图',
      brief: {},
      plan: {},
      estimatedPoints: '2.5',
      confirmedPoints: '2.5',
      planVersion: 1,
    }

    expect(buildExecutionAssetActionNotice({
      action: 'confirm',
      run: confirmedRun,
    })).toEqual({
      target: 'Routes',
      title: '路线已确认',
      detail: '2.50 点 已锁定，启动生成前不会创建生图任务。',
    })

    expect(buildExecutionAssetActionNotice({
      action: 'start',
      run: { ...confirmedRun, status: 'running', generationTaskId: 'task_1234567890' },
      generationTask: { taskId: 'task_1234567890', status: 'queued', reservedPoints: 2.5 },
    })).toEqual({
      target: 'Project Assets',
      title: '生成任务已启动',
      detail: 'Task task_12...7890 · 结果将同步到本项目',
    })

    expect(buildExecutionAssetActionNotice({
      action: 'cancel',
      run: { ...confirmedRun, status: 'canceled' },
    })).toEqual({
      target: 'Routes',
      title: '流程已取消',
      detail: '可基于这条记录重新规划恢复路线。',
    })
  })

  it('prefers the reviewed output when creating a review iteration source', () => {
    expect(getReviewIterationOutputReference({
      run: {
        id: 'run_1',
        status: 'succeeded',
        userPrompt: '保温杯推广图',
        brief: {},
        plan: {},
        generationTaskId: 'task_run',
        planVersion: 1,
      },
      review: { selectedOutputId: 'output_reviewed', selectedTaskId: 'task_reviewed' },
      activeOutputReference: { outputId: 'output_active', imageId: 'image_active', taskId: 'task_active' },
    })).toEqual({
      outputId: 'output_reviewed',
      imageId: null,
      taskId: 'task_reviewed',
    })
  })

  it('keeps the local image binding when the reviewed output is still active', () => {
    expect(getReviewIterationOutputReference({
      run: {
        id: 'run_1',
        status: 'succeeded',
        userPrompt: '保温杯推广图',
        brief: {},
        plan: {},
        generationTaskId: 'task_run',
        planVersion: 1,
      },
      review: { selectedOutputId: 'output_active', selectedTaskId: null },
      activeOutputReference: { outputId: 'output_active', imageId: 'image_active', taskId: 'task_active' },
    })).toEqual({
      outputId: 'output_active',
      imageId: 'image_active',
      taskId: 'task_run',
    })
  })

  it('falls back to the active output for review iteration when no reviewed output exists', () => {
    expect(getReviewIterationOutputReference({
      run: null,
      review: { selectedOutputId: null, selectedTaskId: null },
      activeOutputReference: { outputId: 'output_active', imageId: 'image_active', taskId: 'task_active' },
    })).toEqual({
      outputId: 'output_active',
      imageId: 'image_active',
      taskId: 'task_active',
    })
  })

  it('returns no review iteration source when neither review nor active output exists', () => {
    expect(getReviewIterationOutputReference({
      run: null,
      review: { selectedOutputId: null, selectedTaskId: null },
      activeOutputReference: null,
    })).toBeNull()
  })

  it('requires both feedback and a source output for review iteration routes', () => {
    expect(getReviewIterationRouteState({
      feedback: '',
      outputReference: { outputId: 'output_active', imageId: 'image_active', taskId: 'task_active' },
    })).toEqual({
      canCreate: false,
      title: '先写下需要改进的评审反馈',
    })

    expect(getReviewIterationRouteState({
      feedback: '背景更亮',
      outputReference: null,
    })).toEqual({
      canCreate: false,
      title: '先选择主图或候选图作为改进来源',
    })

    expect(getReviewIterationRouteState({
      feedback: '背景更亮',
      outputReference: { outputId: 'output_active', imageId: 'image_active', taskId: 'task_active' },
    })).toEqual({
      canCreate: true,
      title: '基于评审反馈创建改进路线',
    })
  })

  it('opens local selected outputs through the lightbox target', () => {
    expect(getSelectedOutputOpenTarget({
      selectedImageId: 'image_1',
      outputImageIds: ['image_1', 'image_2'],
      selectedServerOnlyOutput: null,
    })).toEqual({
      kind: 'lightbox',
      imageId: 'image_1',
      imageIds: ['image_1', 'image_2'],
    })
  })

  it('opens server-only selected outputs through their URL', () => {
    expect(getSelectedOutputOpenTarget({
      selectedImageId: null,
      outputImageIds: [],
      selectedServerOnlyOutput: {
        id: 'output_1',
        taskId: 'task_1',
        outputIndex: 0,
        url: '/api/generated-images/task_1/00.png',
      },
    })).toEqual({
      kind: 'url',
      url: '/api/generated-images/task_1/00.png',
    })
  })

  it('returns no open target when the selected output has no preview address', () => {
    expect(getSelectedOutputOpenTarget({
      selectedImageId: null,
      outputImageIds: [],
      selectedServerOnlyOutput: {
        id: 'output_1',
        taskId: 'task_1',
        outputIndex: 0,
      },
    })).toEqual({ kind: 'none' })
  })

  it('flags missing references while acknowledging collected outputs', () => {
    const items = buildCreativeReviewItems({
      run: { id: 'agent_run_1', status: 'succeeded', userPrompt: '保温杯推广图', brief: {}, plan: {}, planVersion: 1 },
      planSummary,
      outputCount: 2,
      requestedCount: 2,
      referenceCount: 0,
      warningCount: 1,
      review: {
        decision: null,
        selectedOutputId: null,
        selectedTaskId: null,
        note: '',
        reviewedAt: null,
        reviewStatus: null,
        recipeSaved: false,
        recipeSavedAt: null,
        latestRecipeId: null,
      },
    })

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'references', status: 'attention' }),
      expect.objectContaining({ key: 'outputs', status: 'ready' }),
      expect.objectContaining({ key: 'risks', status: 'attention' }),
      expect.objectContaining({ key: 'decision', status: 'pending' }),
    ]))
  })

  it('marks the decision ready after a recipe is saved', () => {
    const items = buildCreativeReviewItems({
      run: { id: 'agent_run_1', status: 'succeeded', userPrompt: '保温杯推广图', brief: {}, plan: {}, planVersion: 1 },
      planSummary,
      outputCount: 1,
      requestedCount: 1,
      referenceCount: 1,
      warningCount: 0,
      review: {
        decision: 'accepted',
        selectedOutputId: 'output_1',
        selectedTaskId: 'task_1',
        note: '',
        reviewedAt: '2026-07-05T12:00:00.000Z',
        reviewStatus: 'recipe_saved',
        recipeSaved: true,
        recipeSavedAt: '2026-07-05T12:05:00.000Z',
        latestRecipeId: 'recipe_1',
      },
    })

    expect(items.find((item) => item.key === 'decision')).toMatchObject({
      status: 'ready',
      detail: '已沉淀为配方资产',
    })
  })
})

describe('AgentWorkflowView derived route helpers', () => {
  const run: AgentRun = {
    id: 'run_1',
    status: 'succeeded',
    userPrompt: '保温杯推广图',
    category: '品牌广告',
    brief: {},
    plan: {},
    recommendedModelSku: 'sku_pro',
    planVersion: 1,
  }
  const outputReference = {
    outputId: 'output_1',
    imageId: 'image_1',
    taskId: 'task_1',
  }

  it('builds a layout adaptation route plan input', () => {
    const input = buildDerivedRoutePlanInput({
      mode: 'layout',
      run,
      outputReference,
      planSummary,
      aspectRatio: '自动',
      outputSize: '',
      fallbackOutputSize: '1k',
    })

    expect(input.sourceType).toBe('reference_image')
    expect(input.prompt).toContain('版式适配和画面延展')
    expect(input.references).toEqual([{
      kind: 'generation_output',
      role: 'layout_source',
      imageId: 'image_1',
      outputId: 'output_1',
      taskId: 'task_1',
      sourceRunId: 'run_1',
    }])
    expect(input.preferences).toEqual({
      category: '品牌广告',
      aspectRatio: '4:5',
      outputSize: '1k',
      outputCount: 1,
      modelSku: 'sku_pro',
    })
  })

  it('builds an upscale route plan input', () => {
    const input = buildDerivedRoutePlanInput({
      mode: 'upscale',
      run,
      outputReference,
      planSummary,
      aspectRatio: '自动',
      outputSize: '2k',
      fallbackOutputSize: '1k',
    })

    expect(input.prompt).toContain('4K 高清精修')
    expect(input.references?.[0]).toMatchObject({ role: 'upscale_source', outputId: 'output_1' })
    expect(input.preferences).toEqual({
      category: '品牌广告',
      aspectRatio: '4:5',
      outputSize: '4k',
      outputCount: 1,
      modelSku: 'sku_pro',
    })
  })

  it('builds a conversion route plan input', () => {
    const input = buildDerivedRoutePlanInput({
      mode: 'poster',
      run,
      outputReference,
      planSummary,
      aspectRatio: '自动',
      outputSize: '2k',
      fallbackOutputSize: '1k',
    })

    expect(input.prompt).toContain('横版品牌海报方向')
    expect(input.references?.[0]).toMatchObject({ role: 'poster_conversion_source', outputId: 'output_1' })
    expect(input.preferences).toEqual({
      category: '品牌广告',
      aspectRatio: '16:9',
      outputSize: '2k',
      outputCount: 1,
      modelSku: 'sku_pro',
    })
  })
})

describe('AgentWorkflowView project version history helpers', () => {
  const makeRun = (overrides: Partial<AgentRun> & { id: string }): AgentRun => ({
    id: overrides.id,
    status: overrides.status ?? 'planned',
    userPrompt: overrides.userPrompt ?? `prompt ${overrides.id}`,
    brief: overrides.brief ?? {},
    plan: overrides.plan ?? {},
    references: overrides.references,
    metadata: overrides.metadata,
    generationRequest: overrides.generationRequest,
    failureKind: overrides.failureKind,
    errorSummary: overrides.errorSummary,
    estimatedPoints: overrides.estimatedPoints,
    confirmedPoints: overrides.confirmedPoints,
    generationTaskId: overrides.generationTaskId,
    planVersion: overrides.planVersion ?? 1,
    updatedAt: overrides.updatedAt,
    createdAt: overrides.createdAt,
    sourceType: overrides.sourceType,
  })

  it('prioritizes the active run, ancestors, descendants, same-root runs, then recent runs', () => {
    const root = makeRun({ id: 'run_root', updatedAt: '2026-07-05T08:00:00.000Z' })
    const parent = makeRun({
      id: 'run_parent',
      updatedAt: '2026-07-05T09:00:00.000Z',
      references: [{ kind: 'generation_output', sourceRunId: 'run_root', outputId: 'out_root' }],
    })
    const active = makeRun({
      id: 'run_active',
      updatedAt: '2026-07-05T10:00:00.000Z',
      references: [{ kind: 'generation_output', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    })
    const child = makeRun({
      id: 'run_child',
      updatedAt: '2026-07-05T11:00:00.000Z',
      references: [{ kind: 'generation_output', sourceRunId: 'run_active', outputId: 'out_active' }],
    })
    const sibling = makeRun({
      id: 'run_sibling',
      updatedAt: '2026-07-05T12:00:00.000Z',
      references: [{ kind: 'generation_output', sourceRunId: 'run_parent', outputId: 'out_parent_b' }],
    })
    const recent = makeRun({ id: 'run_recent', updatedAt: '2026-07-05T13:00:00.000Z' })

    const result = getProjectVersionHistory([recent, sibling, child, parent, root], active)

    expect(result.map((item) => item.run.id)).toEqual([
      'run_active',
      'run_parent',
      'run_root',
      'run_child',
      'run_sibling',
      'run_recent',
    ])
    expect(result.map((item) => item.relation)).toEqual([
      'current',
      'source',
      'source',
      'child',
      'same_root',
      'recent',
    ])
    expect(result[1].relationLabel).toBe('来源')
    expect(result[2].relationLabel).toBe('来源 L2')
  })

  it('includes the active run when it is not present in the loaded history page', () => {
    const active = makeRun({ id: 'run_active', updatedAt: '2026-07-05T10:00:00.000Z' })

    const result = getProjectVersionHistory([], active)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      relation: 'current',
      relationLabel: '当前',
      run: expect.objectContaining({ id: 'run_active' }),
    })
  })

  it('builds stage version strip items from lineage history', () => {
    const parent = makeRun({ id: 'run_parent', updatedAt: '2026-07-05T09:00:00.000Z' })
    const active = makeRun({
      id: 'run_active',
      updatedAt: '2026-07-05T10:00:00.000Z',
      references: [{ kind: 'generation_output', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    })
    const history = getProjectVersionHistory([parent], active)

    const items = getStageVersionStripItems(history, active)

    expect(items.map((item) => ({
      key: item.key,
      label: item.label,
      branchLabel: item.branchLabel,
      active: item.active,
      relation: item.relation,
      hasRun: Boolean(item.run),
    }))).toEqual([
      { key: 'run_active', label: '当前', branchLabel: '探索', active: true, relation: 'current', hasRun: true },
      { key: 'run_parent', label: '来源', branchLabel: '探索', active: false, relation: 'source', hasRun: true },
    ])
  })

  it('labels output-derived specialty branches in the stage version strip', () => {
    const parent = makeRun({ id: 'run_parent', updatedAt: '2026-07-05T09:00:00.000Z' })
    const active = makeRun({
      id: 'run_upscale',
      updatedAt: '2026-07-05T10:00:00.000Z',
      references: [{ kind: 'generation_output', role: 'upscale_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
      plan: { aspectRatio: '4:5', outputSize: '4K', outputCount: 1 },
    })
    const history = getProjectVersionHistory([parent], active)

    expect(getStageVersionStripItems(history, active).map((item) => ({
      key: item.key,
      branchLabel: item.branchLabel,
      active: item.active,
    }))).toEqual([
      { key: 'run_upscale', branchLabel: '精修', active: true },
      { key: 'run_parent', branchLabel: '探索', active: false },
    ])
    expect(buildVersionComparisonSummary(history, active)).toEqual({
      title: '高清精修 · 版本对比',
      detail: '由 探索 派生为 精修，来源输出 out_parent。',
      chips: ['来源 探索', '当前 精修', '4:5', '4K'],
    })
  })

  it('labels conversion, review, recovery, and recipe-derived branches', () => {
    const parent = makeRun({ id: 'run_parent' })
    const conversion = makeRun({
      id: 'run_conversion',
      references: [{ kind: 'generation_output', role: 'commerce_conversion_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    })
    const review = makeRun({
      id: 'run_review',
      references: [{ kind: 'generation_output', role: 'review_iteration_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    })
    const recovery = makeRun({
      id: 'run_recovery',
      metadata: { sourceRunId: 'run_parent', sourceRunStatus: 'failed', sourceRunFailureKind: 'timeout' },
    })
    const recipe = makeRun({
      id: 'run_recipe',
      sourceType: 'recipe',
      metadata: { sourceRecipeId: 'recipe_1', sourceRecipeRunId: 'run_parent', sourceRecipeOutputId: 'out_parent' },
    })

    expect(getStageVersionStripItems(getProjectVersionHistory([parent], conversion), conversion)[0].branchLabel).toBe('转换')
    expect(getStageVersionStripItems(getProjectVersionHistory([parent], review), review)[0].branchLabel).toBe('迭代')
    expect(getStageVersionStripItems(getProjectVersionHistory([parent], recovery), recovery)[0].branchLabel).toBe('恢复')
    expect(getStageVersionStripItems(getProjectVersionHistory([parent], recipe), recipe)[0].branchLabel).toBe('配方')
  })

  it('builds branch inspector summaries for core branch actions', () => {
    expect(buildBranchInspectorSummary(null)).toEqual({
      title: '等待路线',
      detail: '提交项目目标后，Inspector 会同步显示路线来源和下一步动作。',
      action: '先建立路线',
      chips: ['未开始'],
    })

    expect(buildBranchInspectorSummary(makeRun({
      id: 'run_edit',
      status: 'planned',
      references: [{ kind: 'generation_output', role: 'edit_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
      plan: { aspectRatio: '4:5', outputSize: '1K', outputCount: 1 },
    }))).toEqual({
      title: '局部修改分支',
      detail: '基于 out_parent 和遮罩继续编辑。',
      action: '确认费用后启动局改任务',
      chips: ['Mask', '4:5', '1K', '1 张'],
    })

    expect(buildBranchInspectorSummary(makeRun({
      id: 'run_conversion',
      references: [{ kind: 'generation_output', role: 'poster_conversion_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
      plan: { aspectRatio: '16:9', outputSize: '2K', outputCount: 1 },
    }))).toMatchObject({
      title: '用途转换分支',
      action: '确认费用后生成用途版本',
      chips: ['投放用途', '16:9', '2K', '1 张'],
    })

    expect(buildBranchInspectorSummary(makeRun({
      id: 'run_recovery',
      metadata: {
        sourceRunId: 'run_failed',
        sourceRunStatus: 'failed',
        sourceRunErrorSummary: '上游线路超时',
      },
      plan: { aspectRatio: '1:1', outputSize: '1K', outputCount: 2 },
    }))).toEqual({
      title: '恢复路线分支',
      detail: '上游线路超时',
      action: '确认恢复路线后再启动',
      chips: ['恢复', '1:1', '1K', '2 张'],
    })
  })

  it('falls back to static branch labels when there is no run history', () => {
    const items = getStageVersionStripItems([], null)

    expect(items.map((item) => ({
      key: item.key,
      label: item.label,
      active: item.active,
      hasRun: Boolean(item.run),
    }))).toEqual([
      { key: 'base', label: 'v1 路线探索', active: true, hasRun: false },
      { key: 'edit', label: 'v2 局部修改', active: false, hasRun: false },
      { key: 'variant', label: 'v3 变体探索', active: false, hasRun: false },
      { key: 'layout', label: 'v4 版式适配', active: false, hasRun: false },
    ])
  })

  it('summarizes the active version against its source run', () => {
    const parent = makeRun({
      id: 'run_parent',
      updatedAt: '2026-07-05T09:00:00.000Z',
    })
    const active = makeRun({
      id: 'run_active',
      updatedAt: '2026-07-05T10:00:00.000Z',
      references: [{ kind: 'generation_output', role: 'layout_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
      plan: { aspectRatio: '16:9', outputSize: '2K', outputCount: 1, referenceMode: 'selected_output_layout_adaptation' },
    })
    const history = getProjectVersionHistory([parent], active)

    expect(buildVersionComparisonSummary(history, active)).toEqual({
      title: '版式适配 · 版本对比',
      detail: '由 探索 派生为 适配，来源输出 out_parent。',
      chips: ['来源 探索', '当前 适配', '16:9', '2K'],
    })
  })

  it('treats recipe source metadata as lineage for version history', () => {
    const parent = makeRun({
      id: 'run_parent',
      updatedAt: '2026-07-05T09:00:00.000Z',
    })
    const active = makeRun({
      id: 'run_from_recipe',
      sourceType: 'recipe',
      updatedAt: '2026-07-05T10:00:00.000Z',
      metadata: {
        sourceRecipeId: 'recipe_1',
        sourceRecipeTitle: '冬季保温杯推广配方',
        sourceRecipeRunId: 'run_parent',
        sourceRecipeOutputId: 'output_parent',
      },
      plan: { aspectRatio: '16:9', outputSize: '1K', outputCount: 2 },
    })
    const history = getProjectVersionHistory([parent], active)

    expect(history.map((item) => ({
      id: item.run.id,
      relation: item.relation,
      label: item.relationLabel,
    }))).toEqual([
      { id: 'run_from_recipe', relation: 'current', label: '当前' },
      { id: 'run_parent', relation: 'source', label: '来源' },
    ])
    expect(buildVersionComparisonSummary(history, active)).toEqual({
      title: '配方复用 · 版本对比',
      detail: '由 探索 派生为 配方，来源输出 output_parent。',
      chips: ['来源 探索', '当前 配方', '16:9', '1K'],
    })
  })

  it('summarizes route source metadata for a recipe-derived route', () => {
    expect(buildRouteSourceSummary(makeRun({
      id: 'run_recipe',
      sourceType: 'recipe',
      metadata: {
        sourceRecipeId: 'recipe_long_identifier_1234',
        sourceRecipeTitle: '冬季保温杯推广配方',
        sourceRecipeRunId: 'run_parent',
        sourceRecipeOutputId: 'output_parent',
      },
    }))).toEqual({
      title: '配方来源',
      detail: '冬季保温杯推广配方',
      chips: ['Recipe recipe_...1234', 'Run run_parent', 'Output output_parent'],
    })
  })

  it('summarizes route source references for output-derived branches', () => {
    expect(buildRouteSourceSummary(makeRun({
      id: 'run_variant',
      references: [{
        kind: 'generation_output',
        role: 'variant_source',
        sourceRunId: 'run_parent',
        outputId: 'output_parent',
        taskId: 'task_parent',
      }],
    }))).toEqual({
      title: '变体来源',
      detail: 'Run run_parent · Output output_parent · Task task_parent',
      chips: ['Run run_parent', 'Output output_parent', 'Task task_parent'],
    })
  })

  it('uses route lineage metadata when output references are not available', () => {
    const parent = makeRun({
      id: 'run_parent',
      updatedAt: '2026-07-05T09:00:00.000Z',
    })
    const active = makeRun({
      id: 'run_metadata_lineage',
      updatedAt: '2026-07-05T10:00:00.000Z',
      metadata: {
        sourceRunId: 'run_parent',
        sourceTaskId: 'task_parent',
        sourceOutputId: 'output_parent',
        sourceReferenceRole: 'edit_source',
        sourceReferenceMode: 'selected_output_mask_edit',
      },
      plan: { referenceMode: 'selected_output_mask_edit', outputSize: '1K', outputCount: 1 },
    })

    expect(buildRouteSourceSummary(active)).toEqual({
      title: '局改来源',
      detail: 'Run run_parent · Output output_parent · Task task_parent',
      chips: ['Run run_parent', 'Output output_parent', 'Task task_parent'],
    })
    expect(getProjectVersionHistory([parent], active).map((item) => ({
      id: item.run.id,
      relation: item.relation,
      label: item.relationLabel,
    }))).toEqual([
      { id: 'run_metadata_lineage', relation: 'current', label: '当前' },
      { id: 'run_parent', relation: 'source', label: '来源' },
    ])
  })

  it('summarizes failed source runs as recovery route sources', () => {
    expect(buildRouteSourceSummary(makeRun({
      id: 'run_retry',
      metadata: {
        sourceRunId: 'run_failed',
        sourceRunStatus: 'failed',
        sourceRunFailureKind: 'upstream_invalid_request',
        sourceRunErrorSummary: '上游线路不支持该尺寸',
      },
    }))).toEqual({
      title: '失败恢复',
      detail: '上游线路不支持该尺寸',
      chips: ['Run run_failed', 'upstream_invalid_request'],
    })
  })

  it('summarizes recoverable failed assets with the failed step reason', () => {
    expect(buildRecoverableAssetSummary(makeRun({
      id: 'run_failed',
      status: 'failed',
      failureKind: 'upstream_invalid_request',
      errorSummary: '整体失败',
    }), [{
        id: 'step_1',
        runId: 'run_failed',
        stepKey: 'submit_generation_task',
        stepIndex: 5,
        status: 'failed',
        errorKind: 'upstream_invalid_request',
        errorSummary: '线路不支持该尺寸',
      }])).toEqual({
      recoverable: true,
      title: '可恢复失败路线',
      detail: '创建任务 · 线路不支持该尺寸',
      chips: ['失败', '创建任务', 'upstream_invalid_request'],
    })
  })

  it('summarizes recoverable canceled assets without step details', () => {
    expect(buildRecoverableAssetSummary(makeRun({
      id: 'run_canceled',
      status: 'canceled',
      errorSummary: '用户取消了队列任务',
    }))).toEqual({
      recoverable: true,
      title: '可恢复取消路线',
      detail: '用户取消了队列任务',
      chips: ['已取消'],
    })
  })

  it('builds recovery action summaries without implying automatic generation', () => {
    expect(buildRecoveryActionSummary(makeRun({
      id: 'run_failed',
      status: 'failed',
      failureKind: 'upstream_timeout',
      errorSummary: '上游生成超时',
    }), {
      id: 'step_1',
      runId: 'run_failed',
      stepKey: 'wait_generation_task',
      stepIndex: 7,
      status: 'failed',
      errorKind: 'upstream_timeout',
      errorSummary: '等待生成超时',
    })).toEqual({
      recoverable: true,
      title: '可恢复失败路线',
      detail: '等待生成 · 等待生成超时',
      chips: ['失败', '等待生成', 'upstream_timeout', '按阶段恢复', '重新规划'],
      actionLabel: '从该阶段恢复',
      nextStep: '会创建一条新的待确认路线，确认费用后才会启动生成。',
    })

    expect(buildRecoveryActionSummary(makeRun({
      id: 'run_canceled',
      status: 'canceled',
      errorSummary: '用户取消了队列任务',
    }))).toMatchObject({
      recoverable: true,
      actionLabel: '恢复路线',
      nextStep: '会创建一条新的待确认路线，确认费用后才会启动生成。',
      chips: ['已取消', '按路线恢复', '重新规划'],
    })
  })

  it('does not summarize successful assets as recoverable', () => {
    expect(buildRecoverableAssetSummary(makeRun({
      id: 'run_succeeded',
      status: 'succeeded',
    }))).toEqual({
      recoverable: false,
      title: '无需恢复',
      detail: '当前路线不需要恢复操作。',
      chips: [],
    })
  })

  it('builds next-step summaries for history asset cards', () => {
    expect(buildHistoryAssetNextStepSummary(makeRun({
      id: 'run_planned',
      status: 'planned',
      estimatedPoints: '2.5',
      references: [{ kind: 'generation_output', role: 'variant_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    }))).toEqual({
      title: '待确认路线',
      detail: '变体探索 已规划，确认费用后才会创建生成任务。',
      chips: ['变体', '2.50 点'],
      tone: 'action',
    })

    expect(buildHistoryAssetNextStepSummary(makeRun({
      id: 'run_confirmed',
      status: 'confirmed',
      confirmedPoints: '3',
      references: [{ kind: 'generation_output', role: 'layout_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    }))).toEqual({
      title: '可启动生成',
      detail: '版式适配 已确认费用，下一步是手动启动生成。',
      chips: ['适配', '3.00 点'],
      tone: 'action',
    })

    expect(buildHistoryAssetNextStepSummary(makeRun({
      id: 'run_done',
      status: 'succeeded',
      references: [{ kind: 'generation_output', role: 'upscale_source', sourceRunId: 'run_parent', outputId: 'out_parent' }],
    }))).toEqual({
      title: '可继续沉淀',
      detail: '高清精修 已完成，可查看结果、保存配方或继续派生。',
      chips: ['精修', 'Run run_parent · Output out_parent'],
      tone: 'success',
    })

    expect(buildHistoryAssetNextStepSummary(makeRun({
      id: 'run_failed',
      status: 'failed',
      failureKind: 'timeout',
      errorSummary: '上游超时',
    }))).toEqual({
      title: '可恢复失败路线',
      detail: '会创建一条新的待确认路线，确认费用后才会启动生成。',
      chips: ['探索', '失败', 'timeout', '按路线恢复', '重新规划'],
      tone: 'danger',
    })
  })

  it('does not show a route source summary for original routes', () => {
    expect(buildRouteSourceSummary(makeRun({ id: 'run_original' }))).toBeNull()
  })

  it('summarizes an original route without lineage', () => {
    const active = makeRun({
      id: 'run_active',
      plan: { aspectRatio: '4:5', outputSize: '1K', outputCount: 2 },
    })

    expect(buildVersionComparisonSummary(getProjectVersionHistory([], active), active)).toEqual({
      title: '路线探索 · 原始路线',
      detail: '这是当前项目的起始版本，可继续派生局部修改、变体或版式适配。',
      chips: ['4:5', '1K', '2 张'],
    })
  })

  it('returns a waiting version comparison summary without an active run', () => {
    expect(buildVersionComparisonSummary([], null)).toEqual({
      title: '等待版本',
      detail: '生成结果后会在这里记录版本来源、分支关系和下一步动作。',
      chips: ['未开始'],
    })
  })
})

describe('AgentWorkflowView execution control helpers', () => {
  const baseRun: AgentRun = {
    id: 'run_1',
    status: 'planned',
    userPrompt: '保温杯推广图',
    brief: {},
    plan: {},
    estimatedPoints: '2.5',
    planVersion: 1,
  }

  it('explains draft and planned execution states without implying task creation', () => {
    expect(buildExecutionControlSummary({ run: null })).toEqual({
      title: '尚未建立路线',
      detail: '提交项目目标后，Agent 会先生成待确认路线。',
      chips: ['未开始', '无任务', '不扣点'],
      tone: 'draft',
    })

    expect(buildExecutionControlSummary({ run: baseRun })).toEqual({
      title: '只生成了计划',
      detail: '当前还没有创建真实生图任务；确认费用后才进入可启动状态。',
      chips: ['待确认', '2.50 点', '未创建任务'],
      tone: 'planned',
    })
  })

  it('explains confirmed, running, and terminal execution states', () => {
    expect(buildExecutionControlSummary({
      run: { ...baseRun, status: 'confirmed', confirmedPoints: '2.5' },
    })).toEqual({
      title: '费用已确认，等待启动',
      detail: '费用已锁定但尚未创建真实生图任务；点击启动生成后才进入任务队列。',
      chips: ['已确认', '2.50 点', '待启动'],
      tone: 'confirmed',
    })

    expect(buildExecutionControlSummary({
      run: { ...baseRun, status: 'running', generationTaskId: 'task_1234567890' },
      generationTask: { taskId: 'task_1234567890', status: 'running', outputCount: 1, requestedOutputCount: 2, reservedPoints: 1.5 },
      outputProgressText: '1/2',
    })).toEqual({
      title: '真实生成任务运行中',
      detail: '任务 task_12...7890 已创建，结果会回到项目资产。',
      chips: ['running', '1/2', '1.50 点'],
      tone: 'running',
    })

    expect(buildExecutionControlSummary({
      run: { ...baseRun, status: 'running', generationTaskId: 'task_1234567890', confirmedPoints: '2.5' },
      outputProgressText: '0/2',
    })).toEqual({
      title: '真实生成任务运行中',
      detail: '任务 task_12...7890 已创建，结果会回到项目资产。',
      chips: ['running', '0/2', '2.50 点'],
      tone: 'running',
    })

    expect(buildExecutionControlSummary({
      run: { ...baseRun, status: 'failed', failureKind: 'timeout', errorSummary: '上游超时' },
    })).toEqual({
      title: '流程失败，可恢复',
      detail: '上游超时',
      chips: ['失败', 'timeout', '可恢复'],
      tone: 'danger',
    })
  })
})

describe('AgentWorkflowView route lifecycle helpers', () => {
  const plannedRun: AgentRun = {
    id: 'run_1',
    status: 'planned',
    userPrompt: '保温杯推广图',
    brief: {},
    plan: {},
    estimatedPoints: '2.5',
    planVersion: 1,
  }

  it('keeps planned and confirmed route actions distinct', () => {
    expect(getRouteLifecycleCopy(plannedRun, planSummary)).toEqual({
      title: '生成前检查',
      detail: '路线已规划但未创建任务。确认 2.00 点 后才可启动生成。',
      primaryActionLabel: '继续确认',
    })

    expect(getRouteLifecycleCopy({
      ...plannedRun,
      status: 'confirmed',
      confirmedPoints: '2.5',
    }, planSummary)).toEqual({
      title: '待启动任务',
      detail: '费用 2.00 点 已确认，点击启动后才会创建真实生图任务。',
      primaryActionLabel: '启动生成',
    })
  })

  it('describes recovery and running route actions', () => {
    expect(getRouteLifecycleCopy({
      ...plannedRun,
      status: 'running',
      generationTaskId: 'task_1234567890',
    }, planSummary)).toEqual({
      title: '生成队列运行中',
      detail: '服务端任务 task_12...7890 正在执行。',
      primaryActionLabel: '刷新状态',
    })

    expect(getRouteLifecycleCopy({
      ...plannedRun,
      status: 'canceled',
      errorSummary: '用户取消',
    }, planSummary)).toEqual({
      title: '流程已取消',
      detail: '用户取消',
      primaryActionLabel: '恢复路线',
    })
  })
})

describe('AgentWorkflowView plan override helpers', () => {
  const plannedRun: AgentRun = {
    id: 'run_1',
    status: 'planned',
    userPrompt: '产品推广图',
    category: '品牌广告',
    brief: {},
    plan: {
      prompt: '原始商业主视觉策略',
      negativePrompt: 'low quality',
      aspectRatio: '4:5',
      outputSize: '1K',
      outputCount: 2,
    },
    recommendedOutputCount: 2,
    planVersion: 1,
  }

  it('detects pending plan edits before confirmation', () => {
    const state = getPlanOverrideState({
      run: plannedRun,
      category: '产品静物',
      aspectRatio: '1:1',
      outputSize: '2k',
      outputCount: 1,
      planPromptDraft: '新的产品静物策略',
      negativePromptDraft: 'bad label',
    })

    expect(state).toEqual({
      hasChanges: true,
      changes: ['类型', '比例', '规格', '张数', '画面策略', '禁忌项'],
    })
  })

  it('ignores auto constraints and normalized output size casing', () => {
    const state = getPlanOverrideState({
      run: plannedRun,
      category: '自动判断',
      aspectRatio: '自动',
      outputSize: '1k',
      outputCount: 2,
      planPromptDraft: '原始商业主视觉策略',
      negativePromptDraft: 'low quality',
    })

    expect(state).toEqual({ hasChanges: false, changes: [] })
  })

  it('does not show pending edits for runs that are no longer planned', () => {
    const state = getPlanOverrideState({
      run: { ...plannedRun, status: 'confirmed' },
      category: '产品静物',
      aspectRatio: '1:1',
      outputSize: '2k',
      outputCount: 1,
      planPromptDraft: '新的产品静物策略',
      negativePromptDraft: 'bad label',
    })

    expect(state).toEqual({ hasChanges: false, changes: [] })
  })
})

describe('AgentWorkflowView timeline helpers', () => {
  const makeWorkflowRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
    id: 'run_1',
    status: 'planned',
    userPrompt: '保温杯推广图',
    brief: {},
    plan: {},
    planVersion: 1,
    ...overrides,
  })

  const makeWorkflowStep = (overrides: Partial<AgentStep> & { stepKey: string }): AgentStep => ({
    ...(() => {
      const { stepKey, ...rest } = overrides
      return {
        id: `${stepKey}_1`,
        runId: 'run_1',
        stepKey,
        stepIndex: 1,
        status: 'succeeded' as const,
        input: {},
        output: {},
        errorKind: null,
        errorSummary: null,
        ...rest,
      }
    })(),
  })

  it('builds workflow node states for planned, confirmed, and running routes', () => {
    const planningSteps = [
      makeWorkflowStep({ stepKey: 'understand_request' }),
      makeWorkflowStep({ stepKey: 'build_brief' }),
      makeWorkflowStep({ stepKey: 'compose_prompt' }),
      makeWorkflowStep({ stepKey: 'recommend_model' }),
    ]

    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({ status: 'planned' }),
      steps: planningSteps,
    }).map((node) => [node.id, node.status, node.summary])).toEqual([
      ['planning', 'succeeded', '推荐模型与规格'],
      ['approval', 'pending', '等待用户确认'],
      ['generation', 'pending', '待执行'],
      ['review', 'pending', '待执行'],
      ['asset', 'pending', '待执行'],
    ])

    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({ status: 'confirmed', confirmedAt: '2026-07-06T08:00:00.000Z' }),
      steps: [...planningSteps, makeWorkflowStep({ stepKey: 'confirm_cost', output: { confirmedPoints: '2.5' } })],
    }).map((node) => [node.id, node.status, node.summary])).toEqual([
      ['planning', 'succeeded', '推荐模型与规格'],
      ['approval', 'succeeded', '费用已确认'],
      ['generation', 'pending', '可启动生成'],
      ['review', 'pending', '待执行'],
      ['asset', 'pending', '待执行'],
    ])

    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({ status: 'running', generationTaskId: 'task_1234567890' }),
      steps: [
        ...planningSteps,
        makeWorkflowStep({ stepKey: 'confirm_cost' }),
        makeWorkflowStep({ stepKey: 'submit_generation_task' }),
        makeWorkflowStep({ stepKey: 'wait_generation_task', status: 'running' }),
      ],
    }).map((node) => [node.id, node.status, node.summary])).toEqual([
      ['planning', 'succeeded', '推荐模型与规格'],
      ['approval', 'succeeded', '费用已确认'],
      ['generation', 'running', '任务 task_12...7890'],
      ['review', 'pending', '待执行'],
      ['asset', 'pending', '待执行'],
    ])
  })

  it('builds workflow node states for completed results and saved recipes', () => {
    const steps = [
      makeWorkflowStep({ stepKey: 'understand_request' }),
      makeWorkflowStep({ stepKey: 'build_brief' }),
      makeWorkflowStep({ stepKey: 'compose_prompt' }),
      makeWorkflowStep({ stepKey: 'recommend_model' }),
      makeWorkflowStep({ stepKey: 'confirm_cost' }),
      makeWorkflowStep({ stepKey: 'submit_generation_task' }),
      makeWorkflowStep({ stepKey: 'wait_generation_task' }),
      makeWorkflowStep({ stepKey: 'collect_outputs', output: { outputCount: 2 } }),
    ]

    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({ status: 'succeeded' }),
      steps,
      outputCount: 2,
    }).map((node) => [node.id, node.status, node.summary])).toEqual([
      ['planning', 'succeeded', '推荐模型与规格'],
      ['approval', 'succeeded', '费用已确认'],
      ['generation', 'succeeded', '生成完成'],
      ['review', 'succeeded', '已收集 2 张'],
      ['asset', 'pending', '可沉淀'],
    ])

    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({
        status: 'succeeded',
        metadata: { recipeSaved: true, latestRecipeId: 'recipe_1' },
      }),
      steps: [...steps, makeWorkflowStep({ stepKey: 'save_recipe' })],
      outputCount: 2,
    }).at(-1)).toMatchObject({
      id: 'asset',
      status: 'succeeded',
      summary: '配方已保存',
    })
  })

  it('surfaces failed and canceled workflow nodes with recovery-ready summaries', () => {
    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({ status: 'failed' }),
      steps: [
        makeWorkflowStep({ stepKey: 'understand_request' }),
        makeWorkflowStep({ stepKey: 'submit_generation_task', status: 'failed', errorKind: 'gateway_timeout', errorSummary: '上游超时' }),
      ],
    }).find((node) => node.id === 'generation')).toMatchObject({
      status: 'failed',
      summary: '上游超时',
    })

    expect(buildWorkflowNodeStates({
      run: makeWorkflowRun({ status: 'canceled' }),
      steps: [
        makeWorkflowStep({ stepKey: 'understand_request' }),
        makeWorkflowStep({ stepKey: 'wait_generation_task', status: 'canceled' }),
      ],
    }).find((node) => node.id === 'generation')).toMatchObject({
      status: 'canceled',
      summary: '已取消，可恢复',
    })
  })

  it('builds compact timeline sections while preserving raw diagnostic data', () => {
    const sections = buildTimelineStepSections({
      id: 'step_1',
      runId: 'run_1',
      stepKey: 'submit_generation_task',
      stepIndex: 5,
      status: 'succeeded',
      input: {
        sourceRunId: 'agent_run_source_1234567890',
        references: [{ kind: 'generation_output', outputId: 'output_1' }],
        outputSize: '2k',
      },
      output: {
        summary: '任务已创建',
        taskId: 'generation_task_1234567890',
        requestedOutputCount: 2,
        estimatedPoints: '3.5',
      },
    })

    expect(sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'input',
        chips: expect.arrayContaining([
          'Run agent_r...7890',
          '规格 2k',
          '参考 1',
          '参考',
          '来源 Output output_1',
        ]),
        raw: expect.stringContaining('"sourceRunId"'),
      }),
      expect.objectContaining({
        key: 'output',
        chips: expect.arrayContaining([
          '任务已创建',
          'Task generat...7890',
          '请求 2 张',
          '3.50 点',
        ]),
        raw: expect.stringContaining('"taskId"'),
      }),
    ]))
  })

  it('summarizes local edit source and mask references in timeline chips', () => {
    const sections = buildTimelineStepSections({
      id: 'step_edit',
      runId: 'run_edit',
      stepKey: 'build_brief',
      stepIndex: 2,
      status: 'succeeded',
      input: {
        references: [
          {
            kind: 'generation_output',
            role: 'edit_source',
            outputId: 'output_parent_1234567890',
            taskId: 'task_parent_1234567890',
            sourceRunId: 'run_parent_1234567890',
          },
          {
            kind: 'mask_image',
            role: 'edit_mask',
            dataUrl: 'data:image/png;base64,bWFzaw==',
          },
        ],
      },
      output: {
        referenceMode: 'selected_output_mask_edit',
      },
    })

    expect(sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'input',
        chips: expect.arrayContaining([
          '参考 2',
          '局改来源',
          '来源 Output output_...7890',
          '来源 Task task_pa...7890',
          '来源 Run run_par...7890',
          '遮罩',
          '遮罩已保存',
        ]),
      }),
      expect.objectContaining({
        key: 'output',
        chips: expect.arrayContaining(['selected_output_mask_edit']),
      }),
    ]))
  })

  it('summarizes collected output ids in timeline output chips', () => {
    const sections = buildTimelineStepSections({
      id: 'step_collect',
      runId: 'run_1',
      stepKey: 'collect_outputs',
      stepIndex: 7,
      status: 'succeeded',
      input: { taskId: 'task_collect_1234567890' },
      output: {
        outputCount: 1,
        outputIds: ['output_collect_1234567890'],
        outputs: [{ id: 'output_collect_1234567890', width: 1024, height: 1024, storageStatus: 'active' }],
      },
    })

    expect(sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'output',
        chips: expect.arrayContaining([
          '1 张',
          '输出 1',
        ]),
        raw: expect.stringContaining('output_collect_1234567890'),
      }),
    ]))
  })

  it('adds a danger section for failed steps', () => {
    const sections = buildTimelineStepSections({
      id: 'step_1',
      runId: 'run_1',
      stepKey: 'wait_generation_task',
      stepIndex: 7,
      status: 'failed',
      input: {},
      output: {},
      errorKind: 'upstream_timeout',
      errorSummary: '上游生成超时',
    })

    expect(sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'error',
        tone: 'danger',
        chips: ['上游生成超时', 'upstream_timeout'],
      }),
    ]))
  })
})

describe('AgentWorkflowView retry helpers', () => {
  const failedRun: AgentRun = {
    id: 'run_failed',
    status: 'failed',
    userPrompt: '为新品耳机做品牌广告图',
    brief: {},
    plan: {},
    planVersion: 1,
    failureKind: 'upstream_invalid_request',
    errorSummary: '上游线路不支持该尺寸',
  }

  it('builds a retry prompt with failed timeline step context', () => {
    const prompt = buildRetryPromptFromRun(failedRun, {
      id: 'step_1',
      runId: 'run_failed',
      stepKey: 'submit_generation_task',
      stepIndex: 5,
      status: 'failed',
      input: {},
      output: {},
      errorKind: 'agent_reference_unavailable',
      errorSummary: '引用图片文件不可读取',
    })

    expect(prompt).toContain('为新品耳机做品牌广告图')
    expect(prompt).toContain('失败阶段：创建任务。引用图片文件不可读取')
    expect(prompt).not.toContain('上游线路不支持该尺寸')
  })

  it('falls back to the run failure reason when no timeline step is provided', () => {
    const prompt = buildRetryPromptFromRun(failedRun)

    expect(prompt).toContain('上游线路不支持该尺寸')
    expect(prompt).not.toContain('失败阶段')
  })
})

describe('AgentWorkflowView server output local edit helpers', () => {
  it('downloads a server output and stores it as a local generated image', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['server'], { type: 'image/png' }), { status: 200 }))
    const output: AgentRunOutput = {
      id: 'output_1',
      taskId: 'task_1',
      outputIndex: 0,
      url: '/api/generated-images/task_1/00.png',
    }

    await expect(loadServerOutputAsLocalImage(output)).resolves.toEqual({
      imageId: 'stored_image_1',
      dataUrl: 'data:image/png;base64,c2VydmVy',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/generated-images/task_1/00.png', { cache: 'no-store' })
    expect(storeImage).toHaveBeenCalledWith('data:image/png;base64,c2VydmVy', 'generated')
  })

  it('rejects server outputs without a readable URL', async () => {
    const output: AgentRunOutput = {
      id: 'output_1',
      taskId: 'task_1',
      outputIndex: 0,
    }

    await expect(loadServerOutputAsLocalImage(output)).rejects.toThrow('服务端输出缺少可读取图片地址')
  })
})

describe('AgentWorkflowView reference image helpers', () => {
  it('maps recipe source outputs to semantic Brief reference roles', () => {
    expect(getRecipeSourceReferenceRole({ category: '产品静物' })).toBe('product_reference')
    expect(getRecipeSourceReferenceRole({ category: '人像摄影' })).toBe('person_reference')
    expect(getRecipeSourceReferenceRole({ category: '空间氛围' })).toBe('space_reference')
    expect(getRecipeSourceReferenceRole({ category: '品牌广告' })).toBe('style_reference')
    expect(getRecipeSourceReferenceRole({ category: null })).toBe('style_reference')
  })

  it('extracts an inline reference asset from a recipe', () => {
    expect(getInlineReferenceAssetFromRecipe({
      id: 'recipe_1',
      title: '高端香薰配方',
      category: '品牌广告',
      prompt: 'premium candle campaign',
      params: {},
      references: [{
        kind: 'reference_image',
        role: 'style_reference',
        imageId: 'style_ref_1',
        dataUrl: 'data:image/png;base64,c3R5bGU=',
      }],
      visibility: 'private',
      status: 'active',
      useCount: 0,
    })).toEqual({
      key: 'recipe-recipe_1-style_ref_1',
      label: '风格参考',
      role: 'style_reference',
      kind: 'reference_image',
      imageId: 'style_ref_1',
      dataUrl: 'data:image/png;base64,c3R5bGU=',
      sourceRunId: null,
    })
  })

  it('returns null when a recipe has no inline image references', () => {
    expect(getInlineReferenceAssetFromRecipe({
      id: 'recipe_1',
      title: '高端香薰配方',
      prompt: 'premium candle campaign',
      params: {},
      references: [{ kind: 'generation_output', outputId: 'output_1' }],
      visibility: 'private',
      status: 'active',
      useCount: 0,
    })).toBeNull()
  })

  it('converts reusable reference assets back into Brief input images', () => {
    expect(getInputImageFromReferenceAsset({
      key: 'reference_image-ref_1',
      label: '产品参考',
      role: 'product_reference',
      kind: 'reference_image',
      imageId: 'ref_1',
      dataUrl: 'data:image/png;base64,cmVm',
    })).toEqual({
      id: 'ref_1',
      dataUrl: 'data:image/png;base64,cmVm',
    })
  })

  it('ignores reference assets without local image data', () => {
    expect(getInputImageFromReferenceAsset({
      key: 'generation_output-output_1',
      label: '变体来源',
      role: 'variant_source',
      kind: 'generation_output',
      outputId: 'output_1',
    })).toBeNull()
  })

  it('builds Brief reference payloads with semantic roles', () => {
    expect(buildAgentReferencePayload([
      { id: 'ref_product', dataUrl: 'data:image/png;base64,cHJvZA==' },
      { id: 'ref_style', dataUrl: 'data:image/png;base64,c3R5bGU=' },
    ], {
      ref_product: 'product_reference',
      ref_style: 'style_reference',
    })).toEqual([
      {
        kind: 'reference_image',
        role: 'product_reference',
        imageId: 'ref_product',
        dataUrl: 'data:image/png;base64,cHJvZA==',
        index: 0,
      },
      {
        kind: 'reference_image',
        role: 'style_reference',
        imageId: 'ref_style',
        dataUrl: 'data:image/png;base64,c3R5bGU=',
        index: 1,
      },
    ])
  })

  it('adds an output image to the first four Brief reference slots while preserving the tail', () => {
    const current = [
      { id: 'ref_1', dataUrl: 'data:image/png;base64,cmVmMQ==' },
      { id: 'ref_2', dataUrl: 'data:image/png;base64,cmVmMg==' },
      { id: 'tail_1', dataUrl: 'data:image/png;base64,dGFpbA==' },
    ]
    const output = { id: 'output_local_1', dataUrl: 'data:image/png;base64,b3V0' }

    expect(mergeAgentReferenceImages(current, output)).toEqual({
      inputImages: [
        current[0],
        current[1],
        current[2],
        output,
      ],
      status: 'added',
      added: true,
    })
  })

  it('keeps existing images unchanged when the output reference is already present', () => {
    const current = [
      { id: 'ref_1', dataUrl: 'data:image/png;base64,cmVmMQ==' },
      { id: 'output_local_1', dataUrl: 'data:image/png;base64,b3V0' },
    ]

    expect(mergeAgentReferenceImages(current, current[1])).toEqual({
      inputImages: current,
      status: 'duplicate',
      added: false,
    })
  })

  it('blocks adding output references when the Brief reference slots are full', () => {
    const current = [
      { id: 'ref_1', dataUrl: 'data:image/png;base64,MQ==' },
      { id: 'ref_2', dataUrl: 'data:image/png;base64,Mg==' },
      { id: 'ref_3', dataUrl: 'data:image/png;base64,Mw==' },
      { id: 'ref_4', dataUrl: 'data:image/png;base64,NA==' },
      { id: 'tail_1', dataUrl: 'data:image/png;base64,dGFpbA==' },
    ]

    expect(mergeAgentReferenceImages(current, { id: 'output_local_1', dataUrl: 'data:image/png;base64,b3V0' })).toEqual({
      inputImages: current,
      status: 'full',
      added: false,
    })
  })
})
