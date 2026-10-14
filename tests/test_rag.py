"""
Automated Unit Test Suite for Resource Allocation Graph (RAG) Simulator & Deadlock Detector.
Tests:
- Graph engine node/edge manipulation
- Dynamic request, release, FIFO unblocking, and termination
- Error conditions (double release, over-capacity, non-existent entities)
- Tarjan/DFS directed cycle detection
- Scenarios A, B, C, D deadlock evaluations
- Reduction algorithm trace verification
- JSON serialization round-trips
"""

import unittest
from rag_engine import ResourceAllocationGraph, ProcessState, EdgeType
from deadlock_detector import DeadlockDetector, DeadlockStatus
from simulator import RAGSimulator


class TestRAGEngine(unittest.TestCase):

    def setUp(self):
        self.rag = ResourceAllocationGraph()

    def test_add_and_remove_process(self):
        p1 = self.rag.add_process("P1")
        self.assertEqual(p1.id, "P1")
        self.assertEqual(p1.state, ProcessState.ACTIVE)
        self.assertIn("P1", self.rag.processes)

        # Duplicate error
        with self.assertRaises(ValueError):
            self.rag.add_process("P1")

        # Empty ID error
        with self.assertRaises(ValueError):
            self.rag.add_process("   ")

        # Remove
        self.rag.remove_process("P1")
        self.assertNotIn("P1", self.rag.processes)

        # Remove non-existent
        with self.assertRaises(KeyError):
            self.rag.remove_process("NonExistent")

    def test_add_and_remove_resource(self):
        r1 = self.rag.add_resource("R1", 3)
        self.assertEqual(r1.id, "R1")
        self.assertEqual(r1.total_instances, 3)
        self.assertEqual(r1.available_instances, 3)

        # Duplicate error
        with self.assertRaises(ValueError):
            self.rag.add_resource("R1", 1)

        # Zero or negative instances error
        with self.assertRaises(ValueError):
            self.rag.add_resource("R2", 0)

        with self.assertRaises(ValueError):
            self.rag.add_resource("R3", -2)

        # Remove resource
        self.rag.remove_resource("R1")
        self.assertNotIn("R1", self.rag.resources)

    def test_request_grant_and_block(self):
        self.rag.add_resource("R1", 2)
        self.rag.add_process("P1")
        self.rag.add_process("P2")

        # P1 requests 1 instance -> granted
        res1 = self.rag.request_resource("P1", "R1", 1)
        self.assertTrue(res1["success"])
        self.assertEqual(res1["status"], "GRANTED")
        self.assertEqual(self.rag.allocations["P1"]["R1"], 1)
        self.assertEqual(self.rag.resources["R1"].available_instances, 1)
        self.assertEqual(self.rag.processes["P1"].state, ProcessState.ACTIVE)

        # P2 requests 1 instance -> granted
        res2 = self.rag.request_resource("P2", "R1", 1)
        self.assertEqual(res2["status"], "GRANTED")
        self.assertEqual(self.rag.resources["R1"].available_instances, 0)

        # P1 requests another instance -> blocked!
        res3 = self.rag.request_resource("P1", "R1", 1)
        self.assertEqual(res3["status"], "BLOCKED")
        self.assertEqual(self.rag.requests["P1"]["R1"], 1)
        self.assertEqual(self.rag.processes["P1"].state, ProcessState.BLOCKED)
        self.assertIn("P1", self.rag.waiting_queues["R1"])

    def test_fifo_release_and_unblock(self):
        self.rag.add_resource("R1", 1)
        self.rag.add_process("P1")
        self.rag.add_process("P2")
        self.rag.add_process("P3")

        # P1 gets R1
        self.rag.request_resource("P1", "R1", 1)
        # P2 and P3 block in FIFO order
        self.rag.request_resource("P2", "R1", 1)
        self.rag.request_resource("P3", "R1", 1)

        self.assertEqual(self.rag.waiting_queues["R1"], ["P2", "P3"])

        # P1 releases R1 -> should unblock P2 first (FIFO)
        rel_res = self.rag.release_resource("P1", "R1", 1)
        self.assertIn("P2", rel_res["unblocked_processes"])
        self.assertEqual(self.rag.allocations["P2"]["R1"], 1)
        self.assertEqual(self.rag.processes["P2"].state, ProcessState.ACTIVE)
        self.assertEqual(self.rag.processes["P3"].state, ProcessState.BLOCKED)
        self.assertEqual(self.rag.waiting_queues["R1"], ["P3"])

    def test_over_release_and_double_release(self):
        self.rag.add_resource("R1", 2)
        self.rag.add_process("P1")
        self.rag.request_resource("P1", "R1", 1)

        # Releasing more than held
        with self.assertRaises(ValueError):
            self.rag.release_resource("P1", "R1", 2)

        # Normal release
        self.rag.release_resource("P1", "R1", 1)

        # Second release (double release)
        with self.assertRaises(ValueError):
            self.rag.release_resource("P1", "R1", 1)

    def test_nonexistent_process_or_resource_errors(self):
        self.rag.add_resource("R1", 1)
        self.rag.add_process("P1")

        with self.assertRaises(KeyError):
            self.rag.request_resource("FakeP", "R1", 1)

        with self.assertRaises(KeyError):
            self.rag.request_resource("P1", "FakeR", 1)

        with self.assertRaises(KeyError):
            self.rag.release_resource("FakeP", "R1", 1)

        with self.assertRaises(KeyError):
            self.rag.release_resource("P1", "FakeR", 1)

    def test_terminate_process_releases_all_holdings(self):
        self.rag.add_resource("R1", 1)
        self.rag.add_resource("R2", 1)
        self.rag.add_process("P1")
        self.rag.add_process("P2")

        self.rag.request_resource("P1", "R1", 1)
        self.rag.request_resource("P1", "R2", 1)
        self.rag.request_resource("P2", "R1", 1)  # P2 blocked waiting on R1

        self.assertEqual(self.rag.processes["P2"].state, ProcessState.BLOCKED)

        term_res = self.rag.terminate_process("P1")
        self.assertIn("P2", term_res["unblocked_processes"])
        self.assertEqual(self.rag.processes["P1"].state, ProcessState.TERMINATED)
        self.assertEqual(self.rag.processes["P2"].state, ProcessState.ACTIVE)
        self.assertEqual(self.rag.resources["R2"].available_instances, 1)


class TestDeadlockDetectionEngine(unittest.TestCase):

    def setUp(self):
        self.sim = RAGSimulator()

    def test_scenario_a_safe_no_cycle(self):
        self.sim.load_scenario_a()
        report = self.sim.analyze()

        self.assertFalse(report.has_cycle)
        self.assertEqual(report.status, DeadlockStatus.NO_DEADLOCK)
        self.assertEqual(len(report.deadlocked_processes), 0)
        self.assertTrue(report.reduction_successful)

    def test_scenario_b_single_instance_deadlock(self):
        self.sim.load_scenario_b()
        report = self.sim.analyze()

        self.assertTrue(report.has_cycle)
        self.assertTrue(report.is_single_instance_only)
        self.assertEqual(report.status, DeadlockStatus.DEADLOCK_CONFIRMED)
        self.assertIn("P1", report.deadlocked_processes)
        self.assertIn("P2", report.deadlocked_processes)
        self.assertIn("R1", report.deadlocked_resources)
        self.assertIn("R2", report.deadlocked_resources)

    def test_scenario_c_multi_instance_cycle_reducible(self):
        """Cycle exists, but P3 unblocks it. State should be Safe."""
        self.sim.load_scenario_c()
        report = self.sim.analyze()

        self.assertTrue(report.has_cycle)
        self.assertFalse(report.is_single_instance_only)
        self.assertTrue(report.reduction_successful)
        self.assertEqual(report.status, DeadlockStatus.SAFE_STATE)
        self.assertEqual(len(report.deadlocked_processes), 0)
        self.assertGreater(len(report.reduction_steps), 0)

    def test_scenario_d_multi_instance_deadlock(self):
        self.sim.load_scenario_d()
        report = self.sim.analyze()

        self.assertTrue(report.has_cycle)
        self.assertFalse(report.is_single_instance_only)
        self.assertFalse(report.reduction_successful)
        self.assertEqual(report.status, DeadlockStatus.DEADLOCK_CONFIRMED)
        self.assertEqual(set(report.deadlocked_processes), {"P1", "P2", "P3", "P4"})

    def test_claim_edges_banker_integration(self):
        rag = self.sim.rag
        rag.add_process("P1")
        rag.add_resource("R1", 3)
        rag.set_claim("P1", "R1", 2)
        self.assertEqual(rag.claims["P1"]["R1"], 2)

        edges = rag.get_edges()
        claim_edges = [e for e in edges if e["type"] == EdgeType.CLAIM.value]
        self.assertEqual(len(claim_edges), 1)
        self.assertEqual(claim_edges[0]["from"], "P1")
        self.assertEqual(claim_edges[0]["to"], "R1")

    def test_adjacency_matrix_and_serialization(self):
        self.sim.load_scenario_b()
        rag = self.sim.rag
        nodes, matrix = rag.get_adjacency_matrix()

        self.assertEqual(set(nodes), {"P1", "P2", "R1", "R2"})
        self.assertEqual(len(matrix), 4)
        for row in matrix:
            self.assertEqual(len(row), 4)

        # Serialization round-trip
        data_json = rag.to_json()
        rag2 = ResourceAllocationGraph.from_dict(rag.to_dict())
        self.assertEqual(len(rag2.processes), len(rag.processes))
        self.assertEqual(len(rag2.resources), len(rag.resources))
        self.assertEqual(rag2.allocations, rag.allocations)
        self.assertEqual(rag2.requests, rag.requests)

    def test_load_random_scenario(self):
        rag = self.sim.load_random_scenario()
        self.assertGreaterEqual(len(rag.processes), 2)
        self.assertGreaterEqual(len(rag.resources), 2)
        report = self.sim.analyze()
        self.assertIn(report.status, [DeadlockStatus.NO_DEADLOCK, DeadlockStatus.SAFE_STATE, DeadlockStatus.DEADLOCK_CONFIRMED])

        # Test loading by name 'RANDOM'
        rag2 = self.sim.load_scenario_by_name("RANDOM")
        self.assertGreaterEqual(len(rag2.processes), 2)


if __name__ == "__main__":
    unittest.main()
