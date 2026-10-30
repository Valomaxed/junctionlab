# Research overview

## Problem and question

Signal changes can move congestion from one approach to another. A useful junction study must compare delay alongside queues, throughput, and unfinished demand under the same traffic inputs.

**Question:** how do fixed-time, actuated, and queue-pressure control compare at a single mixed-traffic junction, and how sensitive is the comparison to demand and behavior assumptions?

The software is inspired by the IIT Flyover surface junction near IIT Delhi. Its current geometry is generated and its bundled counts are synthetic. This is a reproducible software study awaiting a field-calibrated application; it does not claim a novel traffic-control algorithm.

## Objectives and current status

| Objective | Evidence or remaining work |
|---|---|
| Visualize individual traffic and inspect what-if inputs | Implemented in the browser with five procedural vehicle classes. |
| Ingest classified counts by interval and movement | CSV parsing, mapping, validation, and normalization implemented. Actual field workbook not yet integrated. |
| Compare native controllers fairly | 15 saved native SUMO runs, common arrival schedules by seed, raw metrics and decision logs. |
| Quantify stochastic variation | Per-seed statistics and paired bootstrap intervals implemented. Included five-seed example is small. |
| Fit behavior and compare observations | Global `tau`/`minGap` grid and queue/discharge reports implemented; tested with synthetic observations. |
| Establish field accuracy | Pending geometry/timing survey, fitting data, and independent observation session. |

## Scope

One four-arm, left-hand-traffic junction. The example uses three dedicated entry lanes per approach and serves one approach at a time. Both the browser model and native controller wrappers simplify the actual phase structure. The flyover, pedestrians, bus stops, and detailed heterogeneous lateral behavior are outside the implemented study.

## Method

1. **Define the site and observation boundaries.** Record the entry arms, permitted movements, lane counts, distances, observed signal phases, and queue definitions.
2. **Prepare demand.** Count individual vehicle classes and movements by contiguous 15-minute intervals. Preserve the original survey separately. Keep PCU analysis separate from individual vehicle counts used by the simulator.
3. **Construct the baseline.** Replace generated geometry with a surveyed SUMO network and observed signal timings. Check class permissions and all movement mappings.
4. **Fit on training observations.** Use consistently defined queues and discharge data to fit a small identifiable parameter set. Counts at a saturated stop line may underestimate arrivals; account for residual queues and boundary effects.
5. **Evaluate independently.** Freeze fitted parameters and test another session. Report approach-level errors. A successful fit on training data is not independent validation.
6. **Run paired experiments.** Reuse scheduled arrivals by seed, apply common warm-up and measurement windows, and save input/configuration provenance. Increase replication for substantive decisions.
7. **Interpret jointly.** Read stopped delay, queues, throughput, and external backlog together. Report paired uncertainty as well as raw runs; keep field-input uncertainty separate.

## What the saved benchmark establishes

The saved example exercises the complete native-run-to-replay workflow. It contains fixed-time, actuated, and queue-pressure controllers, five paired seeds, and a five-minute analysis after a two-minute warm-up. It establishes that the experiment can be executed and inspected, not that any intervention will improve the real junction. See [RESULTS.md](RESULTS.md).

Software tests cover parsing, deterministic demand, route/motion invariants, controller transitions, trajectory validation, and paired statistics. A synthetic parameter-fitting round-trip checked that the fitting workflow can recover its generating settings. These are implementation checks, not substitutes for observations.

## Interpretation constraints

- The custom queue-pressure controller includes minimum/maximum green, a switching threshold, clearance guards, and an aging service rule. It is not a proof-equivalent reproduction of a published optimal controller.
- All-red can extend while vehicles remain in internal junction links. Nominal fixed cycle length is therefore not always the effective cycle.
- The stopped-delay metric includes unfinished traffic and entry waiting. It is not completed-trip travel-time loss relative to free flow.
- Trajectory replay shows the first seed, while summary tables aggregate all seeds. Camera movement changes no experiment result.
- Idle fuel/CO₂ factors are illustrative and do not establish Delhi fleet emissions.

## Next milestones

1. Integrate the actual classified turning-count workbook and preserve provenance.
2. Reconstruct road geometry and the observed phase plan; align counting boundaries.
3. Collect queues/discharge for fitting and a separate validation session.
4. Expand the paired experiment and assess demand/measurement perturbations.
5. Investigate occupancy-aware bus priority or pedestrian interactions as separate extensions.

## References and implementation relationship

- [Eclipse SUMO documentation](https://sumo.dlr.de/docs/) and [TraCI](https://sumo.dlr.de/docs/TraCI/): native simulation and control interfaces used by this implementation. [FCD output conventions](https://sumo.dlr.de/docs/Simulation/Output/FCDOutput.html) provide relevant trajectory-coordinate context; this project records through TraCI subscriptions.
- Paul, Verma and Ghosh (2019), [*An Efficient Calibration Methodology of Microsimulation Model for Signalized Intersections under Heterogeneous and Indiscipline Traffic Environment*](https://research.tudelft.nl/en/publications/an-efficient-calibration-methodology-of-microsimulation-model-for/): calibration context from the university abstract; not a reproduced calibration experiment.
- Wei et al. (KDD 2019), [*PressLight: Learning Max Pressure Control to Coordinate Traffic Signals in Arterial Network*](https://faculty.ist.psu.edu/jessieli/Publications/2019-KDD-presslight.pdf): background on pressure-informed control. JunctionLab implements neither its DQN nor its arterial experiment.
- Guastella et al. (2025 preprint), [*Calibration of Vehicular Traffic Simulation Models by Local Optimization*](https://arxiv.org/html/2502.11585v1): context for count-based fitting and the distinction between count agreement and trajectory realism.

See [SUMO.md](SUMO.md) for the actual controller definitions and calibration objective. No performance result from these references is presented as a JunctionLab result.
