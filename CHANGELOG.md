# Changelog

All notable changes to the ChromaDB Viewer extension are documented here.

## [1.5.0] - 2026-03-24

### Added
- Custom editor provider — extension now appears in VS Code's "Open With" picker
- Right-click context menu for `.sqlite3` and `.db` files in Explorer
- Extension icon and marketplace metadata
- README with usage documentation

### Changed
- Cached database connections to avoid reloading large files on every query
- Rewrote sql.js query helpers for improved reliability with large databases
- Per-table error handling so one failing table doesn't break the entire list

## [1.0.0] - 2026-03-24

### Added
- Initial release
- Collection browser with document counts and metadata
- Document viewer with pagination and search
- Table inspector with sort, filter, and schema view
- SQL query editor (read-only: SELECT, PRAGMA, EXPLAIN, WITH)
- CSV and JSON export
- Recent databases stored in VS Code global state
- Dark theme UI matching VS Code aesthetics
