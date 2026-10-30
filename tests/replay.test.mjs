import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateSumoBundle,SumoReplay} from '../src/replay.js';
const bundle=JSON.parse(fs.readFileSync(new URL('../data/sumo-demo.json',import.meta.url),'utf8'));
test('native SUMO recording has paired schedules and valid finite data',()=>{
  assert.equal(validateSumoBundle(bundle),bundle);assert.equal(bundle.results.length,3);assert.equal(bundle.seeds.length,5);
  for(let i=0;i<bundle.seeds.length;i++){
    const runs=bundle.results.map(r=>r.runs[i]);assert.equal(new Set(runs.map(r=>r.scheduleHash)).size,1);assert.equal(new Set(runs.map(r=>r.arrivals)).size,1);
    for(const r of runs)assert.equal(r.scheduledTotal,r.insertedTotal+r.pending);
  }
});
test('replay seeks endpoints and interpolates positions without mutating the recording',()=>{
  const replay=new SumoReplay(bundle);assert.equal(replay.elapsed,0);const frames=replay.recording.frames;
  const first=frames.findIndex((f,i)=>i<frames.length-1&&f.v.some(p=>frames[i+1].v.some(q=>q[0]===p[0])));
  const a=frames[first],b=frames[first+1],p=a.v.find(p=>b.v.some(q=>q[0]===p[0])),q=b.v.find(q=>q[0]===p[0]);const before=JSON.stringify(p);
  replay.seek((a.t+b.t)/2);const v=replay.active.find(v=>v.id===p[0]);assert.ok(Math.abs(v.pose.x-(p[1]+q[1])/2)<1e-7);assert.ok(Math.abs(v.pose.z-(p[2]+q[2])/2)<1e-7);assert.equal(JSON.stringify(p),before);
  replay.seek(bundle.duration+10);assert.equal(replay.elapsed,bundle.duration);assert.equal(replay.metrics().arrivals,bundle.results[0].runs[0].arrivals);replay.seek(-3);assert.equal(replay.elapsed,0);
});
test('bad engine, positions, classes, clocks and seed pairing are rejected',()=>{
  for(const edit of [b=>b.engine.name='Fake',b=>b.results[0].replay.frames[0].t=10,b=>b.results[0].runs[0].seed=5,b=>b.results[0].replay.frames[1].v[0][1]=NaN,b=>b.results[0].replay.catalog[Object.keys(b.results[0].replay.catalog)[0]].type='spaceship']){
    const b=structuredClone(bundle);edit(b);assert.throws(()=>validateSumoBundle(b));
  }
});
