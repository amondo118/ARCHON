# ARCHON: implementation status

Plan: the 6-milestone plan from [docs/SPEC_REVIEW.md](docs/SPEC_REVIEW.md) §6.

| Milestone | Status |
|---|---|
| M0 Foundation: Express, SQLite, migrations, health, shell, Docker | ✅ done, verified locally and in Docker |
| M1 Data layer + API with all validation rules | ✅ done, 15 tests |
| M2 Canvas: hybrid cards, drag + save, connect, promote, collapse, auto layout | ✅ done, browser-tested |
| M3 Inspector: editing, members, relationships, inheritance, delete impact | ✅ done |
| M4 Tasks (Kanban) + Notes (Markdown) + Overview dashboard | ✅ done |
| M5 Export / drop-in import / backup / Docker / docs | ✅ done |

## Verified
- `npm test`: services, rules, cascades, import validation, rollback, and the export → import round trip
- Browser (Playwright): import sample, select, edit health, drag a card, connect mode, promote a member, Kanban drag, notes Markdown. All persist across reload, with no console errors.
- Docker: image builds, container is healthy, runs as uid 1000 with a read-only root filesystem, data persists across restart, backup snapshot passes `integrity_check`.

## Known limitations (v0.1)
- No authentication. Run it on a private network or behind proxy auth.
- One canvas per project. Positions are per project, not per module view.
- Member rows on cards are centered text (a Cytoscape label limitation).
- Import always creates a new project. There is no merge or update of an existing project.
- No undo/redo. Destructive actions use confirmation dialogs instead.
- Desktop only.

## Deferred (post v0.1)
- Undo/redo (command history)
- Structured canvas mode, multiple saved layouts, grouping, grid snapping
- Dedicated dependency-graph view (the inspector covers incoming/outgoing/inheritance)
- Merge-import (update an existing project from a regenerated file)
- Authentication
