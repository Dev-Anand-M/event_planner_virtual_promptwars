import type { IncomingMessage, ServerResponse } from 'node:http'
import worker from '../src/worker/index'

export const config = {
  maxDuration: 60,
}

async function handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'https'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost'
  const url = `${protocol}://${host}${req.url}`

  const headers = new Headers()
  for (const [key, val] of Object.entries(req.headers)) {
    if (val !== undefined) {
      if (Array.isArray(val)) val.forEach((v) => headers.append(key, v))
      else headers.set(key, val)
    }
  }

  let body: Buffer | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    body = Buffer.concat(chunks)
  }

  const webReq = new Request(url, {
    method: req.method,
    headers,
    body: body && body.length > 0 ? body : undefined,
    // @ts-expect-error duplex required in Node for Request with body
    duplex: 'half',
  })

  const response = await worker.fetch(webReq)

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  res.end()
}

export default async function handler(req: Request | IncomingMessage, res?: ServerResponse): Promise<Response | void> {
  if (res && typeof (res as ServerResponse).setHeader === 'function') {
    return handleNodeRequest(req as IncomingMessage, res as ServerResponse)
  }
  return worker.fetch(req as Request)
}
