# Native SUMO pipeline — JunctionLab 2.0

This is a working offline pipeline and browser replay adapter. It is not an online SUMO server. The provided demo was executed in Eclipse SUMO 1.24.0 with synthetic counts, assumed behavior and generated geometry; real-junction calibration and independent validation remain pending.

## Install separately from your global Python

From the project directory, use Python 3.10+ and Node.js 20+:

```sh
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.venv\Scripts\python.exe backend/junctionlab.py --help
```

On macOS/Linux, use `.venv/bin/python` in place of `.venv\Scripts\python.exe`. The official `eclipse-sumo` wheel supplies the native binaries; the pinned `traci` and `sumolib` packages provide Python interfaces. SUMO uses a local loopback TCP connection for TraCI.

## Reproduce the bundled example

```powershell
.venv\Scripts\python.exe backend/junctionlab.py run --input data/sample-counts.csv --output runs/example.json --work-dir runs/example-native --duration 300 --seeds 2026,2027,2028,2029,2030 --sample
```

Choose a new, empty `--work-dir` for each experiment. The five-minute measurement starts after a 120 s loading period. The example uses the first five minutes of the synthetic 15-minute demand bin. Its expected arrivals are stochastic, not exactly the bin count scaled by time.

Outputs:

- `example.json`: complete benchmark, representative recordings, geometry, decisions and summary statistics.
- `example.runs.csv`: raw per-seed metrics with arrival-schedule hashes and explicit uncalibrated status.
- Native network, identical per-seed route files and SUMO logs in the work directory.

Open the website, choose **Open SUMO results**, and select `example.json`. The included **Load SUMO demo** button reads `data/sumo-demo.json`, copied into the static build.

Replay uses the first seed’s trajectory recording for each controller; the comparison table uses all seeds. Playback and camera controls never rerun or alter the native experiment. Input sliders are locked in replay mode. Switch back to **Browser model** for immediate parameter exploration with the separate JavaScript engine.

## Use your own counts

The native CLI accepts the canonical CSV schema documented in the README. For custom Excel column names or aliases, use the browser’s CSV mapping, switch to Browser model and export Project JSON. Then:

```powershell
.venv\Scripts\python.exe backend/junctionlab.py run --input junctionlab-project.json --output runs/my-study.json --work-dir runs/my-study-native
```

Without `--duration`, the complete count session is measured. Without `--seeds`, the default is ten paired seeds (2026–2035). Increase replication when uncertainty is too large for the question being studied. Short runs and small seed counts demonstrate the workflow but do not establish robust field performance.

Scheduled arrivals are explicitly generated once per seed and reused for every controller. The same schedule hash should appear across all controllers for a given seed. SUMO’s internal stochastic driver behavior can still respond differently to different controllers.

## Supply a surveyed network

The default network is a generated left-hand, four-arm concept with three entry lanes per arm and dedicated L/T/R movements. To replace it, create a valid SUMO `.net.xml` and edit `backend/network-mapping.example.json` to map the entry arms and permitted routes:

```powershell
.venv\Scripts\python.exe backend/junctionlab.py run --input field-counts.csv --net-file survey.net.xml --mapping mapping.json --output runs/survey.json --work-dir runs/survey-native
```

Only one signalized junction is supported. Four distinct incoming edges must map to N/E/S/W; these refer to the arm vehicles enter from, not their travel heading. Route keys are the arm plus L/T/R. Supply only legal, connected movements; a nonzero demand stream without a mapped route is rejected. Check vehicle-class permissions in the supplied network.

The viewer renders lanes and junction polygons from that SUMO network. A supplied network is labeled user-supplied and unvalidated; supplying a file does not establish that it matches the field site.

## Controllers

All native controllers release one approach at a time. They apply 3 s amber, 5 s minimum all-red and wait for the controlled junction’s internal links to clear. The clearance guard can extend all-red and therefore lengthen the effective cycle.

1. **Fixed-time:** N–E–S–W order; nominal 140 s cycle with 40% of usable green for N/S combined. These are assumed reference settings, not observed timings.
2. **Actuated:** cyclic demand-responsive selection; ends green when the served arm has no detected approaching demand and another arm does. Minimum green 8 s, maximum green 50 s. Detection includes stopped vehicles and moving vehicles within 35 m of the stop line. This is the project’s TraCI implementation, not SUMO’s built-in actuated controller.
3. **Queue-pressure:** selects an eligible arm using stopped movement queues minus turning-weighted stopped downstream edge counts, multiplied by an assumed 0.5 saturation factor. Minimum/maximum green and a switching threshold constrain changes. A waiting arm exceeding the 180 s aging threshold gets service priority. This is a documented pressure heuristic; no published stability/optimality guarantee is claimed for it, and the aging rule is not an unconditional maximum-wait guarantee.

Candidate settings can be supplied with `--config config.json`. Recognized fields: `cycle`, `nsShare`, `demand`, `tau`, `minGap`, `minGreen`, `maxGreen`, `maxRed`, `pressureThreshold`, `amber`, `allRed`. Amber/all-red are fixed at 3/5 s in this version.

The native car-following model is SUMO’s default Krauss model. Vehicle dimensions, free speeds and acceleration differ by class; the two fitted parameters currently apply globally. Per-class behavior fitting, sublane behavior and bus-priority control are future extensions.

## Parameter fitting on training observations

Fill `data/observations-template.csv` using measured means and departures. Blank values mean unknown, not zero. Every row needs at least one measured metric. Required columns:

| Column | Meaning |
|---|---|
| `approach` | N/E/S/W entry arm |
| `interval_start_s` | Seconds after measurement begins; warm-up excluded |
| `interval_seconds` | Measurement interval length |
| `mean_queue_m` | Time-average of the longest stopped tail across that arm’s lanes |
| `departures` | Vehicles exiting the modeled network, attributed to their original entry arm |

**Boundary alignment matters:** the simulator’s departures are network exits. Counts across the stop line are not the same measure unless the observation boundary is aligned or exit travel/boundary effects are handled. Queue observations should use the same stopped-speed threshold and physical definition. Do not compare an end-of-red maximum with a time-average queue.

Exported intervals are 900 s, with a shorter final interval when needed. Observation intervals must match these exported intervals. For the bundled 300 s recording, use start 0 and duration 300; do not use the template’s 900 s interval unchanged.

```powershell
.venv\Scripts\python.exe backend/junctionlab.py calibrate --input train-counts.csv --observations train-observations.csv --grid backend/calibration-grid.example.json --output runs/fitted.json --work-dir runs/fit-native
```

Add `--net-file survey.net.xml --mapping mapping.json` to fit on your surveyed network. The grid fits global desired headway `tau` and minimum gap `minGap`. The documented objective is queue RMSE divided by `--queue-scale-m` plus discharge MAE divided by `--discharge-scale-vehicles`; both default normalization scales are 10. Omit a metric by leaving that observation column blank. The resulting score is an explicit modeling choice, not a universal traffic-calibration standard.

The output records every candidate, errors, normalization scales, selected parameters and training provenance. It explicitly leaves independent validation false.

## Validate on a separate session

```powershell
.venv\Scripts\python.exe backend/junctionlab.py run --input heldout-counts.csv --config runs/fitted.json --net-file survey.net.xml --mapping mapping.json --output runs/heldout.json --work-dir runs/heldout-native
.venv\Scripts\python.exe backend/junctionlab.py validate --bundle runs/heldout.json --observations heldout-observations.csv --output runs/validation.json
```

The report includes queue MAE/RMSE, departure-count MAE and descriptive GEH based on hourly-equivalent rates. It does not choose a pass threshold or certify that the supplied observations were genuinely held out. Keep training and validation sessions separate and report errors by approach, not only an aggregate score.

## Metrics and uncertainty

- **Accrued stopped delay:** analysis-window vehicle-seconds below 0.5 m/s, including waiting for insertion, divided by scheduled analysis-window arrivals. Includes unfinished traffic and warm-up carryover waiting during analysis; not completed-trip mean delay. Zero-arrival ratios are displayed as zero rather than an accuracy estimate.
- **Queue:** for each incoming arm, longest stopped tail distance from its stop line, then averaged over arms and time. Queues outside finite links appear as separate external backlog.
- **Throughput:** analysis-window network exits per hour. Warm-up carryover may contribute exits.
- **Fuel/CO₂:** idle-only illustrative factors, 0.8 L/vehicle-hour and 2.31 kg/L. Native execution does not make these factors a calibrated fleet model.
- **Paired interval:** percentile bootstrap of per-seed alternative-minus-fixed-time delay differences, 4,000 resamples with a fixed bootstrap seed. Shown only with at least five seeds. A negative value favors the alternative; an interval crossing zero does not distinguish the sign under this procedure. Small samples can yield imprecise intervals; field/input uncertainty is separate from stochastic variation.

## Tests and provenance

`npm test` checks the included bundle’s schedule pairing, finite trajectories, clocks, import rejection and interpolation, as well as the original browser engine. `npm run test:backend` checks demand normalization, schedules, controller transitions, service priority and paired statistics. Geometry smoke checks are available after building.

The native benchmark was actually executed with the pinned binary. A separate synthetic observation round-trip exercises fitting and recovers its generating parameters; that test is not independent field validation. The bundled raw results are in `data/sumo-demo.runs.csv`.

Official interfaces: [SUMO installation](https://sumo.dlr.de/docs/Downloads.php), [TraCI](https://sumo.dlr.de/docs/TraCI/), [traffic-light state changes](https://sumo.dlr.de/docs/TraCI/Change_Traffic_Lights_State.html). See [the research overview](RESEARCH.md) for context and the distinction from published controllers.
