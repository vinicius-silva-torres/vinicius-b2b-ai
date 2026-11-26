import { createInterface } from 'node:readline';
import { APPROACHES, RESULTS, filterQueue } from './flow.mjs';

const port = Number(process.env.B2B_LIGACOES_PORT || 3842);
const origin = `http://127.0.0.1:${port}`;
const selection = {
  queue: { enum: ['ligar', 'retornos', 'acompanhar', 'revisar', 'encerrados'] },
  search: { type: 'string', description: 'Busca por empresa, bairro ou nicho.' },
  noSite: { type: 'boolean' },
};
const approach = { enum: APPROACHES };
const leadId = { type: 'string' };
const confirmation = { type: 'boolean', const: true };
const attemptId = { type: 'string', description: 'ID da tentativa retornado pelo painel.' };
const tools = [
  tool('fila_ligacoes', 'Consulta a fila filtrada e a tentativa atual. Comece por aqui.', selection),
  tool('preparar_telefone', 'Preenche o Phone Link para um lead indicado ou para o próximo da fila.', {
    ...selection, leadId, approach,
  }),
  tool('estado_ligacao', 'Consulta se o número está preparado, se a chamada está em curso ou se o resultado está pendente.'),
  tool('ligar_veek', 'Aciona o Phone Link para uma única ligação. Use apenas mediante pedido explícito para o lead atual.', {
    attemptId, confirmed: confirmation, approach,
  }, ['attemptId', 'confirmed']),
  tool('registrar_resultado', 'Registra um resultado informado por Vinicius e prepara o próximo telefone por padrão.', {
    ...selection, leadId, attemptId,
    result: { enum: Object.keys(RESULTS), description: JSON.stringify(RESULTS) },
    approach,
    retryAt: { type: 'string', description: 'Data/hora ISO 8601 com fuso de São Paulo, por exemplo 2026-12-03T15:30:00-03:00. Obrigatória para callback.' },
    owner: { type: 'string' }, bestTime: { type: 'string' }, notes: { type: 'string' },
    pitched: { type: 'boolean' }, prepareNext: { type: 'boolean', default: true },
    ended: { type: 'boolean', description: 'Verdadeiro somente se Vinicius confirmou que encerrou a chamada manualmente.' },
  }, ['result']),
  tool('pular_contato', 'Descarta a preparação do contato atual e prepara o próximo. Requer que a chamada esteja encerrada.', {
    ...selection, attemptId, approach,
  }, ['attemptId']),
  tool('confirmar_venda', 'Grava Fechada para o lead indicado quando Vinicius confirma a venda.', {
    leadId, confirmed: confirmation, notes: { type: 'string' },
  }, ['leadId', 'confirmed']),
];

function tool(name, description, properties = {}, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

async function request(path, body, session) {
  let response;
  try {
    response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', Origin: origin, 'X-B2B-Session': session } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new Error('Abra o VWS Ligações no mesmo Windows do OpenBot e tente novamente.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Painel: erro ${response.status}.`);
  return data;
}

function brief(lead) {
  if (!lead) return null;
  const { id, name, phone, neighborhood, niche, score, queue, stage, next, owner, bestTime, cold, previewUrl, previewReady } = lead;
  return {
    id, name, phone, neighborhood, niche, score, queue, stage, next, owner, bestTime, cold, previewUrl, previewReady,
    context: cold && previewUrl ? 'Contato frio já analisado, com prévia disponível. Apresente a ideia e peça permissão para enviá-la.' :
      cold ? 'Contato frio. Use os dados confirmados na ficha e confira a prévia.' : 'Consulte a próxima ação antes de ligar.',
  };
}

function publicState({ sessionToken, ...data }) {
  return data;
}

async function execute(name, args) {
  const current = await request('/api/state');
  const send = (path, body) => request(path, body, current.sessionToken);
  const stage = args.queue || 'ligar';
  const criteria = { queue: stage, search: args.search, noSite: args.noSite };
  const call = (state, actionArgs = args) => ({
    attemptId: state.attemptId, approach: actionArgs.approach || state.approach || APPROACHES[0],
  });
  const describe = async state => {
    const { leads } = await request('/api/leads');
    return { state: publicState(state), contact: brief(leads.find(lead => lead.id === state.leadId)) };
  };
  const requireAttempt = () => {
    if (!args.attemptId || args.attemptId !== current.attemptId) {
      throw new Error('A tentativa mudou. Consulte o estado antes de continuar.');
    }
  };
  switch (name) {
    case 'fila_ligacoes': {
      const { leads, summary } = await request('/api/leads');
      const matches = filterQueue(leads, criteria);
      return { state: publicState(current), total: matches.length, next: matches.slice(0, 8).map(brief), summary };
    }
    case 'preparar_telefone':
      if (current.leadId && current.phase !== 'manual-ready') return describe(current);
      return describe(await (args.leadId || current.leadId
        ? send('/api/prepare', { leadId: args.leadId || current.leadId, approach: args.approach })
        : send('/api/next', { approach: args.approach, selection: criteria })));
    case 'estado_ligacao':
      return current.leadId ? describe(current) : { state: publicState(current) };
    case 'ligar_veek':
      requireAttempt();
      if (args.confirmed !== true) throw new Error('Confirme a ligação para este lead.');
      return describe(await send('/api/dial', call(current)));
    case 'registrar_resultado': {
      if (!Object.hasOwn(RESULTS, args.result)) throw new Error('Escolha um resultado válido.');
      const retry = args.retryAt ? Date.parse(args.retryAt) : NaN;
      if ((args.result === 'callback' || args.retryAt) && (!Number.isFinite(retry) || retry <= Date.now())) {
        throw new Error('Informe uma data e hora futuras, com o fuso de São Paulo.');
      }
      let updated = current;
      if (!current.attemptId) {
        if (!args.leadId || args.ended !== true) throw new Error('Informe o lead e confirme que a ligação terminou.');
        updated = await send('/api/manual', { leadId: args.leadId, approach: args.approach });
      } else {
        requireAttempt();
        if (args.leadId && args.leadId !== current.leadId) throw new Error('O lead informado difere da tentativa atual.');
        if (current.phase !== 'review') {
          if (args.ended !== true) throw new Error('Aguarde o término da chamada ou confirme que ela já terminou.');
          updated = await send('/api/review', call(current));
        }
      }
      const result = await send('/api/result', {
        ...args, ...call(updated), prepareNext: args.prepareNext !== false,
        selection: criteria,
      });
      if (!result.leadId) return { saved: RESULTS[args.result], state: publicState(result), contact: null };
      try {
        return { saved: RESULTS[args.result], ...(await describe(result)) };
      } catch {
        return { saved: RESULTS[args.result], state: publicState(result), contact: null };
      }
    }
    case 'pular_contato':
      requireAttempt();
      await send('/api/cancel', call(current));
      return describe(await send('/api/next', {
        approach: args.approach, selection: { ...criteria, exclude: [current.leadId] },
      }));
    case 'confirmar_venda':
      await send('/api/sold', args);
      return { saved: 'Fechada', leadId: args.leadId };
    default:
      throw new Error('Ferramenta MCP desconhecida.');
  }
}

const lines = createInterface({ input: process.stdin, terminal: false });
const respond = (id, response) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...response }) + '\n');
for await (const line of lines) {
  if (!line.trim()) continue;
  let message;
  try { message = JSON.parse(line); } catch { respond(null, { error: { code: -32700, message: 'JSON inválido' } }); continue; }
  const { id, method, params } = message;
  if (id === undefined) continue;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const protocolVersion = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(requested)
      ? requested : '2025-06-18';
    respond(id, { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'vws-ligacoes', version: '1.0.0' } } });
  } else if (method === 'ping') {
    respond(id, { result: {} });
  } else if (method === 'tools/list') {
    respond(id, { result: { tools } });
  } else if (method === 'tools/call') {
    try {
      const result = await execute(params?.name, params?.arguments || {});
      respond(id, { result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } catch (error) {
      respond(id, { result: { isError: true, content: [{ type: 'text', text: error.message }] } });
    }
  } else {
    respond(id, { error: { code: -32601, message: 'Método desconhecido.' } });
  }
}
