import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommercialAnalysis } from '../src/claude.js';

test('conserva una respuesta de IA en texto plano sin romper el formato de la aplicación', () => {
  const analysis = parseCommercialAnalysis('PERSONAL OK');

  assert.equal(analysis.respuesta, 'PERSONAL OK');
  assert.deepEqual(analysis.hechos, []);
  assert.equal(analysis.requiere_revision, true);
});

test('normaliza una respuesta JSON válida de la IA', () => {
  const analysis = parseCommercialAnalysis(JSON.stringify({
    respuesta: 'Hay un seguimiento pendiente.',
    hechos: ['Se envió una propuesta.'],
    inferencias: [],
    acciones_propuestas: ['Revisar el hilo.'],
    requiere_revision: false,
    fuentes: [{ mensaje_id: 'message-1', asunto: 'Propuesta', motivo: 'Mensaje enviado' }],
  }));

  assert.equal(analysis.respuesta, 'Hay un seguimiento pendiente.');
  assert.equal(analysis.requiere_revision, false);
  assert.equal(analysis.fuentes[0].mensaje_id, 'message-1');
});

test('desenvuelve JSON anidado y limpia Markdown escapado', () => {
  const analysis = parseCommercialAnalysis(JSON.stringify({
    respuesta: JSON.stringify({
      respuesta: '### Resultado\\n\\- Hay una oportunidad.',
      hechos: ['**El cliente respondió**.'],
      inferencias: [],
      acciones_propuestas: ['Revisar la propuesta.'],
      requiere_revision: false,
      fuentes: [],
    }),
  }));

  assert.equal(analysis.respuesta, 'Resultado\nHay una oportunidad.');
  assert.deepEqual(analysis.hechos, ['El cliente respondió.']);
  assert.equal(analysis.requiere_revision, false);
});
