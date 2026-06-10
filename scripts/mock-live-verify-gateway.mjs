import http from 'node:http'

const host = process.env.MOCK_LIVE_VERIFY_GATEWAY_HOST || '127.0.0.1'
const port = Number(process.env.MOCK_LIVE_VERIFY_GATEWAY_PORT || 8792)

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/image/generate') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: 'Not found' } }))
    return
  }

  const body = await new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })

  const isFailure = body?.prompt === 'fail'
  const isEdit = Array.isArray(body?.inputImageDataUrls) && body.inputImageDataUrls.length > 0
  const requestId = 'imggw-mock-live-1'
  const attempts = isFailure
    ? [
        {
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 1200,
          errorMessage: 'overloaded 429',
          failureKind: 'upstream_rate_limited',
        },
      ]
    : [
        {
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          success: true,
          latencyMs: 840,
        },
      ]
  const routeHealth = {
    requestId,
    modelSku: body?.modelSku || 'gpt-image-2-fast',
    capturedAt: Date.now(),
    routes: [
      {
        routeId: 'route-1',
        upstreamModel: 'gpt-image-2',
        status: isFailure ? 'degraded' : 'healthy',
        inFlight: 0,
        successCount: isFailure ? 0 : 1,
        failureCount: isFailure ? 1 : 0,
        consecutiveFailures: isFailure ? 1 : 0,
        lastFailureKind: isFailure ? 'upstream_rate_limited' : undefined,
      },
    ],
  }

  res.writeHead(isFailure ? 502 : 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Image-Gateway-Request-Id': requestId,
  })
  res.end(JSON.stringify(
    isFailure
      ? {
          error: {
            message: 'Mock gateway overloaded',
            requestId,
            failureKind: 'upstream_rate_limited',
            routeId: 'route-1',
            upstreamModel: 'gpt-image-2',
            attempts,
            routeHealth,
          },
        }
      : {
          images: ['data:image/png;base64,aGVsbG8='],
          modelSku: body?.modelSku || 'gpt-image-2-fast',
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          editMode: isEdit,
          attempts,
          routeHealth,
        },
  ))
})

server.listen(port, host, () => {
  console.log(`Mock live verify gateway listening at http://${host}:${port}/api/image/generate`)
})
