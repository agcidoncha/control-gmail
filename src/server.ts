import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { completeAuthorization, createAuthorizationUrl, getThreadMessages, listRecentMessages } from './google-oauth.js';
import { clearSessionCookieHeader, readSession, sessionCookieHeader } from './session.js';
import { getUser, listUsers, upsertUser } from './user-store.js';
import { askCommercialAssistant } from './assistant.js';

export const app = Fastify({ logger: true });

app.get('/brand/logo.svg', async (_request, reply) => {
  return reply.type('image/svg+xml').send(await readFile(resolve('logos/logo-color-simple.svg'), 'utf8'));
});

app.get('/', async (_request, reply) => {
  return reply.type('text/html').send(`
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Asistente Comercial · Gmail</title>
        <style>
          :root { --orange: #CB7721; --orange-dark: #AD6218; --orange-light: #F0A24F; --ink: #231F20; --muted: #6F6864; --warm: #F5F2EE; --border: #DED9D3; --panel: #FFFFFF; --shadow: 0 12px 32px rgba(35, 31, 32, .07); color: var(--ink); background: var(--warm); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          * { box-sizing: border-box; } body { max-width: 1120px; margin: 0 auto; padding: 28px 24px 72px; line-height: 1.45; background: radial-gradient(circle at 90% 0%, rgba(240, 162, 79, .18), transparent 28rem); }
          header { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 10px 0 28px; border-bottom: 1px solid rgba(222, 217, 211, .8); }
          .brand { display: flex; align-items: center; gap: 18px; } .brand img { width: 178px; height: auto; display: block; } .eyebrow { margin: 0 0 3px; color: var(--orange-dark); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
          h1, h2, h3 { margin: 0; } h1 { font-size: clamp(28px, 4vw, 40px); letter-spacing: -.035em; line-height: 1.05; } h2 { font-size: 19px; letter-spacing: -.01em; } h3 { font-size: 14px; }
          .muted { color: var(--muted); } .card { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 24px; margin-top: 18px; box-shadow: var(--shadow); }
          header a, a { display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--orange); margin: 0; padding: 10px 14px; border-radius: 10px; background: transparent; color: var(--orange-dark); text-decoration: none; cursor: pointer; font: inherit; font-weight: 700; transition: background .15s ease, color .15s ease, transform .15s ease; }
          header a:hover, header a:focus-visible { background: var(--orange); color: #fff; transform: translateY(-1px); } button { display: inline-flex; align-items: center; justify-content: center; border: 0; margin: 0 8px 0 0; padding: 10px 14px; border-radius: 10px; background: var(--orange); color: #fff; text-decoration: none; cursor: pointer; font: inherit; font-weight: 750; transition: background .15s ease, transform .15s ease; }
          button:hover, button:focus-visible { background: var(--orange-dark); transform: translateY(-1px); } button:disabled { opacity: .6; cursor: wait; transform: none; }
          .status { color: var(--orange-dark); font-weight: 800; font-size: 18px; } .card > .muted { max-width: 70ch; }
          .message { padding: 18px 0; border-bottom: 1px solid var(--border); } .message:last-child { border-bottom: 0; }
          .message strong { display: block; margin-bottom: 4px; } .message small { color: var(--muted); display: block; margin-bottom: 7px; }
          .message p { margin: 0; color: #4E4745; } #messages { margin-top: 10px; } .message:hover { background: linear-gradient(90deg, rgba(245, 242, 238, .75), transparent); }
          .message-tools { display: flex; align-items: center; gap: 12px; margin-top: 16px; } .message-tools input { flex: 1; min-width: 0; padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px; font: inherit; background: #fff; }
          .message-tools input:focus, textarea:focus, select:focus { outline: 3px solid rgba(240, 162, 79, .35); border-color: var(--orange-light); }
          .answer h3 { margin: 18px 0 7px; font-size: 15px; } .answer ul { margin: 7px 0 0; padding-left: 20px; } .answer li { margin: 7px 0; } .answer small { color: var(--muted); } .review-warning { color: var(--orange-dark); font-weight: 800; }
          select { min-width: 150px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; } .message-tools select { margin-top: 0; }
          .hidden { display: none; } .user-row { display: flex; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--border); } .user-row:last-child { border-bottom: 0; } .role { color: var(--orange-dark); font-weight: 800; }
          textarea { width: 100%; min-height: 110px; margin-top: 12px; padding: 13px; border: 1px solid var(--border); border-radius: 10px; resize: vertical; font: inherit; background: #fff; } form { margin-top: 4px; } .answer { margin-top: 16px; padding: 18px; background: var(--warm); border: 1px solid var(--border); border-left: 4px solid var(--orange); border-radius: 12px; }
          .thread-button { margin-top: 12px; padding: 7px 11px; font-size: 13px; background: #252122; } .thread-button:hover, .thread-button:focus-visible { background: #171415; }
          @media (max-width: 640px) { body { padding: 18px 14px 48px; } header { align-items: flex-start; flex-direction: column; padding-bottom: 20px; } .brand { align-items: flex-start; flex-direction: column; gap: 10px; } .brand img { width: 150px; } header a { width: 100%; } .card { padding: 18px; border-radius: 14px; } .message-tools { align-items: stretch; flex-direction: column; } .message-tools select { width: 100%; } .message-tools input { width: 100%; } }
        </style>
      </head>
      <body>
        <header>
          <div class="brand"><img src="/brand/logo.svg" alt="Publicidad Segmentada TV"><div><p class="eyebrow">Panel comercial</p><h1>Asistente Comercial</h1><p class="muted">Gmail · modo lectura</p></div></div>
          <a href="/auth/switch">Cambiar de cuenta</a>
        </header>
        <section class="card"><h2>Tu cuenta</h2><p id="account" class="status">Cargando…</p><p id="role" class="status"></p><p class="muted">Solo tú puedes consultar los mensajes de esta sesión.</p></section>
        <section id="adminPanel" class="card hidden"><h2>Administración</h2><p class="muted">Gestión de usuarios y roles. El contenido de los correos no aparece aquí.</p><div id="users">Cargando usuarios…</div></section>
        <section class="card"><h2>Últimos correos</h2><div class="message-tools"><select id="messageMailbox" aria-label="Tipo de mensajes"><option value="inbox">Recibidos</option><option value="sent">Enviados</option></select><input id="messageSearch" type="search" placeholder="Buscar por asunto, remitente o contenido"><span id="messageCount" class="muted"></span></div><div id="messages" class="muted">Cargando mensajes…</div></section>
        <section id="threadViewer" class="card hidden"><h2>Hilo completo</h2><div id="threadDetails"></div></section>
        <section class="card"><h2>Consultar al asistente</h2><p class="muted">El asistente analizará solo los mensajes de tu cuenta activa. No envía ni modifica correos.</p><form id="assistantForm"><textarea id="question" placeholder="Ejemplo: ¿Qué seguimientos pendientes detectas?"></textarea><button type="submit">Analizar correos</button></form><div id="assistantAnswer" class="answer hidden"></div></section>
        <script>
          const escapeHtml = (value) => {
            let text = String(value ?? '');
            for (let pass = 0; pass < 2; pass += 1) text = text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, entity) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'"}[entity]));
            return text.replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
          };
          const messagesNode = document.querySelector('#messages');
          const messageMailbox = document.querySelector('#messageMailbox');
          const messageSearch = document.querySelector('#messageSearch');
          const messageCount = document.querySelector('#messageCount');
          let loadedMessages = [];
          async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try { return await fetch(url, { ...options, signal: controller.signal }); }
            catch (error) { if (error.name === 'AbortError') throw new Error('La operación tardó demasiado. Inténtalo de nuevo.'); throw error; }
            finally { clearTimeout(timeout); }
          }
          function renderMessages() {
            const query = messageSearch.value.trim().toLowerCase();
            const filtered = loadedMessages.filter((message) => !query || [message.subject, message.from, message.snippet].join(' ').toLowerCase().includes(query));
            messageCount.textContent = filtered.length + ' de ' + loadedMessages.length;
            if (!filtered.length) { messagesNode.textContent = query ? 'No hay mensajes que coincidan.' : 'No hay mensajes en la bandeja.'; return; }
            messagesNode.innerHTML = filtered.map((message) => '<article class="message"><strong>' + escapeHtml(message.subject) + '</strong><small>' + escapeHtml(message.from) + ' · ' + escapeHtml(message.date) + '</small><p>' + escapeHtml(message.snippet) + '</p><button class="thread-button" data-thread-id="' + escapeHtml(message.threadId) + '">Ver hilo completo</button></article>').join('');
          }
          async function loadMessages() {
            messagesNode.textContent = 'Cargando mensajes…';
            const response = await fetchWithTimeout('/gmail/messages?max=10&mailbox=' + encodeURIComponent(messageMailbox.value));
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'No se pudieron cargar los mensajes.');
            loadedMessages = result.messages || [];
            renderMessages();
          }
          async function load() {
            const accountNode = document.querySelector('#account');
            const roleNode = document.querySelector('#role');
            const messagesNode = document.querySelector('#messages');
            const adminPanel = document.querySelector('#adminPanel');
            const usersNode = document.querySelector('#users');
            try {
              const response = await fetchWithTimeout('/me');
              const account = await response.json();
              if (!response.ok) { accountNode.innerHTML = '<a href="/auth/google">Conecta tu cuenta de Gmail</a>'; roleNode.textContent = ''; messagesNode.textContent = 'Necesitas iniciar sesión para ver tus mensajes.'; return; }
              accountNode.textContent = account.email;
              roleNode.textContent = account.role === 'admin' ? 'Rol: Administrador' : 'Rol: Comercial';
              if (account.role === 'admin') {
                adminPanel.classList.remove('hidden');
                const usersResponse = await fetchWithTimeout('/admin/users');
                const usersResult = await usersResponse.json();
                usersNode.innerHTML = usersResult.users.map((user) => '<div class="user-row"><span>' + escapeHtml(user.email) + '</span><span class="role">' + (user.role === 'admin' ? 'Administrador' : 'Comercial') + '</span></div>').join('');
              }
              await loadMessages();
            } catch (error) { accountNode.textContent = 'No se pudo cargar la cuenta'; messagesNode.textContent = error.message; }
          }
          messageSearch.addEventListener('input', renderMessages);
          messageMailbox.addEventListener('change', () => { messageSearch.value = ''; loadMessages(); });
          document.querySelector('#messages').addEventListener('click', async (event) => {
            const button = event.target.closest('[data-thread-id]');
            if (!button) return;
            const viewer = document.querySelector('#threadViewer');
            const details = document.querySelector('#threadDetails');
            viewer.classList.remove('hidden');
            details.textContent = 'Cargando hilo…';
            try {
              const response = await fetchWithTimeout('/gmail/threads/' + encodeURIComponent(button.dataset.threadId));
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'No se pudo cargar el hilo.');
              details.innerHTML = result.messages.map((message) => '<article class="message"><strong>' + escapeHtml(message.subject) + '</strong><small>' + escapeHtml(message.from) + ' → ' + escapeHtml(message.to) + ' · ' + escapeHtml(message.date) + '</small><p>' + escapeHtml(message.body) + '</p></article>').join('');
            } catch (error) {
              details.textContent = 'Error: ' + error.message;
            }
          });
          document.querySelector('#assistantForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const question = document.querySelector('#question').value.trim();
            const answerNode = document.querySelector('#assistantAnswer');
            if (!question) return;
            answerNode.classList.remove('hidden');
            answerNode.textContent = 'Analizando…';
            const submitButton = event.submitter;
            if (submitButton) submitButton.disabled = true;
            try {
              const response = await fetchWithTimeout('/assistant/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) }, 60000);
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'No se pudo consultar al asistente.');
              const analysis = result.analysis;
              const renderList = (title, items) => items?.length ? '<section><h3>' + title + '</h3><ul>' + items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></section>' : '';
              const sources = (analysis.fuentes || []).length ? '<section><h3>Fuentes</h3><ul>' + analysis.fuentes.map((source) => '<li><strong>' + escapeHtml(source.asunto || source.mensaje_id) + '</strong><br><small>' + escapeHtml(source.motivo) + '</small></li>').join('') + '</ul></section>' : '';
              answerNode.innerHTML = '<p>' + escapeHtml(analysis.respuesta) + '</p>' + renderList('Hechos', analysis.hechos) + renderList('Inferencias', analysis.inferencias) + renderList('Acciones propuestas', analysis.acciones_propuestas) + sources + (analysis.requiere_revision ? '<p class="review-warning">⚠ Requiere revisión humana</p>' : '');
            } catch (error) { answerNode.textContent = 'Error: ' + error.message; }
            finally { if (submitButton) submitButton.disabled = false; }
          });
          load();
        </script>
      </body>
    </html>
  `);
});

app.get('/health', async () => ({
  ok: true,
  service: 'control-gmail',
}));

app.get('/me', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (!user) return reply.code(403).send({ error: 'Usuario no registrado.' });
  return { email: user.email, role: user.role };
});

app.get('/admin/users', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });
  return { users: await listUsers() };
});

app.post<{ Body: { question?: string } }>('/assistant/ask', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const question = request.body?.question?.trim();
  if (!question) return reply.code(400).send({ error: 'Indica una pregunta.' });

  try {
    return { account: email, analysis: await askCommercialAssistant(email, question) };
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'No se pudo consultar al asistente.',
    });
  }
});

app.get<{ Querystring: { max?: string; mailbox?: string } }>(
  '/gmail/messages',
  async (request, reply) => {
    const account = readSession(request.headers.cookie);
    if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

    try {
      const mailbox = request.query.mailbox === 'sent' ? 'sent' : 'inbox';
      const messages = await listRecentMessages(account, Number(request.query.max ?? 10), mailbox);
      return { account, mailbox, messages };
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'No se pudieron leer los mensajes.',
      });
    }
  },
);

app.get<{ Params: { threadId: string } }>('/gmail/threads/:threadId', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    return { account: email, messages: await getThreadMessages(email, request.params.threadId) };
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'No se pudo leer el hilo.',
    });
  }
});

app.get('/auth/google', async (_request, reply) => {
  try {
    return reply.redirect(createAuthorizationUrl());
  } catch (error) {
    return reply.code(500).send({
      error: error instanceof Error ? error.message : 'No se pudo iniciar OAuth.',
    });
  }
});

app.get('/auth/switch', async (_request, reply) => {
  reply.header('Set-Cookie', clearSessionCookieHeader());
  return reply.redirect('/auth/google');
});

app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
  '/auth/google/callback',
  async (request, reply) => {
    const { code, state, error } = request.query;

    if (error) {
      return reply.code(400).send({ error: `Google rechazó la autorización: ${error}` });
    }

    if (!code || !state) {
      return reply.code(400).send({ error: 'Faltan code o state en el callback OAuth.' });
    }

    try {
      const profile = await completeAuthorization(code, state);
      if (!profile.emailAddress) {
        return reply.code(500).send({ error: 'Google no devolvió el email de la cuenta.' });
      }
      await upsertUser(profile.emailAddress);
      reply.header('Set-Cookie', sessionCookieHeader(profile.emailAddress));
      return reply.redirect('/?connected=' + encodeURIComponent(profile.emailAddress));
    } catch (callbackError) {
      return reply.code(500).send({
        error: callbackError instanceof Error ? callbackError.message : 'Falló la autorización.',
      });
    }
  },
);

export async function startServer() {
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '127.0.0.1' });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
