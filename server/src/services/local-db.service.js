/**
 * LocalDB — In-memory storage fallback for when Supabase is unavailable.
 * Provides the same query interface as Supabase so routes work unchanged.
 * 
 * Usage:
 *   const db = getLocalDb();  // Returns a Supabase-compatible client
 *   const { data, error } = await db.from('users').select('*').eq('id', '123').single();
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

function uuid() {
  return crypto.randomUUID();
}

// ================================================================
// In-memory tables
// ================================================================

const tables = {
  users: new Map(),
  donors: new Map(),
  receivers: new Map(),
  connections: new Map(),
  usage_logs: [],
  blocklist: new Map(),
  reviews: [],
  transfers: []
};

// Seed a test user so login/register works
const seedUserId = uuid();
tables.users.set(seedUserId, {
  id: seedUserId,
  phone: 'test@datashare.app',
  name: 'Test User',
  role: 'both',
  created_at: new Date().toISOString(),
  is_active: true
});

tables.donors.set(uuid(), {
  id: uuid(),
  user_id: seedUserId,
  status: 'offline',
  max_receivers: 3,
  current_receivers: 0,
  settings: { data_limit_mb: 500, time_limit_min: 60, daily_total_gb: 5 },
  location: null,
  created_at: new Date().toISOString(),
  last_seen: new Date().toISOString()
});

tables.receivers.set(uuid(), {
  id: uuid(),
  user_id: seedUserId,
  status: 'disconnected',
  data_needed_mb: 0,
  location: null,
  created_at: new Date().toISOString()
});

logger.info(`📦 LocalDB seeded with test user (id: ${seedUserId})`);

// ================================================================
// Query Builder — chainable, Supabase-compatible
// ================================================================

class QueryBuilder {
  constructor(tableName) {
    this.tableName = tableName;
    this._filters = [];
    this._selectCols = '*';
    this._insertRows = null;
    this._updateData = null;
    this._orderBy = null;
    this._orderAsc = true;
    this._limitCount = null;
    this._isSingle = false;
    this._isMaybeSingle = false;
    this._countOption = null;
    this._returning = true;
    this._joinedTables = [];
  }

  select(cols) {
    if (typeof cols === 'string') {
      this._selectCols = cols;
    }
    return this;
  }

  eq(col, val) {
    this._filters.push({ op: 'eq', col, val });
    return this;
  }

  neq(col, val) {
    this._filters.push({ op: 'neq', col, val });
    return this;
  }

  lt(col, val) {
    this._filters.push({ op: 'lt', col, val });
    return this;
  }

  lte(col, val) {
    this._filters.push({ op: 'lte', col, val });
    return this;
  }

  gt(col, val) {
    this._filters.push({ op: 'gt', col, val });
    return this;
  }

  gte(col, val) {
    this._filters.push({ op: 'gte', col, val });
    return this;
  }

  in(col, vals) {
    this._filters.push({ op: 'in', col, vals });
    return this;
  }

  is(col, val) {
    this._filters.push({ op: 'is', col, val });
    return this;
  }

  not(col, op, val) {
    this._filters.push({ op: 'not', col, notOp: op, val });
    return this;
  }

  order(col, opts) {
    this._orderBy = col;
    this._orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n) {
    this._limitCount = n;
    return this;
  }

  single() {
    this._isSingle = true;
    return this;
  }

  maybeSingle() {
    this._isMaybeSingle = true;
    return this;
  }

  insert(rows) {
    this._insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(data) {
    this._updateData = data;
    return this;
  }

  delete() {
    return this._executeDelete();
  }

  // ================================================================
  // Execution — make QueryBuilder thenable so 'await' triggers query
  // ================================================================

  then(resolve, reject) {
    const result = this._execute();
    if (result && typeof result.then === 'function') {
      return result.then(resolve, reject);
    }
    return Promise.resolve(result).then(resolve, reject);
  }

  async _execute() {
    try {
      const table = tables[this.tableName];
      if (!table) {
        return { data: null, error: new Error(`Table not found: ${this.tableName}`) };
      }

      // INSERT
      if (this._insertRows) {
        return this._doInsert(table);
      }

      // UPDATE
      if (this._updateData) {
        return this._doUpdate(table);
      }

      // SELECT (default)
      return this._doSelect(table);
    } catch (err) {
      logger.error(`LocalDB error (${this.tableName}): ${err.message}`);
      return { data: null, error: err };
    }
  }

  // ================================================================
  // INSERT
  // ================================================================

  _doInsert(table) {
    const inserted = [];
    for (const row of this._insertRows) {
      const id = row.id || uuid();
      const now = new Date().toISOString();
      const record = {
        id,
        created_at: row.created_at || now,
        ...row,
        id  // ensure id is set
      };

      if (table instanceof Map) {
        table.set(id, record);
      } else if (Array.isArray(table)) {
        table.push(record);
      }
      inserted.push(record);
    }

    const result = this._isSingle || this._isMaybeSingle
      ? inserted[0]
      : inserted;

    return { data: result, error: null };
  }

  // ================================================================
  // UPDATE
  // ================================================================

  _doUpdate(table) {
    const rows = this._filterTable(table);
    const updated = [];

    for (const row of rows) {
      const updatedRow = { ...row, ...this._updateData };
      if (table instanceof Map) {
        table.set(row.id, updatedRow);
      }
      updated.push(updatedRow);
    }

    if (this._isSingle || this._isMaybeSingle) {
      return { data: updated[0] || null, error: null };
    }

    return { data: updated, error: null };
  }

  // ================================================================
  // DELETE
  // ================================================================

  _executeDelete() {
    const table = tables[this.tableName];
    if (!table) return { data: null, error: new Error(`Table not found: ${this.tableName}`) };

    const toDelete = this._filterTable(table);
    for (const row of toDelete) {
      if (table instanceof Map) {
        table.delete(row.id);
      }
    }

    return { data: toDelete, error: null };
  }

  // ================================================================
  // SELECT with filter, join, order, limit
  // ================================================================

  _doSelect(table) {
    // Start with filtered rows
    let rows = this._filterTable(table);

    // Handle joins: select('*, othertable!fk(col)')
    const joinPattern = /\*,\s*(\w+)!(\w+)(?:\(([^)]*)\))?(?:\s*\(\*\))?/g;
    let match;
    let joinSpecs = [];

    if (typeof this._selectCols === 'string') {
      const re = /\*,\s*(\w+)!(\w+)(?:\(([^)]*)\))?/g;
      while ((match = re.exec(this._selectCols)) !== null) {
        joinSpecs.push({
          tableName: match[1],
          joinType: match[2],  // inner, left, or fk constraint name
          cols: match[3] ? match[3].split(',').map(c => c.trim()) : '*'
        });
      }
    }

    // For each row, do joins
    if (joinSpecs.length > 0) {
      rows = rows.map(row => {
        let joined = { ...row };
        for (const spec of joinSpecs) {
          const joinTable = tables[spec.joinType];
          if (joinTable instanceof Map) {
            // Simple lookup by the row's id matching the table name
            // e.g., 'users!inner(*)' means join users where users.id = row.user_id
            const fkCol = spec.joinType === 'inner' ? `${spec.tableName.slice(0, -1)}_id` : 'user_id';
            const fkValue = row[`${spec.tableName.slice(0, -1)}_id`] || row.user_id;
            if (fkValue) {
              const joinedRow = joinTable.get(fkValue);
              if (joinedRow) {
                joined[spec.tableName] = spec.cols === '*'
                  ? joinedRow
                  : spec.cols.reduce((acc, c) => ({ ...acc, [c]: joinedRow[c] }), {});
              }
            }
          }
        }
        return joined;
      });
    }

    // Parse select columns (handle '*, table(*)')
    let selectCols = '*';
    if (typeof this._selectCols === 'string') {
      // Remove join parts
      const cleanSelect = this._selectCols.replace(/\*,\s*\w+!\w+(?:\([^)]*\))?(?:\s*\(\*\))?/g, '*').trim();
      selectCols = cleanSelect || '*';
    }

    // Apply column projection
    if (selectCols !== '*' && typeof selectCols === 'string') {
      const cols = selectCols.split(',').map(c => c.trim());
      rows = rows.map(row => {
        const projected = {};
        for (const col of cols) {
          if (col === '*') {
            Object.assign(projected, row);
          } else {
            // Handle nested table access: 'table(col)'
            const nestedMatch = col.match(/^(\w+)\((\w+)\)$/);
            if (nestedMatch) {
              const [_, nestedTable, nestedCol] = nestedMatch;
              if (row[nestedTable] && typeof row[nestedTable] === 'object') {
                projected[nestedCol] = row[nestedTable][nestedCol];
              }
            } else if (col in row) {
              projected[col] = row[col];
            }
          }
        }
        return projected;
      });
    }

    // Order
    if (this._orderBy) {
      rows.sort((a, b) => {
        const va = a[this._orderBy];
        const vb = b[this._orderBy];
        if (va < vb) return this._orderAsc ? -1 : 1;
        if (va > vb) return this._orderAsc ? 1 : -1;
        return 0;
      });
    }

    // Limit
    if (this._limitCount && rows.length > this._limitCount) {
      rows = rows.slice(0, this._limitCount);
    }

    // Handle count option
    if (this._countOption) {
      return { data: rows, count: rows.length, error: null };
    }

    // single / maybeSingle
    if (this._isSingle) {
      if (rows.length === 0) {
        return { data: null, error: { code: 'PGRST116', message: 'Row not found', details: '', hint: '' } };
      }
      return { data: rows[0], error: null };
    }

    if (this._isMaybeSingle) {
      return { data: rows[0] || null, error: null };
    }

    return { data: rows, error: null };
  }

  // ================================================================
  // Filter rows by criteria
  // ================================================================

  _filterTable(table) {
    const rows = [];
    if (table instanceof Map) {
      for (const row of table.values()) {
        rows.push(row);
      }
    } else if (Array.isArray(table)) {
      rows.push(...table);
    }

    return rows.filter(row => {
      for (const f of this._filters) {
        const colVal = row[f.col];
        switch (f.op) {
          case 'eq':
            if (colVal !== f.val) return false;
            break;
          case 'neq':
            if (colVal === f.val) return false;
            break;
          case 'lt':
            if (!(colVal < f.val)) return false;
            break;
          case 'lte':
            if (!(colVal <= f.val)) return false;
            break;
          case 'gt':
            if (!(colVal > f.val)) return false;
            break;
          case 'gte':
            if (!(colVal >= f.val)) return false;
            break;
          case 'in':
            if (!f.vals.includes(colVal)) return false;
            break;
          case 'is':
            if (f.val === null && colVal !== null) return false;
            if (f.val !== null && colVal !== f.val) return false;
            break;
          case 'not':
            // Simple not-eq implementation
            if (colVal === f.val) return false;
            break;
        }
      }
      return true;
    });
  }
}

// ================================================================
// Supabase-compatible client
// ================================================================

function createLocalClient() {
  return {
    from: (tableName) => new QueryBuilder(tableName),
    rpc: async (fn, params) => {
      logger.warn(`LocalDB: RPC ${fn} not implemented`);
      return { data: null, error: null };
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signUp: async () => ({ data: null, error: null }),
      signInWithOtp: async () => ({ data: null, error: null }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        download: async () => ({ data: null, error: null }),
        list: async () => ({ data: [], error: null }),
      })
    }
  };
}

// Singleton
let localClient = null;

function getLocalDb() {
  if (!localClient) {
    localClient = createLocalClient();
    logger.info('📦 LocalDB initialized (in-memory storage)');
  }
  return localClient;
}

// For health check with count
function getLocalDbCount(table) {
  const t = tables[table];
  if (t instanceof Map) return t.size;
  if (Array.isArray(t)) return t.length;
  return 0;
}

module.exports = { getLocalDb, getLocalDbCount };
