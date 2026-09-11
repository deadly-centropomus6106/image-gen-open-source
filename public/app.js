import { libraryJobs, latestAttempt, applyRetryResult } from './job-history.js';
import { originalBatch } from './batch-history.js';
import { MODELS, modelFor, isPaid, resolveFormat, settingsFor, estimateOutput, formatDescription, renderersFor, settingsForModels, estimateModels, openaiSize } from './model-config.js';
const $ = selector => document.querySelector(selector);
const icons = {
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  'image-plus': '<path d="M13 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-6"/><path d="m3 17 5-5 4 4 3-3 6 6M18 2v6m-3-3h6"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  settings: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  spark: '<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  ratio: '<rect x="2" y="5" width="20" height="14" rx="3"/>',
  size: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',
  layers: '<rect x="3" y="3" width="13" height="13" rx="3"/><path d="M9 20h8a3 3 0 0 0 3-3V9"/>',
  codex: '<path d="m8 4 4-2 6 3v4l4 3v6l-4 2-4-2-4 3-6-3v-4l-3-3V5l4-2 4 2 5-1 5 3v6l-5 3-6-3V8l5-3M8 8l6 3v7M4 14l6 3 8-4M8 4v4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 14h12l1-14M10 10v6m4-6v6"/>',
  retry: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.image}</svg>`;
document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const activeStatuses = new Set(['starting', 'planning', 'preparing', 'generating', 'saving']);
const retryableStatuses = new Set(['failed', 'cancelled']);
const progressDescriptions = {
  starting: 'Connecting to Codex to start your request.',
  planning: 'Reading your prompt and references, then planning each image.',
  preparing: 'Preparing the prompt and references for this image.',
  generating: 'Creating your image. This can take a few minutes.',
  saving: 'Your image is ready. Preparing the download.',
  queued: 'Waiting for an open slot. Starts automatically.',
  cancelled: 'This request was cancelled.',
};
let data = { jobs: [], concurrency: 3, connection: { status: 'connecting' } };
let token, events, reconnectTimer, toastTimer;
let references = [];
let filter = 'all';
let submitting = false;
let detailId;
let previewReference = null;
const jobReferences = job => job?.references || (job?.reference ? [job.reference] : []);
const batchFor = job => originalBatch(data.jobs, data.batches, job);
const imageDragType = 'application/x-image-studio-job';
let draggingImageId = null;
let suppressCardClickUntil = 0;
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value || 0);
const modelName = job => job.kind==='plan' && renderersFor(job).length>1 ? `${renderersFor(job).length} models` : modelFor(job)?.label || 'Codex';
const optionNames = ['aspect','resolution','count','quality','thinking','background'];
const quoteLabel = (quote,multiplier=1) => quote.minUsd === quote.maxUsd ? `~${money(quote.maxUsd*multiplier)}` : `~${money(quote.minUsd*multiplier)}–${money(quote.maxUsd*multiplier)}`;
let selectedRenderers = ['codex'];
const modelTiles = {
  codex: {badge:'Free',description:'Uses your Codex subscription allowance; no extra API charge.'},
  'gpt-image-2.5-flare': {badge:'Flare',description:'Fast everyday generation. Same token prices as Sunburst.'},
  'gpt-image-2.5-sunburst': {badge:'Sunburst',description:'For precise edits. Same token prices as Flare.'},
  'gemini-3.1-flash-image': {badge:'2',description:'Nano Banana 2 with Minimal or High thinking.'},
  'gemini-3-pro-image': {badge:'Pro',description:'Nano Banana Pro with automatic thinking.'},
};
const providerLogo = renderer => `<img src="/${MODELS[renderer].provider==='gemini'?'googlegemini':'openai'}.svg" alt="" draggable="false">`;
$('#model-options').innerHTML = Object.entries(MODELS).map(([id,model])=>{
  const tile=modelTiles[id];
  return `<button type="button" class="model-option" data-renderer="${id}" aria-pressed="false" aria-label="${escape(model.label)} · ${model.billing}" title="${escape(model.label+' · '+model.billing+'. '+tile.description)}"><span class="model-logo ${model.provider}">${providerLogo(id)}<span class="model-version">${tile.badge}</span><span class="model-check" aria-hidden="true">✓</span></span></button>`;
}).join('');
function composerJob() {
  const input={...Object.fromEntries(optionNames.map(name=>[name,$('#'+name).value])),renderers:selectedRenderers};
  return {...input,...resolveFormat($('#prompt').value,input.aspect,input.resolution),...settingsForModels(input)};
}
function retryLabel(job) {
  const renderers=renderersFor(job);
  if (!renderers.some(renderer=>isPaid({renderer}))) return job.output ? 'Generate again' : 'Try again';
  const quote=estimateModels(job), count=job.kind==='plan' ? job.requestedCount || 1 : 1;
  return `${job.output ? 'Generate again' : 'Try again'} · Paid API · ${quoteLabel(quote,count)}${job.kind==='plan'&&!job.requestedCount?' / concept':''} + inputs${renderers.some(renderer=>MODELS[renderer].provider==='gemini')?' & thinking':''}`;
}
function costLabel(billing) {
  if (!billing) return 'Subscription';
  if (billing.status === 'pending') return 'Cost pending';
  if (billing.status === 'unknown') return 'Cost unknown';
  if (billing.status === 'not-charged') return 'Request not charged';
  return `~${money(billing.estimatedUsd)}${billing.status === 'partial' ? ' + unknown usage' : ''}`;
}
const retryingJobs = new Set();
const deletingJobs = new Set();
const cardSignatures = new Map();
const cardNodes = new Map();

function toast(message, error = false, undoId = null) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false;
  if (undoId) {
    const undo=document.createElement('button');undo.type='button';undo.className='toast-undo';undo.textContent='Undo';
    undo.addEventListener('click',()=>{clearTimeout(toastTimer);undo.disabled=true;void perform('restore',undoId);},{once:true});
    $('#toast').append(undo);
  }
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, undoId ? 12000 : error ? 8000 : 4000);
}

async function api(url, input, options = {}) {
  const response = await fetch(url, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-Studio-Token': token, ...options.headers },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), ...options,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function saveDraft() {
  try { localStorage.setItem('image-studio-draft', JSON.stringify({ prompt: $('#prompt').value, aspect: $('#aspect').value, resolution: $('#resolution').value, count: $('#count').value, renderers: [...selectedRenderers], quality:$('#quality').value, thinking:$('#thinking').value, background:$('#background').value, references: references.filter(ref => ref.record).map(ref => ref.record) })); } catch {}
}
function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('image-studio-draft') || '{}');
    $('#prompt').value = draft.prompt || '';
    const savedModels=Array.isArray(draft.renderers) ? draft.renderers : [draft.renderer || 'codex'];
    selectedRenderers=[...new Set(savedModels.filter(id=>Object.hasOwn(MODELS,id)))];
    if (savedModels.length && !selectedRenderers.length) selectedRenderers=['codex'];
    for (const name of optionNames) if ([...$('#' + name).options].some(option => option.value === draft[name])) $('#' + name).value = draft[name];
    references = (draft.references || []).slice(0,20).map(record => ({ key: record.id, record, preview: record.thumbnail }));
    const columns = Math.min(6, Math.max(2, Number(localStorage.getItem('image-studio-columns')) || 4));
    $('#density').value = columns; document.documentElement.style.setProperty('--columns', columns);
  } catch {}
  resizePrompt(); renderAttachments();
}
function resizePrompt() { $('#prompt').style.height = 'auto'; $('#prompt').style.height = Math.min(120, Math.max(40, $('#prompt').scrollHeight)) + 'px'; }
function elapsed(job) {
  if (!job.startedAt) return 'Waiting for an open slot';
  const seconds = Math.max(0, Math.floor(((job.finishedAt || Date.now()) - job.startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
}
function actionButton(action, id, label, glyph, className = 'card-action') {
  return `<button type="button" class="${className}" data-action="${action}" data-id="${id}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
}
function progressTime(job) { return activeStatuses.has(job.status) ? `Working · ${elapsed(job)}` : elapsed(job); }
function pendingMarkup(job) {
  if (job.deletedAt) return `<div class="job-overlay"><span class="queued-icon">${icon('trash')}</span><strong>Deleted from library</strong><button class="retry-small" data-action="restore" data-id="${job.id}">Restore card</button></div>`;
  if (job.supersededBy) return `<div class="job-overlay"><span class="queued-icon">${icon('retry')}</span><strong>Previous attempt</strong><span class="job-caption">This request has a newer attempt.</span><button class="retry-small" data-action="view-latest" data-id="${job.id}">View latest attempt</button></div>`;
  if (retryingJobs.has(job.id)) return '<div class="job-overlay"><span class="spinner" aria-hidden="true"></span><strong>Starting retry…</strong><span class="job-caption">Adding this image back to the queue.</span></div>';

  const active = activeStatuses.has(job.status), failed = job.status === 'failed', cancelled = job.status === 'cancelled';
  const title = active ? job.stage || 'Working…' : failed ? (job.stage === 'Interrupted' ? 'Interrupted' : 'Generation failed') : cancelled ? 'Cancelled' : job.status === 'queued' ? 'Queued' : 'Checking status';
  const description = failed ? job.error || 'The request could not finish. You can try again.' : progressDescriptions[job.status] || 'Waiting for an updated status from the server.';
  return `<div class="job-overlay">${active ? '<span class="spinner" aria-hidden="true"></span>' : `<span class="queued-icon" aria-hidden="true">${icon(failed ? 'alert' : cancelled ? 'close' : 'clock')}</span>`}<strong>${escape(title)}</strong><span class="job-caption">${escape(description)}</span>${active ? `<span class="elapsed" data-elapsed="${job.id}">${progressTime(job)}</span>` : ''}${retryableStatuses.has(job.status) ? `<button class="retry-small" data-action="retry" data-id="${job.id}">${escape(retryLabel(job))}</button>` : ''}</div>`;
}
function cardModelLabel(job) {
  const models=renderersFor(job);
  const label=job.kind==='plan' ? models.map(renderer=>MODELS[renderer].label).join(' + ') : modelName(job);
  return `<div class="card-model-label" title="${escape(label)}">${models.length===1?providerLogo(models[0]):icon('layers')}<span>${escape(label)}</span>${job.conceptIndex && job.comparisonRenderers?.length>1?`<b>#${job.conceptIndex}</b>`:''}</div>`;
}
function renderCard(job, node) {
  node.className = `image-card ${job.status} ${job.output ? '' : 'working-card'}`;
  node.draggable = Boolean(job.output);
  node.setAttribute('aria-busy', String(activeStatuses.has(job.status) || retryingJobs.has(job.id)));
  node.tabIndex = 0; node.setAttribute('role','button'); node.setAttribute('aria-label', `${modelName(job)} · ${job.stage}: ${job.prompt}`);
  const ratio = job.output ? job.output.width / job.output.height : job.aspect === 'auto' ? 1.3 : job.aspect.split(':').reduce((a,b) => a / b);
  node.style.setProperty('--ratio', ratio);
  if (job.output) {
    node.innerHTML = `<img class="card-image" loading="lazy" src="${job.output.thumbnail}" alt="${escape(job.prompt)}" draggable="false"><div class="card-hover"><div class="card-top"><span class="card-tag">${job.output.width} × ${job.output.height}</span><div class="card-actions">${actionButton('reference',job.id,'Use as reference','image-plus')}<a class="card-action" href="${job.output.url}?download=1" title="Download image" aria-label="Download image" download>${icon('download')}</a>${actionButton('delete',job.id,'Delete card','trash','card-action delete-card')}</div></div><div class="card-caption"><span class="card-prompt">${escape(job.prompt)}</span><span class="card-provider">${escape(modelName(job))} · ${escape(costLabel(job.billing))}</span><span class="card-meta"><span>${job.output.resized ? 'Export adjusted · Original saved' : 'Original output'}</span><span>${elapsed(job)}</span></span></div></div>`;
  } else {
    node.innerHTML = `${job.reference ? `<img class="card-image" src="${job.reference.thumbnail}" alt="Reference image" draggable="false"><span class="reference-label">REFERENCE</span>` : ''}${pendingMarkup(job)}<div class="pending-card-actions">${activeStatuses.has(job.status) || job.status === 'queued' ? actionButton('cancel',job.id,'Cancel generation','close') : ''}${!retryingJobs.has(job.id) ? actionButton('delete',job.id,activeStatuses.has(job.status) || job.status==='queued' ? 'Cancel generation and delete card' : 'Delete card','trash','card-action delete-card') : ''}</div>`;
  }
  node.insertAdjacentHTML('beforeend',cardModelLabel(job));
}
function render() {
  const library=libraryJobs(data.jobs).filter(job=>!deletingJobs.has(job.id));
  const visible = library.filter(job => filter === 'all' || activeStatuses.has(job.status) || job.status === 'queued');
  const visibleIds = new Set(visible.map(job => job.id));
  for (const [id, node] of cardNodes) if (!visibleIds.has(id)) { node.remove(); cardNodes.delete(id); cardSignatures.delete(id); }
  const gallery = $('#gallery');
  let cursor = gallery.firstElementChild;
  for (const job of visible) {
    let node = cardNodes.get(job.id);
    if (!node) { node = document.createElement('article'); node.dataset.id = job.id; cardNodes.set(job.id, node); }
    const signature = JSON.stringify([job.status,job.stage,job.error,job.output,job.prompt,job.billing,job.supersededBy,retryingJobs.has(job.id)]);
    if (cardSignatures.get(job.id) !== signature) { renderCard(job,node); cardSignatures.set(job.id, signature); }
    if (node !== cursor) gallery.insertBefore(node,cursor);
    cursor = node.nextElementSibling;
  }
  const planning = library.filter(job => job.kind === 'plan' && activeStatuses.has(job.status)).length;
  const active = library.filter(job => job.kind !== 'plan' && activeStatuses.has(job.status)).length;
  const queued = library.filter(job => job.status === 'queued').length;
  $('#total-count').textContent = library.length;
  $('#active-count').textContent = active + queued + planning || '';
  $('#empty').hidden = library.length > 0;
  $('#no-results').hidden = filter !== 'active' || visible.length > 0 || library.length === 0;
  $('#batch-progress').hidden = active + queued + planning === 0;
  $('#batch-progress-text').textContent = [planning ? 'Planning your images' : '', active ? `${active} generating` : '', queued ? `${queued} queued` : ''].filter(Boolean).join(' · ');
  $('#concurrency').value = data.concurrency;
  const connection = data.connection;
  $('#connection-button').className = `connection ${connection.status}`;
  $('#connection-text').textContent = connection.status === 'connected' ? 'Codex subscription' : connection.status === 'connecting' ? 'Connecting…' : connection.status === 'signed-out' ? 'Connect Codex' : 'Reconnect Codex';
  $('#connection-button').title = connection.message || '';
  const showNotice = ['unavailable','signed-out'].includes(connection.status);
  $('#connection-notice').hidden = !showNotice;
  $('#connection-notice').textContent = showNotice ? connection.message : '';
  renderSubmit();
  renderSpending();
  if (detailId) renderDetail();
}
function renderSubmit() {
  const uploading=references.some(ref=>ref.uploading), errors=references.some(ref=>ref.error);
  const models=selectedRenderers.map(renderer=>MODELS[renderer]);
  const paid=models.some(model=>model.billing==='Paid API'), hasOpenAI=models.some(model=>model.provider==='openai');
  const hasGoogle=models.some(model=>model.provider==='gemini');
  const missing=[...new Set(models.filter(model=>model.billing==='Paid API'&&!data.providers?.[model.provider]?.configured).map(model=>model.providerLabel))];
  for (const button of $('#model-options').children) button.setAttribute('aria-pressed',String(selectedRenderers.includes(button.dataset.renderer)));
  $('#quality-control').hidden=!hasOpenAI;
  $('#background-control').hidden=!hasOpenAI;
  $('#thinking-control').hidden=!selectedRenderers.includes('gemini-3.1-flash-image');
  $('#quality-control').title='GPT Image models only';
  $('#background-control').title='GPT Image models only';
  $('#thinking-control').title='Nano Banana 2 only';
  const provider=models.length===1?models[0].provider:null;
  const sizeLabels=provider==='codex'?['Original size','2K export','4K export']:provider==='openai'?['Standard size','Up to 2K','Up to 4K']:provider==='gemini'?['1K native','2K native','4K native']:['Standard / 1K','2K','4K'];
  [...$('#resolution').options].forEach((option,index)=>{option.textContent=sizeLabels[index];});
  $('#resolution').closest('label').title='Output size. Hover a selected model icon for its actual dimensions and quality settings.';
  $('#aspect').options[0].textContent=provider==='openai'?'Auto · square':'Auto ratio';
  for (const option of $('#count').options) option.textContent=option.value==='0'?'Auto count':`${option.value} image${option.value==='1'?'':'s'} each`;
  $('#count-control').title='Images made by each selected model. For example: 2 images each × 3 models = 6 images. A count in your prompt can override this.';
  $('#key-needed').hidden=!missing.length;
  $('#key-needed').textContent=`Add your ${missing.join(' and ')} API key${missing.length>1?'s':''} in Preferences to use every selected model.`;
  let invalid=false;
  try {
    const job=composerJob(), quote=estimateModels(job), count=Number($('#count').value);
    const total=count*models.length;
    const quantity=count?`${total} image${total===1?'':'s'}`:'Auto image count';
    if (hasOpenAI) openaiSize(job); // Confirms this ratio forms a supported GPT canvas.
    const draftQuality=hasOpenAI && ['low','medium'].includes($('#quality').value);
    $('#generation-cost').textContent=`${quantity} · ${paid?`${quoteLabel(quote,count||1)} output${count?'':' / concept'} + inputs${hasGoogle?' & thinking':''}`:'No extra API charge'}${draftQuality?' · Draft GPT quality, use High for finals':''}`;
    const details=[];
    for (const button of $('#model-options').children) {
      const renderer=button.dataset.renderer, model=MODELS[renderer];
      button.title=`${model.label} · ${model.billing}\n${modelTiles[renderer].description}\nClick to select or deselect. Selection is saved.`;
      if (selectedRenderers.includes(renderer)) {
        const output={...job,renderer,...settingsFor({...job,renderer})};
        const detail=`${model.label}: ${isPaid(output)?quoteLabel(estimateOutput(output))+' USD output / image, plus inputs'+(model.provider==='gemini'?' & thinking':''):'no extra API charge'}\n${formatDescription(output)}`;
        button.title+='\n'+detail; details.push(detail);
      }
    }
    $('#generation-cost').title=[count?`${count} image${count===1?'':'s'} per model × ${models.length} selected models = ${total} images. A count in your prompt can override this.`:'Auto count is determined from your prompt during planning. Each model renders every concept.',...details].join('\n\n');
  } catch(error) {
    invalid=true; $('#generation-cost').textContent=error.message;
    $('#generation-cost').title=models.length?'Change the prompt ratio or output settings to get an estimate.':'Select one or more model icons.';
  }
  $('#generate').disabled=submitting || uploading || errors || invalid || !$('#prompt').value.trim() || data.connection.status!=='connected' || missing.length>0;
  $('#generate-text').textContent=submitting?'Adding…':uploading?'Uploading…':`${models.length>1?'Compare':'Generate'}${paid?' · Paid API':''}`;
}
function renderSpending() {
  const spending=data.spending;
  for (const provider of ['openai','gemini']) {
    const name=provider==='openai'?'OpenAI':'Google', configured=data.providers?.[provider]?.configured;
    $('#'+provider+'-key-status').textContent=configured?`Key saved locally. Access and billing are checked by ${name} when you generate.`:`Add a key to use ${name} image models. These images are billed separately.`;
    $('#remove-'+provider+'-key').hidden=!configured;
  }
  $('#spend-button').innerHTML=`<span class="spend-label">API this month</span><b>~${money(spending?.monthUsd)}${spending?.monthUncertain?' + ?':''}</b>`;
  $('#month-spend').textContent=`~${money(spending?.monthUsd)}${spending?.monthUncertain?' + ?':''}`;
  $('#total-spend').textContent=`~${money(spending?.allTimeUsd)}${spending?.uncertain?' + ?':''}`;
  $('#provider-totals').textContent=`This month: OpenAI ~${money(spending?.providers?.openai?.monthUsd)} · Google ~${money(spending?.providers?.gemini?.monthUsd)}`;
  $('#spending-status').textContent=[
    spending?.pending?`${spending.pending} request(s) in flight.`:'',
    spending?.uncertain?`${spending.uncertain} request(s) have missing usage. Totals are incomplete; check provider billing.`:'',
    'This app’s requests only. Returned usage includes input and generated output; Google thinking is included when reported. Credits, cached-input discounts, tax, and usage elsewhere are excluded.',
    `Rates checked ${spending?.priceDate || '2026-09-09'}. Provider billing is the final source of truth.`,
  ].filter(Boolean).join(' ');
  $('#spending-history').innerHTML=(spending?.recent || []).map(entry=>`<button type="button" class="spending-row" data-cost-job="${entry.jobId}"><span>${escape(modelName(entry))}<small>${escape(entry.title)} · ${new Date(entry.at).toLocaleDateString()}</small></span><b>${escape(costLabel(entry))}</b></button>`).join('') || '<p>No paid API requests yet.</p>';
}
function renderAttachments() {
  $('#attachments').hidden = references.length === 0;
  $('#attachments').innerHTML = references.map(ref => `<div class="attachment ${ref.uploading ? 'uploading' : ''} ${ref.error ? 'failed' : ''}" title="${escape(ref.error || ref.record?.name || 'Uploading reference…')}"><img src="${escape(ref.preview)}" alt="${escape(ref.record?.name || 'Reference image')}">${ref.uploading ? '<span class="small-spinner"></span>' : ''}<button type="button" data-remove="${ref.key}" aria-label="Remove reference">${icon('close')}</button></div>`).join('') + `<button type="button" class="attachment-add" id="attachment-add" aria-label="Add more images">${icon('plus')}</button>`;
  renderSubmit();
}
async function addFiles(files) {
  if (!token) { toast('Wait for the local app to connect.',true); return; }
  const candidates = Array.from(files).filter(file => file.type.startsWith('image/'));
  if (!candidates.length) { toast('Drop PNG, JPEG, WebP, AVIF, GIF, or TIFF images.',true); return; }
  const available = 20 - references.length;
  if (candidates.length > available) toast('You can add up to 20 references at a time.',true);
  const pending = candidates.slice(0,Math.max(0,available)).map(file => {
    const ref = { key: crypto.randomUUID(), preview: URL.createObjectURL(file), uploading: true, file };
    references.push(ref); return ref;
  });
  renderAttachments();
  async function worker() {
    while (pending.length) {
      const ref = pending.shift();
      try {
        if (ref.file.size > 25 * 1024 * 1024) throw new Error(`${ref.file.name} is over 25 MB.`);
        const response = await fetch('/api/uploads', { method:'POST', headers:{ 'X-Studio-Token':token, 'X-Filename':encodeURIComponent(ref.file.name), 'Content-Type':ref.file.type }, body:ref.file });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not upload that image.');
        ref.record = result;
        URL.revokeObjectURL(ref.preview); ref.preview = result.thumbnail;
      } catch (error) { ref.error = error.message; toast(error.message,true); }
      finally { ref.uploading = false; delete ref.file; renderAttachments(); saveDraft(); }
    }
  }
  await Promise.all(Array.from({length:Math.min(3,pending.length)},worker));
  $('#prompt').focus();
}
async function submit(event) {
  event?.preventDefault();
  if ($('#generate').disabled) return;
  submitting = true; renderSubmit();
  const prompt = $('#prompt').value.trim(), refIds = references.map(ref => ref.record.id);
  try {
    const result = await api('/api/jobs', { prompt, renderers:[...selectedRenderers], quality:$('#quality').value, thinking:$('#thinking').value, background:$('#background').value, references:refIds, aspect:$('#aspect').value, resolution:$('#resolution').value, count:Number($('#count').value) });
    const ids = new Set(result.jobs.map(job => job.id));
    data.jobs = [...result.jobs, ...data.jobs.filter(job => !ids.has(job.id))];
    if ($('#prompt').value.trim() === prompt) $('#prompt').value = '';
    references = references.filter(ref => !refIds.includes(ref.record?.id));
    filter = 'all'; document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active',button.dataset.filter === filter));
    resizePrompt(); renderAttachments(); saveDraft(); render(); window.scrollTo({top:0,behavior:'auto'});
  } catch (error) { toast(error.message,true); }
  finally { submitting = false; renderSubmit(); }
}
async function perform(action,id,referenceId) {
  try {
    if (action === 'view-reference' || action === 'attach-reference') {
      const job=data.jobs.find(job=>job.id===id);
      const record=[...jobReferences(job), ...(batchFor(job)?.references || [])].find(ref=>ref.id===referenceId);
      if (!record) throw new Error('That reference is no longer available.');
      if (action === 'view-reference') openReference(record);
      else addReferenceToChat(record);
    } else if (action === 'reference') {
      if (references.length >= 20) throw new Error('You already have 20 references.');
      const record = await api('/api/references',{jobId:id});
      references.push({key:record.id,record,preview:record.thumbnail});
      renderAttachments(); saveDraft(); closeDetail(); $('#prompt').focus(); toast('Added to your references.');
    } else if (action === 'delete' || action === 'restore') {
      if (deletingJobs.has(id) || retryingJobs.has(id)) return;
      const removing=action==='delete';
      if (removing) {deletingJobs.add(id);if (detailId===id) closeDetail();render();}
      try {
        const result=await api(`/api/jobs/${id}/${action}`,{});
        const existing=data.jobs.find(job=>job.id===id);
        if (existing) {
          // Update visibility without replacing newer billing received over SSE.
          const {deletedAt,status,stage,finishedAt}=result.job;
          Object.assign(existing,{deletedAt,status,stage,finishedAt});
          if (result.job.output) existing.output=result.job.output;
        } else data.jobs.unshift(result.job);
        toast(removing ? 'Card deleted.' : 'Card restored.',false,removing?id:null);
      } finally {deletingJobs.delete(id);render();}
    } else if (action === 'cancel') {
      await api(`/api/jobs/${id}/cancel`,{});
    } else if (action === 'view-latest') {
      const job=latestAttempt(data.jobs,data.jobs.find(item=>item.id===id));
      if (!job) throw new Error('The latest attempt is no longer available.');
      openDetail(job.id);
    } else if (action === 'retry') {
      if (retryingJobs.has(id)) return;
      retryingJobs.add(id);render();
      try {
        const result=await api(`/api/jobs/${id}/retry`,{});
        applyRetryResult(data.jobs,result);
        closeDetail();
        if (!result.replacedId) window.scrollTo({top:0,behavior:'auto'});
      } finally {retryingJobs.delete(id);render();}
    } else if (action === 'reuse' || action === 'reuse-batch') {
      const job = data.jobs.find(job => job.id === id);
      if (!job) throw new Error('That request is no longer available.');
      const wholeBatch=action==='reuse-batch' || !job.batchId;
      const request=wholeBatch ? batchFor(job) : { ...job, renderers:renderersFor(job), references:jobReferences(job), requestedCount:1 };
      loadComposer(request);
      toast(wholeBatch ? 'Original batch loaded. Adjust settings, then Generate.' : 'Image brief and reference loaded. Adjust settings, then Generate.');
    }
  } catch(error) { toast(error.message,true); }
}
function loadComposer(request) {
  if (submitting) throw new Error('Wait for the current request to finish being added to the queue.');
  if (!request) throw new Error('The original request is no longer available.');
  const records=request.references || [];
  if (records.length>20) throw new Error('This request has more than 20 references.');
  const renderers=renderersFor(request);
  $('#prompt').value=request.prompt;
  $('#aspect').value=[...$('#aspect').options].some(option=>option.value===request.aspect) ? request.aspect : 'auto';
  $('#resolution').value=request.resolution || 'auto';
  selectedRenderers=renderers;
  $('#quality').value=request.quality || 'high';
  $('#thinking').value=request.thinking || 'minimal';
  $('#background').value=request.background || 'auto';
  $('#count').value=String(request.requestedCount ?? 0);
  // Restore the exact set, rather than mixing it with the current draft's images.
  for (const reference of references) if (reference.preview?.startsWith('blob:')) URL.revokeObjectURL(reference.preview);
  references=records.map(record=>({key:crypto.randomUUID(),record,preview:record.thumbnail || record.url}));
  renderAttachments(); resizePrompt(); saveDraft(); closeDetail(); $('#prompt').focus();
}

function batchMarkup(job) {
  const batch=batchFor(job);
  if (!batch) return '';
  const records=batch.references;
  return `<section class="original-batch"><h3>Original batch${records.length ? ` · ${records.length} reference${records.length===1?'':'s'}` : ''}</h3>
    <div class="batch-reference-grid">${records.map((record,index)=>`<button type="button" class="reference-thumbnail" data-action="view-reference" data-id="${job.id}" data-reference-id="${escape(record.id)}" aria-label="View original batch reference ${index+1}: ${escape(record.name || 'Reference image')}" title="${escape(record.name || `Reference ${index+1}`)}"><img src="${escape(record.thumbnail || record.url)}" alt="${escape(record.name || `Reference ${index+1}`)}" draggable="false"></button>`).join('')}</div>
    <p class="detail-prompt">${escape(batch.prompt)}</p>
    <button type="button" class="secondary-button batch-load" data-action="reuse-batch" data-id="${job.id}">${icon('layers')} Load original batch</button>
    <p class="export-note">Loads the prompt, ${records.length ? `all ${records.length} reference${records.length===1?'':'s'}, ` : ''}models and settings into the composer.</p>
    ${batch.recovered ? '<p class="batch-recovered" title="Recovered from all saved jobs in this batch. References unused by every job and the original upload order were not recorded. The image count uses the completed plan because the original Auto/count selection was not saved.">Recovered from saved batch history.</p>' : ''}</section>`;
}

function referenceMarkup(job) {
  const records=jobReferences(job);
  if (!records.length) return '';
  return `<h3>${job.batchId ? 'Used for this image' : 'References'} · ${records.length}</h3><div class="detail-references">${records.map((record,index)=>`
    <div class="reference-row">
      <button type="button" class="reference-thumbnail" data-action="view-reference" data-id="${job.id}" data-reference-id="${escape(record.id)}" aria-label="View reference ${index+1}: ${escape(record.name || 'Reference image')}" title="View full-size reference">
        <img src="${escape(record.thumbnail || record.url)}" alt="${escape(record.name || 'Reference image')}" draggable="false">
      </button>
      <div class="reference-row-info"><button type="button" class="reference-name" data-action="view-reference" data-id="${job.id}" data-reference-id="${escape(record.id)}">${escape(record.name || `Reference ${index+1}`)}</button>
        <span>${record.width && record.height ? `${record.width} × ${record.height}` : 'Original reference'}</span>
        <button type="button" class="reference-add" data-action="attach-reference" data-id="${job.id}" data-reference-id="${escape(record.id)}">${icon('image-plus')} Add to chat</button>
      </div>
    </div>`).join('')}</div>`;
}
function openReference(record) {
  previewReference=record;
  $('#reference-preview-title').textContent=record.name || 'Reference image';
  $('#reference-preview-meta').textContent=record.width && record.height ? `${record.width} × ${record.height} · Original reference` : 'Original reference';
  $('#reference-preview-image').src=record.url;
  $('#reference-preview-image').alt=record.name || 'Full-size reference image';
  $('#reference-original-link').href=record.url;
  $('#reference-download').href=record.url+'?download=1';
  if (!$('#reference-dialog').open) $('#reference-dialog').showModal();
}
function closeReference() { $('#reference-dialog').close(); }
function addReferenceToChat(record) {
  if (!record) { toast('Choose a reference first.',true); return; }
  const alreadyAdded=references.some(ref=>ref.record?.id===record.id);
  if (!alreadyAdded && references.length >= 20) { closeDetail(); $('#prompt').focus(); toast('You already have 20 references. Remove one before adding another.',true); return; }
  if (!alreadyAdded) references.push({key:record.id,record,preview:record.thumbnail || record.url});
  renderAttachments(); saveDraft(); closeDetail(); $('#prompt').focus();
  toast(alreadyAdded ? 'This reference is already in your chat.' : 'Original reference added to your chat.');
}
function referencePlanMarkup(job, open) {
  if (!job.referenceAnalysis?.length && !job.intent) return '';
  const list=items=>`<ul>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  return `<details class="reference-analysis export-note" ${open?'open':''}><summary>Reference analysis & variation</summary>
    ${job.intent?`<p>${escape(job.intent.description)}</p>`:''}
    ${(job.referenceAnalysis || []).map((analysis,index)=>`<h3>What it saw${job.referenceAnalysis.length>1?` · Reference ${index+1}`:''}</h3><p>${escape(analysis.subject)}</p>${list(analysis.distinctiveFeatures)}${analysis.visualStyle?`<p>${escape(analysis.visualStyle)}</p>`:''}${analysis.uncertainties?`<p>Uncertain: ${escape(analysis.uncertainties)}</p>`:''}`).join('')}
    ${job.preserve?.length?`<h3>What stays</h3>${list(job.preserve)}`:''}
    ${job.changes?.length?`<h3>What changes</h3>${list(job.changes)}`:''}
    ${job.photography?`<h3>Shot specification</h3>${list(Object.entries(job.photography).map(([field,value])=>`${field}: ${value}`))}`:''}
  </details>`;
}
function renderDetail() {
  const job = data.jobs.find(job => job.id === detailId);
  if (!job) return;
  const image = $('#detail-image');
  const signature = JSON.stringify([job.status,job.stage,job.output,job.error,job.supersededBy,job.deletedAt,retryingJobs.has(job.id)]);
  if (image.dataset.signature !== signature) {
    image.dataset.signature = signature;
    image.innerHTML = job.output ? `<img src="${job.output.url}" alt="${escape(job.prompt)}">` : `${job.reference ? `<img src="${job.reference.url}" alt="Reference image" style="opacity:.22;position:absolute"><span class="reference-label">REFERENCE · WAITING FOR OUTPUT</span>` : ''}${pendingMarkup(job)}`;
  }
  $('#detail-status').textContent = job.deletedAt ? 'Deleted from library' : job.stage;
  const scrollTop = $('.detail-info').scrollTop;
  const analysisOpen=$('.reference-analysis')?.open || false;
  // Render into a detached container and swap it in only when the markup
  // actually changed. State pushes arrive several times a second while other
  // jobs plan or generate; rebuilding the panel on each one replaced its
  // buttons between mousedown and mouseup, so clicks were silently lost.
  const content = document.createElement('div');
  content.innerHTML = `<h3>${job.batchId ? 'Image brief' : 'Original request'}</h3><p class="detail-prompt">${escape(job.prompt)}</p><div class="detail-properties"><span>${job.aspect === 'auto' ? 'Auto ratio' : escape(job.aspect)}</span><span>${job.resolution === 'auto' ? (isPaid(job) ? modelFor(job).provider==='openai'?'Standard size':'1K native' : 'Original size') : job.resolution.toUpperCase()}</span>${job.output ? `<span>${job.output.width} × ${job.output.height}</span>` : ''}</div>${job.output?.resized ? `<p class="export-note">Export resized from ${job.output.sourceWidth} × ${job.output.sourceHeight}${job.output.cropped ? ', with edges cropped to your selected ratio' : ''}. This is a local resize, not an AI upscale.</p>` : ''}${referenceMarkup(job)}<div class="detail-buttons">${job.output ? `<a class="secondary-button primary-link" href="${job.output.url}?download=1" download>${icon('download')} Download image</a><a class="secondary-button" href="${job.output.originalUrl}?download=1" download>Download original output</a><button class="secondary-button" data-action="reference" data-id="${job.id}">Use generated image as reference</button>` : ''}${job.deletedAt ? `<button class="secondary-button" data-action="restore" data-id="${job.id}">Restore card</button>` : job.supersededBy ? `<button class="secondary-button" data-action="view-latest" data-id="${job.id}">View latest attempt</button>` : retryingJobs.has(job.id) ? '<button class="secondary-button" disabled>Starting retry…</button>' : activeStatuses.has(job.status) || job.status==='queued' ? `<button class="secondary-button" data-action="cancel" data-id="${job.id}">Cancel generation</button>` : retryableStatuses.has(job.status) || (job.status === 'completed' && job.output) ? `<button class="secondary-button" data-action="retry" data-id="${job.id}">${escape(retryLabel(job))}</button>` : ''}<button class="secondary-button" data-action="reuse" data-id="${job.id}">${job.batchId ? 'Edit this image request' : 'Load original batch'}</button></div><h3>Activity</h3><ul class="activity-list"><li><time>${new Date(job.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>Added to your queue.</li>${job.activity.map(entry => `<li><time>${new Date(entry.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>${escape(entry.message)}</li>`).join('')}</ul>`;
  const billing = document.createElement('section');
  billing.className = 'billing-detail';
  billing.innerHTML = `<p class="export-note">${escape(formatDescription(job))}${isPaid(job) ? ` · Image output ${quoteLabel(job.quotedOutput || estimateOutput(job))} / image, plus input${modelFor(job).provider==='gemini'?' and thinking':''}.` : ''}</p><h3>${escape(modelName(job))} · ${isPaid(job) ? modelFor(job).providerLabel+' · Paid API' : 'Codex subscription'}</h3><p class="export-note">${job.kind === 'plan' ? 'Batch planning uses your Codex subscription. Images will use the selected renderer.' : job.billing ? escape(costLabel(job.billing)) + ' · Estimated USD for this request.' : isPaid(job) ? 'API usage will be recorded when generation starts.' : 'Uses your subscription allowance.'}</p>${job.billing ? `<p class="export-note">Native request: ${escape(job.billing.nativeSize)} · ${escape(job.billing.nativeRatio)}. ${job.billing.inputTokens != null ? `Tokens: ${job.billing.inputTokens} input, ${job.billing.imageTokens} image, ${modelFor(job).provider==='openai' ? `${job.billing.textInputTokens ?? 'unknown'} text input, ${job.billing.imageInputTokens ?? 'unknown'} image input` : `${job.billing.textTokens ?? 'unknown'} text output, ${job.billing.thoughtTokens ?? 'unknown'} thinking`}.` : ''} Rate date: ${escape(job.billing.priceDate)}.</p>` : ''}`;
  if (job.kind==='plan') {
    billing.innerHTML=`<h3>Selected models</h3>${renderersFor(job).map(renderer=>{
      const output={...job,renderer};
      return `<p class="export-note"><strong>${escape(MODELS[renderer].label)} · ${MODELS[renderer].billing}</strong><br>${escape(formatDescription(output))}${isPaid(output)?` · Output ${quoteLabel(estimateOutput(output))} / image + inputs${MODELS[renderer].provider==='gemini'?' & thinking':''}`:''}</p>`;
    }).join('')}<p class="export-note">Codex plans the concepts once through your subscription. Every selected model receives each concept's identical brief and references. ${job.requestedCount?`${job.requestedCount} images requested per model.`:'Image count is determined during planning.'}</p>`;
  }
  content.prepend(billing);
  if (job.batchId) {
    $('#detail-status').textContent = `${job.deletedAt ? 'Deleted from library' : job.stage} · ${job.index} of ${job.total}`;
    const brief = document.createElement('section');
    brief.innerHTML = `${batchMarkup(job)}<h3>Understood as</h3><p class="export-note">${escape(job.planSummary)}</p>${referencePlanMarkup(job,analysisOpen)}${job.batchQuotedOutput && job.batchQuotedOutput.maxUsd>0 ? `<p class="export-note">Planned batch: ${job.batchQuotedOutput.count} images · output ${quoteLabel(job.batchQuotedOutput)} USD, plus inputs and any thinking charges.</p>` : ''}<h3>${escape(job.title)} · ${job.conceptIndex?`Concept ${job.conceptIndex} of ${job.conceptTotal}`:`Image ${job.index} of ${job.total}`}</h3>`;
    content.prepend(brief);
  }
  if ($('#detail-content').innerHTML !== content.innerHTML) {
    $('#detail-content').replaceChildren(...content.childNodes);
    $('.detail-info').scrollTop = scrollTop;
  }
}
function openDetail(id) { detailId = id; $('#detail-image').dataset.signature=''; renderDetail(); $('#detail-dialog').showModal(); }
function closeDetail() { closeReference(); detailId = null; $('#detail-dialog').close(); }
function settings(open) { $('#settings').hidden = !open; $('#settings-toggle').setAttribute('aria-expanded',String(open)); }

async function connectAction() {
  if (data.connection.status === 'connected') { settings(true); return; }
  if (data.connection.status === 'signed-out') {
    const tab = window.open('about:blank','codex-signin');
    if (tab) tab.opener = null;
    try { const result = await api('/api/login',{}); if(tab) tab.location.href=result.url; else toast('Allow pop-ups for this local app, then click Connect Codex again.',true); }
    catch(error) { tab?.close(); toast(error.message,true); }
  } else {
    try { data.connection = await api('/api/reconnect',{}); render(); if(data.connection.status==='unavailable') toast(data.connection.message,true); }
    catch(error) { toast(error.message,true); }
  }
}
async function load() {
  try {
    const initial = await api('/api/state'); token=initial.token; data=initial; render();
    events?.close();
    events=new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    events.addEventListener('state',event=>{data=JSON.parse(event.data);render();});
    events.onerror=()=>{
      events.close(); data.connection={status:'unavailable',message:'The local server disconnected. Reconnecting…'};render();
      clearTimeout(reconnectTimer);reconnectTimer=setTimeout(load,2500);
    };
  } catch(error) {
    data.connection={status:'unavailable',message:'The local server is unavailable. Start Image Studio, then reload this page.'};render();
    clearTimeout(reconnectTimer);reconnectTimer=setTimeout(load,4000);
  }
}

$('#composer').addEventListener('submit',submit);
$('#prompt').addEventListener('input',()=>{resizePrompt();renderSubmit();saveDraft();});
$('#prompt').addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();void submit();}});
$('#model-options').addEventListener('click',event=>{
  const button=event.target.closest('[data-renderer]'); if(!button) return;
  const renderer=button.dataset.renderer;
  const selection=new Set(selectedRenderers);
  if(selection.has(renderer)) selection.delete(renderer); else selection.add(renderer);
  selectedRenderers=Object.keys(MODELS).filter(id=>selection.has(id));
  saveDraft();renderSubmit();
});
for(const name of optionNames) $('#'+name).addEventListener('change',()=>{saveDraft();renderSubmit();});
for(const name of ['upload-button','empty-upload']) $('#'+name).addEventListener('click',()=>$('#file-input').click());
$('#file-input').addEventListener('change',event=>{void addFiles(event.target.files);event.target.value='';});
$('#attachments').addEventListener('click',event=>{
  const remove=event.target.closest('[data-remove]');
  if(remove){const ref=references.find(ref=>ref.key===remove.dataset.remove);if(ref?.preview.startsWith('blob:'))URL.revokeObjectURL(ref.preview);references=references.filter(ref=>ref.key!==remove.dataset.remove);renderAttachments();saveDraft();}
  if(event.target.closest('#attachment-add'))$('#file-input').click();
});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(item=>item.classList.toggle('active',item===button));render();}));
$('#density').addEventListener('input',event=>{document.documentElement.style.setProperty('--columns',event.target.value);try{localStorage.setItem('image-studio-columns',event.target.value);}catch{}});
$('#gallery').addEventListener('click',event=>{
  if(Date.now()<suppressCardClickUntil){event.preventDefault();return;}
  if(event.target.closest('a'))return;
  const action=event.target.closest('[data-action]');if(action){void perform(action.dataset.action,action.dataset.id);return;}
  const card=event.target.closest('.image-card');if(card)openDetail(card.dataset.id);
});
$('#gallery').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.classList.contains('image-card')){event.preventDefault();openDetail(event.target.dataset.id);}});
$('#detail-dialog').addEventListener('click',event=>{const action=event.target.closest('[data-action]');if(action)void perform(action.dataset.action,action.dataset.id,action.dataset.referenceId);if(event.target===$('#detail-dialog'))closeDetail();});
$('#detail-dialog').addEventListener('close',()=>{detailId=null;closeReference();});
$('#detail-close').addEventListener('click',closeDetail);
$('#reference-preview-close').addEventListener('click',closeReference);
$('#reference-add-to-chat').addEventListener('click',()=>addReferenceToChat(previewReference));
$('#reference-dialog').addEventListener('click',event=>{if(event.target===$('#reference-dialog'))closeReference();});
$('#reference-dialog').addEventListener('close',()=>{previewReference=null;$('#reference-preview-image').removeAttribute('src');});
$('#settings-toggle').addEventListener('click',()=>settings($('#settings').hidden));
$('#settings-close').addEventListener('click',()=>settings(false));
$('#spend-button').addEventListener('click',()=>{settings(true);$('#spending-panel').scrollIntoView({block:'nearest'});});
$('#spending-history').addEventListener('click',event=>{const row=event.target.closest('[data-cost-job]');if(row){settings(false);openDetail(row.dataset.costJob);}});
for (const provider of ['gemini','openai']) {
  const input=$('#'+provider+'-key'), button=$('#save-'+provider+'-key'), errorNote=$('#'+provider+'-key-error');
  input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');errorNote.hidden=true;});
  $('#'+provider+'-key-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if (button.disabled) return;
    const key=input.value;
    button.disabled=true; input.disabled=true; errorNote.hidden=true; input.removeAttribute('aria-invalid');
    try {
      const result=await api('/api/'+provider+'-key',{key});
      input.value='';
      data.providers={...data.providers,[provider]:result};render();
      toast(`${provider==='gemini'?'Google':'OpenAI'} key saved locally. No generation was started.`);
    } catch(error) {
      // Keep a rejected paste masked in this field so the user can correct it.
      // It is never copied to draft storage, toasts, or logs.
      input.setAttribute('aria-invalid','true');errorNote.textContent=error.message;errorNote.hidden=false;
      toast(error.message,true);
    } finally {button.disabled=false;input.disabled=false;}
  });
  $('#remove-'+provider+'-key').addEventListener('click',async()=>{
    try {
      const result=await api('/api/'+provider+'-key',{remove:true});
      input.value='';errorNote.hidden=true;input.removeAttribute('aria-invalid');
      data.providers={...data.providers,[provider]:result};render();toast('API key removed.');
    } catch(error){toast(error.message,true);}
  });
}
document.addEventListener('click',event=>{if(!event.target.closest('#settings,#settings-toggle,#connection-button,#spend-button'))settings(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape')settings(false);});
$('#concurrency').addEventListener('change',async event=>{try{const result=await api('/api/settings',{concurrency:Number(event.target.value)});data.concurrency=result.concurrency;render();}catch(error){toast(error.message,true);}});
$('#connection-button').addEventListener('click',connectAction);
$('#reconnect').addEventListener('click',async()=>{try{data.connection=await api('/api/reconnect',{});render();toast(data.connection.message,data.connection.status!=='connected');}catch(error){toast(error.message,true);}});
let dragDepth=0;
const isImageDrag = event => event.dataTransfer?.types.includes(imageDragType);
function clearDrag() {
  if(draggingImageId) suppressCardClickUntil=Date.now()+250;
  draggingImageId=null; dragDepth=0;
  $('#drop-overlay').hidden=true;
  $('#composer').classList.remove('drop-ready','drag-over');
  document.querySelectorAll('.image-card.dragging').forEach(card=>card.classList.remove('dragging'));
  renderSubmit();
}
$('#gallery').addEventListener('dragstart',event=>{
  const card=event.target.closest('.image-card');
  const job=data.jobs.find(job=>job.id===card?.dataset.id);
  if(!job?.output || event.target.closest('button,a')){event.preventDefault();return;}
  draggingImageId=job.id;
  event.dataTransfer.setData(imageDragType,job.id);
  event.dataTransfer.setData('text/uri-list',new URL(job.output.url,location.href).href);
  event.dataTransfer.effectAllowed='copy';
  const image=card.querySelector('.card-image');
  if(image?.complete && image.naturalWidth) event.dataTransfer.setDragImage(image,image.clientWidth/2,image.clientHeight/2);
  window.getSelection()?.removeAllRanges();
  card.classList.add('dragging');
  $('#composer').classList.add('drop-ready');
  renderSubmit();
});
document.addEventListener('dragenter',event=>{
  if(isImageDrag(event)){event.preventDefault();$('#composer').classList.add('drop-ready');}
  else if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;$('#drop-overlay').hidden=false;}
});
document.addEventListener('dragover',event=>{
  if(isImageDrag(event)){
    event.preventDefault();
    const overComposer=Boolean(event.target.closest('#composer'));
    event.dataTransfer.dropEffect=overComposer?'copy':'none';
    $('#composer').classList.toggle('drag-over',overComposer);
  } else if(event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.addEventListener('dragleave',event=>{
  if(isImageDrag(event)){
    if(!event.relatedTarget || !$('#composer').contains(event.relatedTarget)) $('#composer').classList.remove('drag-over');
  } else if(event.dataTransfer?.types.includes('Files')){
    dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('#drop-overlay').hidden=true;
  }
});
document.addEventListener('drop',event=>{
  event.preventDefault();
  const jobId=isImageDrag(event)?event.dataTransfer.getData(imageDragType):null;
  const overComposer=Boolean(event.target.closest('#composer'));
  clearDrag();
  if(jobId){
    if(overComposer && data.jobs.some(job=>job.id===jobId && job.output)) void perform('reference',jobId);
  } else if(event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files);
});
document.addEventListener('dragend',clearDrag);
window.addEventListener('blur',clearDrag);
document.addEventListener('paste',event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();void addFiles(files);}});
setInterval(()=>{document.querySelectorAll('[data-elapsed]').forEach(node=>{const job=data.jobs.find(job=>job.id===node.dataset.elapsed);if(job)node.textContent=progressTime(job);});},1000);

// Progressive enhancement for browsers that expose WebMCP. Uses the same composer.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  for(const tool of [
    {name:'list_image_jobs',description:'List local image jobs and their actual generation status.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({jobs:data.jobs.map(({id,status,prompt,output})=>({id,status,prompt,output}))})},
    {name:'stage_image_prompt',description:'Put a prompt in the visible composer without starting a generation.',inputSchema:{type:'object',properties:{prompt:{type:'string',minLength:1,maxLength:10000}},required:['prompt'],additionalProperties:false},execute:input=>{if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>10000)throw new Error('A prompt of 1–10,000 characters is required.');$('#prompt').value=input.prompt;resizePrompt();renderSubmit();saveDraft();return{staged:true};}},
  ]){try{void Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
}
// Keep the last grid row clear of the composer as references/models change its height.
new ResizeObserver(entries=>document.documentElement.style.setProperty('--composer-space',`${Math.ceil(entries[0].borderBoxSize?.[0]?.blockSize || entries[0].target.getBoundingClientRect().height)+44}px`)).observe($('.composer-dock'));
restoreDraft();void load();
