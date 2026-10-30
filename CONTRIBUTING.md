# Contributing

Useful contributions include reproducible bug reports, clearer model documentation, and independently checkable data adapters.

1. Open an issue with the input schema, expected behavior, source revision, and seeds where relevant. Do not upload private observations, identifiable video, student lists, or credentials.
2. Keep changes focused. Document changes to metrics, vehicle classes, demand generation, or controllers because they affect experiment interpretation.
3. Run `npm test`, `npm run test:backend`, `npm run build`, and `npm run test:geometry`. Add tests for meaningful behavior or regressions.

For native experiments, report versions, durations, command, configuration, paired seeds, and raw outputs. Separate synthetic tests, fitted observations, and held-out observations. Do not infer calibration or real-world savings from passing software tests.

See [the research overview](docs/RESEARCH.md). Contributions may be distributed under the project's MIT license.
