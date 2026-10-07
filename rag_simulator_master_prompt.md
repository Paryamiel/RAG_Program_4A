# Master Prompt: Interactive Operating System Resource Allocation Graph (RAG) Simulator

### System Persona & Role
You are an expert Systems Programmer and Software Architect. Your task is to design, implement, and test a fully functional, practical **Resource Allocation Graph (RAG) Simulator & Deadlock Detector**.

---

### Objective
Build an interactive program that allows users to create, modify, visualize, and analyze Operating System Resource Allocation Graphs in real time. The application must accurately model processes, single- and multi-instance resources, request edges, and assignment edges, while evaluating the system for potential or confirmed deadlocks.

---

### Core Functional Requirements

#### 1. Data Model & Graph Engine
Implement a robust graph data structure $G = (V, E)$ supporting:
* **Process Nodes ($P_i$):** Unique identifier, state (Active, Blocked, Terminated).
* **Resource Nodes ($R_j$):** Unique identifier, total capacity $C_j$ (number of instances), available capacity $A_j$.
* **Request Edges ($P_i \to R_j$):** Denotes that process $P_i$ is waiting for one instance of $R_j$.
* **Assignment Edges ($R_j \to P_i$):** Denotes that process $P_i$ holds an instance of $R_j$.
* **Claim Edges ($P_i \dashrightarrow R_j$, Optional/Bonus):** Dashed arrow indicating potential future requests (for Banker's Algorithm/Deadlock Avoidance).

#### 2. Dynamic Operations API / Commands
Expose methods or user interactions for the following dynamic OS actions:
* `add_process(id)` / `remove_process(id)`
* `add_resource(id, total_instances)` / `remove_resource(id)`
* `request_resource(process_id, resource_id)`:
  * Adds a request edge $P_i \to R_j$.
  * If an instance is free, automatically converts the request edge into an assignment edge $R_j \to P_i$.
  * If no instances are free, keeps $P_i$ in a **Blocked** state with the request edge intact.
* `release_resource(process_id, resource_id)`:
  * Removes an assignment edge $R_j \to P_i$.
  * If processes are blocked on $R_j$, allocates the freed instance to a waiting process (e.g., FIFO or priority-based).
* `terminate_process(process_id)`: Releases all held assignment edges and clears pending request edges.

#### 3. Deadlock Detection Engine
Implement a real-time cycle detection and deadlock evaluation algorithm:
* **Cycle Detection:** Run DFS/Tarjan’s/Kahn’s algorithm to detect directed cycles in $G$.
* **Analysis Rules:**
  1. **No Cycle:** Report **"No Deadlock"**.
  2. **Cycle + Single-Instance Resources Only:** Report **"Deadlock Confirmed"** and highlight the specific processes and resources in the deadlocked cycle.
  3. **Cycle + Multi-Instance Resources:**
     * Run a reduction algorithm (similar to the Banker's Algorithm reduction step) to check if processes outside the cycle can complete and free enough instances to unblock the cycle.
     * Report **"Deadlock Confirmed"** if reduction fails, or **"Deadlock Possible / Safe State"** if execution paths exist to clear the cycle.

#### 4. User Interface & Visualization
* **Visual Graph Rendering:** Render processes as circles, resources as rectangles (with internal dots/counters representing instances), request edges as arrows from process to resource, and assignment edges as arrows from resource to process.
* **Status Dashboard:** Display:
  * Current system state (**Safe** / **Deadlock Imminent** / **Deadlocked**).
  * List of currently deadlocked processes (if any).
  * Live adjacency matrix or resource allocation/request tables.
* **Preset Test Scenarios:** Provide pre-built scenario buttons/configurations to instantly load:
  * *Scenario A:* Safe Execution (No cycle).
  * *Scenario B:* Single-Instance Deadlock (Classic 2-process, 2-resource deadlock loop).
  * *Scenario C:* Multi-Instance Cycle with NO Deadlock (Process outside cycle releases resource).
  * *Scenario D:* Multi-Instance Cycle WITH Deadlock.

---

### Technical Recommendations & Tech Stack Choices
Select one of the following stack options based on your build environment:
* **Option A (Web-Based / Interactive GUI):** HTML5 Canvas / React / Vue with `vis.js`, `D3.js`, or `Cytoscape.js` for graph rendering.
* **Option B (Desktop GUI):** Python (`customtkinter` or `PyQt`) with `NetworkX` and `Matplotlib` / `PyVis`.
* **Option C (CLI / Terminal Engine):** Python or C++ with formatted ASCII graph representations and detailed state logs.

---

### Deliverables Required
1. **Source Code:** Modular, clean, well-commented code separating graph logic, deadlock detection, and UI.
2. **README / Documentation:** Setup instructions, execution steps, and explanation of graph reduction/cycle detection algorithms used.
3. **Automated Unit Tests:** Test suite verifying edge cases (e.g., double release, requesting non-existent resources, cycle detection with multi-instance resolution).

---

### Execution Instructions
Begin by outlining the system architecture, data models, and step-by-step implementation plan before generating the codebase. Ensure the final app works cleanly out-of-the-box.