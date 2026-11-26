import { createSign } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { LEAD_TAB, HISTORY_TAB, HISTORY_HEADERS, readLeads, readHistory, historyRow, leadPatch } from './flow.mjs';

const scope = 'https://www.googleapis.com/auth/spreadsheets';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const form = values => new URLSearchParams(values);
const range = (tab, cells) => `'${tab.replaceAll("'", "''")}'!${cells}`;
const cell = value => ({ userEnteredValue: { stringValue: String(value) } });
const row = values => ({ values: values.map(cell) });

function columnName(count) {
  let name = '';
  for (; count > 0; count = Math.floor((count - 1) / 26)) {
    name = String.fromCharCode(65 + (count - 1) % 26) + name;
  }
  return name;
}

export async function replaceJson(path, data) {
  await writeFile(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export function spreadsheetId(input) {
  const value = String(input ?? '').trim();
  const id = value.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:[/?#]|$)/)?.[1] ??
    (/^[\w-]{20,}$/.test(value) ? value : '');
  if (!id) throw new Error('Informe o ID ou link do Google Sheets em planilha no config.json.');
  return id;
}

function signedAssertion(credentials) {
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: credentials.client_email, scope, aud: tokenUrl, iat: now, exp: now + 3600,
  };
  const data = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(credentials.private_key, 'base64url')}`;
}

export class GoogleAuth {
  constructor(credentials, tokenPath) {
    this.credentials = credentials;
    this.tokenPath = tokenPath;
  }

  mode() {
    if (this.credentials?.type === 'service_account') return 'service';
    if (this.credentials?.installed?.client_id) return 'desktop';
    return 'unconfigured';
  }

  async refreshToken() {
    if (this.refresh) return this.refresh;
    const cached = await readFile(this.tokenPath, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    });
    this.refresh = JSON.parse(cached).refresh_token;
    return this.refresh;
  }

  authorizationUrl(redirect, state, challenge) {
    const values = form({
      client_id: this.credentials.installed.client_id, redirect_uri: redirect,
      response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${values}`;
  }

  async exchange(params) {
    const response = await fetch(tokenUrl, {
      method: 'POST', body: form(params), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
      throw new Error(result.error === 'invalid_grant'
        ? 'A autorização do Google expirou ou foi revogada. Conecte a conta novamente.'
        : `O Google recusou a autorização (${response.status}). Confira as credenciais.`);
    }
    if (result.refresh_token) {
      await replaceJson(this.tokenPath, { refresh_token: result.refresh_token });
      this.refresh = result.refresh_token;
    }
    this.access = result.access_token;
    this.expiresAt = Date.now() + Number(result.expires_in ?? 3600) * 1000 - 60000;
    return this.access;
  }

  authorize(code, redirect, verifier) {
    const { client_id, client_secret } = this.credentials.installed;
    return this.exchange({
      client_id, client_secret, code, redirect_uri: redirect, code_verifier: verifier,
      grant_type: 'authorization_code',
    });
  }

  async accessToken() {
    if (this.access && Date.now() < this.expiresAt) return this.access;
    if (this.mode() === 'service') {
      return this.exchange({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedAssertion(this.credentials),
      });
    }
    if (this.mode() === 'desktop') {
      const refresh_token = await this.refreshToken();
      if (!refresh_token) throw new Error('Use o botão Conectar Google para autorizar sua planilha.');
      const { client_id, client_secret } = this.credentials.installed;
      return this.exchange({ grant_type: 'refresh_token', client_id, client_secret, refresh_token });
    }
    throw new Error('Configure o JSON do Google em config.json. Veja o guia de instalação.');
  }
}

export class GoogleSheets {
  constructor(id, auth) {
    this.id = id;
    this.auth = auth;
  }

  async request(path, body) {
    const token = await this.auth.accessToken();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.id}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        throw new Error('O Google Sheets recusou o acesso. Confira o link, a API e a permissão de edição da conta.');
      }
      throw new Error(`Google Sheets retornou ${response.status}. A operação pode ser retomada pelo painel.`);
    }
    return response.json();
  }

  async snapshot() {
    const meta = await this.request('?fields=sheets(properties(sheetId,title,gridProperties(columnCount))');
    const tabs = meta.sheets?.map(sheet => sheet.properties) ?? [];
    const leadTab = tabs.find(sheet => sheet.title === LEAD_TAB);
    if (!leadTab) throw new Error(`A planilha não tem a aba ${LEAD_TAB}.`);
    const historyTab = tabs.find(sheet => sheet.title === HISTORY_TAB);
    const ranges = new URLSearchParams();
    ranges.append('ranges', range(LEAD_TAB, `A1:${columnName(leadTab.gridProperties.columnCount)}`));
    if (historyTab) ranges.append('ranges', range(HISTORY_TAB, `A1:${columnName(Math.min(HISTORY_HEADERS.length, historyTab.gridProperties.columnCount))}`));
    const { valueRanges } = await this.request(`/values:batchGet?${ranges}`);
    const leadData = readLeads(valueRanges[0].values ?? []);
    const historyRows = valueRanges[1]?.values ?? [];
    return {
      ...leadData, history: readHistory(historyRows), tabs, leadTab, historyTab,
      needsHeader: HISTORY_HEADERS.some((name, index) => historyRows[0]?.[index] !== name),
    };
  }

  async save(entry) {
    const snapshot = await this.snapshot();
    if (snapshot.history.some(item => item.attemptId === entry.attemptId)) return;
    const lead = snapshot.leads.find(item => item.id === entry.leadId);
    if (!lead || lead.duplicate || lead.phone !== entry.phone) {
      throw new Error('O lead ou telefone mudou na planilha. Confira a ficha antes de registrar.');
    }
    const requests = [];
    let historyId = snapshot.historyTab?.sheetId;
    if (historyId === undefined) {
      historyId = Math.max(0, ...snapshot.tabs.map(tab => tab.sheetId)) + 1;
      requests.push({ addSheet: { properties: { title: HISTORY_TAB, sheetId: historyId, gridProperties: { frozenRowCount: 1 } } } });
    }
    const missingColumns = HISTORY_HEADERS.length - (snapshot.historyTab?.gridProperties?.columnCount ?? HISTORY_HEADERS.length);
    if (missingColumns > 0) requests.push({ appendDimension: { sheetId: historyId, dimension: 'COLUMNS', length: missingColumns } });
    if (snapshot.needsHeader) {
      requests.push({ updateCells: {
        start: { sheetId: historyId, rowIndex: 0, columnIndex: 0 },
        rows: [row(HISTORY_HEADERS)], fields: 'userEnteredValue',
      } });
    }
    for (const [column, value] of Object.entries(leadPatch(lead, entry))) {
      requests.push({ updateCells: {
        start: { sheetId: snapshot.leadTab.sheetId, rowIndex: lead.rowIndex, columnIndex: snapshot.indexes[column] },
        rows: [row([value])], fields: 'userEnteredValue',
      } });
    }
    requests.push({ appendCells: { sheetId: historyId, rows: [row(historyRow(entry))], fields: 'userEnteredValue' } });
    await this.request(':batchUpdate', { requests });
  }
}
