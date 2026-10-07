# Interactive Operating System Resource Allocation Graph (RAG) Simulator & Deadlock Detector

An interactive, production-grade Operating System simulator and deadlock evaluation engine. Accurately models processes, single- and multi-instance resources, request and assignment edges, FIFO resource waiting queues, Tarjan/DFS directed cycle detection, and step-by-step multi-instance graph reduction (Banker's Algorithm reduction step).

Includes both a **Web-based GUI** with Canvas physics & diagnostics, and a **Python Terminal CLI** with ASCII graphs and matrix tables.

---

## 📑 Table of Contents
1. [Core Features](#core-features)
2. [Theoretical Principles & Algorithms](#theoretical-principles--algorithms)
   - [Resource Allocation Graph Model $G=(V, E)$](#1-resource-allocation-graph-model-gv-e)
   - [Single-Instance Cycle Theorem](#2-single-instance-cycle-theorem)
   - [Multi-Instance Graph Reduction Algorithm](#3-multi-instance-graph-reduction-algorithm)
3. [Architecture & Project Structure](#architecture--project-structure)
4. [Quick Start & Execution](#quick-start--execution)
   - [Running the Interactive Web GUI](#1-running-the-interactive-web-gui)
   - [Running the Terminal CLI](#2-running-the-terminal-cli)
   - [Running Automated Unit Tests](#3-running-automated-unit-tests)
5. [Pre-built Benchmark Scenarios](#pre-built-benchmark-scenarios)
6. [API & Dynamic Operations](#api--dynamic-operations)

---

## 🌟 Core Features

- **Dual Interaction Modes:**
  - **Web Control Center:** Modern dark glassmorphism dashboard with an interactive Canvas graph, drag-and-drop nodes, glowing deadlock cycle auras, LED dot matrix for resource instances, live matrix tables, and step-by-step reduction playback.
  - **Terminal CLI:** Formatted ANSI terminal engine with ASCII graph representations, Allocation/Request matrix tables, and interactive command loop.
- **Strict OS Simulation Semantics:**
  - $P_i \to R_j$ (Request Edge): Automatically granted if capacity is free; otherwise process enters `Blocked` state and is enqueued into the resource's FIFO wait queue.
  - $R_j \to P_i$ (Assignment Edge): Process holds resource instance.
  - $P_i \dashrightarrow R_j$ (Claim Edge): Banker's algorithm maximum claim preview.
  - `release_resource` & `terminate_process`: Frees instances and immediately awakens waiting processes in strict FIFO order.
- **Deadlock Detection Engine:**
  - Real-time DFS cycle detection with complete cycle path recovery (e.g. `P1 -> R2 -> P2 -> R1 -> P1`).
  - Single-Instance vs. Multi-Instance theorem validation.
  - Full reduction trace generation with Work vector tracking before and after each process unblocks.
- **Zero External Dependencies:** Built using standard Python libraries and vanilla Web technologies (HTML5 / Vanilla CSS / ES6 JavaScript) — runs instantly out-of-the-box!

---

## 🧠 Theoretical Principles & Algorithms

### 1. Resource Allocation Graph Model $G=(V, E)$
A directed graph where vertices $V$ are partitioned into two disjoint sets:
- **Processes ($P = \{P_1, P_2, \dots, P_n\}$):** Rendered as circles. States: `Active`, `Blocked`, `Terminated`.
- **Resources ($R = \{R_1, R_2, \dots, R_m\}$):** Rendered as rounded rectangles. Each resource $R_j$ has total capacity $C_j \ge 1$ and available capacity $A_j \le C_j$.

Edges $E$ represent dynamic state:
- **Request Edge ($P_i \to R_j$):** Process $P_i$ is blocked waiting for an instance of $R_j$.
- **Assignment Edge ($R_j \to P_i$):** An instance of $R_j$ is allocated to $P_i$.
- **Claim Edge ($P_i \dashrightarrow R_j$):** Future potential claim.

### 2. Single-Instance Cycle Theorem
> **Theorem:** In a Resource Allocation Graph where every resource has exactly one instance ($C_j = 1$ for all $j$), **a directed cycle is both a necessary AND sufficient condition for deadlock**.
- If no cycle exists $\implies$ **No Deadlock**.
- If a cycle exists $\implies$ **Deadlock Confirmed**. All processes and resources in the cycle are deadlocked.

### 3. Multi-Instance Graph Reduction Algorithm
When resources have multiple instances ($C_j > 1$), a cycle is a necessary condition, but **NOT** sufficient. A cycle can exist while the system remains completely safe if processes outside (or inside) the cycle can finish and release instances.

The engine executes the formal **Graph Reduction Algorithm**:
1. Let $\text{Work} = \text{Available Vector } A = [A_1, A_2, \dots, A_m]$.
2. Let $\text{Finish}[P_i] = \text{True}$ if $\text{Allocation}[P_i] = \vec{0}$ and $\text{Request}[P_i] = \vec{0}$ (or if terminated), else $\text{False}$.
3. Search for an index $i$ such that:
   $$\text{Finish}[P_i] = \text{False} \quad \text{and} \quad \text{Request}[P_i] \le \text{Work}$$
4. If such $P_i$ is found:
   $$\text{Work} \leftarrow \text{Work} + \text{Allocation}[P_i]$$
   $$\text{Finish}[P_i] \leftarrow \text{True}$$
   Record step trace and repeat step 3.
5. **Termination:**
   - If $\text{Finish}[P_i] = \text{True}$ for all $i$: Graph is **completely reducible** $\implies$ **Safe State (No Deadlock)**.
   - If any $\text{Finish}[P_i] = \text{False}$: Graph is **irreducible** $\implies$ **Deadlock Confirmed**. Processes where $\text{Finish}[P_i] = \text{False}$ are actively deadlocked.

---

## 🏗️ Architecture & Project Structure

```
RAG_Program/
├── rag_engine.py          # Core Graph Data Model & Dynamic Operations (G = (V,E))
├── deadlock_detector.py   # Cycle Detection (DFS) & Graph Reduction Engine
├── simulator.py           # Simulation Coordinator & Scenario Loader
├── cli.py                 # Interactive Terminal CLI with ASCII graph & tables
├── run_server.py          # Local Web Server & Browser Launcher
├── index.html             # Web GUI Control Center
├── style.css              # Glassmorphic Dark UI & Neon Accents
├── app.js                 # HTML5 Canvas Graph Renderer & Client-side Engine
├── tests/
│   └── test_rag.py        # Automated Unit Test Suite (13 tests)
├── rag_simulator_master_prompt.md # Master Prompt Specification
└── README.md              # Documentation & Theoretical Guide
```

---

## 🚀 Quick Start & Execution

### 1. Running the Interactive Web GUI

**Option A (Auto-Launch Server):**
Run the launcher script to start a local server and auto-open your default web browser:
```powershell
python run_server.py
```
Open in browser: [http://localhost:8000/index.html](http://localhost:8000/index.html)

**Option B (Direct File Access):**
Simply double-click `index.html` in Windows Explorer or open it in Google Chrome, Microsoft Edge, or Mozilla Firefox.

### 2. Running the Terminal CLI

**Interactive Shell Mode:**
```powershell
python cli.py
```
Type `help` to list commands, or load benchmark scenarios:
```
rag-sim > load B
rag-sim > matrix
rag-sim > detect
rag-sim > req P1 R1 1
rag-sim > rel P1 R1 1
```

**One-Shot Scenario Evaluation:**
```powershell
python cli.py --scenario B
python cli.py --scenario C
```

### 3. Running Automated Unit Tests

Run the complete test suite:
```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

---

## 🎯 Pre-built Benchmark Scenarios

| Scenario | Title | Graph Structure | Theorem Verdict | Result |
|---|---|---|---|---|
| **Scenario A** | Safe Execution | $P_1 \text{ holds } R_1$; $P_2 \text{ holds } R_2$; no cross requests | Acyclic | **SAFE / NO DEADLOCK** |
| **Scenario B** | Single-Instance Deadlock | $P_1$ holds $R_1$, requests $R_2$; $P_2$ holds $R_2$, requests $R_1$ | Single-instance cycle | **DEADLOCK CONFIRMED** |
| **Scenario C** | Reducible Cycle | $R_1(2), R_2(2)$; Cycle between $P_1 \leftrightarrow P_2$; $P_3$ holds $R_1, R_2$ with no requests | Multi-instance cycle; $P_3$ unblocks cycle | **SAFE STATE (REDUCIBLE)** |
| **Scenario D** | Multi-Instance Deadlock | $R_1(2), R_2(2)$; 4 processes in cross-wait loop; all instances held | Multi-instance cycle; reduction fails | **DEADLOCK CONFIRMED** |

---

## 🛠️ API & Dynamic Operations

| Method | Behavior |
|---|---|
| `add_process(id)` | Adds process $P_i$ in `Active` state. |
| `remove_process(id)` | Terminates process and removes node from graph. |
| `add_resource(id, total_instances)` | Adds resource $R_j$ with total capacity $C_j$ and available $A_j = C_j$. |
| `remove_resource(id)` | Frees allocations and clears requests for resource. |
| `request_resource(p_id, r_id, count)` | If $A_j \ge \text{count}$, adds assignment edge $R_j \to P_i$. Otherwise adds request edge $P_i \to R_j$, sets $P_i$ to `Blocked`, and queues in FIFO. |
| `release_resource(p_id, r_id, count)` | Removes assignment edge $R_j \to P_i$, increments $A_j$, and awakens FIFO waiting processes. |
| `terminate_process(p_id)` | Releases all held resources, clears requests, sets state to `Terminated`, and unblocks queued processes. |
| `set_claim(p_id, r_id, max_count)` | Configures Banker's algorithm claim edge $P_i \dashrightarrow R_j$. |
