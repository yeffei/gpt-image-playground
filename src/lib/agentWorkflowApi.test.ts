import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentWorkflowApiError,
  archiveImageRecipe,
  cancelAgentRun,
  confirmAgentRun,
  createImageRecipe,
  getAgentRun,
  listImageRecipes,
  listAgentRuns,
  planAgentRun,
  replanAgentRun,
  reviewAgentRun,
  restoreImageRecipe,
  retryAgentRun,
  selectAgentRunPrimaryOutput,
  startAgentRun,
} from './agentWorkflowApi'

describe('agentWorkflowApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('plans an agent run with bearer auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      run: {
        id: 'agent_run_1',
        status: 'planned',
        userPrompt: '产品推广图',
        brief: {},
        plan: {},
        planVersion: 1,
      },
      steps: [],
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    const result = await planAgentRun({
      prompt: '产品推广图',
      clientRequestId: 'client-1',
      sourceType: 'recipe',
      sourceRunId: 'agent_run_source',
      sourceRecipeId: 'recipe_1',
      references: [{ kind: 'generation_output', outputId: 'output_1' }],
      preferences: { outputSize: '2k', outputCount: 4 },
    }, 'session-token')

    expect(result.run.id).toBe('agent_run_1')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Headers
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runs/plan', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        prompt: '产品推广图',
        clientRequestId: 'client-1',
        sourceType: 'recipe',
        sourceRunId: 'agent_run_source',
        sourceRecipeId: 'recipe_1',
        references: [{ kind: 'generation_output', outputId: 'output_1' }],
        preferences: { outputSize: '2k', outputCount: 4 },
      }),
    }))
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Authorization')).toBe('Bearer session-token')
  })

  it('calls confirm, start, get, list, and cancel endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      run: {
        id: 'agent_run_1',
        status: 'confirmed',
        userPrompt: '产品推广图',
        brief: {},
        plan: {},
        planVersion: 1,
      },
      steps: [],
      generationTask: {
        taskId: 'task_1',
        status: 'succeeded',
        requestId: 'request_1',
        requestedOutputCount: 1,
        outputCount: 1,
        reservedPoints: 1,
      },
      outputs: [{
        id: 'output_1',
        taskId: 'task_1',
        outputIndex: 0,
        url: '/api/generated-images/task_1/00.png',
        storageStatus: 'active',
      }],
      recipes: [{
        id: 'recipe_1',
        sourceRunId: 'agent_run_1',
        title: '产品推广图配方',
        prompt: 'prompt',
        params: {},
        visibility: 'private',
        status: 'active',
        useCount: 0,
      }],
      runs: [],
      total: 0,
      limit: 20,
      offset: 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await confirmAgentRun('agent/run 1', { planVersion: 1 }, 'session-token')
    await replanAgentRun('agent/run 1', { planVersion: 1, overrides: { outputSize: '1k' } }, 'session-token')
    await startAgentRun('agent/run 1', { planVersion: 1 }, 'session-token')
    await getAgentRun('agent/run 1', 'session-token')
    await listAgentRuns({ status: 'planned', limit: 10, offset: 5 }, 'session-token')
    await cancelAgentRun('agent/run 1', 'session-token')
    await retryAgentRun('agent/run 1', {
      prompt: '重新规划',
      preferences: { outputSize: '1k', outputCount: 1 },
    }, 'session-token')
    await reviewAgentRun('agent/run 1', {
      selectedOutputId: 'output_1',
      selectedTaskId: 'task_1',
      decision: 'accepted',
      note: '主图可用',
    }, 'session-token')
    await selectAgentRunPrimaryOutput('agent/run 1', {
      selectedOutputId: 'output_1',
      selectedTaskId: 'task_1',
    }, 'session-token')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/agent-runs/agent%2Frun%201/confirm',
      '/api/agent-runs/agent%2Frun%201/replan',
      '/api/agent-runs/agent%2Frun%201/start',
      '/api/agent-runs/agent%2Frun%201',
      '/api/agent-runs?status=planned&limit=10&offset=5',
      '/api/agent-runs/agent%2Frun%201/cancel',
      '/api/agent-runs/agent%2Frun%201/retry',
      '/api/agent-runs/agent%2Frun%201/review',
      '/api/agent-runs/agent%2Frun%201/primary-output',
    ])
    await expect(getAgentRun('agent/run 1', 'session-token')).resolves.toMatchObject({
      generationTask: expect.objectContaining({ taskId: 'task_1', status: 'succeeded' }),
      outputs: [expect.objectContaining({ id: 'output_1', taskId: 'task_1' })],
      recipes: [expect.objectContaining({ id: 'recipe_1', sourceRunId: 'agent_run_1' })],
    })
    const replanCall = fetchMock.mock.calls.find((call) => call[0] === '/api/agent-runs/agent%2Frun%201/replan')
    expect(replanCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        planVersion: 1,
        overrides: { outputSize: '1k' },
      }),
    }))
    const retryCall = fetchMock.mock.calls.find((call) => call[0] === '/api/agent-runs/agent%2Frun%201/retry')
    expect(retryCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        prompt: '重新规划',
        clientRequestId: undefined,
        references: undefined,
        preferences: { outputSize: '1k', outputCount: 1 },
      }),
    }))
    const reviewCall = fetchMock.mock.calls.find((call) => call[0] === '/api/agent-runs/agent%2Frun%201/review')
    expect(reviewCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        selectedOutputId: 'output_1',
        selectedTaskId: 'task_1',
        decision: 'accepted',
        note: '主图可用',
      }),
    }))
    const primaryOutputCall = fetchMock.mock.calls.find((call) => call[0] === '/api/agent-runs/agent%2Frun%201/primary-output')
    expect(primaryOutputCall?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        selectedOutputId: 'output_1',
        selectedTaskId: 'task_1',
      }),
    }))
  })

  it('calls image recipe create, list, and archive endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      recipe: {
        id: 'recipe_1',
        title: '产品推广图',
        prompt: 'prompt',
        params: {},
        visibility: 'private',
        status: 'active',
        useCount: 0,
      },
      recipes: [],
      total: 0,
      limit: 10,
      offset: 2,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await createImageRecipe({
      sourceRunId: 'agent/run 1',
      sourceTaskId: 'task 1',
      sourceOutputId: 'output 1',
      title: '产品推广图',
      metadata: { savedFrom: 'test' },
    }, 'session-token')
    await listImageRecipes({ status: 'active', limit: 10, offset: 2 }, 'session-token')
    await archiveImageRecipe('recipe/id 1', 'session-token')
    await restoreImageRecipe('recipe/id 1', 'session-token')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/image-recipes',
      '/api/image-recipes?status=active&limit=10&offset=2',
      '/api/image-recipes/recipe%2Fid%201/archive',
      '/api/image-recipes/recipe%2Fid%201/restore',
    ])
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        sourceRunId: 'agent/run 1',
        sourceTaskId: 'task 1',
        sourceOutputId: 'output 1',
        title: '产品推广图',
        category: undefined,
        prompt: undefined,
        negativePrompt: undefined,
        modelSkuId: undefined,
        params: undefined,
        references: undefined,
        brief: undefined,
        metadata: { savedFrom: 'test' },
        visibility: undefined,
      }),
    }))
  })

  it('throws normalized API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'invalid_agent_run_state',
      message: '当前创作流不能启动',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }))

    await expect(startAgentRun('agent_run_1', { planVersion: 1 }, 'session-token')).rejects.toMatchObject({
      name: 'AgentWorkflowApiError',
      status: 409,
      code: 'invalid_agent_run_state',
      message: '当前创作流不能启动',
    } satisfies Partial<AgentWorkflowApiError>)
  })
})
