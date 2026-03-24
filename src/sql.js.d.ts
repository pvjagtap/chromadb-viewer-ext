declare module 'sql.js' {
    interface SqlJsStatic {
        Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
    }

    interface Database {
        run(sql: string, params?: any[]): Database;
        exec(sql: string, params?: any[]): QueryExecResult[];
        prepare(sql: string): Statement;
        close(): void;
    }

    interface Statement {
        bind(params?: any[]): boolean;
        step(): boolean;
        get(params?: any[]): any[];
        getColumnNames(): string[];
        free(): boolean;
        reset(): void;
    }

    interface QueryExecResult {
        columns: string[];
        values: any[][];
    }

    export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
    export { Database, Statement, SqlJsStatic, QueryExecResult };
}
