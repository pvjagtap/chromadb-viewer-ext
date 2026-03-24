# ChromaDB Viewer

Browse and inspect [ChromaDB](https://www.trychroma.com/) vector store databases directly in VS Code. View collections, documents, metadata, embeddings, and run SQL queries — all without leaving the editor.

## Demo

[▶ Watch Demo Video](media/chromadb-viewer-1.5.0.mp4)

## Features

- **Collection Browser** — Lists all ChromaDB collections with document counts, dimensions, and metadata
- **Document Viewer** — Paginated view of documents with all metadata fields, search, and filtering
- **Table Inspector** — Browse raw SQLite tables, view schemas, sort, and filter columns
- **SQL Query Editor** — Execute read-only SQL queries with instant results
- **Data Export** — Export any table or query result to CSV or JSON
- **Right-Click Open** — Right-click any `.sqlite3` or `.db` file in the Explorer to open it
- **Open With Support** — Appears in VS Code's "Open With" editor picker for database files
- **Dark Theme UI** — Matches VS Code's native look and feel

## Getting Started

### Install from VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/pvjagtap/chromadb-viewer-ext/releases)
2. In VS Code: **Extensions** → `⋯` → **Install from VSIX…**
3. Select the downloaded file

### Open a Database

There are several ways to open a ChromaDB database:

- **Right-click** a `.sqlite3` or `.db` file in the Explorer → **Open with ChromaDB Viewer**
- **Command Palette** (`Ctrl+Shift+P`) → `ChromaDB Viewer: Open Database File`
- **Open With** → Right-click a `.sqlite3` file → **Open With…** → **ChromaDB Viewer**
- **Command Palette** → `ChromaDB Viewer: Open Viewer` → use the built-in file browser

## Usage

### Collections

The left sidebar shows all ChromaDB collections. Click a collection to browse its documents. Each document displays:

- Embedding ID
- Document text (truncated in table, full on click)
- All metadata fields (sentence count, chunk index, word count, token count, document type, etc.)

Use the search bar to filter documents by content.

### Tables

Switch to the **Tables** section in the sidebar to browse raw SQLite tables. Click a table to see its rows with:

- Sortable columns (click headers)
- Column filters (type in filter row)
- Pagination controls
- Row count display

### SQL Editor

The SQL editor at the bottom accepts read-only queries:

```sql
SELECT * FROM collections;
SELECT COUNT(*) FROM embeddings;
PRAGMA table_info('embedding_metadata');
```

Only `SELECT`, `PRAGMA`, `EXPLAIN`, and `WITH` statements are allowed.

### Export

Click the export button on any table view to save data as CSV or JSON.

## Requirements

- VS Code 1.85 or later
- A ChromaDB SQLite database file (`.sqlite3`)

No external dependencies required — the extension uses [sql.js](https://github.com/sql-js/sql.js/) (WebAssembly SQLite) and runs entirely inside VS Code.

## Extension Commands

| Command | Description |
|---------|-------------|
| `ChromaDB Viewer: Open Viewer` | Opens the viewer panel |
| `ChromaDB Viewer: Open Database File` | Opens a file picker, then the viewer |
| `Open with ChromaDB Viewer` | Context menu on `.sqlite3`/`.db` files |

## Building from Source

```bash
git clone https://github.com/pvjagtap/chromadb-viewer-ext.git
cd chromadb-viewer-ext
npm install
npm run compile
```

To package as a `.vsix`:

```bash
npx @vscode/vsce package
```

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes using [conventional commits](https://www.conventionalcommits.org/)
4. Push and open a pull request

## License

[MIT](LICENSE)
