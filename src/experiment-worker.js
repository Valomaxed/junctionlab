import {scenarios,runSingle,summarizeRuns} from './engine.js';
self.onmessage=event=>{
  try{
    const {dataset,config,seeds}=event.data,definitions=scenarios(dataset,config),results=[];let done=0;
    for(const scenario of definitions){const runs=[];for(const seed of seeds){runs.push(runSingle(dataset,{...scenario.config,seed}));done++;self.postMessage({kind:'progress',done,total:definitions.length*seeds.length,label:scenario.name});}results.push({name:scenario.name,config:scenario.config,runs,summary:summarizeRuns(runs)});}
    self.postMessage({kind:'complete',results,seeds,duration:dataset.duration});
  }catch(error){self.postMessage({kind:'error',message:error.message});}
};
