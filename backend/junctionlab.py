"""Reproducible SUMO experiments and observation-based calibration for JunctionLab.

All generated geometry is explicitly a concept. CSV import does not imply calibration.
Run `python backend/junctionlab.py --help` for the command interface.
"""
from __future__ import annotations
import argparse
import bisect
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import random
import shutil
import statistics
import itertools
import subprocess
import sys
import xml.etree.ElementTree as ET

ARMS = ('N', 'E', 'S', 'W')
TURNS = {'N': {'L': 'E', 'T': 'S', 'R': 'W'}, 'S': {'L': 'W', 'T': 'N', 'R': 'E'}, 'E': {'L': 'S', 'T': 'W', 'R': 'N'}, 'W': {'L': 'N', 'T': 'E', 'R': 'S'}}
MIX = {'car': .45, 'motorcycle': .30, 'auto': .15, 'bus': .05, 'truck': .05}
TURN_MIX = {'L': .20, 'T': .65, 'R': .15}
SPECS = {'car': (4.4, 1.8, 11.1, 2.2, 'passenger'), 'motorcycle': (2.1, .75, 11.1, 2.8, 'motorcycle'), 'auto': (2.8, 1.45, 9., 1.9, 'passenger'), 'bus': (10.8, 2.5, 9.7, 1.3, 'bus'), 'truck': (8., 2.5, 9.2, 1.2, 'truck')}
DEFAULTS = {'cycle': 140, 'nsShare': 40, 'demand': 1., 'tau': 1.2, 'minGap': 2.3, 'minGreen': 8., 'maxGreen': 50., 'maxRed': 180., 'pressureThreshold': 1., 'amber': 3., 'allRed': 5.}
METRICS = ('delay', 'queue', 'peakQueue', 'throughput', 'pending', 'active', 'arrivals', 'departures', 'fuel', 'co2')

def finite(value, name, low=0, high=1e6):
    if isinstance(value, bool):
        raise ValueError(f'{name} must be numeric')
    n = float(value)
    if not math.isfinite(n) or not low <= n <= high:
        raise ValueError(f'{name} must be between {low} and {high}')
    return n

def validated_config(values):
    cfg={**DEFAULTS,**{k:v for k,v in values.items() if k in DEFAULTS}}
    for key,limits in {'cycle':(80,300),'nsShare':(20,80),'demand':(.1,5),'tau':(.2,5),'minGap':(.2,10),'minGreen':(4,30),'maxGreen':(10,120),'maxRed':(60,600),'amber':(3,3),'allRed':(5,5),'pressureThreshold':(0,100)}.items(): cfg[key]=finite(cfg[key],key,*limits)
    if cfg['minGreen']>cfg['maxGreen']: raise ValueError('minGreen exceeds maxGreen.')
    return cfg

def dataset_from_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not {'approach', 'count'} <= set(reader.fieldnames):
            raise ValueError('CSV requires approach,count headers. For custom columns, map them in the browser and export Project JSON.')
        rows = list(reader)
    bins = {}; assumptions = []
    if 'movement' not in reader.fieldnames: assumptions.append('Turns assumed: L 20%, T 65%, R 15%.')
    if 'vehicle_type' not in reader.fieldnames: assumptions.append('Fleet mix assumed: car 45%, motorcycle 30%, auto 15%, bus 5%, truck 5%.')
    if 'interval_minutes' not in reader.fieldnames: assumptions.append('15-minute count intervals assumed.')
    for i, row in enumerate(rows, 2):
        a = row['approach'].strip().upper()
        if a not in ARMS: raise ValueError(f'Row {i}: approach must be N/S/E/W (the entry arm).')
        count = finite(row['count'], f'Row {i} count', high=100000)
        if count != int(count): raise ValueError(f'Row {i}: count must be a whole number.')
        start = row.get('interval_start', '0').strip()
        if ':' in start:
            parts = start.split(':')
            if len(parts) != 2: raise ValueError(f'Row {i}: invalid HH:MM.')
            h, m = map(int, parts)
            if not 0 <= h <= 23 or not 0 <= m <= 59: raise ValueError(f'Row {i}: invalid HH:MM.')
            start = h * 60 + m
        start = finite(start, 'interval_start') * 60
        duration = finite(row.get('interval_minutes', 15), 'interval_minutes', .001, 240) * 60
        move = row.get('movement', '').strip().upper()
        kind = row.get('vehicle_type', '').strip().lower()
        if 'movement' in reader.fieldnames and move not in TURN_MIX: raise ValueError(f'Row {i}: movement must be L/T/R.')
        if 'vehicle_type' in reader.fieldnames and kind not in SPECS: raise ValueError(f'Row {i}: unknown vehicle_type.')
        b = bins.setdefault((start, duration), {'start': start, 'duration': duration, 'streams': []})
        for movement, mw in ({move: 1.} if move else TURN_MIX).items():
            for typ, tw in ({kind: 1.} if kind else MIX).items(): b['streams'].append({'approach': a, 'movement': movement, 'type': typ, 'count': count * mw * tw})
    if not bins: raise ValueError('No count rows found.')
    origin = min(x[0] for x in bins)
    data = {'bins': sorted(bins.values(), key=lambda b: b['start']), 'source': 'imported', 'name': Path(path).name, 'assumptions': assumptions}
    for b in data['bins']: b['start'] -= origin
    return normalize_dataset(data)

def normalize_dataset(data):
    bins = data.get('bins')
    if not isinstance(bins, list) or not bins or len(bins) > 1000: raise ValueError('Invalid demand bins.')
    result = []; total = 0.
    for b in bins:
        start = finite(b['start'], 'bin start', high=14400); duration = finite(b['duration'], 'bin duration', .001, 14400)
        combined = {}
        for s in b['streams']:
            a, m, typ = s['approach'], s['movement'], s['type']
            if a not in ARMS or m not in TURN_MIX or typ not in SPECS: raise ValueError('Unknown approach/movement/type in demand.')
            count = finite(s['count'], 'stream count', high=100000); key = (a, m, typ)
            combined[key] = combined.get(key, 0) + count; total += count
        result.append({'start': start, 'duration': duration, 'streams': [dict(approach=a, movement=m, type=t, count=c) for (a, m, t), c in sorted(combined.items())]})
    result.sort(key=lambda b: b['start'])
    for before, after in zip(result, result[1:]):
        if after['start'] < before['start'] + before['duration'] - 1e-8: raise ValueError('Distinct demand intervals overlap.')
    duration = max(b['start'] + b['duration'] for b in result)
    if duration > 14400 or total > 100000: raise ValueError('Use one session of at most 4 hours and 100,000 vehicles.')
    assumptions=data.get('assumptions',[])
    if not isinstance(assumptions,list) or not all(isinstance(a,str) and len(a)<2000 for a in assumptions): raise ValueError('Demand assumptions must be plain text strings.')
    return {**data, 'bins': result, 'duration': duration, 'totalCount': total, 'source':data.get('source') if data.get('source') in ('sample','imported') else 'imported', 'name': str(data.get('name', 'Traffic counts'))[:200], 'assumptions': assumptions}

def load_input(path):
    path = Path(path)
    if path.stat().st_size > 25_000_000: raise ValueError('Input exceeds 25 MB.')
    if path.suffix.lower() == '.csv': return dataset_from_csv(path), {}
    obj = json.loads(path.read_text(encoding='utf-8-sig'))
    return normalize_dataset(obj.get('dataset', obj)), obj.get('config', {})

def binary(name):
    try:
        import sumo
        p = Path(sumo.SUMO_HOME) / 'bin' / (name + ('.exe' if os.name == 'nt' else ''))
        if p.is_file(): return str(p)
    except ImportError: pass
    p = shutil.which(name)
    if p: return p
    raise RuntimeError('SUMO is missing. Install backend/requirements.txt in an isolated Python environment.')

def write_xml(root, path):
    ET.indent(root); ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)

def make_network(folder):
    folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
    nodes = ET.Element('nodes')
    ET.SubElement(nodes, 'node', id='C', x='0', y='0', type='traffic_light')
    for a, xy in {'N': (0, 100), 'E': (100, 0), 'S': (0, -100), 'W': (-100, 0)}.items(): ET.SubElement(nodes, 'node', id=a, x=str(xy[0]), y=str(xy[1]), type='priority')
    edges = ET.Element('edges'); connections = ET.Element('connections')
    for a in ARMS:
        ET.SubElement(edges, 'edge', {'id': a+'_in', 'from': a, 'to': 'C', 'numLanes': '3', 'speed': '11.1', 'width': '3.3'})
        ET.SubElement(edges, 'edge', {'id': a+'_out', 'from': 'C', 'to': a, 'numLanes': '3', 'speed': '11.1', 'width': '3.3'})
        for index, m in enumerate(('L', 'T', 'R')): ET.SubElement(connections, 'connection', {'from': a+'_in', 'to': TURNS[a][m]+'_out', 'fromLane': str(index), 'toLane': str(index)})
    for root, name in [(nodes,'nodes.nod.xml'), (edges,'edges.edg.xml'), (connections,'connections.con.xml')]: write_xml(root, folder/name)
    net = folder/'junction.net.xml'
    command = [binary('netconvert'), '--node-files', str(folder/'nodes.nod.xml'), '--edge-files', str(folder/'edges.edg.xml'), '--connection-files', str(folder/'connections.con.xml'), '--lefthand', 'true', '--no-turnarounds', 'true', '--junctions.corner-detail', '5', '--junctions.internal-link-detail', '10', '--output-file', str(net)]
    subprocess.run(command, check=True, capture_output=True, text=True)
    mapping = {'tls': 'C', 'incoming': {a:a+'_in' for a in ARMS}, 'routes': {a+m:[a+'_in', TURNS[a][m]+'_out'] for a in ARMS for m in TURN_MIX}}
    return net, mapping

def network_info(net_file, mapping):
    if set(mapping.get('incoming',{}))!=set(ARMS) or len(set(mapping['incoming'].values()))!=4: raise ValueError('Map four distinct incoming edges to N/E/S/W.')
    if not mapping.get('routes') or any(k not in {a+m for a in ARMS for m in TURN_MIX} for k in mapping['routes']): raise ValueError('Map valid L/T/R route keys such as NT and ER.')
    root = ET.parse(net_file).getroot(); junction = next((j for j in root.findall('junction') if j.get('id') == mapping['tls']), None)
    if {t.get('id') for t in root.findall('tlLogic')}-{mapping['tls']}: raise ValueError('This adapter supports one signalized junction; extract that junction before importing the network.')
    if junction is None: raise ValueError('Mapped TLS junction does not exist in the network.')
    cx, cy = float(junction.get('x')), float(junction.get('y'))
    transform = lambda p: [round(p[0]-cx, 3), round(-(p[1]-cy), 3)]
    lanes = []; lane_lengths = {}; lane_edges = {}
    for edge in root.findall('edge'):
        for lane in edge.findall('lane'):
            shape = [transform(tuple(map(float, p.split(',')[:2]))) for p in lane.get('shape', '').split()]
            if len(shape) < 2: continue
            lanes.append({'id': lane.get('id'), 'edge': edge.get('id'), 'width': float(lane.get('width', '3.3')), 'points': shape, 'internal': edge.get('function') == 'internal'})
            lane_lengths[lane.get('id')] = float(lane.get('length')); lane_edges[lane.get('id')] = edge.get('id')
    polygons = [[transform(tuple(map(float, p.split(',')[:2]))) for p in j.get('shape', '').split()] for j in root.findall('junction') if not j.get('id','').startswith(':') and j.get('shape')]
    link_arms = {}; connections = set()
    inverse = {v:k for k,v in mapping['incoming'].items()}
    for c in root.findall('connection'):
        connections.add((c.get('from'), c.get('to')))
        if c.get('tl') == mapping['tls']:
            a = inverse.get(c.get('from'))
            if a is None: raise ValueError('Every controlled incoming edge needs an N/S/E/W mapping.')
            index = int(c.get('linkIndex'))
            if index in link_arms and link_arms[index] != a: raise ValueError('One signal index controls conflicting mapped approaches.')
            link_arms[index] = a
    if not link_arms: raise ValueError('No controlled connections found for TLS.')
    for key, edges in mapping['routes'].items():
        if len(edges) < 2 or any(pair not in connections for pair in zip(edges, edges[1:])): raise ValueError(f'Invalid mapped route {key}: check permitted movements and connected edges.')
    info = {'lanes': lanes, 'junctions': polygons, 'tls': mapping['tls'], 'incoming': mapping['incoming'], 'center': [cx,cy]}
    return info, link_arms, lane_lengths, lane_edges

def schedule(dataset, seed, warmup, duration, demand=1.):
    rng = random.Random(seed); events = []
    def interval(bin, start, length):
        for stream in bin['streams']:
            rate = stream['count'] / bin['duration'] * demand
            if rate <= 0: continue
            t = rng.expovariate(rate)
            while t < length:
                events.append({'depart': round(start+t, 6), **stream, 'color': rng.randrange(6)})
                t += rng.expovariate(rate)
    interval(dataset['bins'][0], 0, warmup)
    for b in dataset['bins']:
        if b['start'] < duration: interval(b, warmup+b['start'], min(b['duration'], duration-b['start']))
    events.sort(key=lambda e:e['depart'])
    for i, event in enumerate(events): event['id'] = str(i)
    return events

def write_routes(events, mapping, path, cfg):
    root = ET.Element('routes')
    for typ, (length,width,speed,accel,kind) in SPECS.items(): ET.SubElement(root,'vType',id=typ,vClass=kind,length=str(length),width=str(width),maxSpeed=str(speed),accel=str(accel),decel='4.5',sigma='0.5',tau=str(cfg['tau']),minGap=str(cfg['minGap']))
    for key, edges in mapping['routes'].items(): ET.SubElement(root,'route',id=key,edges=' '.join(edges))
    for e in events:
        key=e['approach']+e['movement']
        if key not in mapping['routes']: raise ValueError(f'No network route mapped for {key}.')
        ET.SubElement(root,'vehicle',id=e['id'],type=e['type'],route=key,depart=str(e['depart']),departLane='best',departSpeed='0')
    write_xml(root,path)

class Controller:
    """Split-phase controllers with explicit amber/all-red and starvation checks."""
    def __init__(self, name, cfg, link_arms, turning):
        self.name=name; self.cfg=cfg; self.link_arms=link_arms; self.turning=turning; self.arm='N'; self.stage='green'; self.since=0.; self.next='E'; self.reason='initial phase'; self.last_green={a:0. for a in ARMS}; self.decisions=[]
        usable=cfg['cycle']-4*(cfg['amber']+cfg['allRed'])
        if usable <= 0: raise ValueError('Cycle is shorter than total clearance.')
        self.greens={a:usable*(cfg['nsShare']/200 if a in ('N','S') else (100-cfg['nsShare'])/200) for a in ARMS}
        if min(self.greens.values()) < 4: raise ValueError('Fixed-time phases require at least 4 s green.')
    def pressures(self, obs):
        return {a:.5*sum(obs['movementQueue'].get(a+m,0)-self.turning.get(a+m,0)*obs['downstream'].get(a+m,0) for m in TURN_MIX) for a in ARMS}
    def choose(self, now, obs):
        others=[a for a in ARMS if a!=self.arm]
        starved=[a for a in others if obs['queues'][a]>0 and now-self.last_green[a]>=self.cfg['maxRed']]
        if self.name!='fixed' and starved: return max(starved,key=lambda a:now-self.last_green[a]),'maximum-red service rule'
        if self.name=='pressure':
            p=self.pressures(obs); return max(others,key=lambda a:(p[a],now-self.last_green[a])), 'highest eligible queue pressure'
        order=ARMS[ARMS.index(self.arm)+1:]+ARMS[:ARMS.index(self.arm)+1]
        if self.name=='actuated':
            for a in order:
                if a!=self.arm and obs['approaching'][a]>0: return a,'cyclic demand-responsive selection'
        return order[0], 'cyclic phase order'
    def state(self):
        return ''.join(('G' if self.stage=='green' else 'y' if self.stage=='amber' else 'r') if self.link_arms.get(i)==self.arm else 'r' for i in range(max(self.link_arms)+1))
    def update(self, now, obs):
        elapsed=now-self.since; change=False
        if self.stage=='green':
            if self.name=='fixed': change=elapsed>=self.greens[self.arm]-1e-7; reason='fixed green complete'
            else:
                pressure=self.pressures(obs); candidate,_=self.choose(now,obs)
                if elapsed>=self.cfg['maxGreen']-1e-7: change=True;reason='maximum green reached'
                elif elapsed>=self.cfg['minGreen']-1e-7:
                    if any(obs['queues'][a]>0 and now-self.last_green[a]>=self.cfg['maxRed'] for a in ARMS if a!=self.arm): change=True;reason='maximum-red service request'
                    elif self.name=='actuated': change=obs['approaching'][self.arm]==0 and any(obs['approaching'][a]>0 for a in ARMS if a!=self.arm);reason='current approach has no detected demand'
                    else: change=pressure[candidate]>pressure[self.arm]+self.cfg['pressureThreshold'];reason='another approach exceeds switching pressure'
            if change:
                self.next,why=self.choose(now,obs);self.reason=reason+'; '+why;self.stage='amber';self.since=now
        elif self.stage=='amber' and elapsed>=self.cfg['amber']-1e-7: self.stage='all-red';self.since=now;change=True
        elif self.stage=='all-red' and elapsed>=self.cfg['allRed']-1e-7 and not obs['internal']:
            previous=self.arm;self.arm=self.next;self.stage='green';self.since=now;self.last_green[self.arm]=now;change=True
            self.decisions.append({'time':round(now,2),'from':previous,'to':self.arm,'reason':self.reason,'pressure':self.pressures(obs),'queues':dict(obs['queues'])})
        if self.stage=='green': self.last_green[self.arm]=now
        return change
    def display(self, now):
        duration=self.greens[self.arm] if self.name=='fixed' else self.cfg['maxGreen']
        if self.stage=='amber': duration=self.cfg['amber']
        if self.stage=='all-red': duration=self.cfg['allRed']
        return {'approach':self.arm if self.stage=='green' else None,'amber':self.arm if self.stage=='amber' else None,'remaining':round(max(0,duration-now+self.since),2),'stage':self.stage}

def empty_stats():
    return {'seconds':0.,'arrivals':0,'departures':0,'stopped':0.,'queueArea':0.,'peakQueue':0.,'byApproach':{a:{'arrivals':0,'departures':0,'stopped':0.,'queueArea':0.} for a in ARMS}}

def metrics(s, active, pending):
    sec=s['seconds'] or 1
    result={'elapsed':round(s['seconds'],3),'delay':s['stopped']/s['arrivals'] if s['arrivals'] else 0.,'queue':s['queueArea']/sec,'peakQueue':s['peakQueue'],'throughput':s['departures']/sec*3600,'pending':pending,'active':active,'arrivals':s['arrivals'],'departures':s['departures'],'fuel':s['stopped']/3600*.8,'co2':s['stopped']/3600*.8*2.31}
    result['byApproach']={a:{'queue':v['queueArea']/sec,'delay':v['stopped']/v['arrivals'] if v['arrivals'] else 0.,'arrivals':v['arrivals'],'departures':v['departures']} for a,v in s['byApproach'].items()}
    return result

def run_sumo(dataset, cfg, net, mapping, info, links, lane_lengths, events, name, folder, seed, duration, warmup=120, step=.2, capture=False):
    import traci
    from traci import constants as tc
    route_file=Path(folder)/f'demand-{seed}.rou.xml'
    if not route_file.exists(): write_routes(events,mapping,route_file,cfg)
    metadata={e['id']:e for e in events}; turning={a+m:0. for a in ARMS for m in TURN_MIX}
    for b in dataset['bins']:
        for s in b['streams']: turning[s['approach']+s['movement']]+=s['count']
    for a in ARMS:
        total=sum(turning[a+m] for m in TURN_MIX)
        for m in TURN_MIX: turning[a+m]=turning[a+m]/total if total else 0
    controller=Controller(name,cfg,links,turning)
    stats=empty_stats(); intervals={}; frames=[]; pending=set(); inserted=set(); scheduled=0; waits={}; peak_pending=0;arrived_total=0
    center=info['center']; inverse={v:k for k,v in mapping['incoming'].items()}; next_capture=warmup
    log=Path(folder)/f'{name}-{seed}.sumo.log'; label=f'junctionlab-{name}-{seed}'
    command=[binary('sumo'),'-n',str(net),'-r',str(route_file),'--step-length',str(step),'--seed',str(seed),'--no-step-log','true','--duration-log.disable','true','--time-to-teleport','-1','--collision.action','warn','--log',str(log),'--end',str(warmup+duration)]
    traci.start(command,label=label,stdout=subprocess.DEVNULL); conn=traci.getConnection(label)
    version=conn.getVersion()[1]; conn.trafficlight.setRedYellowGreenState(mapping['tls'],controller.state())
    conn.simulation.subscribe((tc.VAR_DEPARTED_VEHICLES_IDS,tc.VAR_ARRIVED_VEHICLES_IDS))
    try:
        for tick in range(round((warmup+duration)/step)):
            conn.simulationStep(); now=(tick+1)*step; logical=now-warmup
            sr=conn.simulation.getSubscriptionResults() or {}; departed=sr.get(tc.VAR_DEPARTED_VEHICLES_IDS,()); arrived=sr.get(tc.VAR_ARRIVED_VEHICLES_IDS,());arrived_total+=len(arrived)
            while scheduled<len(events) and events[scheduled]['depart']<=now+1e-8:
                e=events[scheduled];pending.add(e['id']);scheduled+=1
                if e['depart']>=warmup-1e-8 and e['depart']<warmup+duration:
                    stats['arrivals']+=1;stats['byApproach'][e['approach']]['arrivals']+=1
                    bucket=int((e['depart']-warmup)//900);ss=intervals.setdefault(bucket,empty_stats());ss['arrivals']+=1;ss['byApproach'][e['approach']]['arrivals']+=1
            for vid in departed:
                inserted.add(vid);pending.discard(vid)
                conn.vehicle.subscribe(vid,(tc.VAR_SPEED,tc.VAR_POSITION,tc.VAR_ANGLE,tc.VAR_ROAD_ID,tc.VAR_LANE_ID,tc.VAR_LANEPOSITION))
            values=conn.vehicle.getAllSubscriptionResults(); queued={a:0 for a in ARMS}; lengths={a:0. for a in ARMS}; approaching={a:0 for a in ARMS}; movement_queue={}; downstream={}; internal=False; visual=[]; stopped_ids=[]
            for vid,v in values.items():
                e=metadata[vid];arm=e['approach'];road=v.get(tc.VAR_ROAD_ID,'');lane=v.get(tc.VAR_LANE_ID,'');speed=v[tc.VAR_SPEED];length=SPECS[e['type']][0]
                if road.startswith(':'+mapping['tls']+'_'): internal=True
                if road in inverse:
                    distance=lane_lengths[lane]-v[tc.VAR_LANEPOSITION]
                    if distance<35 or speed<.5: approaching[arm]+=1
                    if speed<.5:
                        queued[arm]+=1;movement_queue[arm+e['movement']]=movement_queue.get(arm+e['movement'],0)+1;lengths[arm]=max(lengths[arm],distance+length)
                elif speed<.5: downstream[road]=downstream.get(road,0)+1
                if speed<.5: waits[vid]=waits.get(vid,0.)+step;stopped_ids.append(vid)
                if capture and now>=next_capture-1e-8 and logical>=-1e-8:
                    x,y=v[tc.VAR_POSITION];angle=math.radians(v[tc.VAR_ANGLE]);x-=math.sin(angle)*length/2;y-=math.cos(angle)*length/2
                    visual.append([int(vid),round(x-center[0],2),round(-(y-center[1]),2),round(math.pi-angle,4),round(speed,2),round(waits.get(vid,0),1)])
            for vid in pending: waits[vid]=waits.get(vid,0.)+step
            obs={'queues':queued,'approaching':approaching,'movementQueue':movement_queue,'downstream':{k:downstream.get(edges[-1],0) for k,edges in mapping['routes'].items()},'internal':internal}
            if controller.update(now,obs): conn.trafficlight.setRedYellowGreenState(mapping['tls'],controller.state())
            if logical>1e-8:
                bucket=min(int((logical-1e-8)//900),math.ceil(duration/900)-1);window=intervals.setdefault(bucket,empty_stats())
                for s in (stats,window):
                    s['seconds']+=step;s['departures']+=len(arrived)
                    for vid in arrived: s['byApproach'][metadata[vid]['approach']]['departures']+=1
                    for vid in stopped_ids: s['stopped']+=step;s['byApproach'][metadata[vid]['approach']]['stopped']+=step
                    for vid in pending: s['stopped']+=step;s['byApproach'][metadata[vid]['approach']]['stopped']+=step
                    for a in ARMS: s['byApproach'][a]['queueArea']+=lengths[a]*step
                    s['queueArea']+=sum(lengths.values())/4*step;s['peakQueue']=max(s['peakQueue'],*lengths.values())
                peak_pending=max(peak_pending,len(pending))
            if capture and now>=next_capture-1e-8 and logical>=-1e-8:
                frames.append({'t':round(max(0,logical),2),'v':visual,'signal':controller.display(now),'metrics':metrics(stats,len(values),len(pending))})
                next_capture+=1.
        final=metrics(stats,len(values),len(pending))
        final.update(seed=seed,peakPending=peak_pending,scheduledTotal=scheduled,insertedTotal=len(inserted),scheduleHash=hashlib.sha256(json.dumps(events,sort_keys=True).encode()).hexdigest(),intervals=[{'start':i*900,'duration':s['seconds'],**metrics(s,len(values),len(pending))} for i,s in sorted(intervals.items())])
        if scheduled!=len(inserted)+len(pending) or len(inserted)!=len(values)+arrived_total: raise RuntimeError('Vehicle conservation failed: inspect SUMO removals or teleport settings.')
        replay=None
        if capture:
            if frames: frames[-1]['metrics']=final
            catalog={e['id']:{'type':e['type'],'approach':e['approach'],'movement':e['movement'],'length':SPECS[e['type']][0],'color':e['color']} for e in events}
            replay={'seed':seed,'catalog':catalog,'frames':frames,'decisions':[{**d,'time':round(d['time']-warmup,2)} for d in controller.decisions if d['time']>=warmup]}
        return final,replay,version
    finally: conn.close()

def summarize(runs):
    return {k:{'mean':statistics.mean(r[k] for r in runs),'sd':statistics.stdev(r[k] for r in runs) if len(runs)>1 else 0.} for k in METRICS}

def paired_difference(baseline, alternative):
    differences=[b['delay']-a['delay'] for a,b in zip(baseline,alternative)]
    result={'mean':statistics.mean(differences),'n':len(differences),'ci95':None,'method':'paired percentile bootstrap; alternative minus baseline (s/arrival)'}
    if len(differences)>=5:
        rng=random.Random(702);boots=sorted(statistics.mean(rng.choices(differences,k=len(differences))) for _ in range(4000));result['ci95']=[boots[99],boots[3899]]
    return result

def run_benchmark(dataset,cfg,folder,seeds,duration,warmup=120,net_file=None,mapping_file=None,capture=True,controllers=None):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    if net_file:
        if not mapping_file: raise ValueError('A supplied network requires --mapping JSON.')
        net=Path(net_file).resolve();mapping=json.loads(Path(mapping_file).read_text(encoding='utf-8'))
        geometry='user-supplied-unvalidated'
    else: net,mapping=make_network(folder);geometry='generated-concept'
    info,links,lane_lengths,lane_edges=network_info(net,mapping)
    schedules={seed:schedule(dataset,seed,warmup,duration,cfg['demand']) for seed in seeds}
    results=[];version=''
    for name,title in (controllers or [('fixed','Fixed-time'),('actuated','Actuated'),('pressure','Queue-pressure')]):
        runs=[];replay=None
        for index,seed in enumerate(seeds):
            print(f'{title} / seed {seed}',flush=True)
            r,recording,version=run_sumo(dataset,cfg,net,mapping,info,links,lane_lengths,schedules[seed],name,folder,seed,duration,warmup,capture=capture and index==0)
            runs.append(r)
            if recording: replay=recording
        results.append({'name':title,'controller':name,'config':cfg,'runs':runs,'summary':summarize(runs),'replay':replay})
    for result in results: result['pairedDelay']=paired_difference(results[0]['runs'],result['runs'])
    return {'schema':'junctionlab.sumo-benchmark/v1','modelVersion':'2.0.0','engine':{'name':'Eclipse SUMO','version':version},'geometry':{'source':geometry,'calibrated':False},'dataset':{k:dataset[k] for k in ('name','source','totalCount','assumptions','duration')},'config':cfg,'duration':duration,'warmup':warmup,'step':.2,'recordInterval':1.,'seeds':seeds,'network':info,'results':results,'limitations':['Geometry and behavior require field calibration.','Offline trajectory replay; sliders do not rerun SUMO in the browser.','Accrued stopped delay includes external backlog and unfinished traffic.','Queues are measured on finite incoming links; backlog is reported separately.','Idle-only fuel/CO2 use assumed common fleet factors.','Queue-pressure is a constrained heuristic, not a stability guarantee.']}

def observations_report(bundle,path,controller='fixed'):
    result=next((r for r in bundle['results'] if r['controller']==controller),None)
    if result is None: raise ValueError('Controller is not present in benchmark.')
    with open(path,encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f);fields=set(reader.fieldnames or ())
        if not {'approach','interval_start_s','interval_seconds'}<=fields or not fields.intersection({'mean_queue_m','departures'}): raise ValueError('Observation CSV needs approach,interval_start_s,interval_seconds and mean_queue_m or departures.')
        rows=list(reader)
    comparisons=[];seen=set()
    for row in rows:
        a=row['approach'].strip().upper();start=finite(row['interval_start_s'],'interval_start_s');duration=finite(row['interval_seconds'],'interval_seconds',.001)
        if a not in ARMS or (a,start) in seen: raise ValueError('Observation approaches must be N/S/E/W; intervals must be unique per approach.')
        seen.add((a,start));predictions=[]
        for run in result['runs']:
            interval=next((v for v in run['intervals'] if abs(v['start']-start)<.01 and abs(v['duration']-duration)<.01),None)
            if interval is None: raise ValueError('Observation interval does not match an exported simulation interval.')
            predictions.append(interval['byApproach'][a])
        item={'approach':a,'start':start,'duration':duration}
        if row.get('mean_queue_m','')!='':
            observed=finite(row['mean_queue_m'],'mean_queue_m');predicted=statistics.mean(p['queue'] for p in predictions);item['queue']={'observed':observed,'predicted':predicted,'error':predicted-observed}
        if row.get('departures','')!='':
            observed=finite(row['departures'],'departures');predicted=statistics.mean(p['departures'] for p in predictions);mh=predicted*3600/duration;ch=observed*3600/duration;geh=math.sqrt(2*(mh-ch)**2/(mh+ch)) if mh+ch else 0.;item['discharge']={'observed':observed,'predicted':predicted,'error':predicted-observed,'gehHourlyEquivalent':geh}
        if len(item)==3: raise ValueError('Each observation needs mean_queue_m or departures.')
        comparisons.append(item)
    if not comparisons: raise ValueError('No observation rows found.')
    qs=[x['queue']['error'] for x in comparisons if 'queue'in x];ds=[x['discharge']['error'] for x in comparisons if 'discharge'in x]
    score={'queueMAE_m':statistics.mean(map(abs,qs)) if qs else None,'queueRMSE_m':math.sqrt(statistics.mean(e*e for e in qs)) if qs else None,'dischargeMAE_vehicles':statistics.mean(map(abs,ds)) if ds else None}
    return {'controller':controller,'observations':str(Path(path).name),'metrics':score,'comparisons':comparisons,'interpretation':'Error report only. No automatic pass/fail or claim of independent validation; the user must identify held-out data.'}

def export_bundle(bundle,path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(bundle,separators=(',',':'),allow_nan=False),encoding='utf-8')
    csv_path=path.with_suffix('.runs.csv')
    with csv_path.open('w',encoding='utf-8',newline='') as f:
        writer=csv.writer(f);writer.writerow(['controller','seed','geometry','calibrated','schedule_sha256',*METRICS])
        for scenario in bundle['results']:
            for run in scenario['runs']: writer.writerow([scenario['controller'],run['seed'],bundle['geometry']['source'],False,run['scheduleHash'],*[run[k] for k in METRICS]])

def calibrate(input_path,observations,grid,folder,seeds,duration,queue_scale=10.,discharge_scale=10.,net_file=None,mapping_file=None):
    dataset,input_cfg=load_input(input_path);cfg=validated_config(input_cfg)
    if not grid or set(grid)-{'tau','minGap'}: raise ValueError('Calibration grid supports tau and minGap only.')
    keys=sorted(grid);choices=[]
    for key in keys:
        values=grid[key]
        if not isinstance(values,list) or not values: raise ValueError('Every grid parameter needs a nonempty candidate list.')
        choices.append([finite(v,key,.2,5 if key=='tau' else 10) for v in values])
    combinations=list(itertools.product(*choices))
    if len(combinations)>36: raise ValueError('Use at most 36 grid candidates.')
    candidates=[]
    for i,values in enumerate(combinations):
        parameters=dict(zip(keys,values));candidate_cfg={**cfg,**parameters}
        bundle=run_benchmark(dataset,candidate_cfg,Path(folder)/f'candidate-{i:03}',seeds,duration,net_file=net_file,mapping_file=mapping_file,capture=False,controllers=[('fixed','Fixed-time')])
        report=observations_report(bundle,observations);m=report['metrics']
        score=(m['queueRMSE_m']/queue_scale if m['queueRMSE_m'] is not None else 0)+(m['dischargeMAE_vehicles']/discharge_scale if m['dischargeMAE_vehicles'] is not None else 0)
        candidates.append({'parameters':parameters,'score':score,'errors':m})
    best=min(candidates,key=lambda r:r['score'])
    return {'status':'fit-on-supplied-observations','independentValidation':False,'parameters':{**cfg,**best['parameters']},'selected':best,'candidates':candidates,'objective':{'queueRMSEScaleMetres':queue_scale,'dischargeMAEScaleVehicles':discharge_scale},'trainingFile':Path(observations).name,'seeds':seeds,'note':'Evaluate the selected parameters on a different observation session. This fit is not independent validation.'}

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    run=sub.add_parser('run',help='Run three SUMO controllers and export a browser replay bundle.')
    run.add_argument('--input',required=True,help='Canonical CSV or Project JSON exported from the website.');run.add_argument('--output',required=True);run.add_argument('--work-dir',required=True);run.add_argument('--duration',type=float);run.add_argument('--warmup',type=float,default=120);run.add_argument('--seeds',default=','.join(str(x) for x in range(2026,2036)));run.add_argument('--config');run.add_argument('--net-file');run.add_argument('--mapping');run.add_argument('--sample',action='store_true',help='Explicitly label supplied demand as synthetic.');run.add_argument('--no-replay',action='store_true')
    validate=sub.add_parser('validate',help='Compare an existing run bundle against observed queues/discharges.');validate.add_argument('--bundle',required=True);validate.add_argument('--observations',required=True);validate.add_argument('--output',required=True);validate.add_argument('--controller',default='fixed',choices=['fixed','actuated','pressure'])
    fit=sub.add_parser('calibrate',help='Fit tau/minGap on supplied training observations; independent validation remains separate.');fit.add_argument('--input',required=True);fit.add_argument('--observations',required=True);fit.add_argument('--grid',required=True);fit.add_argument('--work-dir',required=True);fit.add_argument('--output',required=True);fit.add_argument('--seeds',default='2026,2027,2028');fit.add_argument('--duration',type=float);fit.add_argument('--queue-scale-m',type=float,default=10);fit.add_argument('--discharge-scale-vehicles',type=float,default=10);fit.add_argument('--net-file');fit.add_argument('--mapping')
    args=parser.parse_args()
    try:
        if args.command=='validate':
            bundle=json.loads(Path(args.bundle).read_text(encoding='utf-8'));report=observations_report(bundle,args.observations,args.controller);Path(args.output).write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8');print(json.dumps(report['metrics']));return
        if args.command=='calibrate':
            ds,_=load_input(args.input);duration=finite(args.duration if args.duration is not None else ds['duration'],'duration',1,ds['duration']);seeds=[int(x) for x in args.seeds.split(',')]
            if not 1<=len(seeds)<=100 or len(set(seeds))!=len(seeds) or any(s<0 or s>=2**31 for s in seeds): raise ValueError('Invalid calibration seeds.')
            folder=Path(args.work_dir)
            if folder.exists() and any(folder.iterdir()): raise ValueError('Choose a new empty calibration work directory.')
            if abs(duration/.2-round(duration/.2))>1e-7: raise ValueError('Duration must be a multiple of 0.2 s.')
            grid=json.loads(Path(args.grid).read_text(encoding='utf-8'));report=calibrate(args.input,args.observations,grid,folder,seeds,duration,finite(args.queue_scale_m,'queue scale',.001),finite(args.discharge_scale_vehicles,'discharge scale',.001),args.net_file,args.mapping);Path(args.output).write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8');print('Selected parameters saved; independent validation is pending.');return
        dataset,input_cfg=load_input(args.input);cfg={**DEFAULTS,**{k:v for k,v in input_cfg.items() if k in DEFAULTS}}
        if args.config:
            loaded=json.loads(Path(args.config).read_text(encoding='utf-8'));cfg.update(loaded.get('parameters',loaded))
        cfg=validated_config(cfg)
        if args.sample: dataset['source']='sample';dataset['name']='Synthetic morning counts'
        seeds=[int(x) for x in args.seeds.split(',')]
        if not 1<=len(seeds)<=100 or len(set(seeds))!=len(seeds) or any(s<0 or s>=2**31 for s in seeds): raise ValueError('Use 1–100 unique nonnegative 31-bit seeds.')
        duration=finite(args.duration if args.duration is not None else dataset['duration'],'duration',1,dataset['duration']);warmup=finite(args.warmup,'warmup',0,1800)
        if abs(duration/.2-round(duration/.2))>1e-7 or abs(warmup/.2-round(warmup/.2))>1e-7: raise ValueError('Duration and warmup must be multiples of 0.2 s.')
        # Reuse only empty/new work directories: cached route XML must never belong to another experiment.
        folder=Path(args.work_dir)
        if folder.exists() and any(folder.iterdir()): raise ValueError('Choose a new, empty --work-dir to preserve reproducibility.')
        bundle=run_benchmark(dataset,cfg,folder,seeds,duration,warmup,args.net_file,args.mapping,not args.no_replay);export_bundle(bundle,args.output)
        print('Saved '+str(Path(args.output).resolve()))
    except (ValueError,KeyError,RuntimeError,subprocess.CalledProcessError) as error: parser.exit(2,'Error: '+str(error)+'\n')

if __name__=='__main__': main()
