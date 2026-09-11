import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// Use the supported Codex protocol. Credentials stay inside Codex.
export class CodexClient extends EventEmitter {
  pending = new Map();
  sequence = 0;
  process = null;
  startup = null;
  lastDiagnostic = '';

  async connect() {
    if (this.startup) return this.startup;
    this.startup = this.open().catch(error => {
      this.close();
      throw error;
    });
    return this.startup;
  }

  async open() {
    const env = { ...process.env };
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL', 'CODEX_THREAD_ID', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete env[key];
    const args = [
      '-c', 'forced_login_method="chatgpt"',
      '-c', 'model_provider="openai"',
      '-c', 'features.image_generation=true',
      '-c', 'features.apps=false',
      '-c', 'features.plugins=false',
      '-c', 'features.hooks=false',
      'app-server', '--listen', 'stdio://',
    ];
    // Pin the protocol runtime with this app, instead of inheriting an older global CLI.
    const command = process.env.CODEX_BIN || process.execPath;
    const cliArgs = process.env.CODEX_BIN ? args : [fileURLToPath(new URL('../node_modules/@openai/codex/bin/codex.js', import.meta.url)), ...args];
    this.process = spawn(command, cliArgs, {
      env, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    const child = this.process;
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { this.lastDiagnostic = (this.lastDiagnostic + chunk).slice(-4000); });
    child.on('error', error => this.disconnected(error.code === 'ENOENT'
      ? new Error('Codex CLI was not found. Install Codex or set CODEX_BIN to its executable path.') : error, child));
    child.on('close', () => this.disconnected(new Error('The local Codex connection closed. Reconnect to continue.'), child));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if ('id' in message && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex request failed.'));
        else pending.resolve(message.result);
      } else if (message.method && 'id' in message) {
        // Image jobs must never hang on an invisible approval or question.
        this.emit('blocked', message);
        if (message.method.endsWith('/requestApproval')) this.send({ id: message.id, result: { decision: 'decline' } });
        else if (message.method === 'item/tool/requestUserInput') this.send({ id: message.id, result: { answers: {} } });
        else this.send({ id: message.id, error: { code: -32601, message: 'This image-only client does not support interactive tool requests.' } });
      } else if (message.method) this.emit('notification', message);
    });
    await this.request('initialize', {
      clientInfo: { name: 'local_image_studio', title: 'Image Studio', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized', params: {} });
  }

  send(message) {
    if (!this.process?.stdin.writable) throw new Error('Codex is not connected.');
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method, params = {}, timeout = 45000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not respond to ${method}. Try reconnecting.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  disconnected(error, child) {
    if (child !== this.process) return;
    this.process = null;
    this.startup = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    this.emit('disconnected', error);
  }

  close() {
    const child = this.process;
    if (child) { child.stdin.end(); child.kill('SIGTERM'); }
    this.disconnected(new Error('Codex connection stopped.'), child);
  }
}
