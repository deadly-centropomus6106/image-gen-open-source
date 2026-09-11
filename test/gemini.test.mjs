import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateGemini, priceUsage } from '../lib/gemini.mjs';

const job = { renderer:'gemini-3.1-flash-image', prompt:'A quiet green landscape.', aspect:'16:10', resolution:'4k', thinking:'minimal' };
// Deliberately fake credential: every fetch is stubbed, with no network requests.
const key = 'AQ.synthetic-test-credential';
const mimeFailure = "The value 'image/png' is not supported for 'response_format.mime_type'. Supported values: 'image/jpeg'.";

test('five parallel Nano Banana edits keep PNG inputs and accept JPEG outputs',async t=>{
  const png = await sharp({create:{width:32,height:20,channels:3,background:{r:30,g:80,b:40}}}).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const requests = [];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'],key);
    const request = JSON.parse(options.body);
    requests.push(request);
    // Reproduce the live rejection instead of accepting arbitrary payloads.
    if (request.response_format.mime_type !== 'image/jpeg') return Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:mimeFailure}},{status:400});
    assert.equal(request.response_format.image_size,'4K');
    assert.equal(request.response_format.aspect_ratio,'3:2');
    assert.deepEqual(request.generation_config,{thinking_level:'minimal'});
    assert.equal(request.store,false);
    const reference=request.input.find(part=>part.type==='image');
    assert.equal(reference.mime_type,'image/png');
    assert.deepEqual(Buffer.from(reference.data,'base64'),png);
    return Response.json({
      id:'test-interaction',
      steps:[{type:'model_output',content:[{type:'text',text:'Image created.'},{type:'image',mime_type:'image/jpeg',data:jpeg.toString('base64')}]}],
      usage:{total_input_tokens:20,total_output_tokens:2522,total_thought_tokens:6,output_tokens_by_modality:[{modality:'image',tokens:2520},{modality:'text',tokens:2}]},
    });
  });
  const results=await Promise.all(Array.from({length:5},(_,index)=>generateGemini({job:{...job,prompt:`Landscape ${index+1}.`},images:[png],key})));
  assert.equal(requests.length,5);
  assert.equal(new Set(requests.map(request=>request.input[0].text)).size,5);
  for (const result of results) {
    assert.equal(result.outputs.length,1);
    assert.equal(result.outputs[0].mime_type,'image/jpeg');
    const bytes=Buffer.from(result.outputs[0].data,'base64');
    assert.equal((await sharp(bytes).metadata()).format,'jpeg');
    // Exercise the decoder and PNG export pipeline used by saveResult.
    const output=await sharp(bytes).rotate().png().toBuffer();
    const metadata=await sharp(output).metadata();
    assert.equal(metadata.format,'png');
    assert.equal(metadata.width,32);assert.equal(metadata.height,20);
    const billing=priceUsage(job,result.result.usage,result.outputs.length);
    assert.equal(billing.status,'estimated');
    assert.ok(Math.abs(billing.estimatedUsd-0.151234)<1e-10);
  }
});

test('Nano Banana Pro uses JPEG output without Flash-only thinking settings',async t=>{
  t.mock.method(globalThis,'fetch',async (_url,options)=>{
    const request=JSON.parse(options.body);
    assert.equal(request.model,'gemini-3-pro-image');
    assert.deepEqual(request.response_format,{type:'image',mime_type:'image/jpeg',image_size:'1K'});
    assert.equal(request.generation_config,undefined);
    assert.equal(request.input.length,1);
    return Response.json({steps:[]});
  });
  await generateGemini({job:{...job,renderer:'gemini-3-pro-image',aspect:'auto',resolution:'auto'},images:[],key});
});

test('Google rejection is surfaced with no automatic second paid attempt',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    return Response.json({error:{code:400,message:mimeFailure}},{status:400});
  });
  await assert.rejects(generateGemini({job,images:[],key}),/response_format\.mime_type/);
  assert.equal(calls,1);
});

test('a large reference uploads unchanged, generates once by URI, and is cleaned up',async t=>{
  const bytes=Buffer.alloc(16*1024*1024,27);
  const origin='https://generativelanguage.googleapis.com';
  const uri=`${origin}/v1beta/files/reference-1`;
  const stages=[],calls=[];
  let markedPending=false;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls.push([url,options.method]);
    if (url===`${origin}/upload/v1beta/files`) {
      assert.equal(markedPending,false);
      assert.equal(options.headers['X-Goog-Upload-Header-Content-Length'],String(bytes.length));
      assert.equal(options.headers['X-Goog-Upload-Header-Content-Type'],'image/png');
      return new Response(null,{headers:{'x-goog-upload-url':`${origin}/upload/session-1`}});
    }
    if (url===`${origin}/upload/session-1`) {
      assert.equal(options.body,bytes);
      assert.equal(options.headers['X-Goog-Upload-Command'],'upload, finalize');
      return Response.json({file:{name:'files/reference-1',uri,mimeType:'image/png',state:'ACTIVE'}});
    }
    if (url===`${origin}/v1beta/interactions`) {
      assert.equal(markedPending,true);
      const request=JSON.parse(options.body);
      assert.deepEqual(request.input[1],{type:'image',mime_type:'image/png',uri});
      assert.ok(Buffer.byteLength(options.body)<10000);
      assert.equal(request.response_format.image_size,'4K');
      assert.equal(request.response_format.mime_type,'image/jpeg');
      return Response.json({id:'large-reference-result',steps:[]});
    }
    assert.equal(url,uri); assert.equal(options.method,'DELETE');
    return Response.json({});
  });
  const result=await generateGemini({job,images:[bytes],key,onProgress:stage=>stages.push(stage),beforeGenerate:async()=>{markedPending=true;}});
  assert.equal(result.result.id,'large-reference-result');
  assert.deepEqual(stages,['Uploading references','Generating image']);
  assert.equal(calls.filter(([url])=>url.endsWith('/interactions')).length,1);
  assert.equal(calls.filter(([,method])=>method==='DELETE').length,1);
});

test('combined reference size selects file uploads and preserves input order',async t=>{
  const origin='https://generativelanguage.googleapis.com';
  const images=[Buffer.alloc(8*1024*1024,11),Buffer.alloc(8*1024*1024,22)];
  const uploaded=[],deleted=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if (url===`${origin}/upload/v1beta/files`) return new Response(null,{headers:{'x-goog-upload-url':`${origin}/upload/session`}});
    if (url===`${origin}/upload/session`) {
      const index=uploaded.length;
      assert.equal(options.body,images[index]); uploaded.push(options.body);
      return Response.json({file:{name:`files/ref-${index}`,uri:`${origin}/v1beta/files/ref-${index}`,mimeType:'image/png',state:'ACTIVE'}});
    }
    if (options.method==='DELETE') {deleted.push(url);return Response.json({});}
    assert.equal(url,`${origin}/v1beta/interactions`);
    const input=JSON.parse(options.body).input;
    assert.deepEqual(input.slice(1).map(part=>part.uri),images.map((_,index)=>`${origin}/v1beta/files/ref-${index}`));
    return Response.json({steps:[]});
  });
  await generateGemini({job:{...job,renderer:'gemini-3-pro-image'},images,key});
  assert.equal(uploaded.length,2);assert.equal(deleted.length,2);
});

test('file upload failure never dispatches or marks a paid generation pending',async t=>{
  let calls=0,markedPending=false;
  t.mock.method(globalThis,'fetch',async url=>{
    calls++;
    assert.equal(url,'https://generativelanguage.googleapis.com/upload/v1beta/files');
    return Response.json({error:{message:'Upload quota reached'}},{status:429});
  });
  await assert.rejects(generateGemini({job,images:[Buffer.alloc(16*1024*1024)],key,beforeGenerate:async()=>{markedPending=true;}}),error=>error.rejected===true && /Upload quota/.test(error.message));
  assert.equal(markedPending,false);assert.equal(calls,1);
});

test('uncertain generation failure stays uncertain and still deletes its uploaded file',async t=>{
  const origin='https://generativelanguage.googleapis.com';
  let generations=0,deletions=0;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if (url===`${origin}/upload/v1beta/files`) return new Response(null,{headers:{'x-goog-upload-url':`${origin}/upload/session`}});
    if (url===`${origin}/upload/session`) return Response.json({file:{name:'files/ref',uri:`${origin}/v1beta/files/ref`,mimeType:'image/png',state:'ACTIVE'}});
    if (options.method==='DELETE') {deletions++;return Response.json({});}
    assert.equal(url,`${origin}/v1beta/interactions`);generations++;
    throw new Error('Connection lost after dispatch');
  });
  await assert.rejects(generateGemini({job,images:[Buffer.alloc(16*1024*1024)],key}),error=>!error.rejected && /Connection lost/.test(error.message));
  assert.equal(generations,1);assert.equal(deletions,1);
});
