"""
Deadlock Detection Engine for Operating System Resource Allocation Graphs.
Implements:
1. Cycle Detection (DFS Back-Edge traversal with cycle path recovery).
2. Single-Instance Cycle Theorem Evaluation.
3. Multi-Instance Graph Reduction Algorithm (Banker's Reduction Step) with step-by-step trace generation.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
from rag_engine import ResourceAllocationGraph, ProcessState


class DeadlockStatus(str, Enum):
    NO_DEADLOCK = "No Deadlock"
    SAFE_STATE = "Safe State (Cycle Reducible)"
    DEADLOCK_CONFIRMED = "Deadlock Confirmed"


@dataclass
class ReductionStep:
    step_num: int
    process_id: str
    work_before: Dict[str, int]
    allocated_freed: Dict[str, int]
    work_after: Dict[str, int]
    explanation: str

    def to_dict(self) -> Dict:
        return {
            "step_num": self.step_num,
            "process_id": self.process_id,
            "work_before": self.work_before,
            "allocated_freed": self.allocated_freed,
            "work_after": self.work_after,
            "explanation": self.explanation
        }


@dataclass
class DeadlockReport:
    status: DeadlockStatus
    has_cycle: bool
    cycles: List[List[str]]
    is_single_instance_only: bool
    deadlocked_processes: List[str]
    deadlocked_resources: List[str]
    reduction_successful: bool
    reduction_steps: List[ReductionStep]
    summary_message: str

    def to_dict(self) -> Dict:
        return {
            "status": self.status.value,
            "has_cycle": self.has_cycle,
            "cycles": self.cycles,
            "is_single_instance_only": self.is_single_instance_only,
            "deadlocked_processes": self.deadlocked_processes,
            "deadlocked_resources": self.deadlocked_resources,
            "reduction_successful": self.reduction_successful,
            "reduction_steps": [s.to_dict() for s in self.reduction_steps],
            "summary_message": self.summary_message
        }


class DeadlockDetector:
    """
    Evaluates a ResourceAllocationGraph for cycles and deadlocks according to OS RAG theorems.
    """

    def __init__(self, rag: ResourceAllocationGraph):
        self.rag = rag

    # -------------------------------------------------------------
    # 1. Directed Cycle Detection
    # -------------------------------------------------------------

    def find_all_cycles(self) -> List[List[str]]:
        """
        Builds directed adjacency list for active graph:
          Request edges: P_i -> R_j
          Assignment edges: R_j -> P_i
        Finds directed cycles using depth-first search with 3-color states.
        Returns list of cycle paths e.g. [['P1', 'R2', 'P2', 'R1', 'P1']].
        """
        adj: Dict[str, List[str]] = {}
        for p_id in self.rag.processes:
            adj[p_id] = []
        for r_id in self.rag.resources:
            adj[r_id] = []

        # Request edges: P -> R
        for p_id, req_map in self.rag.requests.items():
            for r_id, count in req_map.items():
                if count > 0:
                    adj[p_id].append(r_id)

        # Assignment edges: R -> P
        for p_id, alloc_map in self.rag.allocations.items():
            for r_id, count in alloc_map.items():
                if count > 0:
                    adj[r_id].append(p_id)

        WHITE, GRAY, BLACK = 0, 1, 2
        color = {node: WHITE for node in adj}
        parent = {node: None for node in adj}
        detected_cycles: List[List[str]] = []
        seen_cycle_signatures: Set[str] = set()

        def dfs(u: str, path: List[str]):
            color[u] = GRAY
            path.append(u)

            for v in adj.get(u, []):
                if color[v] == GRAY:
                    # Cycle found! Reconstruct cycle path from v up to u, plus v
                    try:
                        idx = path.index(v)
                        cycle = path[idx:] + [v]
                        # Canonical representation to avoid duplicate rotational cycles
                        nodes_in_cycle = cycle[:-1]
                        min_node = min(nodes_in_cycle)
                        min_idx = nodes_in_cycle.index(min_node)
                        canonical = nodes_in_cycle[min_idx:] + nodes_in_cycle[:min_idx]
                        sig = "->".join(canonical)
                        if sig not in seen_cycle_signatures:
                            seen_cycle_signatures.add(sig)
                            detected_cycles.append(cycle)
                    except ValueError:
                        pass
                elif color[v] == WHITE:
                    parent[v] = u
                    dfs(v, path)

            path.pop()
            color[u] = BLACK

        for node in list(adj.keys()):
            if color[node] == WHITE:
                dfs(node, [])

        return detected_cycles

    # -------------------------------------------------------------
    # 2. Graph Reduction Algorithm (Multi-Instance Evaluation)
    # -------------------------------------------------------------

    def run_graph_reduction(self) -> Tuple[bool, List[str], List[ReductionStep]]:
        """
        Executes standard Resource Allocation Graph reduction algorithm:
        1. Initialize Work = copy of Available instances for each resource.
        2. Initialize Finish[P_i] = True for terminated processes or processes with 0 allocation & 0 request,
           else False.
        3. Find an un-finished process P_i such that Request[P_i] <= Work.
           If found:
             Work += Allocation[P_i]
             Finish[P_i] = True
             Record step trace.
             Repeat.
        4. If all processes have Finish[P_i] == True, reduction succeeds (no deadlock).
           Else, unfinished processes are Deadlocked.
        """
        # Work vector
        work: Dict[str, int] = {
            r_id: r.available_instances for r_id, r in self.rag.resources.items()
        }

        # Finish vector
        finish: Dict[str, bool] = {}
        for p_id, proc in self.rag.processes.items():
            if proc.state == ProcessState.TERMINATED:
                finish[p_id] = True
            else:
                total_alloc = sum(self.rag.allocations[p_id].values())
                total_req = sum(self.rag.requests[p_id].values())
                if total_alloc == 0 and total_req == 0:
                    finish[p_id] = True
                else:
                    finish[p_id] = False

        reduction_steps: List[ReductionStep] = []
        step_counter = 1

        while True:
            found_candidate: Optional[str] = None
            for p_id, is_finished in finish.items():
                if not is_finished:
                    # Check if Request[p_id][r] <= work[r] for all resources
                    can_satisfy = True
                    for r_id in self.rag.resources:
                        req_count = self.rag.requests[p_id].get(r_id, 0)
                        if req_count > work.get(r_id, 0):
                            can_satisfy = False
                            break
                    if can_satisfy:
                        found_candidate = p_id
                        break

            if found_candidate is not None:
                p_id = found_candidate
                work_before = dict(work)
                freed = dict(self.rag.allocations[p_id])

                # Process acquires requests, executes, and releases all held allocations
                for r_id, alloc_count in freed.items():
                    work[r_id] += alloc_count

                finish[p_id] = True
                work_after = dict(work)

                freed_str = ", ".join(f"{r}:{c}" for r, c in freed.items() if c > 0) or "None"
                explanation = (
                    f"Process '{p_id}' has its requests satisfied by available Work. "
                    f"It completes execution and releases held resources [{freed_str}]."
                )

                reduction_steps.append(ReductionStep(
                    step_num=step_counter,
                    process_id=p_id,
                    work_before=work_before,
                    allocated_freed=freed,
                    work_after=work_after,
                    explanation=explanation
                ))
                step_counter += 1
            else:
                # No more processes can be reduced
                break

        # Check if any processes remain un-finished
        deadlocked_processes = [p_id for p_id, is_done in finish.items() if not is_done]
        reduction_successful = (len(deadlocked_processes) == 0)

        return reduction_successful, deadlocked_processes, reduction_steps

    # -------------------------------------------------------------
    # 3. Comprehensive Analysis
    # -------------------------------------------------------------

    def analyze(self) -> DeadlockReport:
        """
        Executes complete RAG Deadlock Analysis:
        1. Cycle detection (Tarjan/DFS).
        2. Theorem check:
           - Rule 1: No cycle -> No Deadlock.
           - Rule 2: Cycle + Single-instance resources only -> Deadlock Confirmed.
           - Rule 3: Cycle + Multi-instance resources -> Run Graph Reduction.
        """
        cycles = self.find_all_cycles()
        has_cycle = len(cycles) > 0

        # Check if resources involved in cycles (or whole graph) are single-instance
        cycle_resources: Set[str] = set()
        for c in cycles:
            for node in c:
                if node in self.rag.resources:
                    cycle_resources.add(node)

        # Are all resources in the cycles single-instance?
        all_single_instance = True
        if cycle_resources:
            all_single_instance = all(
                self.rag.resources[r].total_instances == 1 for r in cycle_resources
            )
        else:
            all_single_instance = all(
                r.total_instances == 1 for r in self.rag.resources.values()
            ) if self.rag.resources else True

        # Run Graph Reduction
        reduction_successful, deadlocked_procs, reduction_steps = self.run_graph_reduction()

        # Determine deadlocked resources
        deadlocked_resources: Set[str] = set()
        for p_id in deadlocked_procs:
            for r_id, req in self.rag.requests[p_id].items():
                if req > 0:
                    deadlocked_resources.add(r_id)

        # Rule evaluation
        if not has_cycle:
            # Rule 1: No cycle -> No Deadlock
            status = DeadlockStatus.NO_DEADLOCK
            msg = "System is in a Safe State with NO cycles detected. All processes can proceed without circular wait."
            deadlocked_procs = []
            deadlocked_resources = set()

        elif has_cycle and all_single_instance:
            # Rule 2: Cycle in single-instance RAG -> Guaranteed Deadlock
            status = DeadlockStatus.DEADLOCK_CONFIRMED
            # The deadlocked processes are those inside the single-instance cycle
            cycle_procs = set()
            for c in cycles:
                for node in c:
                    if node in self.rag.processes:
                        cycle_procs.add(node)
            # Combine with reduction results
            deadlocked_procs = sorted(list(set(deadlocked_procs).union(cycle_procs)))
            for p_id in deadlocked_procs:
                for r_id, req in self.rag.requests.get(p_id, {}).items():
                    if req > 0:
                        deadlocked_resources.add(r_id)

            cycle_strs = [" -> ".join(c) for c in cycles]
            msg = (
                f"DEADLOCK CONFIRMED! A directed cycle exists in a single-instance resource graph: "
                f"[{'; '.join(cycle_strs)}]. Under OS Single-Instance Theorem, a cycle is a necessary and sufficient condition for deadlock."
            )

        else:
            # Rule 3: Cycle + Multi-instance resources
            if reduction_successful:
                status = DeadlockStatus.SAFE_STATE
                msg = (
                    "Cycle detected, but resources have multiple instances. "
                    "Graph reduction succeeded! Processes outside the cycle can complete and release sufficient instances to break the cycle. System remains in a SAFE state."
                )
                deadlocked_procs = []
                deadlocked_resources = set()
            else:
                status = DeadlockStatus.DEADLOCK_CONFIRMED
                cycle_strs = [" -> ".join(c) for c in cycles]
                msg = (
                    f"DEADLOCK CONFIRMED! Multi-instance graph reduction failed. "
                    f"Remaining processes {deadlocked_procs} cannot be satisfied by available resources. "
                    f"Cycle: [{'; '.join(cycle_strs)}]."
                )

        return DeadlockReport(
            status=status,
            has_cycle=has_cycle,
            cycles=cycles,
            is_single_instance_only=all_single_instance,
            deadlocked_processes=deadlocked_procs,
            deadlocked_resources=sorted(list(deadlocked_resources)),
            reduction_successful=reduction_successful,
            reduction_steps=reduction_steps,
            summary_message=msg
        )
