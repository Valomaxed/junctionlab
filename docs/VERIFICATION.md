# Verification record

Version 2.0 verified on 28 October 2026. Original browser-engine UI checks were performed on 27 October 2026.

## Automated

- `npm test`: 16 passing test groups. Includes the original parser/motion/signal checks plus native-recording schema validation, shared schedule hashes and arrival counts across controllers, interpolation, endpoint seeking and rejection of malformed trajectories/seed pairing.
- `npm run test:backend`: 8 passing tests covering count preservation, schedules, controller clearance, minimum green, aging service, configuration guards, observation errors/interval alignment and paired bootstrap behavior.
- `npm run build`: successful portable static build with local Three.js modules.
- `npm run test:geometry`: all five procedural vehicle models built successfully; merged geometry is finite and nonempty; instanced buffers have the intended capacity.
- Native Eclipse SUMO 1.24.0 executed 15 bundled runs: fixed-time, actuated and queue-pressure across seeds 2026–2030, with a 120 s loading period and 300 s analysis. The JSON and raw run CSV are included in `data/`.
- Four additional native simulations exercised parameter fitting against synthetic queue/discharge observations. The fitter recovered the generating global headway/gap parameters with effectively zero training error. This is a software round-trip, not field validation.

## Browser verification

- The SUMO demo loaded real native trajectories, network lane/junction geometry, recorded signals, paired summaries and bootstrap intervals. Controller selection and seeking to the end of a recording worked; sliders were disabled during replay and controller decision reasons were shown.
- Importing the actual native benchmark JSON through the file chooser succeeded and populated the recording and comparison results. The file remained browser-local. No browser console warnings/errors were observed during native replay inspection.
- The real WebGL scene rendered with traffic, road markings, signals, shadows and the surrounding conceptual streetscape. Browser warning/error log was empty during inspection.
- Orbit, top and street camera controls were exercised. A street-camera obstruction found during inspection was repaired and rechecked.
- Individual vehicle picking displayed class/ID, approach, movement, speed and stopped time. Vehicle selection clears when that vehicle exits.
- Pause/playback and seeded restart controls were exercised.
- CSV upload was exercised with `data/sample-counts.csv`: mapped columns and preview appeared, import applied all four rows, the dataset badge changed, and the simulation restarted from imported demand.
- All 12 Web Worker scenario runs completed and the comparison table displayed means, standard deviations and relative delay changes. Results export became enabled.

## Boundaries of this evidence

This verifies software behavior, not field calibration. Native Excel `.xlsx`, bus-priority control, surveyed geometry and real-world delay/emissions accuracy remain outside the completed work. The native pipeline supports a supplied single-junction network, but no field network was available to verify that path end to end. No maximum file-size workload, very long study session or cross-browser performance benchmark was tested. Exports are implemented; downloading and reopening browser exports was not separately verified. Native results were loaded through both the included-demo button and actual file import.

The deployed demo starts owner-private. Sharing it with recruiters requires a separately authorized audience change or deployment to hosting you control.
