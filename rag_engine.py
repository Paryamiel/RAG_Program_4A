"""
Resource Allocation Graph (RAG) Data Model & Graph Engine
Models processes, single- and multi-instance resources, request edges,
assignment edges, and optional claim edges with FIFO queue allocation.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
import json


class ProcessState(str, Enum):
    ACTIVE = "Active"
    BLOCKED = "Blocked"
    TERMINATED = "Terminated"


class EdgeType(str, Enum):
    REQUEST = "Request"        # P_i -> R_j (waiting for instance)
    ASSIGNMENT = "Assignment"  # R_j -> P_i (holds instance)
    CLAIM = "Claim"            # P_i -> R_j (potential future request)


@dataclass
class Process:
    id: str
    state: ProcessState = ProcessState.ACTIVE
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "state": self.state.value,
            "metadata": self.metadata
        }


@dataclass
class Resource:
    id: str
    total_instances: int
    available_instances: int

    def __post_init__(self):
        if self.total_instances <= 0:
            raise ValueError(f"Resource {self.id} must have at least 1 instance.")
        if self.available_instances < 0 or self.available_instances > self.total_instances:
            raise ValueError(f"Available instances must be between 0 and total ({self.total_instances}).")

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "total_instances": self.total_instances,
            "available_instances": self.available_instances
        }


class ResourceAllocationGraph:
    """
    Graph G = (V, E) where:
      V = Process Nodes (P) U Resource Nodes (R)
      E = Request Edges (P -> R), Assignment Edges (R -> P), Claim Edges (P -> R)
    """

    def __init__(self):
        self.processes: Dict[str, Process] = {}
        self.resources: Dict[str, Resource] = {}
        # allocations[p_id][r_id] = number of instances allocated to p_id
        self.allocations: Dict[str, Dict[str, int]] = {}
        # requests[p_id][r_id] = number of instances requested by p_id (blocked)
        self.requests: Dict[str, Dict[str, int]] = {}
        # claims[p_id][r_id] = maximum claims declared (for Banker's/avoidance)
        self.claims: Dict[str, Dict[str, int]] = {}
        # FIFO waiting queues: waiting_queues[r_id] = list of process_ids
        self.waiting_queues: Dict[str, List[str]] = {}
        # Event audit log
        self.history: List[str] = []

    def _log(self, message: str) -> None:
        self.history.append(message)

    # -------------------------------------------------------------
    # Node Management
    # -------------------------------------------------------------

    def add_process(self, process_id: str) -> Process:
        process_id = str(process_id).strip()
        if not process_id:
            raise ValueError("Process ID cannot be empty.")
        if process_id in self.processes:
            raise ValueError(f"Process '{process_id}' already exists.")

        proc = Process(id=process_id, state=ProcessState.ACTIVE)
        self.processes[process_id] = proc
        self.allocations[process_id] = {r: 0 for r in self.resources}
        self.requests[process_id] = {r: 0 for r in self.resources}
        self.claims[process_id] = {r: 0 for r in self.resources}
        self._log(f"Added process '{process_id}'.")
        return proc

    def remove_process(self, process_id: str) -> None:
        if process_id not in self.processes:
            raise KeyError(f"Process '{process_id}' does not exist.")

        # Release all held resources first
        self.terminate_process(process_id)

        # Remove from waiting queues
        for r_id in self.waiting_queues:
            self.waiting_queues[r_id] = [p for p in self.waiting_queues[r_id] if p != process_id]

        del self.processes[process_id]
        del self.allocations[process_id]
        del self.requests[process_id]
        del self.claims[process_id]
        self._log(f"Removed process '{process_id}'.")

    def add_resource(self, resource_id: str, total_instances: int = 1) -> Resource:
        resource_id = str(resource_id).strip()
        if not resource_id:
            raise ValueError("Resource ID cannot be empty.")
        if resource_id in self.resources:
            raise ValueError(f"Resource '{resource_id}' already exists.")
        if total_instances < 1:
            raise ValueError("Total instances must be at least 1.")

        res = Resource(
            id=resource_id,
            total_instances=total_instances,
            available_instances=total_instances
        )
        self.resources[resource_id] = res
        self.waiting_queues[resource_id] = []

        # Sync existing processes matrices
        for p_id in self.processes:
            self.allocations[p_id][resource_id] = 0
            self.requests[p_id][resource_id] = 0
            self.claims[p_id][resource_id] = 0

        self._log(f"Added resource '{resource_id}' with {total_instances} instance(s).")
        return res

    def remove_resource(self, resource_id: str) -> None:
        if resource_id not in self.resources:
            raise KeyError(f"Resource '{resource_id}' does not exist.")

        # Remove from allocations, requests, claims
        for p_id in self.processes:
            del self.allocations[p_id][resource_id]
            del self.requests[p_id][resource_id]
            del self.claims[p_id][resource_id]
            self._update_process_state(p_id)

        del self.resources[resource_id]
        del self.waiting_queues[resource_id]
        self._log(f"Removed resource '{resource_id}'.")

    def set_claim(self, process_id: str, resource_id: str, max_instances: int) -> None:
        """Sets Banker's algorithm claim edge (P_i --dash-> R_j)"""
        if process_id not in self.processes:
            raise KeyError(f"Process '{process_id}' does not exist.")
        if resource_id not in self.resources:
            raise KeyError(f"Resource '{resource_id}' does not exist.")
        if max_instances < 0 or max_instances > self.resources[resource_id].total_instances:
            raise ValueError(f"Claim must be between 0 and total capacity {self.resources[resource_id].total_instances}.")

        self.claims[process_id][resource_id] = max_instances
        self._log(f"Process '{process_id}' set claim of {max_instances} on '{resource_id}'.")

    # -------------------------------------------------------------
    # Dynamic Resource Allocation Operations
    # -------------------------------------------------------------

    def request_resource(self, process_id: str, resource_id: str, count: int = 1) -> Dict:
        """
        P_i requests count instance(s) of R_j.
        - If free instances >= count, grants immediately (Assignment edge R_j -> P_i).
        - If not enough free instances, adds Request edge P_i -> R_j and sets P_i to BLOCKED.
        """
        if process_id not in self.processes:
            raise KeyError(f"Process '{process_id}' does not exist.")
        if resource_id not in self.resources:
            raise KeyError(f"Resource '{resource_id}' does not exist.")
        if count <= 0:
            raise ValueError("Requested count must be positive.")

        proc = self.processes[process_id]
        if proc.state == ProcessState.TERMINATED:
            raise ValueError(f"Cannot request resource for terminated process '{process_id}'.")

        res = self.resources[resource_id]

        if count > res.total_instances:
            raise ValueError(f"Process '{process_id}' requested {count} instances, but '{resource_id}' only has {res.total_instances} in total.")

        # Check if requested count can be satisfied right now
        # Also respect FIFO: if queue has other processes, cannot skip ahead unless queue is empty or current is at front
        queue = self.waiting_queues[resource_id]
        is_queue_free = (len(queue) == 0 or (len(queue) > 0 and queue[0] == process_id))

        if res.available_instances >= count and is_queue_free:
            # Grant immediately
            res.available_instances -= count
            self.allocations[process_id][resource_id] += count

            # If it was in queue, remove it
            if process_id in queue:
                queue.remove(process_id)

            self._update_process_state(process_id)
            msg = f"GRANTED: '{process_id}' acquired {count} instance(s) of '{resource_id}'."
            self._log(msg)
            return {
                "success": True,
                "status": "GRANTED",
                "message": msg,
                "process_state": proc.state.value,
                "available": res.available_instances
            }
        else:
            # Not enough instances -> Block process with Request edge
            self.requests[process_id][resource_id] += count
            proc.state = ProcessState.BLOCKED
            if process_id not in queue:
                queue.append(process_id)

            msg = f"BLOCKED: '{process_id}' requested {count} instance(s) of '{resource_id}', but only {res.available_instances} available. Added to wait queue."
            self._log(msg)
            return {
                "success": True,
                "status": "BLOCKED",
                "message": msg,
                "process_state": proc.state.value,
                "available": res.available_instances
            }

    def release_resource(self, process_id: str, resource_id: str, count: int = 1) -> Dict:
        """
        P_i releases count instance(s) of R_j.
        - Decrements allocation.
        - Increases available instances.
        - Checks waiting queue of R_j (FIFO) and automatically allocates to waiting processes if possible.
        """
        if process_id not in self.processes:
            raise KeyError(f"Process '{process_id}' does not exist.")
        if resource_id not in self.resources:
            raise KeyError(f"Resource '{resource_id}' does not exist.")
        if count <= 0:
            raise ValueError("Release count must be positive.")

        current_held = self.allocations[process_id][resource_id]
        if current_held < count:
            raise ValueError(f"Cannot release {count} instances: '{process_id}' only holds {current_held} of '{resource_id}'.")

        res = self.resources[resource_id]
        self.allocations[process_id][resource_id] -= count
        res.available_instances += count
        self._update_process_state(process_id)

        msg = f"RELEASED: '{process_id}' released {count} instance(s) of '{resource_id}'. Available: {res.available_instances}."
        self._log(msg)

        unblocked = self._process_waiting_queue(resource_id)

        return {
            "success": True,
            "status": "RELEASED",
            "message": msg,
            "unblocked_processes": unblocked,
            "available": res.available_instances
        }

    def terminate_process(self, process_id: str) -> Dict:
        """
        Terminates P_i:
        - Releases all held assignment edges.
        - Clears any pending request edges.
        - Sets state to TERMINATED.
        - Unblocks any waiting processes queued on the freed resources.
        """
        if process_id not in self.processes:
            raise KeyError(f"Process '{process_id}' does not exist.")

        proc = self.processes[process_id]
        all_unblocked = []

        # 1. Release all held resources
        held_resources = list(self.allocations[process_id].items())
        for r_id, held_count in held_resources:
            if held_count > 0:
                res = self.resources[r_id]
                self.allocations[process_id][r_id] = 0
                res.available_instances += held_count
                self._log(f"Process '{process_id}' termination freed {held_count} instance(s) of '{r_id}'.")
                unblocked = self._process_waiting_queue(r_id)
                all_unblocked.extend(unblocked)

        # 2. Clear all requests and remove from waiting queues
        for r_id in self.requests[process_id]:
            self.requests[process_id][r_id] = 0
            if process_id in self.waiting_queues.get(r_id, []):
                self.waiting_queues[r_id].remove(process_id)

        proc.state = ProcessState.TERMINATED
        msg = f"TERMINATED: Process '{process_id}' terminated. All resources released."
        self._log(msg)

        return {
            "success": True,
            "status": "TERMINATED",
            "message": msg,
            "unblocked_processes": list(set(all_unblocked))
        }

    # -------------------------------------------------------------
    # Internal Helpers
    # -------------------------------------------------------------

    def _process_waiting_queue(self, resource_id: str) -> List[str]:
        """
        Inspects FIFO waiting queue for resource_id and fulfills requests
        for queued processes if enough instances are now free.
        """
        res = self.resources[resource_id]
        queue = self.waiting_queues[resource_id]
        unblocked = []

        # Iterate over queue
        i = 0
        while i < len(queue) and res.available_instances > 0:
            candidate_p = queue[i]
            needed = self.requests[candidate_p][resource_id]
            if needed > 0 and res.available_instances >= needed:
                # Grant this request
                res.available_instances -= needed
                self.allocations[candidate_p][resource_id] += needed
                self.requests[candidate_p][resource_id] = 0
                queue.pop(i)

                self._update_process_state(candidate_p)
                if self.processes[candidate_p].state == ProcessState.ACTIVE:
                    unblocked.append(candidate_p)

                self._log(f"UNBLOCKED: '{candidate_p}' acquired {needed} instance(s) of '{resource_id}'.")
            else:
                # FIFO blocking: if head of queue can't be fulfilled, we stop to prevent starvation
                break

        return unblocked

    def _update_process_state(self, process_id: str) -> None:
        """Sets process state to BLOCKED if any pending request > 0, else ACTIVE (unless TERMINATED)."""
        proc = self.processes[process_id]
        if proc.state == ProcessState.TERMINATED:
            return

        total_pending = sum(self.requests[process_id].values())
        if total_pending > 0:
            proc.state = ProcessState.BLOCKED
        else:
            proc.state = ProcessState.ACTIVE

    # -------------------------------------------------------------
    # Adjacency, Graph Representation & Snapshots
    # -------------------------------------------------------------

    def get_edges(self) -> List[Dict]:
        """Returns list of all directed edges in the RAG."""
        edges = []
        # Request edges: P_i -> R_j
        for p_id, req_map in self.requests.items():
            for r_id, count in req_map.items():
                if count > 0:
                    edges.append({
                        "from": p_id,
                        "to": r_id,
                        "type": EdgeType.REQUEST.value,
                        "count": count
                    })

        # Assignment edges: R_j -> P_i
        for p_id, alloc_map in self.allocations.items():
            for r_id, count in alloc_map.items():
                if count > 0:
                    edges.append({
                        "from": r_id,
                        "to": p_id,
                        "type": EdgeType.ASSIGNMENT.value,
                        "count": count
                    })

        # Claim edges: P_i -> R_j
        for p_id, claim_map in self.claims.items():
            for r_id, count in claim_map.items():
                if count > 0:
                    edges.append({
                        "from": p_id,
                        "to": r_id,
                        "type": EdgeType.CLAIM.value,
                        "count": count
                    })

        return edges

    def get_adjacency_matrix(self) -> Tuple[List[str], List[List[int]]]:
        """
        Builds a full adjacency matrix containing both Process and Resource nodes.
        Rows and columns ordered: [P1, P2, ..., R1, R2, ...]
        """
        nodes = list(self.processes.keys()) + list(self.resources.keys())
        idx_map = {node_id: i for i, node_id in enumerate(nodes)}
        n = len(nodes)
        matrix = [[0] * n for _ in range(n)]

        # Request edges: P -> R
        for p_id, reqs in self.requests.items():
            for r_id, count in reqs.items():
                if count > 0 and p_id in idx_map and r_id in idx_map:
                    matrix[idx_map[p_id]][idx_map[r_id]] = count

        # Assignment edges: R -> P
        for p_id, allocs in self.allocations.items():
            for r_id, count in allocs.items():
                if count > 0 and p_id in idx_map and r_id in idx_map:
                    matrix[idx_map[r_id]][idx_map[p_id]] = count

        return nodes, matrix

    def to_dict(self) -> Dict:
        """Full state dictionary suitable for JSON serialization and web frontend."""
        return {
            "processes": {p_id: p.to_dict() for p_id, p in self.processes.items()},
            "resources": {r_id: r.to_dict() for r_id, r in self.resources.items()},
            "allocations": self.allocations,
            "requests": self.requests,
            "claims": self.claims,
            "waiting_queues": self.waiting_queues,
            "edges": self.get_edges(),
            "history": self.history[-30:]  # last 30 log events
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, data: Dict) -> "ResourceAllocationGraph":
        rag = cls()
        for r_id, r_info in data.get("resources", {}).items():
            total = r_info.get("total_instances", 1)
            rag.add_resource(r_id, total)

        for p_id, p_info in data.get("processes", {}).items():
            rag.add_process(p_id)

        # Restore allocations
        for p_id, allocs in data.get("allocations", {}).items():
            for r_id, count in allocs.items():
                if count > 0 and p_id in rag.processes and r_id in rag.resources:
                    rag.allocations[p_id][r_id] = count
                    rag.resources[r_id].available_instances -= count

        # Restore requests
        for p_id, reqs in data.get("requests", {}).items():
            for r_id, count in reqs.items():
                if count > 0 and p_id in rag.processes and r_id in rag.resources:
                    rag.requests[p_id][r_id] = count
                    rag.processes[p_id].state = ProcessState.BLOCKED
                    if p_id not in rag.waiting_queues[r_id]:
                        rag.waiting_queues[r_id].append(p_id)

        # Restore claims
        for p_id, claims in data.get("claims", {}).items():
            for r_id, count in claims.items():
                if count > 0 and p_id in rag.processes and r_id in rag.resources:
                    rag.claims[p_id][r_id] = count

        return rag
