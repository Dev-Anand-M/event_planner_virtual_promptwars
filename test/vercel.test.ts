import { describe, expect, it } from 'bun:test'
import handler from '../api/index'
import worker from '../src/worker/index'

describe('Vercel API & SQLite Shim Integration', () => {
  it('GET /api/health works via worker.fetch directly', async () => {
    const req = new Request('http://localhost:3000/api/health')
    const res = await worker.fetch(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true })
  })

  it('GET /api/auth/status returns development mode and database ready without Freebuff OAuth', async () => {
    const req = new Request('http://localhost:3000/api/auth/status')
    const res = await worker.fetch(req)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { mode: string; database: boolean }
    expect(data.mode).toBe('development')
    expect(data.database).toBe(true)
  })

  it('GET /api/me auto-seeds sample event and user with SQLite shim', async () => {
    const req = new Request('http://localhost:3000/api/me', {
      headers: { origin: 'http://localhost:3000' },
    })
    const res = await worker.fetch(req)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { user: { sub: string }; capabilities: { database: boolean } }
    expect(data.user.sub).toBe('dev-user')
    expect(data.capabilities.database).toBe(true)
  })

  it('GET /api/events returns items including seeded event', async () => {
    const req = new Request('http://localhost:3000/api/events', {
      headers: { origin: 'http://localhost:3000' },
    })
    const res = await worker.fetch(req)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { items: { id: string; title: string; plan: unknown }[] }
    expect(Array.isArray(data.items)).toBe(true)
    expect(data.items.length).toBeGreaterThanOrEqual(1)
    expect(data.items[0].plan).toBeDefined()
  })

  it('POST /api/events creates a new event with rule-computed plan', async () => {
    const body = {
      kind: 'wedding',
      title: 'Vercel Deployment Test Wedding',
      date: '2027-09-18',
      city: 'San Francisco',
      guests: 85,
      budgetTotal: 25000,
      details: 'Outdoor garden ceremony',
    }
    const req = new Request('http://localhost:3000/api/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify(body),
    })
    const res = await worker.fetch(req)
    expect(res.status).toBe(201)
    const data = (await res.json()) as { event: { id: string; title: string; plan: { budget: { total: number } } } }
    expect(data.event.title).toBe('Vercel Deployment Test Wedding')
    expect(data.event.plan.budget.total).toBe(25000)
  })

  it('Vercel handler processes Request and returns Response', async () => {
    const req = new Request('https://event-planner-test.vercel.app/api/health')
    const res = (await handler(req)) as Response
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ ok: true })
  })
})
