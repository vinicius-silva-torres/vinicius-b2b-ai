import { createHash } from 'node:crypto';

export const LEAD_TAB = 'B2B QUALIFICADOS';
export const HISTORY_TAB = 'HISTÓRICO LIGAÇÕES';
export const HISTORY_HEADERS = [
  'ID da tentativa', 'ID do lead', 'Empresa', 'Telefone',
  'Início observado', 'Fim observado', 'Registrada em', 'Abordagem',
  'Resultado', 'Retornar em', 'Observação', 'Oferta apresentada', 'Modo de detecção',
];

const columns = {
  name: 'Nome Limpo do Local', phone: 'Telefone', neighborhood: 'Bairro',
  niche: 'Especialidade', rating: 'Nota e Nº Avaliações', site: 'Status do Site',
  map: 'Link do Maps', whatsapp: 'Link 1-Clique WhatsApp (wa.me)',
  stage: 'Status de contato', score: 'Score (0–100)', priority: 'Prioridade comercial',
  check: 'Dados a revisar', preview: 'Prévia pronta?', date: 'Data do contato',
  next: 'Próxima ação', notes: 'Observações comerciais',
  owner: 'Nome do responsável', previewUrl: 'Link da prévia',
};

export const APPROACHES = ['Direta', 'Google Maps', 'Falar com o dono'];
export const RESULTS = {
  preview: 'Quer a prévia', callback: 'Pediu retorno', other: 'Falei com outra pessoa',
  unanswered: 'Não atendeu', uninterested: 'Sem interesse', stop: 'Não contatar',
  invalid: 'Número inválido', proposal: 'Quer fechar',
};

export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function brazilianPhone(value) {
  const input = String(value ?? '').trim();
  if (!/^[+\d\s().-]+$/.test(input)) return '';
  let digits = input.replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(digits)) digits = digits.slice(2);
  return /^[1-9]\d(?:[2-5]\d{7}|9\d{8})$/.test(digits) ? `+55${digits}` : '';
}

export function readLeads([headers = [], ...rows]) {
  const indexes = Object.fromEntries(Object.entries(columns).map(([key, name]) =>
    [key, headers.findIndex(header => normalize(header) === normalize(name))]));
  for (const key of ['name', 'phone', 'stage', 'date', 'next', 'notes', 'check']) {
    if (indexes[key] < 0) throw new Error(`Coluna ausente em ${LEAD_TAB}: ${columns[key]}.`);
  }
  const leads = new Map();
  for (const [offset, row] of rows.entries()) {
    const values = Object.fromEntries(Object.entries(indexes).map(([key, index]) =>
      [key, String(row[index] ?? '').trim()]));
    if (!values.name) continue;
    const phone = brazilianPhone(values.phone);
    const identity = values.map || [values.name, values.neighborhood, phone || values.phone].join('|');
    const id = createHash('sha256').update(normalize(identity)).digest('hex').slice(0, 24);
    const lead = { ...values, phone, id, rowIndex: offset + 1 };
    const candidates = leads.get(id) ?? [];
    leads.set(id, [...candidates, lead]);
  }
  return {
    indexes,
    leads: Array.from(leads.values(), records =>
      records.length === 1 ? records[0] : { ...records[0], duplicate: true }),
  };
}

export function readHistory(rows) {
  const entries = [];
  if (!rows.length) return entries;
  if (HISTORY_HEADERS.some((name, index) => rows[0][index] !== name)) {
    throw new Error(`Cabeçalho incompatível em ${HISTORY_TAB}. Confira a aba antes de continuar.`);
  }
  for (const row of rows.slice(1)) {
    if (!row[0] || !row[1]) continue;
    entries.push({
      attemptId: row[0], leadId: row[1], phone: row[3], registeredAt: row[6], approach: row[7],
      result: row[8], retryAt: row[9], notes: row[10], pitched: row[11] === 'Sim', detection: row[12],
    });
  }
  return entries;
}

export function classify(lead, last, now = Date.now()) {
  const stage = normalize(lead.stage);
  if (['nao contatar', 'sem interesse', 'fechada'].includes(stage)) return 'encerrados';
  if (lead.duplicate || !lead.phone || last?.result === 'invalid' && last.phone === lead.phone) return 'revisar';
  if (last?.retryAt && ['callback', 'other', 'unanswered'].includes(last.result)) {
    return Date.parse(last.retryAt) > now ? 'retornos' : 'ligar';
  }
  if (stage === 'interessada' || stage === 'proposta enviada' || last?.result === 'proposal') return 'acompanhar';
  return 'ligar';
}

export function queueFrom(sheet, now = Date.now()) {
  const latest = new Map(sheet.history.map(item => [item.leadId, item]));
  return sheet.leads.map(({ rowIndex, ...lead }) => {
    const last = latest.get(lead.id);
    return { ...lead, last, queue: classify(lead, last, now) };
  }).sort((first, second) =>
    Number(Boolean(second.last?.retryAt)) - Number(Boolean(first.last?.retryAt)) ||
    (Number(second.score) || 0) - (Number(first.score) || 0));
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});

export function resultEntry(attempt, input, now = new Date()) {
  if (!Object.hasOwn(RESULTS, input.result)) throw new Error('Escolha um resultado válido.');
  if (!APPROACHES.includes(input.approach)) throw new Error('Escolha uma abordagem válida.');
  let retryAt = '';
  if (['callback', 'other', 'unanswered'].includes(input.result) && input.retryAt) {
    const time = new Date(input.retryAt);
    if (!Number.isFinite(time.getTime()) || time <= now) throw new Error('Escolha um retorno no futuro.');
    retryAt = time.toISOString();
  }
  if (input.result === 'callback' && !retryAt) throw new Error('Informe a data e a hora do retorno.');
  if (input.result === 'unanswered' && !retryAt) retryAt = new Date(now.getTime() + 86400000).toISOString();
  const registeredAt = now.toISOString();
  return {
    ...attempt, result: input.result, approach: input.approach, retryAt,
    notes: String(input.notes ?? '').trim().slice(0, 600),
    pitched: input.pitched === true, registeredAt,
  };
}

export function leadPatch(lead, entry) {
  const date = dateFormatter.format(new Date(entry.endedAt || entry.registeredAt));
  const updates = {};
  const stage = normalize(lead.stage);
  const advanced = ['proposta enviada', 'fechada', 'sem interesse', 'nao contatar'].includes(stage);
  if (!['unanswered', 'invalid'].includes(entry.result)) updates.date = date;
  if (entry.notes) updates.notes = [lead.notes, `[${date}] ${entry.notes}`].filter(Boolean).join('\n').slice(-45000);
  if (entry.retryAt) updates.next = `Retornar em ${dateFormatter.format(new Date(entry.retryAt))}`;
  switch (entry.result) {
    case 'preview':
      if (!advanced) updates.stage = 'Interessada';
      if (!advanced) updates.next = 'Enviar prévia';
      break;
    case 'other':
      if (!entry.retryAt) updates.next = 'Falar com responsável';
      break;
    case 'unanswered':
      if (lead.next && ['interessada', 'proposta enviada'].includes(stage)) delete updates.next;
      break;
    case 'uninterested':
      updates.stage = 'Sem interesse';
      updates.next = 'Encerrado';
      break;
    case 'stop':
      updates.stage = 'Não contatar';
      updates.next = 'Não ligar novamente';
      break;
    case 'invalid':
      updates.check = [lead.check, 'Telefone inválido'].filter(Boolean).filter((value, i, list) =>
        list.indexOf(value) === i).join(' | ');
      updates.next = 'Revisar telefone';
      break;
    case 'proposal':
      if (!advanced) updates.stage = 'Interessada';
      updates.next = 'Enviar proposta ou combinar pagamento';
      break;
  }
  return updates;
}

export function historyRow(entry) {
  return [
    entry.attemptId, entry.leadId, entry.name, entry.phone, entry.startedAt ?? '',
    entry.endedAt ?? '', entry.registeredAt, entry.approach, entry.result, entry.retryAt,
    entry.notes, entry.pitched ? 'Sim' : 'Não', entry.detection ?? 'manual',
  ];
}

export function callSummary(history) {
  return APPROACHES.map(approach => {
    const entries = history.filter(item => item.approach === approach);
    return {
      approach, attempts: entries.length, pitches: entries.filter(item => item.pitched).length,
      accepted: entries.filter(item => item.result === 'preview').length,
      closing: entries.filter(item => item.result === 'proposal').length,
    };
  });
}
