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

  // ==================== APPLICATION STATE ====================
  let appState = createEmptyMapState();
  let undoStack = [];
  let selectedRoomId = null;
  let selectedConnectionId = null;

  // Search & Filter state (Priority 4)
  let searchQuery = "";
  let activeTagFilters = new Set();

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
   * Computes an ideal spawn position when branching from an existing room based on the exit label
   */
  function getDirectionalOffsetFromLabel(label = "") {
    const clean = label.trim().toLowerCase();
    if (clean === "n" || clean.startsWith("north") || clean === "up" || clean.includes("stairs up")) {
      return { dx: 0, dy: -165 };
    }
    if (clean === "s" || clean.startsWith("south") || clean === "down" || clean.includes("stairs down")) {
      return { dx: 0, dy: 165 };
    }
    if (clean === "e" || clean.startsWith("east") || clean === "right") {
      return { dx: 255, dy: 0 };
    }
    if (clean === "w" || clean.startsWith("west") || clean === "left") {
      return { dx: -255, dy: 0 };
    }
    if (clean.includes("northeast") || clean === "ne") return { dx: 230, dy: -150 };
    if (clean.includes("northwest") || clean === "nw") return { dx: -230, dy: -150 };
    if (clean.includes("southeast") || clean === "se") return { dx: 230, dy: 150 };
    if (clean.includes("southwest") || clean === "sw") return { dx: -230, dy: 150 };
    return { dx: 255, dy: 0 };
  }

  /**
   * Optional explicit Auto-Arrange (Spring/Force + Collision Cleanup)
   */
  function autoArrangeMap() {
    if (appState.rooms.length <= 1) return;
    pushUndoSnapshot();
    createBackupSnapshot("Before Auto-Arrange", true);

    const nodes = appState.rooms.map((r) => {
      const p = getRoomPos(r.id);
      return { id: r.id, x: p.x, y: p.y, vx: 0, vy: 0 };
    });
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const iterations = 90;
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all rooms
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            dx = (Math.random() - 0.5) * 10;
            dy = (Math.random() - 0.5) * 10;
          }
          const dist = Math.hypot(dx, dy) || 1;
          const minDist = 240;
          if (dist < minDist * 1.6) {
            const force = ((minDist * 1.6 - dist) / dist) * 0.16;
            a.vx -= dx * force;
            a.vy -= dy * force;
            b.vx += dx * force;
            b.vy += dy * force;
          }
        }
      }

      // Attraction along connections + cardinal bias
      for (const conn of appState.connections) {
        if (conn.fromRoomId === conn.toRoomId) continue;
        const a = nodeMap.get(conn.fromRoomId);
        const b = nodeMap.get(conn.toRoomId);
        if (!a || !b) continue;

        const dir = getDirectionalOffsetFromLabel(conn.label || "");
        const idealDx = dir.dx;
        const idealDy = dir.dy;

        const errX = (b.x - a.x) - idealDx;
        const errY = (b.y - a.y) - idealDy;

        a.vx += errX * 0.04;
        a.vy += errY * 0.04;
        b.vx -= errX * 0.04;
        b.vy -= errY * 0.04;
      }

      for (const n of nodes) {
        n.x += Math.max(-25, Math.min(25, n.vx));
        n.y += Math.max(-25, Math.min(25, n.vy));
        n.vx *= 0.5;
        n.vy *= 0.5;
      }
    }

    // Final non-overlapping placement pass
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
    showToast("Map rearranged (Press Ctrl+Z to undo)");
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
        fromLabelPos: { x: fromPos.x, y: ctrlY + 16 },
        toLabelPos: null,
      };
    }

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

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

    // Calculate points along Quadratic Bezier at t=0.28 (From label) and t=0.72 (To label)
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

    const hasReverse = conn.bidirectional && conn.reverseLabel && conn.reverseLabel.trim() !== "";
    return {
      pathD,
      fromLabelPos: hasReverse ? ptAt(0.28) : ptAt(0.5),
      toLabelPos: hasReverse ? ptAt(0.74) : null,
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
      return nameMatch || descMatch || tagMatch;
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

    // 1. Render Connections
    for (const conn of appState.connections) {
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
      const classes = ["conn-group"];
      if (!conn.bidirectional) classes.push("oneway");
      if (conn.style === "warp") classes.push("warp");
      if (isSelected) classes.push("selected");

      const g = createSvgEl("g", { class: classes.join(" "), "data-conn-id": conn.id });

      // Wide invisible hit path for easy clicking
      const hitPath = createSvgEl("path", {
        d: geom.pathD,
        class: "conn-hit-area",
      });

      const isWarp = conn.style === "warp";
      let markerEnd = "url(#arrow-twoway)";
      let markerStart = "";

      if (isSelected) {
        markerEnd = "url(#arrow-selected)";
        if (conn.bidirectional) markerStart = "url(#arrow-selected)";
      } else if (!conn.bidirectional) {
        markerEnd = isWarp ? "url(#arrow-oneway-warp)" : "url(#arrow-oneway)";
      } else {
        markerEnd = isWarp ? "url(#arrow-twoway-warp)" : "url(#arrow-twoway)";
        markerStart = isWarp ? "url(#arrow-twoway-warp)" : "url(#arrow-twoway)";
      }

      const pathAttrs = {
        d: geom.pathD,
        class: "conn-path",
        "marker-end": markerEnd,
      };
      if (markerStart && conn.fromRoomId !== conn.toRoomId) {
        pathAttrs["marker-start"] = markerStart;
      }

      const visiblePath = createSvgEl("path", pathAttrs);
      g.appendChild(hitPath);
      g.appendChild(visiblePath);

      // Render Exit Label(s)
      if (conn.label && geom.fromLabelPos) {
        const prefix = !conn.bidirectional ? "→ " : "";
        renderSvgLabelBadge(g, geom.fromLabelPos.x, geom.fromLabelPos.y, prefix + conn.label);
      }
      if (conn.bidirectional && conn.reverseLabel && geom.toLabelPos) {
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

      const accentBar = createSvgEl("rect", {
        x: 0,
        y: 0,
        width: 6,
        height: NODE_H,
        fill: room.color || ROOM_COLORS[0],
        class: "room-accent-bar",
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

      // Quick "+ Branch Room" button on main map node
      if (!isNestedPicker) {
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
  function attachRoomDragAndSelect(nodeEl, roomId) {
    let isDragging = false;
    let hasMoved = false;
    let startClientX = 0;
    let startClientY = 0;
    let initialRoomX = 0;
    let initialRoomY = 0;

    nodeEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      isDragging = true;
      hasMoved = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      const pos = getRoomPos(roomId);
      initialRoomX = pos.x;
      initialRoomY = pos.y;
      pushUndoSnapshot();
    });

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dxScreen = e.clientX - startClientX;
      const dyScreen = e.clientY - startClientY;
      if (Math.hypot(dxScreen, dyScreen) > 4) {
        hasMoved = true;
      }
      if (!hasMoved) return;

      const zoom = appState.mapDisplayConfig.viewport.zoom || 1;
      const newX = initialRoomX + dxScreen / zoom;
      const newY = initialRoomY + dyScreen / zoom;
      setRoomPos(roomId, newX, newY);
      renderMainMap();
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;

      if (!hasMoved) {
        // Undo snapshot wasn't needed since room didn't move
        undoStack.pop();
        updateUndoButton();
        selectRoom(roomId);
        return;
      }

      // Check if dropped room directly collides with another room; if so, nudge the other room or this room
      const droppedPos = getRoomPos(roomId);
      const overlapping = findOverlappingRoom(droppedPos.x, droppedPos.y, roomId);
      if (overlapping) {
        const free = findNearestFreePosition(droppedPos.x, droppedPos.y, roomId);
        setRoomPos(roomId, free.x, free.y);
        showToast("Nudged room slightly to avoid overlap");
      }

      saveStateToLocal();
      renderMainMap();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function setupPanAndZoom(svgEl, getViewport, onUpdate) {
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let startPanX = 0;
    let startPanY = 0;

    svgEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      isPanning = true;
      svgEl.classList.add("panning");
      const vp = getViewport();
      panStartX = e.clientX;
      panStartY = e.clientY;
      startPanX = vp.panX;
      startPanY = vp.panY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      const vp = getViewport();
      vp.panX = Math.round(startPanX + (e.clientX - panStartX));
      vp.panY = Math.round(startPanY + (e.clientY - panStartY));
      onUpdate(false);
    });

    window.addEventListener("mouseup", () => {
      if (!isPanning) return;
      isPanning = false;
      svgEl.classList.remove("panning");
      onUpdate(true);
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

    // Filter rooms for list
    const resultsEl = document.getElementById("room-search-results");
    if (!resultsEl) return;

    const matchingRooms = appState.rooms.filter((r) =>
      doesRoomMatchSearchAndFilter(r, searchQuery, activeTagFilters)
    );

    if (matchingRooms.length === 0) {
      resultsEl.innerHTML = `<div class="muted-hint" style="padding: 12px 6px;">${
        appState.rooms.length === 0
          ? "No rooms created yet."
          : "No rooms match your search or tag filter."
      }</div>`;
      return;
    }

    resultsEl.innerHTML = "";
    for (const room of matchingRooms) {
      const item = document.createElement("div");
      item.className = "room-list-item" + (selectedRoomId === room.id ? " selected" : "");
      item.innerHTML = `
        <div class="room-item-top">
          <span class="room-color-dot" style="background: ${room.color || ROOM_COLORS[0]}"></span>
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
      item.addEventListener("click", () => {
        selectRoom(room.id);
        centerCameraOnRoom(room.id);
      });
      resultsEl.appendChild(item);
    }
  }

  function renderInspector() {
    const emptyEl = document.getElementById("inspector-empty");
    const roomEl = document.getElementById("inspector-room");
    const connEl = document.getElementById("inspector-connection");

    const selectedRoom = selectedRoomId ? getRoomById(selectedRoomId) : null;
    const selectedConn = selectedConnectionId ? getConnectionById(selectedConnectionId) : null;

    emptyEl.classList.toggle("hidden", Boolean(selectedRoom || selectedConn));
    roomEl.classList.toggle("hidden", !selectedRoom);
    connEl.classList.toggle("hidden", !selectedConn);

    if (selectedRoom) {
      const nameInput = document.getElementById("edit-room-name");
      if (document.activeElement !== nameInput) {
        nameInput.value = selectedRoom.name;
      }
      const descInput = document.getElementById("edit-room-desc");
      if (document.activeElement !== descInput) {
        descInput.value = selectedRoom.description || "";
      }

      // Color swatches
      const colorsWrap = document.getElementById("edit-room-colors");
      colorsWrap.innerHTML = "";
      for (const c of ROOM_COLORS) {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "color-swatch" + (selectedRoom.color === c ? " active" : "");
        sw.style.background = c;
        sw.addEventListener("click", () => {
          pushUndoSnapshot();
          selectedRoom.color = c;
          saveStateToLocal();
          renderAll();
        });
        colorsWrap.appendChild(sw);
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
      fromBtn.textContent = fromRoom ? fromRoom.name : "Unknown";
      fromBtn.onclick = () => {
        if (fromRoom) {
          selectRoom(fromRoom.id);
          centerCameraOnRoom(fromRoom.id);
        }
      };

      const toBtn = document.getElementById("conn-inspect-to-btn");
      toBtn.textContent = toRoom ? toRoom.name : "Unknown";
      toBtn.onclick = () => {
        if (toRoom) {
          selectRoom(toRoom.id);
          centerCameraOnRoom(toRoom.id);
        }
      };

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

  function selectRoom(roomId) {
    selectedRoomId = roomId;
    selectedConnectionId = null;
    renderAll();
  }

  function selectConnection(connId) {
    selectedConnectionId = connId;
    selectedRoomId = null;
    renderAll();
  }

  function clearSelection() {
    selectedRoomId = null;
    selectedConnectionId = null;
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

    // Render color swatches
    const swatchContainer = document.getElementById("new-room-colors");
    swatchContainer.innerHTML = "";
    for (const c of ROOM_COLORS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-swatch" + (newRoomColor === c ? " active" : "");
      btn.style.background = c;
      btn.addEventListener("click", () => {
        newRoomColor = c;
        swatchContainer
          .querySelectorAll(".color-swatch")
          .forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
      });
      swatchContainer.appendChild(btn);
    }

    // Existing tag suggestions
    const existingTagsWrap = document.getElementById("new-room-existing-tags");
    const allTags = new Set();
    appState.rooms.forEach((r) => (r.tags || []).forEach((t) => allTags.add(t)));
    existingTagsWrap.innerHTML = "";
    for (const t of Array.from(allTags).sort()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip-btn";
      chip.textContent = `+ #${t}`;
      chip.addEventListener("click", () => {
        const input = document.getElementById("new-room-tags");
        const cur = input.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!cur.includes(t)) {
          cur.push(t);
          input.value = cur.join(", ");
        }
      });
      existingTagsWrap.appendChild(chip);
    }

    setTimeout(() => document.getElementById("new-room-name").focus(), 30);
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
            <span class="room-color-dot" style="background: ${room.color || ROOM_COLORS[0]}"></span>
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

  // ==================== YAML & JSON EXPORT / IMPORT (Priority 5) ====================
  function serializeToYaml(state) {
    const q = (str) => JSON.stringify(String(str ?? ""));
    const lines = [];
    lines.push(`# Non-Euclidean Game Mapper Save File`);
    lines.push(`version: ${state.version || 1}`);
    lines.push(`title: ${q(state.title || "Untitled Map")}`);
    lines.push(`updatedAt: ${q(state.updatedAt || new Date().toISOString())}`);

    lines.push(`rooms:`);
    if (!state.rooms || state.rooms.length === 0) {
      lines.push(`  []`);
    } else {
      for (const r of state.rooms) {
        lines.push(`  - id: ${q(r.id)}`);
        lines.push(`    name: ${q(r.name)}`);
        lines.push(`    color: ${q(r.color || "#0ea5e9")}`);
        lines.push(`    description: ${q(r.description || "")}`);
        const tagsStr = (r.tags || []).map((t) => q(t)).join(", ");
        lines.push(`    tags: [${tagsStr}]`);
      }
    }

    lines.push(`connections:`);
    if (!state.connections || state.connections.length === 0) {
      lines.push(`  []`);
    } else {
      for (const c of state.connections) {
        lines.push(`  - id: ${q(c.id)}`);
        lines.push(`    fromRoomId: ${q(c.fromRoomId)}`);
        lines.push(`    toRoomId: ${q(c.toRoomId)}`);
        lines.push(`    bidirectional: ${Boolean(c.bidirectional)}`);
        lines.push(`    style: ${q(c.style || "normal")}`);
        lines.push(`    label: ${q(c.label || "")}`);
        lines.push(`    reverseLabel: ${q(c.reverseLabel || "")}`);
        lines.push(`    notes: ${q(c.notes || "")}`);
      }
    }

    lines.push(`mapDisplayConfig:`);
    const vp = state.mapDisplayConfig?.viewport || { panX: 480, panY: 320, zoom: 1 };
    lines.push(`  viewport:`);
    lines.push(`    panX: ${Math.round(vp.panX)}`);
    lines.push(`    panY: ${Math.round(vp.panY)}`);
    lines.push(`    zoom: ${vp.zoom}`);
    lines.push(`  positions:`);
    const posEntries = Object.entries(state.mapDisplayConfig?.positions || {});
    if (posEntries.length === 0) {
      lines.push(`    {}`);
    } else {
      for (const [roomId, pos] of posEntries) {
        lines.push(`    ${q(roomId)}: { x: ${Math.round(pos.x)}, y: ${Math.round(pos.y)} }`);
      }
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Parses either JSON or our structured YAML save format back into a valid map state object
   */
  function parseImportedFileContent(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      return validateAndNormalizeState(JSON.parse(trimmed));
    }

    // Parse YAML save format
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

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim() || line.trim().startsWith("#")) continue;

      if (line.startsWith("title:")) {
        result.title = unquote(line.slice(6));
      } else if (line.startsWith("version:")) {
        result.version = Number(line.slice(8).trim()) || 1;
      } else if (line.startsWith("updatedAt:")) {
        result.updatedAt = unquote(line.slice(10));
      } else if (line.startsWith("rooms:")) {
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
        if (trimmedLine.startsWith("- ")) {
          currentItem = {};
          if (section === "rooms") result.rooms.push(currentItem);
          else result.connections.push(currentItem);
          const kv = trimmedLine.slice(2);
          assignYamlKeyVal(currentItem, kv, unquote);
        } else if (currentItem) {
          assignYamlKeyVal(currentItem, trimmedLine, unquote);
        }
      } else if (section === "mapDisplayConfig") {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("viewport:")) {
          subSection = "viewport";
        } else if (trimmedLine.startsWith("positions:")) {
          subSection = "positions";
        } else if (subSection === "viewport") {
          const [k, v] = trimmedLine.split(":").map((s) => s.trim());
          if (k && v !== undefined) {
            result.mapDisplayConfig.viewport[k] = Number(v);
          }
        } else if (subSection === "positions") {
          if (trimmedLine === "{}") continue;
          const match = trimmedLine.match(/^(.+?):\s*\{\s*x:\s*(-?\d+(?:\.\d+)?),\s*y:\s*(-?\d+(?:\.\d+)?)\s*\}$/);
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

  function assignYamlKeyVal(obj, kvString, unquote) {
    const idx = kvString.indexOf(":");
    if (idx === -1) return;
    const key = kvString.slice(0, idx).trim();
    const rawVal = kvString.slice(idx + 1).trim();

    if (key === "tags") {
      if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        try {
          obj.tags = JSON.parse(rawVal);
          return;
        } catch (e) {
          const inner = rawVal.slice(1, -1).trim();
          obj.tags = inner ? inner.split(",").map((s) => unquote(s)) : [];
          return;
        }
      }
      obj.tags = [];
    } else if (key === "bidirectional") {
      obj.bidirectional = rawVal === "true";
    } else {
      obj[key] = unquote(rawVal);
    }
  }

  function validateAndNormalizeState(data) {
    if (!data || !Array.isArray(data.rooms) || !Array.isArray(data.connections)) {
      throw new Error("Invalid map file structure: missing rooms or connections array.");
    }
    const clean = createEmptyMapState(data.title || "Imported Map");
    clean.rooms = data.rooms.map((r) => ({
      id: String(r.id || generateId("r")),
      name: String(r.name || "Unnamed Room"),
      description: String(r.description || ""),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      color: r.color || ROOM_COLORS[0],
    }));
    clean.connections = data.connections.map((c) => ({
      id: String(c.id || generateId("c")),
      fromRoomId: String(c.fromRoomId),
      toRoomId: String(c.toRoomId),
      bidirectional: c.bidirectional !== false,
      style: c.style === "warp" ? "warp" : "normal",
      label: String(c.label || ""),
      reverseLabel: String(c.reverseLabel || ""),
      notes: String(c.notes || ""),
    }));
    if (data.mapDisplayConfig?.viewport) {
      clean.mapDisplayConfig.viewport = {
        panX: Number(data.mapDisplayConfig.viewport.panX) || 480,
        panY: Number(data.mapDisplayConfig.viewport.panY) || 320,
        zoom: Number(data.mapDisplayConfig.viewport.zoom) || 1,
      };
    }
    if (data.mapDisplayConfig?.positions) {
      clean.mapDisplayConfig.positions = { ...data.mapDisplayConfig.positions };
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
        clearSelection();
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

    // File Menu Dropdown
    const fileBtn = document.getElementById("btn-file-menu");
    const fileMenu = document.getElementById("file-dropdown-menu");
    fileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileMenu.classList.toggle("hidden");
    });
    window.addEventListener("click", () => fileMenu.classList.add("hidden"));

    document.getElementById("menu-export-yaml").addEventListener("click", () => {
      const yaml = serializeToYaml(appState);
      downloadFile(`${slugifyTitle(appState.title)}.yaml`, yaml, "text/yaml");
      showToast("Saved map as YAML (.yaml)");
    });

    document.getElementById("menu-export-json").addEventListener("click", () => {
      const json = JSON.stringify(appState, null, 2);
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

    // Preset chips in Connection Inspector
    document
      .querySelectorAll('[data-target="edit-conn-label"] .chip-btn')
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const conn = getConnectionById(selectedConnectionId);
          if (!conn) return;
          pushUndoSnapshot();
          conn.label = btn.getAttribute("data-val") || "";
          if (conn.bidirectional && !conn.reverseLabel) {
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
        if (!revInput.value) {
          revInput.value = btn.getAttribute("data-rev") || "";
        }
      });
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

      if (pendingSpawnCoords) {
        targetX = pendingSpawnCoords.x;
        targetY = pendingSpawnCoords.y;
      } else if (branchSourceRoomId && getRoomById(branchSourceRoomId)) {
        const srcPos = getRoomPos(branchSourceRoomId);
        const offset = getDirectionalOffsetFromLabel(exitLabel);
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
        const returnLabel = document.getElementById("branch-return-label").value.trim();

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
        if (!revInput.value) revInput.value = rev;
        if (val === "Portal") {
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
      selectConnection(newConn.id);
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
  function init() {
    try {
      const savedRaw = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (savedRaw) {
        appState = validateAndNormalizeState(JSON.parse(savedRaw));
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

    // Fit viewport nicely on initial load
    requestAnimationFrame(() => {
      const mainSvg = document.getElementById("map-svg");
      if (!localStorage.getItem(STORAGE_KEY_CURRENT)) {
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
