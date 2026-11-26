'use strict';

const byId = id => document.getElementById(id);
const put = (id, value) => { byId(id).textContent = value; };
const readApproach = () => document.querySelector('[name="approach"]:checked').value;
const plain = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const canContact = lead => lead && ['ligar', 'retornos', 'acompanhar'].includes(lead.queue);
const resultDialog = byId('result-dialog');
const resultForm = byId('result-form');
const stateLabels = {
  idle: 'Aguardando', ready: 'Número preenchido', dialing: 'Aguardando Phone Link',
  'manual-ready': 'Telefone disponível', active: 'Chamada em curso', review: 'Registrar resultado',
};

let state = { phase: 'idle' };
let leads = [];
let activeId;
let busy = false;
let revision = 0;
let shownResult;
let skipped = new Set();

function notice(message = '', error = false) {
  put('feedback', message);
  byId('feedback').classList.toggle('error', error);
}

async function request(path, input) {
  const response = await fetch(path, input === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-B2B-Session': state.sessionToken },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao carregar o painel.');
  return data;
}

function filteredLeads() {
  const words = plain(byId('search').value).trim().split(/\s+/).filter(Boolean);
  return leads.filter(lead =>
    lead.queue === byId('queue').value && !skipped.has(lead.id) &&
    (!byId('no-site').checked || plain(lead.site).includes('sem site')) &&
    words.every(word => plain([lead.name, lead.niche, lead.neighborhood, lead.phone].join(' ')).includes(word)));
}

function selectedLead() {
  return leads.find(lead => lead.id === (state.leadId || activeId));
}

function linkTo(id, value) {
  const link = byId(id);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error();
    link.href = url.href;
    link.hidden = false;
  } catch {
    link.hidden = true;
    link.removeAttribute('href');
  }
}

function renderScript(lead) {
  const approach = readApproach();
  const preview = lead.previewReady;
  const context = lead.neighborhood ? ` em ${lead.neighborhood}` : '';
  const niche = plain(lead.niche);
  const service = niche.includes('automotiv') ? 'estética automotiva' : lead.niche?.toLowerCase();
  const benefit = niche.includes('automotiv')
    ? 'os serviços de vocês, fotos dos trabalhos e um botão pra pedir orçamento no WhatsApp'
    : niche.includes('salao') || niche.includes('beleza') || niche.includes('estetica')
      ? 'os serviços de vocês, fotos e um botão pra pedir horário no WhatsApp'
      : 'os serviços de vocês, fotos dos trabalhos e um botão de contato no WhatsApp';
  const openings = {
    Direta: `Oi, tudo bem? Aqui é o Vinicius, faço sites pra negócios locais. Você tem 20 segundos pra eu te contar uma ideia pro ${lead.name}?`,
    'Google Maps': `Oi, aqui é o Vinicius. Encontrei o ${lead.name} no Google Maps${context}. ${service ? `Vi que vocês trabalham com ${service}. ` : ''}Posso te contar uma ideia pra quem encontra vocês por lá?`,
    'Falar com o dono': `Oi, ${lead.owner ? `o(a) ${lead.owner} tá por aí` : 'com quem eu posso falar sobre o site de vocês'}? Aqui é o Vinicius, da Vinicius Web Studio. É uma ideia pro ${lead.name}.`,
  };
  put('opening', openings[approach]);
  put('offer', `A ideia é uma página com ${benefit}. ${preview
    ? 'Já montei uma prévia com o nome de vocês. Posso te mandar?'
    : 'Posso te mandar uma prévia com o nome da empresa pra você ver como ficaria?'}`);
  put('price', 'A prévia é gratuita. Se você gostar e quiser fechar o site, a criação custa R$ 300, em pagamento único. Quer que eu te mande a prévia nesse WhatsApp mesmo?');
  byId('gatekeeper').hidden = approach !== 'Falar com o dono';
  put('lead-preview', preview ? 'Prévia pronta' : '');
}

function renderQueue() {
  const list = byId('queue-list');
  const filtered = filteredLeads();
  if (!state.leadId && !filtered.some(lead => lead.id === activeId)) activeId = filtered[0]?.id;
  put('queue-count', String(filtered.length));
  list.replaceChildren(...filtered.map(lead => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(lead.id === (state.leadId || activeId)));
    button.disabled = Boolean(state.leadId) || busy;
    const name = document.createElement('strong');
    const detail = document.createElement('small');
    name.textContent = lead.name;
    detail.textContent = [lead.neighborhood, lead.niche, lead.previewUrl && 'Prévia com link',
      lead.last?.retryAt && dateTime.format(new Date(lead.last.retryAt))].filter(Boolean).join(' · ');
    button.append(name, detail);
    button.addEventListener('click', () => { activeId = lead.id; render(); });
    item.append(button);
    return item;
  }));
}

function renderActions() {
  const lead = selectedLead();
  document.querySelectorAll('[name="approach"]').forEach(element => { element.disabled = busy; });
  byId('prepare').hidden = !['idle', 'manual-ready'].includes(state.phase);
  put('prepare', state.phase === 'manual-ready' ? 'Tentar preencher novamente' : 'Preparar número');
  byId('prepare').disabled = busy || !canContact(lead) || (!state.windows && !state.demo);
  byId('dial').hidden = state.phase !== 'ready';
  byId('dial').disabled = busy;
  byId('copy').disabled = busy || !lead?.phone || state.demo;
  byId('open-phone').hidden = !state.windows || state.demo;
  byId('open-phone').disabled = busy;
  byId('review').disabled = busy || !canContact(lead);
  byId('skip').disabled = busy || ['active', 'dialing', 'review'].includes(state.phase);
  byId('refresh').disabled = busy;
  byId('diagnose').disabled = busy;
  byId('confirm-sale').hidden = Boolean(state.leadId) || !['interessada', 'proposta enviada'].includes(plain(lead?.stage));
  byId('confirm-sale').disabled = busy;
  resultForm.querySelectorAll('button').forEach(button => { button.disabled = busy; });
}

function render() {
  put('mode', state.demo ? 'Demonstração · contatos fictícios' : 'Planilha B2B');
  byId('google').hidden = state.authMode !== 'desktop';
  byId('diagnose').hidden = !state.windows || state.demo;
  put('call-status', stateLabels[state.phase] || 'Aguardando');
  byId('call-status').classList.toggle('active', state.phase === 'active');
  renderQueue();
  const lead = selectedLead();
  byId('empty').hidden = Boolean(lead);
  byId('lead-content').hidden = !lead;
  put('lead-name', lead?.name || 'Selecione um contato');
  put('lead-context', lead ? [lead.niche, lead.neighborhood, lead.stage].filter(Boolean).join(' · ') : '');
  if (lead) {
    put('lead-phone', lead.phone || 'Telefone a revisar');
    put('lead-site', lead.site);
    put('lead-rating', lead.rating);
    put('next-action', lead.next ? `Próxima ação: ${lead.next}` : '');
    byId('next-action').hidden = !lead.next;
    const preparation = lead.cold ? [
      'Contato frio', lead.score && `Score ${lead.score}`,
      lead.previewUrl ? 'Prévia pronta para apresentar' : lead.previewReady ? 'Prévia marcada como pronta. Confira o link.' : '',
    ].filter(Boolean).join(' · ') : '';
    put('lead-preparation', preparation);
    byId('lead-preparation').hidden = !preparation;
    const person = [lead.owner && `Responsável: ${lead.owner}`, lead.bestTime && `Melhor horário: ${lead.bestTime}`].filter(Boolean).join(' · ');
    put('lead-person', person);
    byId('lead-person').hidden = !person;
    linkTo('maps', lead.map);
    linkTo('preview-link', lead.previewUrl);
    const whatsapp = lead.previewUrl && lead.next === 'Enviar prévia' && lead.phone?.length === 14 && !state.demo
      ? `https://wa.me/${lead.phone.slice(1)}?text=${encodeURIComponent(`Oi! Aqui é o Vinicius, da Vinicius Web Studio. Como combinamos por telefone, segue a prévia do site de ${lead.name}: ${lead.previewUrl}`)}`
      : '';
    linkTo('whatsapp-preview', whatsapp);
    renderScript(lead);
  }
  renderActions();
}

function showResult(reset = false) {
  if (reset) {
    resultForm.reset();
    retryFields();
    put('result-error', '');
  }
  put('result-company', selectedLead()?.name || '');
  put('result-message', state.message || '');
  if (!resultDialog.open && !byId('diagnostic-dialog').open) resultDialog.showModal();
}

function applyPhase(next) {
  const previousId = state.attemptId;
  state = { ...state, ...next };
  if (state.phase !== 'review' && resultDialog.open) resultDialog.close();
  if (state.phase === 'idle') {
    state.leadId = undefined;
    state.attemptId = undefined;
    state.approach = undefined;
    state.message = undefined;
  }
  if (next.attemptId && next.attemptId !== previousId && next.approach) {
    const input = [...document.querySelectorAll('[name="approach"]')].find(element => element.value === next.approach);
    if (input) input.checked = true;
  }
  render();
  if (state.phase === 'review' && shownResult !== state.attemptId) {
    shownResult = state.attemptId;
    showResult(true);
  }
}

function renderSummary(summary) {
  byId('score-body').replaceChildren(...summary.map(item => {
    const row = document.createElement('tr');
    for (const value of [item.approach, item.attempts, item.pitches, item.accepted, item.closing, item.sales]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    return row;
  }));
}

async function loadLeads() {
  const data = await request('/api/leads');
  leads = data.leads;
  renderSummary(data.summary);
  render();
}

async function run(task, onError = message => notice(message, true)) {
  if (busy) return;
  busy = true;
  revision++;
  renderActions();
  try {
    await task();
  } catch (error) {
    onError(error.message);
  } finally {
    busy = false;
    revision++;
    render();
  }
}

async function send(path, input = {}) {
  const next = await request(path, {
    leadId: selectedLead()?.id, attemptId: state.attemptId, approach: readApproach(), ...input,
  });
  applyPhase(next);
  return next;
}

function retryFields() {
  const outcome = new FormData(resultForm).get('outcome');
  byId('retry-label').hidden = !['callback', 'other', 'unanswered'].includes(outcome);
  byId('retry').required = outcome === 'callback';
  if (byId('retry-label').hidden) byId('retry').value = '';
  byId('other-fields').hidden = outcome !== 'other';
}

byId('prepare').addEventListener('click', () => void run(async () => {
  await send('/api/prepare');
  if (state.phase === 'manual-ready') notice(state.message, true);
  else notice(state.demo ? 'Número simulado preparado. Clique em Ligar agora.' : 'Número preenchido no Phone Link. Confira e clique em Ligar agora.');
}));
byId('dial').addEventListener('click', () => void run(async () => {
  notice('');
  await send('/api/dial');
  if (state.phase === 'manual-ready') notice(state.message, true);
}));
byId('copy').addEventListener('click', () => void run(async () => {
  await navigator.clipboard.writeText(selectedLead().phone);
  notice('Telefone copiado. Cole no discador do Phone Link.');
}));
byId('open-phone').addEventListener('click', () => void run(async () => { await request('/api/open', {}); }));
byId('review').addEventListener('click', () => void run(async () => {
  if (state.phase === 'review') showResult();
  else await send(state.phase === 'idle' ? '/api/manual' : '/api/review');
}));
byId('skip').addEventListener('click', () => void run(async () => {
  const id = selectedLead()?.id;
  if (['ready', 'manual-ready'].includes(state.phase)) await send('/api/cancel');
  if (id) skipped.add(id);
  activeId = undefined;
  notice('Contato pulado nesta rodada.');
}));
byId('confirm-sale').addEventListener('click', () => void run(async () => {
  const lead = selectedLead();
  if (!window.confirm(`Confirma a venda para ${lead.name}?`)) return;
  await send('/api/sold', { confirmed: true });
  await loadLeads();
  notice('Venda registrada como Fechada.');
}));
byId('refresh').addEventListener('click', () => void run(async () => {
  applyPhase(await request('/api/state'));
  await loadLeads();
  notice(state.authError || 'Fila atualizada.', Boolean(state.authError));
}));
byId('diagnose').addEventListener('click', () => void run(async () => {
  put('diagnostic-output', JSON.stringify(await request('/api/inspect', {}), null, 2));
  byId('diagnostic-dialog').showModal();
}));
byId('close-result').addEventListener('click', () => resultDialog.close());
byId('close-diagnostic').addEventListener('click', () => {
  byId('diagnostic-dialog').close();
  if (state.phase === 'review') showResult();
});
byId('cancel-attempt').addEventListener('click', () => void run(async () => {
  await send('/api/cancel');
  notice('Tentativa descartada.');
}, message => put('result-error', message)));
resultForm.addEventListener('change', retryFields);
resultForm.addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => {
    const id = selectedLead()?.id;
    const date = byId('retry').value;
    put('result-error', '');
    const next = await send('/api/result', {
      result: new FormData(resultForm).get('outcome'),
      notes: byId('notes').value, pitched: byId('pitched').checked,
      retryAt: date ? new Date(date).toISOString() : '',
      owner: byId('owner').value, bestTime: byId('best-time').value,
      prepareNext: byId('prepare-next').checked && byId('queue').value === 'ligar',
      selection: { queue: byId('queue').value, search: byId('search').value,
        noSite: byId('no-site').checked, exclude: [...skipped] },
    });
    if (id) skipped.add(id);
    activeId = undefined;
    const message = next.advanceError || (next.phase === 'manual-ready' ? next.message : '');
    notice(message ? `Resultado salvo. ${message}` :
      next.phase === 'ready' ? 'Resultado salvo. Próximo número preparado.' : 'Resultado salvo.', Boolean(message));
    try {
      await loadLeads();
    } catch {
      notice('Resultado salvo. Clique em Atualizar para recarregar a fila.', true);
    }
  }, message => put('result-error', message));
});
for (const id of ['queue', 'search', 'no-site']) {
  byId(id).addEventListener('input', () => {
    if (id === 'queue') skipped = new Set();
    render();
  });
}
document.querySelectorAll('[name="approach"]').forEach(element => element.addEventListener('change', () => {
  const lead = selectedLead();
  if (lead) renderScript(lead);
}));

void run(async () => {
  applyPhase(await request('/api/state'));
  await loadLeads();
  notice(state.authError || (state.demo ? 'Teste os roteiros e resultados com uma chamada simulada.' : ''), Boolean(state.authError));
});

let polling = false;
setInterval(async () => {
  if (busy || polling) return;
  polling = true;
  const capture = revision;
  try {
    const next = await request('/api/state');
    if (!busy && capture === revision) {
      const updated = next.dataVersion !== state.dataVersion;
      if (updated || next.phase !== state.phase || next.attemptId !== state.attemptId) applyPhase(next);
      if (updated) await loadLeads();
    }
  } catch {
    if (!busy) notice('Painel local desconectado. Confira se o programa está aberto.', true);
  } finally {
    polling = false;
  }
}, 1200);
