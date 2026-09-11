import test from 'node:test';
import assert from 'node:assert/strict';
import { RATIOS, openaiSize, settingsFor, openaiOutputTokens, formatDescription, OPENAI_MAX_EDGE, OPENAI_MAX_PIXELS } from '../public/model-config.js';

const flare = (extra = {}) => ({ renderer: 'gpt-image-2.5-flare', aspect: '16:10', resolution: '4k', ...extra });

test('4K GPT canvases are capped at OpenAI’s non-experimental limit', () => {
  assert.deepEqual(openaiSize(flare({ aspect: '16:9' })), { width: 2560, height: 1440, size: '2560x1440' });
  assert.deepEqual(openaiSize(flare()), { width: 2304, height: 1440, size: '2304x1440' });
  assert.deepEqual(openaiSize(flare({ aspect: '1:1' })), { width: 1920, height: 1920, size: '1920x1920' });
  assert.match(formatDescription(flare()), /4K capped/);
});

test('every ratio and size tier forms a supported, non-experimental GPT canvas', () => {
  for (const aspect of RATIOS) for (const resolution of ['auto', '2k', '4k']) {
    const { width, height } = openaiSize(flare({ aspect, resolution }));
    const label = `${aspect} at ${resolution}`;
    assert.equal(width % 16, 0, label); assert.equal(height % 16, 0, label);
    assert.ok(width * height >= 655360, `${label} is below OpenAI’s minimum`);
    assert.ok(width * height <= OPENAI_MAX_PIXELS, `${label} is experimental`);
    assert.ok(Math.max(width, height) <= OPENAI_MAX_EDGE, `${label} exceeds the edge limit`);
    assert.ok(width / height >= 1 / 3 && width / height <= 3, label);
  }
});

test('smaller GPT size tiers keep their canvases', () => {
  assert.equal(openaiSize(flare({ resolution: 'auto' })).size, '1536x960');
  assert.equal(openaiSize(flare({ resolution: '2k' })).size, '2048x1280');
  assert.equal(openaiSize(flare({ aspect: 'auto', resolution: 'auto' })).size, '1024x1024');
});

test('GPT quality defaults to high and flags draft tiers', () => {
  assert.equal(settingsFor({ renderer: 'gpt-image-2.5-flare' }).quality, 'high');
  assert.equal(openaiOutputTokens(flare()), openaiOutputTokens(flare({ quality: 'high' })));
  assert.match(formatDescription(flare({ quality: 'medium' })), /Draft detail/);
  assert.doesNotMatch(formatDescription(flare({ quality: 'high' })), /Draft detail/);
});
