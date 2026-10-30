/**
 * Non-Euclidean Game Mapper — Shortest Path Finder Module
 * Isolated class `PathFinder` that computes up to K shortest simple paths between two rooms
 * (respecting one-way vs. two-way connections and optionally excluding warp connections)
 * and tracks which chosen path is actively highlighted on the map canvas.
 */
(function (global) {
  "use strict";

  class PathFinder {
    constructor() {
      /**
       * Active highlighted path state:
       * null | {
       *   fromRoomId: string,
       *   toRoomId: string,
       *   optionIndex: number,
       *   roomIds: Set<string>,
       *   connectionIds: Set<string>,
       *   orderedRoomIds: string[],
       *   steps: Array<{ connectionId: string, fromRoomId: string, toRoomId: string, label: string, style: string, bidirectional: boolean }>
       * }
       */
      this.activePath = null;
    }

    /**
     * Builds outgoing adjacency list for each room.
     * - Two-way connection (`bidirectional !== false`): traversable both `from -> to` (using `label`)
     *   and `to -> from` (using `reverseLabel || label`).
     * - One-way connection (`bidirectional === false`): traversable only `from -> to` unless `ignoreDirection` is true.
     */
    buildAdjacency(rooms, connections, { includeWarps = true, ignoreDirection = false } = {}) {
      const adj = new Map();
      for (const r of rooms || []) {
        adj.set(r.id, []);
      }

      for (const c of connections || []) {
        if (!c || !c.fromRoomId || !c.toRoomId) continue;
        if (!adj.has(c.fromRoomId) || !adj.has(c.toRoomId)) continue;
        if (c.fromRoomId === c.toRoomId) continue; // self-loops never shorten simple paths
        if (!includeWarps && c.style === "warp") continue;

        const isTwoWay = c.bidirectional !== false;

        // Forward traversal: fromRoomId -> toRoomId
        adj.get(c.fromRoomId).push({
          connectionId: c.id,
          fromRoomId: c.fromRoomId,
          toRoomId: c.toRoomId,
          label: (c.label || "").trim(),
          style: c.style === "warp" ? "warp" : "normal",
          bidirectional: isTwoWay,
        });

        // Reverse traversal: toRoomId -> fromRoomId (if two-way or ignoring direction)
        if (isTwoWay || ignoreDirection) {
          adj.get(c.toRoomId).push({
            connectionId: c.id,
            fromRoomId: c.toRoomId,
            toRoomId: c.fromRoomId,
            label: (c.reverseLabel || c.label || "").trim(),
            style: c.style === "warp" ? "warp" : "normal",
            bidirectional: isTwoWay,
          });
        }
      }

      return adj;
    }

    /**
     * Finds up to `maxPaths` (default 3) shortest simple paths from `fromRoomId` to `toRoomId`.
     * Uses Breadth-First Search over simple paths ordered by:
     *   1. Fewest steps (connections traversed)
     *   2. Fewest warp connections (tie-breaker favoring normal passages when equal length)
     * Deduplicates identical room/connection sequences.
     *
     * @returns {Array<{
     *   orderedRoomIds: string[],
     *   steps: Array<{ connectionId: string, fromRoomId: string, toRoomId: string, label: string, style: string, bidirectional: boolean }>,
     *   roomIds: Set<string>,
     *   connectionIds: Set<string>,
     *   warpCount: number
     * }>}
     */
    findShortestPaths(
      rooms,
      connections,
      fromRoomId,
      toRoomId,
      { maxPaths = 3, includeWarps = true, ignoreDirection = false } = {}
    ) {
      if (!fromRoomId || !toRoomId) return [];
      if (fromRoomId === toRoomId) {
        return [
          {
            orderedRoomIds: [fromRoomId],
            steps: [],
            roomIds: new Set([fromRoomId]),
            connectionIds: new Set(),
            warpCount: 0,
          },
        ];
      }

      const adj = this.buildAdjacency(rooms, connections, { includeWarps, ignoreDirection });
      if (!adj.has(fromRoomId) || !adj.has(toRoomId)) return [];

      const results = [];
      const seenSignatures = new Set();

      // Queue entries: { currentRoomId, orderedRoomIds, steps, visitedRooms, warpCount }
      const queue = [
        {
          currentRoomId: fromRoomId,
          orderedRoomIds: [fromRoomId],
          steps: [],
          visitedRooms: new Set([fromRoomId]),
          warpCount: 0,
        },
      ];

      const MAX_QUEUE_EXPLORE = 4500;
      let explored = 0;

      while (queue.length > 0 && results.length < maxPaths && explored < MAX_QUEUE_EXPLORE) {
        const state = queue.shift();
        explored++;

        const outgoing = adj.get(state.currentRoomId) || [];
        // Sort outgoing edges so normal connections are explored slightly before warps at the same depth
        const sortedOutgoing = [...outgoing].sort((a, b) => {
          const aWarp = a.style === "warp" ? 1 : 0;
          const bWarp = b.style === "warp" ? 1 : 0;
          return aWarp - bWarp;
        });

        for (const edge of sortedOutgoing) {
          const nextRoomId = edge.toRoomId;
          if (state.visitedRooms.has(nextRoomId)) continue;

          const nextRoomIds = [...state.orderedRoomIds, nextRoomId];
          const nextSteps = [...state.steps, edge];
          const nextWarps = state.warpCount + (edge.style === "warp" ? 1 : 0);

          if (nextRoomId === toRoomId) {
            const sig =
              nextRoomIds.join(">") +
              "|" +
              nextSteps.map((s) => s.connectionId).join(",");
            if (!seenSignatures.has(sig)) {
              seenSignatures.add(sig);
              results.push({
                orderedRoomIds: nextRoomIds,
                steps: nextSteps,
                roomIds: new Set(nextRoomIds),
                connectionIds: new Set(nextSteps.map((s) => s.connectionId)),
                warpCount: nextWarps,
              });
              if (results.length >= maxPaths) break;
            }
          } else {
            const nextVisited = new Set(state.visitedRooms);
            nextVisited.add(nextRoomId);
            queue.push({
              currentRoomId: nextRoomId,
              orderedRoomIds: nextRoomIds,
              steps: nextSteps,
              visitedRooms: nextVisited,
              warpCount: nextWarps,
            });
          }
        }
      }

      // Final sort by step count, then fewer warps
      results.sort((a, b) => {
        if (a.steps.length !== b.steps.length) return a.steps.length - b.steps.length;
        return a.warpCount - b.warpCount;
      });

      return results.slice(0, maxPaths);
    }

    /**
     * Activates a chosen path option to keep highlighted on the map.
     */
    setHighlightedPath(pathResult, { fromRoomId, toRoomId, optionIndex = 0 } = {}) {
      if (!pathResult) {
        this.activePath = null;
        return null;
      }
      this.activePath = {
        fromRoomId: fromRoomId || pathResult.orderedRoomIds[0] || null,
        toRoomId:
          toRoomId ||
          pathResult.orderedRoomIds[pathResult.orderedRoomIds.length - 1] ||
          null,
        optionIndex,
        roomIds: new Set(pathResult.orderedRoomIds || []),
        connectionIds: new Set((pathResult.steps || []).map((s) => s.connectionId)),
        orderedRoomIds: [...(pathResult.orderedRoomIds || [])],
        steps: [...(pathResult.steps || [])],
        warpCount: pathResult.warpCount || 0,
      };
      return this.activePath;
    }

    clearHighlightedPath() {
      this.activePath = null;
    }

    hasActivePath() {
      return Boolean(this.activePath && this.activePath.roomIds && this.activePath.roomIds.size > 0);
    }

    isRoomOnActivePath(roomId) {
      return Boolean(this.activePath && this.activePath.roomIds.has(roomId));
    }

    isConnectionOnActivePath(connId) {
      return Boolean(this.activePath && this.activePath.connectionIds.has(connId));
    }

    getRoomStepIndex(roomId) {
      if (!this.activePath || !Array.isArray(this.activePath.orderedRoomIds)) return -1;
      return this.activePath.orderedRoomIds.indexOf(roomId);
    }

    /**
     * Prunes the active path if any of its rooms or connections were deleted from the map.
     */
    validateAgainstState(rooms, connections) {
      if (!this.activePath) return false;
      const roomSet = new Set((rooms || []).map((r) => r.id));
      const connSet = new Set((connections || []).map((c) => c.id));
      for (const rId of this.activePath.roomIds) {
        if (!roomSet.has(rId)) {
          this.activePath = null;
          return false;
        }
      }
      for (const cId of this.activePath.connectionIds) {
        if (!connSet.has(cId)) {
          this.activePath = null;
          return false;
        }
      }
      return true;
    }
  }

  global.PathFinder = PathFinder;
  global.mapPathFinder = new PathFinder();
})(typeof window !== "undefined" ? window : this);
