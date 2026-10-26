# Non-Euclidean Game Mapper — Product Specification

## 1. Overview
A lightweight, fast, and visually intuitive mapping tool for games with non-Euclidean / portal-based room topology (where rooms feel locally Euclidean, e.g., having North/South/East/West exits or arbitrary doors, but connections can warp, loop, or be one-way).

## 2. Recommended Tech Stack & Architecture
- **Platform:** Single-Page Web App (HTML/CSS/TypeScript + Vite, or zero-build portable HTML/JS bundle) that can be:
  1. Hosted directly on **GitHub Pages** for instant access anywhere (`https://guolinm.github.io/non-euclidean-mapper/`).
  2. Built as a **single self-contained `.html` file** (`dist/non-euclidean-mapper.html`) that runs offline on any Windows device by double-clicking it.
- **Branding & Assets:** Custom parchment map scroll icon used as the browser favicon (`favicon.png`) and inlined as base64 in the standalone bundle.
- **Save Format:** **JSON** (with optional **YAML** export/import) containing both the logical graph (`rooms`, `connections`) and `mapDisplayConfig` (pinned node coordinates, zoom/pan state, color themes, layout settings).

---

## 3. Core Data Model

### Room (Node)
- `id`: Unique identifier (UUID / slug)
- `name`: Display name of the room
- `description`: Freeform notes / markdown description (puzzles, items, lore)
- `tags`: Array of string tags (e.g., `["locked", "save-point", "hub", "blue-key"]`)
- `color` / `icon` (optional): Visual indicator on the map

### Connection (Edge)
- `id`: Unique identifier
- `fromRoomId`: Source room ID
- `toRoomId`: Target room ID
- `bidirectional`: Boolean (defaults to `true`; if `false`, rendered with a clear directional arrow / one-way indicator)
- `label`: Primary exit label from source room (e.g., `"North"`, `"Red Door"`, `"Stairs Up"`) + optional `reverseLabel` for return direction on two-way connections (e.g., `"South"`, `"Stairs Down"`)
- `style`: `"normal"` (solid line) or `"warp"` / `"teleport"` (dashed curved arc to visually highlight non-Euclidean warps)

### Map Display Configuration (`mapDisplayConfig`)
- `positions`: Map of `roomId -> { x, y }` stored persistently so existing rooms remain locked where placed/spawned.
- `viewport`: `{ panX, panY, zoom }`
- `snapToGrid`: Optional toggle for grid alignment
- `tagColors`: Custom color mapping for tags

---

## 4. Confirmed Design Decisions
1. **Connection Labels & Translucent Warp Layering:** Freeform graph with optional exit labels (e.g., `'North'`, `'Red Door'`, `'Stairs Up'`) and quick directional presets, plus a toggle for two-way (default) vs. one-way and normal vs. `Warp` styling. On normal connections, pure cardinal (`N/S/E/W`) and ordinal (`NE/NW/SE/SW`) labels are omitted on the map canvas (since relative room position already communicates them), whereas `Up`/`Down`, warp labels, and custom door labels are displayed on the map. Warp connections are always rendered on the lowest layer (below all normal connections and rooms):
   - **Long-Distance Split Warps (> 2 rooms away):** Render only the two tail sections on both rooms (`from` tail and `to` tail) with labels anchored directly on their respective tail sections (`opacity: 0.34`, rising to `0.76` when attached to a selected room).
   - **Short-Range / Fully Rendered Warps (≤ 2 rooms away or self-loops):** Render the full warp arc at higher opacity (`opacity: 0.64`, rising to `0.9` when attached to a selected room) so local warps stand out clearly.
2. **Placement, Layout Stability & Cardinal Auto-Arrange Priority:** Rooms stay pinned exactly where placed or spawned. When a new room is created or moved onto an existing room's space, only the colliding room is gently nudged to the nearest free spot. The explicit **Rearrange (`Auto-Arrange`)** action (with Undo support):
   - Strictly prioritizes cardinal (`N/S/E/W`), ordinal (`NE/NW/SE/SW`), and elevation (`Up/Down` where `Up` = `North` and `Down` = `South`) directions inferred from either `label` or `reverseLabel`. Cardinal connections lock their orthogonal axis, while ordinal connections (`NE/NW/SE/SW`, offered as quick preset chips) place rooms at taxicab grid distance (`1` E/W step + `1` N/S step) and lock to the diagonal grid ray so they can lengthen (`1x`, `2x`, `3x` grid steps) as needed to accommodate rooms in between. When a room has both a `North` and an `Up` exit (or `South` and `Down`), explicit `North`/`South` takes stronger X-column alignment priority while `Up`/`Down` uses a softer X-lock so both remain strictly above/below without colliding.
   - Leaves **Warp / Teleport** connections unconstrained by distance so warps can span arbitrarily far across the map without distorting the local cardinal grid.
   - Pulls unlabeled normal connections to a comfortable distance along their existing angle without forcing them East.
3. **Deployment Format:** Zero-dependency static web app (`index.html`, `styles.css`, `app.js`) that works both by double-clicking `index.html` (or the bundled `dist/non-euclidean-mapper.html`) locally on Windows and by pushing to **GitHub Pages** (`https://guolinm.github.io/non-euclidean-mapper/`).

---

## 5. Prioritized UI & Features

### Priority 1: Interactive Draggable Map Canvas
- Infinite pan & zoom canvas (mouse drag to pan, scroll wheel to zoom).
- **Stable Layout:** Every room has persistent `(x, y)` coordinates saved in `mapDisplayConfig`. Adding new rooms or connections **never** resets existing room positions.
- **Multi-Select Group Move (`M` or `Shift+Click`):** Toggleable **Multi-Select** button in the top toolbar (plus `Shift+Click` on rooms or marquee drag-box selection) to select multiple rooms and drag them and their connections all at once as a group, while keeping room editing disabled in the Inspector.
- **Smart Collision / Placement:** New rooms spawn near the currently selected/connected room at an open spot; if two rooms overlap, gently nudge the unpinned/new room or offer an optional local relax/rearrange button without scrambling the whole map.
- Visual distinction between **two-way connections** (solid line) and **one-way connections** (directed arrow / dashed line), plus self-loops or long-distance warps.

### Priority 2: Room Creation & Editing Menu
- Quick-add button / keyboard shortcut (`N` or double-click canvas) to create a room with:
  - **Name**
  - **Description / Notes**
  - **Tags** (autocomplete/click from existing tags + create new, with live prefix highlighting on the existing tag chip list based on the currently typed tag after the last comma)
  - **Color Accent** (preset swatches + dynamic swatches of any custom hex colors currently used by rooms in the map + special non-hex **Rainbow** gradient color option + hex code input `#RRGGBB` / `rainbow` and native color wheel picker)
- Clicking/tapping any room on the map opens an **Inspector / Edit Side Panel** to view and edit its name, description, tags, color accent (including Rainbow and hex code input), and list of connections, or quickly add an adjacent connected room.

### Priority 3: Connection Creation Menu (List Search + Nested Visual Map Picker)
- Connect two rooms via:
  1. **Searchable Room List:** Type-ahead dropdown filtering rooms by name or tag.
  2. **Nested Mini-Map / Visual Picker Modal:** Open a secondary interactive map view (or split/overlay picker mode) where you can pan/zoom and click the target room visually.
- Toggle **Two-Way (default)** vs. **One-Way** (`A ↔ B` vs. `A → B`), plus optional exit label (e.g., `N/S/E/W` or door description).

### Priority 4: Search & Filter by Tag or Name
- Persistent search bar (`Ctrl+F` / `/`) that filters rooms by **name**, **description**, or **tags**.
- Clicking a search result centers and highlights the room on the map.
- Option to highlight/dim rooms on the canvas matching selected tag filters.

### Priority 5: Autosave, Backups & File Portability
- **Unified Save Schema (`SAVE_SCHEMA`):** Single canonical field-descriptor schema and intermediate state representation driving JSON export/import, YAML export/import, and Compact Share Link encoding/decoding so adding any future field updates all three formats automatically.
- **Shareable Map Links (`?save=...`):** Compresses the canonical state into a dictionary-interned, room-indexed compact tuple format compressed with `deflate-raw` + Base64url (`?save=z....`). Opening a `?save=...` URL automatically backs up the user's existing local map into Backups first before loading the shared map.
- **Instant Autosave:** Every change automatically saves to `localStorage` (`non_euclidean_mapper_current_v1`).
- **Rolling Backups / Snapshots:** Keeps a history of recent automatic snapshots (`non_euclidean_mapper_backups_v1`, up to 25 autosave states + manual checkpoints) so you can preview and restore an earlier version anytime.
- **File Export / Import:** Save and load `.json` / `.yaml` files directly to disk.
