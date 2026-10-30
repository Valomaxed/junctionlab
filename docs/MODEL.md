# Model card — JunctionLab browser engine

JunctionLab 2.0 also includes a native Eclipse SUMO pipeline. This document describes the separate browser engine. Native execution, controller definitions, fitting and replay are documented in [SUMO.md](SUMO.md). Neither engine has been validated against the selected junction’s field observations.

## Intended use

Educational what-if experiments, software demonstrations and preparation for a field-calibrated study. Not an operational signal controller or a basis for recommending a road intervention without independent validation.

## Network and vehicles

Four 100 m approaches to an illustrative surface intersection. Three dedicated entry lanes per arm, one per L/T/R movement. Lane centers are 1.65, 4.95 and 8.25 m from the median, with right-turn traffic nearest the median under left-hand driving. Every route has a straight entry, a cubic Bézier intersection segment sampled by arc length, and a straight exit. No vehicle lane-changing is modeled.

| Class | Length (m) | Width (m) | Free speed (m/s) | Acceleration (m/s²) |
|---|---:|---:|---:|---:|
| Car | 4.4 | 1.8 | 11.1 | 2.2 |
| Motorcycle | 2.1 | 0.75 | 11.1 | 2.8 |
| Auto | 2.8 | 1.45 | 9.0 | 1.9 |
| Bus | 10.8 | 2.5 | 9.7 | 1.3 |
| Truck | 8.0 | 2.5 | 9.2 | 1.2 |

All behavior values are assumptions. The visual envelope may include mirrors and a rider beyond the simplified physical dimensions.

## Motion and safety rules

At 0.2 s fixed steps, routes update in front-to-back order. Vehicles accelerate up to their class speed, reduce speed on a turn, respond to the leader’s speed and available gap, and stop at a red signal. A geometric displacement guard prevents a gap below 2.3 m and prevents crossing a red stop line. Acceleration is bounded; braking can be abrupt due to the safety guard. This is a custom kinematic model, not a validated IDM/Krauss implementation.

Per-class maximum turn speeds: 5.5 m/s on left turns, 6.5 m/s on right turns, bounded by class free speed. Signal-stop speed responds to a square-root distance rule using an assumed 3 m/s² braking term. Following response uses a 1.25 s gap term. These parameters require calibration.

Split phasing releases one arm at a time, in N–E–S–W order. Each phase has green, then 3 s amber (no new entries), then 5 s all-red. Each arm receives at least 4 s green; green weights are redistributed when that minimum binds. An additional geometric clearance check holds a scheduled green red while another arm still occupies the intersection. That lost time reduces effective green; it does not extend the configured cycle.

The actual IIT junction’s surveyed geometry and signal program have not been reproduced. The flyover is intentionally absent.

## Arrivals and conservation

Each imported interval defines per-arm arrival rates and conditional class/turn proportions. Independent Poisson counts are sampled at each fixed step with a seeded 32-bit linear congruential generator. A vehicle unable to enter remains in an external FIFO queue for its route. It continues to accrue waiting; it is never silently discarded.

At all times: generated vehicles = completed vehicles + active vehicles + external backlog. The same seed and demand inputs generate the same arrivals in every signal scenario. Only arrivals and their class/color selection consume the simulation RNG.

Warm-up: 120 s using the first demand bin. Analysis follows the imported session length. Queue and delay accumulation starts after warm-up. Warm-up vehicles remain in the model and their analysis-window waiting and exits are included.

## Metrics

- **Accrued stopped delay per arrival:** total vehicle-seconds at speed <0.5 m/s during analysis, plus external backlog vehicle-seconds, divided by analysis-window arrivals. Includes waiting by unfinished vehicles and by warm-up carryover within the window. Excludes waiting before analysis. Not completed-trip delay. When arrivals are zero, display 0 with counts available; this ratio is undefined as an estimator when residual warm-up traffic exists and no new arrivals occur.
- **Mean queue:** for each arm at each step, distance from the stop line to the rearmost stopped vehicle’s rear, taking the maximum across its lanes. Average across arms and analysis time. External queues are reported separately. This model omits the spatial extent of backlog beyond the 100 m entry links.
- **Peak queue:** largest arm queue distance observed in the analysis window.
- **Throughput:** exits divided by analysis seconds, multiplied by 3,600. Exits include warm-up carryover. Input demand and unfinished counts must be considered alongside it.
- **Idle fuel / CO₂:** stopped vehicle-hours × 0.8 L/h; fuel × 2.31 kg/L. Same assumed factors for every class. Excludes running fuel, acceleration and non-CO₂ pollutants. Not suitable for real fleet emissions claims.
- **Scenario summary:** arithmetic mean and sample standard deviation over seeds 2026–2028. Paired seeds are not equivalent to field validation or a statistical significance test.

## Scenario definitions

Baseline uses the current cycle, N–S green share and demand multiplier. Demand-matched timing allocates green by total count per arm, subject to minimum green. Shorter cycle uses 75% of baseline cycle rounded to 5 s, with an 80 s minimum. Combined applies both changes. No automatic claim of optimality is made: flow composition, fixed clearances and turn dynamics can make a scenario worse.

## Known omissions

Surveyed lane geometry and restrictions; mixed traffic lateral movement; permissive turning; pedestrians; cyclists; U-turns; intersection blocking by receiving-link congestion; bus stops; real driver behavior distributions; controller coordination; calibrated emissions; temporal demand within each observation bin. High demand can create backlog even where the visible finite road looks less congested, so always report backlog.
