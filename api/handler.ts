import type { IncomingMessage, ServerResponse } from 'node:http'

export const config = {
  maxDuration: 60,
}

type WorkerInstance = {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response>
}

let cachedWorker: WorkerInstance | null = null

async function getWorker(): Promise<WorkerInstance> {
  if (cachedWorker) return cachedWorker
  try {
    // When built for production, dist/ai_chat/index.js contains the bundled server code
    // @ts-expect-error dynamic import of built worker
    const mod = await import('../dist/ai_chat/index.js')
    cachedWorker = (mod.default ?? mod) as WorkerInstance
  } catch {
    // Development or test fallback
    const mod = await import('../src/worker/index.ts')
    cachedWorker = (mod.default ?? mod) as WorkerInstance
  }
  return cachedWorker
}

async function handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
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

    let body: BodyInit | undefined = undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const parsedBody = (req as unknown as { body?: unknown }).body
      if (parsedBody !== undefined && parsedBody !== null) {
        body =
          typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody)
            ? JSON.stringify(parsedBody)
            : (parsedBody as BodyInit)
      } else {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        }
        if (chunks.length > 0) {
          body = Buffer.concat(chunks)
        }
      }
    }

    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: body ?? undefined,
      // @ts-expect-error duplex required in Node for Request with body
      duplex: 'half',
    })

    const worker = await getWorker()
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
  } catch (err: unknown) {
    console.error('Serverless execution error:', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      const msg = err instanceof Error ? err.message : String(err)
      res.end(JSON.stringify({ error: msg, message: msg }))
    }
  }
}

export default async function handler(req: Request | IncomingMessage, res?: ServerResponse): Promise<Response | void> {
  if (res && typeof (res as ServerResponse).setHeader === 'function') {
    return handleNodeRequest(req as IncomingMessage, res as ServerResponse)
  }
  const worker = await getWorker()
  return worker.fetch(req as Request)
}
