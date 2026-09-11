import { setTimeout as delay } from 'node:timers/promises';

const ORIGIN = 'https://generativelanguage.googleapis.com';
const fileNamePattern = /^files\/[a-z0-9-]{1,40}$/;

async function fileResponse(response, operation) {
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${operation}: ${result?.error?.message || `Google returned HTTP ${response.status}.`}`);
  if (!result) throw new Error(`${operation}: Google returned an unreadable response.`);
  return result;
}

// Upload the exact stored PNG bytes. Only the transport changes, never pixels.
// Register the created resource before polling so failed processing is cleaned up.
export async function uploadReference(bytes, { key, signal, uploaded }) {
  const timeout = AbortSignal.timeout(120_000);
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  signal.throwIfAborted();
  const start = await fetch(`${ORIGIN}/upload/v1beta/files`, {
    method: 'POST', redirect: 'error', signal,
    headers: {
      'x-goog-api-key': key, 'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': 'image/png',
    },
    body: JSON.stringify({ file: { display_name: 'Image Studio reference' } }),
  });
  if (!start.ok) await fileResponse(start, 'Could not start the reference upload');
  const address = start.headers.get('x-goog-upload-url');
  if (!address) throw new Error('Google did not return a reference upload address.');
  const uploadUrl = new URL(address);
  if (uploadUrl.origin !== ORIGIN || uploadUrl.username || uploadUrl.password) throw new Error('Google returned an unexpected reference upload address.');
  const result = await fileResponse(await fetch(uploadUrl.href, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytes,
  }), 'Could not upload the reference');
  let file = result.file;
  if (!fileNamePattern.test(file?.name || '')) throw new Error('Google did not return a valid reference file.');
  const name = file.name;
  uploaded.push(name);
  while (file.state !== 'ACTIVE') {
    if (file.state === 'FAILED') throw new Error(`Google could not process the reference: ${file.error?.message || 'File processing failed.'}`);
    await delay(1000, undefined, { signal });
    file = await fileResponse(await fetch(`${ORIGIN}/v1beta/${name}`, {
      redirect: 'error', signal, headers: { 'x-goog-api-key': key },
    }), 'Could not prepare the reference');
  }
  if (!file.uri || file.mimeType !== 'image/png') throw new Error('Google did not return a usable PNG reference.');
  return { type: 'image', mime_type: 'image/png', uri: file.uri };
}

// Each generation owns its own uploads, including in parallel batches.
// Cleanup is best-effort, cannot change a generation outcome, and works on abort.
// Google expires any upload left after a crash or failed cleanup within 48 hours.
export async function removeReferences(names, key) {
  await Promise.allSettled(names.map(async name => {
    const response = await fetch(`${ORIGIN}/v1beta/${name}`, {
      method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'x-goog-api-key': key },
    });
    await response.body?.cancel();
  }));
}
