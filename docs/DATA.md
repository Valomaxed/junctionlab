# Data guide

## Included files and provenance

| File | Purpose | Provenance |
|---|---|---|
| `data/sample-counts.csv` | Small browser/native demand example | Synthetic 15-minute counts: N/S 135 each, E/W 90 each. |
| `data/sumo-demo.json` | Complete saved native experiment and replay | Executed with SUMO 1.24.0; synthetic demand, generated geometry. |
| `data/sumo-demo.runs.csv` | One row per controller/seed | Raw outputs from the saved 15-run example. |
| `data/observations-template.csv` | Format for fitting/evaluation observations | Template, not measured data. |

Private survey files belong outside version control (for example `data/private/`, which is ignored). Record site, date, times, measurement method, rejected observations, class definitions, and missing intervals. Do not upload student lists or identifiable footage.

## Turning-count lab to simulator mapping

The survey labels approaches by **travel direction**. JunctionLab labels them by **entry arm**:

| Survey approach | Enters from | JunctionLab `approach` |
|---|---|---|
| NB | South leg | S |
| SB | North leg | N |
| EB | West leg | W |
| WB | East leg | E |

For oblique roads, preserve the agreed north arrow and site sketch. L/T/R are relative to travel direction. Confirm the exit arm for each movement rather than relying on a label alone.

A lab sheet with columns `Interval, Start time, Approach, Class, L, T, R` must be reshaped into one row per movement. Do not import its totals alongside component rows.

## Canonical CSV

```csv
approach,count,interval_start,interval_minutes,movement,vehicle_type
S,41,08:30,15,L,motorcycle
S,96,08:30,15,T,motorcycle
S,22,08:30,15,R,motorcycle
```

Those values illustrate the format; they are not observations. An Excel workbook must first be exported as CSV UTF-8. Native `.xlsx` parsing is not implemented. Browser column mapping handles custom column names; the native CLI expects canonical names or an exported Project JSON.

| Column | Definition |
|---|---|
| `approach` | N/S/E/W entry arm, as mapped above. |
| `count` | Nonnegative integer count of physical vehicles in the interval. |
| `interval_start` | HH:MM or numeric minutes; earliest interval becomes analysis time zero. |
| `interval_minutes` | Positive interval duration; defaults to 15. |
| `movement` | L/T/R. U-turns are not supported. |
| `vehicle_type` | car, motorcycle, auto, bus, truck. |

The minimum schema is `approach,count`. Missing movement/type fields invoke disclosed assumed mixtures. Missing intervals are treated as zero arrivals, so preserve genuine observation gaps explicitly in provenance rather than silently interpreting them as observed zero traffic.

## Vehicle-class compatibility

| Lab code | Possible model category | Qualification |
|---|---|---|
| 2W | motorcycle | Coarse motorized two-wheeler category. |
| 3W | auto | Generic powered auto-rickshaw; no separate e-rickshaw behavior. |
| C | car | Coarse car/jeep/van/SUV class. |
| B | bus | Generic bus, without stop dwell or occupancy model. |
| HCV | truck | Generic truck dimensions/behavior. |
| LCV | truck | Import alias exists, but this collapses distinct vehicle behavior. Disclose it. |
| CY, CR, HA | No faithful implemented category | Keep in the survey; do not silently drop them or map them to motorcycles/cars. Extend the model or explicitly restrict and report the modeled subset. |
| PED | Not vehicle demand | Preserve in a separate pedestrian table; pedestrian interactions are not implemented. |

The browser also accepts `taxi` as car, `bike`/`scooter`/`two-wheeler` as motorcycle, and `rickshaw` as auto. Use explicit canonical types for reproducible native CSV input.

## Vehicles, PCU, demand, and discharge

Use **individual vehicle counts** for simulated arrivals. PCU totals and peak-hour factors are separate analysis quantities; do not insert PCU as a count of physical vehicles. Any PCU analysis must retain its source, applicability conditions, and vehicle-class assumptions.

The lab's stop-line count is a count of vehicles served. If queues do not clear, it can be lower than arrival demand. Record residual queues, observation boundaries, and blocked cycles; simply using stop-line counts as arrival rates can reproduce served flow while missing congestion.

The native pipeline's `departures` metric counts exits from the modeled network, attributed to original entry arm. It is not the same boundary as a stop-line count. Align boundaries or account for travel-time and boundary effects before fitting or validating. See [SUMO.md](SUMO.md).

## What is needed for a field-based study?

- Classified counts across all modeled arms and movements, with contiguous interval timestamps.
- A sketch or surveyed network: lanes, allowed connections, lengths, medians/slip lanes, stops, and the north arrow.
- Observed signal phases, movements served, green/amber/all-red, and cycle variability.
- Quantitative queue/discharge observations using the model's definitions, for fitting.
- A separate observation session for independent evaluation.

Importing counts only establishes the demand input. It does not establish behavior calibration, geometry accuracy, or held-out prediction quality.
