import assert from 'node:assert/strict';
import test from 'node:test';
import { processMediaCleanupBatch } from '../src/lib/media-cleanup-worker.mjs';

const workerId='00000000-0000-4000-8000-000000000001';
const job={job_id:'00000000-0000-4000-8000-000000000002',bucket_id:'profile-media',object_path:'synthetic-hidden',expected_owner_id:'00000000-0000-4000-8000-000000000003',storage_object_id:'00000000-0000-4000-8000-000000000004'};

function fake({decision={delete_allowed:true,object_missing:false,safe_code:'delete_exact_object',bucket_id:'profile-media',object_path:'synthetic-hidden'},removeError=null,ackError=null}={}) {
  const calls=[];
  return {
    calls,
    supabase:{
      async rpc(name,args){
        calls.push(['rpc',name,args]);
        if(name==='claim_media_cleanup_jobs_v1') return {data:[job],error:null};
        if(name==='authorize_media_cleanup_delete_v1') return {data:[decision],error:null};
        if(name==='ack_media_cleanup_job_v1') return {data:ackError?null:true,error:ackError};
        if(name==='fail_media_cleanup_job_v1') return {data:'pending',error:null};
        throw new Error('unexpected fake RPC');
      },
      storage:{from(bucket){return {async remove(paths){calls.push(['remove',bucket,paths]);return {data:null,error:removeError};}};}},
    },
  };
}

test('trusted cleanup deletes exactly one authorized object and acknowledges',async()=>{
  const harness=fake();
  const result=await processMediaCleanupBatch({supabase:harness.supabase,workerId,limit:1});
  assert.deepEqual(result,{claimed:1,completed:1,deferred:0,failed:0});
  assert.deepEqual(harness.calls.find((entry)=>entry[0]==='remove'),['remove','profile-media',['synthetic-hidden']]);
  assert.ok(harness.calls.some((entry)=>entry[1]==='ack_media_cleanup_job_v1'));
});

test('storage failure records a safe retry and never acknowledges completion',async()=>{
  const harness=fake({removeError:new Error('synthetic provider failure')});
  const result=await processMediaCleanupBatch({supabase:harness.supabase,workerId,limit:1});
  assert.equal(result.failed,1);
  assert.ok(harness.calls.some((entry)=>entry[1]==='fail_media_cleanup_job_v1'));
  assert.ok(!harness.calls.some((entry)=>entry[1]==='ack_media_cleanup_job_v1'));
});

test('reference recheck defers without invoking Storage',async()=>{
  const harness=fake({decision:{delete_allowed:false,object_missing:false,safe_code:'referenced',bucket_id:'profile-media',object_path:'synthetic-hidden'}});
  const result=await processMediaCleanupBatch({supabase:harness.supabase,workerId,limit:1});
  assert.equal(result.deferred,1);
  assert.ok(!harness.calls.some((entry)=>entry[0]==='remove'));
});

test('simulated crash after Storage delete leaves acknowledgement to lease recovery',async()=>{
  const harness=fake();
  const failureHook=async(stage)=>{if(stage==='after-storage-delete'){const error=new Error('synthetic crash');error.code='ALAMIN_SIMULATED_CRASH';throw error;}};
  await assert.rejects(processMediaCleanupBatch({supabase:harness.supabase,workerId,limit:1,failureHook}),/synthetic crash/);
  assert.ok(harness.calls.some((entry)=>entry[0]==='remove'));
  assert.ok(!harness.calls.some((entry)=>entry[1]==='ack_media_cleanup_job_v1'));
  assert.ok(!harness.calls.some((entry)=>entry[1]==='fail_media_cleanup_job_v1'));
});

test('simulated crash after claim performs no Storage mutation',async()=>{
  const harness=fake();
  const failureHook=async(stage)=>{if(stage==='after-claim'){const error=new Error('synthetic pre-delete crash');error.code='ALAMIN_SIMULATED_CRASH';throw error;}};
  await assert.rejects(processMediaCleanupBatch({supabase:harness.supabase,workerId,limit:1,failureHook}),/pre-delete crash/);
  assert.ok(!harness.calls.some((entry)=>entry[0]==='remove'));
  assert.ok(!harness.calls.some((entry)=>entry[1]==='ack_media_cleanup_job_v1'));
});

test('worker inputs fail closed before any claim',async()=>{
  const harness=fake();
  await assert.rejects(processMediaCleanupBatch({supabase:harness.supabase,workerId:'not-a-worker',limit:1}),/identity/);
  await assert.rejects(processMediaCleanupBatch({supabase:harness.supabase,workerId,limit:0}),/batch limit/);
  assert.equal(harness.calls.length,0);
});
