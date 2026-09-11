import { renderersFor, settingsForModels } from './model-config.js';

const referencesFor = job => job.references || (job.reference ? [job.reference] : []);

// Keep the submitted request independently of the temporary planning card.
// Image jobs still carry only the references assigned to that particular image.
export function captureBatch(plan) {
  return {
    id: plan.id, prompt: plan.prompt, createdAt: plan.createdAt,
    references: referencesFor(plan).map(reference => ({ ...reference })),
    renderers: renderersFor(plan), ...settingsForModels(plan),
    aspect: plan.aspect, resolution: plan.resolution,
    requestedCount: plan.requestedCount ?? 0, recovered: false,
  };
}

export function originalBatch(jobs, batches, job) {
  if (!job) return null;
  const id = job.batchId || job.id;
  if (batches?.[id]) return batches[id];
  const parent = job.batchId ? jobs.find(candidate => candidate.id === id) : job;
  if (parent) return captureBatch(parent);

  // Older versions discarded the planning card. Recover only from this batch,
  // including deleted/superseded attempts, never from similarly worded prompts.
  const siblings = jobs.filter(candidate => candidate.batchId === id).sort((a, b) =>
    (a.conceptIndex || a.index || 0) - (b.conceptIndex || b.index || 0) || a.createdAt - b.createdAt);
  const first = siblings[0];
  if (!first) return null;
  const references = [], seen = new Set();
  for (const sibling of siblings) for (const reference of referencesFor(sibling)) {
    if (seen.has(reference.id)) continue;
    seen.add(reference.id); references.push({ ...reference });
  }
  const renderers = first.comparisonRenderers || [...new Set(siblings.map(sibling => sibling.renderer || 'codex'))];
  const settings = first.comparisonSettings || first;
  const inferredCount = first.conceptTotal || Math.ceil(Math.max(...siblings.map(sibling => sibling.total || sibling.index || 1)) / renderers.length);
  return {
    id, prompt: first.requestPrompt ?? first.prompt, createdAt: first.createdAt,
    references, renderers, ...settingsForModels({ ...settings, renderers }),
    aspect: first.aspect, resolution: first.resolution,
    requestedCount: Math.min(20, inferredCount), recovered: true,
  };
}

export function recoverBatches(jobs, batches = {}) {
  for (const job of jobs) {
    const id = job.batchId || job.id;
    if (!batches[id]) batches[id] = originalBatch(jobs, batches, job);
  }
  return batches;
}
