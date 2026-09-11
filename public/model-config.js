// Shared by the server and composer: provider parameters and standard USD estimates.
// Sources: developers.openai.com/api/docs/guides/image-generation#calculate-costs
// and ai.google.dev/gemini-api/docs/pricing. Checked 2026-09-09.
export const PRICE_DATE = '2026-09-09';
const openaiRates = { textInput: 5, cachedTextInput: 1.25, imageInput: 8, cachedImageInput: 2, imageOutput: 30 };
export const MODELS = {
  codex: { label: 'Codex image tool', provider: 'codex', providerLabel: 'Codex', billing: 'Subscription' },
  'gpt-image-2.5-flare': { label: 'GPT Image 2.5 Flare', provider: 'openai', providerLabel: 'OpenAI', billing: 'Paid API', rates: openaiRates },
  'gpt-image-2.5-sunburst': { label: 'GPT Image 2.5 Sunburst', provider: 'openai', providerLabel: 'OpenAI', billing: 'Paid API', rates: openaiRates },
  'gemini-3.1-flash-image': { label: 'Nano Banana 2', provider: 'gemini', providerLabel: 'Google', billing: 'Paid API', input: 0.5, text: 3, image: 60, imageTokens: { '1K': 1120, '2K': 1680, '4K': 2520 } },
  'gemini-3-pro-image': { label: 'Nano Banana Pro', provider: 'gemini', providerLabel: 'Google', billing: 'Paid API', input: 2, text: 12, image: 120, imageTokens: { '1K': 1120, '2K': 1120, '4K': 2000 } },
};
export const RATIOS = ['auto','1:1','16:10','16:9','9:16','4:3','3:2','2:3'];
export const QUALITIES = ['low','medium','high','xhigh','max','auto'];
// OpenAI accepts custom GPT Image canvases up to 8,294,400 pixels but labels
// anything above 2560 × 1440 experimental, and those renders arrive soft and
// blocky. Requests stay inside the supported range; quality sets the detail.
export const OPENAI_MAX_EDGE = 2560;
export const OPENAI_MAX_PIXELS = 2560 * 1440;
export const modelFor = job => MODELS[job.renderer || 'codex'];
export const isPaid = job => modelFor(job)?.billing === 'Paid API';
// Plans can target several renderers; individual image jobs always have just one.
// Accept older saved requests and clients that only supplied `renderer`.
export function renderersFor(input) {
  const values = input.renderers ?? [input.renderer || 'codex'];
  if (!Array.isArray(values) || !values.length || values.length > Object.keys(MODELS).length || values.some(id => typeof id !== 'string' || !Object.hasOwn(MODELS,id))) throw new Error('Select at least one available image model.');
  return [...new Set(values)];
}
export function settingsForModels(input) {
  return Object.assign({}, ...renderersFor(input).map(renderer => settingsFor({...input,renderer})));
}
export function estimateModels(input) {
  const quotes = renderersFor(input).map(renderer => estimateOutput({...input,renderer}));
  return { minUsd:quotes.reduce((sum,quote)=>sum+quote.minUsd,0), maxUsd:quotes.reduce((sum,quote)=>sum+quote.maxUsd,0), priceDate:PRICE_DATE };
}
export const imageSize = job => job.resolution === '4k' ? '4K' : job.resolution === '2k' ? '2K' : '1K';
export function resolveFormat(prompt, aspect = 'auto', resolution = 'auto') {
  if (!RATIOS.includes(aspect) || !['auto','2k','4k'].includes(resolution)) throw new Error('Choose a supported aspect ratio and output size.');
  const ratio = prompt.match(/\b(\d{1,2})\s*(?::|by|×|x)\s*(\d{1,2})\b/i);
  if (ratio && +ratio[1] > 0 && +ratio[2] > 0 && +ratio[1]/+ratio[2] >= .2 && +ratio[1]/+ratio[2] <= 5) aspect = `${+ratio[1]}:${+ratio[2]}`;
  if (/\b4\s*k\b/i.test(prompt)) resolution = '4k';
  else if (/\b2\s*k\b/i.test(prompt)) resolution = '2k';
  else if (/\b1\s*k\b/i.test(prompt)) resolution = 'auto';
  return { aspect, resolution };
}
export function settingsFor(input) {
  const model = modelFor(input);
  if (!model) throw new Error('Choose an available image model.');
  if (model.provider === 'openai') {
    const quality = input.quality || 'high', background = input.background || 'auto';
    if (!QUALITIES.includes(quality) || !['auto','opaque','transparent'].includes(background)) throw new Error('Choose an available OpenAI quality and background.');
    return { quality, background };
  }
  if (input.renderer === 'gemini-3.1-flash-image') {
    const thinking = input.thinking || 'minimal';
    if (!['minimal','high'].includes(thinking)) throw new Error('Choose Minimal or High thinking.');
    return { thinking };
  }
  return {};
}
const numericRatio = aspect => aspect.split(':').map(Number).reduce((a,b) => a/b);
export function nativeRatio(job) {
  if (job.aspect === 'auto') return undefined;
  const supported = ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9'];
  if (job.renderer === 'gemini-3.1-flash-image') supported.push('1:4','4:1','1:8','8:1');
  return supported.reduce((best, value) => Math.abs(Math.log(numericRatio(value)/numericRatio(job.aspect))) < Math.abs(Math.log(numericRatio(best)/numericRatio(job.aspect))) ? value : best);
}
export function openaiSize(job) {
  // Auto ratio is deliberately a known square canvas; selecting a ratio or asking
  // for one in the prompt chooses another canvas. Quotes and requests stay identical.
  const aspect = job.aspect === 'auto' ? '1:1' : job.aspect;
  const ratio = numericRatio(aspect);
  if (!Number.isFinite(ratio) || ratio < 1/3 || ratio > 3) throw new Error('GPT Image 2.5 supports ratios between 1:3 and 3:1.');
  let [a,b] = aspect.split(':').map(Number);
  const gcd = (x,y) => y ? gcd(y,x%y) : x;
  const divisor = gcd(a,b); a /= divisor; b /= divisor;
  // 4K is capped at OpenAI's non-experimental limit; see OPENAI_MAX_PIXELS.
  const target = job.resolution === '4k' ? OPENAI_MAX_EDGE : job.resolution === '2k' ? 2048 : ratio === 1 ? 1024 : 1536;
  const step = Math.floor(Math.min(target/(16*Math.max(a,b)), Math.sqrt(OPENAI_MAX_PIXELS/(256*a*b))));
  let width = a*16*step, height = b*16*step;
  // Unusual prompt ratios may need the nearest 16-pixel grid instead.
  if (!step || width*height < 655360) {
    const long = Math.min(target, Math.sqrt(OPENAI_MAX_PIXELS * Math.max(ratio,1/ratio)));
    width = Math.floor((ratio >= 1 ? long : long*ratio)/16)*16;
    height = Math.floor((ratio >= 1 ? long/ratio : long)/16)*16;
  }
  if (width < 16 || height < 16 || width*height < 655360 || width*height > OPENAI_MAX_PIXELS || Math.max(width,height)>OPENAI_MAX_EDGE || width/height < 1/3 || width/height > 3) throw new Error('This ratio and size cannot form a supported GPT Image 2.5 canvas.');
  return { width, height, size: `${width}x${height}` };
}
function roundEven(value) {
  const floor = Math.floor(value);
  return Math.abs(value-floor-.5) < 1e-10 ? floor + floor%2 : Math.round(value);
}
export function openaiOutputTokens(job, quality = job.quality || 'high') {
  const { width, height } = openaiSize(job);
  const grid = { low:16, medium:24, high:48, xhigh:64, max:96 }[quality];
  if (!grid) throw new Error('Auto quality needs a range estimate.');
  // GPT Image 2.5 formula from OpenAI's public image output cost calculator.
  return Math.ceil(grid * roundEven(grid / Math.max(width/height,height/width)) * (2_000_000+width*height)/4_000_000);
}
export function estimateOutput(job) {
  const model = modelFor(job);
  if (!isPaid(job)) return { minUsd: 0, maxUsd: 0, priceDate: PRICE_DATE };
  if (model.provider === 'gemini') {
    const usd = model.imageTokens[imageSize(job)]*model.image/1e6;
    return { minUsd: usd, maxUsd: usd, priceDate: PRICE_DATE };
  }
  const quality = job.quality || 'high';
  return { minUsd: openaiOutputTokens(job, quality === 'auto' ? 'low' : quality)*model.rates.imageOutput/1e6,
    maxUsd: openaiOutputTokens(job, quality === 'auto' ? 'max' : quality)*model.rates.imageOutput/1e6, priceDate: PRICE_DATE };
}
export function formatDescription(job) {
  const provider = modelFor(job)?.provider;
  if (provider === 'openai') {
    const size = openaiSize(job);
    const quality = job.quality || 'high';
    return `${size.width} × ${size.height} native · ${quality} quality${job.aspect === 'auto' ? ' · Auto ratio uses square' : ''}${job.resolution === '4k' ? ' · 4K capped at OpenAI’s non-experimental limit' : ''}${['low','medium'].includes(quality) ? ' · Draft detail, use High or above for finals' : ''}`;
  }
  if (provider === 'gemini') return `${imageSize(job)} native${job.aspect === 'auto' ? ' · Auto ratio' : nativeRatio(job) === job.aspect ? ` · ${job.aspect}` : ` · ${nativeRatio(job)} canvas cropped to ${job.aspect}`}${job.renderer === 'gemini-3.1-flash-image' ? ` · ${job.thinking || 'minimal'} thinking` : ' · Automatic thinking'}`;
  return `Native size and quality automatic${job.resolution === 'auto' ? ' · Original size' : ` · ${job.resolution === '4k' ? '4096' : '2048'} px export, resized locally if needed`}`;
}
