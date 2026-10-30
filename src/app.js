import {Simulation,DEFAULT_CONFIG,signalPlan,WARMUP,STEP} from './engine.js';
import {sampleDataset,parseCSV,guessMapping,importCounts,toCSV,APPROACHES} from './data.js';
import {TrafficScene} from './scene.js';
import {SumoReplay,validateSumoBundle} from './replay.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let dataset=sampleDataset(),config={...DEFAULT_CONFIG},sim=null,scene=null,paused=false,selectedId=null,worker=null,experiment=null,replayBundle=null,replayIndex=0;
let last=0,accumulator=0,lastUI=0,toastTimer=0,restartTimer=0,fileText='',fileName='';
const fmt=(n,d=1)=>Number(n).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const clock=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
function notify(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function dialog(id){$('#'+id).showModal();}
function resetExperiment(){
  if(worker){worker.terminate();worker=null;}
  experiment=null;$('#experiment-progress').hidden=true;$('#experiment-results').hidden=true;$('#experiment-empty').hidden=false;$('#export-results').disabled=true;$('#run-experiments').disabled=false;$('#run-experiments').innerHTML='Run scenario comparison <span>→</span>';
}
function restart(invalidate=true){
  if(sim?.isReplay&&replayBundle){startReplay(replayIndex);return;}
  if(invalidate)resetExperiment();
  sim=new Simulation(dataset,config).warmup();paused=matchMedia('(prefers-reduced-motion: reduce)').matches;selectedId=null;accumulator=0;last=0;
  $('#selection').hidden=true;$('#play-button').textContent=paused?'▶':'Ⅱ';$('#play-button').setAttribute('aria-label',paused?'Play simulation':'Pause simulation');
  $('#sim-duration').textContent='/ '+clock(dataset.duration);updateDataset();updatePhases();updateUI();
}
function updateDataset(){
  if(sim?.isReplay){
    const b=replayBundle;
    $('#dataset-name').textContent=b.dataset.name;$('#data-badge').textContent=b.dataset.source==='sample'?'SAMPLE / SUMO':'IMPORTED / SUMO';$('#data-badge').classList.toggle('imported',b.dataset.source!=='sample');
    $('#dataset-summary').textContent=fmt(b.duration/60,0)+' minute recording · '+b.seeds.length+' paired seeds · representative seed '+sim.recording.seed;
    $('#notes-data-source').textContent='Native SUMO · '+b.geometry.source+' · independent validation pending';
    $('#notes-data-summary').textContent=b.engine.version+'. Offline SUMO trajectories are replayed at the recorded positions. The browser model described below is a separate engine. No field-accuracy claim follows from using SUMO.';
    $('#notes-assumptions').replaceChildren(...[...b.dataset.assumptions,...b.limitations].map(s=>{const li=document.createElement('li');li.textContent=s;return li;}));return;
  }
  $('#dataset-name').textContent=dataset.name||'Imported traffic counts';
  $('#data-badge').textContent=dataset.source==='sample'?'SAMPLE DATA':'IMPORTED COUNTS';$('#data-badge').classList.toggle('imported',dataset.source!=='sample');
  $('#dataset-summary').textContent=fmt(dataset.totalCount,0)+' counted vehicles · '+fmt(dataset.duration/60,0)+' minutes · '+dataset.bins.length+' interval'+(dataset.bins.length===1?'':'s');
  $('#notes-data-source').textContent=(dataset.source==='sample'?'Sample demand':'Imported counts')+' · geometry assumed · not calibrated';
  $('#notes-data-summary').textContent=(dataset.name||'Imported dataset')+'. '+fmt(dataset.totalCount,0)+' vehicles before the '+fmt(config.demand*100,0)+'% demand multiplier. Analysis window: '+clock(dataset.duration)+'.';
  $('#notes-assumptions').replaceChildren(...dataset.assumptions.map(s=>{const li=document.createElement('li');li.textContent=s;return li;}));
}
function updatePhases(){
  const strip=$('#phase-strip');strip.replaceChildren();
  for(const phase of signalPlan(config)){
    const el=document.createElement('div');el.className='phase';el.dataset.approach=phase.approach;el.style.flex=phase.green;el.textContent=phase.approach+' '+fmt(phase.green,0)+'s';el.title=phase.approach+' green: '+fmt(phase.green)+' seconds';strip.append(el);
    const gap=document.createElement('div');gap.className='phase phase-clearance';gap.style.flex=config.clearance;gap.title='3 s amber + 5 s all-red';strip.append(gap);
  }
}
function updateUI(){
  const m=sim.metrics(),started=m.elapsed>0;
  $('#metric-delay').textContent=started?fmt(m.delay):'—';$('#metric-queue').textContent=started?fmt(m.queue):'—';$('#metric-flow').textContent=started?fmt(m.throughput,0):'—';$('#metric-active').textContent=fmt(m.active,0);
  $('#metric-peak').textContent='Peak approach queue: '+fmt(m.peakQueue,0)+' m';$('#metric-departures').textContent=m.departures+' departures in analysis window';$('#metric-pending').textContent=m.pending+' waiting outside the network';
  const elapsed=sim.isReplay?sim.elapsed:Math.max(0,sim.time-WARMUP),duration=sim.isReplay?sim.duration:dataset.duration;$('#sim-time').textContent=clock(elapsed);$('#run-status').textContent=elapsed>=duration?'RUN COMPLETE':paused?'SIMULATION PAUSED':sim.isReplay?'SUMO REPLAY':'LIVE SIMULATION';
  if(sim.isReplay){if(document.activeElement!==$('#replay-time'))$('#replay-time').value=elapsed;const d=sim.decision;$('#decision-phase').textContent=d?d.to+' approach · '+clock(d.time):'Recorded initial phase';$('#decision-reason').textContent=d?.reason||'Waiting for the first recorded phase transition.';}
  $$('.phase[data-approach]').forEach(el=>el.classList.toggle('active',el.dataset.approach===sim.signal.approach));
  if(selectedId!==null){const v=sim.active.find(v=>v.id===selectedId);if(v){$('#selection-name').textContent=v.type.charAt(0).toUpperCase()+v.type.slice(1)+' #'+v.id;$('#selection-details').textContent=v.approach+' approach · '+({L:'left turn',T:'through',R:'right turn'}[v.movement])+'\n'+fmt(v.speed*3.6)+' km/h · '+fmt(v.wait)+' s stopped';$('#selection-details').style.whiteSpace='pre-line';$('#selection').hidden=false;}else{selectedId=null;$('#selection').hidden=true;}}
}
function animate(now){
  requestAnimationFrame(animate);
  const delta=last?Math.min((now-last)/1000,.12):0;last=now;
  if(!paused&&sim.isReplay){
    sim.advance(delta*Number($('#speed').value));if(sim.elapsed>=sim.duration){paused=true;$('#play-button').textContent='▶';$('#play-button').setAttribute('aria-label','Replay simulation');}
  }else if(!paused&&sim.time<WARMUP+dataset.duration-STEP/2){
    accumulator+=delta*Number($('#speed').value);
    while(accumulator>=STEP&&sim.time<WARMUP+dataset.duration-STEP/2){sim.step();accumulator-=STEP;}
    if(sim.time>=WARMUP+dataset.duration-STEP/2){paused=true;$('#play-button').textContent='▶';$('#play-button').setAttribute('aria-label','Replay simulation');notify('Run complete. Run the comparison to evaluate paired scenarios.');}
  }
  if(scene)scene.render(sim,selectedId);
  if(now-lastUI>200){updateUI();lastUI=now;}
}
function renderFailure(message){
  $('#scene-loading').hidden=true;const div=document.createElement('div');div.className='render-failed';const strong=document.createElement('strong');strong.textContent='The 3D renderer is unavailable.';const p=document.createElement('span');p.textContent=message+' Try a browser with WebGL 2 and hardware acceleration. CSV import and experiments still work.';div.append(strong,p);$('#viewport').append(div);
}
try{scene=new TrafficScene($('#viewport'),v=>{selectedId=v?.id??null;updateUI();});$('#scene-loading').hidden=true;}catch(error){console.error(error);renderFailure(error.message);}
$('#viewport').addEventListener('rendererror',e=>{scene=null;renderFailure(e.detail);});

for(const[id,key,factor,label]of [['demand','demand',.01,'demand-value'],['cycle','cycle',1,'cycle-value'],['ns-share','nsShare',1,'share-value']]){
  $('#'+id).addEventListener('input',e=>{config[key]=Number(e.target.value)*factor;$('#'+label).textContent=e.target.value+(key==='cycle'?' s':'%');clearTimeout(restartTimer);paused=true;restartTimer=setTimeout(()=>{restart();notify('Restarted with the same arrival seed and updated settings.');},180);});
}
$('#restart-button').addEventListener('click',()=>{restart(false);notify('Restarted seed '+(sim.isReplay?sim.recording.seed:config.seed)+'. Existing comparison results are retained.');});
$('#play-button').addEventListener('click',()=>{if(sim.isReplay?sim.elapsed>=sim.duration:sim.time>=WARMUP+dataset.duration-STEP/2){restart(false);paused=false;}else paused=!paused;$('#play-button').textContent=paused?'▶':'Ⅱ';$('#play-button').setAttribute('aria-label',paused?'Play simulation':'Pause simulation');updateUI();});
$('#speed').addEventListener('change',()=>{accumulator=0;});
$$('[data-camera]').forEach(btn=>btn.addEventListener('click',()=>{$$('[data-camera]').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-pressed',String(b===btn));});scene?.setView(btn.dataset.camera);}));
$('#clear-selection').addEventListener('click',()=>{selectedId=null;$('#selection').hidden=true;});
$$('[data-nav]').forEach(btn=>btn.addEventListener('click',()=>{$$('[data-nav]').forEach(b=>b.classList.toggle('active',b===btn));$('#'+btn.dataset.nav).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}));
for(const id of ['notes-button','footer-notes','inspect-data'])$('#'+id).addEventListener('click',()=>{updateDataset();dialog('notes-dialog');});
$$('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$('#'+btn.dataset.close).close()));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#open-import').addEventListener('click',()=>dialog('import-dialog'));
function importError(message){$('#import-error').textContent=message;$('#import-error').hidden=false;}
$('#csv-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;$('#import-error').hidden=true;$('#apply-import').disabled=true;$('#mapping-panel').hidden=true;
  try{
    if(file.size>5_000_000)throw new Error('Choose a CSV smaller than 5 MB.');
    if(!file.name.toLowerCase().endsWith('.csv'))throw new Error('Export your Excel sheet as CSV (UTF-8) first.');
    fileText=await file.text();fileName=file.name;const parsed=parseCSV(fileText),mapping=guessMapping(parsed.headers);
    const labels={approach:'Approach *',count:'Vehicle count *',movement:'Turning movement',vehicle_type:'Vehicle class',interval_start:'Interval start',interval_minutes:'Interval duration (minutes)'};
    $('#mapping-grid').replaceChildren();
    for(const[key,label]of Object.entries(labels)){
      const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.dataset.field=key;
      const blank=document.createElement('option');blank.value='';blank.textContent=['approach','count'].includes(key)?'Select a column':'Use disclosed default';select.append(blank);
      for(const h of parsed.headers){const option=document.createElement('option');option.value=h;option.textContent=h;select.append(option);}select.value=mapping[key]||'';wrap.append(select);$('#mapping-grid').append(wrap);
    }
    const table=$('#csv-preview');table.replaceChildren();const head=document.createElement('thead'),header=document.createElement('tr');for(const h of parsed.headers){const th=document.createElement('th');th.textContent=h;header.append(th);}head.append(header);table.append(head);
    const body=document.createElement('tbody');for(const row of parsed.rows.slice(0,4)){const tr=document.createElement('tr');for(const c of row){const td=document.createElement('td');td.textContent=c;tr.append(td);}body.append(tr);}table.append(body);
    $('#mapping-panel').hidden=false;$('#apply-import').disabled=false;
  }catch(error){fileText='';importError(error.message);}
});
$('#apply-import').addEventListener('click',()=>{
  try{const mapping=Object.fromEntries($$('#mapping-grid select').map(s=>[s.dataset.field,s.value]));const next=importCounts(fileText,mapping);next.name=fileName;dataset=next;$('#import-error').hidden=true;$('#import-dialog').close();leaveReplay();notify('Imported '+next.rowCount+' rows. Export Project JSON to run these counts through the local SUMO pipeline.');}catch(error){importError(error.message);}
});

$('#run-experiments').addEventListener('click',()=>{
  if(sim.isReplay){showSumoResults();$('#experiments').scrollIntoView({behavior:'smooth',block:'start'});return;}
  resetExperiment();$('#experiment-empty').hidden=true;$('#experiment-progress').hidden=false;$('#progress').value=0;$('#run-experiments').disabled=true;$('#run-experiments').textContent='Running 12 simulations…';$('#experiments').scrollIntoView({behavior:'smooth',block:'start'});
  try{
    worker=new Worker(new URL('./experiment-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=event=>{
      const msg=event.data;
      if(msg.kind==='progress'){$('#progress').value=msg.done;$('#progress-label').textContent=msg.label+' · run '+msg.done+' / '+msg.total;}
      else if(msg.kind==='complete'){
        experiment={...msg,datasetName:dataset.name,source:dataset.source,config:{...config},modelVersion:'1.0.0'};
        worker.terminate();worker=null;$('#experiment-progress').hidden=true;$('#experiment-results').hidden=false;$('#export-results').disabled=false;$('#run-experiments').disabled=false;$('#run-experiments').innerHTML='Run comparison again <span>↻</span>';renderResults();notify('All 12 runs completed. Results and model inputs are ready to export.');
      }else if(msg.kind==='error'){resetExperiment();notify('Experiment failed: '+msg.message);}
    };
    worker.onerror=error=>{resetExperiment();notify('Worker could not run: '+error.message);};worker.postMessage({dataset,config:{...config},seeds:[2026,2027,2028]});
  }catch(error){resetExperiment();notify('Could not start the experiment: '+error.message);}
});
$('#cancel-experiments').addEventListener('click',()=>{resetExperiment();notify('Comparison cancelled. No partial results were saved.');});
function renderResults(){
  const results=experiment.results,baseline=results[0].summary.delay.mean,best=Math.min(...results.map(r=>r.summary.delay.mean));
  $('#result-context').textContent=(experiment.sumo?'Eclipse SUMO · ':'Browser model · ')+experiment.datasetName+' · '+fmt(experiment.duration/60,0)+' minute analysis + '+fmt((experiment.warmup??120)/60,0)+' minute loading · '+fmt(experiment.config.demand*100,0)+'% demand · '+experiment.seeds.length+' paired seeds';
  const tbody=$('#result-rows');tbody.replaceChildren();
  for(const row of results){
    const tr=document.createElement('tr');if(Math.abs(row.summary.delay.mean-best)<.001)tr.className='best';
    const name=document.createElement('td');name.textContent=row.name;tr.append(name);
    for(const key of ['delay','queue','throughput','pending']){const td=document.createElement('td');td.textContent=fmt(row.summary[key].mean,key==='throughput'?0:1)+' ';const sd=document.createElement('span');sd.className='sd';sd.textContent='± '+fmt(row.summary[key].sd,key==='throughput'?0:1);td.append(sd);tr.append(td);}
    const change=document.createElement('td'),pct=baseline?100*(row.summary.delay.mean-baseline)/baseline:0;change.textContent=row===results[0]?'Baseline':baseline?(pct>0?'+':'')+fmt(pct)+'%':'n/a';tr.append(change);tbody.append(tr);
  }
  const paired=$('#paired-results');paired.replaceChildren();paired.hidden=!experiment.sumo;
  if(experiment.sumo)for(const r of results.slice(1)){const li=document.createElement('li'),p=r.pairedDelay;li.textContent=r.name+' − fixed-time: '+fmt(p.mean)+' s / arrival; '+(p.ci95?'95% paired bootstrap interval ['+fmt(p.ci95[0])+', '+fmt(p.ci95[1])+']':'interval unavailable with fewer than five seeds')+'.';paired.append(li);}
}
function download(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('#export-session').addEventListener('click',()=>download(sim.isReplay?'junctionlab-sumo-benchmark.json':'junctionlab-project.json',JSON.stringify(sim.isReplay?replayBundle:{project:'JunctionLab',version:'2.0.0',site:'IIT Flyover surface junction (concept)',geometry:'assumed',calibrated:false,dataset,config,experiment},null,2),'application/json'));
$('#export-results').addEventListener('click',()=>{
  if(!experiment)return;
  const headers=['scenario','engine','seed','demand_source','geometry','calibrated','window_s','cycle_s','ns_share','demand_multiplier','phase_weights','accrued_delay_s_per_arrival','mean_queue_m','peak_queue_m','throughput_veh_h','external_backlog_vehicles','active_vehicles_at_end','arrivals','departures','idle_fuel_L','idle_co2_kg'];
  const rows=[headers];for(const scenario of experiment.results)scenario.runs.forEach((r,i)=>rows.push([scenario.name,experiment.sumo?'Eclipse SUMO':'Browser concept',experiment.seeds[i],experiment.source,experiment.sumo?replayBundle.geometry.source:'assumed',false,experiment.duration,scenario.config.cycle,scenario.config.weights?'demand-matched':scenario.config.nsShare,scenario.config.demand,JSON.stringify(scenario.config.weights||null),r.delay,r.queue,r.peakQueue,r.throughput,r.pending,r.active,r.arrivals,r.departures,r.fuel,r.co2]));
  download('junctionlab-scenario-runs.csv',toCSV(rows),'text/csv;charset=utf-8');
});
document.addEventListener('visibilitychange',()=>{last=0;accumulator=0;});

function setReplayControls(active){
  for(const id of ['demand','cycle','ns-share'])$('#'+id).disabled=active;
  $('#replay-toolbar').hidden=!active;$('#controller-decision').hidden=!active;$('#browser-mode').classList.toggle('active',!active);$('#browser-mode').setAttribute('aria-pressed',String(!active));$('#load-sumo-demo').classList.toggle('active',active);$('#load-sumo-demo').setAttribute('aria-pressed',String(active));
  $('.stage-sub').textContent=active?'Native trajectories · recorded signals':'Left-hand traffic · split phasing';$('.caption-chip').textContent=active?'ECLIPSE SUMO / RECORDED RUN':'3D / PROCEDURAL VEHICLES';$('.scene-caption>span:last-child').textContent=active?'Geometry from the SUMO network file':'Surface network only · illustrative geometry';
  $('.control-panel>.small-note').textContent=active?'Recorded run: generate new SUMO results locally to change model inputs.':'Changing an input restarts the seeded simulation.';
  $('.panel-intro').textContent=active?'Inspect a recorded controller and its decisions.':'Tune the signal. Watch the response.';
  $('label[for="cycle"]>span').textContent=active?'Fixed-time reference cycle':'Signal cycle';
  $('label[for="ns-share"]>span').textContent=active?'Fixed-time N–S reference split':'North–south green allocation';
  $('.experiment-callout p').textContent=active?'Three controllers. Paired seeds. Identical scheduled arrivals.':'Four scenarios. Three paired seeds. Same traffic.';
  $('.phase-note').textContent=active?'Recorded phases · 3 s amber + 5 s all-red minimum':'Four approach phases · 3 s amber + 5 s all-red each';
}
function showSumoResults(){
  experiment={...replayBundle,sumo:true,datasetName:replayBundle.dataset.name,source:replayBundle.dataset.source};
  $('#experiment-empty').hidden=true;$('#experiment-progress').hidden=true;$('#experiment-results').hidden=false;$('#export-results').disabled=false;$('#run-experiments').disabled=false;$('#run-experiments').textContent='View recorded comparison →';renderResults();
}
function startReplay(index=0){
  replayIndex=index;sim=new SumoReplay(replayBundle,index);selectedId=null;paused=matchMedia('(prefers-reduced-motion: reduce)').matches;accumulator=0;last=0;
  $('#selection').hidden=true;$('#play-button').textContent=paused?'▶':'Ⅱ';$('#play-button').setAttribute('aria-label',paused?'Play simulation':'Pause simulation');
  $('#seed-label').textContent=sim.recording.seed;$('#replay-controller').value=index;$('#replay-time').max=sim.duration;$('#sim-duration').textContent='/ '+clock(sim.duration);
  $('#engine-description').textContent=replayBundle.engine.version+' · offline replay · field validation pending';$('#replay-provenance').textContent=(replayBundle.dataset.source==='sample'?'Synthetic counts':'Imported counts')+' · '+replayBundle.geometry.source;
  $('#demand-value').textContent=fmt(replayBundle.config.demand*100,0)+'%';$('#cycle-value').textContent=replayBundle.config.cycle+' s';$('#share-value').textContent=replayBundle.config.nsShare+'%';
  setReplayControls(true);scene?.setNetwork(replayBundle.network);updateDataset();
  $('#phase-strip').replaceChildren(...['N','E','S','W'].map(a=>{const el=document.createElement('div');el.className='phase';el.dataset.approach=a;el.style.flex=1;el.textContent=a;return el;}));
  showSumoResults();updateUI();
}
function openBundle(b){
  validateSumoBundle(b);resetExperiment();replayBundle=b;$('#replay-controller').replaceChildren(...b.results.map((r,i)=>{const option=document.createElement('option');option.value=i;option.textContent=r.name;return option;}));startReplay(0);
}
function leaveReplay(){
  replayBundle=null;sim=null;setReplayControls(false);scene?.useConceptNetwork();$('#engine-description').textContent='Live concept model · inputs adjustable';$('#seed-label').textContent=config.seed;
  for(const[id,k,mult,out,suffix]of [['demand','demand',100,'demand-value','%'],['cycle','cycle',1,'cycle-value',' s'],['ns-share','nsShare',1,'share-value','%']]){$('#'+id).value=config[k]*mult;$('#'+out).textContent=fmt(config[k]*mult,0)+suffix;}
  restart();
}
$('#browser-mode').addEventListener('click',()=>{if(sim.isReplay)leaveReplay();});
$('#load-sumo-demo').addEventListener('click',async()=>{
  const button=$('#load-sumo-demo');button.disabled=true;try{const response=await fetch('./sumo-demo.json');if(!response.ok)throw new Error('Sample recording could not be loaded.');openBundle(await response.json());notify('Loaded native SUMO recordings. These counts and geometry are synthetic.');}catch(e){notify(e.message);}finally{button.disabled=false;}
});
$('#replay-controller').addEventListener('change',e=>startReplay(Number(e.target.value)));
$('#replay-time').addEventListener('input',e=>{if(!sim.isReplay)return;paused=true;sim.seek(Number(e.target.value));$('#play-button').textContent='▶';$('#play-button').setAttribute('aria-label','Play simulation');updateUI();});
$('#open-sumo-import').addEventListener('click',()=>dialog('sumo-import-dialog'));
$('#sumo-file').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;$('#sumo-import-error').hidden=true;
  try{if(f.size>25_000_000)throw new Error('Use a SUMO JSON smaller than 25 MB.');const b=JSON.parse(await f.text());validateSumoBundle(b);openBundle(b);$('#sumo-import-dialog').close();notify('SUMO recording loaded. Model calibration must be assessed separately.');}catch(error){$('#sumo-import-error').hidden=false;$('#sumo-import-error').textContent=error.message;}
});
restart();requestAnimationFrame(animate);
