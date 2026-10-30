# Field calibration and independent validation

## Current evidence

The automated tests check parser behavior, demand preservation, phase timing, continuous route positions, nonnegative motion, vehicle conservation, minimum following gaps, red-line release, conflicting intersection occupancy and fixed-seed repeatability. They are implementation checks, not traffic-model validation.

No completed field-count workbook or quantitative queue/discharge observations have been integrated. No observed queue/delay fit, measured savings or calibration accuracy is claimed.

## Convert the prototype into a field study

1. Survey the actual surface network under IIT Flyover and label approach arms. Record lane use, legal movements, signal sequence/durations and clearance times. The current split-phase, dedicated-turn-lane network is only a concept. Update it or use SUMO if the actual operation requires lane-sharing and complex movements.
2. Keep separate count sessions for comparable weekdays and morning/evening periods. Record vehicle classes and turning movements in 15-minute bins. Keep geometry, signal plans, weather/incidents and observer notes in a data dictionary.
3. Record discharge headways, queue tails per cycle, residual queues and vehicle stopped times using definitions aligned with simulation outputs. Record queues extending beyond observation limits as censored.
4. Select one session for calibration. Define your calibration parameters and objective before tuning; examples are per-arm queue MAE, maximum-queue error and discharge headway error. Do not fit simultaneously to calibration and validation days.
5. Freeze the selected parameters and compare a held-out session. Report absolute errors by approach/interval, any censored observations and failure cases. Do not choose a percentage target after seeing the fit.
6. Run scenario experiments with the same demand and seeds. Use more seeds when variability remains large. Check throughput and unfinished traffic as well as delay so apparent improvement does not result from suppressing entry demand.
7. Preserve raw data provenance, cleaned CSV, model settings, code revision and raw per-seed results. Add screenshots and a short screen recording to the repository.

## Reproducibility package

- Runnable demo and source repository.
- README with architecture, reproducible run commands and honest limitations.
- Data dictionary and a small shareable anonymized field-data sample, if authorized.
- Calibration and held-out validation plots/tables.
- Saved scenario CSV/JSON and the narrated demo recording.
- Study conclusions tied to verified measured outcomes.

## Extension path

The SUMO/TraCI adapter and native trajectory replay are implemented in version 2.0. Follow [SUMO.md](SUMO.md) to run your counts, supply a surveyed single-junction network, fit global headway/gap parameters on training observations and generate a separate error report on a held-out session. The included benchmark and calibration round-trip check use synthetic observations, so field calibration and validation remain outstanding.
