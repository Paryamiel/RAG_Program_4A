"""
Interactive Operating System Resource Allocation Graph (RAG) CLI & Terminal Engine.
Provides ASCII visual graphs, live allocation/request matrices, step-by-step reduction traces,
and an interactive command shell.
"""

import sys
import argparse
from typing import List, Dict
from rag_engine import ResourceAllocationGraph, ProcessState, EdgeType
from deadlock_detector import DeadlockDetector, DeadlockStatus, DeadlockReport
from simulator import RAGSimulator

# ANSI Colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


class RAGCLI:
    def __init__(self):
        self.simulator = RAGSimulator()

    @property
    def rag(self) -> ResourceAllocationGraph:
        return self.simulator.rag

    def print_banner(self):
        banner = f"""
{CYAN}{BOLD}================================================================================
   OPERATING SYSTEM RESOURCE ALLOCATION GRAPH (RAG) SIMULATOR & DETECTOR
================================================================================{RESET}
{DIM}Model: Processes (P_i), Resources (R_j), Request & Assignment Edges, Deadlock Engine
Type 'help' for commands or 'load <A|B|C|D>' for standard OS textbook scenarios.{RESET}
"""
        print(banner)

    def print_status_summary(self, report: DeadlockReport):
        if report.status == DeadlockStatus.NO_DEADLOCK:
            status_color = GREEN
            tag = "[ SAFE / NO DEADLOCK ]"
        elif report.status == DeadlockStatus.SAFE_STATE:
            status_color = YELLOW
            tag = "[ SAFE STATE / CYCLE REDUCIBLE ]"
        else:
            status_color = RED
            tag = "[ DEADLOCK CONFIRMED ]"

        print(f"\n{status_color}{BOLD}{'='*25} SYSTEM DIAGNOSTIC REPORT {'='*25}{RESET}")
        print(f"Status: {status_color}{BOLD}{tag}{RESET}")
        print(f"Directed Cycles Detected : {'YES' if report.has_cycle else 'NO'}")
        if report.has_cycle:
            for i, c in enumerate(report.cycles, 1):
                print(f"  Cycle #{i}: {MAGENTA}{' -> '.join(c)}{RESET}")

        print(f"Single-Instance Only     : {'YES' if report.is_single_instance_only else 'NO'}")
        print(f"Deadlocked Processes     : {RED}{', '.join(report.deadlocked_processes) if report.deadlocked_processes else 'None'}{RESET}")
        print(f"Deadlocked Resources     : {RED}{', '.join(report.deadlocked_resources) if report.deadlocked_resources else 'None'}{RESET}")
        print(f"Graph Reducible          : {'YES' if report.reduction_successful else 'NO'}")
        print(f"Diagnosis                : {report.summary_message}")

        if report.reduction_steps:
            print(f"\n{CYAN}{BOLD}--- Reduction Execution Sequence ---{RESET}")
            for step in report.reduction_steps:
                print(f"  Step {step.step_num}: Process {BOLD}{step.process_id}{RESET} completed.")
                print(f"    Available Before : {step.work_before}")
                freed = {k: v for k, v in step.allocated_freed.items() if v > 0}
                print(f"    Freed Resources  : {freed or 'None'}")
                print(f"    Available After  : {step.work_after}")
        print(f"{status_color}{BOLD}{'='*76}{RESET}\n")

    def print_ascii_graph(self):
        print(f"\n{CYAN}{BOLD}--- GRAPH TOPOLOGY (G = V, E) ---{RESET}")
        if not self.rag.processes and not self.rag.resources:
            print(f"{DIM}(Graph is currently empty. Add processes and resources to begin.){RESET}")
            return

        print(f"{BOLD}PROCESS NODES (Circles):{RESET}")
        for p_id, p in self.rag.processes.items():
            state_color = GREEN if p.state == ProcessState.ACTIVE else (YELLOW if p.state == ProcessState.BLOCKED else DIM)
            holdings = [f"{r}:{c}" for r, c in self.rag.allocations[p_id].items() if c > 0]
            requests = [f"{r}:{c}" for r, c in self.rag.requests[p_id].items() if c > 0]
            print(f"  ( {BOLD}{p_id}{RESET} ) [{state_color}{p.state.value}{RESET}] | Holds: {holdings or 'None'} | Waiting on: {requests or 'None'}")

        print(f"\n{BOLD}RESOURCE NODES (Rectangles):{RESET}")
        for r_id, r in self.rag.resources.items():
            holders = [f"{p}:{self.rag.allocations[p][r_id]}" for p in self.rag.processes if self.rag.allocations[p][r_id] > 0]
            queue = self.rag.waiting_queues.get(r_id, [])
            instances_visual = f"[{'#' * (r.total_instances - r.available_instances)}{'.' * r.available_instances}]"
            print(f"  [ {BOLD}{r_id}{RESET} ] Total: {r.total_instances} | Avail: {r.available_instances} {instances_visual} | Allocated to: {holders or 'None'} | Wait Queue (FIFO): {queue or 'Empty'}")

        print(f"\n{BOLD}ACTIVE EDGES:{RESET}")
        edges = self.rag.get_edges()
        if not edges:
            print(f"  {DIM}No active edges.{RESET}")
        for e in edges:
            if e["type"] == EdgeType.REQUEST.value:
                print(f"  {YELLOW}{e['from']}  ---(REQUEST {e['count']})--->  {e['to']}{RESET}")
            elif e["type"] == EdgeType.ASSIGNMENT.value:
                print(f"  {GREEN}{e['from']}  ---(ASSIGNMENT {e['count']})--->  {e['to']}{RESET}")
            elif e["type"] == EdgeType.CLAIM.value:
                print(f"  {CYAN}{e['from']}  - - -(CLAIM {e['count']})- - ->  {e['to']}{RESET}")
        print()

    def print_matrices(self):
        procs = sorted(list(self.rag.processes.keys()))
        res = sorted(list(self.rag.resources.keys()))

        if not procs or not res:
            print(f"{DIM}Need at least one process and resource to display matrix.{RESET}")
            return

        print(f"\n{CYAN}{BOLD}--- ALLOCATION & REQUEST MATRICES ---{RESET}")
        header = f"{'Process':<10} | {'ALLOCATION':<{len(res)*6}} | {'REQUEST (NEED)':<{len(res)*6}}"
        print(header)
        sub_res = " ".join(f"{r:>5}" for r in res)
        print(f"{'':<10} | {sub_res} | {sub_res}")
        print("-" * (25 + len(res) * 12))

        for p in procs:
            alloc_vals = " ".join(f"{self.rag.allocations[p].get(r, 0):>5}" for r in res)
            req_vals = " ".join(f"{self.rag.requests[p].get(r, 0):>5}" for r in res)
            print(f"{p:<10} | {alloc_vals} | {req_vals}")

        print("-" * (25 + len(res) * 12))
        avail_vals = " ".join(f"{self.rag.resources[r].available_instances:>5}" for r in res)
        total_vals = " ".join(f"{self.rag.resources[r].total_instances:>5}" for r in res)
        print(f"{'AVAILABLE':<10} | {avail_vals}")
        print(f"{'TOTAL CAP':<10} | {total_vals}\n")

    def print_help(self):
        help_text = f"""
{BOLD}Available Commands:{RESET}
  {CYAN}load <A|B|C|D>{RESET}           : Load benchmark scenario (A: Safe, B: 1-Inst Deadlock, C: Reducible Cycle, D: Deadlock)
  {CYAN}detect{RESET} / {CYAN}analyze{RESET}          : Run cycle detection & reduction algorithm
  {CYAN}graph{RESET}                    : Display ASCII graph topology
  {CYAN}matrix{RESET}                   : Display Allocation and Request tables
  {CYAN}status{RESET}                   : Print brief system status
  {CYAN}add_p <p_id>{RESET}             : Add process node (e.g. add_p P1)
  {CYAN}del_p <p_id>{RESET}             : Remove process node
  {CYAN}add_r <r_id> [capacity]{RESET}  : Add resource node with instances (e.g. add_r R1 2)
  {CYAN}del_r <r_id>{RESET}             : Remove resource node
  {CYAN}req <p_id> <r_id> [count]{RESET} : Request resource (grants or blocks with edge)
  {CYAN}rel <p_id> <r_id> [count]{RESET} : Release resource (unblocks FIFO waiting queue)
  {CYAN}term <p_id>{RESET}              : Terminate process and release all holdings
  {CYAN}claim <p_id> <r_id> <n>{RESET}   : Set Banker's claim edge
  {CYAN}reset{RESET}                    : Reset graph to empty
  {CYAN}export <filename.json>{RESET}   : Export graph state to JSON file
  {CYAN}import <filename.json>{RESET}   : Import graph state from JSON file
  {CYAN}quit{RESET} / {CYAN}exit{RESET}               : Exit simulator
"""
        print(help_text)

    def run_interactive(self):
        self.print_banner()
        self.print_help()

        while True:
            try:
                raw = input(f"{BOLD}rag-sim > {RESET}").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nExiting RAG Simulator. Goodbye!")
                break

            if not raw:
                continue

            parts = raw.split()
            cmd = parts[0].lower()
            args = parts[1:]

            try:
                if cmd in ("exit", "quit", "q"):
                    print("Exiting RAG Simulator. Goodbye!")
                    break

                elif cmd in ("help", "?"):
                    self.print_help()

                elif cmd in ("detect", "analyze", "check"):
                    report = self.simulator.analyze()
                    self.print_status_summary(report)

                elif cmd in ("graph", "show", "topo"):
                    self.print_ascii_graph()

                elif cmd in ("matrix", "mat", "table"):
                    self.print_matrices()

                elif cmd == "status":
                    report = self.simulator.analyze()
                    print(f"System State: {report.status.value} (Cycles: {len(report.cycles)}, Deadlocked: {report.deadlocked_processes or 'None'})")

                elif cmd == "load":
                    if not args:
                        print("Usage: load <A|B|C|D>")
                        continue
                    scenario_name = args[0].upper()
                    self.simulator.load_scenario_by_name(scenario_name)
                    print(f"Successfully loaded Scenario {scenario_name}!")
                    self.print_ascii_graph()
                    self.print_matrices()
                    report = self.simulator.analyze()
                    self.print_status_summary(report)

                elif cmd in ("add_p", "add_process"):
                    if not args:
                        print("Usage: add_p <process_id>")
                        continue
                    self.rag.add_process(args[0])
                    print(f"Added process '{args[0]}'.")

                elif cmd in ("del_p", "remove_process"):
                    if not args:
                        print("Usage: del_p <process_id>")
                        continue
                    self.rag.remove_process(args[0])
                    print(f"Removed process '{args[0]}'.")

                elif cmd in ("add_r", "add_resource"):
                    if not args:
                        print("Usage: add_r <resource_id> [capacity=1]")
                        continue
                    r_id = args[0]
                    cap = int(args[1]) if len(args) > 1 else 1
                    self.rag.add_resource(r_id, cap)
                    print(f"Added resource '{r_id}' with {cap} instance(s).")

                elif cmd in ("del_r", "remove_resource"):
                    if not args:
                        print("Usage: del_r <resource_id>")
                        continue
                    self.rag.remove_resource(args[0])
                    print(f"Removed resource '{args[0]}'.")

                elif cmd in ("req", "request"):
                    if len(args) < 2:
                        print("Usage: req <process_id> <resource_id> [count=1]")
                        continue
                    p_id = args[0]
                    r_id = args[1]
                    count = int(args[2]) if len(args) > 2 else 1
                    res = self.rag.request_resource(p_id, r_id, count)
                    print(f"Result: {res['status']} - {res['message']}")
                    # Run auto analysis update
                    rep = self.simulator.analyze()
                    if rep.status == DeadlockStatus.DEADLOCK_CONFIRMED:
                        print(f"{RED}{BOLD}ALERT: Operation triggered confirmed deadlock! Type 'detect' for details.{RESET}")

                elif cmd in ("rel", "release"):
                    if len(args) < 2:
                        print("Usage: rel <process_id> <resource_id> [count=1]")
                        continue
                    p_id = args[0]
                    r_id = args[1]
                    count = int(args[2]) if len(args) > 2 else 1
                    res = self.rag.release_resource(p_id, r_id, count)
                    print(f"Result: {res['status']} - {res['message']}")
                    if res.get("unblocked_processes"):
                        print(f"Unblocked processes (FIFO): {res['unblocked_processes']}")

                elif cmd in ("term", "terminate"):
                    if not args:
                        print("Usage: term <process_id>")
                        continue
                    res = self.rag.terminate_process(args[0])
                    print(f"Result: {res['message']}")
                    if res.get("unblocked_processes"):
                        print(f"Unblocked processes: {res['unblocked_processes']}")

                elif cmd == "claim":
                    if len(args) < 3:
                        print("Usage: claim <process_id> <resource_id> <max_instances>")
                        continue
                    self.rag.set_claim(args[0], args[1], int(args[2]))
                    print(f"Set claim of {args[2]} on '{args[1]}' for '{args[0]}'.")

                elif cmd == "reset":
                    self.simulator.reset()
                    print("Graph reset to empty.")

                elif cmd == "export":
                    if not args:
                        print("Usage: export <filename.json>")
                        continue
                    import json
                    with open(args[0], "w") as f:
                        f.write(self.rag.to_json(indent=2))
                    print(f"Exported graph state to {args[0]}.")

                elif cmd == "import":
                    if not args:
                        print("Usage: import <filename.json>")
                        continue
                    import json
                    with open(args[0], "r") as f:
                        data = json.load(f)
                    self.simulator.rag = ResourceAllocationGraph.from_dict(data)
                    self.simulator.detector = DeadlockDetector(self.simulator.rag)
                    print(f"Imported graph state from {args[0]}.")

                else:
                    print(f"Unknown command: '{cmd}'. Type 'help' for commands.")

            except Exception as e:
                print(f"{RED}Error: {e}{RESET}")


def main():
    parser = argparse.ArgumentParser(description="Operating System Resource Allocation Graph (RAG) Simulator")
    parser.add_argument("--scenario", "-s", choices=["A", "B", "C", "D"], help="Load and analyze a preset scenario")
    parser.add_argument("--detect", "-d", action="store_true", help="Run deadlock detection and exit")
    parser.add_argument("--matrix", "-m", action="store_true", help="Print matrices and exit")

    args = parser.parse_args()
    cli = RAGCLI()

    if args.scenario:
        cli.simulator.load_scenario_by_name(args.scenario)
        cli.print_ascii_graph()
        cli.print_matrices()
        report = cli.simulator.analyze()
        cli.print_status_summary(report)
        sys.exit(0)

    # Default interactive mode
    cli.run_interactive()


if __name__ == "__main__":
    main()
