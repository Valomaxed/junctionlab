import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleDataset,importCounts,parseCSV,approachTotals,guessMapping,toCSV} from '../src/data.js';
import {Simulation,ROUTES,STEP,WARMUP,signalPlan,scheduledSignal,positionOnRoute,runSingle,scenarios,summarizeRuns} from '../src/engine.js';

test('CSV handles BOM, quoted commas, escaped quotes and CRLF',()=>{
  const p=parseCSV('\uFEFFname,count\r\n"a, b",2\r\n"say ""hi""",3\r\n');assert.deepEqual(p.rows,[['a, b','2'],['say "hi"','3']]);
});
test('CSV rejects malformed structures instead of silently losing data',()=>{
  for(const text of ['a,a\n1,2','a,b\n1','a,b\n"unclosed,2','a,b\n"x"bad,1'])assert.throws(()=>parseCSV(text));
});
test('sample counts and assumed movement/class expansion conserve demand',()=>{
  const d=sampleDataset();assert.equal(d.totalCount,450);assert.equal(d.duration,900);assert.equal(d.assumptions.length,2);
  const totals=approachTotals(d);assert.ok(Math.abs(totals.N-135)<1e-8);assert.ok(Math.abs(Object.values(totals).reduce((a,b)=>a+b,0)-450)<1e-8);
});
test('full field schema preserves class, turn and time bins',()=>{
  const d=importCounts('approach,count,movement,vehicle_type,interval_start,interval_minutes\nN,4,L,bus,08:00,15\nN,8,T,car,08:15,15');
  assert.equal(d.duration,1800);assert.equal(d.bins[1].start,900);assert.equal(d.bins[0].streams[0].type,'bus');assert.ok(!d.assumptions.some(s=>s.includes('Turns assumed')));
});
test('import mapping supports custom headers',()=>{
  const d=importCounts('Arm,Number\nnorth,12',{approach:'Arm',count:'Number'});assert.equal(d.totalCount,12);assert.ok(guessMapping(['Arm','Vehicle Count']).approach==='Arm');
});
test('reject invalid counts, units, categories, missing values and overlapping bins',()=>{
  for(const text of ['approach,count\nN,-1','approach,count\nN,','approach,count\nN,1.5','approach,count\nQ,4','approach,count,movement\nN,5,U','approach,count,vehicle_type\nN,5,spaceship','approach,count,interval_minutes\nN,5,0','approach,count,interval_start\nN,5,25:00','approach,count,interval_start\nN,5,0\nS,3,10'])assert.throws(()=>importCounts(text),text);
});
test('missing approaches are disclosed; zero counts are accepted',()=>{const d=importCounts('approach,count\nN,0');assert.equal(d.totalCount,0);assert.ok(d.assumptions.some(a=>a.includes('Unlisted')));});
test('CSV exports quote text and protect formula-like cells',()=>{assert.equal(toCSV([['=sum(1,2)','text"quote',3]]),'"\'=sum(1,2)","text""quote",3');});
test('signal plan exactly allocates the cycle and respects minimum green',()=>{
  for(const cycle of [80,140,200])for(const nsShare of [20,60,80]){
    const c={cycle,nsShare,clearance:8},plan=signalPlan(c);assert.ok(plan.every(p=>p.green>=4));assert.ok(Math.abs(plan.reduce((s,p)=>s+p.green+8,0)-cycle)<1e-8);
    const ns=plan.filter(p=>['N','S'].includes(p.approach)).reduce((s,p)=>s+p.green,0);assert.ok(Math.abs(ns/(cycle-32)*100-nsShare)<1e-8);
    assert.deepEqual(scheduledSignal(5,c),scheduledSignal(5+cycle,c));
  }
  const p=signalPlan({cycle:80,clearance:8,weights:{N:1,S:0,E:0,W:0}});assert.ok(p.every(x=>x.green>=4));assert.equal(p.find(x=>x.approach==='N').green,36);
});
test('turn paths use left-hand entry lanes and finite continuous positions',()=>{
  assert.ok(positionOnRoute(ROUTES.NT,0).x>0);assert.ok(positionOnRoute(ROUTES.ST,0).x<0);
  assert.ok(positionOnRoute(ROUTES.NL,ROUTES.NL.length).x>0);assert.ok(positionOnRoute(ROUTES.NR,ROUTES.NR.length).x<0);
  for(const route of Object.values(ROUTES)){for(let s=0;s<route.length;s+=.5){const p=positionOnRoute(route,s);assert.ok(Number.isFinite(p.x+p.z+p.yaw));}assert.ok(route.crossEnd>route.stop);}
});
test('vehicles are conserved; queues keep safe gaps; signals do not release conflicts',()=>{
  const sim=new Simulation(sampleDataset(),{demand:2});let checked=0;
  for(let tick=0;tick<3600;tick++){
    const old=new Map(sim.active.map(v=>[v.id,{s:v.s,len:v.length,route:ROUTES[v.approach+v.movement]}]));sim.step();
    const backlog=Object.values(sim.pending).reduce((s,q)=>s+q.length,0);assert.equal(sim.generated,sim.completed+sim.active.length+backlog);
    const crossing=new Set();
    for(const v of sim.active){
      const r=ROUTES[v.approach+v.movement],before=old.get(v.id);assert.ok(v.s>=0&&v.speed>=0);
      if(before&&before.s+v.length/2<=r.stop&&v.s+v.length/2>r.stop)assert.equal(sim.signal.approach,v.approach,'red-line crossing');
      if(v.s+v.length/2>r.stop&&v.s-v.length/2<r.crossEnd)crossing.add(v.approach);
    }
    assert.ok(crossing.size<=1,'conflicting crossing approaches');
    for(const list of Object.values(sim.routes))for(let i=1;i<list.length;i++)assert.ok(list[i-1].s-list[i].s-(list[i-1].length+list[i].length)/2>=2.3-1e-7,'minimum gap');
    checked++;
  }
  assert.equal(checked,3600);assert.ok(sim.metrics().stopped>0);assert.ok(sim.metrics().departures>0);
});
test('fixed seeds repeat exactly and paired scenarios get identical arrival demand',()=>{
  const d=sampleDataset(),c={cycle:140,nsShare:60,clearance:8,demand:1,seed:2026};
  const a=runSingle(d,c,300),b=runSingle(d,c,300);assert.deepEqual(a,b);
  for(const scenario of scenarios(d,c))assert.equal(runSingle(d,scenario.config,300).arrivals,a.arrivals);
});
test('empty demand stays finite; summary uses sample standard deviation',()=>{
  const d=importCounts('approach,count\nN,0'),r=runSingle(d,{},60);assert.equal(r.delay,0);assert.equal(r.throughput,0);assert.equal(r.pending,0);assert.ok(Math.abs(r.elapsed-60)<1e-7);
  const s=summarizeRuns([{...r,delay:1},{...r,delay:3}]);assert.equal(s.delay.mean,2);assert.ok(Math.abs(s.delay.sd-Math.sqrt(2))<1e-8);
});
