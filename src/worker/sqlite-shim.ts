export class D1PreparedStatementShim {
  constructor(
    public readonly sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatementShim {
    return new D1PreparedStatementShim(this.sql, values)
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const db = await getSyncDb()
    try {
      const stmt = db.prepare(this.sql)
      const row = stmt.get(...this.params) as Record<string, unknown> | undefined
      if (!row) return null
      if (colName) return (row[colName] as T) ?? null
      return row as T
    } catch (error) {
      console.error('SQL Error in first:', this.sql, this.params, error)
      throw error
    }
  }

  async all<T = unknown>(): Promise<{ success: boolean; results: T[] }> {
    const db = await getSyncDb()
    try {
      const stmt = db.prepare(this.sql)
      const results = stmt.all(...this.params) as T[]
      return { success: true, results }
    } catch (error) {
      console.error('SQL Error in all:', this.sql, this.params, error)
      throw error
    }
  }

  async run<T = unknown>(): Promise<{ success: boolean; meta: Record<string, unknown>; results: T[] }> {
    const db = await getSyncDb()
    try {
      const stmt = db.prepare(this.sql)
      const info = stmt.run(...this.params)
      return {
        success: true,
        meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
        results: [],
      }
    } catch (error) {
      if (!String((error as Error)?.message ?? '').match(/duplicate column/i)) {
        console.error('SQL Error in run:', this.sql, this.params, error)
      }
      throw error
    }
  }
}

export class D1DatabaseShim {
  prepare(sql: string): D1PreparedStatementShim {
    return new D1PreparedStatementShim(sql)
  }

  async batch(statements: D1PreparedStatementShim[]): Promise<{ success: boolean; results: unknown[]; meta?: Record<string, unknown> }[]> {
    const db = await getSyncDb()
    db.exec('BEGIN')
    try {
      const results: { success: boolean; results: unknown[]; meta?: Record<string, unknown> }[] = []
      for (const stmt of statements) {
        if (/^\s*SELECT/i.test(stmt.sql)) {
          const res = await stmt.all()
          results.push(res)
        } else {
          const res = await stmt.run()
          results.push(res)
        }
      }
      db.exec('COMMIT')
      return results
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    const db = await getSyncDb()
    db.exec(query)
    return { count: 1, duration: 0 }
  }
}

type AnyDb = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint }
  }
  exec: (sql: string) => void
}

let syncDb: AnyDb | null = null

async function getSyncDb(): Promise<AnyDb> {
  if (syncDb) return syncDb
  try {
    // Dynamic import to avoid missing types in Workers build
    // @ts-ignore
    const sqlite = await import('node:sqlite')
    // @ts-ignore
    const os = await import('node:os')
    // @ts-ignore
    const path = await import('node:path')
    const dbPath = path.join(os.tmpdir(), 'gather_planner.sqlite')
    try {
      syncDb = new sqlite.DatabaseSync(dbPath)
    } catch {
      syncDb = new sqlite.DatabaseSync(':memory:')
    }
  } catch (e) {
    console.warn('node:sqlite not available, using in-memory store:', e)
    syncDb = createMemoryFallback()
  }
  return syncDb!
}

/** Fallback store if node:sqlite is ever missing in an environment */
function createMemoryFallback(): AnyDb {
  const tables = new Map<string, Record<string, unknown>[]>()

  return {
    exec(_sql: string) {
      // DDL operations ignored in memory map
    },
    prepare(sql: string) {
      return {
        get(...params: unknown[]) {
          const allRows = this.all(...params)
          return allRows[0] ?? null
        },
        all(..._params: unknown[]) {
          const match = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i)
          const tableName = match ? match[1].toLowerCase() : ''
          return tables.get(tableName) ?? []
        },
        run(...params: unknown[]) {
          const insertMatch = sql.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i)
          if (insertMatch) {
            const table = insertMatch[1].toLowerCase()
            const list = tables.get(table) ?? []
            list.push({ id: params[0], data: params })
            tables.set(table, list)
          }
          return { changes: 1, lastInsertRowid: 1 }
        },
      }
    },
  }
}

let cachedDb: D1Database | undefined

export function getFallbackDb(): D1Database {
  if (!cachedDb) {
    cachedDb = new D1DatabaseShim() as unknown as D1Database
  }
  return cachedDb
}
