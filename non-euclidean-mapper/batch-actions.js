/**
 * Non-Euclidean Game Mapper — Multi-Select Batch Actions Module
 * Provides batch operations for selected room groups:
 * 1. Batch Tag Management (inspect common/partial tags, batch add tags, batch remove tag)
 * 2. Batch Rotation around Center of Gravity & Internal Cardinal/Ordinal Connection Direction Rotation (N * 45°)
 * 3. Batch Color Accent Assignment
 */
(function (global) {
  "use strict";

  // 8-point compass in clockwise order starting at North (0 = N, 1 = NE, 2 = E, 3 = SE, 4 = S, 5 = SW, 6 = W, 7 = NW)
  const COMPASS_FULL_TITLE = [
    "North",
    "Northeast",
    "East",
    "Southeast",
    "South",
    "Southwest",
    "West",
    "Northwest",
  ];

  const COMPASS_SHORT_UPPER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  const COMPASS_HYPHEN_TITLE = [
    "North",
    "North-East",
    "East",
    "South-East",
    "South",
    "South-West",
    "West",
    "North-West",
  ];

  // Lookup map from normalized lowercase token -> { index (0..7), format: "short" | "full" | "hyphen" }
  const DIRECTION_TOKEN_MAP = new Map([
    ["n", { index: 0, format: "short" }],
    ["ne", { index: 1, format: "short" }],
    ["e", { index: 2, format: "short" }],
    ["se", { index: 3, format: "short" }],
    ["s", { index: 4, format: "short" }],
    ["sw", { index: 5, format: "short" }],
    ["w", { index: 6, format: "short" }],
    ["nw", { index: 7, format: "short" }],
    ["north", { index: 0, format: "full" }],
    ["northeast", { index: 1, format: "full" }],
    ["east", { index: 2, format: "full" }],
    ["southeast", { index: 3, format: "full" }],
    ["south", { index: 4, format: "full" }],
    ["southwest", { index: 5, format: "full" }],
    ["west", { index: 6, format: "full" }],
    ["northwest", { index: 7, format: "full" }],
    ["north-east", { index: 1, format: "hyphen" }],
    ["south-east", { index: 3, format: "hyphen" }],
    ["south-west", { index: 5, format: "hyphen" }],
    ["north-west", { index: 7, format: "hyphen" }],
  ]);

  /**
   * Formats a compass index (0..7) matching the style and casing of the original token.
   */
  function formatCompassToken(newIndex, format, originalToken) {
    const idx = ((newIndex % 8) + 8) % 8;
    if (format === "short") {
      const code = COMPASS_SHORT_UPPER[idx];
      return originalToken === originalToken.toLowerCase() ? code.toLowerCase() : code;
    }
    const baseWord = format === "hyphen" ? COMPASS_HYPHEN_TITLE[idx] : COMPASS_FULL_TITLE[idx];
    if (originalToken === originalToken.toUpperCase()) {
      return baseWord.toUpperCase();
    }
    if (originalToken === originalToken.toLowerCase()) {
      return baseWord.toLowerCase();
    }
    return baseWord;
  }

  /**
   * Rotates a single connection label by `steps * 45` degrees clockwise.
   * Handles pure cardinal/ordinal labels ("North", "NE", "nw", "South-West") as well as
   * prefixed door labels ("North Door", "SE Corridor"). Leaves non-directional labels ("Red Door", "Up", "Warp") unchanged.
   */
  function rotateDirectionLabel(label, steps) {
    if (!label || typeof label !== "string") return label;
    const normSteps = ((Math.round(steps) % 8) + 8) % 8;
    if (normSteps === 0) return label;

    const trimmed = label.trim();
    if (!trimmed) return label;

    // 1. Check exact match first
    const exactEntry = DIRECTION_TOKEN_MAP.get(trimmed.toLowerCase());
    if (exactEntry) {
      return formatCompassToken(exactEntry.index + normSteps, exactEntry.format, trimmed);
    }

    // 2. Check leading direction word followed by whitespace/punctuation (e.g. "North Door", "NE Stairs")
    const prefixMatch = trimmed.match(
      /^(north-east|south-east|south-west|north-west|northeast|northwest|southeast|southwest|north|south|east|west|ne|nw|se|sw|n|s|e|w)(\s+.*|[-:\/].*)$/i
    );
    if (prefixMatch) {
      const headToken = prefixMatch[1];
      const tailRest = prefixMatch[2];
      const headEntry = DIRECTION_TOKEN_MAP.get(headToken.toLowerCase());
      if (headEntry) {
        const rotatedHead = formatCompassToken(
          headEntry.index + normSteps,
          headEntry.format,
          headToken
        );
        return rotatedHead + tailRest;
      }
    }

    return label;
  }

  /**
   * Computes the center of gravity (centroid) of the selected rooms.
   */
  function computeCenterOfGravity(selectedRoomIds, getRoomPos) {
    const ids = Array.from(selectedRoomIds);
    if (ids.length === 0) return { x: 0, y: 0 };
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const id of ids) {
      const pos = getRoomPos(id);
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        sumX += pos.x;
        sumY += pos.y;
        count++;
      }
    }
    if (count === 0) return { x: 0, y: 0 };
    return {
      x: sumX / count,
      y: sumY / count,
    };
  }

  /**
   * Rotates selected rooms and/or their internal connections by `steps * 45` degrees clockwise.
   * @param {Object} params
   * @param {Array} params.rooms - appState.rooms
   * @param {Array} params.connections - appState.connections
   * @param {Set<string>} params.selectedRoomIds - multiSelectedRoomIds
   * @param {Function} params.getRoomPos - (roomId) => { x, y }
   * @param {Function} params.setRoomPos - (roomId, x, y) => void
   * @param {number} params.steps - integer multiple of 45 degrees clockwise (e.g. +1 = +45°, +2 = +90°, -1 = -45°, -2 = -90°, 4 = 180°)
   * @param {boolean} [params.rotatePositions=true] - whether to rotate node coordinates around their center of gravity
   * @param {boolean} [params.rotateDirections=true] - whether to rotate cardinal/ordinal labels on internal connections
   */
  function batchRotateSelection({
    connections,
    selectedRoomIds,
    getRoomPos,
    setRoomPos,
    steps,
    rotatePositions = true,
    rotateDirections = true,
  }) {
    const selectedSet =
      selectedRoomIds instanceof Set ? selectedRoomIds : new Set(selectedRoomIds);
    const count = selectedSet.size;
    if (count === 0 || !steps) {
      return { rotatedRooms: 0, rotatedConnections: 0, angleDeg: 0 };
    }

    const angleDeg = steps * 45;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    let rotatedRooms = 0;
    if (rotatePositions && count >= 2) {
      const center = computeCenterOfGravity(selectedSet, getRoomPos);
      for (const roomId of selectedSet) {
        const pos = getRoomPos(roomId);
        if (!pos) continue;
        const dx = pos.x - center.x;
        const dy = pos.y - center.y;
        const newX = Math.round(center.x + dx * cosA - dy * sinA);
        const newY = Math.round(center.y + dx * sinA + dy * cosA);
        setRoomPos(roomId, newX, newY);
        rotatedRooms++;
      }
    }

    let rotatedConnections = 0;
    if (rotateDirections && Array.isArray(connections)) {
      for (const conn of connections) {
        // Only connections internal to the selected group
        if (selectedSet.has(conn.fromRoomId) && selectedSet.has(conn.toRoomId)) {
          const oldLabel = conn.label || "";
          const oldRev = conn.reverseLabel || "";
          const newLabel = rotateDirectionLabel(oldLabel, steps);
          const newRev = rotateDirectionLabel(oldRev, steps);
          if (newLabel !== oldLabel || newRev !== oldRev) {
            conn.label = newLabel;
            conn.reverseLabel = newRev;
            rotatedConnections++;
          }
        }
      }
    }

    return {
      rotatedRooms,
      rotatedConnections,
      angleDeg,
    };
  }

  /**
   * Returns a summary of all tags present across the currently selected rooms.
   * Each entry is { tag, count, totalSelected, isAll }.
   */
  function getSelectedRoomsTagSummary(rooms, selectedRoomIds) {
    const selectedSet =
      selectedRoomIds instanceof Set ? selectedRoomIds : new Set(selectedRoomIds);
    const counts = new Map();
    let totalSelected = 0;

    for (const room of rooms || []) {
      if (!selectedSet.has(room.id)) continue;
      totalSelected++;
      for (const t of room.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([tag, count]) => ({
        tag,
        count,
        totalSelected,
        isAll: count === totalSelected && totalSelected > 0,
      }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /**
   * Adds one or more tags (from a comma-separated string or array) to all selected rooms.
   */
  function batchAddTagsToRooms(rooms, selectedRoomIds, rawTagsInput) {
    const selectedSet =
      selectedRoomIds instanceof Set ? selectedRoomIds : new Set(selectedRoomIds);
    const tagsToAdd = (
      Array.isArray(rawTagsInput) ? rawTagsInput : String(rawTagsInput || "").split(",")
    )
      .map((s) => String(s).trim().replace(/^#/, ""))
      .filter(Boolean);

    if (tagsToAdd.length === 0 || selectedSet.size === 0) {
      return { affectedRoomsCount: 0, tagsAdded: [] };
    }

    let affectedRoomsCount = 0;
    for (const room of rooms || []) {
      if (!selectedSet.has(room.id)) continue;
      room.tags = Array.isArray(room.tags) ? room.tags : [];
      let modified = false;
      for (const tag of tagsToAdd) {
        if (!room.tags.includes(tag)) {
          room.tags.push(tag);
          modified = true;
        }
      }
      if (modified) affectedRoomsCount++;
    }

    return {
      affectedRoomsCount,
      tagsAdded: tagsToAdd,
    };
  }

  /**
   * Removes a specific tag from all selected rooms that currently have it.
   */
  function batchRemoveTagFromRooms(rooms, selectedRoomIds, tagToRemove) {
    const selectedSet =
      selectedRoomIds instanceof Set ? selectedRoomIds : new Set(selectedRoomIds);
    const cleanTag = String(tagToRemove || "").trim().replace(/^#/, "");
    if (!cleanTag || selectedSet.size === 0) {
      return { affectedRoomsCount: 0 };
    }

    let affectedRoomsCount = 0;
    for (const room of rooms || []) {
      if (!selectedSet.has(room.id) || !Array.isArray(room.tags)) continue;
      const beforeLen = room.tags.length;
      room.tags = room.tags.filter((t) => t !== cleanTag);
      if (room.tags.length !== beforeLen) {
        affectedRoomsCount++;
      }
    }

    return { affectedRoomsCount, tagRemoved: cleanTag };
  }

  global.BatchActions = {
    rotateDirectionLabel,
    computeCenterOfGravity,
    batchRotateSelection,
    getSelectedRoomsTagSummary,
    batchAddTagsToRooms,
    batchRemoveTagFromRooms,
  };
})(window);
