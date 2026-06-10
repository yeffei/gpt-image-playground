import type { GatewayDiagnosticsPayload } from '../types'
import { getServerImageGatewayPath } from './serverImageGatewayConfig'
import { getApiErrorMessage } from './imageApiShared'

function getDiagnosticsPath() {
  const basePath = getServerImageGatewayPath()
  return basePath.replace(/\/generate$/, '/gateway/diagnostics')
}

export async function fetchServerGatewayDiagnostics(): Promise<GatewayDiagnosticsPayload> {
  const response = await fetch(getDiagnosticsPath(), {
    method: 'GET',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  return await response.json() as GatewayDiagnosticsPayload
}
