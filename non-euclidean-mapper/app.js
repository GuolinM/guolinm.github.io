/**
 * Non-Euclidean Game Mapper
 * Standalone zero-dependency web application (works locally via file:// and on GitHub Pages)
 */

(function () {
  "use strict";

  // ==================== CONSTANTS ====================
  const STORAGE_KEY_CURRENT = "non_euclidean_mapper_current_v1";
  const STORAGE_KEY_BACKUPS = "non_euclidean_mapper_backups_v1";
  const MAX_AUTO_BACKUPS = 25;

  const NODE_W = 168;
  const NODE_H = 74;
  const COLLISION_W = NODE_W + 22;
  const COLLISION_H = NODE_H + 20;

  const ROOM_COLORS = [
    "#0ea5e9", // Sky
    "#8b5cf6", // Violet
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ef4444", // Red
    "#ec4899", // Pink
    "#14b8a6", // Teal
    "#64748b", // Slate
  ];
  const RAINBOW_COLOR = "rainbow";

  function normalizeHexColor(val) {
    if (!val || typeof val !== "string") return null;
    let clean = val.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
      clean = clean
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return "#" + clean.toLowerCase();
    }
    return null;
  }

  function normalizeRoomColor(val) {
    if (!val || typeof val !== "string") return null;
    const trimmed = val.trim().toLowerCase();
    if (trimmed === RAINBOW_COLOR) {
      return RAINBOW_COLOR;
    }
    return normalizeHexColor(val);
  }

  function renderRoomColorDot(color) {
    if (color === RAINBOW_COLOR) {
      return `<span class="room-color-dot rainbow" title="Rainbow"></span>`;
    }
    return `<span class="room-color-dot" style="background: ${color || ROOM_COLORS[0]}"></span>`;
  }

  function getAvailableRoomColors(extraColor = null) {
    const seen = new Set();
    const list = [];
    const addColor = (c) => {
      const norm = normalizeRoomColor(c);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        list.push(norm);
      }
    };
    ROOM_COLORS.forEach(addColor);
    addColor(RAINBOW_COLOR);
    if (appState && Array.isArray(appState.rooms)) {
      for (const r of appState.rooms) {
        if (r && r.color) addColor(r.color);
      }
    }
    if (extraColor) addColor(extraColor);
    return list;
  }

  // ==================== APPLICATION STATE ====================
  let appState = createEmptyMapState();
  let undoStack = [];
  let selectedRoomId = null;
  let selectedConnectionId = null;
  let isMultiSelectMode = false;
  let multiSelectedRoomIds = new Set();

  // Search & Filter state (Priority 4)
  let searchQuery = "";
  let activeTagFilters = new Set();
  let navigatedFromConnectionId = null;

  // New Room Modal state
  let newRoomColor = ROOM_COLORS[0];
  let branchSourceRoomId = null;
  let pendingSpawnCoords = null;

  // Connection Modal & Nested Map state (Priority 3)
  let connModalState = {
    activeSlot: "from", // "from" | "to"
    fromRoomId: null,
    toRoomId: null,
    bidirectional: true,
    style: "normal", // "normal" | "warp"
    pickerMode: "map", // "map" | "list"
    searchFilter: "",
    nestedViewport: { panX: 220, panY: 150, zoom: 0.75 },
  };

  // Backup tracking
  let lastAutoBackupTime = 0;

  // Mobile layout & sheet state
  let isMobileSheetPeek = false;
  const mobileMediaQuery = window.matchMedia ? window.matchMedia("(max-width: 768px)") : null;

  function isMobileLayout() {
    return Boolean(mobileMediaQuery ? mobileMediaQuery.matches : window.innerWidth <= 768);
  }

  function openMobileSearchDialog() {
    const leftSidebar = document.getElementById("left-sidebar");
    const backdrop = document.getElementById("mobile-left-backdrop");
    if (leftSidebar) leftSidebar.classList.add("mobile-dialog-open");
    if (backdrop) backdrop.classList.remove("hidden");
    setTimeout(() => {
      const sInput = document.getElementById("search-input");
      if (sInput) sInput.focus();
    }, 40);
  }

  function closeMobileSearchDialog() {
    const leftSidebar = document.getElementById("left-sidebar");
    const backdrop = document.getElementById("mobile-left-backdrop");
    if (leftSidebar) leftSidebar.classList.remove("mobile-dialog-open");
    if (backdrop) backdrop.classList.add("hidden");
  }

  // ==================== INITIALIZATION ====================
  function createEmptyMapState(title = "Untitled Map") {
    return {
      version: 1,
      title,
      updatedAt: new Date().toISOString(),
      rooms: [],
      connections: [],
      mapDisplayConfig: {
        positions: {}, // roomId -> { x, y }
        viewport: { panX: 480, panY: 320, zoom: 1 },
      },
    };
  }

  function createDemoMapState() {
    const rooms = [
      {
        id: "r_foyer",
        name: "Grand Foyer",
        description: "Starting room with a grandfather clock chiming backwards. Four ornate doors.",
        tags: ["hub", "save-point"],
        color: "#0ea5e9",
      },
      {
        id: "r_hall_mirrors",
        name: "Hall of Mirrors",
        description: "Walking North through the mirror loops back into this same room unless holding the Lantern.",
        tags: ["puzzle", "loop"],
        color: "#8b5cf6",
      },
      {
        id: "r_library",
        name: "Sunken Library",
        description: "Two-story library. Going East from here unexpectedly warps straight back to the Grand Foyer!",
        tags: ["lore", "warp-zone"],
        color: "#10b981",
      },
      {
        id: "r_clocktower",
        name: "Clocktower Base",
        description: "Contains the Brass Key on a pedestal. Chute in the floor drops one-way into the Cellar.",
        tags: ["key-item", "trap"],
        color: "#f59e0b",
      },
      {
        id: "r_cellar",
        name: "Flooded Cellar",
        description: "Reached via one-way drop from Clocktower Base. Red Portal in the corner warps up to the Observatory.",
        tags: ["dark", "warp-zone"],
        color: "#ef4444",
      },
      {
        id: "r_observatory",
        name: "Starlight Observatory",
        description: "High above the manor, yet walking South goes directly into the Sunken Library.",
        tags: ["hub", "puzzle"],
        color: "#ec4899",
      },
    ];

    const connections = [
      {
        id: "c_1",
        fromRoomId: "r_foyer",
        toRoomId: "r_hall_mirrors",
        bidirectional: true,
        style: "normal",
        label: "North",
        reverseLabel: "South",
        notes: "Standard double doors",
      },
      {
        id: "c_2",
        fromRoomId: "r_hall_mirrors",
        toRoomId: "r_hall_mirrors",
        bidirectional: false,
        style: "warp",
        label: "North (No Lantern)",
        reverseLabel: "",
        notes: "Infinite self-loop until you carry the Lantern",
      },
      {
        id: "c_3",
        fromRoomId: "r_foyer",
        toRoomId: "r_library",
        bidirectional: true,
        style: "normal",
        label: "West",
        reverseLabel: "East",
        notes: "",
      },
      {
        id: "c_4",
        fromRoomId: "r_library",
        toRoomId: "r_foyer",
        bidirectional: false,
        style: "warp",
        label: "West Archive Door",
        reverseLabel: "",
        notes: "Going further West warps you back to the Foyer!",
      },
      {
        id: "c_5",
        fromRoomId: "r_foyer",
        toRoomId: "r_clocktower",
        bidirectional: true,
        style: "normal",
        label: "East",
        reverseLabel: "West",
        notes: "",
      },
      {
        id: "c_6",
        fromRoomId: "r_clocktower",
        toRoomId: "r_cellar",
        bidirectional: false,
        style: "normal",
        label: "Floor Chute (Drop)",
        reverseLabel: "",
        notes: "One-way trapdoor drop!",
      },
      {
        id: "c_7",
        fromRoomId: "r_cellar",
        toRoomId: "r_observatory",
        bidirectional: true,
        style: "warp",
        label: "Red Portal",
        reverseLabel: "Red Portal",
        notes: "Non-Euclidean portal linking lowest cellar to highest tower",
      },
      {
        id: "c_8",
        fromRoomId: "r_observatory",
        toRoomId: "r_library",
        bidirectional: false,
        style: "warp",
        label: "South Stairwell",
        reverseLabel: "",
        notes: "Impossible geometry: stairs down lead into Sunken Library balcony",
      },
    ];

    return {
      version: 1,
      title: "The Impossible Manor (Demo)",
      updatedAt: new Date().toISOString(),
      rooms,
      connections,
      mapDisplayConfig: {
        positions: {
          r_foyer: { x: 0, y: 0 },
          r_hall_mirrors: { x: 0, y: -175 },
          r_library: { x: -270, y: 0 },
          r_clocktower: { x: 270, y: 0 },
          r_cellar: { x: 270, y: 175 },
          r_observatory: { x: -270, y: 175 },
        },
        viewport: { panX: 480, panY: 310, zoom: 0.95 },
      },
    };
  }

  // ==================== UNDO & AUTOSAVE / BACKUPS (Priority 5) ====================
  function pushUndoSnapshot() {
    const clone = JSON.parse(JSON.stringify(appState));
    undoStack.push(clone);
    if (undoStack.length > 40) undoStack.shift();
    updateUndoButton();
  }

  function performUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack.pop();
    appState = prev;
    if (selectedRoomId && !getRoomById(selectedRoomId)) selectedRoomId = null;
    if (selectedConnectionId && !getConnectionById(selectedConnectionId)) selectedConnectionId = null;
    updateUndoButton();
    saveStateToLocal(false);
    renderAll();
    showToast("Undid last action");
  }

  function updateUndoButton() {
    const btn = document.getElementById("btn-undo");
    if (btn) btn.disabled = undoStack.length === 0;
  }

  function saveStateToLocal(allowRollingBackup = true) {
    appState.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(appState));
      const indicator = document.getElementById("autosave-text");
      if (indicator) {
        const now = new Date();
        indicator.textContent = `Saved ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }

      // Create a rolling backup every 45 seconds of active editing if rooms exist
      const nowMs = Date.now();
      if (allowRollingBackup && appState.rooms.length > 0 && nowMs - lastAutoBackupTime > 45000) {
        createBackupSnapshot("Auto-backup", true);
        lastAutoBackupTime = nowMs;
      }
    } catch (err) {
      console.error("Autosave failed:", err);
    }
  }

  function loadBackupsList() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BACKUPS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function createBackupSnapshot(label = "Checkpoint", isAuto = false) {
    try {
      const backups = loadBackupsList();
      const entry = {
        id: "b_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        label: label || (isAuto ? "Auto-backup" : "Manual Checkpoint"),
        isAuto,
        timestamp: new Date().toISOString(),
        roomCount: appState.rooms.length,
        connCount: appState.connections.length,
        state: JSON.parse(JSON.stringify(appState)),
      };
      backups.unshift(entry);
      while (backups.length > MAX_AUTO_BACKUPS) {
        backups.pop();
      }
      localStorage.setItem(STORAGE_KEY_BACKUPS, JSON.stringify(backups));
    } catch (err) {
      console.error("Failed to save backup:", err);
    }
  }

  // ==================== HELPERS & COLLISION LOGIC (Priority 1) ====================
  function generateId(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function getRoomById(id) {
    return appState.rooms.find((r) => r.id === id) || null;
  }

  function getConnectionById(id) {
    return appState.connections.find((c) => c.id === id) || null;
  }

  function getRoomPos(roomId) {
    const pos = appState.mapDisplayConfig.positions[roomId];
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      return pos;
    }
    const fallback = { x: 0, y: 0 };
    appState.mapDisplayConfig.positions[roomId] = fallback;
    return fallback;
  }

  function setRoomPos(roomId, x, y) {
    appState.mapDisplayConfig.positions[roomId] = {
      x: Math.round(x),
      y: Math.round(y),
    };
  }

  /**
   * Checks if placing a room at (x, y) overlaps any existing room (excluding ignoreRoomId)
   */
  function findOverlappingRoom(x, y, ignoreRoomId = null) {
    for (const room of appState.rooms) {
      if (room.id === ignoreRoomId) continue;
      const pos = getRoomPos(room.id);
      if (
        Math.abs(x - pos.x) < COLLISION_W &&
        Math.abs(y - pos.y) < COLLISION_H
      ) {
        return room;
      }
    }
    return null;
  }

  /**
   * Finds the nearest free (x, y) around (targetX, targetY) that does not overlap any existing room.
   * Preserves all existing room coordinates!
   */
  function findNearestFreePosition(targetX, targetY, ignoreRoomId = null) {
    if (!findOverlappingRoom(targetX, targetY, ignoreRoomId)) {
      return { x: Math.round(targetX), y: Math.round(targetY) };
    }

    const stepX = COLLISION_W + 18;
    const stepY = COLLISION_H + 18;

    for (let ring = 1; ring <= 15; ring++) {
      const candidates = [];
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          candidates.push({
            x: targetX + dx * stepX,
            y: targetY + dy * stepY,
            dist: Math.hypot(dx * stepX, dy * stepY),
          });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);
      for (const c of candidates) {
        if (!findOverlappingRoom(c.x, c.y, ignoreRoomId)) {
          return { x: Math.round(c.x), y: Math.round(c.y) };
        }
      }
    }

    return { x: Math.round(targetX + 220), y: Math.round(targetY + 120) };
  }

  /**
   * Parses a label string into a unit cardinal vector { ux, uy } if it contains a directional keyword.
   * Returns null if no cardinal direction is recognized.
   */
  function parseCardinalVector(label = "") {
    if (!label) return null;
    const clean = label.trim().toLowerCase();
    if (!clean) return null;

    const firstToken = clean.split(/[\s\-–—/→↔,()]+/)[0];

    // Check ordinal / diagonal directions first so "northeast" doesn't match "north"
    if (
      firstToken === "ne" ||
      firstToken === "northeast" ||
      clean.startsWith("northeast") ||
      clean.startsWith("north-east") ||
      clean.startsWith("north east")
    ) {
      return { ux: 1, uy: -1, isElevation: false };
    }
    if (
      firstToken === "nw" ||
      firstToken === "northwest" ||
      clean.startsWith("northwest") ||
      clean.startsWith("north-west") ||
      clean.startsWith("north west")
    ) {
      return { ux: -1, uy: -1, isElevation: false };
    }
    if (
      firstToken === "se" ||
      firstToken === "southeast" ||
      clean.startsWith("southeast") ||
      clean.startsWith("south-east") ||
      clean.startsWith("south east")
    ) {
      return { ux: 1, uy: 1, isElevation: false };
    }
    if (
      firstToken === "sw" ||
      firstToken === "southwest" ||
      clean.startsWith("southwest") ||
      clean.startsWith("south-west") ||
      clean.startsWith("south west")
    ) {
      return { ux: -1, uy: 1, isElevation: false };
    }

    // Match primary cardinal direction at start of string (also handles "South - North" -> South from origin)
    if (firstToken === "n" || firstToken === "north" || clean.startsWith("north")) {
      return { ux: 0, uy: -1, isElevation: false };
    }
    if (firstToken === "up" || firstToken === "u" || clean.includes("stairs up")) {
      return { ux: 0, uy: -1, isElevation: true };
    }
    if (firstToken === "s" || firstToken === "south" || clean.startsWith("south")) {
      return { ux: 0, uy: 1, isElevation: false };
    }
    if (firstToken === "down" || firstToken === "d" || clean.includes("stairs down")) {
      return { ux: 0, uy: 1, isElevation: true };
    }
    if (
      firstToken === "e" ||
      firstToken === "east" ||
      clean.startsWith("east") ||
      firstToken === "right"
    ) {
      return { ux: 1, uy: 0, isElevation: false };
    }
    if (
      firstToken === "w" ||
      firstToken === "west" ||
      clean.startsWith("west") ||
      firstToken === "left"
    ) {
      return { ux: -1, uy: 0, isElevation: false };
    }
    return null;
  }

  const CARDINAL_OR_ORDINAL_TOKENS = new Set([
    "n",
    "north",
    "s",
    "south",
    "e",
    "east",
    "w",
    "west",
    "ne",
    "northeast",
    "north-east",
    "nw",
    "northwest",
    "north-west",
    "se",
    "southeast",
    "south-east",
    "sw",
    "southwest",
    "south-west",
  ]);

  /**
   * Returns true if a connection label consists solely of cardinal/ordinal directions
   * (excluding Up/Down), so it can be omitted on the visual map where mutual position shows direction.
   */
  function isCardinalOrOrdinalOnlyLabel(label = "") {
    if (!label) return false;
    const clean = label.trim().toLowerCase();
    if (!clean) return false;
    if (CARDINAL_OR_ORDINAL_TOKENS.has(clean)) return true;
    const parts = clean.split(/[\s\-–—/→↔,()]+/).filter(Boolean);
    return parts.length > 0 && parts.every((p) => CARDINAL_OR_ORDINAL_TOKENS.has(p));
  }

  /**
   * Infers the cardinal direction vector { ux, uy, isElevation } from FromRoom -> ToRoom
   * using either `conn.label` or the negated `conn.reverseLabel`.
   */
  function getConnectionCardinalDirection(conn) {
    const forward = parseCardinalVector(conn.label || "");
    if (forward) return forward;

    if (conn.bidirectional && conn.reverseLabel) {
      const rev = parseCardinalVector(conn.reverseLabel);
      if (rev) {
        return { ux: -rev.ux, uy: -rev.uy, isElevation: Boolean(rev.isElevation) };
      }
    }
    return null;
  }

  /**
   * Computes an ideal spawn position when branching from an existing room based on the exit label
   */
  function getDirectionalOffsetFromLabel(label = "", reverseLabel = "") {
    const vec =
      parseCardinalVector(label) ||
      (reverseLabel ? parseCardinalVector(reverseLabel) && {
        ux: -parseCardinalVector(reverseLabel).ux,
        uy: -parseCardinalVector(reverseLabel).uy,
      } : null);
    if (vec) {
      return {
        dx: vec.ux * 256,
        dy: vec.uy * 160,
      };
    }
    return { dx: 256, dy: 0 };
  }

  /**
   * Optional explicit Auto-Arrange:
   * - Strictly prioritizes relative cardinal directions (N/S/E/W) and allows cardinal connections
   *   to lengthen along their axis (e.g. 1x, 2x, 3x grid steps) if rooms are in between.
   * - Allows Warp connections to span arbitrarily far without pulling rooms out of alignment.
   */
  function autoArrangeMap() {
    if (appState.rooms.length <= 1) return;
    pushUndoSnapshot();
    createBackupSnapshot("Before Auto-Arrange", true);

    const STEP_X = 256;
    const STEP_Y = 160;

    const nodes = appState.rooms.map((r) => {
      const p = getRoomPos(r.id);
      return { id: r.id, x: p.x, y: p.y, vx: 0, vy: 0 };
    });
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Track which rooms have at least one normal (non-warp) connection
    const hasNormalConn = new Set();
    for (const conn of appState.connections) {
      if (conn.fromRoomId === conn.toRoomId) continue;
      if (conn.style !== "warp") {
        hasNormalConn.add(conn.fromRoomId);
        hasNormalConn.add(conn.toRoomId);
      }
    }

    const iterations = 130;
    for (let iter = 0; iter < iterations; iter++) {
      // 1. Box-aware repulsion so rooms don't sit on top of each other
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            dx = (i % 2 === 0 ? 1 : -1) * 8;
            dy = (j % 2 === 0 ? 1 : -1) * 8;
          }
          const minSepX = COLLISION_W + 44;
          const minSepY = COLLISION_H + 44;
          if (Math.abs(dx) < minSepX && Math.abs(dy) < minSepY) {
            const overlapX = minSepX - Math.abs(dx);
            const overlapY = minSepY - Math.abs(dy);
            if (overlapX < overlapY) {
              const pushX = (dx >= 0 ? 1 : -1) * overlapX * 0.18;
              a.vx -= pushX;
              b.vx += pushX;
            } else {
              const pushY = (dy >= 0 ? 1 : -1) * overlapY * 0.18;
              a.vy -= pushY;
              b.vy += pushY;
            }
          }
        }
      }

      // 2. Connection constraints (Cardinal priority + lengthening, Warps unconstrained)
      for (const conn of appState.connections) {
        if (conn.fromRoomId === conn.toRoomId) continue;
        const a = nodeMap.get(conn.fromRoomId);
        const b = nodeMap.get(conn.toRoomId);
        if (!a || !b) continue;

        const isWarp = conn.style === "warp";
        if (isWarp) {
          // Warp connections are allowed to be very far away!
          // Only apply a tiny tether if one of the rooms has ZERO normal connections so it doesn't drift off-screen.
          if (!hasNormalConn.has(a.id) || !hasNormalConn.has(b.id)) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 1;
            const targetDist = 360;
            if (dist > targetDist * 1.8) {
              const pull = ((dist - targetDist) / dist) * 0.015;
              a.vx += dx * pull;
              a.vy += dy * pull;
              b.vx -= dx * pull;
              b.vy -= dy * pull;
            }
          }
          continue;
        }

        const dir = getConnectionCardinalDirection(conn);
        if (dir) {
          // Cardinal connection: strictly align orthogonal axis, and enforce minimum step along cardinal axis
          // while allowing the cardinal axis to lengthen if other rooms are in between!
          if (dir.ux === 0 && dir.uy !== 0) {
            // North / South (or Up / Down) connection:
            // Explicit North/South locks X axis strongly (0.26); Up/Down uses a slightly softer X lock (0.11)
            // so if a room has BOTH North and Up exits, North wins the direct vertical column while Up still stays strictly above!
            const xLockStrength = dir.isElevation ? 0.11 : 0.26;
            const errX = b.x - a.x;
            a.vx += errX * xLockStrength;
            b.vx -= errX * xLockStrength;

            // Along Y: b.y - a.y should be in direction `dir.uy` with magnitude >= STEP_Y
            const projY = (b.y - a.y) * dir.uy;
            if (projY < STEP_Y) {
              // Too close or on the wrong side! Push strongly to at least STEP_Y
              const corrY = (STEP_Y - projY) * dir.uy * 0.24;
              a.vy -= corrY;
              b.vy += corrY;
            } else {
              // Already on the correct cardinal side and >= STEP_Y; gentle pull so it can lengthen freely if needed
              const corrY = (projY - STEP_Y) * dir.uy * 0.025;
              a.vy += corrY;
              b.vy -= corrY;
            }
          } else if (dir.uy === 0 && dir.ux !== 0) {
            // East / West connection: lock Y axis strongly
            const errY = b.y - a.y;
            a.vy += errY * 0.24;
            b.vy -= errY * 0.24;

            // Along X: b.x - a.x should be in direction `dir.ux` with magnitude >= STEP_X
            const projX = (b.x - a.x) * dir.ux;
            if (projX < STEP_X) {
              const corrX = (STEP_X - projX) * dir.ux * 0.24;
              a.vx -= corrX;
              b.vx += corrX;
            } else {
              const corrX = (projX - STEP_X) * dir.ux * 0.025;
              a.vx += corrX;
              b.vx -= corrX;
            }
          } else {
            // Ordinal / Diagonal directions (NE, NW, SE, SW):
            // Placed at taxicab grid distance: 1 full E/W step (STEP_X) + 1 full N/S step (STEP_Y)
            // (and allowed to lengthen along the diagonal ray if intermediate rooms sit in between).
            const projX = (b.x - a.x) * dir.ux;
            const projY = (b.y - a.y) * dir.uy;

            // Enforce minimum 1 grid step on both X and Y axes
            const rateX = projX < STEP_X ? 0.24 : 0.025;
            const rateY = projY < STEP_Y ? 0.24 : 0.025;
            const corrX = (STEP_X - projX) * dir.ux * rateX;
            const corrY = (STEP_Y - projY) * dir.uy * rateY;
            a.vx -= corrX;
            b.vx += corrX;
            a.vy -= corrY;
            b.vy += corrY;

            // Lock to the diagonal grid ray so (projX / STEP_X) ≈ (projY / STEP_Y) when lengthened
            if (projX > 0 && projY > 0) {
              const gridStepsAvg = 0.5 * (projX / STEP_X + projY / STEP_Y);
              const diagErrX = (gridStepsAvg * STEP_X - projX) * dir.ux * 0.14;
              const diagErrY = (gridStepsAvg * STEP_Y - projY) * dir.uy * 0.14;
              a.vx -= diagErrX;
              b.vx += diagErrX;
              a.vy -= diagErrY;
              b.vy += diagErrY;
            }
          }
        } else {
          // Normal connection WITHOUT a cardinal direction label:
          // Pull toward a comfortable distance along their current angle without forcing East
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const idealDist = 240;
          const factor = ((dist - idealDist) / dist) * 0.06;
          a.vx += dx * factor;
          a.vy += dy * factor;
          b.vx -= dx * factor;
          b.vy -= dy * factor;
        }
      }

      for (const n of nodes) {
        n.x += Math.max(-32, Math.min(32, n.vx));
        n.y += Math.max(-32, Math.min(32, n.vy));
        n.vx *= 0.45;
        n.vy *= 0.45;
      }
    }

    // 3. Snap to grid and place without overlaps (lengthening along cardinal axis if a collision occurs)
    appState.mapDisplayConfig.positions = {};
    for (const n of nodes) {
      const snappedX = Math.round(n.x / 16) * 16;
      const snappedY = Math.round(n.y / 16) * 16;
      const free = findNearestFreePosition(snappedX, snappedY, n.id);
      setRoomPos(n.id, free.x, free.y);
    }

    saveStateToLocal();
    fitMapViewport(document.getElementById("map-svg"), appState.mapDisplayConfig.viewport);
    renderAll();
    showToast("Map rearranged with cardinal priority (Press Ctrl+Z to undo)");
  }

  // ==================== SVG RENDERING: MAIN & NESTED MAPS ====================
  function createSvgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    return el;
  }

  /**
   * Computes path geometry and label anchor coordinates for a connection
   */
  function computeConnectionGeometry(conn, siblingIndex, siblingTotal) {
    const fromPos = getRoomPos(conn.fromRoomId);
    const toPos = getRoomPos(conn.toRoomId);

    // Self-loop connection (Room connects back to itself!)
    if (conn.fromRoomId === conn.toRoomId) {
      const loopOffset = siblingIndex * 22;
      const startX = fromPos.x - 28;
      const startY = fromPos.y - NODE_H / 2;
      const endX = fromPos.x + 28;
      const endY = fromPos.y - NODE_H / 2;
      const ctrlY = fromPos.y - NODE_H / 2 - 68 - loopOffset;
      const pathD = `M ${startX} ${startY} C ${startX - 45} ${ctrlY}, ${endX + 45} ${ctrlY}, ${endX} ${endY}`;
      return {
        pathD,
        isSplitWarp: false,
        fromTailPathD: null,
        toTailPathD: null,
        fromLabelPos: { x: fromPos.x, y: ctrlY + 16 },
        toLabelPos: null,
      };
    }

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    // Average room spacing in save files is 256px (X) and 160px (Y).
    // A warp is "more than two rooms away" when its normalized room-grid distance exceeds ~2.05 rooms.
    const roomUnitsDist = Math.hypot(dx / 256, dy / 160);
    const isSplitWarp = conn.style === "warp" && roomUnitsDist > 2.05;

    // Normal vector perpendicular to edge
    const nx = -uy;
    const ny = ux;

    // Curve offset if multiple connections between same two rooms or if it's a warp
    let curveOffset = 0;
    if (siblingTotal > 1) {
      const centered = siblingIndex - (siblingTotal - 1) / 2;
      curveOffset = centered * 44;
    } else if (conn.style === "warp") {
      curveOffset = 34;
    }

    // Intersect with rectangular room card boundary so arrowheads are clearly visible outside the card
    const startPoint = intersectRectBoundary(fromPos.x, fromPos.y, ux, uy, curveOffset * 0.25, nx, ny);
    const endPoint = intersectRectBoundary(toPos.x, toPos.y, -ux, -uy, curveOffset * 0.25, nx, ny);

    const midX = (startPoint.x + endPoint.x) / 2 + nx * curveOffset;
    const midY = (startPoint.y + endPoint.y) / 2 + ny * curveOffset;

    const pathD =
      Math.abs(curveOffset) < 1
        ? `M ${startPoint.x} ${startPoint.y} L ${endPoint.x} ${endPoint.y}`
        : `M ${startPoint.x} ${startPoint.y} Q ${midX} ${midY} ${endPoint.x} ${endPoint.y}`;

    // Calculate point along Quadratic Bezier at parameter t in [0, 1]
    const ptAt = (t) => {
      if (Math.abs(curveOffset) < 1) {
        return {
          x: startPoint.x + (endPoint.x - startPoint.x) * t,
          y: startPoint.y + (endPoint.y - startPoint.y) * t,
        };
      }
      const mt = 1 - t;
      return {
        x: mt * mt * startPoint.x + 2 * mt * t * midX + t * t * endPoint.x,
        y: mt * mt * startPoint.y + 2 * mt * t * midY + t * t * endPoint.y,
      };
    };

    const isWarp = conn.style === "warp";
    const showFrom =
      Boolean(conn.label && conn.label.trim() !== "") &&
      (isWarp || !isCardinalOrOrdinalOnlyLabel(conn.label));
    const showTo =
      Boolean(conn.bidirectional && conn.reverseLabel && conn.reverseLabel.trim() !== "") &&
      (isWarp || !isCardinalOrOrdinalOnlyLabel(conn.reverseLabel));

    if (isSplitWarp) {
      const chordDist = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) || 1;
      const tailFrac = Math.min(0.28, Math.max(0.14, 92 / chordDist));

      const fromTailEnd = ptAt(tailFrac);
      const fromCtrlX = (1 - tailFrac) * startPoint.x + tailFrac * midX;
      const fromCtrlY = (1 - tailFrac) * startPoint.y + tailFrac * midY;
      const fromTailPathD = `M ${startPoint.x} ${startPoint.y} Q ${Math.round(fromCtrlX)} ${Math.round(
        fromCtrlY
      )} ${Math.round(fromTailEnd.x)} ${Math.round(fromTailEnd.y)}`;

      const toTailStart = ptAt(1 - tailFrac);
      const toCtrlX = tailFrac * midX + (1 - tailFrac) * endPoint.x;
      const toCtrlY = tailFrac * midY + (1 - tailFrac) * endPoint.y;
      const toTailPathD = `M ${Math.round(toTailStart.x)} ${Math.round(toTailStart.y)} Q ${Math.round(
        toCtrlX
      )} ${Math.round(toCtrlY)} ${endPoint.x} ${endPoint.y}`;

      // Place labels directly on their respective tail sections
      const labelFrac = tailFrac * 0.56;
      return {
        pathD: `${fromTailPathD} ${toTailPathD}`,
        isSplitWarp: true,
        fromTailPathD,
        toTailPathD,
        fromLabelPos: showFrom ? ptAt(labelFrac) : null,
        toLabelPos: showTo ? ptAt(1 - labelFrac) : null,
      };
    }

    return {
      pathD,
      isSplitWarp: false,
      fromTailPathD: null,
      toTailPathD: null,
      fromLabelPos: showFrom ? (showTo ? ptAt(0.28) : ptAt(0.5)) : null,
      toLabelPos: showTo ? (showFrom ? ptAt(0.74) : ptAt(0.5)) : null,
    };
  }

  function intersectRectBoundary(cx, cy, dirX, dirY, lateralShift, nx, ny) {
    const halfW = NODE_W / 2 + 5;
    const halfH = NODE_H / 2 + 5;
    const tx = Math.abs(dirX) > 0.0001 ? halfW / Math.abs(dirX) : Infinity;
    const ty = Math.abs(dirY) > 0.0001 ? halfH / Math.abs(dirY) : Infinity;
    const t = Math.min(tx, ty);
    return {
      x: Math.round(cx + dirX * t + nx * lateralShift),
      y: Math.round(cy + dirY * t + ny * lateralShift),
    };
  }

  function renderSvgLabelBadge(parentGroup, x, y, text) {
    if (!text) return;
    const display = text.length > 18 ? text.slice(0, 17) + "…" : text;
    const width = Math.max(26, display.length * 6.4 + 12);
    const height = 18;
    const rect = createSvgEl("rect", {
      x: Math.round(x - width / 2),
      y: Math.round(y - height / 2),
      width: Math.round(width),
      height,
      class: "conn-label-bg",
    });
    const label = createSvgEl("text", {
      x: Math.round(x),
      y: Math.round(y),
      class: "conn-label-text",
    });
    label.textContent = display;
    parentGroup.appendChild(rect);
    parentGroup.appendChild(label);
  }

  function isConnectionDirectMatch(conn, queryStr) {
    if (!queryStr || queryStr.trim() === "") return false;
    const q = queryStr.trim().toLowerCase();
    if (conn.label && conn.label.toLowerCase().includes(q)) return true;
    if (conn.reverseLabel && conn.reverseLabel.toLowerCase().includes(q)) return true;
    if (conn.notes && conn.notes.toLowerCase().includes(q)) return true;
    if (conn.style && conn.style.toLowerCase().includes(q)) return true;
    if (conn.style === "warp" && ("portal".includes(q) || "teleport".includes(q))) return true;
    return false;
  }

  function doesConnectionMatchSearchAndFilter(conn, queryStr = searchQuery, tagSet = activeTagFilters) {
    const fromRoom = getRoomById(conn.fromRoomId);
    const toRoom = getRoomById(conn.toRoomId);
    if (!fromRoom || !toRoom) return false;

    const hasTags = Boolean(tagSet && tagSet.size > 0);
    const hasQuery = Boolean(queryStr && queryStr.trim() !== "");

    // 1. Tag Filtering:
    // When tag filters are active, an edge matches if both endpoints match the tag filter.
    if (hasTags) {
      const fromHasTags = doesRoomMatchSearchAndFilter(fromRoom, null, tagSet);
      const toHasTags = doesRoomMatchSearchAndFilter(toRoom, null, tagSet);
      if (!fromHasTags || !toHasTags) return false;
    }

    // 2. Query Search:
    if (hasQuery) {
      const q = queryStr.trim().toLowerCase();
      // Direct connection match (label, reverseLabel, notes, style)
      if (isConnectionDirectMatch(conn, queryStr)) return true;
      // Endpoint room name match
      if (fromRoom.name.toLowerCase().includes(q) || toRoom.name.toLowerCase().includes(q)) return true;
      // Both endpoints match the room search query
      if (doesRoomMatchSearchAndFilter(fromRoom, queryStr, null) && doesRoomMatchSearchAndFilter(toRoom, queryStr, null)) {
        return true;
      }
      return false;
    }

    return true;
  }

  function doesRoomMatchSearchAndFilter(room, queryStr = searchQuery, tagSet = activeTagFilters) {
    if (tagSet && tagSet.size > 0) {
      const roomTags = room.tags || [];
      for (const requiredTag of tagSet) {
        if (!roomTags.includes(requiredTag)) return false;
      }
    }
    if (queryStr && queryStr.trim() !== "") {
      const q = queryStr.trim().toLowerCase();
      const nameMatch = room.name.toLowerCase().includes(q);
      const descMatch = (room.description || "").toLowerCase().includes(q);
      const tagMatch = (room.tags || []).some((t) => t.toLowerCase().includes(q));
      if (nameMatch || descMatch || tagMatch) return true;

      // Also illuminate this room if it's connected to an edge that directly matches the query (e.g. searching by exit label or warp)
      if (appState && Array.isArray(appState.connections)) {
        const hasMatchingConn = appState.connections.some(
          (c) =>
            (c.fromRoomId === room.id || c.toRoomId === room.id) &&
            isConnectionDirectMatch(c, queryStr)
        );
        if (hasMatchingConn) return true;
      }

      return false;
    }
    return true;
  }

  /**
   * Renders the graph onto either the main map SVG or the nested visual picker SVG
   */
  function renderGraphToSvg({
    viewportGroup,
    connectionsLayer,
    roomsLayer,
    viewportState,
    isNestedPicker = false,
  }) {
    if (!viewportGroup || !connectionsLayer || !roomsLayer) return;

    viewportGroup.setAttribute(
      "transform",
      `translate(${viewportState.panX}, ${viewportState.panY}) scale(${viewportState.zoom})`
    );

    connectionsLayer.innerHTML = "";
    roomsLayer.innerHTML = "";

    // Group parallel connections between the same pair of rooms
    const pairBuckets = new Map();
    for (const conn of appState.connections) {
      const key = [conn.fromRoomId, conn.toRoomId].sort().join("::");
      if (!pairBuckets.has(key)) pairBuckets.set(key, []);
      pairBuckets.get(key).push(conn);
    }

    // 1. Render Connections (Warps always rendered below everything else)
    const isRoomHighlightedForConn = (rId) =>
      Boolean(rId) && (selectedRoomId === rId || multiSelectedRoomIds.has(rId));

    const sortedConnections = [...appState.connections].sort((a, b) => {
      const getLayerRank = (c) => {
        if (!isNestedPicker && selectedConnectionId === c.id) return 3;
        if (c.style !== "warp") return 2;
        if (
          !isNestedPicker &&
          (isRoomHighlightedForConn(c.fromRoomId) || isRoomHighlightedForConn(c.toRoomId))
        ) {
          return 1;
        }
        return 0;
      };
      return getLayerRank(a) - getLayerRank(b);
    });

    for (const conn of sortedConnections) {
      const fromRoom = getRoomById(conn.fromRoomId);
      const toRoom = getRoomById(conn.toRoomId);
      if (!fromRoom || !toRoom) continue;

      const key = [conn.fromRoomId, conn.toRoomId].sort().join("::");
      const siblings = pairBuckets.get(key) || [conn];
      const siblingIndex = siblings.indexOf(conn);

      // Ensure consistent curve direction regardless of from/to order
      const canonicalOrder = conn.fromRoomId <= conn.toRoomId ? 1 : -1;
      const effectiveIndex =
        canonicalOrder === 1 ? siblingIndex : siblings.length - 1 - siblingIndex;

      const geom = computeConnectionGeometry(conn, effectiveIndex, siblings.length);

      const isSelected = !isNestedPicker && selectedConnectionId === conn.id;
      const isAttachedToSelectedRoom =
        !isNestedPicker &&
        (isRoomHighlightedForConn(conn.fromRoomId) || isRoomHighlightedForConn(conn.toRoomId));

      const isFilteringMain = !isNestedPicker && (searchQuery.trim() !== "" || activeTagFilters.size > 0);
      const isFilteringNested = isNestedPicker && connModalState.searchFilter.trim() !== "";

      let matchesFilter = true;
      if (isFilteringMain) {
        matchesFilter = doesConnectionMatchSearchAndFilter(conn, searchQuery, activeTagFilters);
      } else if (isFilteringNested) {
        matchesFilter = doesConnectionMatchSearchAndFilter(conn, connModalState.searchFilter, null);
      }
      const isDirectMatch = isFilteringMain && isConnectionDirectMatch(conn, searchQuery);

      const classes = ["conn-group"];
      if (!conn.bidirectional) classes.push("oneway");
      if (conn.style === "warp") {
        classes.push("warp");
        classes.push(geom.isSplitWarp ? "split-warp" : "full-warp");
      }
      if (isAttachedToSelectedRoom) classes.push("connected-to-selected");
      if (isSelected) classes.push("selected");
      if ((isFilteringMain || isFilteringNested) && !matchesFilter) classes.push("dimmed");
      if (isDirectMatch) classes.push("search-match");

      const g = createSvgEl("g", { class: classes.join(" "), "data-conn-id": conn.id });

      // Wide invisible hit path for easy clicking
      const hitPath = createSvgEl("path", {
        d: geom.pathD,
        class: "conn-hit-area",
      });
      g.appendChild(hitPath);

      const isWarp = conn.style === "warp";
      let markerEnd = "url(#arrow-twoway)";
      let markerStart = "";

      if (isSelected) {
        markerEnd = "url(#arrow-selected)";
        if (conn.bidirectional) markerStart = "url(#arrow-selected)";
      } else if (isDirectMatch) {
        markerEnd = "url(#arrow-search-match)";
        if (conn.bidirectional) markerStart = "url(#arrow-search-match)";
      } else if (!conn.bidirectional) {
        markerEnd = isWarp ? "url(#arrow-oneway-warp)" : "url(#arrow-oneway)";
      } else {
        markerEnd = isWarp ? "url(#arrow-twoway-warp)" : "url(#arrow-twoway)";
        markerStart = isWarp ? "url(#arrow-twoway-warp)" : "url(#arrow-twoway)";
      }

      if (geom.isSplitWarp && geom.fromTailPathD && geom.toTailPathD) {
        // Render two separate tail paths on both sides so arrowheads appear cleanly on each tail stub
        const fromTailAttrs = {
          d: geom.fromTailPathD,
          class: "conn-path",
          "marker-end": markerEnd,
        };
        if (markerStart) {
          fromTailAttrs["marker-start"] = markerStart;
        }
        const toTailAttrs = {
          d: geom.toTailPathD,
          class: "conn-path",
          "marker-end": markerEnd,
        };
        if (markerStart) {
          toTailAttrs["marker-start"] = markerStart;
        }
        g.appendChild(createSvgEl("path", fromTailAttrs));
        g.appendChild(createSvgEl("path", toTailAttrs));
      } else {
        const pathAttrs = {
          d: geom.pathD,
          class: "conn-path",
          "marker-end": markerEnd,
        };
        if (markerStart && conn.fromRoomId !== conn.toRoomId) {
          pathAttrs["marker-start"] = markerStart;
        }
        g.appendChild(createSvgEl("path", pathAttrs));
      }

      // Render Exit Label(s) (skip pure cardinal/ordinal directions on normal non-self-loops; Warps, Up/Down, and custom labels are shown)
      const isSelfLoop = conn.fromRoomId === conn.toRoomId;
      if (
        conn.label &&
        geom.fromLabelPos &&
        (isSelfLoop || isWarp || !isCardinalOrOrdinalOnlyLabel(conn.label))
      ) {
        const prefix = !conn.bidirectional ? "→ " : "";
        renderSvgLabelBadge(g, geom.fromLabelPos.x, geom.fromLabelPos.y, prefix + conn.label);
      }
      if (
        conn.bidirectional &&
        conn.reverseLabel &&
        geom.toLabelPos &&
        (isWarp || !isCardinalOrOrdinalOnlyLabel(conn.reverseLabel))
      ) {
        renderSvgLabelBadge(g, geom.toLabelPos.x, geom.toLabelPos.y, conn.reverseLabel);
      }

      if (!isNestedPicker) {
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          selectConnection(conn.id);
        });
      }

      connectionsLayer.appendChild(g);
    }

    // 2. Render Rooms
    const isFilteringMain =
      !isNestedPicker && (searchQuery.trim() !== "" || activeTagFilters.size > 0);
    const isFilteringNested =
      isNestedPicker && connModalState.searchFilter.trim() !== "";

    for (const room of appState.rooms) {
      const pos = getRoomPos(room.id);
      const isSelected = !isNestedPicker && selectedRoomId === room.id;
      const isMultiSelected = !isNestedPicker && multiSelectedRoomIds.has(room.id);
      const isNestedFrom = isNestedPicker && connModalState.fromRoomId === room.id;
      const isNestedTo = isNestedPicker && connModalState.toRoomId === room.id;

      let matchesFilter = true;
      if (isFilteringMain) {
        matchesFilter = doesRoomMatchSearchAndFilter(room, searchQuery, activeTagFilters);
      } else if (isFilteringNested) {
        matchesFilter = doesRoomMatchSearchAndFilter(room, connModalState.searchFilter, null);
      }

      const nodeClasses = ["room-node"];
      if (isSelected || isNestedFrom || isNestedTo) nodeClasses.push("selected");
      if (isMultiSelected) nodeClasses.push("multi-selected");
      if ((isFilteringMain || isFilteringNested) && !matchesFilter) nodeClasses.push("dimmed");
      if ((isFilteringMain || isFilteringNested) && matchesFilter) nodeClasses.push("search-match");

      const g = createSvgEl("g", {
        class: nodeClasses.join(" "),
        transform: `translate(${pos.x - NODE_W / 2}, ${pos.y - NODE_H / 2})`,
        "data-room-id": room.id,
      });

      const cardBg = createSvgEl("rect", {
        x: 0,
        y: 0,
        width: NODE_W,
        height: NODE_H,
        class: "room-card-bg",
      });

      const isRainbow = room.color === RAINBOW_COLOR;
      const barFill = isRainbow
        ? (isNestedPicker ? "url(#nested-rainbow-gradient)" : "url(#rainbow-gradient)")
        : (room.color || ROOM_COLORS[0]);

      const accentBar = createSvgEl("rect", {
        x: 0,
        y: 0,
        width: 6,
        height: NODE_H,
        fill: barFill,
        class: "room-accent-bar" + (isRainbow ? " rainbow" : ""),
      });

      const titleText = createSvgEl("text", {
        x: 14,
        y: 23,
        class: "room-title-text",
      });
      titleText.textContent =
        room.name.length > 18 ? room.name.slice(0, 17) + "…" : room.name;

      g.appendChild(cardBg);
      g.appendChild(accentBar);
      g.appendChild(titleText);

      // Subtitle / Description snippet or Nested slot badge
      if (isNestedFrom || isNestedTo) {
        const badgeText = createSvgEl("text", {
          x: 14,
          y: 41,
          fill: isNestedFrom ? "#38bdf8" : "#10b981",
          "font-size": "10.5px",
          "font-weight": "700",
        });
        badgeText.textContent =
          isNestedFrom && isNestedTo
            ? "★ FROM & TO (Self-Loop)"
            : isNestedFrom
            ? "● SELECTED: FROM"
            : "● SELECTED: TO";
        g.appendChild(badgeText);
      } else if (room.description && room.description.trim() !== "") {
        const subText = createSvgEl("text", {
          x: 14,
          y: 40,
          class: "room-sub-text",
        });
        const cleanDesc = room.description.trim().replace(/\s+/g, " ");
        subText.textContent =
          cleanDesc.length > 24 ? cleanDesc.slice(0, 23) + "…" : cleanDesc;
        g.appendChild(subText);
      }

      // Render up to 2 tag badges on the card
      const tags = room.tags || [];
      let tagX = 14;
      const maxTagsShown = 2;
      for (let i = 0; i < Math.min(tags.length, maxTagsShown); i++) {
        const t = tags[i];
        const labelStr = t.length > 10 ? t.slice(0, 9) + "…" : t;
        const badgeW = labelStr.length * 5.6 + 10;
        if (tagX + badgeW > NODE_W - 18) break;

        const tagRect = createSvgEl("rect", {
          x: tagX,
          y: 50,
          width: badgeW,
          height: 15,
          class: "room-tag-badge-bg",
        });
        const tagTxt = createSvgEl("text", {
          x: tagX + 5,
          y: 60.5,
          class: "room-tag-badge-text",
        });
        tagTxt.textContent = labelStr;
        g.appendChild(tagRect);
        g.appendChild(tagTxt);
        tagX += badgeW + 5;
      }

      if (tags.length > maxTagsShown) {
        const moreTxt = createSvgEl("text", {
          x: tagX + 2,
          y: 60.5,
          class: "room-sub-text",
        });
        moreTxt.textContent = `+${tags.length - maxTagsShown}`;
        g.appendChild(moreTxt);
      }

      // Quick "+ Branch Room" button on main map node (hidden while in Multi-Select mode)
      if (!isNestedPicker && !isMultiSelectMode && multiSelectedRoomIds.size === 0) {
        const quickBtn = createSvgEl("g", {
          class: "room-quick-add-btn",
          transform: `translate(${NODE_W}, ${NODE_H / 2})`,
        });
        const qCircle = createSvgEl("circle", {
          r: 10,
          cx: 0,
          cy: 0,
          class: "room-quick-add-circle",
        });
        const qPlus = createSvgEl("text", {
          x: 0,
          y: 0.5,
          fill: "#fff",
          "font-size": "13px",
          "font-weight": "bold",
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        qPlus.textContent = "+";
        const qTitle = createSvgEl("title");
        qTitle.textContent = "Quick-add a connected room from here";
        quickBtn.appendChild(qTitle);
        quickBtn.appendChild(qCircle);
        quickBtn.appendChild(qPlus);

        quickBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        quickBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openAddRoomModal({ branchFromRoomId: room.id });
        });
        g.appendChild(quickBtn);
      }

      // Interaction handlers
      if (isNestedPicker) {
        g.addEventListener("mousedown", (e) => {
          if (e.button === 0) {
            e.stopPropagation();
          }
        });
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          pickRoomInConnectionModal(room.id);
        });
      } else {
        attachRoomDragAndSelect(g, room.id);
      }

      roomsLayer.appendChild(g);
    }
  }

  // ==================== DRAGGING & PAN/ZOOM INTERACTION ====================
  let activeRoomDrag = null;

  function startRoomDragInteraction(roomId, clientX, clientY, isShift) {
    const isGroupDrag =
      isMultiSelectMode || multiSelectedRoomIds.has(roomId) || isShift;
    const dragGroupInitialPositions = new Map();

    if (isGroupDrag) {
      const idsToMove = new Set(multiSelectedRoomIds);
      idsToMove.add(roomId);
      for (const id of idsToMove) {
        const p = getRoomPos(id);
        dragGroupInitialPositions.set(id, { x: p.x, y: p.y });
      }
    } else {
      const p = getRoomPos(roomId);
      dragGroupInitialPositions.set(roomId, { x: p.x, y: p.y });
    }
    pushUndoSnapshot();

    activeRoomDrag = {
      roomId,
      startClientX: clientX,
      startClientY: clientY,
      dragGroupInitialPositions,
      hasMoved: false,
      isShift: Boolean(isShift),
    };
  }

  function attachRoomDragAndSelect(nodeEl, roomId) {
    nodeEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      startRoomDragInteraction(roomId, e.clientX, e.clientY, e.shiftKey);
    });

    nodeEl.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        e.stopPropagation();
        const t = e.touches[0];
        startRoomDragInteraction(roomId, t.clientX, t.clientY, false);
      },
      { passive: true }
    );
  }

  function handleGlobalRoomPointerMove(clientX, clientY) {
    if (!activeRoomDrag) return;
    const d = activeRoomDrag;
    const dxScreen = clientX - d.startClientX;
    const dyScreen = clientY - d.startClientY;

    if (!d.hasMoved && Math.hypot(dxScreen, dyScreen) > 5) {
      d.hasMoved = true;
      // If dragging a room while in Multi-Select mode, ensure it's part of the active selection set
      if (isMultiSelectMode && !multiSelectedRoomIds.has(d.roomId)) {
        multiSelectedRoomIds.add(d.roomId);
        renderLeftSidebar();
        renderInspector();
      }
    }
    if (!d.hasMoved) return;

    const zoom = appState.mapDisplayConfig.viewport.zoom || 1;
    const dxWorld = dxScreen / zoom;
    const dyWorld = dyScreen / zoom;

    for (const [id, initPos] of d.dragGroupInitialPositions.entries()) {
      setRoomPos(id, Math.round(initPos.x + dxWorld), Math.round(initPos.y + dyWorld));
    }

    renderMainMap();
  }

  function handleGlobalRoomMouseMove(e) {
    handleGlobalRoomPointerMove(e.clientX, e.clientY);
  }

  function handleGlobalRoomTouchMove(e) {
    if (!activeRoomDrag || e.touches.length !== 1) return;
    const t = e.touches[0];
    handleGlobalRoomPointerMove(t.clientX, t.clientY);
  }

  function handleGlobalRoomMouseUp() {
    if (!activeRoomDrag) return;
    const d = activeRoomDrag;
    activeRoomDrag = null;

    if (!d.hasMoved) {
      // Undo snapshot wasn't needed since room didn't move
      undoStack.pop();
      updateUndoButton();
      if (isMultiSelectMode || d.isShift) {
        toggleRoomInMultiSelect(d.roomId);
      } else {
        isMobileSheetPeek = false;
        selectRoom(d.roomId);
      }
      return;
    }

    // If single room was moved, nudge if it directly collides; if a multi-select group was moved,
    // preserve relative positions among all moved rooms.
    if (d.dragGroupInitialPositions.size === 1) {
      const droppedPos = getRoomPos(d.roomId);
      const overlapping = findOverlappingRoom(droppedPos.x, droppedPos.y, d.roomId);
      if (overlapping) {
        const free = findNearestFreePosition(droppedPos.x, droppedPos.y, d.roomId);
        setRoomPos(d.roomId, free.x, free.y);
        showToast("Nudged room slightly to avoid overlap");
      }
    }

    saveStateToLocal();
    renderMainMap();
  }

  function setupPanAndZoom(svgEl, getViewport, onUpdate) {
    let isPanning = false;
    let isBoxSelecting = false;
    let hasMoved = false;
    let panStartX = 0;
    let panStartY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let boxStartScreenX = 0;
    let boxStartScreenY = 0;
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let pinchCenterWorldX = 0;
    let pinchCenterWorldY = 0;
    const isMainMap = svgEl && svgEl.id === "map-svg";

    svgEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      hasMoved = false;
      panStartX = e.clientX;
      panStartY = e.clientY;

      // On main map, left-dragging on empty canvas while in Multi-Select mode (or holding Shift) draws a selection box
      if (
        isMainMap &&
        e.button === 0 &&
        (isMultiSelectMode || e.shiftKey) &&
        (e.target === svgEl || e.target.id === "grid-bg")
      ) {
        isBoxSelecting = true;
        const rect = svgEl.getBoundingClientRect();
        boxStartScreenX = e.clientX - rect.left;
        boxStartScreenY = e.clientY - rect.top;
        return;
      }

      isPanning = true;
      const vp = getViewport();
      startPanX = vp.panX;
      startPanY = vp.panY;
    });

    // Touch pan & 2-finger pinch-zoom on SVG canvas
    svgEl.addEventListener(
      "touchstart",
      (e) => {
        if (activeRoomDrag) return;
        const vp = getViewport();
        if (e.touches.length === 2) {
          isPanning = false;
          isBoxSelecting = false;
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          pinchStartZoom = vp.zoom || 1;
          const rect = svgEl.getBoundingClientRect();
          const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
          const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
          pinchCenterWorldX = (midX - vp.panX) / pinchStartZoom;
          pinchCenterWorldY = (midY - vp.panY) / pinchStartZoom;
          return;
        }
        if (e.touches.length === 1) {
          const t = e.touches[0];
          hasMoved = false;
          panStartX = t.clientX;
          panStartY = t.clientY;
          isPanning = true;
          startPanX = vp.panX;
          startPanY = vp.panY;
        }
      },
      { passive: true }
    );

    svgEl.addEventListener(
      "touchmove",
      (e) => {
        if (activeRoomDrag) return;
        if (e.touches.length === 2 && pinchStartDist > 10) {
          e.preventDefault();
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          const curDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          const scale = curDist / pinchStartDist;
          const vp = getViewport();
          const newZoom = Math.max(0.25, Math.min(2.5, pinchStartZoom * scale));
          const rect = svgEl.getBoundingClientRect();
          const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
          const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
          vp.zoom = Number(newZoom.toFixed(3));
          vp.panX = Math.round(midX - pinchCenterWorldX * vp.zoom);
          vp.panY = Math.round(midY - pinchCenterWorldY * vp.zoom);
          hasMoved = true;
          onUpdate(false);
          return;
        }
        if (e.touches.length === 1 && isPanning) {
          const t = e.touches[0];
          const dx = t.clientX - panStartX;
          const dy = t.clientY - panStartY;
          if (!hasMoved && Math.hypot(dx, dy) < 4) return;
          hasMoved = true;
          const vp = getViewport();
          vp.panX = Math.round(startPanX + dx);
          vp.panY = Math.round(startPanY + dy);
          onUpdate(false);
        }
      },
      { passive: false }
    );

    svgEl.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) {
        pinchStartDist = 0;
      }
      if (e.touches.length === 0 && isPanning) {
        isPanning = false;
        if (hasMoved) {
          onUpdate(true);
        } else if (isMainMap) {
          // Tap on empty background on mobile
          if (isMultiSelectMode && multiSelectedRoomIds.size > 0) {
            multiSelectedRoomIds.clear();
            renderAll();
          } else {
            clearSelection();
          }
        }
        hasMoved = false;
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (isBoxSelecting) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        if (!hasMoved && Math.hypot(dx, dy) < 4) return;
        hasMoved = true;

        const rect = svgEl.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;
        const x = Math.min(boxStartScreenX, curX);
        const y = Math.min(boxStartScreenY, curY);
        const w = Math.abs(curX - boxStartScreenX);
        const h = Math.abs(curY - boxStartScreenY);

        const boxEl = document.getElementById("marquee-select-box");
        if (boxEl) {
          boxEl.classList.remove("hidden");
          boxEl.setAttribute("x", String(Math.round(x)));
          boxEl.setAttribute("y", String(Math.round(y)));
          boxEl.setAttribute("width", String(Math.round(w)));
          boxEl.setAttribute("height", String(Math.round(h)));
        }
        return;
      }

      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (!hasMoved && Math.hypot(dx, dy) < 3) return;
      hasMoved = true;
      svgEl.classList.add("panning");
      const vp = getViewport();
      vp.panX = Math.round(startPanX + dx);
      vp.panY = Math.round(startPanY + dy);
      onUpdate(false);
    });

    window.addEventListener("mouseup", (e) => {
      if (isBoxSelecting) {
        isBoxSelecting = false;
        const boxEl = document.getElementById("marquee-select-box");
        if (boxEl) boxEl.classList.add("hidden");

        if (hasMoved) {
          const rect = svgEl.getBoundingClientRect();
          const curX = e.clientX - rect.left;
          const curY = e.clientY - rect.top;
          const vp = getViewport();
          const minWorldX = (Math.min(boxStartScreenX, curX) - vp.panX) / vp.zoom;
          const maxWorldX = (Math.max(boxStartScreenX, curX) - vp.panX) / vp.zoom;
          const minWorldY = (Math.min(boxStartScreenY, curY) - vp.panY) / vp.zoom;
          const maxWorldY = (Math.max(boxStartScreenY, curY) - vp.panY) / vp.zoom;

          if (!e.shiftKey) {
            // Keep existing selection if already in Multi-Select mode, or add rooms inside box
          }
          isMultiSelectMode = true;
          if (selectedRoomId) {
            multiSelectedRoomIds.add(selectedRoomId);
            selectedRoomId = null;
          }
          selectedConnectionId = null;

          for (const r of appState.rooms) {
            const p = getRoomPos(r.id);
            if (p.x >= minWorldX && p.x <= maxWorldX && p.y >= minWorldY && p.y <= maxWorldY) {
              multiSelectedRoomIds.add(r.id);
            }
          }
          renderAll();
        }
        hasMoved = false;
        return;
      }

      if (!isPanning) return;
      isPanning = false;
      svgEl.classList.remove("panning");
      if (hasMoved) {
        onUpdate(true);
      }
      hasMoved = false;
    });

    svgEl.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const vp = getViewport();
        const rect = svgEl.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        const newZoom = Math.max(0.25, Math.min(2.5, vp.zoom * zoomFactor));

        // Zoom toward cursor point
        const worldX = (mouseX - vp.panX) / vp.zoom;
        const worldY = (mouseY - vp.panY) / vp.zoom;

        vp.zoom = Number(newZoom.toFixed(3));
        vp.panX = Math.round(mouseX - worldX * vp.zoom);
        vp.panY = Math.round(mouseY - worldY * vp.zoom);

        onUpdate(true);
      },
      { passive: false }
    );
  }

  function fitMapViewport(svgEl, viewportObj) {
    if (!svgEl || appState.rooms.length === 0) {
      viewportObj.panX = Math.round((svgEl.clientWidth || 800) / 2);
      viewportObj.panY = Math.round((svgEl.clientHeight || 500) / 2);
      viewportObj.zoom = 1;
      return;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const r of appState.rooms) {
      const p = getRoomPos(r.id);
      minX = Math.min(minX, p.x - NODE_W / 2 - 40);
      maxX = Math.max(maxX, p.x + NODE_W / 2 + 40);
      minY = Math.min(minY, p.y - NODE_H / 2 - 60);
      maxY = Math.max(maxY, p.y + NODE_H / 2 + 40);
    }

    const rect = svgEl.getBoundingClientRect();
    const viewW = rect.width || 800;
    const viewH = rect.height || 500;
    const contentW = Math.max(300, maxX - minX);
    const contentH = Math.max(220, maxY - minY);

    const scaleX = (viewW - 80) / contentW;
    const scaleY = (viewH - 80) / contentH;
    const newZoom = Math.max(0.35, Math.min(1.25, Math.min(scaleX, scaleY)));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    viewportObj.zoom = Number(newZoom.toFixed(2));
    viewportObj.panX = Math.round(viewW / 2 - centerX * viewportObj.zoom);
    viewportObj.panY = Math.round(viewH / 2 - centerY * viewportObj.zoom);
  }

  function centerCameraOnRoom(roomId) {
    const room = getRoomById(roomId);
    if (!room) return;
    const pos = getRoomPos(roomId);
    const svgEl = document.getElementById("map-svg");
    const rect = svgEl.getBoundingClientRect();
    const vp = appState.mapDisplayConfig.viewport;
    vp.panX = Math.round(rect.width / 2 - pos.x * vp.zoom);
    vp.panY = Math.round(rect.height / 2 - pos.y * vp.zoom);
    saveStateToLocal(false);
    renderMainMap();
  }

  function centerCameraOnConnection(connId) {
    const conn = getConnectionById(connId);
    if (!conn) return;
    const posFrom = getRoomPos(conn.fromRoomId);
    const posTo = getRoomPos(conn.toRoomId);
    if (!posFrom || !posTo) return;
    const midX = (posFrom.x + posTo.x) / 2;
    const midY = (posFrom.y + posTo.y) / 2;
    const svgEl = document.getElementById("map-svg");
    const rect = svgEl.getBoundingClientRect();
    const vp = appState.mapDisplayConfig.viewport;
    vp.panX = Math.round(rect.width / 2 - midX * vp.zoom);
    vp.panY = Math.round(rect.height / 2 - midY * vp.zoom);
    saveStateToLocal(false);
    renderMainMap();
  }

  // ==================== UI RENDERING & SYNC ====================
  function renderMainMap() {
    renderGraphToSvg({
      viewportGroup: document.getElementById("map-viewport"),
      connectionsLayer: document.getElementById("connections-layer"),
      roomsLayer: document.getElementById("rooms-layer"),
      viewportState: appState.mapDisplayConfig.viewport,
      isNestedPicker: false,
    });

    const zoomText = document.getElementById("zoom-level-text");
    if (zoomText) {
      zoomText.textContent = `${Math.round(appState.mapDisplayConfig.viewport.zoom * 100)}%`;
    }

    const emptyOverlay = document.getElementById("map-empty-state");
    if (emptyOverlay) {
      emptyOverlay.classList.toggle("hidden", appState.rooms.length > 0);
    }
  }

  function renderLeftSidebar() {
    const badge = document.getElementById("room-count-badge");
    if (badge) badge.textContent = String(appState.rooms.length);

    const mobSearchBadge = document.getElementById("mob-search-badge");
    const mobSearchBtn = document.getElementById("mob-btn-search");
    const hasFilter = searchQuery.trim() !== "" || activeTagFilters.size > 0;
    if (mobSearchBadge) {
      mobSearchBadge.textContent = String(appState.rooms.length);
    }
    if (mobSearchBtn) {
      mobSearchBtn.classList.toggle("active", hasFilter);
    }

    // Collect all unique tags with counts
    const tagCounts = new Map();
    for (const r of appState.rooms) {
      for (const t of r.tags || []) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }

    // Update datalist for tag autocomplete
    const datalist = document.getElementById("existing-tags-datalist");
    if (datalist) {
      datalist.innerHTML = Array.from(tagCounts.keys())
        .sort()
        .map((t) => `<option value="${escapeHtml(t)}"></option>`)
        .join("");
    }

    // Clean up stale active tag filters
    for (const activeTag of Array.from(activeTagFilters)) {
      if (!tagCounts.has(activeTag)) activeTagFilters.delete(activeTag);
    }

    const clearTagsBtn = document.getElementById("btn-clear-tag-filter");
    if (clearTagsBtn) {
      clearTagsBtn.classList.toggle("hidden", activeTagFilters.size === 0);
    }

    const tagListEl = document.getElementById("tag-filter-list");
    if (tagListEl) {
      if (tagCounts.size === 0) {
        tagListEl.innerHTML = `<span class="muted-hint">No tags yet</span>`;
      } else {
        tagListEl.innerHTML = "";
        for (const [tag, count] of Array.from(tagCounts.entries()).sort((a, b) =>
          a[0].localeCompare(b[0])
        )) {
          const pill = document.createElement("span");
          pill.className = "tag-pill" + (activeTagFilters.has(tag) ? " active" : "");
          pill.textContent = `${tag} (${count})`;
          pill.addEventListener("click", () => {
            if (activeTagFilters.has(tag)) activeTagFilters.delete(tag);
            else activeTagFilters.add(tag);
            renderLeftSidebar();
            renderMainMap();
          });
          tagListEl.appendChild(pill);
        }
      }
    }

    // Filter rooms & connections for list
    const resultsEl = document.getElementById("room-search-results");
    if (!resultsEl) return;

    const isFiltered = searchQuery.trim() !== "" || activeTagFilters.size > 0;
    const matchingRooms = appState.rooms.filter((r) =>
      doesRoomMatchSearchAndFilter(r, searchQuery, activeTagFilters)
    );
    const matchingConnections = isFiltered
      ? appState.connections.filter((c) =>
          doesConnectionMatchSearchAndFilter(c, searchQuery, activeTagFilters)
        )
      : [];

    if (matchingRooms.length === 0 && matchingConnections.length === 0) {
      resultsEl.innerHTML = `<div class="muted-hint" style="padding: 12px 6px;">${
        appState.rooms.length === 0
          ? "No rooms created yet."
          : "No rooms or connections match your search or tag filter."
      }</div>`;
      return;
    }

    resultsEl.innerHTML = "";

    // If search/filter is active and both rooms and connections match, show a section header for Rooms
    if (isFiltered && matchingConnections.length > 0) {
      const roomHeader = document.createElement("div");
      roomHeader.className = "section-label-row";
      roomHeader.style.padding = "4px 6px 2px";
      roomHeader.innerHTML = `<span class="section-label">Rooms (${matchingRooms.length})</span>`;
      resultsEl.appendChild(roomHeader);
    }

    for (const room of matchingRooms) {
      const isRoomSelected =
        selectedRoomId === room.id || multiSelectedRoomIds.has(room.id);
      const item = document.createElement("div");
      item.className = "room-list-item" + (isRoomSelected ? " selected" : "");
      item.innerHTML = `
        <div class="room-item-top">
          ${renderRoomColorDot(room.color)}
          <span>${escapeHtml(room.name)}</span>
        </div>
        ${
          room.description
            ? `<div class="room-item-desc">${escapeHtml(room.description)}</div>`
            : ""
        }
        ${
          room.tags && room.tags.length > 0
            ? `<div class="room-item-tags">${room.tags
                .map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`)
                .join("")}</div>`
            : ""
        }
      `;
      item.addEventListener("click", (e) => {
        if (isMultiSelectMode || e.shiftKey) {
          toggleRoomInMultiSelect(room.id);
        } else {
          isMobileSheetPeek = false;
          selectRoom(room.id);
          centerCameraOnRoom(room.id);
          if (isMobileLayout()) closeMobileSearchDialog();
        }
      });
      resultsEl.appendChild(item);
    }

    // Render Matching Connections if any
    if (matchingConnections.length > 0) {
      const connHeader = document.createElement("div");
      connHeader.className = "section-label-row";
      connHeader.style.padding = "12px 6px 4px";
      connHeader.innerHTML = `<span class="section-label">Connections (${matchingConnections.length})</span>`;
      resultsEl.appendChild(connHeader);

      for (const conn of matchingConnections) {
        const fromRoom = getRoomById(conn.fromRoomId);
        const toRoom = getRoomById(conn.toRoomId);
        if (!fromRoom || !toRoom) continue;

        const isConnSelected = selectedConnectionId === conn.id;
        const item = document.createElement("div");
        item.className =
          "room-list-item conn-search-item" +
          (isConnSelected ? " selected" : "") +
          (conn.style === "warp" ? " warp" : "") +
          (!conn.bidirectional ? " oneway" : "");

        const dirSymbol = conn.bidirectional ? "↔" : "→";
        item.innerHTML = `
          <div class="room-item-top" style="gap: 6px;">
            <span style="color: var(--text-muted); font-size: 11px;">${dirSymbol}</span>
            <div style="display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${renderRoomColorDot(fromRoom.color)}
              <span style="font-weight: 600;">${escapeHtml(fromRoom.name)}</span>
              <span style="color: var(--text-muted); font-size: 11px;">${dirSymbol}</span>
              ${renderRoomColorDot(toRoom.color)}
              <span style="font-weight: 600;">${escapeHtml(toRoom.name)}</span>
            </div>
            ${
              conn.style === "warp"
                ? `<span class="conn-search-badge" style="margin-left: auto; color: #c084fc; border-color: rgba(192,132,252,0.3);">Warp</span>`
                : ""
            }
          </div>
          ${
            conn.label
              ? `<div class="room-item-desc">Exit: <strong>${escapeHtml(conn.label)}</strong>${
                  conn.reverseLabel
                    ? ` • Return: <strong>${escapeHtml(conn.reverseLabel)}</strong>`
                    : ""
                }</div>`
              : ""
          }
          ${
            conn.notes
              ? `<div class="room-item-desc" style="color: var(--text-muted); font-style: italic;">${escapeHtml(
                  conn.notes
                )}</div>`
              : ""
          }
        `;

        item.addEventListener("click", () => {
          isMobileSheetPeek = false;
          selectConnection(conn.id);
          centerCameraOnConnection(conn.id);
          if (isMobileLayout()) closeMobileSearchDialog();
        });
        resultsEl.appendChild(item);
      }
    }
  }

  function renderInspector() {
    const rightSidebar = document.getElementById("right-sidebar");
    const emptyEl = document.getElementById("inspector-empty");
    const multiEl = document.getElementById("inspector-multiselect");
    const roomEl = document.getElementById("inspector-room");
    const connEl = document.getElementById("inspector-connection");

    const multiBtn = document.getElementById("btn-multi-select");
    const multiBtnLbl = document.getElementById("multi-select-btn-label");
    const mobMultiBtn = document.getElementById("mob-btn-multiselect");
    const mobMultiBadge = document.getElementById("mob-multi-badge");
    const inMultiMode = isMultiSelectMode || multiSelectedRoomIds.size > 0;
    if (multiBtn) {
      multiBtn.classList.toggle("active", inMultiMode);
    }
    if (multiBtnLbl) {
      multiBtnLbl.textContent =
        multiSelectedRoomIds.size > 0
          ? `Multi-Select (${multiSelectedRoomIds.size})`
          : "Multi-Select";
    }
    if (mobMultiBtn) {
      mobMultiBtn.classList.toggle("active", inMultiMode);
    }
    if (mobMultiBadge) {
      mobMultiBadge.textContent = String(multiSelectedRoomIds.size);
      mobMultiBadge.classList.toggle("hidden", multiSelectedRoomIds.size === 0);
    }

    const selectedRoom = selectedRoomId ? getRoomById(selectedRoomId) : null;
    const selectedConn = selectedConnectionId ? getConnectionById(selectedConnectionId) : null;
    const hasMobileSheetOpen = inMultiMode || Boolean(selectedRoom) || Boolean(selectedConn);

    if (rightSidebar) {
      rightSidebar.classList.toggle("mobile-sheet-open", hasMobileSheetOpen);
      rightSidebar.classList.toggle("mobile-sheet-peek", hasMobileSheetOpen && isMobileSheetPeek);
    }
    const peekLabel = document.getElementById("mobile-sheet-peek-label");
    if (peekLabel) {
      peekLabel.textContent = isMobileSheetPeek
        ? "Tap handle to expand details ▲"
        : "Tap handle to minimize sheet ▼";
    }

    if (inMultiMode) {
      emptyEl.classList.add("hidden");
      roomEl.classList.add("hidden");
      connEl.classList.add("hidden");
      if (multiEl) {
        multiEl.classList.remove("hidden");
        document.getElementById("multiselect-count").textContent = String(
          multiSelectedRoomIds.size
        );
        const listEl = document.getElementById("multiselect-rooms-list");
        listEl.innerHTML = "";
        if (multiSelectedRoomIds.size === 0) {
          listEl.innerHTML = `<span class="muted-hint">No rooms selected yet. Click rooms on the map or drag a selection box!</span>`;
        } else {
          for (const rId of multiSelectedRoomIds) {
            const r = getRoomById(rId);
            if (!r) continue;
            const row = document.createElement("div");
            row.className = "conn-item-card";
            row.innerHTML = `
              <div class="room-item-top" style="gap: 8px;">
                ${renderRoomColorDot(r.color)}
                <span style="font-size: 12.5px; font-weight: 600;">${escapeHtml(r.name)}</span>
              </div>
              <button type="button" class="btn btn-xs btn-ghost remove-multi-btn" title="Deselect room">&times;</button>
            `;
            row.querySelector(".remove-multi-btn").addEventListener("click", () => {
              multiSelectedRoomIds.delete(r.id);
              renderAll();
            });
            listEl.appendChild(row);
          }
        }
      }
      return;
    }

    if (multiEl) multiEl.classList.add("hidden");

    emptyEl.classList.toggle("hidden", Boolean(selectedRoom || selectedConn));
    roomEl.classList.toggle("hidden", !selectedRoom);
    connEl.classList.toggle("hidden", !selectedConn);

    if (selectedRoom) {
      const backBtn = document.getElementById("btn-back-to-connection");
      if (backBtn) {
        const returnConn = navigatedFromConnectionId ? getConnectionById(navigatedFromConnectionId) : null;
        if (returnConn) {
          backBtn.classList.remove("hidden");
          backBtn.title = `Return to editing connection (${returnConn.label || "Exit"})`;
        } else {
          backBtn.classList.add("hidden");
          navigatedFromConnectionId = null;
        }
      }

      const nameInput = document.getElementById("edit-room-name");
      if (document.activeElement !== nameInput) {
        nameInput.value = selectedRoom.name;
      }
      const descInput = document.getElementById("edit-room-desc");
      if (document.activeElement !== descInput) {
        descInput.value = selectedRoom.description || "";
      }

      // Color swatches (including any custom hex colors used across rooms)
      const colorsWrap = document.getElementById("edit-room-colors");
      colorsWrap.innerHTML = "";
      const activeRoomColor = normalizeRoomColor(selectedRoom.color) || ROOM_COLORS[0];
      const availableColors = getAvailableRoomColors(activeRoomColor);
      for (const c of availableColors) {
        const sw = document.createElement("button");
        sw.type = "button";
        const isRainbow = c === RAINBOW_COLOR;
        sw.className = "color-swatch" + (activeRoomColor === c ? " active" : "") + (isRainbow ? " rainbow" : "");
        if (!isRainbow) {
          sw.style.background = c;
        }
        sw.title = isRainbow ? "Rainbow" : c;
        sw.addEventListener("click", () => {
          pushUndoSnapshot();
          selectedRoom.color = c;
          saveStateToLocal();
          renderAll();
        });
        colorsWrap.appendChild(sw);
      }

      const editColorPicker = document.getElementById("edit-room-color-picker");
      if (editColorPicker && document.activeElement !== editColorPicker) {
        if (activeRoomColor !== RAINBOW_COLOR) {
          editColorPicker.value = activeRoomColor;
        }
      }
      const editHexInput = document.getElementById("edit-room-hex-input");
      if (editHexInput && document.activeElement !== editHexInput) {
        editHexInput.value = activeRoomColor;
      }

      // Editable tags list
      const tagsWrap = document.getElementById("edit-room-tags-list");
      tagsWrap.innerHTML = "";
      const tags = selectedRoom.tags || [];
      if (tags.length === 0) {
        tagsWrap.innerHTML = `<span class="muted-hint">No tags on this room</span>`;
      } else {
        for (const tag of tags) {
          const pill = document.createElement("span");
          pill.className = "tag-pill";
          pill.innerHTML = `#${escapeHtml(tag)} <span class="remove-tag" title="Remove tag">&times;</span>`;
          pill.querySelector(".remove-tag").addEventListener("click", (e) => {
            e.stopPropagation();
            pushUndoSnapshot();
            selectedRoom.tags = selectedRoom.tags.filter((t) => t !== tag);
            saveStateToLocal();
            renderAll();
          });
          tagsWrap.appendChild(pill);
        }
      }

      // Connections involving this room
      const relatedConns = appState.connections.filter(
        (c) => c.fromRoomId === selectedRoom.id || c.toRoomId === selectedRoom.id
      );
      document.getElementById("inspector-conn-count").textContent = String(relatedConns.length);
      const connListEl = document.getElementById("inspector-connections-list");
      connListEl.innerHTML = "";

      if (relatedConns.length === 0) {
        connListEl.innerHTML = `<span class="muted-hint">No connections yet</span>`;
      } else {
        for (const conn of relatedConns) {
          const isOutgoing = conn.fromRoomId === selectedRoom.id;
          const otherRoomId = isOutgoing ? conn.toRoomId : conn.fromRoomId;
          const otherRoom = getRoomById(otherRoomId);
          if (!otherRoom) continue;

          let dirBadge = "↔";
          if (!conn.bidirectional) {
            dirBadge = isOutgoing ? "→ (One-way out)" : "← (One-way in)";
          }
          const relevantLabel = isOutgoing
            ? conn.label
            : conn.reverseLabel || conn.label;

          const card = document.createElement("div");
          card.className = "conn-item-card";
          card.innerHTML = `
            <div class="conn-item-main" title="Click to edit this connection">
              <div class="conn-item-target">${dirBadge} ${escapeHtml(otherRoom.name)}</div>
              <div class="conn-item-meta">
                ${relevantLabel ? `Exit: <strong>${escapeHtml(relevantLabel)}</strong> • ` : ""}
                ${conn.style === "warp" ? "✦ Warp" : "Normal"}
              </div>
            </div>
            <button type="button" class="btn btn-xs btn-ghost go-room-btn" title="Jump to ${escapeHtml(
              otherRoom.name
            )}">Go</button>
          `;

          card.querySelector(".conn-item-main").addEventListener("click", () => {
            selectConnection(conn.id);
          });
          card.querySelector(".go-room-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            selectRoom(otherRoom.id);
            centerCameraOnRoom(otherRoom.id);
          });
          connListEl.appendChild(card);
        }
      }
    } else if (selectedConn) {
      const fromRoom = getRoomById(selectedConn.fromRoomId);
      const toRoom = getRoomById(selectedConn.toRoomId);

      const fromBtn = document.getElementById("conn-inspect-from-btn");
      fromBtn.innerHTML = `
        ${fromRoom ? renderRoomColorDot(fromRoom.color) : ""}
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fromRoom ? escapeHtml(fromRoom.name) : "Unknown"}</span>
      `;
      fromBtn.title = fromRoom ? `View ${fromRoom.name} on map` : "";
      fromBtn.onclick = () => {
        if (fromRoom) {
          selectRoom(fromRoom.id, { fromConnectionId: selectedConn.id });
          centerCameraOnRoom(fromRoom.id);
        }
      };

      const fromEditBtn = document.getElementById("conn-edit-from-btn");
      if (fromEditBtn) {
        fromEditBtn.title = fromRoom ? `Edit "${fromRoom.name}" (Node)` : "Edit room";
        fromEditBtn.onclick = (e) => {
          e.stopPropagation();
          if (fromRoom) {
            selectRoom(fromRoom.id, { fromConnectionId: selectedConn.id });
            centerCameraOnRoom(fromRoom.id);
            setTimeout(() => {
              const nameInput = document.getElementById("edit-room-name");
              if (nameInput) {
                nameInput.focus();
                nameInput.select();
              }
            }, 60);
            showToast(`Editing ${fromRoom.name} • Click '← Connection' to return`);
          }
        };
      }

      const toBtn = document.getElementById("conn-inspect-to-btn");
      toBtn.innerHTML = `
        ${toRoom ? renderRoomColorDot(toRoom.color) : ""}
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${toRoom ? escapeHtml(toRoom.name) : "Unknown"}</span>
      `;
      toBtn.title = toRoom ? `View ${toRoom.name} on map` : "";
      toBtn.onclick = () => {
        if (toRoom) {
          selectRoom(toRoom.id, { fromConnectionId: selectedConn.id });
          centerCameraOnRoom(toRoom.id);
        }
      };

      const toEditBtn = document.getElementById("conn-edit-to-btn");
      if (toEditBtn) {
        toEditBtn.title = toRoom ? `Edit "${toRoom.name}" (Node)` : "Edit room";
        toEditBtn.onclick = (e) => {
          e.stopPropagation();
          if (toRoom) {
            selectRoom(toRoom.id, { fromConnectionId: selectedConn.id });
            centerCameraOnRoom(toRoom.id);
            setTimeout(() => {
              const nameInput = document.getElementById("edit-room-name");
              if (nameInput) {
                nameInput.focus();
                nameInput.select();
              }
            }, 60);
            showToast(`Editing ${toRoom.name} • Click '← Connection' to return`);
          }
        };
      }

      document.getElementById("conn-inspect-dir-icon").textContent =
        selectedConn.bidirectional ? "↕ Two-Way" : "↓ One-Way";

      document
        .getElementById("edit-conn-twoway")
        .classList.toggle("active", Boolean(selectedConn.bidirectional));
      document
        .getElementById("edit-conn-oneway")
        .classList.toggle("active", !selectedConn.bidirectional);

      document
        .getElementById("edit-conn-style-normal")
        .classList.toggle("active", selectedConn.style !== "warp");
      document
        .getElementById("edit-conn-style-warp")
        .classList.toggle("active", selectedConn.style === "warp");

      document
        .getElementById("edit-conn-reverse-group")
        .classList.toggle("hidden", !selectedConn.bidirectional);

      const lblInput = document.getElementById("edit-conn-label");
      if (document.activeElement !== lblInput) lblInput.value = selectedConn.label || "";

      const revInput = document.getElementById("edit-conn-reverse-label");
      if (document.activeElement !== revInput)
        revInput.value = selectedConn.reverseLabel || "";

      const notesInput = document.getElementById("edit-conn-notes");
      if (document.activeElement !== notesInput) notesInput.value = selectedConn.notes || "";
    }
  }

  function renderAll() {
    const titleInput = document.getElementById("map-title-input");
    if (titleInput && document.activeElement !== titleInput) {
      titleInput.value = appState.title || "Untitled Map";
    }
    renderMainMap();
    renderLeftSidebar();
    renderInspector();
  }

  function selectRoom(roomId, { fromConnectionId = undefined } = {}) {
    isMultiSelectMode = false;
    multiSelectedRoomIds.clear();
    selectedRoomId = roomId;
    selectedConnectionId = null;
    if (fromConnectionId !== undefined) {
      navigatedFromConnectionId = fromConnectionId;
    } else {
      navigatedFromConnectionId = null;
    }
    renderAll();
  }

  function selectConnection(connId) {
    isMultiSelectMode = false;
    multiSelectedRoomIds.clear();
    selectedConnectionId = connId;
    selectedRoomId = null;
    renderAll();
  }

  function clearSelection() {
    isMultiSelectMode = false;
    multiSelectedRoomIds.clear();
    selectedRoomId = null;
    selectedConnectionId = null;
    navigatedFromConnectionId = null;
    renderAll();
  }

  function toggleMultiSelectMode(forceState = null) {
    const nextState =
      typeof forceState === "boolean" ? forceState : !isMultiSelectMode && multiSelectedRoomIds.size === 0;
    if (nextState) {
      isMultiSelectMode = true;
      if (selectedRoomId) {
        multiSelectedRoomIds.add(selectedRoomId);
        selectedRoomId = null;
      }
      selectedConnectionId = null;
      showToast("Multi-Select active: Click rooms or drag a box, then drag any selected room to move together");
    } else {
      isMultiSelectMode = false;
      multiSelectedRoomIds.clear();
    }
    renderAll();
  }

  function toggleRoomInMultiSelect(roomId) {
    if (!isMultiSelectMode) {
      isMultiSelectMode = true;
      if (selectedRoomId && selectedRoomId !== roomId) {
        multiSelectedRoomIds.add(selectedRoomId);
      }
      selectedRoomId = null;
      selectedConnectionId = null;
    }
    if (multiSelectedRoomIds.has(roomId)) {
      multiSelectedRoomIds.delete(roomId);
    } else {
      multiSelectedRoomIds.add(roomId);
    }
    renderAll();
  }

  // ==================== ADD ROOM MODAL (Priority 2) ====================
  function openAddRoomModal({ branchFromRoomId = null, worldCoords = null } = {}) {
    branchSourceRoomId = branchFromRoomId;
    pendingSpawnCoords = worldCoords;

    const modal = document.getElementById("modal-add-room");
    modal.classList.remove("hidden");

    document.getElementById("new-room-name").value = "";
    document.getElementById("new-room-tags").value = "";
    document.getElementById("new-room-desc").value = "";
    document.getElementById("branch-exit-label").value = "";
    document.getElementById("branch-return-label").value = "";
    document.getElementById("branch-is-twoway").checked = true;
    document.getElementById("branch-is-warp").checked = false;

    const sourceRoom = branchSourceRoomId ? getRoomById(branchSourceRoomId) : null;
    const banner = document.getElementById("branch-from-banner");
    const branchBox = document.getElementById("branch-connection-fields");

    if (sourceRoom) {
      banner.classList.remove("hidden");
      branchBox.classList.remove("hidden");
      document.getElementById("branch-source-name").textContent = sourceRoom.name;
    } else {
      banner.classList.add("hidden");
      branchBox.classList.add("hidden");
    }

    // Render color swatches (including any custom hex colors used across rooms)
    const renderNewRoomSwatches = () => {
      const swatchContainer = document.getElementById("new-room-colors");
      swatchContainer.innerHTML = "";
      const normNew = normalizeRoomColor(newRoomColor) || ROOM_COLORS[0];
      newRoomColor = normNew;
      const availableColors = getAvailableRoomColors(normNew);
      for (const c of availableColors) {
        const btn = document.createElement("button");
        btn.type = "button";
        const isRainbow = c === RAINBOW_COLOR;
        btn.className = "color-swatch" + (normNew === c ? " active" : "") + (isRainbow ? " rainbow" : "");
        if (!isRainbow) {
          btn.style.background = c;
        }
        btn.title = isRainbow ? "Rainbow" : c;
        btn.addEventListener("click", () => {
          newRoomColor = c;
          renderNewRoomSwatches();
        });
        swatchContainer.appendChild(btn);
      }
      const newColorPicker = document.getElementById("new-room-color-picker");
      if (newColorPicker && normNew !== RAINBOW_COLOR) {
        newColorPicker.value = normNew;
      }
      const newHexInput = document.getElementById("new-room-hex-input");
      if (newHexInput && document.activeElement !== newHexInput) newHexInput.value = normNew;
    };
    renderNewRoomSwatches();

    // Existing tag suggestions with live prefix highlighting
    const existingTagsWrap = document.getElementById("new-room-existing-tags");
    const allTags = new Set();
    appState.rooms.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)));
    existingTagsWrap.innerHTML = "";
    for (const t of Array.from(allTags).sort()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip-btn";
      chip.setAttribute("data-tag", t);
      chip.textContent = `+ #${t}`;
      chip.addEventListener("click", () => {
        const input = document.getElementById("new-room-tags");
        const rawSegments = input.value.split(",");
        const lastRaw = rawSegments[rawSegments.length - 1] || "";
        const partial = lastRaw.trim().replace(/^#/, "").toLowerCase();
        const completed = rawSegments
          .slice(0, -1)
          .map((s) => s.trim().replace(/^#/, ""))
          .filter(Boolean);

        // If the user was in the middle of typing a prefix of this tag, replace that partial fragment;
        // otherwise keep the last segment if it's a non-empty distinct tag.
        const lastClean = lastRaw.trim().replace(/^#/, "");
        if (lastClean && !t.toLowerCase().startsWith(partial)) {
          if (!completed.includes(lastClean)) completed.push(lastClean);
        }
        if (!completed.includes(t)) {
          completed.push(t);
        }
        input.value = completed.join(", ") + ", ";
        input.focus();
        updateNewRoomTagHighlights();
      });
      existingTagsWrap.appendChild(chip);
    }
    updateNewRoomTagHighlights();

    setTimeout(() => document.getElementById("new-room-name").focus(), 30);
  }

  function updateNewRoomTagHighlights() {
    const input = document.getElementById("new-room-tags");
    const existingTagsWrap = document.getElementById("new-room-existing-tags");
    if (!input || !existingTagsWrap) return;

    const rawSegments = input.value.split(",");
    const lastSegment = (rawSegments[rawSegments.length - 1] || "")
      .trim()
      .replace(/^#/, "")
      .toLowerCase();

    const enteredTags = new Set(
      rawSegments
        .slice(0, -1)
        .map((s) => s.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean)
    );

    const chips = existingTagsWrap.querySelectorAll(".chip-btn[data-tag]");
    chips.forEach((chip) => {
      const tag = (chip.getAttribute("data-tag") || "").toLowerCase();
      const rawTag = chip.getAttribute("data-tag") || "";
      const isAlreadyAdded = enteredTags.has(tag) || (rawSegments.length === 1 && tag === lastSegment && input.value.trim().endsWith(","));
      const isPrefixMatch = lastSegment.length > 0 && tag.startsWith(lastSegment) && !enteredTags.has(tag);

      chip.classList.toggle("tag-already-added", isAlreadyAdded);
      chip.classList.toggle("tag-prefix-match", isPrefixMatch);
      chip.classList.toggle(
        "tag-prefix-dimmed",
        lastSegment.length > 0 && !isPrefixMatch && !isAlreadyAdded
      );
      chip.textContent = isAlreadyAdded ? `✓ #${rawTag}` : `+ #${rawTag}`;
    });
  }

  function closeAddRoomModal() {
    document.getElementById("modal-add-room").classList.add("hidden");
    branchSourceRoomId = null;
    pendingSpawnCoords = null;
  }

  // ==================== ADD CONNECTION MODAL + NESTED VISUAL MAP (Priority 3) ====================
  function openAddConnectionModal(initialFromRoomId = null) {
    if (appState.rooms.length === 0) {
      showToast("Add at least one room first!");
      return;
    }

    const defaultFrom = initialFromRoomId || selectedRoomId || appState.rooms[0].id;
    connModalState.fromRoomId = defaultFrom;
    connModalState.toRoomId = null;
    connModalState.activeSlot = defaultFrom ? "to" : "from";
    connModalState.bidirectional = true;
    connModalState.style = "normal";
    connModalState.searchFilter = "";

    document.getElementById("new-conn-label").value = "";
    document.getElementById("new-conn-reverse-label").value = "";
    document.getElementById("new-conn-notes").value = "";
    document.getElementById("conn-picker-search").value = "";
    document.getElementById("conn-validation-msg").textContent = "";

    const modal = document.getElementById("modal-add-connection");
    modal.classList.remove("hidden");

    const nestedSvg = document.getElementById("nested-map-svg");
    fitMapViewport(nestedSvg, connModalState.nestedViewport);

    renderConnectionModalUI();
  }

  function closeAddConnectionModal() {
    document.getElementById("modal-add-connection").classList.add("hidden");
  }

  function pickRoomInConnectionModal(roomId) {
    if (connModalState.activeSlot === "from") {
      connModalState.fromRoomId = roomId;
      connModalState.activeSlot = "to";
    } else {
      connModalState.toRoomId = roomId;
    }
    document.getElementById("conn-validation-msg").textContent = "";
    renderConnectionModalUI();
  }

  function renderConnectionModalUI() {
    const fromRoom = getRoomById(connModalState.fromRoomId);
    const toRoom = getRoomById(connModalState.toRoomId);

    const slotFrom = document.getElementById("slot-from");
    const slotTo = document.getElementById("slot-to");
    slotFrom.classList.toggle("active", connModalState.activeSlot === "from");
    slotTo.classList.toggle("active", connModalState.activeSlot === "to");

    const fromValEl = document.getElementById("slot-from-value");
    fromValEl.textContent = fromRoom ? fromRoom.name : "Click a room in the list or nested map →";
    fromValEl.classList.toggle("empty", !fromRoom);

    const toValEl = document.getElementById("slot-to-value");
    toValEl.textContent = toRoom ? toRoom.name : "Click a room in the list or nested map →";
    toValEl.classList.toggle("empty", !toRoom);

    document.getElementById("picker-active-slot-label").textContent =
      connModalState.activeSlot === "from" ? "1. From Room (Origin)" : "2. To Room (Destination)";

    // Direction & Style buttons
    document
      .getElementById("new-conn-twoway")
      .classList.toggle("active", connModalState.bidirectional);
    document
      .getElementById("new-conn-oneway")
      .classList.toggle("active", !connModalState.bidirectional);
    document
      .getElementById("new-conn-reverse-group")
      .classList.toggle("hidden", !connModalState.bidirectional);

    document
      .getElementById("new-conn-style-normal")
      .classList.toggle("active", connModalState.style === "normal");
    document
      .getElementById("new-conn-style-warp")
      .classList.toggle("active", connModalState.style === "warp");

    // Picker tabs (Nested Map vs Search List)
    const isMapMode = connModalState.pickerMode === "map";
    document.getElementById("tab-picker-map").classList.toggle("active", isMapMode);
    document.getElementById("tab-picker-list").classList.toggle("active", !isMapMode);
    document.getElementById("picker-map-view").classList.toggle("hidden", !isMapMode);
    document.getElementById("picker-list-view").classList.toggle("hidden", isMapMode);

    // Render Nested Visual Map
    renderGraphToSvg({
      viewportGroup: document.getElementById("nested-map-viewport"),
      connectionsLayer: document.getElementById("nested-connections-layer"),
      roomsLayer: document.getElementById("nested-rooms-layer"),
      viewportState: connModalState.nestedViewport,
      isNestedPicker: true,
    });

    // Render Searchable List Picker
    const listContainer = document.getElementById("picker-list-view");
    listContainer.innerHTML = "";
    const filtered = appState.rooms.filter((r) =>
      doesRoomMatchSearchAndFilter(r, connModalState.searchFilter, null)
    );

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div class="muted-hint" style="padding: 12px;">No matching rooms found.</div>`;
    } else {
      for (const room of filtered) {
        const isPickedFrom = connModalState.fromRoomId === room.id;
        const isPickedTo = connModalState.toRoomId === room.id;
        const item = document.createElement("div");
        item.className =
          "room-list-item" + (isPickedFrom || isPickedTo ? " selected" : "");
        item.innerHTML = `
          <div class="room-item-top">
            ${renderRoomColorDot(room.color)}
            <span>${escapeHtml(room.name)}</span>
            ${
              isPickedFrom
                ? `<span class="badge" style="margin-left:auto;color:#38bdf8;">FROM</span>`
                : ""
            }
            ${
              isPickedTo
                ? `<span class="badge" style="margin-left:auto;color:#10b981;">TO</span>`
                : ""
            }
          </div>
          ${
            room.tags && room.tags.length
              ? `<div class="room-item-tags">${room.tags
                  .map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`)
                  .join("")}</div>`
              : ""
          }
        `;
        item.addEventListener("click", () => {
          pickRoomInConnectionModal(room.id);
        });
        listContainer.appendChild(item);
      }
    }
  }

  // ==================== UNIFIED SAVE SCHEMA & CODECS (JSON / YAML / SHARE LINK) ====================
  /**
   * Single source of truth for all persisted fields across JSON, YAML, and Compact Share Links.
   * Adding a new field to `room`, `connection`, `viewport`, or `meta` here automatically includes it
   * in validation, JSON export/import, YAML export/import, and Compact Link encoding/decoding.
   */
  const SAVE_SCHEMA = {
    meta: [
      { key: "version", type: "int", default: () => 1 },
      { key: "title", type: "string", default: () => "Untitled Map" },
      { key: "updatedAt", type: "string", default: () => new Date().toISOString() },
    ],
    room: [
      { key: "id", type: "id", prefix: "r", compactSkip: true },
      { key: "name", type: "string", default: () => "Unnamed Room" },
      { key: "color", type: "dict-string", default: () => ROOM_COLORS[0] },
      { key: "description", type: "string", default: () => "" },
      { key: "tags", type: "dict-string-array", default: () => [] },
    ],
    connection: [
      { key: "id", type: "id", prefix: "c", compactSkip: true },
      { key: "fromRoomId", type: "room-ref", default: () => "" },
      { key: "toRoomId", type: "room-ref", default: () => "" },
      { key: "bidirectional", type: "boolean", default: () => true },
      { key: "style", type: "dict-string", default: () => "normal" },
      { key: "label", type: "dict-string", default: () => "" },
      { key: "reverseLabel", type: "dict-string", default: () => "" },
      { key: "notes", type: "string", default: () => "" },
    ],
    viewport: [
      { key: "panX", type: "int", default: () => 480 },
      { key: "panY", type: "int", default: () => 320 },
      { key: "zoom", type: "float", default: () => 1 },
    ],
  };

  function normalizeFieldValue(rawVal, fieldDesc) {
    const defVal = fieldDesc.default ? fieldDesc.default() : "";
    if (rawVal === undefined || rawVal === null) {
      return fieldDesc.type === "id" ? generateId(fieldDesc.prefix || "id") : defVal;
    }
    switch (fieldDesc.type) {
      case "id":
        return String(rawVal || generateId(fieldDesc.prefix || "id"));
      case "string":
      case "dict-string":
      case "room-ref":
        return String(rawVal);
      case "dict-string-array":
        return Array.isArray(rawVal) ? rawVal.map((item) => String(item)) : defVal;
      case "boolean":
        return typeof rawVal === "boolean" ? rawVal : rawVal !== false && rawVal !== "false" && rawVal !== 0;
      case "int": {
        const n = Number(rawVal);
        return Number.isFinite(n) ? Math.round(n) : defVal;
      }
      case "float": {
        const n = Number(rawVal);
        return Number.isFinite(n) ? Number(n.toFixed(3)) : defVal;
      }
      default:
        return rawVal;
    }
  }

  function isFieldDefaultValue(val, fieldDesc) {
    if (!fieldDesc.default) return false;
    const defVal = fieldDesc.default();
    if (fieldDesc.type === "dict-string-array") {
      return Array.isArray(val) && val.length === 0;
    }
    return val === defVal;
  }

  function normalizeEntityBySchema(rawObj, schemaFields) {
    const out = {};
    const src = rawObj && typeof rawObj === "object" ? rawObj : {};
    for (const field of schemaFields) {
      out[field.key] = normalizeFieldValue(src[field.key], field);
    }
    return out;
  }

  /**
   * Produces the Canonical Intermediate Data Structure used by all codecs and runtime state.
   */
  function validateAndNormalizeState(data) {
    if (!data || !Array.isArray(data.rooms) || !Array.isArray(data.connections)) {
      throw new Error("Invalid map file structure: missing rooms or connections array.");
    }
    const meta = normalizeEntityBySchema(data, SAVE_SCHEMA.meta);
    const clean = createEmptyMapState(meta.title || "Imported Map");
    for (const field of SAVE_SCHEMA.meta) {
      clean[field.key] = meta[field.key];
    }

    clean.rooms = data.rooms.map((r) => normalizeEntityBySchema(r, SAVE_SCHEMA.room));
    clean.connections = data.connections.map((c) => {
      const norm = normalizeEntityBySchema(c, SAVE_SCHEMA.connection);
      norm.style = norm.style === "warp" ? "warp" : "normal";
      return norm;
    });

    clean.mapDisplayConfig.viewport = normalizeEntityBySchema(
      data.mapDisplayConfig?.viewport,
      SAVE_SCHEMA.viewport
    );

    clean.mapDisplayConfig.positions = {};
    const rawPositions = data.mapDisplayConfig?.positions || {};
    for (const [roomId, pos] of Object.entries(rawPositions)) {
      if (pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y))) {
        clean.mapDisplayConfig.positions[roomId] = {
          x: Math.round(Number(pos.x)),
          y: Math.round(Number(pos.y)),
        };
      }
    }

    // Ensure every room has a valid non-overlapping position
    for (const r of clean.rooms) {
      if (!clean.mapDisplayConfig.positions[r.id]) {
        const free = findNearestFreePosition(0, 0, r.id);
        clean.mapDisplayConfig.positions[r.id] = free;
      }
    }
    return clean;
  }

  function formatYamlFieldValue(val, fieldDesc) {
    const q = (str) => JSON.stringify(String(str ?? ""));
    switch (fieldDesc.type) {
      case "int":
        return String(Math.round(Number(val) || 0));
      case "float":
        return String(Number(val) || 0);
      case "boolean":
        return String(Boolean(val));
      case "dict-string-array":
        return `[${(Array.isArray(val) ? val : []).map((t) => q(t)).join(", ")}]`;
      default:
        return q(val);
    }
  }

  function serializeToYaml(state) {
    const canonical = validateAndNormalizeState(state);
    const q = (str) => JSON.stringify(String(str ?? ""));
    const lines = [];
    lines.push(`# Non-Euclidean Game Mapper Save File`);
    for (const field of SAVE_SCHEMA.meta) {
      lines.push(`${field.key}: ${formatYamlFieldValue(canonical[field.key], field)}`);
    }

    lines.push(`rooms:`);
    if (canonical.rooms.length === 0) {
      lines.push(`  []`);
    } else {
      for (const r of canonical.rooms) {
        SAVE_SCHEMA.room.forEach((field, idx) => {
          const prefix = idx === 0 ? "  - " : "    ";
          lines.push(`${prefix}${field.key}: ${formatYamlFieldValue(r[field.key], field)}`);
        });
      }
    }

    lines.push(`connections:`);
    if (canonical.connections.length === 0) {
      lines.push(`  []`);
    } else {
      for (const c of canonical.connections) {
        SAVE_SCHEMA.connection.forEach((field, idx) => {
          const prefix = idx === 0 ? "  - " : "    ";
          lines.push(`${prefix}${field.key}: ${formatYamlFieldValue(c[field.key], field)}`);
        });
      }
    }

    lines.push(`mapDisplayConfig:`);
    const vp = canonical.mapDisplayConfig.viewport;
    lines.push(`  viewport:`);
    for (const field of SAVE_SCHEMA.viewport) {
      lines.push(`    ${field.key}: ${formatYamlFieldValue(vp[field.key], field)}`);
    }
    lines.push(`  positions:`);
    const posEntries = Object.entries(canonical.mapDisplayConfig.positions || {});
    if (posEntries.length === 0) {
      lines.push(`    {}`);
    } else {
      for (const [roomId, pos] of posEntries) {
        lines.push(`    ${q(roomId)}: { x: ${Math.round(pos.x)}, y: ${Math.round(pos.y)} }`);
      }
    }

    return lines.join("\n") + "\n";
  }

  function serializeToJson(state) {
    return JSON.stringify(validateAndNormalizeState(state), null, 2);
  }

  /**
   * Parses either JSON or our structured YAML save format back into a canonical map state object
   */
  function parseImportedFileContent(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      return validateAndNormalizeState(JSON.parse(trimmed));
    }

    const result = createEmptyMapState();
    const lines = trimmed.split(/\r?\n/);
    let section = null;
    let subSection = null;
    let currentItem = null;

    const unquote = (val) => {
      const s = val.trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        try {
          if (s.startsWith('"')) return JSON.parse(s);
        } catch (e) {
          // fallback
        }
        return s.slice(1, -1);
      }
      return s;
    };

    const metaMap = new Map(SAVE_SCHEMA.meta.map((f) => [f.key, f]));
    const roomFieldMap = new Map(SAVE_SCHEMA.room.map((f) => [f.key, f]));
    const connFieldMap = new Map(SAVE_SCHEMA.connection.map((f) => [f.key, f]));
    const vpFieldMap = new Map(SAVE_SCHEMA.viewport.map((f) => [f.key, f]));

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim() || line.trim().startsWith("#")) continue;

      if (!line.startsWith(" ") && line.includes(":")) {
        const topKey = line.slice(0, line.indexOf(":")).trim();
        if (metaMap.has(topKey)) {
          assignYamlKeyValBySchema(result, line, metaMap, unquote);
          continue;
        }
      }

      if (line.startsWith("rooms:")) {
        section = "rooms";
        currentItem = null;
      } else if (line.startsWith("connections:")) {
        section = "connections";
        currentItem = null;
      } else if (line.startsWith("mapDisplayConfig:")) {
        section = "mapDisplayConfig";
        subSection = null;
      } else if (section === "rooms" || section === "connections") {
        const trimmedLine = line.trim();
        if (trimmedLine === "[]") continue;
        const fieldMap = section === "rooms" ? roomFieldMap : connFieldMap;
        if (trimmedLine.startsWith("- ")) {
          currentItem = {};
          if (section === "rooms") result.rooms.push(currentItem);
          else result.connections.push(currentItem);
          assignYamlKeyValBySchema(currentItem, trimmedLine.slice(2), fieldMap, unquote);
        } else if (currentItem) {
          assignYamlKeyValBySchema(currentItem, trimmedLine, fieldMap, unquote);
        }
      } else if (section === "mapDisplayConfig") {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("viewport:")) {
          subSection = "viewport";
        } else if (trimmedLine.startsWith("positions:")) {
          subSection = "positions";
        } else if (subSection === "viewport") {
          assignYamlKeyValBySchema(result.mapDisplayConfig.viewport, trimmedLine, vpFieldMap, unquote);
        } else if (subSection === "positions") {
          if (trimmedLine === "{}") continue;
          const match = trimmedLine.match(
            /^(.+?):\s*\{\s*x:\s*(-?\d+(?:\.\d+)?),\s*y:\s*(-?\d+(?:\.\d+)?)\s*\}$/
          );
          if (match) {
            const roomId = unquote(match[1]);
            result.mapDisplayConfig.positions[roomId] = {
              x: Number(match[2]),
              y: Number(match[3]),
            };
          }
        }
      }
    }

    return validateAndNormalizeState(result);
  }

  function assignYamlKeyValBySchema(obj, kvString, schemaMap, unquote) {
    const idx = kvString.indexOf(":");
    if (idx === -1) return;
    const key = kvString.slice(0, idx).trim();
    const rawVal = kvString.slice(idx + 1).trim();
    const fieldDesc = schemaMap ? schemaMap.get(key) : null;

    if (fieldDesc?.type === "dict-string-array") {
      if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        try {
          obj[key] = JSON.parse(rawVal);
          return;
        } catch (e) {
          const inner = rawVal.slice(1, -1).trim();
          obj[key] = inner ? inner.split(",").map((s) => unquote(s)) : [];
          return;
        }
      }
      obj[key] = [];
    } else if (fieldDesc?.type === "boolean") {
      obj[key] = rawVal === "true";
    } else if (fieldDesc?.type === "int" || fieldDesc?.type === "float") {
      obj[key] = Number(unquote(rawVal));
    } else {
      obj[key] = unquote(rawVal);
    }
  }

  // ==================== COMPACT SHARE LINK CODEC (?save=...) ====================
  /**
   * Packs a canonical state into a compact schema-driven tuple representation:
   * [formatVersion, title, viewportTuple, dictArray, roomTuples, connectionTuples]
   * - Uses SAVE_SCHEMA.room, SAVE_SCHEMA.connection, and SAVE_SCHEMA.viewport directly
   * - Interns repeated strings (`dict-string` & `dict-string-array`) into `dictArray`
   * - Replaces internal room IDs with integer room indices 0..N-1
   * - Trims trailing default values on each tuple
   */
  function packStateToCompactTuple(state) {
    const canonical = validateAndNormalizeState(state);
    const dict = [];
    const dictMap = new Map();
    const intern = (str) => {
      const s = String(str ?? "");
      if (!s) return -1;
      if (dictMap.has(s)) return dictMap.get(s);
      const id = dict.length;
      dict.push(s);
      dictMap.set(s, id);
      return id;
    };

    const roomIndexMap = new Map(canonical.rooms.map((r, idx) => [r.id, idx]));
    const compactRoomFields = SAVE_SCHEMA.room.filter((f) => !f.compactSkip);
    const compactConnFields = SAVE_SCHEMA.connection.filter((f) => !f.compactSkip);

    const encodeFieldForTuple = (val, field) => {
      if (field.type === "dict-string") return intern(val);
      if (field.type === "dict-string-array") return (val || []).map(intern);
      if (field.type === "room-ref") return roomIndexMap.get(val) ?? 0;
      if (field.type === "boolean") return val ? 1 : 0;
      return val;
    };

    const trimTrailingDefaults = (values, rawEntity, fields, prefixLen) => {
      let end = values.length;
      while (end > prefixLen) {
        const field = fields[end - prefixLen - 1];
        if (isFieldDefaultValue(rawEntity[field.key], field)) {
          end--;
        } else {
          break;
        }
      }
      return values.slice(0, end);
    };

    const roomTuples = canonical.rooms.map((r) => {
      const pos = canonical.mapDisplayConfig.positions[r.id] || { x: 0, y: 0 };
      const rawTuple = [
        Math.round(pos.x),
        Math.round(pos.y),
        ...compactRoomFields.map((f) => encodeFieldForTuple(r[f.key], f)),
      ];
      return trimTrailingDefaults(rawTuple, r, compactRoomFields, 2);
    });

    const connTuples = canonical.connections
      .filter((c) => roomIndexMap.has(c.fromRoomId) && roomIndexMap.has(c.toRoomId))
      .map((c) => {
        const rawTuple = compactConnFields.map((f) => encodeFieldForTuple(c[f.key], f));
        return trimTrailingDefaults(rawTuple, c, compactConnFields, 2);
      });

    const vp = canonical.mapDisplayConfig.viewport;
    const vpTuple = SAVE_SCHEMA.viewport.map((f) => vp[f.key]);

    return [1, canonical.title, vpTuple, dict, roomTuples, connTuples];
  }

  function unpackStateFromCompactTuple(tuple) {
    if (!Array.isArray(tuple) || tuple.length < 6) {
      throw new Error("Invalid compact save payload.");
    }
    const [version, title, vpTuple, dict, roomTuples, connTuples] = tuple;
    const lookupDict = (idx) => (typeof idx === "number" && idx >= 0 && idx < dict.length ? dict[idx] : "");

    const compactRoomFields = SAVE_SCHEMA.room.filter((f) => !f.compactSkip);
    const compactConnFields = SAVE_SCHEMA.connection.filter((f) => !f.compactSkip);

    const roomIds = roomTuples.map((_, i) => `r_${i}`);

    const decodeFieldFromTuple = (encodedVal, field) => {
      if (encodedVal === undefined) return field.default ? field.default() : "";
      if (field.type === "dict-string") return lookupDict(encodedVal);
      if (field.type === "dict-string-array") {
        return Array.isArray(encodedVal) ? encodedVal.map(lookupDict).filter(Boolean) : [];
      }
      if (field.type === "room-ref") return roomIds[encodedVal] || roomIds[0] || "";
      if (field.type === "boolean") return Boolean(encodedVal);
      return encodedVal;
    };

    const positions = {};
    const rooms = roomTuples.map((rt, i) => {
      const id = roomIds[i];
      positions[id] = { x: Number(rt[0]) || 0, y: Number(rt[1]) || 0 };
      const roomObj = { id };
      compactRoomFields.forEach((field, fIdx) => {
        roomObj[field.key] = decodeFieldFromTuple(rt[fIdx + 2], field);
      });
      return roomObj;
    });

    const connections = connTuples.map((ct, i) => {
      const connObj = { id: `c_${i}` };
      compactConnFields.forEach((field, fIdx) => {
        connObj[field.key] = decodeFieldFromTuple(ct[fIdx], field);
      });
      return connObj;
    });

    const viewport = {};
    SAVE_SCHEMA.viewport.forEach((field, idx) => {
      viewport[field.key] = vpTuple?.[idx] ?? field.default();
    });

    return validateAndNormalizeState({
      version: Number(version) || 1,
      title: String(title || "Shared Map"),
      updatedAt: new Date().toISOString(),
      rooms,
      connections,
      mapDisplayConfig: { viewport, positions },
    });
  }

  function uint8ToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToUint8(b64url) {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + "=".repeat(padLen));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function encodeStateToSaveParam(state) {
    const tupleJson = JSON.stringify(packStateToCompactTuple(state));
    const rawBytes = new TextEncoder().encode(tupleJson);
    if (typeof CompressionStream === "function") {
      try {
        const cs = new CompressionStream("deflate-raw");
        const writer = cs.writable.getWriter();
        writer.write(rawBytes);
        writer.close();
        const compressedBuf = await new Response(cs.readable).arrayBuffer();
        return "z." + uint8ToBase64Url(new Uint8Array(compressedBuf));
      } catch (e) {
        console.warn("Deflate compression fallback:", e);
      }
    }
    return "u." + uint8ToBase64Url(rawBytes);
  }

  async function decodeStateFromSaveParam(param) {
    const clean = String(param || "").trim();
    if (!clean) throw new Error("Empty save parameter.");
    let jsonBytes;
    if (clean.startsWith("z.")) {
      const compressed = base64UrlToUint8(clean.slice(2));
      if (typeof DecompressionStream !== "function") {
        throw new Error("This browser does not support DecompressionStream for compressed links.");
      }
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      jsonBytes = new Uint8Array(buf);
    } else if (clean.startsWith("u.")) {
      jsonBytes = base64UrlToUint8(clean.slice(2));
    } else {
      // Fallback: raw base64url compressed or uncompressed JSON
      jsonBytes = base64UrlToUint8(clean);
    }
    const tuple = JSON.parse(new TextDecoder().decode(jsonBytes));
    return unpackStateFromCompactTuple(tuple);
  }

  async function copyShareableLinkToClipboard() {
    try {
      const saveParam = await encodeStateToSaveParam(appState);
      const baseUrl =
        window.location.protocol === "http:" || window.location.protocol === "https:"
          ? window.location.origin + window.location.pathname
          : "https://guolinm.github.io/non-euclidean-mapper/";
      const fullUrl = `${baseUrl}?save=${saveParam}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        showToast(`Copied shareable link (${fullUrl.length} chars) to clipboard!`);
      } else {
        window.prompt("Copy your shareable map link:", fullUrl);
      }
    } catch (err) {
      alert("Failed to generate shareable link: " + err.message);
    }
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function slugifyTitle(title) {
    return (
      (title || "map")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "map"
    );
  }

  // ==================== BACKUPS MODAL UI ====================
  function openBackupsModal() {
    document.getElementById("modal-backups").classList.remove("hidden");
    renderBackupsModalList();
  }

  function renderBackupsModalList() {
    const listEl = document.getElementById("backups-list");
    const backups = loadBackupsList();
    if (backups.length === 0) {
      listEl.innerHTML = `<div class="muted-hint" style="padding: 14px;">No backups saved yet. Backups are created automatically as you build your map.</div>`;
      return;
    }

    listEl.innerHTML = "";
    for (const b of backups) {
      const dateStr = new Date(b.timestamp).toLocaleString();
      const item = document.createElement("div");
      item.className = "backup-item";
      item.innerHTML = `
        <div class="backup-info">
          <div class="backup-title">${escapeHtml(b.label)} <span class="badge">${
        b.isAuto ? "Auto" : "Manual"
      }</span></div>
          <div class="backup-meta">${escapeHtml(dateStr)} • ${b.roomCount} rooms, ${
        b.connCount
      } connections</div>
        </div>
        <div class="backup-actions">
          <button type="button" class="btn btn-xs btn-secondary restore-btn">Restore</button>
          <button type="button" class="btn btn-xs btn-ghost dl-yaml-btn">YAML</button>
        </div>
      `;
      item.querySelector(".restore-btn").addEventListener("click", () => {
        pushUndoSnapshot();
        createBackupSnapshot("Before Restore", true);
        appState = validateAndNormalizeState(b.state);
        clearSelection();
        saveStateToLocal(false);
        renderAll();
        document.getElementById("modal-backups").classList.add("hidden");
        showToast(`Restored backup: ${b.label}`);
      });
      item.querySelector(".dl-yaml-btn").addEventListener("click", () => {
        const yaml = serializeToYaml(b.state);
        downloadFile(`${slugifyTitle(b.state.title)}-backup.yaml`, yaml, "text/yaml");
      });
      listEl.appendChild(item);
    }
  }

  // ==================== UTILITIES ====================
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  // ==================== EVENT LISTENERS BINDING ====================
  function bindEvents() {
    const mainSvg = document.getElementById("map-svg");
    const nestedSvg = document.getElementById("nested-map-svg");

    // Global room dragging listeners (single pair bound once for app lifetime)
    window.addEventListener("mousemove", handleGlobalRoomMouseMove);
    window.addEventListener("mouseup", handleGlobalRoomMouseUp);
    window.addEventListener("touchmove", handleGlobalRoomTouchMove, { passive: true });
    window.addEventListener("touchend", handleGlobalRoomMouseUp);

    // Mobile layout listeners (Floating Bottom Bar, Search Dialog, and Bottom Sheet)
    const syncBodyMobileClass = () => {
      document.body.classList.toggle("is-mobile", isMobileLayout());
      if (!isMobileLayout()) {
        closeMobileSearchDialog();
      }
    };
    syncBodyMobileClass();
    if (mobileMediaQuery && mobileMediaQuery.addEventListener) {
      mobileMediaQuery.addEventListener("change", syncBodyMobileClass);
    } else {
      window.addEventListener("resize", syncBodyMobileClass);
    }

    const mobSearchBtn = document.getElementById("mob-btn-search");
    if (mobSearchBtn) {
      mobSearchBtn.addEventListener("click", () => {
        const leftSidebar = document.getElementById("left-sidebar");
        if (leftSidebar && leftSidebar.classList.contains("mobile-dialog-open")) {
          closeMobileSearchDialog();
        } else {
          openMobileSearchDialog();
        }
      });
    }
    const closeLeftDialogBtn = document.getElementById("btn-close-left-dialog");
    if (closeLeftDialogBtn) {
      closeLeftDialogBtn.addEventListener("click", closeMobileSearchDialog);
    }
    const leftBackdrop = document.getElementById("mobile-left-backdrop");
    if (leftBackdrop) {
      leftBackdrop.addEventListener("click", closeMobileSearchDialog);
    }

    const mobAddRoomBtn = document.getElementById("mob-btn-add-room");
    if (mobAddRoomBtn) {
      mobAddRoomBtn.addEventListener("click", () => {
        closeMobileSearchDialog();
        openAddRoomModal({ branchFromRoomId: selectedRoomId });
      });
    }

    const mobAddConnBtn = document.getElementById("mob-btn-add-conn");
    if (mobAddConnBtn) {
      mobAddConnBtn.addEventListener("click", () => {
        closeMobileSearchDialog();
        openAddConnectionModal(selectedRoomId);
      });
    }

    const mobMultiBtn = document.getElementById("mob-btn-multiselect");
    if (mobMultiBtn) {
      mobMultiBtn.addEventListener("click", () => {
        closeMobileSearchDialog();
        const enteringMulti = !isMultiSelectMode && multiSelectedRoomIds.size === 0;
        if (enteringMulti) {
          // Start in peek mode on mobile when entering multi-select so canvas is visible for tapping nodes
          isMobileSheetPeek = true;
        }
        toggleMultiSelectMode();
      });
    }

    const mobFitBtn = document.getElementById("mob-btn-fit");
    if (mobFitBtn) {
      mobFitBtn.addEventListener("click", () => {
        closeMobileSearchDialog();
        fitMapViewport(mainSvg, appState.mapDisplayConfig.viewport);
        saveStateToLocal(false);
        renderMainMap();
      });
    }

    const sheetHandle = document.getElementById("mobile-sheet-handle");
    if (sheetHandle) {
      sheetHandle.addEventListener("click", () => {
        isMobileSheetPeek = !isMobileSheetPeek;
        renderInspector();
      });
    }

    // Pan & Zoom on Main Map
    setupPanAndZoom(
      mainSvg,
      () => appState.mapDisplayConfig.viewport,
      (shouldSave) => {
        renderMainMap();
        if (shouldSave) saveStateToLocal(false);
      }
    );

    // Pan & Zoom on Nested Map inside Connection Modal
    setupPanAndZoom(
      nestedSvg,
      () => connModalState.nestedViewport,
      () => {
        renderConnectionModalUI();
      }
    );

    // Click empty background on Main Map to deselect
    let bgMouseDownPos = null;
    mainSvg.addEventListener("mousedown", (e) => {
      if (e.target === mainSvg || e.target.id === "grid-bg") {
        bgMouseDownPos = { x: e.clientX, y: e.clientY };
      } else {
        bgMouseDownPos = null;
      }
    });
    mainSvg.addEventListener("mouseup", (e) => {
      if (
        bgMouseDownPos &&
        Math.hypot(e.clientX - bgMouseDownPos.x, e.clientY - bgMouseDownPos.y) < 5
      ) {
        if (isMultiSelectMode && multiSelectedRoomIds.size > 0) {
          multiSelectedRoomIds.clear();
          renderAll();
        } else {
          clearSelection();
        }
      }
      bgMouseDownPos = null;
    });

    // Double-click canvas to add room at cursor world coordinates
    mainSvg.addEventListener("dblclick", (e) => {
      if (e.target !== mainSvg && e.target.id !== "grid-bg") return;
      const rect = mainSvg.getBoundingClientRect();
      const vp = appState.mapDisplayConfig.viewport;
      const worldX = (e.clientX - rect.left - vp.panX) / vp.zoom;
      const worldY = (e.clientY - rect.top - vp.panY) / vp.zoom;
      openAddRoomModal({ worldCoords: { x: worldX, y: worldY } });
    });

    // Top bar actions
    document.getElementById("map-title-input").addEventListener("input", (e) => {
      appState.title = e.target.value;
      saveStateToLocal();
    });

    document.getElementById("btn-add-room").addEventListener("click", () => {
      openAddRoomModal({ branchFromRoomId: selectedRoomId });
    });
    document.getElementById("btn-empty-add-room").addEventListener("click", () => {
      openAddRoomModal();
    });
    document.getElementById("btn-empty-load-demo").addEventListener("click", () => {
      pushUndoSnapshot();
      appState = createDemoMapState();
      fitMapViewport(mainSvg, appState.mapDisplayConfig.viewport);
      saveStateToLocal();
      renderAll();
      showToast("Loaded Demo Non-Euclidean Map");
    });

    document.getElementById("btn-add-connection").addEventListener("click", () => {
      openAddConnectionModal(selectedRoomId);
    });

    document.getElementById("btn-undo").addEventListener("click", performUndo);
    document.getElementById("btn-auto-arrange").addEventListener("click", autoArrangeMap);
    document.getElementById("btn-multi-select").addEventListener("click", () => {
      toggleMultiSelectMode();
    });
    document.getElementById("btn-close-multiselect").addEventListener("click", () => {
      toggleMultiSelectMode(false);
    });
    document.getElementById("btn-multiselect-all").addEventListener("click", () => {
      isMultiSelectMode = true;
      selectedRoomId = null;
      selectedConnectionId = null;
      appState.rooms
        .filter((r) => doesRoomMatchSearchAndFilter(r, searchQuery, activeTagFilters))
        .forEach((r) => multiSelectedRoomIds.add(r.id));
      renderAll();
    });
    document.getElementById("btn-multiselect-clear").addEventListener("click", () => {
      multiSelectedRoomIds.clear();
      renderAll();
    });

    // Zoom HUD buttons
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      const vp = appState.mapDisplayConfig.viewport;
      vp.zoom = Math.min(2.5, Number((vp.zoom * 1.2).toFixed(2)));
      saveStateToLocal(false);
      renderMainMap();
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      const vp = appState.mapDisplayConfig.viewport;
      vp.zoom = Math.max(0.25, Number((vp.zoom / 1.2).toFixed(2)));
      saveStateToLocal(false);
      renderMainMap();
    });
    document.getElementById("btn-zoom-fit").addEventListener("click", () => {
      fitMapViewport(mainSvg, appState.mapDisplayConfig.viewport);
      saveStateToLocal(false);
      renderMainMap();
    });

    // Share Link & File Menu Dropdown
    document.getElementById("btn-share-link").addEventListener("click", () => {
      copyShareableLinkToClipboard();
    });

    const fileBtn = document.getElementById("btn-file-menu");
    const fileMenu = document.getElementById("file-dropdown-menu");
    fileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileMenu.classList.toggle("hidden");
    });
    window.addEventListener("click", () => fileMenu.classList.add("hidden"));

    document.getElementById("menu-export-link").addEventListener("click", () => {
      copyShareableLinkToClipboard();
    });

    document.getElementById("menu-export-yaml").addEventListener("click", () => {
      const yaml = serializeToYaml(appState);
      downloadFile(`${slugifyTitle(appState.title)}.yaml`, yaml, "text/yaml");
      showToast("Saved map as YAML (.yaml)");
    });

    document.getElementById("menu-export-json").addEventListener("click", () => {
      const json = serializeToJson(appState);
      downloadFile(`${slugifyTitle(appState.title)}.json`, json, "application/json");
      showToast("Saved map as JSON (.json)");
    });

    const fileInput = document.getElementById("file-import-input");
    document.getElementById("menu-import-file").addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = parseImportedFileContent(String(reader.result));
          pushUndoSnapshot();
          createBackupSnapshot("Before File Import", true);
          appState = imported;
          clearSelection();
          saveStateToLocal();
          renderAll();
          showToast(`Loaded "${imported.title}" (${imported.rooms.length} rooms)`);
        } catch (err) {
          alert("Could not parse map file: " + err.message);
        }
      };
      reader.readAsText(file);
    });

    document.getElementById("menu-load-demo").addEventListener("click", () => {
      pushUndoSnapshot();
      createBackupSnapshot("Before Loading Demo", true);
      appState = createDemoMapState();
      clearSelection();
      fitMapViewport(mainSvg, appState.mapDisplayConfig.viewport);
      saveStateToLocal();
      renderAll();
      showToast("Loaded Demo Non-Euclidean Map");
    });

    document.getElementById("menu-clear-map").addEventListener("click", () => {
      if (
        appState.rooms.length > 0 &&
        !confirm("Start a new empty map? (Your current map will be saved in Backups)")
      ) {
        return;
      }
      pushUndoSnapshot();
      createBackupSnapshot("Before New Empty Map", false);
      appState = createEmptyMapState("New Map");
      clearSelection();
      saveStateToLocal();
      renderAll();
      showToast("Started new empty map");
    });

    // Left Sidebar Search & Filter (Priority 4)
    const searchInput = document.getElementById("search-input");
    const clearSearchBtn = document.getElementById("btn-clear-search");
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      clearSearchBtn.classList.toggle("hidden", searchQuery === "");
      renderLeftSidebar();
      renderMainMap();
    });
    clearSearchBtn.addEventListener("click", () => {
      searchQuery = "";
      searchInput.value = "";
      clearSearchBtn.classList.add("hidden");
      renderLeftSidebar();
      renderMainMap();
    });
    document.getElementById("btn-clear-tag-filter").addEventListener("click", () => {
      activeTagFilters.clear();
      renderLeftSidebar();
      renderMainMap();
    });

    // Right Sidebar Room Inspector Events (Priority 2)
    document.getElementById("btn-close-inspector").addEventListener("click", clearSelection);
    document.getElementById("btn-center-selected-room").addEventListener("click", () => {
      if (selectedRoomId) centerCameraOnRoom(selectedRoomId);
    });
    const backToConnBtn = document.getElementById("btn-back-to-connection");
    if (backToConnBtn) {
      backToConnBtn.addEventListener("click", () => {
        if (navigatedFromConnectionId) {
          const connId = navigatedFromConnectionId;
          navigatedFromConnectionId = null;
          selectConnection(connId);
        }
      });
    }

    document.getElementById("edit-room-name").addEventListener("input", (e) => {
      const room = getRoomById(selectedRoomId);
      if (!room) return;
      room.name = e.target.value || "Unnamed Room";
      saveStateToLocal();
      renderMainMap();
      renderLeftSidebar();
    });

    document.getElementById("edit-room-desc").addEventListener("input", (e) => {
      const room = getRoomById(selectedRoomId);
      if (!room) return;
      room.description = e.target.value;
      saveStateToLocal();
      renderMainMap();
      renderLeftSidebar();
    });

    const addTagToSelectedRoom = () => {
      const room = getRoomById(selectedRoomId);
      const input = document.getElementById("edit-room-tags-input");
      if (!room || !input.value.trim()) return;
      pushUndoSnapshot();
      const newTags = input.value
        .split(",")
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean);
      room.tags = room.tags || [];
      for (const t of newTags) {
        if (!room.tags.includes(t)) room.tags.push(t);
      }
      input.value = "";
      saveStateToLocal();
      renderAll();
    };

    document.getElementById("btn-edit-add-tag").addEventListener("click", addTagToSelectedRoom);
    document.getElementById("edit-room-tags-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTagToSelectedRoom();
      }
    });

    // Hex Color Input & Color Wheel in Room Inspector
    const applyHexToSelectedRoom = (rawColor) => {
      const room = getRoomById(selectedRoomId);
      if (!room) return;
      const norm = normalizeRoomColor(rawColor);
      if (!norm) {
        showToast("Enter a valid hex color like #38bdf8, or 'rainbow'");
        return;
      }
      if (room.color !== norm) {
        pushUndoSnapshot();
        room.color = norm;
        saveStateToLocal();
      }
      renderAll();
    };

    document.getElementById("edit-room-color-picker").addEventListener("input", (e) => {
      applyHexToSelectedRoom(e.target.value);
    });
    document.getElementById("btn-edit-apply-hex").addEventListener("click", () => {
      applyHexToSelectedRoom(document.getElementById("edit-room-hex-input").value);
    });
    document.getElementById("edit-room-hex-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyHexToSelectedRoom(e.target.value);
      }
    });

    // Hex Color Input & Color Wheel in Add Room Modal
    const applyHexToNewRoomModal = (rawColor) => {
      const norm = normalizeRoomColor(rawColor);
      if (!norm) {
        showToast("Enter a valid hex color like #38bdf8, or 'rainbow'");
        return;
      }
      newRoomColor = norm;
      const newColorPicker = document.getElementById("new-room-color-picker");
      if (newColorPicker && norm !== RAINBOW_COLOR) newColorPicker.value = norm;
      const newHexInput = document.getElementById("new-room-hex-input");
      if (newHexInput) newHexInput.value = norm;

      const swatchContainer = document.getElementById("new-room-colors");
      if (swatchContainer) {
        swatchContainer.innerHTML = "";
        for (const c of getAvailableRoomColors(norm)) {
          const btn = document.createElement("button");
          btn.type = "button";
          const isRainbow = c === RAINBOW_COLOR;
          btn.className = "color-swatch" + (norm === c ? " active" : "") + (isRainbow ? " rainbow" : "");
          if (!isRainbow) {
            btn.style.background = c;
          }
          btn.title = isRainbow ? "Rainbow" : c;
          btn.addEventListener("click", () => {
            applyHexToNewRoomModal(c);
          });
          swatchContainer.appendChild(btn);
        }
      }
    };

    document.getElementById("new-room-color-picker").addEventListener("input", (e) => {
      applyHexToNewRoomModal(e.target.value);
    });
    document.getElementById("btn-new-apply-hex").addEventListener("click", () => {
      applyHexToNewRoomModal(document.getElementById("new-room-hex-input").value);
    });
    document.getElementById("new-room-hex-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyHexToNewRoomModal(e.target.value);
      }
    });

    document.getElementById("btn-branch-new-room").addEventListener("click", () => {
      if (selectedRoomId) openAddRoomModal({ branchFromRoomId: selectedRoomId });
    });

    document.getElementById("btn-connect-from-here").addEventListener("click", () => {
      if (selectedRoomId) openAddConnectionModal(selectedRoomId);
    });

    document.getElementById("btn-delete-room").addEventListener("click", () => {
      if (!selectedRoomId) return;
      const room = getRoomById(selectedRoomId);
      if (!room) return;
      pushUndoSnapshot();
      appState.rooms = appState.rooms.filter((r) => r.id !== selectedRoomId);
      appState.connections = appState.connections.filter(
        (c) => c.fromRoomId !== selectedRoomId && c.toRoomId !== selectedRoomId
      );
      delete appState.mapDisplayConfig.positions[selectedRoomId];
      selectedRoomId = null;
      saveStateToLocal();
      renderAll();
      showToast(`Deleted room "${room.name}"`);
    });

    // Right Sidebar Connection Inspector Events
    document.getElementById("btn-close-conn-inspector").addEventListener("click", clearSelection);

    document.getElementById("btn-reverse-conn-dir").addEventListener("click", () => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      pushUndoSnapshot();
      const tmpId = conn.fromRoomId;
      conn.fromRoomId = conn.toRoomId;
      conn.toRoomId = tmpId;
      const tmpLbl = conn.label;
      conn.label = conn.reverseLabel || "";
      conn.reverseLabel = tmpLbl || "";
      saveStateToLocal();
      renderAll();
    });

    document.getElementById("edit-conn-twoway").addEventListener("click", () => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      pushUndoSnapshot();
      conn.bidirectional = true;
      saveStateToLocal();
      renderAll();
    });

    document.getElementById("edit-conn-oneway").addEventListener("click", () => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      pushUndoSnapshot();
      conn.bidirectional = false;
      saveStateToLocal();
      renderAll();
    });

    document.getElementById("edit-conn-style-normal").addEventListener("click", () => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      pushUndoSnapshot();
      conn.style = "normal";
      saveStateToLocal();
      renderAll();
    });

    document.getElementById("edit-conn-style-warp").addEventListener("click", () => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      pushUndoSnapshot();
      conn.style = "warp";
      saveStateToLocal();
      renderAll();
    });

    document.getElementById("edit-conn-label").addEventListener("input", (e) => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      conn.label = e.target.value;
      saveStateToLocal();
      renderMainMap();
    });

    document.getElementById("edit-conn-reverse-label").addEventListener("input", (e) => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      conn.reverseLabel = e.target.value;
      saveStateToLocal();
      renderMainMap();
    });

    document.getElementById("edit-conn-notes").addEventListener("input", (e) => {
      const conn = getConnectionById(selectedConnectionId);
      if (!conn) return;
      conn.notes = e.target.value;
      saveStateToLocal();
    });

    const isStandardPresetLabel = (val) => {
      if (!val) return true;
      const std = new Set([
        "north",
        "south",
        "east",
        "west",
        "northeast",
        "northwest",
        "southeast",
        "southwest",
        "up",
        "down",
        "warp",
        "portal",
      ]);
      return std.has(val.trim().toLowerCase());
    };

    // Preset chips in Connection Inspector
    document
      .querySelectorAll('[data-target="edit-conn-label"] .chip-btn')
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const conn = getConnectionById(selectedConnectionId);
          if (!conn) return;
          pushUndoSnapshot();
          conn.label = btn.getAttribute("data-val") || "";
          if (conn.bidirectional && isStandardPresetLabel(conn.reverseLabel)) {
            conn.reverseLabel = btn.getAttribute("data-rev") || "";
          }
          if (conn.label === "Warp") conn.style = "warp";
          saveStateToLocal();
          renderAll();
        });
      });

    document.getElementById("btn-delete-connection").addEventListener("click", () => {
      if (!selectedConnectionId) return;
      pushUndoSnapshot();
      appState.connections = appState.connections.filter(
        (c) => c.id !== selectedConnectionId
      );
      selectedConnectionId = null;
      saveStateToLocal();
      renderAll();
      showToast("Deleted connection");
    });

    // Modal 1: Add Room Form Submission
    document.getElementById("btn-close-add-room").addEventListener("click", closeAddRoomModal);
    document.getElementById("btn-cancel-add-room").addEventListener("click", closeAddRoomModal);
    document.getElementById("btn-cancel-branch").addEventListener("click", () => {
      branchSourceRoomId = null;
      document.getElementById("branch-from-banner").classList.add("hidden");
      document.getElementById("branch-connection-fields").classList.add("hidden");
    });

    document.querySelectorAll("#branch-preset-chips .chip-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("branch-exit-label").value =
          btn.getAttribute("data-val") || "";
        const revInput = document.getElementById("branch-return-label");
        if (isStandardPresetLabel(revInput.value)) {
          revInput.value = btn.getAttribute("data-rev") || "";
        }
      });
    });

    document.getElementById("new-room-tags").addEventListener("input", () => {
      updateNewRoomTagHighlights();
    });

    document.getElementById("form-add-room").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("new-room-name").value.trim();
      if (!name) return;

      const tagsRaw = document.getElementById("new-room-tags").value;
      const tags = tagsRaw
        .split(",")
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean);
      const description = document.getElementById("new-room-desc").value.trim();

      pushUndoSnapshot();

      const newRoom = {
        id: generateId("r"),
        name,
        description,
        tags,
        color: newRoomColor,
      };

      // Compute smart non-overlapping coordinates (Priority 1)
      let targetX = 0;
      let targetY = 0;
      const exitLabel = document.getElementById("branch-exit-label").value.trim();
      const returnLabel = document.getElementById("branch-return-label").value.trim();

      if (pendingSpawnCoords) {
        targetX = pendingSpawnCoords.x;
        targetY = pendingSpawnCoords.y;
      } else if (branchSourceRoomId && getRoomById(branchSourceRoomId)) {
        const srcPos = getRoomPos(branchSourceRoomId);
        const offset = getDirectionalOffsetFromLabel(exitLabel, returnLabel);
        targetX = srcPos.x + offset.dx;
        targetY = srcPos.y + offset.dy;
      } else if (appState.rooms.length > 0) {
        const lastRoom = appState.rooms[appState.rooms.length - 1];
        const lastPos = getRoomPos(lastRoom.id);
        targetX = lastPos.x + 250;
        targetY = lastPos.y;
      }

      const freePos = findNearestFreePosition(targetX, targetY, newRoom.id);
      appState.rooms.push(newRoom);
      setRoomPos(newRoom.id, freePos.x, freePos.y);

      // If branching from an existing room, also create the connection
      if (branchSourceRoomId && getRoomById(branchSourceRoomId)) {
        const isTwoWay = document.getElementById("branch-is-twoway").checked;
        const isWarp = document.getElementById("branch-is-warp").checked;

        appState.connections.push({
          id: generateId("c"),
          fromRoomId: branchSourceRoomId,
          toRoomId: newRoom.id,
          bidirectional: isTwoWay,
          style: isWarp ? "warp" : "normal",
          label: exitLabel,
          reverseLabel: isTwoWay ? returnLabel : "",
          notes: "",
        });
      }

      closeAddRoomModal();
      selectRoom(newRoom.id);
      centerCameraOnRoom(newRoom.id);
      saveStateToLocal();
      renderAll();
      showToast(`Added room "${newRoom.name}"`);
    });

    // Modal 2: Add Connection Events (Priority 3)
    document.getElementById("btn-close-add-conn").addEventListener("click", closeAddConnectionModal);
    document.getElementById("btn-cancel-add-conn").addEventListener("click", closeAddConnectionModal);

    document.getElementById("slot-from").addEventListener("click", () => {
      connModalState.activeSlot = "from";
      renderConnectionModalUI();
    });
    document.getElementById("slot-to").addEventListener("click", () => {
      connModalState.activeSlot = "to";
      renderConnectionModalUI();
    });
    document.getElementById("btn-swap-conn-slots").addEventListener("click", () => {
      const tmp = connModalState.fromRoomId;
      connModalState.fromRoomId = connModalState.toRoomId;
      connModalState.toRoomId = tmp;
      renderConnectionModalUI();
    });

    document.getElementById("new-conn-twoway").addEventListener("click", () => {
      connModalState.bidirectional = true;
      renderConnectionModalUI();
    });
    document.getElementById("new-conn-oneway").addEventListener("click", () => {
      connModalState.bidirectional = false;
      renderConnectionModalUI();
    });

    document.getElementById("new-conn-style-normal").addEventListener("click", () => {
      connModalState.style = "normal";
      renderConnectionModalUI();
    });
    document.getElementById("new-conn-style-warp").addEventListener("click", () => {
      connModalState.style = "warp";
      renderConnectionModalUI();
    });

    document.querySelectorAll("#new-conn-presets .chip-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const val = btn.getAttribute("data-val") || "";
        const rev = btn.getAttribute("data-rev") || "";
        document.getElementById("new-conn-label").value = val;
        const revInput = document.getElementById("new-conn-reverse-label");
        if (isStandardPresetLabel(revInput.value)) revInput.value = rev;
        if (val === "Warp" || val === "Portal") {
          connModalState.style = "warp";
          renderConnectionModalUI();
        }
      });
    });

    document.getElementById("tab-picker-map").addEventListener("click", () => {
      connModalState.pickerMode = "map";
      renderConnectionModalUI();
    });
    document.getElementById("tab-picker-list").addEventListener("click", () => {
      connModalState.pickerMode = "list";
      renderConnectionModalUI();
    });

    document.getElementById("conn-picker-search").addEventListener("input", (e) => {
      connModalState.searchFilter = e.target.value;
      renderConnectionModalUI();
    });

    document.getElementById("btn-nested-fit").addEventListener("click", () => {
      fitMapViewport(nestedSvg, connModalState.nestedViewport);
      renderConnectionModalUI();
    });

    document.getElementById("form-add-connection").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!connModalState.fromRoomId || !connModalState.toRoomId) {
        document.getElementById("conn-validation-msg").textContent =
          "Please select both a 'From Room' and a 'To Room' using the nested map or list.";
        return;
      }

      pushUndoSnapshot();
      const newConn = {
        id: generateId("c"),
        fromRoomId: connModalState.fromRoomId,
        toRoomId: connModalState.toRoomId,
        bidirectional: connModalState.bidirectional,
        style: connModalState.style,
        label: document.getElementById("new-conn-label").value.trim(),
        reverseLabel: connModalState.bidirectional
          ? document.getElementById("new-conn-reverse-label").value.trim()
          : "",
        notes: document.getElementById("new-conn-notes").value.trim(),
      };

      appState.connections.push(newConn);
      closeAddConnectionModal();
      selectRoom(newConn.fromRoomId);
      saveStateToLocal();
      renderAll();
      showToast("Added connection");
    });

    // Modal 3: Backups Manager Events (Priority 5)
    document.getElementById("btn-backups").addEventListener("click", openBackupsModal);
    document.getElementById("btn-close-backups").addEventListener("click", () => {
      document.getElementById("modal-backups").classList.add("hidden");
    });
    document.getElementById("btn-create-checkpoint").addEventListener("click", () => {
      const input = document.getElementById("manual-backup-label");
      const label = input.value.trim() || "Manual Checkpoint";
      createBackupSnapshot(label, false);
      input.value = "";
      renderBackupsModalList();
      showToast(`Saved backup checkpoint: "${label}"`);
    });

    // Global Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      const activeTag = document.activeElement?.tagName;
      const isTyping =
        activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";

      if (e.key === "Escape") {
        closeAddRoomModal();
        closeAddConnectionModal();
        closeMobileSearchDialog();
        document.getElementById("modal-backups").classList.add("hidden");
        if (!isTyping) clearSelection();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (!isTyping) {
          e.preventDefault();
          performUndo();
        }
        return;
      }

      if (isTyping) return;

      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        openAddRoomModal({ branchFromRoomId: selectedRoomId });
      } else if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        openAddConnectionModal(selectedRoomId);
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleMultiSelectMode();
      } else if (e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f")) {
        e.preventDefault();
        document.getElementById("search-input").focus();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        fitMapViewport(mainSvg, appState.mapDisplayConfig.viewport);
        renderMainMap();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedRoomId) {
          document.getElementById("btn-delete-room").click();
        } else if (selectedConnectionId) {
          document.getElementById("btn-delete-connection").click();
        }
      }
    });
  }

  // ==================== BOOTSTRAP ====================
  async function init() {
    let hadExistingSavedMap = false;
    try {
      const savedRaw = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (savedRaw) {
        appState = validateAndNormalizeState(JSON.parse(savedRaw));
        hadExistingSavedMap = appState.rooms.length > 0;
      } else {
        appState = createDemoMapState();
        saveStateToLocal(false);
        createBackupSnapshot("Initial Demo Map", true);
      }
    } catch (e) {
      console.warn("Could not load saved state, starting with demo map:", e);
      appState = createDemoMapState();
    }

    bindEvents();

    // Check if URL has a ?save=... parameter to auto-load
    const urlParams = new URLSearchParams(window.location.search);
    const saveParam = urlParams.get("save");
    if (saveParam) {
      try {
        const sharedState = await decodeStateFromSaveParam(saveParam);
        if (hadExistingSavedMap) {
          pushUndoSnapshot();
          createBackupSnapshot(`Before Shared Link (${appState.title || "Previous Map"})`, false);
        }
        appState = sharedState;
        saveStateToLocal(false);
        // Clean ?save=... from address bar so refreshing later doesn't overwrite subsequent edits
        if (window.history && window.history.replaceState) {
          urlParams.delete("save");
          const cleanQuery = urlParams.toString();
          const cleanUrl =
            window.location.pathname + (cleanQuery ? `?${cleanQuery}` : "") + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);
        }
        requestAnimationFrame(() => {
          renderAll();
          showToast(
            hadExistingSavedMap
              ? `Loaded shared map "${appState.title}" (Your previous map was saved to Backups!)`
              : `Loaded shared map "${appState.title}"`
          );
        });
        return;
      } catch (err) {
        console.error("Failed to decode ?save= URL parameter:", err);
        requestAnimationFrame(() => {
          showToast("Could not decode ?save= link; loaded local map instead.");
        });
      }
    }

    // Fit viewport nicely on initial load
    requestAnimationFrame(() => {
      const mainSvg = document.getElementById("map-svg");
      if (!hadExistingSavedMap) {
        fitMapViewport(mainSvg, appState.mapDisplayConfig.viewport);
      }
      renderAll();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
