# Contributing

Install Node.js 22 or newer, run `npm ci`, and use `npm run dev` while making changes. Run `npm test` before submitting a change. GitHub Actions also runs the suite on Node.js 22 and 24 for pushes and pull requests. The current tests stub provider requests and do not need live API keys.

- `server.mjs`: local HTTP server, queue, storage, and credential endpoints.
- `lib/`: planning, Codex connection, and image-provider clients.
- `public/`: browser UI, shared model settings, and history helpers.
- `test/`: regression tests using Node's built-in test runner.
- `docs/USAGE.md`: detailed behavior and model documentation.

Keep credentials, personal prompts, images, and generated history out of commits and issue reports. Use obviously synthetic credentials and mocked requests for tests. Describe the problem, resulting behavior, and validation in a pull request; redact private content in screenshots and logs.

The package remains `private: true` to prevent accidental npm publishing. This does not prevent sharing the source or installing it locally. The package `files` list limits npm archives to source and documentation; update it when adding files that users need.

When adding a provider or changing a model, document its access requirements and pricing date, preserve key redaction, and avoid automatic retries that can trigger unexpected charges.
