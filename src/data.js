export const APPROACHES=['N','S','E','W'];
export const MOVEMENTS=['L','T','R'];
export const TYPES=['car','motorcycle','auto','bus','truck'];
export const DEFAULT_MIX={car:.45,motorcycle:.3,auto:.15,bus:.05,truck:.05};
export const DEFAULT_TURNS={L:.2,T:.65,R:.15};
export function parseCSV(text){
  if(typeof text!=='string'||text.length>5_000_000)throw new Error('Use a CSV smaller than 5 MB.');
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell.trim()||closed)throw new Error('Unexpected quote in CSV.');quoted=true;}
    else if(c===','){row.push(cell.trim());cell='';closed=false;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(v=>v!==''))rows.push(row);row=[];cell='';closed=false;}
    else {if(closed&&!/\s/.test(c))throw new Error('Unexpected text after a quoted cell.');cell+=c;}
  }
  if(quoted)throw new Error('Unclosed quote in CSV.');
  row.push(cell.trim());if(row.some(v=>v!==''))rows.push(row);
  if(rows.length<2)throw new Error('CSV needs a header and at least one data row.');
  const headers=rows.shift().map(v=>v.trim());
  if(new Set(headers.map(h=>h.toLowerCase())).size!==headers.length)throw new Error('CSV contains duplicate column names.');
  if(headers.some(h=>!h))throw new Error('Every column needs a header.');
  for(let i=0;i<rows.length;i++)if(rows[i].length!==headers.length)throw new Error('Row '+(i+2)+' has '+rows[i].length+' cells; expected '+headers.length+'.');
  return {headers,rows};
}
const aliases={approach:['approach','direction','arm'],count:['count','vehicle_count','vehicles'],movement:['movement','turn','turning_movement'],vehicle_type:['vehicle_type','type','class','vehicle_class'],interval_start:['interval_start','start_time','time','start'],interval_minutes:['interval_minutes','duration_minutes','duration']};
export function guessMapping(headers){const m={};for(const[k,names]of Object.entries(aliases))m[k]=headers.find(h=>names.includes(h.toLowerCase().replace(/[ -]/g,'_')))||'';return m;}
function canonical(value,lookup,name,row){const s=String(value).toLowerCase().trim();const v=lookup[s];if(!v)throw new Error('Row '+row+': unrecognized '+name+' “'+value+'”.');return v;}
function startMinutes(value,row){
  if(/^\d{1,2}:\d{2}$/.test(value)){const [h,m]=value.split(':').map(Number);if(h>23||m>59)throw new Error('Row '+row+': invalid start time.');return h*60+m;}
  if(value!==''&&Number.isFinite(Number(value))&&Number(value)>=0)return Number(value);
  throw new Error('Row '+row+': use HH:MM or nonnegative minutes for interval start.');
}
export function importCounts(text,mapping){
  const {headers,rows}=parseCSV(text);const map=mapping||guessMapping(headers);
  for(const required of ['approach','count'])if(!map[required]||!headers.includes(map[required]))throw new Error('Map an '+required+' column first.');
  for(const [k,col]of Object.entries(map))if(col&&!headers.includes(col))throw new Error('Mapped column '+col+' is missing.');
  const used=Object.values(map).filter(Boolean);if(new Set(used).size!==used.length)throw new Error('Map each column to only one field.');
  const get=(row,key)=>map[key]?row[headers.indexOf(map[key])]:'';
  const bins=new Map();let totalCount=0,origin=Infinity;
  const ap={n:'N',north:'N',s:'S',south:'S',e:'E',east:'E',w:'W',west:'W'};
  const mv={l:'L',left:'L',t:'T',through:'T',straight:'T',r:'R',right:'R'};
  const vt={car:'car',cars:'car',taxi:'car',motorcycle:'motorcycle',bike:'motorcycle','two-wheeler':'motorcycle','two wheeler':'motorcycle',scooter:'motorcycle',auto:'auto','auto-rickshaw':'auto',rickshaw:'auto',bus:'bus',buses:'bus',truck:'truck',hgv:'truck',lcv:'truck'};
  for(let i=0;i<rows.length;i++){
    const row=rows[i],num=i+2;
    const approach=canonical(get(row,'approach'),ap,'approach',num);
    const raw=get(row,'count');const count=Number(raw);
    if(raw===''||!Number.isInteger(count)||count<0||count>100000)throw new Error('Row '+num+': count must be a whole number from 0 to 100,000.');
    const duration=map.interval_minutes?Number(get(row,'interval_minutes')):15;
    if(!(duration>0&&duration<=240))throw new Error('Row '+num+': interval duration must be greater than 0 and at most 240 minutes.');
    const start=map.interval_start?startMinutes(get(row,'interval_start'),num):0;origin=Math.min(origin,start);
    const turns=map.movement?{[canonical(get(row,'movement'),mv,'movement',num)]:1}:DEFAULT_TURNS;
    const mix=map.vehicle_type?{[canonical(get(row,'vehicle_type'),vt,'vehicle type',num)]:1}:DEFAULT_MIX;
    const key=start+'|'+duration;
    if(!bins.has(key))bins.set(key,{start:start*60,duration:duration*60,streams:[]});
    for(const[movement,mw]of Object.entries(turns))for(const[type,tw]of Object.entries(mix))bins.get(key).streams.push({approach,movement,type,count:count*mw*tw});
    totalCount+=count;
  }
  const list=[...bins.values()].sort((a,b)=>a.start-b.start);
  for(let i=1;i<list.length;i++)if(list[i].start<list[i-1].start+list[i-1].duration-.001)throw new Error('Intervals overlap. Use one non-overlapping study session; aggregate duplicate time bins to the same start/duration.');
  for(const bin of list)bin.start-=origin*60;
  const duration=Math.max(...list.map(b=>b.start+b.duration));
  if(duration>14400)throw new Error('Select one study session of at most four hours. Do not combine separate days or morning/evening sessions.');
  if(totalCount>100000)throw new Error('Select a study session with at most 100,000 vehicles.');
  const assumptions=[];
  if(!map.movement)assumptions.push('Turns assumed: 20% left, 65% through, 15% right.');
  if(!map.vehicle_type)assumptions.push('Fleet assumed: 45% car, 30% motorcycle, 15% auto, 5% bus, 5% truck.');
  if(!map.interval_minutes)assumptions.push('15-minute count intervals assumed.');
  if(list.some((b,i)=>i&&b.start>list[i-1].start+list[i-1].duration))assumptions.push('Gaps between intervals have zero arrivals.');
  const present=new Set(list.flatMap(b=>b.streams.filter(s=>s.count>0).map(s=>s.approach)));
  if(present.size<4)assumptions.push('Unlisted approaches have zero demand.');
  return {bins:list,duration,totalCount,assumptions,source:'imported',rowCount:rows.length};
}
export const SAMPLE_CSV='approach,count,interval_start,interval_minutes\nN,135,08:00,15\nS,135,08:00,15\nE,90,08:00,15\nW,90,08:00,15\n';
export function sampleDataset(){return {...importCounts(SAMPLE_CSV),source:'sample',name:'Illustrative morning demand'};}
export function approachTotals(dataset){const totals=Object.fromEntries(APPROACHES.map(a=>[a,0]));for(const bin of dataset.bins)for(const s of bin.streams)totals[s.approach]+=s.count;return totals;}
export function toCSV(rows){return rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[=+@\t\r]/.test(s))s="'"+s;return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;}).join(',')).join('\r\n');}
