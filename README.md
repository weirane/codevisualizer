# Code Visualizer

Developer-in-the-loop web application for quickly understanding a repo's structure, design signals, and quality hotspots without leaving the terminal-driven workflow.

## Features

- Accepts an absolute path to a project root and performs a bounded filesystem crawl (default 2k entries) with safe ignores.
- Generates a JSON report summarising directory/file counts, language breakdown, largest and longest files, and detected filesystem warnings.
- Computes code-level signals (line counts, crude complexity density, TODO markers) for small-to-medium files and flags hotspots.
- Inspects JavaScript/TypeScript, Python, and Go files for import statements to surface high fan-in/fan-out modules and unresolved relative imports.
- Interactive UI (vanilla JS + HTML/CSS) with:
  - Snapshot cards for key metrics.
  - Language mix table and quick lists of large/long files.
  - Collapsible file-tree that highlights files with warnings/errors.
  - Issues panel sorted by severity, capped for readability.
  - Dependency insights cards with top modules by fan-in/fan-out and unresolved import list.
  - A "Generate Summary" button that surfaces a narrative of architectural facts, hotspots, and recommended next steps.
  - Mind-map style architecture explorer served on `/diagram.html`, with horizontally scrollable columns, drill-down expansion, and in-place source + clone previews once you load a repository.

## Getting Started

1. Ensure Node.js 14+ is available (no external npm dependencies required).
2. From the project directory run:

   ```bash
   npm run dev
   ```

3. Open your browser to `http://localhost:3000`.
4. Provide an absolute path to the repository you want to inspect (must be accessible on this machine).

> The analysis runs entirely locally and never leaves your machine. Traversal is capped to keep initial exploration fast; results note when the limit is reached.

## Implementation Notes

- The server is implemented with Node's built-in `http` module to avoid external dependencies.
- Files larger than 512 KB are skipped for content-based metrics to preserve responsiveness; a note is surfaced in the issues list.
- Dependency analysis currently supports JavaScript/TypeScript, Python, and Go through simple regex extraction.
- Directories are annotated with descendant file counts and warning totals so you can quickly spot noisy areas.

## Next Steps (for future collaboration)

- Extend analyzers to understand additional languages and richer architecture constructs (e.g., service boundaries, package layering).
- Persist analysis snapshots and diff runs to understand architectural drift over time.
- Integrate with an agent workflow so flagged issues can be handed off for automated remediation.
- Add filtering/search across issues, tree, and dependency modules for large repos.
