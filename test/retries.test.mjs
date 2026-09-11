import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryJobs, latestAttempt, recordRetry, applyRetryResult, linkLegacyRetries } from '../public/job-history.js';
import { spending } from '../lib/gemini.mjs';

const attempt=(id,properties={})=>({id,kind:'image',status:'failed',batchId:'batch',index:1,prompt:'A landscape.',aspect:'16:10',resolution:'4k',renderer:'gemini-3.1-flash-image',references:[{id:'reference'}],createdAt:1,finishedAt:2,...properties});

test('retry replaces a failed or cancelled card in place and keeps the paid attempt',()=>{
  for (const status of ['failed','cancelled']) {
    const previous=attempt('old',{status,billing:{at:Date.now(),status:'estimated',estimatedUsd:.15}});
    const next=attempt('new',{status:'queued',createdAt:3,finishedAt:undefined});
    const jobs=[attempt('before'),previous,attempt('after')];
    const costBefore=spending(jobs).allTimeUsd;
    assert.equal(recordRetry(jobs,previous,next),'old');
    assert.deepEqual(libraryJobs(jobs).map(job=>job.id),['before','new','after']);
    assert.equal(spending(jobs).allTimeUsd,costBefore);
    assert.equal(jobs.find(job=>job.id==='old').billing.estimatedUsd,.15);
    assert.equal(latestAttempt(jobs,previous),next);
    assert.throws(()=>recordRetry(jobs,previous,attempt('duplicate')),/already been retried/);
    assert.equal(jobs.some(job=>job.id==='duplicate'),false);
  }
});

test('successive failures form one visible card and stale retries resolve to the newest attempt',()=>{
  const first=attempt('first'),second=attempt('second'),third=attempt('third',{status:'generating'}),jobs=[first];
  recordRetry(jobs,first,second);recordRetry(jobs,second,third);
  assert.deepEqual(libraryJobs(jobs).map(job=>job.id),['third']);
  assert.equal(latestAttempt(jobs,first),third);
  const restored=JSON.parse(JSON.stringify(jobs));
  assert.deepEqual(libraryJobs(restored).map(job=>job.id),['third']);
  assert.equal(latestAttempt(restored,restored.find(job=>job.id==='first')).id,'third');
});

test('generating again preserves completed originals',()=>{
  const original=attempt('original',{status:'completed',output:{url:'original.png'}}),next=attempt('new',{status:'queued'}),jobs=[original];
  assert.equal(recordRetry(jobs,original,next),null);
  assert.deepEqual(libraryJobs(jobs).map(job=>job.id),['new','original']);
  assert.equal(original.supersededBy,undefined);
});

test('retry result cannot duplicate an earlier SSE update or roll back its progress',()=>{
  const previous=attempt('old'),response={job:attempt('new',{status:'queued'}),replacedId:'old'};
  const jobs=[previous];
  applyRetryResult(jobs,response);applyRetryResult(jobs,response);
  assert.deepEqual(libraryJobs(jobs).map(job=>job.id),['new']);
  const running=attempt('new',{status:'generating'}),fromSSE=[running,attempt('old',{supersededBy:'new'})];
  applyRetryResult(fromSSE,response);
  assert.equal(libraryJobs(fromSSE).length,1);
  assert.equal(latestAttempt(fromSSE,fromSSE[1]).status,'generating');
});

test('retried planning cards lead to their resulting image jobs',()=>{
  const old=attempt('old',{kind:'plan',supersededBy:'new-plan'}),child=attempt('child',{batchId:'new-plan',status:'queued'});
  assert.equal(latestAttempt([old,child],old),child);
});

test('legacy cleanup links only matching failed attempts and keeps every completed image',()=>{
  const failed=attempt('failed'),success=attempt('success',{createdAt:3,status:'completed',output:{url:'one.png'}});
  const anotherSuccess=attempt('another-success',{createdAt:4,status:'completed',output:{url:'two.png'}});
  const unmatched=attempt('not-retried',{index:2});
  const jobs=[anotherSuccess,success,failed,unmatched];
  assert.equal(linkLegacyRetries(jobs),1);
  assert.deepEqual(libraryJobs(jobs).map(job=>job.id),['another-success','success','not-retried']);
  assert.equal(linkLegacyRetries(jobs),0);
  assert.equal(failed.supersededBy,'success');
  const independent=[attempt('old'),attempt('different-brief',{createdAt:3,status:'queued',prompt:'Another landscape.'})];
  assert.equal(linkLegacyRetries(independent),0);
});
