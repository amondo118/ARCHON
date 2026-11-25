# ARCHON import format (v1)

ARCHON imports and exports projects as a single JSON file. The format is designed to be **written by hand or generated** by a script or an AI assistant reading a codebase. Objects refer to each other by readable **keys** instead of database ids.

To import, **drop the `.json` file anywhere in the ARCHON window**, or use *Import JSON* (sidebar ⤒ button or Settings). Imports always create a **new project**, so nothing existing is ever overwritten. If anything is invalid, nothing is imported and every problem is listed with its location in the file (e.g. `relationships[3].target — unknown object "Villagr"`).

A complete example: [`examples/medieval-empire.archon.json`](../examples/medieval-empire.archon.json).

## Minimal file

```json
{
  "project": { "name": "My Game" },
  "objects": [
    { "type": "class", "name": "Player", "children": [
      { "type": "method", "name": "jump()" }
    ]}
  ]
}
```

## Top-level structure

| Field | Required | Description |
|---|---|---|
| `format` | no | `"archon"` (written by export) |
| `format_version` | no | `1`. Other versions are rejected. |
| `project` | **yes** | `{ "name": "...", "description": "..." }` |
| `modules` | no | Logical groups (systems), can be nested |
| `objects` | no | Architecture objects. Members are nested in `children`. |
| `relationships` | no | Typed, directed connections between objects |
| `tasks` | no | Kanban tasks |
| `notes` | no | Documentation and decision records (Markdown) |
| `canvas.positions` | no | Saved canvas layout. Omit it and ARCHON places objects automatically. |

## Keys and references

- **Module key** = `key` if given, else its `name`.
- **Object key** = `key` if given, else:
  - top-level object: its `name` → `Villager`
  - child: `<parent key>.<name>` → `Villager.gather_resource()`
- Keys must be unique. If two objects would get the same key (e.g. two classes both named `Utils` in different modules), give one an explicit `"key"`.
- References (`module`, `parent`, `source`, `target`, `object`) use these keys.
- **Lenient call syntax:** a reference without `()` also matches a key that ends with `()`, so `"Villager.gather_resource"` finds `Villager.gather_resource()`.

## modules[]

```json
{ "key": "economy", "name": "Economy", "color": "#E8AD53", "parent": "world", "description": "" }
```

## objects[]

```jsonc
{
  "key": "Villager",                 // optional
  "type": "class",                   // required
  "name": "Villager",                // required
  "module": "units",                 // module key; top-level objects only (children use their parent's module)
  "description": "Worker unit.",
  "health_status": "good",           // unreviewed | good | warning | bad   (default unreviewed)
  "implementation_status": "complete", // planned | in_progress | complete | broken (default planned)
  "visibility": "public",            // none | public | private | protected | internal (default none)
  "file_path": "scripts/units/villager.gd",
  "metadata": { "extends": "CharacterBody2D" },  // any JSON object
  "children": [ /* more objects */ ]
}
```

**Types**

| Kind | Types | Rules |
|---|---|---|
| Containers | `class` `interface` `script` `component` `manager` `struct` `enum` `resource` | Top level or nested in a container. Can have children. |
| Members | `method` `property` `signal` `event` | **Must** be the child of a container |
| Free | `function` `other` | Top level or inside a container. No children. |

## relationships[]

```json
{ "source": "Villager.resource_delivered", "target": "VillagerManager.on_resource_delivered()",
  "type": "signal", "description": "Connected in _ready()" }
```

| Type | Meaning | Extra rules |
|---|---|---|
| `calls` | source calls target | |
| `signal` | signal/event connection (not necessarily a direct call) | |
| `inherits` | source inherits from target | Class-like objects only. One parent per object, no cycles. Interfaces inherit only interfaces. |
| `implements` | source implements interface target | target must be an `interface` |
| `depends_on` | source depends on target | |
| `references` | source references target | |
| `uses` | source uses target | |

Containment is **not** a relationship: use `children`. The same (source, target, type) may appear only once, and an object can't relate to itself.

## tasks[]

```json
{ "title": "Fix walk animation", "description": "", "status": "todo", "priority": "high",
  "due_date": "2026-12-31", "object": "Villager.update_animation()", "module": "units" }
```
`status`: `backlog | todo | in_progress | review | done` · `priority`: `low | medium | high | critical`

## notes[]

```json
{ "title": "Why signals", "type": "decision", "content": "## Decision\n...", "object": "Villager" }
```
`type`: `general | decision | technical | problem` · `content` is Markdown.

## canvas.positions[]

```json
{ "object": "Villager", "x": 0, "y": 260, "collapsed": false }
```
Positions for **top-level** objects place their cards. A position on a **child** shows it as its own node on the canvas ("promoted"). Omit positions entirely and ARCHON packs the cards automatically. *Auto layout* in the toolbar can then arrange them by their connections.

---

## Generating a file from a codebase

Give an AI assistant (e.g. Claude Code, opened in the repository) this file plus a prompt like:

> Read `docs/IMPORT_FORMAT.md` from ARCHON (pasted below). Then scan this repository and write
> `architecture.archon.json` describing it:
> - one module per top-level folder / system;
> - one object per class or script (`type` from the table), with its public methods, properties and
>   signals as `children` (names with `()` for methods), `file_path` relative to the repo root, and a
>   one-sentence `description`;
> - relationships for inheritance (`inherits`), interface implementation (`implements`), signal
>   connections (`signal`), and the important cross-class calls (`calls`) / dependencies (`depends_on`).
>   Skip trivial calls;
> - leave `health_status` as `unreviewed` and omit `canvas`;
> - make every key unique and every reference resolve. Validate the JSON before finishing.

Then drop the resulting file onto ARCHON. If the import reports errors, paste them back to the assistant. Each error includes the JSON path, so fixes are quick.

Re-importing creates a new project rather than updating the old one, so a regenerated file is a fresh snapshot. Merging into an existing project is not supported in v0.1.
