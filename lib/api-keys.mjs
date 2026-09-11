// Keys are opaque credentials. Check paste mistakes and header safety locally;
// only the provider can determine whether a key has access and billing enabled.
export function normalizeApiKey(provider, value) {
  const name = provider === 'openai' ? 'OpenAI' : 'Google AI Studio';
  let key = typeof value === 'string' ? value.trim() : '';
  if (key.length >= 2 && ['"', "'", '`'].includes(key[0]) && key.at(-1) === key[0]) key = key.slice(1,-1).trim();
  if (!key) throw new Error(`Paste your ${name} key before saving.`);
  if (/^(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY)\s*=/.test(key)) throw new Error('Paste only the key value, without the environment variable name or assignment.');
  if (provider === 'gemini' && key.startsWith('sk-')) throw new Error('This looks like an OpenAI key. Save it in “OpenAI API key” above for GPT Image 2.5. Nano Banana needs a Google AI Studio key.');
  if (provider === 'openai' && /^(?:AQ\.|AIza)/.test(key)) throw new Error('This looks like a Google key. Save it in “Google AI Studio API key” below for Nano Banana.');
  if (key.length < 20) throw new Error(`This ${name} key looks incomplete. Copy the full key from the provider and paste it again.`);
  if (key.length > 8192) throw new Error('The pasted value is unusually long. Paste only the API key, not a credentials file.');
  if (!/^[\x21-\x7E]+$/.test(key) || /["'`<>]/.test(key)) throw new Error('The pasted key contains spaces, line breaks, quotes, or unsupported characters. Copy the complete key again.');
  if (provider === 'openai' && !key.startsWith('sk-')) throw new Error('OpenAI keys begin with sk-. Use a key from the OpenAI API dashboard.');
  // In particular, do not reject periods or require an AIza prefix. Google AI
  // Studio now issues AQ. authorization keys, which use the same API-key header.
  return key;
}
