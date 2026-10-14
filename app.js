/**
 * Interactive OS Resource Allocation Graph (RAG) Simulator & Deadlock Detector
 * Real-time HTML5 Canvas Graph Engine, DFS Cycle Detection, Multi-Instance Reduction Stepper.
 */

// =============================================================================
// 1. Data Models & Graph State
// =============================================================================

class RAGCore {
  constructor() {
    this.processes = {};       // id -> { id, state: "Active"|"Blocked"|"Terminated", x, y, vx, vy }
    this.resources = {};       // id -> { id, total: int, avail: int, x, y, vx, vy }
    this.allocations = {};     // p_id -> { r_id: int }
    this.requests = {};        // p_id -> { r_id: int }
    this.claims = {};          // p_id -> { r_id: int }
    this.waitingQueues = {};   // r_id -> [p_id, ...] (FIFO)
    this.logs = [];            // [{ time, tag, msg }]
  }

  log(tag, msg) {
    const time = new Date().toLocaleTimeString();
    this.logs.unshift({ time, tag, msg });
    if (this.logs.length > 50) this.logs.pop();
  }

  addProcess(id, x = null, y = null) {
    id = String(id).trim();
    if (!id) throw new Error("Process ID cannot be empty.");
    if (this.processes[id]) throw new Error(`Process '${id}' already exists.`);

    this.processes[id] = {
      id,
      state: "Active",
      x: x !== null ? x : 180 + Math.random() * 40,
      y: y !== null ? y : 120 + Object.keys(this.processes).length * 80,
      vx: 0,
      vy: 0,
      radius: 28
    };

    this.allocations[id] = {};
    this.requests[id] = {};
    this.claims[id] = {};
    for (const rId of Object.keys(this.resources)) {
      this.allocations[id][rId] = 0;
      this.requests[id][rId] = 0;
      this.claims[id][rId] = 0;
    }

    this.log("CREATED", `Added Process node '${id}'.`);
  }

  removeProcess(id) {
    if (!this.processes[id]) throw new Error(`Process '${id}' does not exist.`);
    this.terminateProcess(id);

    for (const rId of Object.keys(this.waitingQueues)) {
      this.waitingQueues[rId] = this.waitingQueues[rId].filter(p => p !== id);
    }

    delete this.processes[id];
    delete this.allocations[id];
    delete this.requests[id];
    delete this.claims[id];
    this.log("DELETED", `Removed Process '${id}'.`);
  }

  addResource(id, total = 1, x = null, y = null) {
    id = String(id).trim();
    total = parseInt(total, 10);
    if (!id) throw new Error("Resource ID cannot be empty.");
    if (this.resources[id]) throw new Error(`Resource '${id}' already exists.`);
    if (isNaN(total) || total < 1) throw new Error("Total instances must be at least 1.");

    this.resources[id] = {
      id,
      total,
      avail: total,
      x: x !== null ? x : 550 + Math.random() * 40,
      y: y !== null ? y : 120 + Object.keys(this.resources).length * 90,
      vx: 0,
      vy: 0,
      width: 70,
      height: 70
    };

    this.waitingQueues[id] = [];
    for (const pId of Object.keys(this.processes)) {
      this.allocations[pId][id] = 0;
      this.requests[pId][id] = 0;
      this.claims[pId][id] = 0;
    }

    this.log("CREATED", `Added Resource node '${id}' with ${total} instance(s).`);
  }

  removeResource(id) {
    if (!this.resources[id]) throw new Error(`Resource '${id}' does not exist.`);
    for (const pId of Object.keys(this.processes)) {
      delete this.allocations[pId][id];
      delete this.requests[pId][id];
      delete this.claims[pId][id];
      this._updateProcessState(pId);
    }

    delete this.resources[id];
    delete this.waitingQueues[id];
    this.log("DELETED", `Removed Resource '${id}'.`);
  }

  setClaim(pId, rId, count) {
    if (!this.processes[pId]) throw new Error(`Process '${pId}' not found.`);
    if (!this.resources[rId]) throw new Error(`Resource '${rId}' not found.`);
    count = parseInt(count, 10);
    if (isNaN(count) || count < 0 || count > this.resources[rId].total) {
      throw new Error(`Claim must be between 0 and resource total (${this.resources[rId].total}).`);
    }
    this.claims[pId][rId] = count;
    this.log("CLAIM", `Process '${pId}' set claim edge of ${count} on '${rId}'.`);
  }

  requestResource(pId, rId, count = 1) {
    if (!this.processes[pId]) throw new Error(`Process '${pId}' not found.`);
    if (!this.resources[rId]) throw new Error(`Resource '${rId}' not found.`);
    count = parseInt(count, 10);
    if (isNaN(count) || count <= 0) throw new Error("Request count must be positive.");

    const proc = this.processes[pId];
    const res = this.resources[rId];
    if (proc.state === "Terminated") throw new Error(`Cannot request resource for terminated process '${pId}'.`);
    if (count > res.total) throw new Error(`Request (${count}) exceeds resource total capacity (${res.total}).`);

    const queue = this.waitingQueues[rId];
    const isQueueEmptyOrSelf = queue.length === 0 || (queue.length > 0 && queue[0] === pId);

    if (res.avail >= count && isQueueEmptyOrSelf) {
      // Grant immediately
      res.avail -= count;
      this.allocations[pId][rId] = (this.allocations[pId][rId] || 0) + count;
      const qIdx = queue.indexOf(pId);
      if (qIdx !== -1) queue.splice(qIdx, 1);
      this._updateProcessState(pId);
      this.log("GRANTED", `'${pId}' acquired ${count} instance(s) of '${rId}'. Avail: ${res.avail}.`);
      return { status: "GRANTED", available: res.avail };
    } else {
      // Unsatisfied request -> Immediate Deadlock (Blocked state removed)
      this.requests[pId][rId] = (this.requests[pId][rId] || 0) + count;
      proc.state = "Deadlocked";
      if (!queue.includes(pId)) queue.push(pId);
      const holders = Object.keys(this.allocations).filter(p => (this.allocations[p][rId] || 0) > 0);
      const holderMsg = holders.length > 0 ? ` (held by ${holders.join(", ")})` : "";
      this.log("DEADLOCK", `'${pId}' requested ${count} of '${rId}' [${res.avail} free]${holderMsg}. Immediate Deadlock!`);
      return { status: "DEADLOCKED", available: res.avail };
    }
  }

  releaseResource(pId, rId, count = 1) {
    if (!this.processes[pId]) throw new Error(`Process '${pId}' not found.`);
    if (!this.resources[rId]) throw new Error(`Resource '${rId}' not found.`);
    count = parseInt(count, 10);
    if (isNaN(count) || count <= 0) throw new Error("Release count must be positive.");

    const held = this.allocations[pId][rId] || 0;
    if (held < count) throw new Error(`Cannot release ${count}: '${pId}' only holds ${held} of '${rId}'.`);

    const res = this.resources[rId];
    this.allocations[pId][rId] -= count;
    res.avail += count;
    this._updateProcessState(pId);
    this.log("RELEASED", `'${pId}' released ${count} instance(s) of '${rId}'. Avail: ${res.avail}.`);

    const unblocked = this._processWaitingQueue(rId);
    return { status: "RELEASED", unblocked, available: res.avail };
  }

  terminateProcess(pId) {
    if (!this.processes[pId]) throw new Error(`Process '${pId}' not found.`);
    const proc = this.processes[pId];
    const unblockedAll = [];

    // Free all held allocations
    for (const rId of Object.keys(this.resources)) {
      const held = this.allocations[pId][rId] || 0;
      if (held > 0) {
        this.allocations[pId][rId] = 0;
        this.resources[rId].avail += held;
        this.log("FREED", `Termination of '${pId}' freed ${held} instance(s) of '${rId}'.`);
        const unblocked = this._processWaitingQueue(rId);
        unblockedAll.push(...unblocked);
      }
      // Clear requests
      this.requests[pId][rId] = 0;
      this.waitingQueues[rId] = this.waitingQueues[rId].filter(p => p !== pId);
    }

    proc.state = "Terminated";
    this.log("TERMINATED", `Process '${pId}' terminated.`);
    return { status: "TERMINATED", unblocked: [...new Set(unblockedAll)] };
  }

  _processWaitingQueue(rId) {
    const res = this.resources[rId];
    const queue = this.waitingQueues[rId];
    const unblocked = [];

    let i = 0;
    while (i < queue.length && res.avail > 0) {
      const candP = queue[i];
      const needed = this.requests[candP][rId] || 0;
      if (needed > 0 && res.avail >= needed) {
        res.avail -= needed;
        this.allocations[candP][rId] = (this.allocations[candP][rId] || 0) + needed;
        this.requests[candP][rId] = 0;
        queue.splice(i, 1);
        this._updateProcessState(candP);
        if (this.processes[candP].state === "Active") unblocked.push(candP);
        this.log("RESOLVED", `'${candP}' granted ${needed} of '${rId}' from FIFO queue. Deadlock cleared.`);
      } else {
        break; // FIFO head waiting
      }
    }
    return unblocked;
  }

  _updateProcessState(pId) {
    const proc = this.processes[pId];
    if (proc.state === "Terminated") return;
    let pending = 0;
    for (const rId of Object.keys(this.resources)) {
      pending += (this.requests[pId][rId] || 0);
    }
    proc.state = pending > 0 ? "Deadlocked" : "Active";
  }

  getEdges() {
    const edges = [];
    // Requests: P -> R
    for (const pId of Object.keys(this.processes)) {
      for (const rId of Object.keys(this.resources)) {
        const count = this.requests[pId][rId] || 0;
        if (count > 0) edges.push({ from: pId, to: rId, type: "Request", count });
      }
    }
    // Allocations: R -> P
    for (const pId of Object.keys(this.processes)) {
      for (const rId of Object.keys(this.resources)) {
        const count = this.allocations[pId][rId] || 0;
        if (count > 0) edges.push({ from: rId, to: pId, type: "Assignment", count });
      }
    }
    // Claims: P -> R
    for (const pId of Object.keys(this.processes)) {
      for (const rId of Object.keys(this.resources)) {
        const count = this.claims[pId][rId] || 0;
        if (count > 0) edges.push({ from: pId, to: rId, type: "Claim", count });
      }
    }
    return edges;
  }

  toJSON() {
    return JSON.stringify({
      processes: this.processes,
      resources: this.resources,
      allocations: this.allocations,
      requests: this.requests,
      claims: this.claims,
      waitingQueues: this.waitingQueues
    }, null, 2);
  }

  fromJSON(jsonStr) {
    const data = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
    this.processes = {};
    this.resources = {};
    this.allocations = {};
    this.requests = {};
    this.claims = {};
    this.waitingQueues = {};

    for (const [rId, rInfo] of Object.entries(data.resources || {})) {
      this.addResource(rId, rInfo.total, rInfo.x, rInfo.y);
    }
    for (const [pId, pInfo] of Object.entries(data.processes || {})) {
      this.addProcess(pId, pInfo.x, pInfo.y);
    }

    for (const [pId, allocMap] of Object.entries(data.allocations || {})) {
      for (const [rId, count] of Object.entries(allocMap)) {
        if (count > 0 && this.processes[pId] && this.resources[rId]) {
          this.allocations[pId][rId] = count;
          this.resources[rId].avail -= count;
        }
      }
    }

    for (const [pId, reqMap] of Object.entries(data.requests || {})) {
      for (const [rId, count] of Object.entries(reqMap)) {
        if (count > 0 && this.processes[pId] && this.resources[rId]) {
          this.requests[pId][rId] = count;
          this.processes[pId].state = "Deadlocked";
          if (!this.waitingQueues[rId].includes(pId)) this.waitingQueues[rId].push(pId);
        }
      }
    }

    for (const [pId, claimMap] of Object.entries(data.claims || {})) {
      for (const [rId, count] of Object.entries(claimMap)) {
        if (count > 0 && this.processes[pId] && this.resources[rId]) {
          this.claims[pId][rId] = count;
        }
      }
    }
  }
}

// =============================================================================
// 2. Deadlock Detection & Graph Reduction Engine
// =============================================================================

class DeadlockAnalyzer {
  static analyze(rag) {
    const cycles = this.findCycles(rag);
    const hasCycle = cycles.length > 0;

    // Check if resources in cycles (or whole system) are single-instance
    const cycleRes = new Set();
    for (const c of cycles) {
      for (const node of c) {
        if (rag.resources[node]) cycleRes.add(node);
      }
    }

    let allSingleInstance = true;
    if (cycleRes.size > 0) {
      allSingleInstance = Array.from(cycleRes).every(rId => rag.resources[rId].total === 1);
    } else {
      allSingleInstance = Object.values(rag.resources).every(r => r.total === 1);
    }

    const { reducible, deadlockedProcs, steps } = this.runReduction(rag);

    // Collect all processes with pending unsatisfied requests (waiting on resources that are fully held or insufficient)
    const unsatisfiedProcs = new Set();
    const unsatisfiedDetails = [];
    for (const [pId, reqMap] of Object.entries(rag.requests)) {
      for (const [rId, count] of Object.entries(reqMap)) {
        if (count > 0 && (rag.resources[rId]?.avail || 0) < count) {
          unsatisfiedProcs.add(pId);
          const holders = Object.keys(rag.allocations).filter(p => (rag.allocations[p][rId] || 0) > 0);
          const holderStr = holders.length > 0 ? `held by ${holders.join(", ")}` : "0 free";
          unsatisfiedDetails.push(`'${pId}' requested '${rId}' (${holderStr})`);
        }
      }
    }

    let status = "NO_DEADLOCK";
    let message = "";
    let finalDeadlockedProcs = [];
    const deadlockedRes = new Set();

    if (hasCycle && allSingleInstance) {
      status = "DEADLOCK_CONFIRMED";
      // Collect procs in single-instance cycle
      const cycleProcs = new Set();
      for (const c of cycles) {
        for (const node of c) {
          if (rag.processes[node]) cycleProcs.add(node);
        }
      }
      finalDeadlockedProcs = Array.from(new Set([...deadlockedProcs, ...cycleProcs, ...unsatisfiedProcs]));
      for (const pId of finalDeadlockedProcs) {
        for (const [rId, count] of Object.entries(rag.requests[pId] || {})) {
          if (count > 0) deadlockedRes.add(rId);
        }
      }
      const cycleStrs = cycles.map(c => c.join(" &rarr; "));
      message = `DEADLOCK CONFIRMED! Directed cycle detected in single-instance graph: [${cycleStrs.join("; ")}]. Processes [${finalDeadlockedProcs.join(", ")}] are deadlocked.`;
    } else if (hasCycle && !allSingleInstance) {
      // Multi-instance cycle: governed by graph reduction theorem
      if (reducible) {
        status = "SAFE_STATE";
        finalDeadlockedProcs = [];
        const cycleStrs = cycles.map(c => c.join(" &rarr; "));
        message = `Safe State: Cycle detected (${cycleStrs.join("; ")}), but resources have multiple instances and graph reduction succeeded! Unblocking execution path exists.`;
      } else {
        status = "DEADLOCK_CONFIRMED";
        finalDeadlockedProcs = Array.from(new Set([...deadlockedProcs, ...unsatisfiedProcs]));
        for (const pId of finalDeadlockedProcs) {
          for (const [rId, count] of Object.entries(rag.requests[pId] || {})) {
            if (count > 0) deadlockedRes.add(rId);
          }
        }
        const cycleStrs = cycles.map(c => c.join(" &rarr; "));
        message = `DEADLOCK CONFIRMED! Multi-instance graph reduction failed. Processes [${finalDeadlockedProcs.join(", ")}] cannot be satisfied. Cycle: [${cycleStrs.join("; ")}].`;
      }
    } else {
      // No directed cycle
      if (unsatisfiedProcs.size > 0) {
        status = "DEADLOCK_CONFIRMED";
        finalDeadlockedProcs = Array.from(unsatisfiedProcs);
        for (const pId of finalDeadlockedProcs) {
          for (const [rId, count] of Object.entries(rag.requests[pId] || {})) {
            if (count > 0) deadlockedRes.add(rId);
          }
        }
        message = `DEADLOCK CONFIRMED! Process(es) [${finalDeadlockedProcs.join(", ")}] requested resource instance(s) that are fully held and unavailable: ${unsatisfiedDetails.join("; ")}. Immediate Deadlock!`;
      } else {
        status = "NO_DEADLOCK";
        message = "Safe State: No pending unsatisfied requests or circular wait cycles detected in graph G=(V,E). All processes can progress without deadlock.";
      }
    }

    return {
      status,
      hasCycle,
      cycles,
      allSingleInstance,
      reducible,
      deadlockedProcs: finalDeadlockedProcs,
      deadlockedRes: Array.from(deadlockedRes),
      steps,
      message
    };
  }

  static findCycles(rag) {
    const adj = {};
    for (const pId of Object.keys(rag.processes)) adj[pId] = [];
    for (const rId of Object.keys(rag.resources)) adj[rId] = [];

    // P -> R requests
    for (const [pId, reqs] of Object.entries(rag.requests)) {
      for (const [rId, count] of Object.entries(reqs)) {
        if (count > 0 && adj[pId]) adj[pId].push(rId);
      }
    }
    // R -> P allocations
    for (const [pId, allocs] of Object.entries(rag.allocations)) {
      for (const [rId, count] of Object.entries(allocs)) {
        if (count > 0 && adj[rId]) adj[rId].push(pId);
      }
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    for (const node of Object.keys(adj)) color[node] = WHITE;

    const detectedCycles = [];
    const seenSignatures = new Set();

    function dfs(u, path) {
      color[u] = GRAY;
      path.push(u);

      for (const v of adj[u] || []) {
        if (color[v] === GRAY) {
          const idx = path.indexOf(v);
          if (idx !== -1) {
            const cycle = path.slice(idx).concat([v]);
            const cycleNodes = cycle.slice(0, -1);
            let minIdx = 0;
            for (let i = 1; i < cycleNodes.length; i++) {
              if (cycleNodes[i] < cycleNodes[minIdx]) minIdx = i;
            }
            const canonical = cycleNodes.slice(minIdx).concat(cycleNodes.slice(0, minIdx));
            const sig = canonical.join("->");
            if (!seenSignatures.has(sig)) {
              seenSignatures.add(sig);
              detectedCycles.push(cycle);
            }
          }
        } else if (color[v] === WHITE) {
          dfs(v, path);
        }
      }

      path.pop();
      color[u] = BLACK;
    }

    for (const node of Object.keys(adj)) {
      if (color[node] === WHITE) dfs(node, []);
    }

    return detectedCycles;
  }

  static runReduction(rag) {
    const work = {};
    for (const [rId, r] of Object.entries(rag.resources)) {
      work[rId] = r.avail;
    }

    const finish = {};
    for (const [pId, p] of Object.entries(rag.processes)) {
      if (p.state === "Terminated") {
        finish[pId] = true;
      } else {
        let totalAlloc = 0, totalReq = 0;
        for (const rId of Object.keys(rag.resources)) {
          totalAlloc += (rag.allocations[pId][rId] || 0);
          totalReq += (rag.requests[pId][rId] || 0);
        }
        finish[pId] = (totalAlloc === 0 && totalReq === 0);
      }
    }

    const steps = [];
    let stepCount = 1;

    while (true) {
      let candidate = null;
      for (const [pId, isDone] of Object.entries(finish)) {
        if (!isDone) {
          let canSatisfy = true;
          for (const rId of Object.keys(rag.resources)) {
            const req = rag.requests[pId][rId] || 0;
            if (req > (work[rId] || 0)) {
              canSatisfy = false;
              break;
            }
          }
          if (canSatisfy) {
            candidate = pId;
            break;
          }
        }
      }

      if (candidate) {
        const pId = candidate;
        const workBefore = { ...work };
        const freed = { ...rag.allocations[pId] };

        for (const [rId, count] of Object.entries(freed)) {
          work[rId] = (work[rId] || 0) + count;
        }
        finish[pId] = true;
        const workAfter = { ...work };

        const freedStr = Object.entries(freed).filter(([, c]) => c > 0).map(([r, c]) => `${r}:${c}`).join(", ") || "None";
        const explanation = `Process '${pId}' satisfies Request &le; Work. It completes and releases held resources [${freedStr}].`;

        steps.push({
          stepNum: stepCount++,
          processId: pId,
          workBefore,
          freed,
          workAfter,
          explanation
        });
      } else {
        break;
      }
    }

    const deadlockedProcs = Object.keys(finish).filter(pId => !finish[pId]);
    const reducible = deadlockedProcs.length === 0;

    return { reducible, deadlockedProcs, steps };
  }
}

// =============================================================================
// 3. Canvas Visual Graph Renderer & Interactive Controls
// =============================================================================

class GraphRenderer {
  constructor(canvas, rag) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.rag = rag;

    // Viewport transform
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this.isDraggingCanvas = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    this.selectedNode = null;
    this.draggedNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;

    // Placement & Cursor modes: "select", "add-process", "add-resource"
    this.placementMode = "select";
    this.mouseWorldX = 0;
    this.mouseWorldY = 0;
    this.hoverNode = null;
    this.onCanvasPlaced = null; // Callback: (type, worldX, worldY)

    this.layoutMode = "bipartite"; // "bipartite" or "free"
    this.currentReport = null;
    this.animTime = 0;

    this.initEvents();
    this.resizeCanvas();
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.fitView();
    });

    if (window.ResizeObserver && this.canvas.parentElement) {
      let isFirstResize = true;
      this.resizeObserver = new ResizeObserver(() => {
        const changed = this.resizeCanvas();
        if (isFirstResize || changed) {
          this.fitView();
          isFirstResize = false;
        }
      });
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return false;
    const rect = parent.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w > 0 && h > 0) {
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        return true;
      }
    }
    return false;
  }

  initEvents() {
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseup", () => this.onMouseUp());
    this.canvas.addEventListener("mouseleave", () => this.onMouseUp());
    this.canvas.addEventListener("wheel", (e) => this.onWheel(e));

    // Touch support for tablets & mobile
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.onMouseDown({ clientX: t.clientX, clientY: t.clientY });
      }
    }, { passive: false });

    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.onMouseMove({ clientX: t.clientX, clientY: t.clientY });
        e.preventDefault();
      }
    }, { passive: false });

    this.canvas.addEventListener("touchend", () => this.onMouseUp());
  }

  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = sx - rect.left;
    const clientY = sy - rect.top;
    return {
      x: (clientX - this.panX) / this.zoom,
      y: (clientY - this.panY) / this.zoom
    };
  }

  findNodeAt(wx, wy) {
    // Check Processes
    for (const p of Object.values(this.rag.processes)) {
      const dx = wx - p.x;
      const dy = wy - p.y;
      if (Math.sqrt(dx * dx + dy * dy) <= p.radius + 6) {
        return { type: "process", id: p.id, node: p };
      }
    }
    // Check Resources
    for (const r of Object.values(this.rag.resources)) {
      const hw = r.width / 2 + 4;
      const hh = r.height / 2 + 4;
      if (wx >= r.x - hw && wx <= r.x + hw && wy >= r.y - hh && wy <= r.y + hh) {
        return { type: "resource", id: r.id, node: r };
      }
    }
    return null;
  }

  updateCursor() {
    if (this.placementMode === "add-process" || this.placementMode === "add-resource") {
      this.canvas.style.cursor = "crosshair";
    } else if (this.draggedNode) {
      this.canvas.style.cursor = "grabbing";
    } else if (this.hoverNode) {
      this.canvas.style.cursor = "grab";
    } else {
      this.canvas.style.cursor = "default";
    }
  }

  onMouseDown(e) {
    const { x, y } = this.screenToWorld(e.clientX, e.clientY);
    this.mouseWorldX = x;
    this.mouseWorldY = y;

    // Handle Manual Placement on Canvas
    if (this.placementMode === "add-process") {
      if (this.onCanvasPlaced) this.onCanvasPlaced("process", x, y);
      return;
    }
    if (this.placementMode === "add-resource") {
      if (this.onCanvasPlaced) this.onCanvasPlaced("resource", x, y);
      return;
    }

    // Default: Select & Move Mode
    const hit = this.findNodeAt(x, y);
    if (hit) {
      this.draggedNode = hit.node;
      this.selectedNode = hit;
      this.dragOffsetX = x - hit.node.x;
      this.dragOffsetY = y - hit.node.y;
      this.updateCursor();
      if (window.onNodeSelected) window.onNodeSelected(hit);
    } else {
      this.isDraggingCanvas = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
      this.selectedNode = null;
      if (window.onNodeSelected) window.onNodeSelected(null);
    }
  }

  onMouseMove(e) {
    const { x, y } = this.screenToWorld(e.clientX, e.clientY);
    this.mouseWorldX = x;
    this.mouseWorldY = y;

    if (this.draggedNode) {
      this.draggedNode.x = x - this.dragOffsetX;
      this.draggedNode.y = y - this.dragOffsetY;
    } else if (this.isDraggingCanvas) {
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
    } else {
      const hit = this.findNodeAt(x, y);
      this.hoverNode = hit ? hit.node : null;
    }
    this.updateCursor();
  }

  onMouseUp() {
    this.draggedNode = null;
    this.isDraggingCanvas = false;
    this.updateCursor();
  }

  onWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const wx = (mouseX - this.panX) / this.zoom;
    const wy = (mouseY - this.panY) / this.zoom;

    this.zoom = Math.max(0.3, Math.min(2.5, this.zoom * zoomFactor));
    this.panX = mouseX - wx * this.zoom;
    this.panY = mouseY - wy * this.zoom;
  }

  applyBipartiteLayout() {
    this.resizeCanvas();
    const procs = Object.values(this.rag.processes);
    const res = Object.values(this.rag.resources);
    const canvasH = this.canvas.height || 600;
    const midY = canvasH / 2;

    const pSpacing = Math.max(75, Math.min(120, (canvasH - 120) / (procs.length + 1)));
    const rSpacing = Math.max(80, Math.min(130, (canvasH - 120) / (res.length + 1)));

    const startPY = midY - ((procs.length - 1) * pSpacing) / 2;
    procs.forEach((p, idx) => {
      p.x = 220;
      p.y = Math.round(startPY + idx * pSpacing);
    });

    const startRY = midY - ((res.length - 1) * rSpacing) / 2;
    res.forEach((r, idx) => {
      r.x = 650;
      r.y = Math.round(startRY + idx * rSpacing);
    });
  }

  fitView(targetZoom = null) {
    this.resizeCanvas();
    const all = [...Object.values(this.rag.processes), ...Object.values(this.rag.resources)];
    const canvasW = this.canvas.width || 800;
    const canvasH = this.canvas.height || 600;

    if (all.length === 0) {
      this.panX = 0;
      this.panY = 0;
      this.zoom = 1;
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    all.forEach(n => {
      const x = typeof n.x === "number" && !isNaN(n.x) ? n.x : 400;
      const y = typeof n.y === "number" && !isNaN(n.y) ? n.y : 300;
      minX = Math.min(minX, x - 60);
      maxX = Math.max(maxX, x + 60);
      minY = Math.min(minY, y - 60);
      maxY = Math.max(maxY, y + 60);
    });

    const graphW = Math.max(80, maxX - minX);
    const graphH = Math.max(80, maxY - minY);

    if (targetZoom !== null && typeof targetZoom === "number" && targetZoom > 0) {
      this.zoom = targetZoom;
    } else {
      const paddingX = Math.min(70, canvasW * 0.1);
      const paddingY = Math.min(70, canvasH * 0.1);
      const scaleX = (canvasW - paddingX * 2) / graphW;
      const scaleY = (canvasH - paddingY * 2) / graphH;
      this.zoom = Math.max(0.25, Math.min(1.15, Math.min(scaleX, scaleY)));
    }

    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    this.panX = (canvasW / 2) - graphCenterX * this.zoom;
    this.panY = (canvasH / 2) - graphCenterY * this.zoom;
  }

  // ---------------------------------------------------------------------------
  // Canvas Rendering Pipeline
  // ---------------------------------------------------------------------------

  render() {
    this.animTime += 0.03;
    const ctx = this.ctx;
    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Apply pan & zoom
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    const edges = this.rag.getEdges();
    const deadlockedProcs = new Set(this.currentReport?.deadlockedProcs || []);
    const deadlockedRes = new Set(this.currentReport?.deadlockedRes || []);
    const cycleEdges = this.getCycleEdgeSet();

    // 1. Draw Edges
    for (const e of edges) {
      this.drawEdge(ctx, e, cycleEdges);
    }

    // 2. Draw Resource Nodes (Rectangles)
    for (const r of Object.values(this.rag.resources)) {
      this.drawResourceNode(ctx, r, deadlockedRes.has(r.id));
    }

    // 3. Draw Process Nodes (Circles)
    for (const p of Object.values(this.rag.processes)) {
      this.drawProcessNode(ctx, p, deadlockedProcs.has(p.id));
    }

    // 4. Draw Ghost Placement Preview
    if (this.placementMode === "add-process") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.mouseWorldX, this.mouseWorldY, 28, 0, Math.PI * 2);
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.fillStyle = "rgba(0, 242, 254, 0.2)";
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px 'Outfit', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+ Process", this.mouseWorldX, this.mouseWorldY);
      ctx.restore();
    } else if (this.placementMode === "add-resource") {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(this.mouseWorldX - 35, this.mouseWorldY - 35, 70, 70, 8);
      ctx.strokeStyle = "#c77dff";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.fillStyle = "rgba(157, 78, 221, 0.2)";
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px 'Outfit', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+ Resource", this.mouseWorldX, this.mouseWorldY);
      ctx.restore();
    }

    ctx.restore();
  }

  getCycleEdgeSet() {
    const cycleEdges = new Set();
    if (this.currentReport?.cycles) {
      for (const cycle of this.currentReport.cycles) {
        for (let i = 0; i < cycle.length - 1; i++) {
          cycleEdges.add(`${cycle[i]}->${cycle[i+1]}`);
        }
      }
    }
    return cycleEdges;
  }

  drawEdge(ctx, edge, cycleEdges) {
    const fromNode = this.rag.processes[edge.from] || this.rag.resources[edge.from];
    const toNode = this.rag.processes[edge.to] || this.rag.resources[edge.to];
    if (!fromNode || !toNode) return;

    const isCycle = cycleEdges.has(`${edge.from}->${edge.to}`);
    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    // Boundary clipping
    const fromRadius = fromNode.radius || fromNode.width / 2;
    const toRadius = toNode.radius || toNode.width / 2;

    const startX = fromNode.x + (dx / dist) * fromRadius;
    const startY = fromNode.y + (dy / dist) * fromRadius;
    const endX = toNode.x - (dx / dist) * toRadius;
    const endY = toNode.y - (dy / dist) * toRadius;

    ctx.save();

    // Curved edge offset if mutual connection exists
    const hasReverse = this.rag.getEdges().some(e => e.from === edge.to && e.to === edge.from);
    const curvature = hasReverse ? 30 : 0;
    const midX = (startX + endX) / 2 - (dy / dist) * curvature;
    const midY = (startY + endY) / 2 + (dx / dist) * curvature;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(midX, midY, endX, endY);

    if (isCycle) {
      // Deadlocked cycle pulse
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 6);
      ctx.strokeStyle = `rgba(255, 51, 102, ${0.7 + pulse * 0.3})`;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = "#ff3366";
      ctx.shadowBlur = 10;
    } else if (edge.type === "Request") {
      ctx.strokeStyle = "#ffb703";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -this.animTime * 20;
    } else if (edge.type === "Assignment") {
      ctx.strokeStyle = "#00f5a0";
      ctx.lineWidth = 2.2;
      ctx.shadowColor = "rgba(0, 245, 160, 0.4)";
      ctx.shadowBlur = 6;
    } else { // Claim
      ctx.strokeStyle = "#9d4edd";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 4]);
    }

    ctx.stroke();

    // Draw Arrowhead at (endX, endY)
    const arrowAngle = Math.atan2(endY - midY, endX - midX);
    const arrowLen = 10;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowLen * Math.cos(arrowAngle - Math.PI / 6),
      endY - arrowLen * Math.sin(arrowAngle - Math.PI / 6)
    );
    ctx.lineTo(
      endX - arrowLen * Math.cos(arrowAngle + Math.PI / 6),
      endY - arrowLen * Math.sin(arrowAngle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();

    // Edge Count Badge if > 1
    if (edge.count > 1) {
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(midX, midY, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(edge.count, midX, midY);
    }

    ctx.restore();
  }

  drawProcessNode(ctx, p, isDeadlocked) {
    ctx.save();

    const isSelected = this.selectedNode && this.selectedNode.id === p.id;
    const r = p.radius;

    // Glowing aura
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + (isSelected ? 6 : 3), 0, Math.PI * 2);

    if (isDeadlocked) {
      const pulse = 0.5 + 0.5 * Math.sin(this.animTime * 5);
      ctx.fillStyle = `rgba(255, 51, 102, ${0.2 + pulse * 0.25})`;
      ctx.strokeStyle = "#ff3366";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ff3366";
      ctx.shadowBlur = 14;
    } else if (p.state === "Terminated") {
      ctx.fillStyle = "rgba(50, 60, 80, 0.3)";
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1.5;
    } else { // Active
      ctx.fillStyle = "rgba(0, 242, 254, 0.15)";
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "#00f2fe";
      ctx.shadowBlur = 10;
    }

    ctx.fill();
    ctx.stroke();

    // Inner Body
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#0d1527";
    ctx.fill();

    // Process ID label
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.id, p.x, p.y - 4);

    // State Sub-label
    ctx.font = "9px 'Inter', sans-serif";
    ctx.fillStyle = isDeadlocked ? "#ff4d6d" : (p.state === "Terminated" ? "#94a3b8" : "#00f2fe");
    ctx.fillText(isDeadlocked ? "DEADLOCK" : p.state.toUpperCase(), p.x, p.y + 10);

    ctx.restore();
  }

  drawResourceNode(ctx, r, isDeadlocked) {
    ctx.save();

    const isSelected = this.selectedNode && this.selectedNode.id === r.id;
    const w = r.width;
    const h = r.height;
    const x = r.x - w / 2;
    const y = r.y - h / 2;
    const radius = 8;

    // Container box
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);

    if (isDeadlocked) {
      ctx.fillStyle = "rgba(255, 51, 102, 0.15)";
      ctx.strokeStyle = "#ff3366";
      ctx.lineWidth = 2.8;
      ctx.shadowColor = "#ff3366";
      ctx.shadowBlur = 12;
    } else {
      ctx.fillStyle = isSelected ? "rgba(30, 48, 80, 0.95)" : "rgba(18, 28, 48, 0.9)";
      ctx.strokeStyle = isSelected ? "#00f2fe" : "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      if (isSelected) {
        ctx.shadowColor = "#00f2fe";
        ctx.shadowBlur = 10;
      }
    }

    ctx.fill();
    ctx.stroke();

    // Resource Header ID
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(r.id, r.x, y + 6);

    // Capacity Text (e.g., "1 / 2")
    ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.fillStyle = r.avail > 0 ? "#00f5a0" : "#ffb703";
    ctx.fillText(`Avail: ${r.avail}/${r.total}`, r.x, y + 21);

    // Draw Internal Instance Dot Matrix (LED dots)
    const dotRadius = 3.5;
    const total = r.total;
    const dotsPerRow = Math.min(5, total);
    const startDotX = r.x - ((dotsPerRow - 1) * 11) / 2;
    const startDotY = y + 42;

    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / dotsPerRow);
      const col = i % dotsPerRow;
      const dotX = startDotX + col * 11;
      const dotY = startDotY + row * 10;

      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);

      // If within available capacity, show green, else allocated (amber/cyan)
      if (i < r.avail) {
        ctx.fillStyle = "#00f5a0";
        ctx.shadowColor = "rgba(0, 245, 160, 0.6)";
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = "#ffb703";
        ctx.shadowColor = "rgba(255, 183, 3, 0.5)";
        ctx.shadowBlur = 4;
      }
      ctx.fill();
    }

    ctx.restore();
  }
}

// =============================================================================
// 4. Application UI Controller & Scenario Management
// =============================================================================

class RAGApp {
  constructor() {
    this.rag = new RAGCore();
    this.canvas = document.getElementById("rag-canvas");
    this.renderer = new GraphRenderer(this.canvas, this.rag);

    this.activeScenario = null;
    this.reductionStepIdx = 0;
    this.reductionAutoTimer = null;
    this.matrixTab = "combined";

    this.bindDOM();
    this.loadScenarioA();

    // Settle canvas layout & ensure graph is visibly centered on initial startup
    requestAnimationFrame(() => {
      this.renderer.resizeCanvas();
      this.renderer.fitView();
    });
    setTimeout(() => {
      this.renderer.resizeCanvas();
      this.renderer.fitView();
    }, 100);

    // Continuous Animation Loop
    const loop = () => {
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  bindDOM() {
    // Preset Scenarios
    document.getElementById("btn-scenario-a").addEventListener("click", () => this.loadScenarioA());
    document.getElementById("btn-scenario-b").addEventListener("click", () => this.loadScenarioB());
    document.getElementById("btn-scenario-c").addEventListener("click", () => this.loadScenarioC());
    document.getElementById("btn-scenario-d").addEventListener("click", () => this.loadScenarioD());
    
    // Random Scenario Generator
    const btnRandom = document.getElementById("btn-scenario-random");
    if (btnRandom) btnRandom.addEventListener("click", () => this.loadRandomScenario());

    // Canvas Placement Mode Buttons
    const btnModeSelect = document.getElementById("btn-mode-select");
    const btnModeProc = document.getElementById("btn-mode-add-process");
    const btnModeRes = document.getElementById("btn-mode-add-resource");
    if (btnModeSelect) btnModeSelect.addEventListener("click", () => this.setPlacementMode("select"));
    if (btnModeProc) btnModeProc.addEventListener("click", () => this.setPlacementMode("add-process"));
    if (btnModeRes) btnModeRes.addEventListener("click", () => this.setPlacementMode("add-resource"));

    // Canvas Click Placement Callback
    this.renderer.onCanvasPlaced = (type, x, y) => this.handleCanvasPlaced(type, x, y);

    // Beginner Instructions Modal
    const btnOpenInst = document.getElementById("btn-open-instructions");
    const btnCloseInst = document.getElementById("btn-close-instructions");
    const btnModalGotIt = document.getElementById("btn-modal-got-it");
    const modalInst = document.getElementById("instructions-modal");

    if (btnOpenInst) btnOpenInst.addEventListener("click", () => this.openInstructionsModal());
    if (btnCloseInst) btnCloseInst.addEventListener("click", () => this.closeInstructionsModal());
    if (btnModalGotIt) btnModalGotIt.addEventListener("click", () => this.closeInstructionsModal());
    if (modalInst) {
      modalInst.addEventListener("click", (e) => {
        if (e.target === modalInst) this.closeInstructionsModal();
      });
    }
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeInstructionsModal();
    });

    // Instructions Modal Tabs
    document.querySelectorAll(".modal-tab").forEach(tab => {
      tab.addEventListener("click", (e) => {
        document.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        const targetTab = e.currentTarget;
        targetTab.classList.add("active");
        const paneId = "pane-" + targetTab.dataset.tab;
        const pane = document.getElementById(paneId);
        if (pane) pane.classList.add("active");
      });
    });

    // Copy Summary Button
    const btnCopy = document.getElementById("btn-copy-interpretation");
    if (btnCopy) btnCopy.addEventListener("click", () => this.copyInterpretation());

    // Layout Mode
    const btnLayout = document.getElementById("btn-layout-toggle");
    btnLayout.addEventListener("click", () => {
      this.renderer.applyBipartiteLayout();
      this.renderer.fitView();
    });

    // Reset & Export/Import
    document.getElementById("btn-reset-graph").addEventListener("click", () => this.resetGraph());
    document.getElementById("btn-export-json").addEventListener("click", () => this.exportJSON());
    document.getElementById("btn-import-json").addEventListener("click", () => {
      document.getElementById("file-import-input").click();
    });
    document.getElementById("file-import-input").addEventListener("change", (e) => this.importJSON(e));

    // Entity Creation
    document.getElementById("btn-add-process").addEventListener("click", () => this.handleAddProcess());
    document.getElementById("input-process-id").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.handleAddProcess();
    });

    document.getElementById("btn-add-resource").addEventListener("click", () => this.handleAddResource());
    document.getElementById("input-resource-id").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.handleAddResource();
    });

    // Dynamic Operations
    document.getElementById("btn-exec-request").addEventListener("click", () => this.handleOpRequest());
    document.getElementById("btn-exec-release").addEventListener("click", () => this.handleOpRelease());
    document.getElementById("btn-exec-claim").addEventListener("click", () => this.handleOpClaim());
    document.getElementById("btn-exec-terminate").addEventListener("click", () => this.handleOpTerminate());

    // Reduction Controls
    document.getElementById("btn-reduction-prev").addEventListener("click", () => this.prevReductionStep());
    document.getElementById("btn-reduction-next").addEventListener("click", () => this.nextReductionStep());
    document.getElementById("btn-reduction-auto").addEventListener("click", () => this.toggleAutoReduction());
    document.getElementById("btn-reduction-reset").addEventListener("click", () => this.resetReductionPlayback());

    // Canvas Viewport Controls
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      this.renderer.zoom = Math.min(2.5, this.renderer.zoom * 1.2);
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      this.renderer.zoom = Math.max(0.3, this.renderer.zoom * 0.8);
    });
    document.getElementById("btn-fit-view").addEventListener("click", () => this.renderer.fitView());
    document.getElementById("btn-recenter").addEventListener("click", () => {
      this.renderer.fitView();
    });

    // Matrix Tabs
    document.querySelectorAll(".matrix-tab").forEach(tab => {
      tab.addEventListener("click", (e) => {
        document.querySelectorAll(".matrix-tab").forEach(t => t.classList.remove("active"));
        e.target.classList.add("active");
        this.matrixTab = e.target.dataset.tab;
        this.renderMatrixTable();
      });
    });

    // Clear Log
    document.getElementById("btn-clear-log").addEventListener("click", () => {
      this.rag.logs = [];
      this.renderLogStream();
    });

    // Global Node Selection Callback
    window.onNodeSelected = (nodeInfo) => this.renderInspector(nodeInfo);
  }

  // ---------------------------------------------------------------------------
  // Preset Scenarios
  // ---------------------------------------------------------------------------

  setActivePresetButton(id) {
    document.querySelectorAll(".btn-preset").forEach(b => b.classList.remove("active"));
    const target = document.getElementById(id);
    if (target) target.classList.add("active");
  }

  loadScenarioA() {
    this.setActivePresetButton("btn-scenario-a");
    this.rag = new RAGCore();
    this.renderer.rag = this.rag;

    this.rag.addResource("R1", 1, 650, 180);
    this.rag.addResource("R2", 1, 650, 320);
    this.rag.addProcess("P1", 220, 180);
    this.rag.addProcess("P2", 220, 320);

    this.rag.requestResource("P1", "R1", 1);
    this.rag.requestResource("P2", "R2", 1);
    this.rag.log("SCENARIO", "Loaded Scenario A: Safe Execution (No Cycle).");

    this.updateAll();
    this.renderer.fitView();
  }

  loadScenarioB() {
    this.setActivePresetButton("btn-scenario-b");
    this.rag = new RAGCore();
    this.renderer.rag = this.rag;

    this.rag.addResource("R1", 1, 650, 180);
    this.rag.addResource("R2", 1, 650, 320);
    this.rag.addProcess("P1", 220, 180);
    this.rag.addProcess("P2", 220, 320);

    this.rag.requestResource("P1", "R1", 1);
    this.rag.requestResource("P2", "R2", 1);
    this.rag.requestResource("P1", "R2", 1); // Cross requests -> deadlock
    this.rag.requestResource("P2", "R1", 1);

    this.rag.log("SCENARIO", "Loaded Scenario B: Single-Instance Deadlock Loop.");
    this.updateAll();
    this.renderer.fitView();
  }

  loadScenarioC() {
    this.setActivePresetButton("btn-scenario-c");
    this.rag = new RAGCore();
    this.renderer.rag = this.rag;

    this.rag.addResource("R1", 2, 650, 160);
    this.rag.addResource("R2", 2, 650, 340);
    this.rag.addProcess("P1", 220, 150);
    this.rag.addProcess("P2", 220, 270);
    this.rag.addProcess("P3", 220, 390);

    this.rag.requestResource("P1", "R1", 1);
    this.rag.requestResource("P2", "R2", 1);
    this.rag.requestResource("P3", "R1", 1);
    this.rag.requestResource("P3", "R2", 1);

    this.rag.requestResource("P1", "R2", 1); // Cycle P1-R2-P2-R1-P1
    this.rag.requestResource("P2", "R1", 1);

    this.rag.log("SCENARIO", "Loaded Scenario C: Multi-Instance Cycle with NO Deadlock.");
    this.updateAll();
    this.renderer.fitView();
  }

  loadScenarioD() {
    this.setActivePresetButton("btn-scenario-d");
    this.rag = new RAGCore();
    this.renderer.rag = this.rag;

    this.rag.addResource("R1", 2, 650, 180);
    this.rag.addResource("R2", 2, 650, 340);
    this.rag.addProcess("P1", 220, 140);
    this.rag.addProcess("P2", 220, 220);
    this.rag.addProcess("P3", 220, 300);
    this.rag.addProcess("P4", 220, 380);

    this.rag.requestResource("P1", "R1", 1);
    this.rag.requestResource("P3", "R1", 1);
    this.rag.requestResource("P2", "R2", 1);
    this.rag.requestResource("P4", "R2", 1);

    this.rag.requestResource("P1", "R2", 1);
    this.rag.requestResource("P2", "R1", 1);
    this.rag.requestResource("P3", "R2", 1);
    this.rag.requestResource("P4", "R1", 1);

    this.rag.log("SCENARIO", "Loaded Scenario D: Multi-Instance Cycle WITH Deadlock.");
    this.updateAll();
    this.renderer.fitView();
  }

  loadRandomScenario() {
    this.setActivePresetButton("btn-scenario-random");
    this.rag = new RAGCore();
    this.renderer.rag = this.rag;
    this.renderer.selectedNode = null;

    // Pick a random topology theme:
    // 0: Classic circular wait deadlock
    // 1: Safe state (independent / balanced allocations)
    // 2: Multi-instance cycle (reducible or deadlocked)
    const mode = Math.floor(Math.random() * 3);

    const procCount = Math.floor(Math.random() * 2) + 2; // 2 to 3 processes
    const resCount = Math.floor(Math.random() * 2) + 2;  // 2 to 3 resources

    const pIds = [];
    for (let i = 1; i <= procCount; i++) pIds.push(`P${i}`);
    const rIds = [];
    for (let j = 1; j <= resCount; j++) rIds.push(`R${j}`);

    const pSpacing = 120;
    const rSpacing = 120;
    const startPY = 260 - ((procCount - 1) * pSpacing) / 2;
    const startRY = 260 - ((resCount - 1) * rSpacing) / 2;

    // Add Resources
    rIds.forEach((rId, idx) => {
      let cap = 1;
      if (mode === 2) {
        cap = Math.floor(Math.random() * 2) + 2; // 2 or 3 instances
      } else if (Math.random() > 0.6) {
        cap = 2;
      }
      const rx = 650 + (Math.random() * 16 - 8);
      const ry = startRY + idx * rSpacing + (Math.random() * 12 - 6);
      this.rag.addResource(rId, cap, Math.round(rx), Math.round(ry));
    });

    // Add Processes
    pIds.forEach((pId, idx) => {
      const px = 220 + (Math.random() * 16 - 8);
      const py = startPY + idx * pSpacing + (Math.random() * 12 - 6);
      this.rag.addProcess(pId, Math.round(px), Math.round(py));
    });

    if (mode === 0) {
      // Classic Circular Wait (Deadlock)
      // P1 holds R1, requests R2
      // P2 holds R2, requests R1
      this.rag.requestResource(pIds[0], rIds[0], 1);
      this.rag.requestResource(pIds[1], rIds[1], 1);
      this.rag.requestResource(pIds[0], rIds[1], 1); // blocked
      this.rag.requestResource(pIds[1], rIds[0], 1); // blocked -> cycle!
      if (procCount >= 3 && resCount >= 3) {
        this.rag.requestResource(pIds[2], rIds[2], 1);
      }
      this.rag.log("RANDOM", `Generated Random Scenario: Deadlock Loop (${procCount} Processes, ${resCount} Resources).`);
    } else if (mode === 1) {
      // Safe Execution
      this.rag.requestResource(pIds[0], rIds[0], 1);
      this.rag.requestResource(pIds[1], rIds[1], 1);
      if (procCount >= 3) {
        if (resCount >= 3) this.rag.requestResource(pIds[2], rIds[2], 1);
        else this.rag.requestResource(pIds[2], rIds[0], 1);
      }
      this.rag.log("RANDOM", `Generated Random Scenario: Safe Execution (${procCount} Processes, ${resCount} Resources).`);
    } else {
      // Multi-instance scenario with cycles
      this.rag.requestResource(pIds[0], rIds[0], 1);
      this.rag.requestResource(pIds[1], rIds[1], 1);
      if (procCount >= 3) {
        this.rag.requestResource(pIds[2], rIds[0], 1);
        this.rag.requestResource(pIds[2], rIds[1], 1);
      }
      this.rag.requestResource(pIds[0], rIds[1], 1);
      this.rag.requestResource(pIds[1], rIds[0], 1);
      this.rag.log("RANDOM", `Generated Random Scenario: Multi-Instance Topology (${procCount} Processes, ${resCount} Resources).`);
    }

    this.updateAll();
    this.renderer.fitView();
  }

  setPlacementMode(mode) {
    this.renderer.placementMode = mode;
    document.querySelectorAll(".btn-mode").forEach(btn => btn.classList.remove("active"));
    const target = document.getElementById(`btn-mode-${mode}`);
    if (target) target.classList.add("active");
    this.renderer.updateCursor();
  }

  handleCanvasPlaced(type, x, y) {
    if (type === "process") {
      const input = document.getElementById("input-process-id");
      let id = input ? input.value.trim() : "";
      if (!id || this.rag.processes[id]) {
        let i = 1;
        while (this.rag.processes[`P${i}`]) i++;
        id = `P${i}`;
      }
      if (input) input.value = "";
      try {
        this.rag.addProcess(id, Math.round(x), Math.round(y));
        this.updateAll();
      } catch (err) {
        alert(err.message);
      }
    } else if (type === "resource") {
      const inputId = document.getElementById("input-resource-id");
      const inputCap = document.getElementById("input-resource-capacity");
      let id = inputId ? inputId.value.trim() : "";
      const cap = inputCap ? (parseInt(inputCap.value, 10) || 1) : 1;
      if (!id || this.rag.resources[id]) {
        let i = 1;
        while (this.rag.resources[`R${i}`]) i++;
        id = `R${i}`;
      }
      if (inputId) inputId.value = "";
      try {
        this.rag.addResource(id, cap, Math.round(x), Math.round(y));
        this.updateAll();
      } catch (err) {
        alert(err.message);
      }
    }
  }

  openInstructionsModal() {
    const modal = document.getElementById("instructions-modal");
    if (modal) modal.classList.remove("hidden");
  }

  closeInstructionsModal() {
    const modal = document.getElementById("instructions-modal");
    if (modal) modal.classList.add("hidden");
  }

  copyInterpretation() {
    if (!this.currentInterpretationText || this.currentInterpretationText.length === 0) return;
    const text = this.currentInterpretationText.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById("btn-copy-interpretation");
      if (btn) {
        const orig = btn.innerText;
        btn.innerText = "✓ Copied!";
        setTimeout(() => { btn.innerText = orig; }, 1800);
      }
    }).catch(() => {
      alert(text);
    });
  }

  resetGraph() {
    this.rag = new RAGCore();
    this.renderer.rag = this.rag;
    this.renderer.selectedNode = null;
    this.setActivePresetButton(null);
    this.updateAll();
  }

  // ---------------------------------------------------------------------------
  // Handlers for Add / Dynamic Operations
  // ---------------------------------------------------------------------------

  handleAddProcess() {
    const input = document.getElementById("input-process-id");
    const id = input.value.trim();
    if (!id) return;
    try {
      this.rag.addProcess(id);
      input.value = "";
      this.updateAll();
    } catch (err) {
      alert(err.message);
    }
  }

  handleAddResource() {
    const inputId = document.getElementById("input-resource-id");
    const inputCap = document.getElementById("input-resource-capacity");
    const id = inputId.value.trim();
    const cap = parseInt(inputCap.value, 10);
    if (!id) return;
    try {
      this.rag.addResource(id, cap);
      inputId.value = "";
      this.updateAll();
    } catch (err) {
      alert(err.message);
    }
  }

  handleOpRequest() {
    const pId = document.getElementById("select-op-process").value;
    const rId = document.getElementById("select-op-resource").value;
    const count = parseInt(document.getElementById("input-op-count").value, 10);
    if (!pId || !rId) return;
    try {
      this.rag.requestResource(pId, rId, count);
      this.updateAll();
    } catch (err) {
      alert(err.message);
    }
  }

  handleOpRelease() {
    const pId = document.getElementById("select-op-process").value;
    const rId = document.getElementById("select-op-resource").value;
    const count = parseInt(document.getElementById("input-op-count").value, 10);
    if (!pId || !rId) return;
    try {
      this.rag.releaseResource(pId, rId, count);
      this.updateAll();
    } catch (err) {
      alert(err.message);
    }
  }

  handleOpClaim() {
    const pId = document.getElementById("select-op-process").value;
    const rId = document.getElementById("select-op-resource").value;
    const count = parseInt(document.getElementById("input-op-count").value, 10);
    if (!pId || !rId) return;
    try {
      this.rag.setClaim(pId, rId, count);
      this.updateAll();
    } catch (err) {
      alert(err.message);
    }
  }

  handleOpTerminate() {
    const pId = document.getElementById("select-op-process").value;
    if (!pId) return;
    try {
      this.rag.terminateProcess(pId);
      this.updateAll();
    } catch (err) {
      alert(err.message);
    }
  }

  exportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(this.rag.toJSON());
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `rag_state_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        this.rag.fromJSON(event.target.result);
        this.updateAll();
        this.renderer.fitView();
      } catch (err) {
        alert("Failed to parse JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Reduction Playback Controller
  // ---------------------------------------------------------------------------

  resetReductionPlayback() {
    this.reductionStepIdx = 0;
    if (this.reductionAutoTimer) {
      clearInterval(this.reductionAutoTimer);
      this.reductionAutoTimer = null;
      document.getElementById("btn-reduction-auto").innerText = "▶ Auto Play";
    }
    this.renderReductionDisplay();
  }

  prevReductionStep() {
    if (this.reductionStepIdx > 0) {
      this.reductionStepIdx--;
      this.renderReductionDisplay();
    }
  }

  nextReductionStep() {
    const steps = this.renderer.currentReport?.steps || [];
    if (this.reductionStepIdx < steps.length) {
      this.reductionStepIdx++;
      this.renderReductionDisplay();
    }
  }

  toggleAutoReduction() {
    const btn = document.getElementById("btn-reduction-auto");
    if (this.reductionAutoTimer) {
      clearInterval(this.reductionAutoTimer);
      this.reductionAutoTimer = null;
      btn.innerText = "▶ Auto Play";
    } else {
      btn.innerText = "⏸ Pause";
      const steps = this.renderer.currentReport?.steps || [];
      if (this.reductionStepIdx >= steps.length) this.reductionStepIdx = 0;
      this.reductionAutoTimer = setInterval(() => {
        if (this.reductionStepIdx < steps.length) {
          this.reductionStepIdx++;
          this.renderReductionDisplay();
        } else {
          clearInterval(this.reductionAutoTimer);
          this.reductionAutoTimer = null;
          btn.innerText = "▶ Auto Play";
        }
      }, 1200);
    }
  }

  renderReductionDisplay() {
    const steps = this.renderer.currentReport?.steps || [];
    const badge = document.getElementById("reduction-step-badge");
    const desc = document.getElementById("reduction-step-desc");
    const workDiv = document.getElementById("reduction-work-vector");

    if (steps.length === 0) {
      badge.innerText = "No Reduction";
      desc.innerText = "No steps needed (System has no pending active requests).";
      workDiv.innerText = "Work: []";
      return;
    }

    if (this.reductionStepIdx === 0) {
      badge.innerText = `Ready (0 / ${steps.length})`;
      desc.innerText = "Click Next or Auto Play to step through the graph reduction execution.";
      const initialWork = Object.entries(this.rag.resources).map(([r, res]) => `${r}:${res.avail}`).join(", ");
      workDiv.innerText = `Initial Work: [${initialWork}]`;
    } else {
      const step = steps[this.reductionStepIdx - 1];
      badge.innerText = `Step ${step.stepNum} of ${steps.length}`;
      desc.innerText = step.explanation;
      const workStr = Object.entries(step.workAfter).map(([r, c]) => `${r}:${c}`).join(", ");
      workDiv.innerText = `Work Vector: [${workStr}]`;
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnostics & Dashboard Updates
  // ---------------------------------------------------------------------------

  updateAll() {
    this.updateDropdowns();
    this.runDiagnostics();
    this.renderMatrixTable();
    this.renderVectorCards();
    this.renderLogStream();
    this.resetReductionPlayback();

    const emptyOverlay = document.getElementById("canvas-empty-state");
    const hasEntities = Object.keys(this.rag.processes).length > 0 || Object.keys(this.rag.resources).length > 0;
    if (hasEntities) emptyOverlay.classList.add("hidden");
    else emptyOverlay.classList.remove("hidden");
  }

  updateDropdowns() {
    const selP = document.getElementById("select-op-process");
    const selR = document.getElementById("select-op-resource");
    const curP = selP.value;
    const curR = selR.value;

    selP.innerHTML = "";
    for (const pId of Object.keys(this.rag.processes)) {
      const opt = document.createElement("option");
      opt.value = pId;
      opt.innerText = pId;
      selP.appendChild(opt);
    }
    if (this.rag.processes[curP]) selP.value = curP;

    selR.innerHTML = "";
    for (const rId of Object.keys(this.rag.resources)) {
      const opt = document.createElement("option");
      opt.value = rId;
      opt.innerText = rId;
      selR.appendChild(opt);
    }
    if (this.rag.resources[curR]) selR.value = curR;
  }

  runDiagnostics() {
    const report = DeadlockAnalyzer.analyze(this.rag);
    this.renderer.currentReport = report;

    const banner = document.getElementById("diagnostic-banner");
    banner.classList.remove("status-safe", "status-safe-cycle", "status-deadlock");

    const titleEl = document.getElementById("status-title");
    const summaryEl = document.getElementById("status-summary");

    if (report.status === "NO_DEADLOCK") {
      banner.classList.add("status-safe");
      titleEl.innerText = "SAFE STATE (NO CYCLES)";
    } else if (report.status === "SAFE_STATE") {
      banner.classList.add("status-safe-cycle");
      titleEl.innerText = "SAFE STATE (CYCLE REDUCIBLE)";
    } else {
      banner.classList.add("status-deadlock");
      titleEl.innerText = "DEADLOCK CONFIRMED";
    }

    summaryEl.innerText = report.message;

    document.getElementById("val-cycle-count").innerText = report.cycles.length;
    document.getElementById("val-deadlocked-procs-count").innerText = report.deadlockedProcs.length;
    document.getElementById("val-is-single").innerText = report.allSingleInstance ? "Yes" : "No";
    document.getElementById("val-is-reducible").innerText = report.reducible ? "Yes" : "No";

    const cyclesContent = document.getElementById("cycles-list-content");
    if (report.cycles.length > 0) {
      cyclesContent.innerHTML = report.cycles.map((c, i) => `#${i+1}: ${c.join(" &rarr; ")}`).join("<br>");
    } else {
      cyclesContent.innerText = "None (Acyclic graph)";
    }

    // Update Real-Time Plain-English Graph Interpretation Panel (Below Graph)
    this.renderInterpretation(report);
  }

  renderInterpretation(report) {
    const box = document.getElementById("interpretation-sentences-box");
    const conclusionEl = document.getElementById("interpretation-conclusion");
    const badgeEl = document.getElementById("interpretation-badge");
    const indicatorEl = document.getElementById("interpretation-indicator");

    if (!box || !conclusionEl) return;

    const procs = Object.keys(this.rag.processes).sort();
    const res = Object.keys(this.rag.resources).sort();

    // Reset status classes
    badgeEl.className = "interpretation-badge";
    indicatorEl.className = "interpretation-indicator";
    conclusionEl.className = "interpretation-conclusion";

    if (report.status === "DEADLOCK_CONFIRMED") {
      badgeEl.classList.add("badge-deadlock");
      badgeEl.innerText = "Deadlock Confirmed";
      indicatorEl.classList.add("state-deadlock");
      conclusionEl.classList.add("conclusion-deadlock");
    } else if (report.status === "SAFE_STATE") {
      badgeEl.classList.add("badge-warning");
      badgeEl.innerText = "Cycle Reducible (Safe)";
      indicatorEl.classList.add("state-warning");
      conclusionEl.classList.add("conclusion-warning");
    } else {
      badgeEl.innerText = "Safe Execution";
    }

    if (procs.length === 0 && res.length === 0) {
      box.innerHTML = `<p class="interpretation-placeholder">Graph is currently empty. Choose a preset scenario above or place processes &amp; resources on the canvas.</p>`;
      conclusionEl.innerHTML = `<strong>System State:</strong> No processes or resources currently modeled.`;
      this.currentInterpretationText = ["Graph is empty."];
      return;
    }

    let sentencesHTML = "";
    this.currentInterpretationText = [];

    // Build process-by-process sentences
    if (procs.length === 0) {
      sentencesHTML = `<p class="interpretation-placeholder">No processes added yet. Resources in system: ${res.map(r => `${r} (${this.rag.resources[r].total} total)`).join(", ")}.</p>`;
      this.currentInterpretationText.push(`Resources in system: ${res.map(r => `${r} (${this.rag.resources[r].total} total)`).join(", ")}`);
    } else {
      procs.forEach(pId => {
        const p = this.rag.processes[pId];
        const held = Object.entries(this.rag.allocations[pId] || {}).filter(([, c]) => c > 0);
        const reqs = Object.entries(this.rag.requests[pId] || {}).filter(([, c]) => c > 0);

        let heldText = "";
        let heldHTML = "";
        if (held.length > 0) {
          heldText = held.map(([r, c]) => (c === 1 ? r : `${c} instances of ${r}`)).join(" and ");
          heldHTML = held.map(([r, c]) => (c === 1 ? `<span class="res-tag">${r}</span>` : `${c} instances of <span class="res-tag">${r}</span>`)).join(" and ");
        }

        let reqText = "";
        let reqHTML = "";
        if (reqs.length > 0) {
          reqText = reqs.map(([r, c]) => (c === 1 ? `an instance to ${r}` : `${c} instances to ${r}`)).join(" and ");
          reqHTML = reqs.map(([r, c]) => (c === 1 ? `an instance to <span class="res-tag">${r}</span>` : `${c} instances to <span class="res-tag">${r}</span>`)).join(" and ");
        }

        let sentencePlain = "";
        let sentenceHTML = "";
        const isDeadlocked = (report.deadlockedProcs || []).includes(pId) || p.state === "Deadlocked";

        let stateBadgeHTML = "";
        let stateBadgePlain = "";
        if (isDeadlocked) {
          stateBadgeHTML = `<span class="state-tag deadlocked">Deadlocked</span>`;
          stateBadgePlain = " [Deadlocked]";
        } else if (p.state === "Terminated") {
          stateBadgeHTML = `<span class="state-tag">Terminated</span>`;
          stateBadgePlain = " [Terminated]";
        } else {
          stateBadgeHTML = `<span class="state-tag active">Active</span>`;
          stateBadgePlain = " [Active]";
        }

        if (held.length > 0 && reqs.length > 0) {
          sentencePlain = `${pId} holds ${heldText} and requests ${reqText}${stateBadgePlain}.`;
          sentenceHTML = `<span class="proc-tag">${pId}</span> holds ${heldHTML} and requests ${reqHTML} ${stateBadgeHTML}`;
        } else if (held.length > 0) {
          sentencePlain = `${pId} holds ${heldText} and has no pending requests${stateBadgePlain}.`;
          sentenceHTML = `<span class="proc-tag">${pId}</span> holds ${heldHTML} and has no pending requests ${stateBadgeHTML}`;
        } else if (reqs.length > 0) {
          sentencePlain = `${pId} holds no resources and requests ${reqText}${stateBadgePlain}.`;
          sentenceHTML = `<span class="proc-tag">${pId}</span> holds no resources and requests ${reqHTML} ${stateBadgeHTML}`;
        } else {
          sentencePlain = `${pId} is idle with no allocations or requests${stateBadgePlain}.`;
          sentenceHTML = `<span class="proc-tag">${pId}</span> is idle with no allocations or requests ${stateBadgeHTML}`;
        }

        this.currentInterpretationText.push(sentencePlain);
        sentencesHTML += `<div class="interpretation-sentence-item"><span class="interpretation-bullet">&bull;</span> ${sentenceHTML}</div>`;
      });
    }

    box.innerHTML = sentencesHTML;

    // Build overall conclusion sentence
    let conclusionPlain = "";
    let conclusionHTML = "";
    if (report.status === "DEADLOCK_CONFIRMED") {
      const deadlockedStr = report.deadlockedProcs.join(", ");
      const cycleStrs = (report.cycles || []).map(c => c.join(" → ")).join("; ");
      if (cycleStrs) {
        conclusionPlain = `Verdict: DEADLOCK CONFIRMED! Processes [${deadlockedStr}] are caught in a circular wait (${cycleStrs}). None of these processes can proceed because each is waiting for a resource held by another.`;
        conclusionHTML = `<strong>Verdict: DEADLOCK CONFIRMED!</strong> Process${report.deadlockedProcs.length > 1 ? "es" : ""} <strong>[${deadlockedStr}]</strong> are caught in a circular wait: <span style="font-family: var(--font-mono); color: #ff85a1;">${cycleStrs}</span>. Neither process can proceed because all requested resources are held.`;
      } else {
        conclusionPlain = `Verdict: DEADLOCK CONFIRMED! Process(es) [${deadlockedStr}] requested resource instance(s) that are fully held with 0 free instances. Immediate Deadlock!`;
        conclusionHTML = `<strong>Verdict: DEADLOCK CONFIRMED!</strong> Process${report.deadlockedProcs.length > 1 ? "es" : ""} <strong>[${deadlockedStr}]</strong> requested resource instance(s) that are fully allocated to another process with 0 free instances. Immediate Deadlock!`;
      }
    } else if (report.status === "SAFE_STATE") {
      const cycleStrs = (report.cycles || []).map(c => c.join(" → ")).join("; ");
      conclusionPlain = `Verdict: SAFE STATE (CYCLE REDUCIBLE). A cycle exists (${cycleStrs}), but resources have multiple copies. The system can safely satisfy processes outside the cycle first, resolving the wait without deadlock.`;
      conclusionHTML = `<strong>Verdict: SAFE STATE (CYCLE REDUCIBLE).</strong> A cycle is present (<span style="font-family: var(--font-mono); color: var(--color-warning);">${cycleStrs}</span>), but resources have multiple instances. Unblocked processes can complete first and release instances to resolve the cycle safely.`;
    } else {
      conclusionPlain = `Verdict: SAFE EXECUTION. No circular wait exists. All running processes can acquire their needed resources and run to completion safely.`;
      conclusionHTML = `<strong>Verdict: SAFE EXECUTION.</strong> No circular dependencies or deadlocks. All processes can proceed safely.`;
    }

    this.currentInterpretationText.push(conclusionPlain);
    conclusionEl.innerHTML = conclusionHTML;
  }

  renderMatrixTable() {
    const table = document.getElementById("matrix-table");
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    const procs = Object.keys(this.rag.processes).sort();
    const res = Object.keys(this.rag.resources).sort();
    if (procs.length === 0 || res.length === 0) {
      thead.innerHTML = "<tr><th>Empty Matrix</th></tr>";
      return;
    }

    // Build Header
    let trHead = "<tr><th>Process</th>";
    if (this.matrixTab === "combined" || this.matrixTab === "alloc") {
      res.forEach(r => trHead += `<th>Alloc ${r}</th>`);
    }
    if (this.matrixTab === "combined" || this.matrixTab === "req") {
      res.forEach(r => trHead += `<th>Req ${r}</th>`);
    }
    trHead += "</tr>";
    thead.innerHTML = trHead;

    // Build Rows
    procs.forEach(pId => {
      let tr = `<tr><td>${pId}</td>`;
      if (this.matrixTab === "combined" || this.matrixTab === "alloc") {
        res.forEach(rId => {
          const val = this.rag.allocations[pId][rId] || 0;
          tr += `<td class="${val > 0 ? 'val-alloc val-nonzero' : ''}">${val}</td>`;
        });
      }
      if (this.matrixTab === "combined" || this.matrixTab === "req") {
        res.forEach(rId => {
          const val = this.rag.requests[pId][rId] || 0;
          tr += `<td class="${val > 0 ? 'val-req val-nonzero' : ''}">${val}</td>`;
        });
      }
      tr += "</tr>";
      tbody.innerHTML += tr;
    });
  }

  renderVectorCards() {
    const container = document.getElementById("vector-cards-row");
    container.innerHTML = "";

    const res = Object.keys(this.rag.resources).sort();
    if (res.length === 0) return;

    const availVals = res.map(r => `${r}:${this.rag.resources[r].avail}`).join(" ");
    const totalVals = res.map(r => `${r}:${this.rag.resources[r].total}`).join(" ");

    container.innerHTML = `
      <div class="vector-card">
        <div class="vector-card-title">AVAILABLE VECTOR (A)</div>
        <div class="vector-card-vals" style="color: var(--color-success);">${availVals}</div>
      </div>
      <div class="vector-card">
        <div class="vector-card-title">CAPACITY VECTOR (C)</div>
        <div class="vector-card-vals">${totalVals}</div>
      </div>
    `;
  }

  renderInspector(hit) {
    const card = document.getElementById("inspector-card");
    const titleEl = document.getElementById("inspector-target-name");

    if (!hit) {
      titleEl.innerText = "None Selected";
      card.innerHTML = `<p class="empty-hint">Click any Process or Resource in the graph to inspect details.</p>`;
      return;
    }

    if (hit.type === "process") {
      const p = this.rag.processes[hit.id];
      titleEl.innerText = `Process (${p.id})`;

      const held = Object.entries(this.rag.allocations[p.id] || {})
        .filter(([, c]) => c > 0).map(([r, c]) => `${r}:${c}`).join(", ") || "None";
      const waiting = Object.entries(this.rag.requests[p.id] || {})
        .filter(([, c]) => c > 0).map(([r, c]) => `${r}:${c}`).join(", ") || "None";

      card.innerHTML = `
        <div class="inspector-details">
          <div class="inspector-row"><span class="inspector-label">Process ID:</span><span class="inspector-val">${p.id}</span></div>
          <div class="inspector-row"><span class="inspector-label">State:</span><span class="inspector-val">${p.state}</span></div>
          <div class="inspector-row"><span class="inspector-label">Allocated:</span><span class="inspector-val">${held}</span></div>
          <div class="inspector-row"><span class="inspector-label">Waiting On:</span><span class="inspector-val">${waiting}</span></div>
          <div class="inspector-actions">
            <button class="btn btn-xs btn-terminate" id="btn-insp-term">Terminate Process</button>
            <button class="btn btn-xs btn-outline" id="btn-insp-delete">Remove</button>
          </div>
        </div>
      `;

      document.getElementById("btn-insp-term").addEventListener("click", () => {
        this.rag.terminateProcess(p.id);
        this.updateAll();
      });
      document.getElementById("btn-insp-delete").addEventListener("click", () => {
        this.rag.removeProcess(p.id);
        this.renderer.selectedNode = null;
        this.updateAll();
      });

    } else if (hit.type === "resource") {
      const r = this.rag.resources[hit.id];
      titleEl.innerText = `Resource [${r.id}]`;

      const queue = this.rag.waitingQueues[r.id] || [];
      const queueStr = queue.length > 0 ? queue.join(" &rarr; ") : "Empty";

      card.innerHTML = `
        <div class="inspector-details">
          <div class="inspector-row"><span class="inspector-label">Resource ID:</span><span class="inspector-val">${r.id}</span></div>
          <div class="inspector-row"><span class="inspector-label">Total Instances:</span><span class="inspector-val">${r.total}</span></div>
          <div class="inspector-row"><span class="inspector-label">Available:</span><span class="inspector-val">${r.avail}</span></div>
          <div class="inspector-row"><span class="inspector-label">FIFO Wait Queue:</span><span class="inspector-val">${queueStr}</span></div>
          <div class="inspector-actions">
            <button class="btn btn-xs btn-outline" id="btn-insp-delete">Remove Resource</button>
          </div>
        </div>
      `;

      document.getElementById("btn-insp-delete").addEventListener("click", () => {
        this.rag.removeResource(r.id);
        this.renderer.selectedNode = null;
        this.updateAll();
      });
    }
  }

  renderLogStream() {
    const stream = document.getElementById("log-stream");
    stream.innerHTML = "";
    this.rag.logs.forEach(log => {
      let tagClass = "log-tag-granted";
      if (log.tag === "DEADLOCK") tagClass = "log-tag-deadlock";
      else if (log.tag === "RESOLVED" || log.tag === "RELEASED" || log.tag === "FREED") tagClass = "log-tag-released";
      else if (log.tag === "BLOCKED") tagClass = "log-tag-blocked";

      stream.innerHTML += `
        <div class="log-entry">
          <span class="log-time">${log.time}</span>
          <span class="log-tag ${tagClass}">[${log.tag}]</span>
          <span class="log-msg">${log.msg}</span>
        </div>
      `;
    });
  }
}

// Instantiate application on window load
window.addEventListener("DOMContentLoaded", () => {
  window.ragApp = new RAGApp();
});
