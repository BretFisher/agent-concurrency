"""Behavior tests for cancellation scope, using a fake GitHub API."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/cancel-lower-stack-runs.sh'
MOCK = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p=Path(os.environ['MOCK_STATE'])
s=json.loads(p.read_text())
a=sys.argv[1:]
endpoint=next(x for x in a if x.startswith('repos/'))
method=a[a.index('--method')+1] if '--method' in a else 'GET'
s['calls'].append([method,endpoint])
if method=='POST':
    if s.get('cancel_error'):
        p.write_text(json.dumps(s));sys.exit(1)
    s['cancelled'].append(int(endpoint.split('/')[-2]))
    result={}
elif endpoint.endswith('/stacks/7'):
    s['stack_reads']+=1
    result=s['responses'][endpoint]
    if s.get('mutate') and s['stack_reads']>1:
        result=json.loads(json.dumps(result));result['pull_requests'][0]['head']['sha']='changed'
elif '/actions/runs/' in endpoint:
    result=s['responses'][endpoint]
    if int(endpoint.split('/')[-1]) in s['cancelled'] and not s.get('never_finishes'):
        result=dict(result,status='completed',conclusion='cancelled')
else:
    result=s['responses'].get(endpoint)
    if result is None:
        p.write_text(json.dumps(s));print('Unexpected API path: '+endpoint,file=sys.stderr);sys.exit(1)
p.write_text(json.dumps(s))
print(json.dumps(result))
'''

def fixture():
    repo={'id':1}
    def run(n, pr, branch, event='pull_request', status='in_progress'):
        return {'id':n,'workflow_id':9,'run_number':n,'event':event,'status':status,
                'head_repository':repo,'repository':repo,'head_sha':f'sha{pr}',
                'head_branch':branch,'pull_requests':[{'number':pr}] if event=='pull_request' else []}
    current=run(30,3,'top')
    lower=run(10,1,'bottom')
    pr={'number':3,'state':'open','head':{'sha':'sha3','ref':'top','repo':repo},
        'stack':{'number':7,'size':3,'position':3}}
    members=[{'number':n,'state':'open','head':{'sha':f'sha{n}','ref':ref,'repo':repo}}
             for n,ref in [(1,'bottom'),(2,'middle'),(3,'top')]]
    return {'calls':[],'cancelled':[],'stack_reads':0,'responses':{
        'repos/o/r/actions/runs/30':current,'repos/o/r/pulls':[[pr]],
        'repos/o/r/pulls/3':pr,'repos/o/r/stacks/7':{'number':7,'base':{'ref':'main'},'pull_requests':members},
        'repos/o/r/compare/sha1...sha3':{'status':'ahead'},
        'repos/o/r/compare/sha2...sha3':{'status':'ahead'},
        'repos/o/r/actions/workflows/9/runs':[{'workflow_runs':[lower]}],
        'repos/o/r/actions/runs/10':lower,
        'repos/o/r/commits/sha1/pulls':[[members[0]]],
    }}

class ScopeTests(unittest.TestCase):
    def execute(self, data, **env):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d)
            (folder/'gh').write_text(MOCK);(folder/'gh').chmod(0o755)
            (folder/'sleep').write_text('#!/bin/sh\nexit 0\n');(folder/'sleep').chmod(0o755)
            state=folder/'state.json';state.write_text(json.dumps(data))
            result=subprocess.run(['bash',str(SCRIPT)],text=True,capture_output=True,env={
                **os.environ,'PATH':d+os.pathsep+os.environ['PATH'],'MOCK_STATE':str(state),
                'GITHUB_REPOSITORY':'o/r','GITHUB_RUN_ID':'30',**env})
            return result,json.loads(state.read_text())
    def test_top_cancels_lower_and_confirms(self):
        r,s=self.execute(fixture());self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(s['cancelled'],[10]);self.assertIn('conclusion cancelled',r.stdout)
    def test_lower_initiator_does_nothing(self):
        f=fixture();f['responses']['repos/o/r/pulls/3']['stack']['position']=1
        r,s=self.execute(f);self.assertEqual(s['cancelled'],[]);self.assertEqual(r.returncode,0)
    def test_standalone_does_nothing(self):
        f=fixture();f['responses']['repos/o/r/pulls/3']['stack']=None
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_manual_initiator_does_nothing(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/30']['event']='workflow_dispatch'
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[]);self.assertEqual(len(s['calls']),1)
    def test_manual_victim_is_preserved(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['event']='workflow_dispatch'
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_other_repository_is_preserved(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['head_repository']={'id':2}
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_unrelated_pr_is_preserved(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['pull_requests']=[{'number':99}]
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_newer_lower_run_is_preserved(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['run_number']=31
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_completed_run_is_preserved(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['status']='completed'
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_stack_change_stops_cancellation(self):
        f=fixture();f['mutate']=True
        r,s=self.execute(f);self.assertNotEqual(r.returncode,0);self.assertEqual(s['cancelled'],[])
    def test_non_linear_stack_does_nothing(self):
        f=fixture();f['responses']['repos/o/r/compare/sha1...sha3']['status']='diverged'
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_ambiguous_current_pr_does_nothing(self):
        f=fixture();f['responses']['repos/o/r/pulls'][0]*=2
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_push_uses_commit_association(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['event']='push'
        f['responses']['repos/o/r/actions/runs/10']['pull_requests']=[]
        r,s=self.execute(f);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(s['cancelled'],[10])
    def test_unassociated_push_is_preserved(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/10']['event']='push'
        f['responses']['repos/o/r/actions/runs/10']['pull_requests']=[]
        f['responses']['repos/o/r/commits/sha1/pulls']=[[]]
        _,s=self.execute(f);self.assertEqual(s['cancelled'],[])
    def test_dry_run_never_writes(self):
        r,s=self.execute(fixture(),STACK_CANCEL_DRY_RUN='true')
        self.assertEqual(s['cancelled'],[]);self.assertIn('Would cancel',r.stdout)
    def test_second_page_is_processed(self):
        f=fixture();pages=f['responses']['repos/o/r/actions/workflows/9/runs']
        pages.insert(0,{'workflow_runs':[]})
        r,s=self.execute(f);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(s['cancelled'],[10])
    def test_cancellation_failure_is_reported(self):
        f=fixture();f['cancel_error']=True
        r,_=self.execute(f);self.assertNotEqual(r.returncode,0);self.assertIn('request failed',r.stdout)
    def test_unconfirmed_cancellation_is_reported(self):
        f=fixture();f['never_finishes']=True
        r,_=self.execute(f);self.assertNotEqual(r.returncode,0);self.assertIn('unconfirmed',r.stdout)
    def test_event_scope_can_be_narrowed(self):
        f=fixture();f['responses']['repos/o/r/actions/runs/30']['event']='push'
        r,s=self.execute(f,STACK_CANCEL_EVENTS='pull_request')
        self.assertEqual(r.returncode,0);self.assertEqual(s['cancelled'],[])

if __name__=='__main__':
    unittest.main()
