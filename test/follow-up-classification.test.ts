import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFollowUp } from '../src/google-oauth.js';

const message = (subject: string, body: string) => ({
  id: 'message-1',
  threadId: 'thread-1',
  subject,
  from: 'comercial@empresa.test',
  to: 'cliente@empresa.test',
  date: '2026-10-01T10:00:00.000Z',
  internalDate: Date.parse('2026-10-01T10:00:00.000Z'),
  body,
    dateHints: [],
});

test('clasifica como presupuesto un seguimiento comercial con variantes de precio', () => {
  assert.equal(classifyFollowUp([message('Propuesta económica', 'Te envío el pricing solicitado.')]), 'Posible presupuesto');
  assert.equal(classifyFollowUp([message('Consulta', '¿Puedes enviarme la cotización?')]), 'Posible presupuesto');
});

test('clasifica como propuesta un seguimiento pendiente de una oferta comercial', () => {
  assert.equal(classifyFollowUp([message('Propuesta de campaña', 'Te envío la propuesta para que puedas revisarla.')]), 'Posible propuesta');
  assert.equal(classifyFollowUp([message('Oferta comercial', 'Quedo pendiente de tus comentarios sobre la oferta.')]), 'Posible propuesta');
});

test('mantiene otras categorías de seguimiento', () => {
  assert.equal(classifyFollowUp([message('Información pendiente', 'Confírmame los detalles y el alcance.')]), 'Solicitud de información');
  assert.equal(classifyFollowUp([message('Seguimiento', 'Quedo pendiente de tus noticias.')]), 'Seguimiento general');
});

test('detecta una solicitud de briefing como categoría propia', () => {
  assert.equal(classifyFollowUp([message('Briefing de campaña', 'Quedo pendiente del briefing para preparar la propuesta.')]), 'Briefing pendiente');
});
