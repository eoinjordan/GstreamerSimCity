# GStreamer SimCity: Benchmark and Iteration Draft

Status: draft, 2026-09-19. No native execution or new pipeline capability is
claimed by this document.

## Observed Baseline

- [Model](../src/sim/model.ts): validated settings, a 5 ms fixed step, bounded
  queue, producer backpressure, both leakage directions, finite files, and EOS.
- [Tests](../src/sim/model.test.ts): conservation, partition-invariant stepping,
  pause/reset, profile contracts, leakage direction, and draining.
- [Verification audit](verification.md): clearly distinguishes modeled queue
  behavior, illustrative animation, backend graph context, and unverified native
  execution. Do not replace or dilute this existing audit.
- [Commands](../package.json): unit, typecheck, production build, and Playwright
  scripts already exist. Review the retained execution results separately.

## Execution In This Pass

All 12 unit tests, typecheck, build, and eight existing production Playwright
tests pass locally. The browser checks cover both profiles on desktop/mobile,
canvas pixels, controls, reset, source/profile changes, tours, and export.
IM SDK mobile and DeepStream desktop screenshots were also opened and inspected.
No runtime source change was needed for these checks. Native execution remains
unverified, and the larger features below remain drafts.

## Benchmark Gap

This project already has much of HexagonNPUSimCity's evidence discipline and
PGSimCity's causal-test approach. The most valuable next iteration is to extend
the behavior behind its existing diagrams, not add more nominal backend names.
The verification audit explicitly says that only one inference queue is
numerically simulated; branches, batching, metadata matching, and synchronization
remain structural context.

## P0: Preserve The Existing Contracts

- Keep `produced = completed + dropped + inFlight` true under every state,
  scenario, leak policy, and reset. Add transition-sequence fixtures before
  extending the scheduling model.
- Expand accepted/rejected setting boundaries and fractional-delta partitions.
  State explicitly that the displayed completion rate has a one-second startup
  window and that pause freezes this educational clock.
- Preserve the browser suite's production build, mobile containment, canvas
  checks, keyboard operation, export, and profile reset coverage.
- Add a versioned trace/settings envelope before introducing trace import.
  Validate imported data and its size without executing embedded commands,
  plugin strings, paths, or remote URLs.

Cheap discriminating check: run an identical configured workload with one large
advance and a fixed list of fractional advances with the same total, including
pause and EOS boundaries; assert equal counters, queues, and completion order.

## P1: Branch Scheduling And Metadata Age

Hypothesis: two explicitly scheduled branches can teach why a healthy inference
rate does not guarantee correctly synchronized video overlays.

Introduce a pure graph scheduler incrementally behind the existing API. Each
buffer needs a stable ID, source ID, PTS, and ownership state. Each modeled queue
needs explicit capacity units, leakage policy, and one worker/service contract.
Do not confuse an explanatory stage with a separate native streaming thread.

First scenario: a tee sends video toward display and inference toward metadata
matching. Increasing inference service time causes late results; a declared
join policy decides whether to wait, omit an overlay, or discard stale metadata.

Acceptance fixtures:

1. Branch-local queue bounds hold and ownership/reference accounting balances;
   fan-out cannot be treated as newly produced source frames.
2. Results attach only to the matching source and timestamp/frame identity.
3. A blocked non-leaky branch can backpressure its producer as documented.
4. EOS drains each accepted branch before the graph is considered finished.
5. Restart/profile switching clears branch-local results and join state.

## P1: Caps And Memory Boundaries

Add a constrained, declarative compatibility model for format, dimensions,
framerate, and memory domain. Use supported fixtures from a named SDK version;
do not pretend to parse arbitrary GStreamer launch syntax.

The lesson is negotiation and transfer boundaries: NV12 versus RGBA payload,
stride/padding when explicitly specified, and copies only where the modeled
allocator/plugin contract requires them. A memory-domain label alone is not
proof of end-to-end zero-copy behavior.

Acceptance: a compatible path negotiates a stated intersection; an incompatible
edge names the violated field; inserting a supported converter repairs that
fixture and accounts for the modeled copy. Unsupported caps remain unsupported.

## P2: Multi-Stream Batching And Native Evidence

- Add two-source mux scenarios with batch-size, timeout, and source-stall
  behavior tied to a selected DeepStream version. Expose throughput and latency
  separately; batching does not imply proportional speedup.
- Add source-clock versus pipeline-running-time lessons only after timestamps
  and segment/state semantics are reviewed against GStreamer documentation.
- Keep recorded native traces a separate mode with SDK/plugin versions, graph,
  workload/model identity, clock units, provenance, and explicit missing fields.
  SDK/plugin enumeration does not prove accelerator execution.
- A live adapter must be opt-in, localhost-bound by default, authenticated when
  appropriate, and unable to execute arbitrary imported pipeline text.

## Decision

Keep Qualcomm and NVIDIA as profiles of this project. Do not create separate
DeepStream or IM SDK cities with duplicate queue engines. The next substantial
milestone is one causal two-branch scenario with conservation tests, followed by
caps negotiation. Real SDK execution stays an independently validated extension.

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:browser`
for the relevant implementation changes. Browser success remains distinct from
native GStreamer, QNN, or TensorRT validation.