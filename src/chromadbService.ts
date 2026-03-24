import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';

const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateIdentifier(name: string): string {
    if (!SAFE_IDENT_RE.test(name)) {
        throw new Error(`Invalid identifier: ${name}`);
    }
    return name;
}

let _sqlJsPromise: Promise<SqlJsStatic> | null = null;

function getSqlJs(): Promise<SqlJsStatic> {
    if (!_sqlJsPromise) {
        _sqlJsPromise = initSqlJs();
    }
    return _sqlJsPromise!;
}

// Helper: convert sql.js result rows (arrays) to objects
// Helper: run a query and get array of row objects using exec()
function queryAll(db: SqlJsDatabase, sql: string, params: any[] = []): Record<string, any>[] {
    let results: Record<string, any>[];
    if (params.length > 0) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows: Record<string, any>[] = [];
        const cols: string[] = stmt.getColumnNames();
        while (stmt.step()) {
            const values = stmt.get();
            const row: Record<string, any> = {};
            for (let i = 0; i < cols.length; i++) {
                const v = values[i];
                if (v instanceof Uint8Array) {
                    row[cols[i]] = `[BLOB ${v.length} bytes]`;
                } else {
                    row[cols[i]] = v;
                }
            }
            rows.push(row);
        }
        stmt.free();
        results = rows;
    } else {
        const execResult = db.exec(sql);
        if (execResult.length === 0) { return []; }
        const { columns, values } = execResult[0];
        results = values.map(vals => {
            const row: Record<string, any> = {};
            for (let i = 0; i < columns.length; i++) {
                const v = vals[i];
                if (v instanceof Uint8Array) {
                    row[columns[i]] = `[BLOB ${v.length} bytes]`;
                } else {
                    row[columns[i]] = v;
                }
            }
            return row;
        });
    }
    return results;
}

// Helper: run a query and get first row
function queryOne(db: SqlJsDatabase, sql: string, params: any[] = []): Record<string, any> | null {
    const rows = queryAll(db, sql, params);
    return rows.length > 0 ? rows[0] : null;
}

// Helper: get scalar value
function queryScalar(db: SqlJsDatabase, sql: string, params: any[] = []): any {
    const rows = queryAll(db, sql, params);
    if (rows.length === 0) { return null; }
    const first = rows[0];
    const keys = Object.keys(first);
    return keys.length > 0 ? first[keys[0]] : null;
}

// Helper: run PRAGMA and get results
function pragmaAll(db: SqlJsDatabase, pragmaSql: string): Record<string, any>[] {
    return queryAll(db, pragmaSql);
}

export class ChromaDBService {
    private dbPath: string | null = null;
    private _cachedDb: SqlJsDatabase | null = null;

    get isConnected(): boolean {
        return this.dbPath !== null && fs.existsSync(this.dbPath);
    }

    private async openDb(): Promise<SqlJsDatabase> {
        if (this._cachedDb) {
            return this._cachedDb;
        }
        if (!this.dbPath) {
            throw new Error('No database connected. Use the UI to open a .sqlite3 file.');
        }
        const SQL = await getSqlJs();
        const buffer = fs.readFileSync(this.dbPath);
        const db = new SQL.Database(buffer);
        db.run('PRAGMA query_only = ON');
        this._cachedDb = db;
        return db;
    }

    private closeDb(): void {
        if (this._cachedDb) {
            try { this._cachedDb.close(); } catch { /* ignore */ }
            this._cachedDb = null;
        }
    }

    // ---- Connection management ----

    getStatus(): any {
        if (this.dbPath && fs.existsSync(this.dbPath)) {
            const stat = fs.statSync(this.dbPath);
            return {
                connected: true,
                path: this.dbPath,
                filename: path.basename(this.dbPath),
                size_bytes: stat.size,
                size_mb: Math.round(stat.size / (1024 * 1024) * 100) / 100,
            };
        }
        return { connected: false };
    }

    async connect(filePath: string): Promise<any> {
        const cleaned = filePath.trim().replace(/^["']|["']$/g, '');
        const absPath = path.resolve(cleaned);
        if (!fs.existsSync(absPath)) {
            throw new Error(`File not found: ${absPath}`);
        }
        const ext = path.extname(absPath).toLowerCase();
        if (ext !== '.sqlite3' && ext !== '.db') {
            throw new Error('Only .sqlite3 and .db files are supported');
        }
        // Close any existing connection
        this.closeDb();
        // Open and cache the new database
        this.dbPath = absPath;
        const db = await this.openDb();
        // Verify it's a valid SQLite file
        queryOne(db, 'SELECT name FROM sqlite_master LIMIT 1');
        const stat = fs.statSync(absPath);
        return {
            connected: true,
            path: absPath,
            filename: path.basename(absPath),
            size_bytes: stat.size,
            size_mb: Math.round(stat.size / (1024 * 1024) * 100) / 100,
        };
    }

    disconnect(): any {
        this.closeDb();
        this.dbPath = null;
        return { connected: false };
    }

    getInfo(): any {
        if (!this.dbPath) { throw new Error('No database connected'); }
        const stat = fs.statSync(this.dbPath);
        return {
            path: this.dbPath,
            filename: path.basename(this.dbPath),
            size_bytes: stat.size,
            size_mb: Math.round(stat.size / (1024 * 1024) * 100) / 100,
        };
    }

    // ---- Database statistics ----

    async getStats(): Promise<any> {
        const db = await this.openDb();
        const allTables: string[] = queryAll(db,
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).map(r => r.name as string);

        let totalRows = 0;
        const tableRowsMap: Record<string, number> = {};
        for (const t of allTables) {
            try {
                const cnt = queryScalar(db, `SELECT COUNT(*) FROM "${t}"`) || 0;
                tableRowsMap[t] = cnt;
                totalRows += cnt;
            } catch { tableRowsMap[t] = 0; }
        }

        let totalColumns = 0;
        for (const t of allTables) {
            try {
                totalColumns += pragmaAll(db, `PRAGMA table_info("${t}")`).length;
            } catch { /* skip */ }
        }

        const collections = tableRowsMap['collections'] || 0;
        const segments = tableRowsMap['segments'] || 0;
        const embeddings = tableRowsMap['embeddings'] || 0;
        const metadataRows = tableRowsMap['embedding_metadata'] || 0;

        let uniqueDocs = 0;
        if (allTables.includes('embedding_metadata')) {
            try {
                uniqueDocs = queryScalar(db,
                    'SELECT COUNT(DISTINCT string_value) FROM embedding_metadata WHERE key = "chroma:document"'
                ) || 0;
            } catch { /* ignore */ }
        }

        let embeddingDim = 0;
        if (allTables.includes('embeddings')) {
            try {
                const stmt = db.prepare('SELECT embedding FROM embeddings LIMIT 1');
                if (stmt.step()) {
                    const val = stmt.get()[0];
                    if (val instanceof Uint8Array) {
                        embeddingDim = val.length / 4;
                    }
                }
                stmt.free();
            } catch { /* ignore */ }
        }

        const sizeBytes = fs.statSync(this.dbPath!).size;
        return {
            total_tables: allTables.length,
            total_rows: totalRows,
            total_columns: totalColumns,
            collections,
            segments,
            embeddings,
            metadata_rows: metadataRows,
            unique_documents: uniqueDocs,
            embedding_dimensions: embeddingDim,
            size_bytes: sizeBytes,
            size_mb: Math.round(sizeBytes / (1024 * 1024) * 100) / 100,
        };
    }

    // ---- Tables ----

    async getTables(): Promise<any> {
        const db = await this.openDb();
        const tables = queryAll(db,
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        );
        const result = tables.map(t => {
            let rowCount = 0;
            let colCount = 0;
            try {
                rowCount = queryScalar(db, `SELECT COUNT(*) FROM "${t.name}"`) || 0;
            } catch { /* skip count on error */ }
            try {
                colCount = pragmaAll(db, `PRAGMA table_info("${t.name}")`).length;
            } catch { /* skip */ }
            return { name: t.name, row_count: rowCount, col_count: colCount };
        });
        return { tables: result };
    }

    async getTableSchema(tableName: string): Promise<any> {
        validateIdentifier(tableName);
        const db = await this.openDb();
        const exists = queryOne(db,
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [tableName]
        );
        if (!exists) { throw new Error(`Table not found: ${tableName}`); }

        const columns = pragmaAll(db, `PRAGMA table_info("${tableName}")`).map(row => ({
            cid: row.cid,
            name: row.name,
            type: row.type || 'ANY',
            notnull: Boolean(row.notnull),
            default_value: row.dflt_value,
            pk: Boolean(row.pk),
        }));

        const indexes = pragmaAll(db, `PRAGMA index_list("${tableName}")`).map(row => ({
            name: row.name,
            unique: Boolean(row.unique),
        }));

        const rowCount = queryScalar(db, `SELECT COUNT(*) FROM "${tableName}"`);
        return { table: tableName, columns, indexes, row_count: rowCount };
    }

    async getTableRows(params: {
        tableName: string;
        page?: number;
        pageSize?: number;
        sortCol?: string | null;
        sortDir?: string;
        filters?: Record<string, string> | null;
    }): Promise<any> {
        const { tableName, page = 1, pageSize = 100, sortCol, sortDir = 'asc', filters } = params;
        validateIdentifier(tableName);
        const db = await this.openDb();
        const colInfo = pragmaAll(db, `PRAGMA table_info("${tableName}")`);
        const validColumns = new Set(colInfo.map(r => r.name as string));
        if (validColumns.size === 0) { throw new Error(`Table not found: ${tableName}`); }

        const whereParts: string[] = [];
        const whereParams: any[] = [];
        if (filters) {
            for (const [col, value] of Object.entries(filters)) {
                validateIdentifier(col);
                if (!validColumns.has(col)) { continue; }
                whereParts.push(`CAST("${col}" AS TEXT) LIKE ?`);
                whereParams.push(`%${value}%`);
            }
        }
        const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

        const totalRows = queryScalar(db,
            `SELECT COUNT(*) FROM "${tableName}" ${whereClause}`,
            whereParams
        );

        let orderClause = '';
        if (sortCol) {
            validateIdentifier(sortCol);
            if (validColumns.has(sortCol)) {
                const direction = sortDir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
                orderClause = `ORDER BY "${sortCol}" ${direction}`;
            }
        }

        const offset = (page - 1) * pageSize;
        const allParams = [...whereParams, pageSize, offset];
        let rows: Record<string, any>[];
        let columns: string[];
        try {
            rows = queryAll(db,
                `SELECT rowid AS __rowid__, * FROM "${tableName}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
                allParams
            );
            columns = rows.length > 0
                ? Object.keys(rows[0])
                : ['__rowid__', ...Array.from(validColumns)];
        } catch {
            rows = queryAll(db,
                `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
                allParams
            );
            columns = rows.length > 0
                ? Object.keys(rows[0])
                : Array.from(validColumns);
        }

        const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
        return {
            table: tableName,
            columns,
            rows,
            page,
            page_size: pageSize,
            total_rows: totalRows,
            total_pages: totalPages,
        };
    }

    // ---- Export ----

    async exportTable(params: {
        tableName: string;
        format: string;
        filters?: Record<string, string> | null;
    }): Promise<{ content: string; filename: string }> {
        const { tableName, format, filters } = params;
        validateIdentifier(tableName);
        const db = await this.openDb();
        const colInfo = pragmaAll(db, `PRAGMA table_info("${tableName}")`);
        const colNames = colInfo.map((r: any) => r.name as string);

        const whereParts: string[] = [];
        const whereParams: any[] = [];
        if (filters) {
            for (const [col, value] of Object.entries(filters)) {
                if (SAFE_IDENT_RE.test(col) && colNames.includes(col)) {
                    whereParts.push(`CAST("${col}" AS TEXT) LIKE ?`);
                    whereParams.push(`%${value}%`);
                }
            }
        }
        const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

        const rows = queryAll(db,
            `SELECT * FROM "${tableName}" ${whereClause}`,
            whereParams
        );

        if (format === 'json') {
            return {
                content: JSON.stringify({ columns: colNames, rows }, null, 2),
                filename: `${tableName}.json`,
            };
        }

        // CSV
        const escapeCsv = (val: any): string => {
            if (val === null || val === undefined) { return ''; }
            const s = String(val);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };
        const lines = [colNames.join(',')];
        for (const row of rows) {
            lines.push(colNames.map(c => escapeCsv(row[c])).join(','));
        }
        return { content: lines.join('\n'), filename: `${tableName}.csv` };
    }

    // ---- SQL query ----

    async executeQuery(sql: string): Promise<any> {
        if (!sql.trim()) { throw new Error('No SQL provided'); }
        const upper = sql.trim().toUpperCase();
        if (!(upper.startsWith('SELECT') || upper.startsWith('PRAGMA') ||
              upper.startsWith('EXPLAIN') || upper.startsWith('WITH'))) {
            throw new Error('Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed');
        }
        const db = await this.openDb();
        const rows = queryAll(db, sql);
        const sliced = rows.slice(0, 10000);
        const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
        return { columns, rows: sliced, row_count: sliced.length };
    }

    // ---- Collections (ChromaDB-aware) ----

    async getCollections(): Promise<any> {
        const db = await this.openDb();
        const allTables = new Set(
            queryAll(db, "SELECT name FROM sqlite_master WHERE type='table'")
                .map(r => r.name as string)
        );
        const needed = ['collections', 'segments', 'embeddings', 'embedding_metadata'];
        if (!needed.every(t => allTables.has(t))) {
            return { collections: [], supported: false };
        }

        const colInfo = pragmaAll(db, 'PRAGMA table_info("collections")');
        const colNames = new Set(colInfo.map(r => r.name as string));
        if (!colNames.has('id') || !colNames.has('name')) {
            return { collections: [], supported: false };
        }

        const hasDimension = colNames.has('dimension');
        const selectCols = hasDimension ? 'id, name, dimension' : 'id, name';

        let rows: Record<string, any>[];
        try {
            rows = queryAll(db, `SELECT ${selectCols} FROM collections ORDER BY name`);
        } catch {
            return { collections: [], supported: false };
        }

        const result = rows.map(row => {
            const cid = row.id;
            const cname = row.name;
            const cdim = hasDimension ? row.dimension : null;

            const meta: Record<string, any> = {};
            if (allTables.has('collection_metadata')) {
                try {
                    const metaRows = queryAll(db,
                        'SELECT key, str_value, int_value, float_value, bool_value FROM collection_metadata WHERE collection_id = ?',
                        [cid]
                    );
                    for (const m of metaRows) {
                        let val = m.str_value ?? m.int_value ?? m.float_value;
                        if (val === null && m.bool_value !== null) { val = Boolean(m.bool_value); }
                        meta[m.key as string] = val;
                    }
                } catch { /* ignore */ }
            }

            let docCount = 0;
            try {
                docCount = queryScalar(db,
                    'SELECT COUNT(*) FROM embeddings e JOIN segments s ON e.segment_id = s.id WHERE s.collection = ?',
                    [cid]
                ) || 0;
            } catch { /* ignore */ }

            return { id: cid, name: cname, dimension: cdim, metadata: meta, document_count: docCount };
        });

        return { collections: result, supported: true };
    }

    async getCollectionDocs(params: {
        collectionId: string;
        page?: number;
        pageSize?: number;
        search?: string | null;
    }): Promise<any> {
        const { collectionId, page = 1, pageSize = 50, search } = params;
        const db = await this.openDb();
        const collRow = queryOne(db, 'SELECT name FROM collections WHERE id = ?', [collectionId]);
        if (!collRow) { throw new Error('Collection not found'); }
        const collName = collRow.name;

        const segIds = queryAll(db,
            'SELECT id FROM segments WHERE collection = ?',
            [collectionId]
        ).map(r => r.id);

        if (segIds.length === 0) {
            return {
                collection_id: collectionId,
                collection_name: collName,
                columns: ['embedding_id', 'document'],
                metadata_keys: [],
                documents: [],
                page: 1,
                page_size: pageSize,
                total: 0,
                total_pages: 1,
            };
        }

        const metadataKeys = queryAll(db,
            'SELECT DISTINCT em.key FROM embedding_metadata em ' +
            'JOIN embeddings e ON em.id = e.id ' +
            'JOIN segments s ON e.segment_id = s.id ' +
            'WHERE s.collection = ? AND em.key != "chroma:document" ' +
            'ORDER BY em.key',
            [collectionId]
        ).map(r => r.key as string);

        let baseQuery =
            'SELECT e.id AS eid, e.embedding_id, ' +
            'doc.string_value AS document ' +
            'FROM embeddings e ' +
            'JOIN segments s ON e.segment_id = s.id ' +
            'LEFT JOIN embedding_metadata doc ON doc.id = e.id AND doc.key = "chroma:document" ' +
            'WHERE s.collection = ?';
        const queryParams: any[] = [collectionId];

        if (search) {
            baseQuery += ' AND doc.string_value LIKE ?';
            queryParams.push(`%${search}%`);
        }

        const total = queryScalar(db, `SELECT COUNT(*) FROM (${baseQuery})`, queryParams) || 0;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        const offset = (page - 1) * pageSize;
        const rows = queryAll(db, baseQuery + ' LIMIT ? OFFSET ?', [...queryParams, pageSize, offset]);

        const documents = rows.map(r => {
            const metaRows = queryAll(db,
                'SELECT key, string_value, int_value, float_value, bool_value ' +
                'FROM embedding_metadata WHERE id = ? AND key != "chroma:document"',
                [r.eid]
            );
            const meta: Record<string, any> = {};
            for (const m of metaRows) {
                let val = m.string_value ?? m.int_value ?? m.float_value;
                if (val === null && m.bool_value !== null) { val = Boolean(m.bool_value); }
                meta[m.key as string] = val;
            }
            return {
                embedding_id: r.embedding_id,
                document: r.document,
                metadata: meta,
            };
        });

        return {
            collection_id: collectionId,
            collection_name: collName,
            columns: ['embedding_id', 'document', ...metadataKeys],
            metadata_keys: metadataKeys,
            documents,
            page,
            page_size: pageSize,
            total,
            total_pages: totalPages,
        };
    }

    // ---- File browsing ----

    browse(dirPath?: string): any {
        let dir = (dirPath || '').trim().replace(/^["']|["']$/g, '');
        if (!dir) { dir = os.homedir(); }
        dir = path.resolve(dir);

        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
            throw new Error(`Directory not found: ${dir}`);
        }

        const entries: any[] = [];
        try {
            for (const name of fs.readdirSync(dir).sort()) {
                try {
                    const full = path.join(dir, name);
                    const stat = fs.statSync(full);
                    if (stat.isDirectory()) {
                        entries.push({ name, type: 'dir', path: full });
                    } else if (name.toLowerCase().endsWith('.sqlite3') || name.toLowerCase().endsWith('.db')) {
                        entries.push({
                            name,
                            type: 'file',
                            path: full,
                            size_mb: Math.round(stat.size / (1024 * 1024) * 100) / 100,
                        });
                    }
                } catch { /* skip inaccessible entries */ }
            }
        } catch {
            throw new Error(`Permission denied: ${dir}`);
        }

        const parent = path.dirname(dir);
        return {
            current: dir,
            parent: parent !== dir ? parent : null,
            entries,
        };
    }
}
