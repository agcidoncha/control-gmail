import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommercialAnalysis, validateAnalysisSources } from '../src/claude.js';
import { normalizeCommitmentDecision } from '../src/commitment-classifier.js';

test('un análisis sin fuentes verificables conserva el texto pero exige revisión', () => {
  const result = validateAnalysisSources(parseCommercialAnalysis('{"respuesta":"Hay un pendiente","requiere_revision":false,"fuentes":[]}'), [{ id: 'real', subject: 'Entrega' }]);
  assert.equal(result.requiere_revision, true);
  assert.match(result.respuesta, /no ha aportado referencias verificables/);
});

test('descarta referencias inventadas y conserva el asunto real de las válidas', () => {
  const analysis = parseCommercialAnalysis(JSON.stringify({ respuesta: 'Revisar', requiere_revision: false, fuentes: [
    { mensaje_id: 'real', asunto: 'Asunto inventado', motivo: 'Entrega pendiente' },
    { mensaje_id: 'inventado', asunto: 'Otro', motivo: 'No existe' },
  ] }));
  const result = validateAnalysisSources(analysis, [{ id: 'real', subject: 'Entrega' }]);
  assert.equal(result.requiere_revision, true);
  assert.deepEqual(result.fuentes, [{ mensaje_id: 'real', asunto: 'Entrega', motivo: 'Entrega pendiente' }]);
});

test('las fuentes válidas no fuerzan revisión por sí solas', () => {
  const analysis = parseCommercialAnalysis(JSON.stringify({ respuesta: 'Revisar', requiere_revision: false, fuentes: [
    { mensaje_id: 'real', asunto: 'Entrega', motivo: 'Entrega pendiente' },
  ] }));
  const result = validateAnalysisSources(analysis, [{ id: 'real', subject: 'Entrega' }]);
  assert.equal(result.requiere_revision, false);
});

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

test('distingue un recuento omitido por el proveedor de un recuento incorrecto', () => {
  const analysis = parseCommercialAnalysis(JSON.stringify({
    respuesta: 'No hay suficiente contexto.',
    hechos: [],
    inferencias: [],
    acciones_propuestas: [],
    requiere_revision: true,
    fuentes: [],
  }));

  assert.equal(analysis.mensajes_analizados, null);
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

test('extrae JSON precedido por un encabezado del proveedor', () => {
  const analysis = parseCommercialAnalysis(`### Resultado del análisis

${JSON.stringify({
    respuesta: 'Solo hay un boletín promocional.',
    hechos: ['Se recibió un mensaje.'],
    inferencias: [],
    acciones_propuestas: ['No crear seguimiento.'],
    requiere_revision: true,
    fuentes: [],
  })}`);

  assert.equal(analysis.respuesta, 'Solo hay un boletín promocional.');
  assert.deepEqual(analysis.hechos, ['Se recibió un mensaje.']);
  assert.deepEqual(analysis.acciones_propuestas, ['No crear seguimiento.']);
});

test('conserva la respuesta si el proveedor corta el JSON', () => {
  const analysis = parseCommercialAnalysis(
    '{"respuesta":"La respuesta principal sigue siendo útil.","hechos":["Se recibió un mensaje.",',
  );

  assert.equal(analysis.respuesta, 'La respuesta principal sigue siendo útil.');
  assert.deepEqual(analysis.hechos, []);
  assert.equal(analysis.requiere_revision, true);
});

test('una señal explícita con confianza baja sigue requiriendo revisión humana', () => {
  const decision = normalizeCommitmentDecision(JSON.stringify({
    is_commitment: true,
    confidence: 0.4,
    reason: 'Se solicita una confirmación.',
  }), 'Quedo a la espera de que me confirmes los detalles.');

  assert.equal(decision.isCommitment, true);
  assert.equal(decision.requiresReview, true);
  assert.equal(decision.source, 'ai');
});

test('una respuesta incompleta del modelo no valida compromisos por palabras clave', () => {
  const decision = normalizeCommitmentDecision('{"confidence":0.95}', 'Te enviaré la propuesta mañana.');
  assert.equal(decision.source, 'unavailable');
  assert.equal(decision.requiresReview, true);
});

test('conserva candidatos ambiguos sin palabras clave para revisión humana', () => {
  const decision = normalizeCommitmentDecision(JSON.stringify({
    is_commitment: false, confidence: 0.3, reason: 'El plazo no queda claro en el hilo.',
  }), 'Lo tendré listo el viernes.');
  assert.equal(decision.isCommitment, true);
  assert.equal(decision.requiresReview, true);
});

test('descarta una negación clara que la IA rechaza con confianza', () => {
  const decision = normalizeCommitmentDecision(JSON.stringify({
    is_commitment: false, confidence: 0.95, reason: 'El remitente indica que no debe realizarse la acción.',
  }), 'No hace falta enviar nada más.');
  assert.equal(decision.isCommitment, false);
});

test('conserva una señal explícita aunque la IA discrepe y la marca para revisión', () => {
  const decision = normalizeCommitmentDecision(JSON.stringify({
    is_commitment: false,
    confidence: 0.9,
    reason: 'Parece una solicitud de información.',
  }), 'Quedo a la espera de que me confirmes los detalles.');

  assert.equal(decision.isCommitment, true);
  assert.equal(decision.requiresReview, true);
  assert.equal(decision.source, 'ai');
});

test('distingue una validación de IA no disponible', () => {
  const decision = normalizeCommitmentDecision('respuesta no válida');

  assert.equal(decision.source, 'unavailable');
  assert.equal(decision.requiresReview, true);
});
