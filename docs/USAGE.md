# Image Studio

A local image grid and floating composer. Codex plans batches through your ChatGPT subscription, then each selected model renders every planned concept with the same brief and references.

## Run

Requires Node.js 22+. The project includes a compatible Codex CLI pinned to 0.153.4.

```sh
cd image-gen-open-source
npm ci
npm run dev
```

Open **http://localhost:4317**. `npm run dev` restarts the server when code changes; `npm start` runs without watching. Restarting interrupts active generations. You can also double-click **Start Image Studio.command** on macOS.

The app checks the CLI's ChatGPT sign-in. Click **Connect Codex** if needed, or run `npx --no-install codex login` in Terminal from the project folder. New batches require the subscription connection for planning, including batches whose images use a paid API.

## Models and payment

Select one or more logo tiles in the composer. Compact icons use Free, Flare, Sunburst, 2, and Pro badges. Hover an icon for the full model name and payment route; Free means no extra API charge beyond your Codex subscription. Selections, prompt, references, and settings survive refresh in this browser; existing single-model drafts are migrated automatically. Selecting a paid API never changes the Codex subscription renderer into an API fallback.

| Renderer | Payment | Size controls | Quality controls |
| --- | --- | --- | --- |
| Codex image tool | Subscription allowance, no additional API charge | Original, 2K/4K export | Automatic native quality and size |
| GPT Image 2.5 Flare | OpenAI API | Standard, up to 2K, up to 2.5K (the 4K setting is capped at OpenAI’s non-experimental 2560 × 1440 limit) | Low, Medium, High (default), Extra High, Max, Auto; automatic/opaque/transparent background |
| GPT Image 2.5 Sunburst | OpenAI API | Standard, up to 2K, up to 2.5K (same cap as Flare) | Same controls as Flare |
| Nano Banana 2 | Google API | Native 1K, 2K, 4K | Automatic image quality; Minimal or High thinking |
| Nano Banana Pro | Google API | Native 1K, 2K, 4K | Automatic image quality and thinking |

The pinned Codex CLI's native tool requests GPT Image 2 with automatic parameters. `CODEX_MODEL` selects the Codex agent, not its image renderer. Image 2.5 is selected explicitly through the new paid OpenAI route.

OpenAI uses `gpt-image-2.5-flare` or `gpt-image-2.5-sunburst`, with one Images API request per assigned image: `/v1/images/generations` for text or multipart `/v1/images/edits` for references. No paid mainline orchestration model is used. Google uses the Interactions API with `store:false` and models `gemini-3.1-flash-image` and `gemini-3-pro-image`. Google output is requested as `image/jpeg`; uploaded references remain `image/png`. Requests above the app’s 20 MB inline threshold automatically upload the original PNG bytes through Google’s Files API and pass their URIs to the image model. Reference dimensions, pixels, transparency, and order are preserved; this path does not resize or recompress references. Each generation owns its uploads, waits for them to become usable, and attempts to delete only those temporary Google files after success, failure, or cancellation. Google automatically expires any remaining uploads after 48 hours. Uploads are free; normal image-generation input/output/thinking charges still apply. The card shows **Uploading references** before **Generating image**. An upload or preparation failure is recorded as not charged, and paid billing becomes pending only immediately before sending the generation request. Local originals and batch reference history remain saved. The returned JPEG is decoded and saved as PNG for this app’s downloads, without further lossy encoding. Converting to PNG does not reverse JPEG compression. No grounding, search, Batch API, partial previews, or automatic retries are used. Concurrent jobs use standard pricing.

Flare is aimed at fast everyday generation; Sunburst emphasizes editing precision. Both GPT Image 2.5 variants have the same published per-token rates. Equivalent size and quality settings show the same output estimate; input usage and actual output usage can still vary. Model logos are local SVG assets from [Simple Icons v14.15.0](https://github.com/simple-icons/simple-icons/tree/14.15.0/icons), distributed under CC0; provider trademarks belong to their owners.

## Comparing models

Select multiple model tiles, then press **Compare**. The count dropdown says **1 image each**, **2 images each**, and so on. This means images **per selected model**: 2 images × 3 models creates 6 output cards. Codex first records the visible subject and distinctive features of each reference, interprets the requested kind of variation, and specifies what each concept preserves and changes. The app validates that this analysis exists before queuing any image jobs. It creates one shared plan, then queues one job per concept per selected model. Cards keep concept order and show the model and concept number so matching versions can be compared. Every renderer receives the original user request alongside its assigned brief and preservation/change notes, with the original request and reference image taking precedence over invented planner details. The same concurrency preference applies to all models; remaining images wait in the queue. All selected paid providers must have a key configured before submitting.

**Photography mode.** The planner decides the medium of every batch. When the request asks for a photo, realism, or something that looks taken by a real person, or when the reference is a photograph and the request recreates, edits, or varies it, Codex writes each brief as a professional photographer would and attaches a shot specification: camera, lens, exposure, light, focus, vantage, and realism cues with the looks to avoid. A photograph plan with no specification at all is rejected, while a partial one is passed through as written. Every renderer receives it alongside the brief, and a card’s plan details show it under **Shot specification**. Other mediums get no camera vocabulary.

The composer keeps one short line showing the combined output estimate and image count. Hover the cost line or a selected model icon for each model's output estimate and actual size/quality behavior. Input and thinking charges are additional. Auto count or a count in the prompt can change the total after planning. Shared ratio and resolution settings apply across the selection; OpenAI quality/background apply only to GPT Image models, and thinking effort applies only to Nano Banana 2. Model settings that are temporarily hidden retain their values.

Retrying a failed image reruns only that model's image and replaces its card. Retrying a failed planning request preserves all selected models. **Load original batch** restores the original prompt, all uploaded references, comparison selection, count, and shared settings into the composer. **Edit this image request** loads only that image’s assigned brief, references, model, and settings with a count of one. The queue reserves up to 20 concepts per model, with at most 100 unfinished image slots across requests.

## API keys

Use **Preferences → OpenAI API key** or **Google AI Studio API key**. Paste keys in the local app, not into a chat or source file. Saving does not send a generation request or verify model access. New Google `AQ.` authorization keys are accepted as opaque credentials and sent via `x-goog-api-key`. The form does not truncate long pastes. Local checks catch empty/incomplete values, unsafe header characters, and obvious provider mix-ups; rejected pastes remain masked in the input for correction.

- [Create an OpenAI key](https://platform.openai.com/api-keys) and [enable API billing](https://platform.openai.com/settings/organization/billing/overview). Direct OpenAI keys use standard pricing without intermediary fees; ChatGPT subscriptions do not include these API charges. Provider promotions may vary, so this is not a claim that no reseller can ever be cheaper.
- [Google AI Studio keys](https://aistudio.google.com/api-keys) use Google project billing.

Keys are stored server-side in `.data/openai-key.json` and `.data/gemini-key.json`, with `0600` file permissions. `.data/` is excluded from Git. Keys are never returned in server snapshots or saved in browser drafts. These are local files protected by permissions, not an encrypted vault. API-key environment variables are stripped from the Codex child process. Each image provider receives only its own key. Finish or cancel that provider's jobs before replacing/removing its key.

## Cost estimates and history

Before generation, the composer always shows an image-output estimate in USD, plus the selected-count estimate when available. An explicit count in the prompt can override the selection; Auto count cannot be priced as a complete batch until planning finishes. Each planned image's details show the planned batch output estimate. Estimates are not spending caps.

**Input charges and Google thinking are additional and cannot be quoted exactly before the response.** The app labels these separately instead of presenting the output price as an all-inclusive price. OpenAI Auto quality shows a Low–Max range. Estimates update for ratio, size, quality, and explicit 1K/2K/4K or ratio requests in the prompt. The composer uses the same parameter and estimate functions as the server.

GPT Image 2.5 output estimates follow OpenAI's public cost calculator, including its quality-dependent grid, round-to-even behavior, and pixel-dependent token formula. Both 2.5 models currently use standard USD rates of $5/M text input tokens, $8/M image input tokens, and $30/M image output tokens. Pricing depends on tokens consumed, not just the model name. Google output estimates use published size-based image token counts.

After a request, the app records returned usage and estimates the full charge at the recorded rates. Preferences shows combined monthly/all-time spending, provider monthly totals, recent requests, and incomplete-usage notices. OpenAI standard input rates are used conservatively; any cached-input discounts are not deducted. Google thinking tokens are counted separately from output tokens. Missing usage, cancellations, timeouts, and interrupted requests are marked unknown or incomplete, never silently treated as free. Retrying is a new paid attempt with its own record. In the library, retrying a failed or cancelled image replaces that card in place. Earlier attempts stay available through spending history. Duplicate requests to retry that same failed attempt return its existing replacement instead of starting another paid job. “Generate again” on a completed image creates a separate image. Existing failed cards with a matching later retry are linked once when the updated server starts.

History covers this app only. Credits, taxes, cached-input discounts, and usage elsewhere are excluded. Provider billing is authoritative: [OpenAI usage](https://platform.openai.com/usage), [Google usage](https://aistudio.google.com/usage). Monthly boundaries follow the server's local timezone.

Rates and parameter documentation were checked **2026-09-09**: [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation), [OpenAI pricing](https://developers.openai.com/api/docs/pricing#image-generation), [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Shared controls and current rates are in `public/model-config.js`; historical billing retains its rate snapshot.

## Sizes and originals

- OpenAI size requests use multiples of 16, ratios between 1:3 and 3:1, and stay within OpenAI’s non-experimental range: 655,360–3,686,400 pixels with at most 2560 pixels on either edge. OpenAI accepts larger canvases up to 8,294,400 pixels but labels them experimental, and in practice they arrive soft and blocky, so the 4K setting is capped. The composer displays the actual requested dimensions. “Up to 4K” at 16:9 is 2560 × 1440; at 16:10 it is 2304 × 1440; square is 1920 × 1920. Auto ratio uses a predictable square canvas; select or prompt a ratio for another composition. PNG is used for all outputs, including transparent images.
- Google requests native 1K/2K/4K. Unsupported ratios, including 16:10, use a nearby supported canvas and a centered cropped export. Original native pixels are preserved, with no local enlargement.
- Codex chooses native dimensions. Its 2K/4K export controls produce a 2048/4096-pixel long edge with a local resize/crop when necessary. This is resampling, not an AI upscale.

Every result keeps the original model output and a downloadable export. The details panel shows original/output dimensions and any crop or resize.

Low and Medium GPT quality are labeled **Draft GPT quality** on the compact cost line, because GPT Image 2.5 quality sets the detail budget independently of canvas size; the default is High. Resolution and quality are separate settings: choosing 4K does not change the quality. For final images, compare higher quality settings; a smaller 2K canvas with High quality is a useful first comparison if a large output has artifacts. Higher quality increases the estimated charge and does not guarantee artifact-free output. The app keeps your explicit settings and never automatically sends a paid regeneration. Planning omits invented export dimensions from image briefs, and OpenAI requests explicitly make the actual API canvas authoritative, including when retrying an older brief.

## Using the studio

Drop or paste up to 20 references into the window (25 MB per uploaded file, up to 60 megapixels). Reusing an image already in the studio bypasses the browser upload-size limit; Nano Banana 2 and Pro automatically use the Files API when the combined inline payload would be too large. Ask for “five new images in the vibe of this moodboard” or “recreate each image.” Codex creates a distinct assigned brief per image, up to 20 concepts per model and up to 5 references per image. Reference text is visual content, not instructions. The request and planning summary remain in image details. Each result shows its assigned references separately from the original batch’s references; either set can be opened and added to the chat. **Load original batch** replaces the current composer contents with the whole request so you can change parameters before generating. It never submits automatically. New batches retain an independent request record in `.data/state.json`, including the original reference order and Auto/count selection. Older batches recover references from every saved sibling job, including deleted cards and earlier retry attempts; references never assigned to any image, original upload order, and original Auto/count selection cannot be recovered from that older history. Older batches restore the planned image count. Individual retries keep their original batch link. New images also have a **Reference analysis & variation** disclosure showing what the planner saw, what stays, what changes, and any uncertain visual details. Variations should preserve the reference’s distinctive visual language instead of reducing it to generic color/mood adjectives. These are model-generated observations and can still need correction; structural validation cannot prove visual accuracy. Text-only creation uses an empty reference analysis. Historical images retain their original briefs; use **Load original batch**, then Generate, to create a fresh plan under these rules. Individual retries preserve the existing plan and variation notes.

Press **Generate** or **⌘ Enter**. Preferences controls 1–4 concurrent jobs (default 3), including planning. Each image runs independently. Paid generate/retry buttons are labeled, with retry output estimates. Drag completed images into the composer to reuse them as references. Hover a card to reveal its trash button (also available with keyboard focus and on touch screens). Deleting removes the card from the library, with a 12-second Undo action. Queued or active jobs are cancelled when deleted; Undo restores the card without starting a new generation. Original files, references, and billing records are retained locally, so spending totals remain intact. Deleted paid attempts can also be restored from their spending-history details. Reusing settings and retrying preserve the model, quality, background, and thinking selection.

Active jobs show real stages and elapsed time with a spinner. Retry appears only after completion/failure/cancellation. Blurred images on unfinished cards are labeled references, not generated previews. Cancellation stops the local request but cannot guarantee cancellation or refunds for remote work already underway. No request is automatically regenerated after a restart.

Prompts, uploads, history, and images stay in `.data/` on your computer. Draft prompts and model settings stay in this browser. Codex sends prompts/references to OpenAI for planning; paid image requests send each assigned brief and references to the chosen provider.

## Optional configuration

```sh
PORT=4318 npm start
CODEX_BIN=/absolute/path/to/codex npm start
CODEX_MODEL=your-supported-codex-model npm start
IMAGE_STUDIO_DATA=/absolute/path/to/storage npm start
```

Node HTTP server, plain HTML/CSS/JavaScript, SSE, and Sharp; no frontend build. The app binds to `127.0.0.1`, checks localhost Host/Origin and a per-process mutation token, and automatically declines interactive Codex approvals. Do not expose it through a public proxy. Authentication and token refresh belong to the Codex CLI.
