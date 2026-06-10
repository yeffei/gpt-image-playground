import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import GatewayDiagnosticsPanel from './GatewayDiagnosticsPanel'
import type { GatewayDiagnosticsPayload } from '../types'

vi.mock('../store', () => ({
  useStore: (selector: (state: { tasks: [] }) => unknown) => selector({ tasks: [] }),
}))

vi.mock('../lib/serverGatewayDiagnosticsApi', () => ({
  fetchServerGatewayDiagnostics: vi.fn(),
}))

import { fetchServerGatewayDiagnostics } from '../lib/serverGatewayDiagnosticsApi'

const fetchDiagnosticsMock = vi.mocked(fetchServerGatewayDiagnostics)

function createPayload(): GatewayDiagnosticsPayload {
  return {
    generatedAt: new Date('2026-06-03T10:09:42+08:00').getTime(),
    routes: [
      {
        id: 'route-1',
        name: 'Route 1',
        provider: 'openai-compatible',
        enabled: true,
        effectiveEnabled: false,
        exclusionReasons: ['operator_disabled'],
        priority: 1,
        weight: 1,
        timeoutSeconds: 180,
        initialLatencyMs: 115000,
        exhaustedCooldownSeconds: 21600,
        maxConcurrency: 2,
        currentInFlight: 0,
        supportsEdit: true,
        supportsMask: false,
        supportsStreaming: false,
        compatibilityStrategy: 'relay_extended',
        upstreamModelBySku: {
          'gpt-image-2-fast': 'gpt-image-2',
        },
        restoresAt: new Date('2026-06-03T12:00:00+08:00').getTime(),
        operatorOverride: {
          routeId: 'route-1',
          disabled: true,
          reason: 'manual drain',
          updatedAt: new Date('2026-06-03T10:00:00+08:00').getTime(),
        },
      },
    ],
    modelSkus: [
      {
        id: 'gpt-image-2-fast',
        label: '快速生成',
        enabled: true,
        routeIds: ['route-1'],
        supportedSizes: ['1024x1024'],
        supportedQualities: ['low'],
        maxOutputCount: 4,
      },
    ],
    routeHealthByModelSku: [],
    latestRequest: null,
    activeOverrides: [
      {
        routeId: 'route-1',
        disabled: true,
        reason: 'manual drain',
        updatedAt: new Date('2026-06-03T10:00:00+08:00').getTime(),
      },
    ],
    persistence: {
      available: true,
      mode: 'binding',
      key: 'image-gateway-state-v1',
    },
  }
}

describe('GatewayDiagnosticsPanel', () => {
  it('renders ops-only runtime state fields from the diagnostics payload', async () => {
    fetchDiagnosticsMock.mockResolvedValue(createPayload())

    const html = renderToStaticMarkup(<GatewayDiagnosticsPanel initialPayload={createPayload()} />)

    expect(html).toContain('运行态摘要')
    expect(html).toContain('生图线路判断')
    expect(html).toContain('当前没有运行中线路')
    expect(html).toContain('持久化：Binding')
    expect(html).toContain('生效中的人工停用：1')
    expect(html).toContain('当前停用')
    expect(html).toContain('manual drain')
    expect(html).toContain('image-gateway-state-v1')
    expect(html).toContain('当前排除原因')
    expect(html).toContain('人工停用中')
    expect(html).toContain('恢复时间')
  })

  it('renders single slow route and statically disabled fallback findings', () => {
    const payload: GatewayDiagnosticsPayload = {
      ...createPayload(),
      routes: [
        {
          id: 'route-1',
          name: 'Primary Relay Route',
          provider: 'openai-compatible',
          enabled: true,
          effectiveEnabled: true,
          exclusionReasons: [],
          priority: 1,
          weight: 1,
          timeoutSeconds: 180,
          initialLatencyMs: 115000,
          exhaustedCooldownSeconds: 21600,
          maxConcurrency: 2,
          currentInFlight: 0,
          supportsEdit: true,
          supportsMask: true,
          supportsStreaming: false,
          compatibilityStrategy: 'relay_extended',
          upstreamModelBySku: {
            'gpt-image-2-fast': 'gpt-image-2',
            'gpt-image-2-quality': 'gpt-image-2',
          },
        },
        {
          id: 'route-2',
          name: 'Secondary Relay Route',
          provider: 'openai-compatible',
          enabled: false,
          disabledReason: 'route exhausted in real smoke',
          effectiveEnabled: false,
          exclusionReasons: ['static_disabled'],
          priority: 2,
          weight: 1,
          timeoutSeconds: 180,
          initialLatencyMs: 30000,
          exhaustedCooldownSeconds: 21600,
          maxConcurrency: 2,
          currentInFlight: 0,
          supportsEdit: true,
          supportsMask: true,
          supportsStreaming: false,
          compatibilityStrategy: 'relay_extended',
          upstreamModelBySku: {
            'gpt-image-2-fast': 'gpt-image-2',
            'gpt-image-2-quality': 'gpt-image-2',
          },
        },
      ],
      modelSkus: [
        {
          id: 'gpt-image-2-fast',
          label: 'GPT Image 2 快速',
          enabled: true,
          routeIds: ['route-1'],
          supportedSizes: ['1024x1024', '1024x1536', '1536x1024'],
          supportedQualities: ['low', 'medium', 'high'],
          maxOutputCount: 1,
        },
      ],
      routeHealthByModelSku: [],
      latestRequest: null,
      activeOverrides: [],
      persistence: {
        available: false,
        mode: 'memory',
      },
    }

    const html = renderToStaticMarkup(<GatewayDiagnosticsPanel initialPayload={payload} />)

    expect(html).toContain('当前只有 route-1 可用，成功率和速度都依赖单一上游。')
    expect(html).toContain('route-1 基线延迟约 115s，恢复一条有余额的快线路前，慢是预期现象。')
    expect(html).toContain('route-2 已被静态配置停用，不会参与生图。')
    expect(html).toContain('静态停用原因：route exhausted in real smoke')
    expect(html).toContain('额度耗尽线路最短冷却 6h，不会频繁重复撞线。')
  })
})
