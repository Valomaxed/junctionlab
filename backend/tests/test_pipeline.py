import sys
import unittest
import io
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from junctionlab import *

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.dataset=dataset_from_csv(Path(__file__).resolve().parents[2]/'data/sample-counts.csv')
        self.links={i:a for i,a in enumerate(ARMS)}
        self.obs={'queues':{a:0 for a in ARMS},'approaching':{a:0 for a in ARMS},'movementQueue':{},'downstream':{},'internal':False}
    def test_counts_preserved_and_invalid_categories_rejected(self):
        self.assertAlmostEqual(self.dataset['totalCount'],450);self.assertEqual(self.dataset['duration'],900)
        bad={'bins':[{'start':0,'duration':900,'streams':[{'approach':'Q','movement':'T','type':'car','count':3}]}]}
        with self.assertRaises(ValueError):normalize_dataset(bad)
    def test_scheduled_arrivals_repeat_and_stay_inside_window(self):
        a=schedule(self.dataset,2026,120,300);b=schedule(self.dataset,2026,120,300)
        self.assertEqual(a,b);self.assertNotEqual(a,schedule(self.dataset,2027,120,300));self.assertTrue(all(0<=e['depart']<420 for e in a));self.assertEqual(len({e['id'] for e in a}),len(a))
    def test_amber_and_all_red_do_not_release_occupied_intersection(self):
        c=Controller('fixed',DEFAULTS,self.links,{})
        c.update(22,self.obs);self.assertEqual(c.stage,'amber');self.assertIn('y',c.state());self.assertNotIn('G',c.state())
        c.update(25,self.obs);self.assertEqual(c.stage,'all-red');self.assertNotIn('G',c.state())
        self.obs['internal']=True;c.update(31,self.obs);self.assertEqual(c.stage,'all-red')
        self.obs['internal']=False;c.update(32,self.obs);self.assertEqual(c.arm,'E');self.assertEqual(c.stage,'green')
    def test_pressure_respects_minimum_green_and_selects_queue(self):
        c=Controller('pressure',DEFAULTS,self.links,{})
        self.obs['movementQueue']['ET']=20;self.obs['queues']['E']=20;self.obs['approaching']['E']=20
        c.update(4,self.obs);self.assertEqual(c.stage,'green');c.update(8,self.obs);self.assertEqual(c.stage,'amber');self.assertEqual(c.next,'E')
    def test_max_red_rule_services_waiting_arm(self):
        c=Controller('pressure',DEFAULTS,self.links,{})
        c.last_green['W']=0;c.last_green['E']=170;c.last_green['S']=170;self.obs['queues']['W']=1
        choice,reason=c.choose(181,self.obs);self.assertEqual(choice,'W');self.assertIn('maximum-red',reason)
    def test_paired_bootstrap_and_small_sample_disclosure(self):
        a=[{'delay':10}]*5;b=[{'delay':8}]*5;p=paired_difference(a,b);self.assertEqual(p['mean'],-2);self.assertEqual(p['ci95'],[-2,-2]);self.assertIsNone(paired_difference(a[:3],b[:3])['ci95'])
    def test_behavior_and_clearance_configuration_guards(self):
        self.assertEqual(validated_config({'tau':1.6})['tau'],1.6)
        for bad in [{'tau':-1},{'minGap':0},{'minGreen':30,'maxGreen':10},{'amber':0},{'cycle':float('nan')}]:
            with self.assertRaises(ValueError):validated_config(bad)
    def test_observation_report_measures_errors_and_rejects_wrong_intervals(self):
        by={a:{'queue':10.,'departures':20} for a in ARMS}
        bundle={'results':[{'controller':'fixed','runs':[{'intervals':[{'start':0,'duration':300,'byApproach':by}]}]}]}
        with patch('builtins.open',return_value=io.StringIO('approach,interval_start_s,interval_seconds,mean_queue_m,departures\nN,0,300,12,18\n')):
            r=observations_report(bundle,'synthetic.csv');self.assertEqual(r['metrics']['queueMAE_m'],2);self.assertEqual(r['metrics']['dischargeMAE_vehicles'],2);self.assertGreater(r['comparisons'][0]['discharge']['gehHourlyEquivalent'],0)
        with patch('builtins.open',return_value=io.StringIO('approach,interval_start_s,interval_seconds,mean_queue_m\nN,0,900,12\n')):
            with self.assertRaises(ValueError):observations_report(bundle,'synthetic.csv')

if __name__=='__main__':unittest.main()
