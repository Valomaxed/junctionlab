// Regenerate the public report directly from the checked-in native benchmark.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const b=JSON.parse(await readFile(path.join(root,'data/sumo-demo.json'),'utf8'));
const fmt=(v,n=1)=>Number(v).toFixed(n);
const value=(r,k,n=1)=>`${fmt(r.summary[k].mean,n)} ± ${fmt(r.summary[k].sd,n)}`;
const rows=b.results.map(r=>`| ${r.name} | ${value(r,'delay')} | ${value(r,'queue')} | ${value(r,'throughput',0)} | ${value(r,'pending')} |`).join('\n');
const comparisons=b.results.slice(1).map(r=>{
  const p=r.pairedDelay,ci=p.ci95;
  return `| ${r.name} − fixed-time | ${fmt(p.mean)} | ${ci?`[${fmt(ci[0])}, ${fmt(ci[1])}]`:'Not estimated'} |`;
}).join('\n');
const text=`# Native benchmark results

**Synthetic demonstration only.** No result on this page is an observed improvement at the IIT Flyover junction. Demand, geometry, driver behavior, and reference signal settings are assumed. Field calibration and independent validation remain pending.

This page is generated from [the full bundle](../data/sumo-demo.json) by \`npm run report\`. The [raw per-run CSV](../data/sumo-demo.runs.csv) supports inspection of individual seeds, schedule hashes, counts, and unfinished demand.

## Experiment configuration

| Item | Value |
|---|---|
| Native engine | ${b.engine.name} ${b.engine.version.replace(/^SUMO\s+/,'')} |
| Controllers | Fixed-time, custom actuated, constrained queue-pressure |
| Seeds | ${b.seeds.join(', ')} |
| Runs | ${b.results.length} controllers × ${b.seeds.length} paired seeds = ${b.results.length*b.seeds.length} |
| Warm-up | ${b.warmup} s |
| Analysis | ${b.duration} s |
| Reference timing | Nominal ${b.config.cycle} s cycle; N/S combined allocation ${b.config.nsShare}% |
| Geometry | Generated concept; dedicated left/through/right entry lanes |
| Demand source | Synthetic 15-minute counts; analysis uses its first five minutes |
| Trajectory replay | Representative seed ${b.seeds[0]}; summaries use every seed |

The same scheduled arrival file is reused for every controller within a seed. SUMO's subsequent behavior can respond differently to each signal strategy. Minimum clearance plus internal-link guards can lengthen the effective fixed-time cycle.

## Aggregate outcomes

Values are **mean ± sample standard deviation across seeds**, not confidence intervals.

| Controller | Stopped delay (s/arrival) | Mean approach queue (m) | Network-exit throughput (veh/h) | External backlog at end (vehicles) |
|---|---:|---:|---:|---:|
${rows}

![Synthetic native stopped-delay comparison](media/benchmark.svg)

## Paired stopped-delay differences

Each seed supplies an alternative-minus-fixed-time difference. The interval is a percentile bootstrap with 4,000 resamples and bootstrap seed 702. Negative values favor the alternative for this metric in this example. With five pairs, this is a demonstration of the method; input/model uncertainty is not included.

| Comparison | Mean difference (s/arrival) | Paired 95% bootstrap interval |
|---|---:|---:|
${comparisons}

Actuated control has lower stopped delay in this saved example. The queue-pressure delay interval spans zero, and its queue and throughput outcomes do not support a general superiority claim. Do not select an intervention using delay alone or extrapolate this short synthetic comparison to the field site.

## Metric definitions

- **Stopped delay:** analysis-window vehicle-seconds below 0.5 m/s, including waiting for insertion, divided by scheduled analysis-window arrivals. Includes unfinished traffic and warm-up carryover stopped during analysis. It is not completed-trip mean delay.
- **Mean queue:** longest stopped tail on each entry arm, averaged over arms and time. Queues beyond finite links are tracked as separate external backlog.
- **Throughput:** network exits during analysis, expressed per hour. Warm-up carryover may contribute exits; this is not identical to stop-line discharge.
- **External backlog:** vehicles still waiting to enter at the end. Compare it with active vehicles and arrival/departure counts.
- **Fuel/CO₂:** only illustrative idle estimates (0.8 L/vehicle-hour; 2.31 kg/L), not a calibrated fleet-emissions model.

See [SUMO.md](SUMO.md) for controller logic, observation-boundary alignment, and exact commands; [RESEARCH.md](RESEARCH.md) for the field-study plan.
`;
await mkdir(path.join(root,'docs/media'),{recursive:true});
await writeFile(path.join(root,'docs/RESULTS.md'),text);
const barX=210,width=500,max=70;
const bars=b.results.map((r,i)=>{
  const y=115+i*75,v=r.summary.delay.mean,w=width*v/max;
  return `<text x="30" y="${y+25}" font-size="17" fill="#213b35">${r.name}</text><rect x="${barX}" y="${y}" width="${w}" height="37" rx="5" fill="${i===1?'#4e7953':'#95a982'}"/><text x="${barX+w+12}" y="${y+25}" font-size="17" fill="#213b35">${fmt(v)} s</text>`;
}).join('');
const ticks=Array.from({length:8},(_,i)=>`<line x1="${barX+width*i/7}" y1="98" x2="${barX+width*i/7}" y2="321" stroke="#d5dfca"/><text x="${barX+width*i/7}" y="347" font-size="12" text-anchor="middle" fill="#65756b">${i*10}</text>`).join('');
await writeFile(path.join(root,'docs/media/benchmark.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="820" height="420" viewBox="0 0 820 420" role="img" aria-labelledby="title description"><title id="title">Synthetic native SUMO mean stopped-delay comparison</title><desc id="description">Fixed-time 56.2, actuated 33.9, queue-pressure 53.8 seconds per arrival. Five paired seeds. Field validation pending.</desc><rect width="820" height="420" rx="18" fill="#f2f5e9"/><g font-family="Arial, sans-serif"><text x="30" y="40" font-size="23" font-weight="700" fill="#213b35">Stopped delay · synthetic demonstration</text><text x="30" y="69" font-size="14" fill="#65756b">Mean across five paired seeds; bars do not show confidence intervals.</text>${ticks}${bars}<text x="460" y="373" text-anchor="middle" font-size="13" fill="#65756b">Seconds per scheduled arrival</text><text x="30" y="404" font-size="12" fill="#65756b">Generated geometry · 120 s warm-up + 300 s analysis · field validation pending</text></g></svg>`);
console.log('Generated docs/RESULTS.md and docs/media/benchmark.svg from the native bundle.');
