import {APPROACHES,MOVEMENTS,approachTotals} from './data.js';
export const STEP=.2,WARMUP=120,ROAD_LENGTH=100,JUNCTION=14;
export const VEHICLES={car:{length:4.4,width:1.8,height:1.5,maxSpeed:11.1,accel:2.2},motorcycle:{length:2.1,width:.75,height:1.5,maxSpeed:11.1,accel:2.8},auto:{length:2.8,width:1.45,height:1.8,maxSpeed:9,accel:1.9},bus:{length:10.8,width:2.5,height:3.15,maxSpeed:9.7,accel:1.3},truck:{length:8,width:2.5,height:3.2,maxSpeed:9.2,accel:1.2}};
export const DEFAULT_CONFIG={cycle:140,nsShare:40,demand:1,clearance:8,seed:2026};
const DIR={N:[0,1],S:[0,-1],E:[-1,0],W:[1,0]};
const left=([x,z])=>[z,-x];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const mul=(a,k)=>[a[0]*k,a[1]*k];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function bezier(a,b,c,d,t){const u=1-t;return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]];}
export function createRoute(approach,movement){
  const d=DIR[approach],n=left(d),offset={L:8.25,T:4.95,R:1.65}[movement];
  const out=movement==='L'?n:movement==='R'?mul(n,-1):d;
  const outN=left(out),start=add(mul(d,-ROAD_LENGTH),mul(n,offset)),entry=add(mul(d,-JUNCTION),mul(n,offset)),exit=add(mul(out,JUNCTION),mul(outN,offset)),end=add(mul(out,ROAD_LENGTH),mul(outN,offset));
  const samples=[start,entry];
  const c=movement==='L'?7:movement==='R'?23:10;
  const p1=add(entry,mul(d,c)),p2=add(exit,mul(out,-c));
  for(let i=1;i<=60;i++)samples.push(bezier(entry,p1,p2,exit,i/60));
  samples.push(end);let length=0;const points=samples.map((p,i)=>{if(i)length+=distance(p,samples[i-1]);return {x:p[0],z:p[1],s:length};});
  return {id:approach+movement,approach,movement,points,length,stop:ROAD_LENGTH-JUNCTION,crossEnd:length-(ROAD_LENGTH-JUNCTION)};
}
export const ROUTES=Object.fromEntries(APPROACHES.flatMap(a=>MOVEMENTS.map(m=>{const r=createRoute(a,m);return[r.id,r];})));
export function positionOnRoute(route,s){
  const ps=route.points;let lo=0,hi=ps.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(ps[mid].s<s)lo=mid;else hi=mid;}
  const a=ps[lo],b=ps[hi],t=Math.max(0,Math.min(1,(s-a.s)/(b.s-a.s||1)));
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(b.x-a.x,b.z-a.z)};
}
export function signalPlan(config){
  const weights=config.weights||{N:config.nsShare/200,S:config.nsShare/200,E:(100-config.nsShare)/200,W:(100-config.nsShare)/200};
  const total=config.cycle-4*config.clearance;
  const min=4;if(total<4*min)throw new Error('Cycle too short for clearance and minimum greens.');
  let remaining=total,active=[...APPROACHES];const allocated={};
  while(active.length){
    const sum=active.reduce((s,a)=>s+Math.max(0,weights[a]||0),0);
    const candidate=a=>sum?remaining*Math.max(0,weights[a]||0)/sum:remaining/active.length;
    const small=active.filter(a=>candidate(a)<min-1e-8);
    if(!small.length){for(const a of active)allocated[a]=candidate(a);break;}
    for(const a of small){allocated[a]=min;remaining-=min;}active=active.filter(a=>!small.includes(a));
  }
  return ['N','E','S','W'].map(a=>({approach:a,green:allocated[a]}));
}
export function scheduledSignal(time,config){
  let p=((time%config.cycle)+config.cycle)%config.cycle;
  for(const phase of signalPlan(config)){if(p<phase.green)return {approach:phase.approach,amber:null,remaining:phase.green-p};p-=phase.green;if(p<config.clearance)return {approach:null,amber:p<3?phase.approach:null,remaining:config.clearance-p};p-=config.clearance;}
  return {approach:null,remaining:0};
}
export class Simulation{
  constructor(dataset,config={}){
    this.dataset=dataset;this.config={...DEFAULT_CONFIG,...config};signalPlan(this.config);
    this.seed=(this.config.seed>>>0)||1;this.time=0;this.generated=0;this.completed=0;this.nextId=1;
    this.routes=Object.fromEntries(Object.keys(ROUTES).map(k=>[k,[]]));this.pending=Object.fromEntries(Object.keys(ROUTES).map(k=>[k,[]]));this.active=[];
    this.signal={approach:null,remaining:0};this.blocked=false;
    this.stats={seconds:0,arrivals:0,departures:0,stopped:0,queueArea:0,peakQueue:0,byApproach:Object.fromEntries(APPROACHES.map(a=>[a,{arrivals:0,stopped:0,queueArea:0,departures:0}]))};
    this.prepared=dataset.bins.map(b=>({...b,byApproach:Object.fromEntries(APPROACHES.map(a=>[a,b.streams.filter(s=>s.approach===a&&s.count>0)]))}));
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return(this.seed+.5)/4294967296;}
  poisson(lambda){if(lambda<=0)return 0;let k=0,p=1,lim=Math.exp(-lambda);do{k++;p*=this.random();}while(p>lim);return k-1;}
  step(dt=STEP){
    const measuring=this.time>=WARMUP-1e-7;
    const logical=Math.max(0,this.time-WARMUP);
    const bin=this.prepared.find(b=>logical>=b.start&&logical<b.start+b.duration);
    if(bin){for(const a of APPROACHES){
      const streams=bin.byApproach[a],total=streams.reduce((s,v)=>s+v.count,0),n=this.poisson(total/bin.duration*this.config.demand*dt);
      for(let j=0;j<n;j++){
        let pick=this.random()*total,stream=streams[streams.length-1];for(const item of streams){pick-=item.count;if(pick<=0){stream=item;break;}}
        const type=stream.type,id=this.nextId++,spec=VEHICLES[type];
        this.pending[a+stream.movement].push({id,type,approach:a,movement:stream.movement,length:spec.length,s:0,speed:0,wait:0,color:Math.floor(this.random()*6),born:this.time});
        this.generated++;if(measuring){this.stats.arrivals++;this.stats.byApproach[a].arrivals++;}
      }
    }}
    const desired=scheduledSignal(this.time,this.config);
    const conflicting=this.active.some(v=>v.approach!==desired.approach&&v.s+v.length/2>ROUTES[v.approach+v.movement].stop&&v.s-v.length/2<ROUTES[v.approach+v.movement].crossEnd);
    this.blocked=!!desired.approach&&conflicting;
    this.signal={...desired,approach:this.blocked?null:desired.approach};
    const queues=Object.fromEntries(APPROACHES.map(a=>[a,0]));
    for(const[id,route]of Object.entries(ROUTES)){
      const list=this.routes[id],pending=this.pending[id];
      const last=list[list.length-1],next=pending[0];
      if(next&&(!last||last.s>(last.length+next.length)/2+2.3)){list.push(pending.shift());}
      let leader=null;
      for(const v of list){
        const spec=VEHICLES[v.type],inCross=v.s+v.length/2>route.stop&&v.s-v.length/2<route.crossEnd;
        let desiredSpeed=inCross&&v.movement!=='T'?Math.min(spec.maxSpeed,v.movement==='L'?5.5:6.5):spec.maxSpeed;
        let cap=Infinity;
        const stopAt=route.stop-v.length/2-1;
        if(this.signal.approach!==v.approach&&v.s+v.length/2<=route.stop+1e-8){cap=Math.max(v.s,stopAt);desiredSpeed=Math.min(desiredSpeed,Math.sqrt(2*3*Math.max(0,cap-v.s)));}
        if(leader){const gap=leader.s-(leader.length+v.length)/2-2.3-v.s;cap=Math.min(cap,leader.s-(leader.length+v.length)/2-2.3);desiredSpeed=Math.min(desiredSpeed,Math.max(0,leader.speed+gap/1.25));}
        const old=v.speed;v.speed=Math.max(0,Math.min(desiredSpeed,old+spec.accel*dt));
        const nextS=Math.max(v.s,Math.min(cap,v.s+(old+v.speed)*dt/2));v.speed=(nextS-v.s)/dt;v.s=nextS;
        if(v.speed<.5){v.wait+=dt;if(measuring){this.stats.stopped+=dt;this.stats.byApproach[v.approach].stopped+=dt;}
          if(v.s<route.stop)queues[v.approach]=Math.max(queues[v.approach],route.stop-v.s+v.length/2);
        }
        leader=v;
      }
      while(list.length&&list[0].s>=route.length){const v=list.shift();this.completed++;if(measuring){this.stats.departures++;this.stats.byApproach[v.approach].departures++;}}
      if(measuring){this.stats.stopped+=pending.length*dt;this.stats.byApproach[route.approach].stopped+=pending.length*dt;}
      for(const v of pending)v.wait+=dt;
    }
    if(measuring){this.stats.seconds+=dt;for(const a of APPROACHES){this.stats.byApproach[a].queueArea+=queues[a]*dt;this.stats.peakQueue=Math.max(this.stats.peakQueue,queues[a]);}this.stats.queueArea+=APPROACHES.reduce((s,a)=>s+queues[a],0)/4*dt;}
    this.active=Object.values(this.routes).flat();this.queues=queues;this.time+=dt;
  }
  metrics(){
    const s=this.stats,seconds=s.seconds||1,pending=Object.values(this.pending).reduce((n,v)=>n+v.length,0);
    return {delay:s.arrivals?s.stopped/s.arrivals:0,queue:s.queueArea/seconds,peakQueue:s.peakQueue,throughput:s.departures/seconds*3600,fuel:s.stopped/3600*.8,co2:s.stopped/3600*.8*2.31,arrivals:s.arrivals,departures:s.departures,active:this.active.length,pending,elapsed:s.seconds,stopped:s.stopped,byApproach:Object.fromEntries(APPROACHES.map(a=>{const v=s.byApproach[a];return[a,{delay:v.arrivals?v.stopped/v.arrivals:0,queue:v.queueArea/seconds,arrivals:v.arrivals,departures:v.departures}];}))};
  }
  warmup(){while(this.time<WARMUP-STEP/2)this.step();return this;}
}
export function scenarios(dataset,config){
  const totals=approachTotals(dataset),short=Math.max(80,Math.round(config.cycle*.75/5)*5);
  return [{name:'Baseline',config:{...config}},{name:'Demand-matched',config:{...config,weights:totals}},{name:'Shorter cycle',config:{...config,cycle:short}},{name:'Combined',config:{...config,cycle:short,weights:totals}}];
}
export function runSingle(dataset,config,seconds=dataset.duration){const sim=new Simulation(dataset,config);const end=WARMUP+seconds;while(sim.time<end-STEP/2)sim.step();return sim.metrics();}
export function summarizeRuns(runs){const keys=['delay','queue','peakQueue','throughput','fuel','co2','arrivals','departures','active','pending'];const result={};for(const k of keys){const mean=runs.reduce((s,r)=>s+r[k],0)/runs.length;const sd=runs.length>1?Math.sqrt(runs.reduce((s,r)=>s+(r[k]-mean)**2,0)/(runs.length-1)):0;result[k]={mean,sd};}return result;}
