const failedStatuses = new Set(['failed','cancelled']);
export const libraryJobs = jobs => jobs.filter(job=>!job.supersededBy && !job.deletedAt);

export function latestAttempt(jobs, job) {
  const seen = new Set();
  while (job?.supersededBy) {
    if (seen.has(job.id)) return null;
    seen.add(job.id);
    const id=job.supersededBy;
    // A retried planning card is replaced by its resulting image jobs.
    job=jobs.find(item=>item.id===id) || jobs.find(item=>item.batchId===id && !item.supersededBy) || jobs.find(item=>item.batchId===id);
  }
  return job || null;
}

export function recordRetry(jobs, previous, next) {
  if (previous.supersededBy) throw new Error('This attempt has already been retried.');
  if (!previous.output && failedStatuses.has(previous.status)) {
    const index=jobs.indexOf(previous);
    if (index<0) throw new Error('The previous image is no longer available.');
    previous.supersededBy=next.id;
    next.retryOf=previous.id;
    // Preserve the grid position and retain the paid attempt for accounting.
    jobs.splice(index,0,next);
    return previous.id;
  }
  // Generate again on a completed image creates a separate image in the library.
  next.generatedFrom=previous.id;
  jobs.unshift(next);
  return null;
}

export function applyRetryResult(jobs, result) {
  const previous=jobs.find(job=>job.id===result.replacedId);
  if (previous) previous.supersededBy=result.job.id;
  // SSE can arrive before the POST response. Keep the newer job state and one card.
  if (!jobs.some(job=>job.id===result.job.id)) jobs.splice(previous?jobs.indexOf(previous):0,0,result.job);
}

export function linkLegacyRetries(jobs) {
  const groups=new Map();
  for (const job of jobs) {
    // Old retries inherited the batch ID, image index, exact brief and settings.
    // Only infer links when all of those identifiers agree.
    if (job.kind!=='image' || !job.batchId || !Number.isInteger(job.index)) continue;
    const key=JSON.stringify([job.batchId,job.index,job.prompt,job.renderer || 'codex',job.aspect,job.resolution,
      job.quality || null,job.thinking || null,job.background || null,
      (job.references || (job.reference?[job.reference]:[])).map(ref=>ref.id)]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(job);
  }
  let linked=0;
  for (const group of groups.values()) {
    group.sort((a,b)=>a.createdAt-b.createdAt);
    for (let index=0;index<group.length-1;index++) {
      const previous=group[index],next=group[index+1];
      if (!previous.supersededBy && !previous.output && failedStatuses.has(previous.status) && previous.finishedAt && next.createdAt>=previous.finishedAt && !next.retryOf && !next.generatedFrom) {
        previous.supersededBy=next.id;next.retryOf=previous.id;linked++;
      }
    }
  }
  return linked;
}
