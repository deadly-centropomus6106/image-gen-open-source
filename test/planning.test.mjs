import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, planningPrompt } from '../lib/planning.mjs';
import { generationPrompt, renderingBrief, readableFailure, resolveFormat, outputDimensions, ACTIVE } from '../lib/generation.mjs';

const reference = { id:'ref-1', name:'moodboard.png', width:1200, height:723 };
const analysis = refs => refs.map(ref=>({referenceId:ref.id,subject:'A building on a wooded slope.',distinctiveFeatures:['Repeated angular roof sections','Curving terraces following the hillside'],visualStyle:'Muted natural light with dark roof shapes against pale walls.',uncertainties:''}));
const encode = (images, refs=[reference], overrides={}) => JSON.stringify({
  referenceAnalysis:analysis(refs), intent:{mode:refs.length?'variation':'new',description:'Create related alternatives preserving the distinctive shapes and setting.'},
  summary:'Reference-grounded concepts.',error:null,
  images:images.map(image=>({preserve:refs.length?['Angular roof rhythm and curved terraces']:[],changes:['A new composition with different proportions'],...image})),...overrides,
});
test('a collage reference can produce five separate, distinct jobs',()=>{
  const images = Array.from({length:5},(_,i)=>({title:`Concept ${i+1}`,prompt:`Distinct subject ${i+1} with the shared editorial visual style.`,referenceIds:['ref-1']}));
  const result = parsePlan(encode(images),[reference]);
  assert.equal(result.images.length,5);
  assert.ok(result.images.every(image=>image.references[0]===reference));
});
test('unknown references, duplicate briefs and oversized batches fail before image calls',()=>{
  const image={title:'One',prompt:'A concrete scene.',referenceIds:['ref-1']};
  assert.throws(()=>parsePlan(encode([{...image,referenceIds:['unknown']}]),[reference]),/unknown/);
  assert.throws(()=>parsePlan(encode([image,{...image,prompt:' A  concrete scene. '}]),[reference]),/duplicate/);
  assert.throws(()=>parsePlan(encode(Array(21).fill(image)),[reference]),/between 1 and 20/);
});
test('the planner preserves the original request and each worker gets just its assigned concept',()=>{
  const prompt='Invent five new images in the same vibe, including that Nike thing.';
  const planPrompt=planningPrompt({prompt,references:[reference],requestedCount:0,aspect:'16:10',resolution:'auto'});
  assert.ok(planPrompt.includes(prompt));
  assert.ok(planPrompt.includes('Do not recreate the screenshot'));
  const worker=generationPrompt({batchId:'batch',index:2,total:5,requestPrompt:prompt,prompt:'A new Nike graphic in the moodboard style.',aspect:'16:10',resolution:'4k'},['/references/a.png']);
  assert.match(worker,/image 2 of 5/);
  assert.match(worker,/other concepts as separate jobs/);
  assert.match(worker,/A new Nike graphic/);
  assert.ok(worker.includes(prompt));
});
test('nested backend errors are readable and version failures do not masquerade as sign-in issues',()=>{
  const error=JSON.stringify({type:'error',status:400,error:{message:"The 'gpt-6-astra' model requires a newer version of Codex."}});
  assert.match(readableFailure(error),/newer Codex CLI/);
  assert.ok(!readableFailure(error).includes('{'));
});
test('planning consumes an active slot, and prompt format overrides remain correct',()=>{
  assert.ok(ACTIVE.has('planning'));
  const format=resolveFormat('Recreate these in 4K, 16 by 10.','1:1','auto');
  assert.deepEqual(format,{aspect:'16:10',resolution:'4k'});
  assert.deepEqual(outputDimensions(format,1536,1024),{width:4096,height:2560});
});

test('reference-guided jobs need complete, unique observations and preserved features',()=>{
  const image={title:'Terraced alternative',prompt:'A building with angular roofs and curved hillside terraces.',referenceIds:['ref-1']};
  const other={...reference,id:'ref-2'};
  const plan=JSON.parse(encode([image]));
  const {referenceAnalysis,...withoutAnalysis}=plan;
  assert.throws(()=>parsePlan(JSON.stringify(withoutAnalysis),[reference]),/skipped reference analysis/);
  assert.throws(()=>parsePlan(encode([image],[reference,other],{referenceAnalysis:analysis([reference])}),[reference,other]),/every reference/);
  assert.throws(()=>parsePlan(encode([image],[reference],{referenceAnalysis:[...referenceAnalysis,...referenceAnalysis]}),[reference]),/repeated reference analysis/);
  assert.throws(()=>parsePlan(encode([image],[reference],{referenceAnalysis:[{...referenceAnalysis[0],distinctiveFeatures:[]}]}),[reference]),/distinctive reference features/);
  assert.throws(()=>parsePlan(encode([{...image,preserve:[]}]),[reference]),/what to preserve/);
  assert.throws(()=>parsePlan(encode([{...image,referenceIds:[]}]),[reference]),/omitted the references/);
  const result=parsePlan(encode([image]),[reference]);
  assert.deepEqual(result.images[0].referenceAnalysis,referenceAnalysis);
  assert.deepEqual(result.images[0].preserve,plan.images[0].preserve);
  assert.equal(result.intent.mode,'variation');
});
test('text-only creation needs no reference observations or preserved reference features',()=>{
  const image={title:'New scene',prompt:'A red paper sculpture in a studio.',referenceIds:[],preserve:[],changes:[]};
  const result=parsePlan(encode([image],[]),[]);
  assert.equal(result.intent.mode,'new');
  assert.deepEqual(result.images[0].referenceAnalysis,[]);
  assert.deepEqual(result.images[0].references,[]);
});

const shot = { camera:'Drone with a Four Thirds sensor at 60 m', lens:'24 mm full-frame equivalent, mild wide-angle perspective', exposure:'f/5.6, 1/640 s, ISO 100',
  light:'Late afternoon, sun 25° above the western horizon, clear sky, warm hard light with long shadows', focus:'Focus on the deck, deep depth of field, everything sharp',
  vantage:'Steep oblique aerial, camera tilted 60° down, garden filling the frame', realism:'Natural foliage texture variation, faint haze, mild vignetting, fine grain; no CGI, render or HDR look' };
const photo = (images, refs=[reference], overrides={}) => encode(images, refs, { intent:{mode:'variation',medium:'photograph',description:'Three new gardens with the same sunlit, secluded feeling.'}, ...overrides });
test('a photograph plan needs a shot specification, and a partial one is passed through',()=>{
  const image={title:'Woodland spine',prompt:'A sunlit garden photographed from a drone.',referenceIds:['ref-1']};
  assert.throws(()=>parsePlan(photo([image]),[reference]),/did not write the photography specification/);
  const {exposure,...partial}=shot;
  assert.deepEqual(parsePlan(photo([{...image,photography:{...shot,exposure:''}}]),[reference]).images[0].photography,partial);
  // Codex left visualStyle empty on real photograph plans once the shot specification carried that detail; that must not fail the plan.
  const sparse=parsePlan(photo([{...image,photography:shot}],[reference],{referenceAnalysis:[{...analysis([reference])[0],visualStyle:''}]}),[reference]);
  assert.equal(sparse.images[0].referenceAnalysis[0].visualStyle,'');
  assert.throws(()=>parsePlan(photo([image],[reference],{intent:{mode:'variation',medium:'hologram',description:'x'}}),[reference]),/output medium/);
  const result=parsePlan(photo([{...image,photography:shot}]),[reference]);
  assert.equal(result.intent.medium,'photograph');
  assert.deepEqual(result.images[0].photography,shot);
});
test('other mediums skip the shot specification and renderers only see it when present',()=>{
  const image={title:'Poster',prompt:'A flat graphic poster.',referenceIds:['ref-1']};
  const empty=Object.fromEntries(Object.keys(shot).map(field=>[field,'']));
  const result=parsePlan(encode([{...image,photography:empty}],[reference],{intent:{mode:'variation',medium:'graphic',description:'A poster.'}}),[reference]);
  assert.equal(result.intent.medium,'graphic');
  assert.equal(result.images[0].photography,null);
  assert.equal(parsePlan(encode([image]),[reference]).intent.medium,'other');
  assert.doesNotMatch(renderingBrief({prompt:'A poster.',requestPrompt:'Make a poster.'}),/shot specification/i);
  const brief=renderingBrief({prompt:'A garden photograph.',requestPrompt:'Make it look real.',photography:shot});
  assert.match(brief,/Photographic shot specification/);
  assert.match(brief,/1\/640 s/);
  assert.match(brief,/no CGI, 3D-render/);
  assert.match(generationPrompt({prompt:'A garden photograph.',requestPrompt:'Make it look real.',photography:shot,aspect:'16:10',resolution:'auto'}),/ISO 100/);
});
test('the planning prompt asks for a photographer’s specification and maps plain realism wording to it',()=>{
  const planPrompt=planningPrompt({prompt:'Make it look like a real photo.',references:[reference],requestedCount:3,aspect:'16:10',resolution:'4k'});
  assert.match(planPrompt,/act as a professional photographer/i);
  assert.match(planPrompt,/taken by a real human/);
  assert.match(planPrompt,/set every field inside photography to an empty string/);
  assert.match(planPrompt,/visualStyle is required for every reference/);
  for (const field of Object.keys(shot)) assert.ok(planPrompt.includes(`${field} (`),field);
});
