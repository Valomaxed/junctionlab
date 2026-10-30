# Browser CSV import reference

Use CSV UTF-8 (comma delimited) from Excel, with one contiguous session per file. Different days or peak periods should be separate experiments.

Minimum example:

```csv
approach,count
N,135
S,135
E,90
W,90
```

Full example:

```csv
approach,count,interval_start,interval_minutes,movement,vehicle_type
N,20,08:00,15,T,car
N,8,08:00,15,L,motorcycle
E,3,08:00,15,R,bus
N,24,08:15,15,T,car
```

All values above are synthetic format examples. `count` is whole vehicles in the interval, not veh/h or PCU. N/S/E/W refer to entry arms, not headings. See [DATA.md](DATA.md) for survey-direction and class mapping.

- Starts accept HH:MM or numeric minutes. Earliest start becomes analysis time zero.
- Default interval duration: 15 minutes.
- Identical start/duration bins combine. Distinct overlapping intervals are rejected; gaps have zero arrivals.
- Missing movement column assumes L20%, T65%, R15%.
- Missing type column assumes car45%, motorcycle30%, auto15%, bus5%, truck5%.
- Supported movements: L/T/R. Supported canonical types: car/motorcycle/auto/bus/truck.
- Unlisted entry arms have zero demand. Counts sum, so do not include totals plus components.
- The browser maps custom column names and selected aliases. The native CLI expects canonical CSV or Project JSON exported by the browser.
- Limits: 5 MB, 100,000 counted vehicles, and four hours per session.
- Quoted cells, BOM, and CRLF are supported. Duplicate headers, mismatched row widths, malformed quotes, and invalid values are rejected.

## From import to experiment

1. Inspect raw counts and survey provenance before selecting a file.
2. Choose **Import CSV**, map fields, and review the preview and assumptions.
3. Apply the import, set configuration, and run paired scenarios.
4. Export **Results CSV** and **Project JSON** together with the source revision.
5. For native execution, use the Project JSON with the [SUMO pipeline](SUMO.md).

CSV parsing stays in the browser. Loading observations does not automatically fit parameters. A browser import badge describes the input source, not validation status.
