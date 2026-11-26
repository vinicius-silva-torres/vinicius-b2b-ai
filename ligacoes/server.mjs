import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { callSummary, leadPatch, classify, queueFrom, resultEntry } from './flow.mjs';
import { GoogleAuth, GoogleSheets, replaceJson, spreadsheetId } from './sheets.mjs';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const demo = process.argv.includes('--demo');
const localFolder = process.env.B2B_LIGACOES_DIR || join(process.env.LOCALAPPDATA || homedir(), 'VWS-Ligacoes');
const configFile = join(localFolder, 'config.json');
const port = Number(process.env.B2B_LIGACOES_PORT || 3842);
const host = '127.0.0.1';
const origin = `http://${host}:${port}`;
const redirect = `${origin}/oauth/callback`;
const sessionToken = randomBytes(32).toString('hex');
let authError = '';
let configurationError = '';
let auth;
let sheets;
let attempt;
let oauth;
let writing = false;
let observing = false;
let cachedSheet;
let loadedAt = 0;
let loading;

function exampleLead(id, name, niche, neighborhood, rating, score, preview, site = 'Sem site') {
  return {
    id, name, niche, neighborhood, rating, score, preview, site,
    phone: `+551190000000${id}`, stage: 'Não contatado', next: '', notes: '', check: '',
  };
}

const demoSheet = {
  leads: [
    exampleLead('1', 'Estúdio Porto Norte', 'Estética automotiva', 'Mooca', '4,9 • 32 avaliações', 93, 'Sim'),
    exampleLead('2', 'Casa Oliva', 'Salão de beleza', 'Santana', '4,8 • 25 avaliações', 87, 'Não'),
    exampleLead('3', 'Sofá Vivo', 'Higienização de estofados', 'Perdizes', '4,7 • 18 avaliações', 82, 'Não'),
    exampleLead('4', 'Estúdio Flor de Anis', 'Estética facial e corporal', 'Mooca', '4,9 • 14 avaliações', 76, 'Não', 'Site a revisar'),
  ],
  history: [],
};

async function setup() {
  if (demo) return;
  await mkdir(localFolder, { recursive: true });
  try {
    const config = JSON.parse((await readFile(configFile, 'utf8')).replace(/^\uFEFF/, ''));
    const id = spreadsheetId(config.planilha);
    const credentialsFile = config.credenciais || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsFile) throw new Error('Informe o arquivo JSON de credenciais em config.json.');
    const credentials = JSON.parse((await readFile(resolve(localFolder, credentialsFile), 'utf8')).replace(/^\uFEFF/, ''));
    auth = new GoogleAuth(credentials, join(localFolder, 'google-token.json'));
    if (auth.mode() === 'unconfigured') throw new Error('Use um JSON de Conta de serviço ou do tipo App para computador.');
    sheets = new GoogleSheets(id, auth);
  } catch (error) {
    configurationError = error.code === 'ENOENT'
      ? 'Crie o config.json e aponte para o JSON do Google. Consulte o README.'
      : error.message;
  }
}

async function sheetData() {
  if (demo) return demoSheet;
  if (!sheets) throw new Error(configurationError);
  if (cachedSheet && Date.now() - loadedAt < 5000) return cachedSheet;
  if (!loading) loading = sheets.snapshot().then(snapshot => {
    cachedSheet = snapshot;
    loadedAt = Date.now();
    return snapshot;
  }).finally(() => { loading = null; });
  return loading;
}

async function currentLead(id) {
  const sheet = await sheetData();
  const lead = sheet.leads.find(item => item.id === id);
  const last = sheet.history.findLast(item => item.leadId === id);
  if (!lead || !['ligar', 'retornos', 'acompanhar'].includes(classify(lead, last))) {
    throw new Error('Este lead não está disponível para ligação.');
  }
  return lead;
}

async function phoneLink(action, number) {
  if (demo || process.platform !== 'win32') throw new Error('A integração Phone Link roda no Windows em modo real.');
  const args = ['-NoProfile', '-NonInteractive', '-STA', '-File', join(root, 'phone-link.ps1'), '-Action', action];
  if (number) args.push('-Number', number);
  let output;
  try {
    const { stdout } = await exec('powershell.exe', args, {
      windowsHide: true, timeout: action === 'prepare' ? 25000 : 8000, maxBuffer: 32768,
    });
    output = JSON.parse(stdout.trim());
  } catch {
    throw new Error('Não consegui acessar a interface do Phone Link pelo PowerShell.');
  }
  if (output.ok === false) throw new Error(output.error);
  return output;
}

function state() {
  return attempt ? {
    phase: attempt.phase, leadId: attempt.leadId, attemptId: attempt.attemptId,
    startedAt: attempt.startedAt, endedAt: attempt.endedAt, detection: attempt.detection,
    message: attempt.message, approach: attempt.approach,
  } : { phase: 'idle' };
}

function review(entry, detection, message = '') {
  entry.phase = 'review';
  entry.detection = detection;
  entry.message = message;
  if (detection !== 'manual') entry.endedAt = new Date().toISOString();
}

async function monitor() {
  const entry = attempt;
  if (writing || observing || !entry || !['dialing', 'active'].includes(entry.phase)) return;
  if (demo) {
    if (Date.now() - entry.requestedAt > 1200 && entry.phase === 'dialing') {
      entry.startedAt = new Date().toISOString();
      entry.phase = 'active';
    }
    if (Date.now() - entry.requestedAt > 4800) review(entry, 'demo');
    return;
  }
  observing = true;
  try {
    const observed = await phoneLink('observe', entry.phone);
    if (attempt !== entry || !['dialing', 'active'].includes(entry.phase)) return;
    if (observed.state === 'call' && (entry.phase === 'active' || observed.matchesNumber || observed.outgoing)) {
      entry.startedAt ??= new Date().toISOString();
      entry.phase = 'active';
      entry.idleReads = 0;
      entry.unknownReads = 0;
    } else if (observed.state === 'idle' && entry.phase === 'active') {
      entry.unknownReads = 0;
      if (++entry.idleReads >= 2) review(entry, 'phone-link');
    } else if (entry.phase === 'active') {
      entry.idleReads = 0;
      if (observed.state === 'disconnected' || ++entry.unknownReads >= 4) {
        review(entry, 'manual', 'O Phone Link perdeu o estado da chamada. Confirme quando terminar.');
      }
    }
    if (entry.phase === 'dialing' && Date.now() - entry.requestedAt > 30000) {
      review(entry, 'manual', 'O Phone Link não confirmou a chamada. Confira o discador antes de registrar.');
    }
  } catch {
    if (attempt === entry && ['active', 'dialing'].includes(entry.phase) && ++entry.unknownReads >= 3) {
      review(entry, 'manual', 'A leitura do Phone Link ficou indisponível. Confirme o resultado manualmente.');
    }
  } finally {
    observing = false;
  }
}

async function action(path, input) {
  if (path === '/api/open') return phoneLink('open');
  if (path === '/api/inspect') return phoneLink('inspect');
  if (path === '/api/prepare' || path === '/api/manual') {
    if (attempt) throw new Error('Finalize ou cancele a tentativa atual antes de avançar.');
    const lead = await currentLead(input.leadId);
    const entry = {
      phase: 'ready', attemptId: randomUUID(), leadId: lead.id, name: lead.name, phone: lead.phone,
      approach: input.approach, idleReads: 0, unknownReads: 0,
    };
    if (path === '/api/manual') review(entry, 'manual', 'Confirme o resultado após encerrar no telefone.');
    else if (!demo) await phoneLink('prepare', lead.phone);
    attempt = entry;
    return state();
  }
  if (!attempt || input.attemptId !== attempt.attemptId) {
    throw new Error('A tentativa mudou. Atualize o painel.');
  }
  if (path === '/api/dial') {
    if (attempt.phase !== 'ready') throw new Error('O número precisa estar preparado para confirmar a ligação.');
    const lead = await currentLead(attempt.leadId);
    if (lead.phone !== attempt.phone) throw new Error('O telefone mudou na planilha. Prepare-o novamente.');
    attempt.phase = 'dialing';
    attempt.requestedAt = Date.now();
    try {
      if (!demo) await phoneLink('dial', attempt.phone);
    } catch (error) {
      review(attempt, 'manual', error.message);
    }
    return state();
  }
  if (path === '/api/review') {
    review(attempt, 'manual', 'Resultado confirmado manualmente.');
    return state();
  }
  if (path === '/api/cancel') {
    if (attempt.phase === 'active') throw new Error('Encerre a chamada antes de cancelar o registro.');
    attempt = null;
    return state();
  }
  if (path === '/api/result') {
    if (attempt.phase !== 'review') throw new Error('Confirme o término da chamada antes de registrar.');
    const entry = resultEntry(attempt, input);
    if (demo) {
      const lead = demoSheet.leads.find(item => item.id === entry.leadId);
      Object.assign(lead, leadPatch(lead, entry));
      demoSheet.history.push(entry);
    } else {
      await sheets.save(entry);
      loadedAt = 0;
    }
    attempt = null;
    return state();
  }
  throw new Error('Ação desconhecida.');
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function payload(req) {
  let raw = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 12000) throw new Error('A solicitação ultrapassou o tamanho permitido.');
  }
  return JSON.parse(raw || '{}');
}

const assets = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.headers.host !== `${host}:${port}`) return json(res, 403, { error: 'Endereço local inválido.' });
  const url = new URL(req.url, origin);
  const path = url.pathname;

  if (req.method === 'GET' && Object.hasOwn(assets, path)) {
    const [file, type] = assets[path];
    const data = await readFile(join(root, 'public', file));
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(data);
    return;
  }
  if (req.method === 'GET' && path === '/api/state') {
    return json(res, 200, {
      ...state(), sessionToken, demo, windows: process.platform === 'win32',
      authMode: auth?.mode(), configurationError, authError,
    });
  }
  if (req.method === 'GET' && path === '/api/leads') {
    const data = await sheetData();
    return json(res, 200, { leads: queueFrom(data), summary: callSummary(data.history) });
  }
  if (req.method === 'GET' && path === '/oauth/start' && auth?.mode() === 'desktop') {
    const verifier = randomBytes(40).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    oauth = { verifier, nonce, expires: Date.now() + 600000 };
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    res.writeHead(302, { Location: auth.authorizationUrl(redirect, nonce, challenge) });
    res.end();
    return;
  }
  if (req.method === 'GET' && path === '/oauth/callback') {
    const valid = oauth && oauth.nonce === url.searchParams.get('state') && oauth.expires >= Date.now();
    if (!valid) return json(res, 400, { error: 'Sessão de autorização inválida ou vencida.' });
    const { verifier } = oauth;
    oauth = null;
    try {
      const code = url.searchParams.get('code');
      if (!code) throw new Error('A autorização do Google foi cancelada.');
      await auth.authorize(code, redirect, verifier);
      authError = '';
    } catch (error) {
      authError = error.message;
    }
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }
  if (req.method === 'POST' && path.startsWith('/api/')) {
    if (req.headers.origin !== origin || req.headers['x-b2b-session'] !== sessionToken) {
      return json(res, 403, { error: 'Abra o painel no endereço local para executar a ação.' });
    }
    if (writing || observing && ['/api/open', '/api/inspect', '/api/prepare', '/api/dial'].includes(path)) {
      return json(res, 409, { error: 'Aguarde a operação em andamento e tente novamente.' });
    }
    writing = true;
    try {
      return json(res, 200, await action(path, await payload(req)));
    } finally {
      writing = false;
    }
  }
  return json(res, 404, { error: 'Página não encontrada.' });
}

await setup();
const server = createServer((req, res) => {
  handle(req, res).catch(error => json(res, 400, {
    error: error instanceof Error ? error.message : 'Não consegui concluir a operação.',
  }));
});
server.listen(port, host, () => {
  console.log(`VWS Ligações · ${demo ? 'demonstração' : 'modo real'} · ${origin}`);
  if (process.platform === 'win32' && !process.argv.includes('--no-browser')) {
    const browser = spawn('explorer.exe', [origin], { detached: true, stdio: 'ignore' });
    browser.on('error', () => {});
    browser.unref();
  }
});
setInterval(() => { void monitor(); }, 1600).unref();
