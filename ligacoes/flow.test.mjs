import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HISTORY_HEADERS, brazilianPhone, callSummary, classify, historyRow, leadPatch, readHistory, readLeads, resultEntry,
} from './flow.mjs';
import { GoogleSheets } from './sheets.mjs';

const headers = [
  'Bairro', 'Especialidade', 'Nome Limpo do Local', 'Telefone', 'Status de contato',
  'Data do contato', 'Próxima ação', 'Observações comerciais', 'Dados a revisar', 'Link do Maps',
];
const sample = ['Mooca', 'Estética automotiva', 'Estúdio Demo', '(11) 90000-0001',
  'Não contatado', '', '', '', '', 'https://maps.google.com/?cid=123'];
const [lead] = readLeads([headers, sample]).leads;
const attempt = { attemptId: 'test-1', leadId: lead.id, name: lead.name, phone: lead.phone };
const today = new Date('2026-11-26T14:00:00Z');

test('normaliza só telefones brasileiros válidos e identifica duplicatas', () => {
  assert.equal(brazilianPhone('+55 (11) 90000-0001'), '+5511900000001');
  assert.equal(brazilianPhone('1130000001'), '+551130000001');
  assert.equal(brazilianPhone('(11) 90000-0001 / (11) 90000-0002'), '');
  assert.equal(brazilianPhone('190'), '');
  assert.equal(readLeads([headers, sample, sample]).leads[0].duplicate, true);
});

test('retorno pendente reaparece na fila na hora marcada e preserva a etapa', () => {
  assert.throws(() => resultEntry(attempt, { result: 'callback', approach: 'Direta' }, today), /data/);
  const entry = resultEntry(attempt, {
    result: 'unanswered', approach: 'Direta', notes: 'Sem resposta',
  }, today);
  const interested = { ...lead, stage: 'Interessada', next: 'Enviar prévia' };
  const patch = leadPatch(interested, entry);
  assert.equal(patch.stage, undefined);
  assert.equal(patch.next, undefined);
  assert.equal(classify(interested, entry, today.getTime()), 'retornos');
  assert.equal(classify(interested, entry, Date.parse(entry.retryAt)), 'ligar');
  assert.equal(classify({ ...interested, stage: 'Não contatar' }, entry), 'encerrados');
});

test('número inválido sai da fila até ser corrigido', () => {
  const entry = resultEntry(attempt, { result: 'invalid', approach: 'Direta' }, today);
  const [history] = readHistory([HISTORY_HEADERS, historyRow(entry)]);
  assert.equal(classify(lead, history), 'revisar');
  assert.equal(classify({ ...lead, phone: '+5511900000002' }, history), 'ligar');
});

test('prévia e fechamento registram a intenção da pessoa', () => {
  const preview = resultEntry(attempt, { result: 'preview', approach: 'Google Maps', pitched: true }, today);
  assert.equal(leadPatch(lead, preview).stage, 'Interessada');
  assert.equal(leadPatch(lead, preview).next, 'Enviar prévia');
  assert.equal(callSummary([preview])[1].accepted, 1);
  assert.equal(callSummary([preview])[1].pitches, 1);
  const proposal = resultEntry(attempt, { result: 'proposal', approach: 'Direta' }, today);
  assert.equal(leadPatch(lead, proposal).stage, 'Interessada');
});

test('grava o histórico e a etapa num único batch e reconhece tentativas já salvas', async () => {
  const sheets = new GoogleSheets('mock');
  const calls = [];
  const data = readLeads([headers, sample]);
  const leadTab = { sheetId: 12345, title: 'B2B QUALIFICADOS' };
  const snapshot = { ...data, history: [], tabs: [leadTab], leadTab, needsHeader: true };
  sheets.snapshot = async () => snapshot;
  sheets.request = async (path, body) => { calls.push({ path, body }); };
  const entry = resultEntry(attempt, { result: 'preview', approach: 'Direta', notes: '=TESTE()' }, today);
  await sheets.save(entry);
  assert.equal(calls.length, 1);
  const { body } = calls[0];
  assert.equal(body.requests[0].addSheet.properties.title, 'HISTÓRICO LIGAÇÕES');
  const statusWrite = body.requests.find(item => item.updateCells?.start.sheetId === leadTab.sheetId && item.updateCells?.start.columnIndex === 4);
  assert.equal(statusWrite.updateCells.rows[0].values[0].userEnteredValue.stringValue, 'Interessada');
  assert.equal(body.requests.at(-1).appendCells.rows[0].values[10].userEnteredValue.stringValue, '=TESTE()');
  snapshot.history.push(entry);
  await sheets.save(entry);
  assert.equal(calls.length, 1);
});
