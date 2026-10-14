"""
RAG Simulator & Scenario Manager.
Provides pre-built OS benchmark scenarios:
- Scenario A: Safe Execution (No cycle)
- Scenario B: Single-Instance Deadlock (Classic 2-process, 2-resource deadlock loop)
- Scenario C: Multi-Instance Cycle with NO Deadlock (Process outside cycle completes and resolves cycle)
- Scenario D: Multi-Instance Cycle WITH Deadlock (Classic Silberschatz multi-instance deadlock)
"""

import random
from typing import Dict, List, Optional
from rag_engine import ResourceAllocationGraph
from deadlock_detector import DeadlockDetector, DeadlockReport


class RAGSimulator:
    """
    Simulation coordinator for the Resource Allocation Graph.
    Wraps graph mutations, scenario presets, and real-time detection triggers.
    """

    def __init__(self, rag: Optional[ResourceAllocationGraph] = None):
        self.rag = rag if rag is not None else ResourceAllocationGraph()
        self.detector = DeadlockDetector(self.rag)

    def analyze(self) -> DeadlockReport:
        return self.detector.analyze()

    def reset(self) -> None:
        self.rag = ResourceAllocationGraph()
        self.detector = DeadlockDetector(self.rag)

    # -------------------------------------------------------------
    # Preset Benchmark Scenarios
    # -------------------------------------------------------------

    def load_scenario_a(self) -> ResourceAllocationGraph:
        """
        Scenario A: Safe Execution (No Cycle)
        - Processes: P1, P2
        - Resources: R1 (1 instance), R2 (1 instance)
        - P1 holds R1
        - P2 holds R2
        - No mutual requests. Both can proceed and finish safely.
        """
        self.reset()
        self.rag.add_resource("R1", 1)
        self.rag.add_resource("R2", 1)
        self.rag.add_process("P1")
        self.rag.add_process("P2")

        self.rag.request_resource("P1", "R1", 1)  # Granted immediately
        self.rag.request_resource("P2", "R2", 1)  # Granted immediately
        self.rag._log("Loaded Preset Scenario A: Safe Execution (No Cycle).")
        return self.rag

    def load_scenario_b(self) -> ResourceAllocationGraph:
        """
        Scenario B: Single-Instance Deadlock (Classic 2-process, 2-resource loop)
        - Processes: P1, P2
        - Resources: R1 (1), R2 (1)
        - P1 holds R1, requests R2 (Blocked)
        - P2 holds R2, requests R1 (Blocked)
        - Cycle: P1 -> R2 -> P2 -> R1 -> P1
        - Single-instance -> Deadlock Confirmed.
        """
        self.reset()
        self.rag.add_resource("R1", 1)
        self.rag.add_resource("R2", 1)
        self.rag.add_process("P1")
        self.rag.add_process("P2")

        # P1 gets R1, P2 gets R2
        self.rag.request_resource("P1", "R1", 1)
        self.rag.request_resource("P2", "R2", 1)

        # Cross requests cause deadlock loop
        self.rag.request_resource("P1", "R2", 1)
        self.rag.request_resource("P2", "R1", 1)

        self.rag._log("Loaded Preset Scenario B: Single-Instance Deadlock Loop.")
        return self.rag

    def load_scenario_c(self) -> ResourceAllocationGraph:
        """
        Scenario C: Multi-Instance Cycle with NO Deadlock (Process outside cycle unblocks it)
        - Classic OS Textbook Example:
          - Resources: R1 (2 instances), R2 (2 instances)
          - Processes: P1, P2, P3
          - P1 holds 1 of R1, requests 1 of R2 (Blocked)
          - P2 holds 1 of R2, requests 1 of R1 (Blocked)
          - P3 holds 1 of R1 and 1 of R2, with NO pending requests (Active!)
          - Cycle exists: P1 -> R2 -> P2 -> R1 -> P1
          - BUT P3 is not blocked; when P3 terminates, it frees R1 and R2, resolving the cycle.
          - State: Safe / Cycle Reducible.
        """
        self.reset()
        self.rag.add_resource("R1", 2)
        self.rag.add_resource("R2", 2)
        self.rag.add_process("P1")
        self.rag.add_process("P2")
        self.rag.add_process("P3")

        # Initial allocations
        self.rag.request_resource("P1", "R1", 1)  # P1 holds R1
        self.rag.request_resource("P2", "R2", 1)  # P2 holds R2
        self.rag.request_resource("P3", "R1", 1)  # P3 holds R1 (R1 available = 0)
        self.rag.request_resource("P3", "R2", 1)  # P3 holds R2 (R2 available = 0)

        # Cycle formed between P1 and P2
        self.rag.request_resource("P1", "R2", 1)  # Blocked!
        self.rag.request_resource("P2", "R1", 1)  # Blocked!

        self.rag._log("Loaded Preset Scenario C: Multi-Instance Cycle with NO Deadlock.")
        return self.rag

    def load_scenario_d(self) -> ResourceAllocationGraph:
        """
        Scenario D: Multi-Instance Cycle WITH Deadlock
        - Processes: P1, P2, P3, P4
        - Resources: R1 (2 instances), R2 (2 instances)
        - P1 holds R1 (1), requests R2 (1)
        - P2 holds R2 (1), requests R1 (1)
        - P3 holds R1 (1), requests R2 (1)
        - P4 holds R2 (1), requests R1 (1)
        - Both R1 and R2 are fully allocated, all 4 processes blocked on each other.
        - Graph reduction fails completely -> Deadlock Confirmed.
        """
        self.reset()
        self.rag.add_resource("R1", 2)
        self.rag.add_resource("R2", 2)
        self.rag.add_process("P1")
        self.rag.add_process("P2")
        self.rag.add_process("P3")
        self.rag.add_process("P4")

        # Initial allocations: R1 to P1 & P3; R2 to P2 & P4
        self.rag.request_resource("P1", "R1", 1)
        self.rag.request_resource("P3", "R1", 1)
        self.rag.request_resource("P2", "R2", 1)
        self.rag.request_resource("P4", "R2", 1)

        # Mutual blocking cross requests
        self.rag.request_resource("P1", "R2", 1)
        self.rag.request_resource("P2", "R1", 1)
        self.rag.request_resource("P3", "R2", 1)
        self.rag.request_resource("P4", "R1", 1)

        self.rag._log("Loaded Preset Scenario D: Multi-Instance Cycle WITH Deadlock.")
        return self.rag

    def load_random_scenario(self) -> ResourceAllocationGraph:
        """
        Generates a randomized Resource Allocation Graph scenario.
        Randomizes processes (2-3), resources (2-3), capacities, allocations and requests.
        """
        self.reset()
        mode = random.randint(0, 2)
        proc_count = random.randint(2, 3)
        res_count = random.randint(2, 3)

        p_ids = [f"P{i}" for i in range(1, proc_count + 1)]
        r_ids = [f"R{j}" for j in range(1, res_count + 1)]

        for r_id in r_ids:
            cap = random.randint(2, 3) if mode == 2 else 1
            self.rag.add_resource(r_id, cap)

        for p_id in p_ids:
            self.rag.add_process(p_id)

        if mode == 0:
            # Deadlock loop
            self.rag.request_resource(p_ids[0], r_ids[0], 1)
            self.rag.request_resource(p_ids[1], r_ids[1], 1)
            self.rag.request_resource(p_ids[0], r_ids[1], 1)
            self.rag.request_resource(p_ids[1], r_ids[0], 1)
            if proc_count >= 3 and res_count >= 3:
                self.rag.request_resource(p_ids[2], r_ids[2], 1)
            self.rag._log(f"Loaded Random Scenario: Deadlock Loop ({proc_count}P, {res_count}R).")
        elif mode == 1:
            # Safe state
            self.rag.request_resource(p_ids[0], r_ids[0], 1)
            self.rag.request_resource(p_ids[1], r_ids[1], 1)
            if proc_count >= 3:
                self.rag.request_resource(p_ids[2], r_ids[0 if res_count < 3 else 2], 1)
            self.rag._log(f"Loaded Random Scenario: Safe Execution ({proc_count}P, {res_count}R).")
        else:
            # Multi-instance
            self.rag.request_resource(p_ids[0], r_ids[0], 1)
            self.rag.request_resource(p_ids[1], r_ids[1], 1)
            if proc_count >= 3:
                self.rag.request_resource(p_ids[2], r_ids[0], 1)
            self.rag.request_resource(p_ids[0], r_ids[1], 1)
            self.rag.request_resource(p_ids[1], r_ids[0], 1)
            self.rag._log(f"Loaded Random Scenario: Multi-Instance ({proc_count}P, {res_count}R).")

        return self.rag

    def load_scenario_by_name(self, name: str) -> ResourceAllocationGraph:
        name = name.strip().upper()
        if name in ("A", "SCENARIO_A", "SCENARIO A"):
            return self.load_scenario_a()
        elif name in ("B", "SCENARIO_B", "SCENARIO B"):
            return self.load_scenario_b()
        elif name in ("C", "SCENARIO_C", "SCENARIO C"):
            return self.load_scenario_c()
        elif name in ("D", "SCENARIO_D", "SCENARIO D"):
            return self.load_scenario_d()
        elif name in ("RANDOM", "R", "SCENARIO_RANDOM"):
            return self.load_random_scenario()
        else:
            raise ValueError(f"Unknown scenario '{name}'. Choose A, B, C, D, or RANDOM.")

