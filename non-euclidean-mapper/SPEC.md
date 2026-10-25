# Non-Euclidean Game Mapper — Product Specification

## 1. Overview
A lightweight, fast, and visually intuitive mapping tool for games with non-Euclidean / portal-based room topology (where rooms feel locally Euclidean, e.g., having North/South/East/West exits or arbitrary doors, but connections can warp, loop, or be one-way).

## 2. Recommended Tech Stack & Architecture
- **Platform:** Single-Page Web App (HTML/CSS/TypeScript + Vite, or zero-build portable HTML/JS bundle) that can be:
  1. Hosted directly on **GitHub Pages** for instant access anywhere (`https://guolinm.github.io/non-euclidean-mapper/`).
  2. Built as a **single self-contained `.html` file** (`dist/non-euclidean-mapper.html`) that runs offline on any Windows device by double-clicking it.
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
1. **Connection Labels:** Freeform graph with optional exit labels (e.g., `'North'`, `'Red Door'`, `'Stairs Up'`) and quick directional presets, plus a toggle for two-way (default) vs. one-way and normal vs. warp/teleport styling.
2. **Placement & Layout Stability:** Rooms stay pinned exactly where placed or spawned. When a new room is created or moved onto an existing room's space, only the colliding room is gently nudged to the nearest free spot. Includes an explicit **Auto-Arrange** action (with Undo support) if the user wants to tidy the graph.
3. **Deployment Format:** Zero-dependency static web app (`index.html`, `styles.css`, `app.js`) that works both by double-clicking `index.html` (or the bundled `dist/non-euclidean-mapper.html`) locally on Windows and by pushing to **GitHub Pages** (`https://guolinm.github.io/non-euclidean-mapper/`).

---

## 5. Prioritized UI & Features

### Priority 1: Interactive Draggable Map Canvas
- Infinite pan & zoom canvas (mouse drag to pan, scroll wheel to zoom).
- **Stable Layout:** Every room has persistent `(x, y)` coordinates saved in `mapDisplayConfig`. Adding new rooms or connections **never** resets existing room positions.
- **Smart Collision / Placement:** New rooms spawn near the currently selected/connected room at an open spot; if two rooms overlap, gently nudge the unpinned/new room or offer an optional local relax/rearrange button without scrambling the whole map.
- Visual distinction between **two-way connections** (solid line) and **one-way connections** (directed arrow / dashed line), plus self-loops or long-distance warps.

### Priority 2: Room Creation & Editing Menu
- Quick-add button / keyboard shortcut (`N` or double-click canvas) to create a room with:
  - **Name**
  - **Description / Notes**
  - **Tags** (autocomplete from existing tags + create new)
- Clicking/tapping any room on the map opens an **Inspector / Edit Side Panel** to view and edit its name, description, tags, and list of connections, or quickly add an adjacent connected room.

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
- **Instant Autosave:** Every change automatically saves to `localStorage` / `IndexedDB`.
- **Rolling Backups / Snapshots:** Keeps a history of recent automatic snapshots (e.g., last 20 autosave states + timestamped checkpoints) so you can preview and restore an earlier version anytime.
- **File Export / Import:** Save and load `.json` / `.yaml` files directly to disk (plus optional File System Access API "Save to disk file automatically" support on Chrome/Edge).
