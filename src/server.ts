import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { completeAuthorization, createAuthorizationUrl, getAnalysisWindow, getApplicationDateInput, getMessageMetadata, getThreadMessages, listAccountInsights, listClientHistory, listDetectedCommitments, listPendingFollowUps, listPendingFollowUpsPage, listRecentMessagesPage, modifyGmailMessage, refreshGmailAccount, sendGmailMessage, syncGmailAccount, type GmailMailbox, type GmailMessageAction, type GmailSendInput } from './google-oauth.js';
import { clearSessionCookieHeader, readSession, readSessionContext, sessionCookieHeaderForOrganization } from './session.js';
import { authorizeUser, deleteUser, disconnectUser, getUser, listUsers, updateUserAiSettings, upsertUser } from './user-store.js';
import { deleteGoogleTokens } from './token-store.js';
import { askCommercialAssistant } from './assistant.js';
import { deletePersonalAiConnection, getPersonalAiConnectionStatus, savePersonalAiConnection } from './ai-connection-store.js';
import { getOrganization, updateOrganizationAiSettings } from './organization-store.js';
import { getGmailSyncState, listStoredGmailMessages } from './gmail-store.js';
import { listGmailActions, recordGmailAction, type GmailActionName } from './gmail-action-store.js';
import { getMysqlPool, isMysqlEnabled } from './mysql.js';
import { getAiApiKey, getAiModels, getDefaultAiModel, isSupportedAiModel, normalizeAiProvider, aiProviderLabels } from './ai-models.js';

export const app = Fastify({ logger: true });
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4321';

app.addHook('preHandler', async (request, reply) => {
  const route = request.routeOptions.url ?? '';
  if (!route.startsWith('/gmail') && !route.startsWith('/assistant') && !route.startsWith('/ai') && !route.startsWith('/admin') && route !== '/me') return;
  const email = readSession(request.headers.cookie);
  if (!email) return;
  const user = await getUser(email);
  if (!user || user.accessStatus === 'revoked') {
    reply.header('Set-Cookie', clearSessionCookieHeader());
    return reply.code(403).send({ error: 'Tu acceso ha sido desconectado por el administrador.' });
  }
});

function gmailErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (/insufficient.*permission|insufficient.*scope|unauthorized|forbidden/i.test(message)) {
    return 'Esta cuenta necesita volver a autorizar Gmail para usar acciones de correo. Pulsa «Cambiar de cuenta» y acepta los nuevos permisos.';
  }
  if (/quota exceeded|user.?rate.?limit|rate.?limit|too many requests/i.test(message)) {
    return 'Gmail ha limitado temporalmente las consultas. Espera unos segundos y vuelve a intentarlo.';
  }
  return message || fallback;
}

async function retryGmailRateLimited<T>(operation: () => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (!/quota exceeded|user.?rate.?limit|rate.?limit|too many requests|resource.?exhausted/i.test(message) || attempt >= 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

app.get('/brand/logo.svg', async (_request, reply) => {
  return reply.type('image/svg+xml').send(await readFile(resolve('logos/logo-color-simple.svg'), 'utf8'));
});

app.get('/brand/logo-white.svg', async (_request, reply) => {
  return reply.type('image/svg+xml').send(await readFile(resolve('logos/logo-blanco-+-color.svg'), 'utf8'));
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
          :root { --orange: #CB7721; --orange-dark: #AD6218; --orange-light: #F0A24F; --ink: #231F20; --muted: #6F6864; --warm: #F5F2EE; --dark: #171415; --panel-dark: #252122; --border: #DED9D3; --panel: #FFFFFF; --shadow: 0 16px 38px rgba(35, 31, 32, .08); color: var(--ink); background: var(--warm); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          * { box-sizing: border-box; } html { scroll-behavior: smooth; } body { min-width: 320px; margin: 0; line-height: 1.45; background: var(--warm); }
          .app-shell { min-height: 100vh; display: grid; grid-template-columns: 250px minmax(0, 1fr); } .sidebar { position: sticky; top: 0; z-index: 20; display: flex; flex-direction: column; gap: 24px; height: 100vh; max-height: 100vh; overflow-y: auto; align-self: start; padding: 28px 18px 20px; color: #fff; background: var(--dark); } .main { min-width: 0; padding: 0 38px 72px; }
          .brand img { display: block; width: 100%; max-width: 208px; height: auto; margin-bottom: 16px; } .brand strong { display: block; font-size: 15px; line-height: 1.2; } .brand small { display: block; margin-top: 5px; color: #C7BFBB; font-size: 11px; }
          .sidebar-caption { margin: 0; color: #B8AFAB; font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; } .sidebar-nav { display: grid; gap: 5px; }
          .nav-link { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; border-radius: 10px; color: #E8E1DD; text-decoration: none; font-size: 14px; font-weight: 700; transition: background .15s ease, color .15s ease; } .nav-link > span:first-child { display: inline-flex; align-items: center; min-width: 0; } .nav-link:hover, .nav-link:focus-visible, .nav-link.active { color: #fff; background: rgba(240, 162, 79, .18); outline: none; } .nav-icon { width: 22px; margin-right: 8px; color: var(--orange-light); font-size: 17px; line-height: 1; text-align: center; } .nav-link b { min-width: 22px; padding: 2px 6px; border-radius: 999px; color: #fff; background: var(--orange); font-size: 11px; text-align: center; }
          .sidebar-footer { margin-top: auto; padding-top: 18px; border-top: 1px solid #4E4745; color: #B8AFAB; font-size: 12px; } .connection-dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: #7EBF8B; }
          .topbar { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 30px 0 24px; border-bottom: 1px solid var(--border); } .eyebrow { margin: 0 0 6px; color: var(--orange-dark); font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; } h1, h2, h3, p { margin-top: 0; } h1 { margin-bottom: 6px; font-size: clamp(27px, 4vw, 40px); letter-spacing: -.04em; line-height: 1.05; } h2 { margin-bottom: 5px; font-size: 19px; letter-spacing: -.015em; } h3 { font-size: 14px; }
          .top-subtitle, .muted { color: var(--muted); } .top-actions { display: flex; align-items: center; gap: 12px; } .account-chip { max-width: 280px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); background: var(--panel); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .content { max-width: 1240px; margin: 0 auto; } .welcome { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 26px 28px; border: 1px solid var(--border); border-radius: 18px; background: #FFF7EE; box-shadow: var(--shadow); } .welcome p { margin: 0; color: #6F6864; }
          .card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: var(--shadow); } .section-card { margin-top: 18px; } .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; } .card-header p { margin: 0; color: var(--muted); font-size: 13px; }
          .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 18px; } .stat { padding: 18px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); } .stat span, .stat small { display: block; color: var(--muted); font-size: 12px; } .stat strong { display: block; margin: 7px 0 2px; color: var(--orange-dark); font-size: 27px; letter-spacing: -.04em; }
          .dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .8fr); gap: 18px; margin-top: 18px; align-items: start; } .dashboard-grid.single-screen { grid-template-columns: minmax(0, 1fr); } .dashboard-grid > .card { min-width: 0; } .assistant-card { background: var(--panel-dark); border-color: var(--panel-dark); color: #fff; } .assistant-card .muted, .assistant-card .card-header p { color: #C7BFBB; } .assistant-card textarea { border-color: #4E4745; background: #312B2B; color: #fff; }
          button, .button-link { display: inline-flex; align-items: center; justify-content: center; border: 0; margin: 0; padding: 10px 14px; border-radius: 10px; background: var(--orange); color: #fff; text-decoration: none; cursor: pointer; font: inherit; font-weight: 750; transition: background .15s ease, transform .15s ease; } button:hover, button:focus-visible, .button-link:hover, .button-link:focus-visible { background: var(--orange-dark); transform: translateY(-1px); outline: none; } button:disabled { opacity: .6; cursor: wait; transform: none; } .secondary-button { color: var(--orange-dark); background: var(--warm); border: 1px solid var(--border); font-size: 13px; } .secondary-button:hover, .secondary-button:focus-visible { color: var(--ink); background: var(--orange-light); }
          .message { min-width: 0; padding: 18px 0; border-bottom: 1px solid var(--border); } .message:last-child { border-bottom: 0; } .message strong { display: block; margin-bottom: 4px; overflow-wrap: anywhere; } .message small { display: block; margin-bottom: 7px; color: var(--muted); overflow-wrap: anywhere; } .message p { margin: 0; color: #4E4745; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; } .message:hover, .message.is-open { background: #FCFAF8; } .thread-button { margin-top: 12px; padding: 7px 11px; font-size: 13px; color: #fff; background: var(--panel-dark); } .thread-button:hover, .thread-button:focus-visible { background: var(--dark); } .thread-inline { margin-top: 18px; padding: 16px 18px 4px; border: 1px solid var(--border); border-radius: 12px; background: var(--warm); overflow-wrap: anywhere; } .thread-inline:focus { outline: 3px solid rgba(222, 217, 211, .8); outline-offset: 2px; } .thread-inline .message { padding: 12px 0; } .thread-inline .message:first-child { padding-top: 0; } .thread-inline .message:last-child { padding-bottom: 0; }
          .message-tools { display: flex; align-items: center; gap: 12px; margin: 18px 0 4px; } .message-tools input { flex: 1; min-width: 0; padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px; font: inherit; background: #fff; } .quick-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; } .filter-chip { padding: 7px 11px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); background: #fff; font-size: 12px; } .filter-chip:hover, .filter-chip:focus-visible, .filter-chip.active { color: var(--orange-dark); background: #FFF1E2; border-color: var(--border); transform: none; } select { min-width: 150px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
          .message-tools input:focus, textarea:focus, select:focus { outline: 3px solid rgba(222, 217, 211, .8); border-color: var(--border); } textarea { width: 100%; min-height: 130px; margin-top: 14px; padding: 13px; border: 1px solid var(--border); border-radius: 10px; resize: vertical; font: inherit; background: #fff; } form { margin-top: 4px; }
          .follow-ups-list { display: grid; gap: 0; margin-top: 10px; } .follow-up { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); } .follow-up:last-child { border-bottom: 0; } .follow-up strong, .follow-up small, .follow-up p { display: block; } .follow-up small { margin-top: 4px; color: var(--muted); } .follow-up p { margin: 7px 0 0; color: #4E4745; font-size: 13px; } .follow-up-age { align-self: start; padding: 5px 9px; border-radius: 999px; color: var(--orange-dark); background: #FFF1E2; font-size: 12px; font-weight: 800; white-space: nowrap; } .list-toggle { margin-top: 14px; color: var(--orange-dark); background: var(--warm); border: 1px solid var(--border); font-size: 13px; } .list-toggle:hover, .list-toggle:focus-visible { color: var(--ink); background: var(--orange-light); }
          .answer { max-width: 100%; margin-top: 16px; padding: 18px; border: 1px solid var(--border); border-radius: 12px; color: var(--ink); background: var(--warm); overflow-wrap: anywhere; word-break: break-word; } .answer h3 { margin: 18px 0 7px; color: var(--ink); font-size: 15px; overflow-wrap: anywhere; } .answer p, .answer li, .answer small { overflow-wrap: anywhere; word-break: break-word; } .answer ul { margin: 7px 0 0; padding-left: 20px; } .answer li { margin: 7px 0; } .answer small { color: var(--muted); } .answer li small { display: block; margin-top: 3px; } .review-warning { color: var(--orange-dark); font-weight: 800; }
          .status { margin-bottom: 5px; color: var(--orange-dark); font-weight: 800; font-size: 18px; } .admin-panel { margin-top: 18px; } .user-row { display: flex; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--border); } .user-row:last-child { border-bottom: 0; } .role { color: var(--orange-dark); font-weight: 800; }
          .hidden { display: none; } .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; } .details-card { padding: 0; overflow: hidden; } .details-card > summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px 24px; cursor: pointer; list-style: none; } .details-card > summary::-webkit-details-marker { display: none; } .details-card > summary::after { content: '+'; color: var(--orange-dark); font-size: 24px; font-weight: 500; line-height: 1; } .details-card[open] > summary::after { content: '−'; } .details-card > summary h2 { margin-bottom: 4px; } .details-card > summary p { margin: 0; color: var(--muted); font-size: 13px; } .details-card > summary:focus-visible { outline: 3px solid rgba(222, 217, 211, .8); outline-offset: -3px; } .details-content { padding: 0 24px 24px; } .details-content .status { margin-bottom: 5px; }
          @media (max-width: 900px) { .app-shell { grid-template-columns: 210px minmax(0, 1fr); } .main { padding: 0 24px 56px; } .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .dashboard-grid { grid-template-columns: 1fr; } }
          @media (max-width: 640px) { .app-shell { display: block; } .sidebar { position: sticky; height: auto; max-height: none; overflow: visible; gap: 14px; padding: 18px 14px; box-shadow: 0 8px 18px rgba(23, 20, 21, .16); } .sidebar-nav { display: flex; overflow-x: auto; padding-bottom: 3px; } .nav-link { flex: 0 0 auto; } .sidebar-footer { display: none; } .main { padding: 0 14px 48px; } .topbar { align-items: flex-start; flex-direction: column; padding: 22px 0 18px; } .top-actions { width: 100%; justify-content: space-between; } .account-chip { max-width: 62%; } .welcome { align-items: flex-start; flex-direction: column; padding: 20px; } .stats { grid-template-columns: 1fr 1fr; gap: 10px; } .stat { padding: 14px; } .stat strong { font-size: 23px; } .card { padding: 18px; } .details-card { padding: 0; } .message-tools { align-items: stretch; flex-direction: column; } .message-tools select, .message-tools input { width: 100%; } }
        </style>
      </head>
      <body>
        <div class="app-shell">
          <aside class="sidebar">
            <div class="brand"><img src="/brand/logo-white.svg" alt="Publicidad Segmentada TV"></div>
            <p class="sidebar-caption">Espacio comercial</p>
            <nav class="sidebar-nav" aria-label="Secciones principales">
              <a class="nav-link active" href="#dashboard"><span><span class="nav-icon" aria-hidden="true">⌂</span>Panel general</span></a>
              <a class="nav-link" href="#mailboxSection"><span><span class="nav-icon" aria-hidden="true">✉</span>Bandeja comercial</span> <b id="navMessageCount">10</b></a>
              <a class="nav-link" href="#followUpsSection"><span><span class="nav-icon" aria-hidden="true">◷</span>Seguimientos</span> <b id="navFollowUpCount">—</b></a>
              <a class="nav-link" href="#commitmentsSection"><span><span class="nav-icon" aria-hidden="true">☑</span>Compromisos</span> <b id="navCommitmentCount">—</b></a>
              <a class="nav-link" href="#clientsSection"><span><span class="nav-icon" aria-hidden="true">♙</span>Clientes</span></a>
              <a class="nav-link" href="#reportsSection"><span><span class="nav-icon" aria-hidden="true">▤</span>Informes</span></a>
              <a class="nav-link" href="#assistantSection"><span><span class="nav-icon" aria-hidden="true">✦</span>Consultar a la IA</span></a>
              <a class="nav-link" href="${frontendUrl}/settings/ai"><span><span class="nav-icon" aria-hidden="true">⚙</span>Configuración IA</span></a>
            </nav>
            <div class="sidebar-footer"><span class="connection-dot"></span> Gmail · control seguro<br><small>Datos de la cuenta activa</small></div>
          </aside>
          <main class="main">
            <header class="topbar">
              <div><p class="eyebrow">Panel comercial</p><h1>Buenos días, comercial</h1><p class="top-subtitle">Controla tus conversaciones y próximos seguimientos.</p></div>
              <div class="top-actions"><span id="accountChip" class="account-chip">Cuenta activa</span><a class="button-link" href="/auth/switch">Cambiar de cuenta</a></div>
            </header>
            <div class="content">
              <section id="dashboard" data-screen="dashboard" class="welcome section-card"><div><h2>Tu actividad comercial, en un solo lugar</h2><p>Revisa mensajes, consulta al asistente y trabaja siempre con tu cuenta autorizada.</p></div><a class="button-link" href="#assistantSection">Consultar a la IA</a></section>
              <section data-screen="dashboard" class="stats" aria-label="Resumen de la cuenta"><article class="stat"><span>Mensajes visibles</span><strong id="statMessageCount">—</strong><small>En la bandeja actual</small></article><article class="stat"><span>Cuenta conectada</span><strong>1</strong><small>Sesión activa</small></article><article class="stat"><span>Modo</span><strong>Control Gmail</strong><small>Acciones con confirmación</small></article><article class="stat"><span>Permisos</span><strong id="statRole">—</strong><small>Según tu cuenta</small></article></section>
              <div class="dashboard-grid">
                <section id="mailboxSection" data-screen="mailbox" class="card"><div class="card-header"><div><h2>Correos que requieren atención</h2><p>Filtra por bandeja, asunto, remitente o contenido.</p></div><span id="messageCount" class="muted"></span></div><div class="message-tools"><select id="messageMailbox" aria-label="Tipo de mensajes"><option value="inbox">Recibidos</option><option value="sent">Enviados</option></select><input id="messageSearch" type="search" placeholder="Buscar cliente, empresa o asunto…"></div><div id="messageFilters" class="quick-filters" role="group" aria-label="Filtrar mensajes"><button class="filter-chip active" type="button" data-message-filter="all">Todos</button><button class="filter-chip" type="button" data-message-filter="attention">Atención</button><button class="filter-chip" type="button" data-message-filter="follow-ups">Sin respuesta</button><button class="filter-chip" type="button" data-message-filter="commitments">Compromisos</button></div><div id="messages" class="muted">Cargando mensajes…</div><button id="messageMoreButton" class="list-toggle hidden" type="button"></button></section>
                <section id="assistantSection" data-screen="assistant" class="card assistant-card"><div class="card-header"><div><h2>Consultar al asistente IA</h2><p>Pregunta sobre la actividad de tu cuenta.</p></div></div><p class="muted">El asistente analiza solo tus mensajes. No envía ni modifica correos.</p><form id="assistantForm"><textarea id="question" placeholder="Ejemplo: ¿Qué seguimientos pendientes detectas?"></textarea><button type="submit">Analizar correos</button></form><div id="assistantAnswer" class="answer hidden"></div></section>
              </div>
              <section id="followUpsSection" data-screen="follow-ups" class="card section-card"><div class="card-header"><div><h2>Seguimientos pendientes</h2><p>Mensajes enviados sin una respuesta posterior, agrupados por hilo.</p></div><span id="followUpCount" class="muted"></span></div><div id="followUps" class="follow-ups-list">Cargando seguimientos…</div><button id="followUpMoreButton" class="list-toggle hidden" type="button"></button></section>
              <section id="commitmentsSection" data-screen="commitments" class="card section-card"><div class="card-header"><div><h2>Posibles compromisos detectados</h2><p>Frases de los correos que sugieren una tarea, fecha, promesa o respuesta pendiente. Revísalos antes de actuar: no son compromisos confirmados.</p></div><span id="commitmentCount" class="muted"></span></div><div id="commitments" class="follow-ups-list">Cargando compromisos…</div><button id="commitmentMoreButton" class="list-toggle hidden" type="button"></button></section>
              <section id="clientsSection" data-screen="clients" class="card section-card"><div class="card-header"><div><h2>Clientes</h2><p>Contactos detectados en los mensajes de la cuenta activa.</p></div></div><div id="clients" class="details-content">Cargando clientes…</div></section>
              <section id="reportsSection" data-screen="reports" class="card section-card"><div class="card-header"><div><h2>Informes</h2><p>Resumen de actividad con los datos cargados de la cuenta.</p></div></div><div id="reports" class="details-content">Cargando informe…</div></section>
              <details id="accountSection" data-screen="dashboard" class="card section-card details-card"><summary><div><h2>Tu cuenta</h2><p>Identidad y permisos de la sesión actual.</p></div></summary><div class="details-content"><p id="account" class="status">Cargando…</p><p id="role" class="status"></p><p class="muted">Solo tú puedes consultar los mensajes de esta sesión.</p></div></details>
              <details id="adminPanel" data-screen="dashboard" class="card admin-panel details-card hidden"><summary><div><h2>Administración</h2><p>Gestión de usuarios y roles. El contenido de los correos no aparece aquí.</p></div></summary><div id="users" class="details-content">Cargando usuarios…</div></details>
            </div>
          </main>
        </div>
        <script>
          const makeTextElement = (tag, value, className = '') => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            node.textContent = String(value ?? '');
            return node;
          };
          const messagesNode = document.querySelector('#messages');
          const messageMailbox = document.querySelector('#messageMailbox');
          const messageSearch = document.querySelector('#messageSearch');
          const messageFilterButtons = document.querySelectorAll('[data-message-filter]');
          const messageCount = document.querySelector('#messageCount');
          const messageMoreButton = document.querySelector('#messageMoreButton');
          const followUpsNode = document.querySelector('#followUps');
          const followUpCount = document.querySelector('#followUpCount');
          const navFollowUpCount = document.querySelector('#navFollowUpCount');
          const followUpMoreButton = document.querySelector('#followUpMoreButton');
          const commitmentsNode = document.querySelector('#commitments');
          const commitmentCount = document.querySelector('#commitmentCount');
          const navCommitmentCount = document.querySelector('#navCommitmentCount');
          const commitmentMoreButton = document.querySelector('#commitmentMoreButton');
          const clientsNode = document.querySelector('#clients');
          const reportsNode = document.querySelector('#reports');
          const dashboardGrid = document.querySelector('.dashboard-grid');
          const screenNodes = [...document.querySelectorAll('[data-screen]')];
          let loadedMessages = [];
          let loadedFollowUps = [];
          let loadedCommitments = [];
          let loadedInsights = null;
          let activeAccountEmail = '';
          let showAllMessages = false;
          let showAllFollowUps = false;
          let showAllCommitments = false;
          let messageFilter = 'all';
          function extractEmail(value) {
            return value?.match(/<([^>]+)>/)?.[1] || value?.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || value || 'Remitente desconocido';
          }
          function renderClients() {
            clientsNode.replaceChildren();
            if (loadedInsights?.clients) {
              if (!loadedInsights.clients.length) {
                clientsNode.append(makeTextElement('p', 'No hay clientes detectados en los mensajes revisados.', 'muted'));
                return;
              }
              loadedInsights.clients.forEach((client) => {
                const row = document.createElement('div');
                row.className = 'user-row';
                row.append(makeTextElement('strong', client.email));
                row.append(makeTextElement('span', client.messages + (client.messages === 1 ? ' mensaje' : ' mensajes') + ' · último ' + formatMessageDate(client.latestDate), 'muted'));
                clientsNode.append(row);
              });
              return;
            }
            const clients = new Map();
            loadedMessages.forEach((message) => {
              const email = extractEmail(message.from);
              if (!email || email.toLowerCase() === activeAccountEmail) return;
              const current = clients.get(email.toLowerCase()) || { email, count: 0, latest: message.date || '' };
              current.count += 1;
              if (message.date && (!current.latest || new Date(message.date) > new Date(current.latest))) current.latest = message.date;
              clients.set(email.toLowerCase(), current);
            });
            if (!clients.size) {
              clientsNode.append(makeTextElement('p', 'No hay clientes detectados en los mensajes cargados.', 'muted'));
              return;
            }
            [...clients.values()].sort((left, right) => right.count - left.count).forEach((client) => {
              const row = document.createElement('div');
              row.className = 'user-row';
              row.append(makeTextElement('strong', client.email));
              row.append(makeTextElement('span', client.count + (client.count === 1 ? ' mensaje' : ' mensajes') + ' · último ' + formatMessageDate(client.latest), 'muted'));
              clientsNode.append(row);
            });
          }
          function renderReports() {
            reportsNode.replaceChildren();
            const values = loadedInsights ? [
              ['Mensajes recibidos revisados', loadedInsights.inboxMessages],
              ['Mensajes enviados revisados', loadedInsights.sentMessages],
              ['Clientes detectados', loadedInsights.clients.length],
              ['Seguimientos pendientes', loadedFollowUps.length],
              ['Compromisos para revisar', loadedCommitments.length],
            ] : [
              ['Mensajes cargados', loadedMessages.length],
              ['Seguimientos pendientes', loadedFollowUps.length],
              ['Compromisos para revisar', loadedCommitments.length],
            ];
            values.forEach(([label, value]) => {
              const row = document.createElement('div');
              row.className = 'user-row';
              row.append(makeTextElement('span', label));
              row.append(makeTextElement('strong', value));
              reportsNode.append(row);
            });
            reportsNode.append(makeTextElement('p', loadedInsights
              ? 'El informe revisa los mensajes recientes de recibidos y enviados de la cuenta activa; no modifica ni envía correos.'
              : 'Este resumen refleja únicamente los datos cargados de la cuenta activa en esta sesión.', 'muted'));
          }
          async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try { return await fetch(url, { ...options, signal: controller.signal }); }
            catch (error) { if (error.name === 'AbortError') throw new Error('La operación tardó demasiado. Inténtalo de nuevo.'); throw error; }
            finally { clearTimeout(timeout); }
          }
          function renderMessages() {
            const query = messageSearch.value.trim().toLowerCase();
            const followUpThreads = new Set(loadedFollowUps.map((item) => item.threadId));
            const commitmentThreads = new Set(loadedCommitments.map((item) => item.threadId));
            const matchesFilter = (message) => {
              if (messageFilter === 'follow-ups') return followUpThreads.has(message.threadId);
              if (messageFilter === 'commitments') return commitmentThreads.has(message.threadId);
              if (messageFilter === 'attention') return followUpThreads.has(message.threadId) || commitmentThreads.has(message.threadId);
              return true;
            };
            const filtered = loadedMessages.filter((message) => matchesFilter(message) && (!query || [message.subject, message.from, message.snippet].join(' ').toLowerCase().includes(query)));
            const visible = showAllMessages ? filtered : filtered.slice(0, 5);
            messageCount.textContent = visible.length + ' de ' + loadedMessages.length;
            if (!filtered.length) {
              messagesNode.textContent = query ? 'No hay mensajes que coincidan.' : 'No hay mensajes en la bandeja.';
              messageMoreButton.classList.add('hidden');
              document.querySelector('#navMessageCount').textContent = String(loadedMessages.length);
              document.querySelector('#statMessageCount').textContent = String(loadedMessages.length);
              renderClients();
              renderReports();
              return;
            }
            messagesNode.replaceChildren();
            visible.forEach((message) => {
              const article = document.createElement('article');
              article.className = 'message';
              article.append(makeTextElement('strong', message.subject));
              article.append(makeTextElement('small', message.from + ' · ' + (message.date || '')));
              article.append(makeTextElement('p', message.snippet));
              const button = makeTextElement('button', 'Ver hilo completo');
              button.className = 'thread-button';
              button.dataset.threadId = message.threadId || '';
              article.append(button);
              const threadInline = document.createElement('div');
              threadInline.className = 'thread-inline hidden';
              threadInline.dataset.threadId = message.threadId || '';
              threadInline.tabIndex = -1;
              article.append(threadInline);
              messagesNode.append(article);
            });
            messageMoreButton.classList.toggle('hidden', filtered.length <= 5);
            messageMoreButton.textContent = showAllMessages ? 'Mostrar menos' : 'Mostrar ' + (filtered.length - 5) + ' más';
            document.querySelector('#navMessageCount').textContent = String(loadedMessages.length);
            document.querySelector('#statMessageCount').textContent = String(loadedMessages.length);
            renderClients();
            renderReports();
          }
          async function loadMessages() {
            messagesNode.textContent = 'Cargando mensajes…';
            const response = await fetchWithTimeout('/gmail/messages?max=10&mailbox=' + encodeURIComponent(messageMailbox.value));
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'No se pudieron cargar los mensajes.');
            loadedMessages = result.messages || [];
            renderMessages();
          }
          async function loadInsights() {
            const response = await fetchWithTimeout('/gmail/insights?max=25');
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'No se pudo preparar el informe.');
            loadedInsights = result.insights || null;
            renderClients();
            renderReports();
          }
          function formatMessageDate(value) {
            if (!value) return 'Fecha desconocida';
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
          }
          function renderFollowUps(items) {
            loadedFollowUps = items;
            followUpCount.textContent = items.length + (items.length === 1 ? ' pendiente' : ' pendientes');
            navFollowUpCount.textContent = String(items.length);
            followUpsNode.replaceChildren();
            const visible = showAllFollowUps ? items : items.slice(0, 3);
            if (!items.length) {
              followUpsNode.append(makeTextElement('p', 'No hay seguimientos pendientes verificables en los mensajes consultados.', 'muted'));
              followUpMoreButton.classList.add('hidden');
              return;
            }
            visible.forEach((item) => {
              const article = document.createElement('article');
              article.className = 'follow-up';
              const content = document.createElement('div');
              content.append(makeTextElement('strong', item.client));
              content.append(makeTextElement('small', item.subject + ' · ' + formatMessageDate(item.date)));
              content.append(makeTextElement('p', item.reason));
              article.append(content);
              article.append(makeTextElement('span', item.ageDays + (item.ageDays === 1 ? ' día' : ' días'), 'follow-up-age'));
              followUpsNode.append(article);
            });
            followUpMoreButton.classList.toggle('hidden', items.length <= 3);
            followUpMoreButton.textContent = showAllFollowUps ? 'Mostrar menos' : 'Mostrar ' + (items.length - 3) + ' más';
            renderReports();
            if (messageFilter !== 'all') renderMessages();
          }
          async function loadFollowUps() {
            followUpsNode.textContent = 'Cargando seguimientos…';
            const response = await fetchWithTimeout('/gmail/follow-ups?max=10');
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'No se pudieron detectar seguimientos.');
            renderFollowUps(result.followUps || []);
          }
          function renderCommitments(items) {
            loadedCommitments = items;
            commitmentCount.textContent = items.length + (items.length === 1 ? ' posible compromiso' : ' posibles compromisos');
            navCommitmentCount.textContent = String(items.length);
            commitmentsNode.replaceChildren();
            const visible = showAllCommitments ? items : items.slice(0, 3);
            if (!items.length) {
              commitmentsNode.append(makeTextElement('p', 'No hay compromisos verificables en los hilos consultados.', 'muted'));
              commitmentMoreButton.classList.add('hidden');
              return;
            }
            visible.forEach((item) => {
              const article = document.createElement('article');
              article.className = 'follow-up';
              const content = document.createElement('div');
              content.append(makeTextElement('strong', item.owner));
              content.append(makeTextElement('small', item.subject + ' · ' + formatMessageDate(item.date)));
              content.append(makeTextElement('p', item.commitment));
              article.append(content);
              article.append(makeTextElement('span', item.status, 'follow-up-age'));
              commitmentsNode.append(article);
            });
            commitmentMoreButton.classList.toggle('hidden', items.length <= 3);
            commitmentMoreButton.textContent = showAllCommitments ? 'Mostrar menos' : 'Mostrar ' + (items.length - 3) + ' más';
            renderReports();
            if (messageFilter !== 'all') renderMessages();
          }
          async function loadCommitments() {
            commitmentsNode.textContent = 'Cargando compromisos…';
            const response = await fetchWithTimeout('/gmail/commitments?max=10');
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'No se pudieron detectar compromisos.');
            renderCommitments(result.commitments || []);
          }
          function renderLoadError(node, message) {
            node.replaceChildren(makeTextElement('p', message, 'muted'));
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
              activeAccountEmail = account.email.toLowerCase();
              document.querySelector('#accountChip').textContent = account.email;
              roleNode.textContent = account.role === 'admin' ? 'Rol: Administrador' : 'Rol: Comercial';
              document.querySelector('#statRole').textContent = account.role === 'admin' ? 'Admin' : 'Comercial';
              if (account.role === 'admin') {
                adminPanel.classList.remove('hidden');
                const usersResponse = await fetchWithTimeout('/admin/users');
                const usersResult = await usersResponse.json();
                usersNode.replaceChildren();
                usersResult.users.forEach((user) => {
                  const row = document.createElement('div');
                  row.className = 'user-row';
                  row.append(makeTextElement('span', user.email));
                  row.append(makeTextElement('span', user.role === 'admin' ? 'Administrador' : 'Comercial', 'role'));
                  usersNode.append(row);
                });
              }
              await loadMessages().catch(() => renderLoadError(messagesNode, 'No se pudieron cargar los mensajes ahora. Inténtalo de nuevo en unos segundos.'));
              await loadInsights().catch(() => { loadedInsights = null; renderClients(); renderReports(); });
              await loadFollowUps().catch(() => {
                followUpCount.textContent = 'No disponible';
                navFollowUpCount.textContent = '—';
                renderLoadError(followUpsNode, 'No se pudieron calcular los seguimientos ahora. Inténtalo de nuevo en unos segundos.');
              });
              await loadCommitments().catch(() => {
                commitmentCount.textContent = 'No disponible';
                navCommitmentCount.textContent = '—';
                renderLoadError(commitmentsNode, 'No se pudieron cargar los compromisos ahora. Inténtalo de nuevo en unos segundos.');
              });
            } catch (error) { accountNode.textContent = 'No se pudo cargar la cuenta'; renderLoadError(messagesNode, 'No se pudo cargar la sesión. Inténtalo de nuevo.'); }
          }
          const navLinks = [...document.querySelectorAll('.nav-link')];
          const setActiveNav = (activeLink) => navLinks.forEach((item) => item.classList.toggle('active', item === activeLink));
          function setActiveScreen(screenId, activeLink, updateUrl = false, targetId = '') {
            const validScreen = screenNodes.some((node) => node.dataset.screen === screenId) ? screenId : 'dashboard';
            screenNodes.forEach((node) => { node.hidden = node.dataset.screen !== validScreen; });
            dashboardGrid.hidden = !['mailbox', 'assistant'].includes(validScreen);
            dashboardGrid.classList.toggle('single-screen', ['mailbox', 'assistant'].includes(validScreen));
            setActiveNav(activeLink || navLinks.find((link) => link.getAttribute('href') === '#' + targetId));
            if (updateUrl && targetId) window.history.pushState(null, '', '#' + targetId);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          function openScreenFromLink(link, event) {
            event.preventDefault();
            const targetId = link.getAttribute('href')?.slice(1) || 'dashboard';
            const target = document.getElementById(targetId);
            setActiveScreen(target?.dataset.screen || 'dashboard', link.classList.contains('nav-link') ? link : null, true, targetId);
          }
          document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => openScreenFromLink(link, event)));
          const initialTargetId = window.location.hash.slice(1) || 'dashboard';
          const initialTarget = document.getElementById(initialTargetId) || document.getElementById('dashboard');
          setActiveScreen(initialTarget?.dataset.screen || 'dashboard', navLinks.find((link) => link.getAttribute('href') === '#' + initialTarget?.id), false, initialTarget?.id || 'dashboard');
          window.addEventListener('popstate', () => {
            const targetId = window.location.hash.slice(1) || 'dashboard';
            const target = document.getElementById(targetId) || document.getElementById('dashboard');
            setActiveScreen(target?.dataset.screen || 'dashboard', navLinks.find((link) => link.getAttribute('href') === '#' + target?.id), false, target?.id || 'dashboard');
          });
          messageMoreButton.addEventListener('click', () => { showAllMessages = !showAllMessages; renderMessages(); });
          followUpMoreButton.addEventListener('click', () => { showAllFollowUps = !showAllFollowUps; renderFollowUps(loadedFollowUps); });
          commitmentMoreButton.addEventListener('click', () => { showAllCommitments = !showAllCommitments; renderCommitments(loadedCommitments); });
          messageFilterButtons.forEach((button) => button.addEventListener('click', () => {
            messageFilter = button.dataset.messageFilter || 'all';
            showAllMessages = false;
            messageFilterButtons.forEach((item) => item.classList.toggle('active', item === button));
            renderMessages();
          }));
          messageSearch.addEventListener('input', () => { showAllMessages = false; renderMessages(); });
          messageMailbox.addEventListener('change', () => { messageSearch.value = ''; messageFilter = 'all'; messageFilterButtons.forEach((item) => item.classList.toggle('active', item.dataset.messageFilter === 'all')); loadMessages(); });
          document.querySelector('#messages').addEventListener('click', async (event) => {
            const button = event.target.closest('[data-thread-id]');
            if (!button) return;
            const article = button.closest('.message');
            const threadInline = article?.querySelector('.thread-inline');
            if (!article || !threadInline) return;
            if (!threadInline.classList.contains('hidden')) {
              threadInline.classList.add('hidden');
              article.classList.remove('is-open');
              button.textContent = 'Ver hilo completo';
              return;
            }
            document.querySelectorAll('.thread-inline:not(.hidden)').forEach((openThread) => {
              openThread.classList.add('hidden');
              openThread.closest('.message')?.classList.remove('is-open');
              openThread.closest('.message')?.querySelector('.thread-button')?.replaceChildren(document.createTextNode('Ver hilo completo'));
            });
            article.classList.add('is-open');
            threadInline.classList.remove('hidden');
            threadInline.textContent = 'Cargando hilo…';
            button.textContent = 'Cerrar hilo';
            try {
              const response = await fetchWithTimeout('/gmail/threads/' + encodeURIComponent(button.dataset.threadId));
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'No se pudo cargar el hilo.');
              threadInline.replaceChildren();
              result.messages.forEach((message) => {
                const article = document.createElement('article');
                article.className = 'message';
                article.append(makeTextElement('strong', message.subject));
                article.append(makeTextElement('small', message.from + ' → ' + message.to + ' · ' + (message.date || '')));
                article.append(makeTextElement('p', message.body));
                threadInline.append(article);
              });
              threadInline.focus({ preventScroll: true });
            } catch (error) {
              threadInline.textContent = 'Error: ' + error.message;
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
              answerNode.replaceChildren();
              const addText = (parent, tag, value, className = '') => {
                const node = makeTextElement(tag, value, className);
                parent.append(node);
                return node;
              };
              const renderList = (title, items) => {
                if (!items?.length) return;
                const section = document.createElement('section');
                addText(section, 'h3', title);
                const list = document.createElement('ul');
                items.forEach((item) => addText(list, 'li', item));
                section.append(list);
                answerNode.append(section);
              };
              addText(answerNode, 'p', analysis.respuesta);
              renderList('Hechos', analysis.hechos);
              renderList('Inferencias', analysis.inferencias);
              renderList('Acciones propuestas', analysis.acciones_propuestas);
              if (analysis.fuentes?.length) {
                const section = document.createElement('section');
                addText(section, 'h3', 'Fuentes');
                const list = document.createElement('ul');
                analysis.fuentes.forEach((source) => {
                  const item = document.createElement('li');
                  addText(item, 'strong', source.asunto || source.mensaje_id);
                  addText(item, 'small', source.motivo);
                  list.append(item);
                });
                section.append(list);
                answerNode.append(section);
              }
              if (analysis.requiere_revision) addText(answerNode, 'p', '⚠ Requiere revisión humana', 'review-warning');
            } catch (error) { answerNode.textContent = 'Error: ' + error.message; }
            finally { if (submitButton) submitButton.disabled = false; }
          });
          load();
        </script>
      </body>
    </html>
  `);
});

app.get('/health', async (_request, reply) => {
  if (isMysqlEnabled()) {
    try {
      await getMysqlPool().query('SELECT 1');
    } catch {
      return reply.code(503).send({ ok: false, service: 'control-gmail' });
    }
  }
  return { ok: true, service: 'control-gmail' };
});

app.get('/me', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (!user) return reply.code(403).send({ error: 'Usuario no registrado.' });
  const context = readSessionContext(request.headers.cookie);
  return { email: user.email, organizationId: context?.organizationId ?? user.organizationId, role: user.role };
});

app.get('/admin/users', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });
  return { users: await listUsers() };
});

app.post<{ Body: { email?: string; role?: string } }>('/admin/users', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });

  const targetEmail = request.body?.email?.trim().toLowerCase();
  const role = request.body?.role;
  if (!targetEmail || !targetEmail.includes('@')) return reply.code(400).send({ error: 'Introduce un correo válido.' });
  if (role !== 'admin' && role !== 'commercial') return reply.code(400).send({ error: 'Rol no válido.' });

  const target = await authorizeUser(targetEmail, role, user.organizationId);
  return { user: { email: target.email, organizationId: target.organizationId, role: target.role, accessStatus: target.accessStatus } };
});

app.post<{ Params: { email: string } }>('/admin/users/:email/disconnect', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });
  const targetEmail = request.params.email.trim().toLowerCase();
  if (targetEmail === email.toLowerCase()) return reply.code(400).send({ error: 'No puedes desconectar tu propia cuenta de administrador.' });
  const target = await getUser(targetEmail);
  if (!target || target.organizationId !== user.organizationId) return reply.code(404).send({ error: 'Usuario no encontrado.' });
  const updated = await disconnectUser(targetEmail);
  await deleteGoogleTokens(targetEmail);
  const organization = await getOrganization(user.organizationId);
  await updateOrganizationAiSettings(user.organizationId, {
    provider: organization?.sharedAiProvider,
    sharedAiUserEmails: (organization?.sharedAiUserEmails ?? []).filter((item) => item.toLowerCase() !== targetEmail),
  });
  return { user: updated };
});

app.delete<{ Params: { email: string } }>('/admin/users/:email', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });
  const targetEmail = request.params.email.trim().toLowerCase();
  if (targetEmail === email.toLowerCase()) return reply.code(400).send({ error: 'No puedes eliminar tu propia cuenta de administrador.' });
  const target = await getUser(targetEmail);
  if (!target || target.organizationId !== user.organizationId) return reply.code(404).send({ error: 'Usuario no encontrado.' });
  const deleted = await deleteUser(targetEmail);
  await deletePersonalAiConnection(user.organizationId, targetEmail);
  await deleteGoogleTokens(targetEmail);
  const organization = await getOrganization(user.organizationId);
  await updateOrganizationAiSettings(user.organizationId, {
    provider: organization?.sharedAiProvider,
    sharedAiUserEmails: (organization?.sharedAiUserEmails ?? []).filter((item) => item.toLowerCase() !== targetEmail),
  });
  return { user: deleted };
});

function aiProviderCatalog() {
  return (['openai', 'claude', 'deepseek'] as const).reduce<Record<string, { label: string; configured: boolean; model: string; models: string[] }>>((catalog, provider) => {
    const models = getAiModels(provider);
    catalog[provider] = {
      label: aiProviderLabels[provider],
      configured: Boolean(getAiApiKey(provider)),
      model: models[0] ?? getDefaultAiModel(provider),
      models,
    };
    return catalog;
  }, {});
}

app.get('/admin/ai', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });

  const organization = await getOrganization(user.organizationId);
  const sharedAiUserEmails = organization?.sharedAiUserEmails ?? [];
  const activeProvider = normalizeAiProvider(organization?.sharedAiProvider ?? process.env.DEFAULT_AI_PROVIDER ?? 'openai') ?? 'openai';
  const providers = aiProviderCatalog();
  const users = (await listUsers())
    .filter((item) => item.organizationId === user.organizationId)
    .map((item) => ({
      email: item.email,
      role: item.role,
      canUseSharedAi: item.role === 'admin' || item.aiAccessEnabled === true || sharedAiUserEmails.includes(item.email.toLowerCase()),
      aiAccessEnabled: item.role === 'admin' || item.aiAccessEnabled === true || sharedAiUserEmails.includes(item.email.toLowerCase()),
      aiProvider: item.role === 'admin' ? undefined : item.aiProvider,
      aiModel: item.role === 'admin' ? undefined : item.aiModel,
    }));

  return {
    organizationId: user.organizationId,
    activeProvider,
    activeModel: organization?.sharedAiModel ?? getDefaultAiModel(activeProvider),
    providers,
    users,
  };
});

app.put<{ Body: { provider?: string; model?: string } }>('/admin/ai', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });

  const provider = normalizeAiProvider(request.body?.provider);
  if (!provider) return reply.code(400).send({ error: 'Proveedor no válido.' });
  const model = request.body?.model?.trim() || getDefaultAiModel(provider);
  if (!isSupportedAiModel(provider, model)) return reply.code(400).send({ error: 'Modelo no válido para el proveedor seleccionado.' });
  if (!getAiApiKey(provider)) return reply.code(400).send({ error: `No hay una clave ${provider.toUpperCase()}_API_KEY configurada en .env.` });

  const organization = await getOrganization(user.organizationId);
  const updated = await updateOrganizationAiSettings(user.organizationId, {
    provider,
    model,
    sharedAiUserEmails: organization?.sharedAiUserEmails ?? [],
  });
  return { activeProvider: updated?.sharedAiProvider ?? provider, activeModel: updated?.sharedAiModel ?? model };
});

app.patch<{ Params: { email: string }; Body: { canUseSharedAi?: boolean; aiAccessEnabled?: boolean; provider?: string; model?: string } }>('/admin/ai/users/:email', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (user?.role !== 'admin') return reply.code(403).send({ error: 'No tienes permisos de administración.' });

  const target = (await listUsers()).find((item) => item.email.toLowerCase() === request.params.email.toLowerCase());
  if (!target || target.organizationId !== user.organizationId) return reply.code(404).send({ error: 'Usuario no encontrado.' });
  const organization = await getOrganization(user.organizationId);
  const current = new Set(organization?.sharedAiUserEmails ?? []);
  const accessEnabled = request.body?.aiAccessEnabled ?? request.body?.canUseSharedAi;
  if (accessEnabled === true) current.add(target.email.toLowerCase());
  if (accessEnabled === false) current.delete(target.email.toLowerCase());

  // El administrador no tiene una asignación individual: siempre hereda la global.
  const hasProviderUpdate = target.role !== 'admin' && request.body?.provider !== undefined;
  const provider = hasProviderUpdate ? normalizeAiProvider(request.body?.provider) : target.aiProvider;
  if (hasProviderUpdate && !provider) return reply.code(400).send({ error: 'Proveedor no válido.' });
  const model = request.body?.model?.trim() || (provider ? target.aiModel ?? getDefaultAiModel(provider) : undefined);
  if (provider && model && !isSupportedAiModel(provider, model)) return reply.code(400).send({ error: 'Modelo no válido para el proveedor seleccionado.' });
  if (provider && !getAiApiKey(provider)) return reply.code(400).send({ error: `No hay una clave ${provider.toUpperCase()}_API_KEY configurada en .env.` });

  const updatedUser = await updateUserAiSettings(target.email, {
    aiAccessEnabled: accessEnabled,
    aiProvider: hasProviderUpdate ? provider : undefined,
    aiModel: hasProviderUpdate ? model : undefined,
  });
  await updateOrganizationAiSettings(user.organizationId, {
    provider: organization?.sharedAiProvider,
    sharedAiUserEmails: [...current],
  });
  return {
    email: target.email,
    canUseSharedAi: target.role === 'admin' || Boolean(updatedUser?.aiAccessEnabled),
    aiAccessEnabled: target.role === 'admin' || Boolean(updatedUser?.aiAccessEnabled),
    aiProvider: target.role === 'admin' ? undefined : updatedUser?.aiProvider,
    aiModel: target.role === 'admin' ? undefined : updatedUser?.aiModel,
  };
});

app.get('/ai/connections', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (!user) return reply.code(403).send({ error: 'Usuario no registrado.' });

  const organization = await getOrganization(user.organizationId);
  const provider = normalizeAiProvider(organization?.sharedAiProvider ?? process.env.DEFAULT_AI_PROVIDER ?? 'openai') ?? 'openai';
  const companyModel = organization?.sharedAiModel ?? getDefaultAiModel(provider);
  // El administrador hereda siempre el proveedor y modelo globales.
  const assignedProvider = user.role === 'admin' ? null : normalizeAiProvider(user.aiProvider);
  const assignedModel = assignedProvider ? user.aiModel ?? getDefaultAiModel(assignedProvider) : undefined;
  const canUseCompany = user.role === 'admin' || user.aiAccessEnabled === true || Boolean(organization?.sharedAiUserEmails?.includes(email.toLowerCase()));
  const effectiveProvider = assignedProvider ?? provider;
  const effectiveModel = assignedModel ?? companyModel;
  const effectiveConfigured = Boolean(getAiApiKey(effectiveProvider));
  const personal = await getPersonalAiConnectionStatus(user.organizationId, email);
  const activeConnection = personal
    ? { mode: 'user_personal', provider: personal.provider, model: personal.model ?? getDefaultAiModel(personal.provider) }
    : canUseCompany && effectiveConfigured
      ? { mode: 'company_shared', provider: effectiveProvider, model: effectiveModel }
      : null;

  return {
    account: email,
    role: user.role,
    organizationId: user.organizationId,
    company: {
      provider: effectiveProvider,
      mode: 'company_shared',
      status: effectiveConfigured ? 'active' : 'not_configured',
      model: effectiveModel,
      models: getAiModels(effectiveProvider),
      canUse: canUseCompany,
      assignedProvider,
      assignedModel,
    },
    providers: aiProviderCatalog(),
    personal,
    activeConnection,
  };
});

app.post<{ Body: { provider?: string; model?: string; apiKey?: string } }>('/ai/connections/personal', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (!user) return reply.code(403).send({ error: 'Usuario no registrado.' });

  const provider = normalizeAiProvider(request.body?.provider);
  const model = request.body?.model?.trim() || (provider ? getDefaultAiModel(provider) : '');
  const apiKey = request.body?.apiKey?.trim();
  if (!provider) return reply.code(400).send({ error: 'Proveedor no válido.' });
  if (!isSupportedAiModel(provider, model)) return reply.code(400).send({ error: 'Modelo no válido para el proveedor seleccionado.' });
  if (!apiKey || apiKey.length < 10) return reply.code(400).send({ error: 'Introduce una clave de API válida.' });

  try {
    await savePersonalAiConnection({
      organizationId: user.organizationId,
      userEmail: email,
      provider,
      model,
      apiKey,
    });
    return { connected: true, provider, model, mode: 'user_personal' };
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : 'No se pudo guardar la conexión personal.' });
  }
});

app.delete('/ai/connections/personal', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const user = await getUser(email);
  if (!user) return reply.code(403).send({ error: 'Usuario no registrado.' });

  await deletePersonalAiConnection(user.organizationId, email);
  return { connected: false };
});

app.post<{ Body: { question?: string; clientEmail?: string; analysisDays?: number; analysisFrom?: string; analysisTo?: string; analysisScope?: 'mailbox' | 'all' | 'spam' } }>('/assistant/ask', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const question = request.body?.question?.trim();
  if (!question) return reply.code(400).send({ error: 'Indica una pregunta.' });

  try {
    const context = readSessionContext(request.headers.cookie);
    const clientEmail = request.body?.clientEmail?.trim() || undefined;
    const analysisWindow = getAnalysisWindow({
      days: request.body?.analysisDays,
      from: request.body?.analysisFrom,
      to: request.body?.analysisTo,
      scope: request.body?.analysisScope,
    });
    await refreshGmailAccount(email, analysisWindow);
    const assistantResult = await askCommercialAssistant(email, question, context?.organizationId, analysisWindow, clientEmail);
    return {
      account: email,
      organizationId: context?.organizationId,
      analysisWindow: { from: analysisWindow.from, to: analysisWindow.to, days: analysisWindow.days, scope: analysisWindow.scope },
      clientEmail,
      messageCount: assistantResult.messageCount,
      analysis: assistantResult.analysis,
    };
  } catch (error) {
    if (error instanceof Error && /fecha|rango máximo/.test(error.message)) {
      return reply.code(400).send({ error: error.message });
    }
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo consultar al asistente.'),
    });
  }
});

app.post('/gmail/sync', async (request, reply) => {
  const account = readSession(request.headers.cookie);
  if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    const monthStart = `${getApplicationDateInput().slice(0, 7)}-01`;
    const currentMonth = getAnalysisWindow({ from: monthStart });
    return { account, ...(await refreshGmailAccount(account, currentMonth)) };
  } catch (error) {
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo actualizar Gmail.'),
    });
  }
});

app.get<{ Querystring: { max?: string; mailbox?: string; pageToken?: string; refresh?: string; from?: string; to?: string; all?: string; search?: string } }>(
  '/gmail/messages',
  async (request, reply) => {
    const account = readSession(request.headers.cookie);
    if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

    try {
      const mailbox: GmailMailbox = request.query.mailbox === 'all'
        ? 'all'
        : request.query.mailbox === 'sent'
          ? 'sent'
        : request.query.mailbox === 'spam'
          ? 'spam'
          : request.query.mailbox === 'archived'
            ? 'archived'
            : request.query.mailbox === 'appArchived'
              ? 'appArchived'
              : request.query.mailbox === 'trash'
                ? 'trash'
            : 'inbox';
      const context = readSessionContext(request.headers.cookie);
      const page = await retryGmailRateLimited(() => listRecentMessagesPage(account, Number(request.query.max ?? 10), mailbox, request.query.pageToken, context?.organizationId, request.query.refresh === '1', request.query.from, request.query.to, request.query.all === '1', request.query.search));
      return { account, mailbox, messages: page.messages, nextPageToken: page.nextPageToken, pageCount: 'pageCount' in page ? page.pageCount : null, pageTokens: 'pageTokens' in page ? page.pageTokens : null, truncated: page.truncated ?? false };
    } catch (error) {
      if (error instanceof Error && /fecha/.test(error.message.toLowerCase())) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(500).send({
        error: gmailErrorMessage(error, 'No se pudieron leer los mensajes.'),
      });
    }
  },
);

app.get<{ Querystring: { action?: GmailActionName; outcome?: 'success' | 'error'; max?: string; scope?: string } }>('/gmail/actions', async (request, reply) => {
  const context = readSessionContext(request.headers.cookie);
  if (!context) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  try {
    const user = await getUser(context.email);
    const allUsers = request.query.scope === 'organization' && user?.role === 'admin';
    return {
      account: context.email,
      scope: allUsers ? 'organization' : 'user',
      actions: await listGmailActions({
        organizationId: context.organizationId,
        userEmail: context.email,
        allUsers,
        accountEmail: allUsers ? undefined : context.email,
        action: request.query.action,
        outcome: request.query.outcome,
        limit: Number(request.query.max ?? 100),
      }),
    };
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : 'No se pudo cargar la auditoría.' });
  }
});

app.get('/gmail/nav-counts', async (request, reply) => {
  const account = readSession(request.headers.cookie);
  if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    // Los contadores no deben iniciar tres análisis de Gmail en paralelo.
    // Cada pantalla carga su propio módulo al abrirse.
    const syncState = await getGmailSyncState(account);
    const storedMessages = syncState ? await listStoredGmailMessages(account, 'inbox', 10) : null;
    const analysisWindow = getAnalysisWindow();
    const [followUps, commitments] = syncState
      ? await Promise.all([
          listPendingFollowUps(account, 1000, analysisWindow, false),
          listDetectedCommitments(account, 1000, analysisWindow, false),
        ])
      : [null, null];
    return {
      account,
      // La bandeja necesita conservar su paginación real de Gmail. Compartimos
      // el contador, pero dejamos que mailbox.js solicite la primera página y
      // reciba su nextPageToken para poder cargar más mensajes.
      messages: null,
      followUps: followUps ? { followUps } : null,
      commitments: commitments ? { commitments } : null,
      messageCount: storedMessages ? storedMessages.messages.length : null,
      followUpCount: followUps ? followUps.length : null,
      commitmentCount: commitments ? commitments.length : null,
    };
  } catch (error) {
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudieron cargar los contadores.'),
    });
  }
});

app.get<{ Querystring: { max?: string; days?: string; from?: string; to?: string; refresh?: string; scope?: string } }>('/gmail/insights', async (request, reply) => {
  const account = readSession(request.headers.cookie);
  if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    if (request.query.refresh === '1') await refreshGmailAccount(account);
    const analysisWindow = getAnalysisWindow({
      scope: request.query.scope === 'all' ? 'all' : request.query.scope === 'spam' ? 'spam' : 'mailbox',
      days: request.query.days ? Number(request.query.days) : undefined,
      from: request.query.from,
      to: request.query.to,
    });
    const insights = await listAccountInsights(account, Number(request.query.max ?? 25), analysisWindow);
    return { account, analysisWindow: { from: analysisWindow.from, to: analysisWindow.to, days: analysisWindow.days }, insights };
  } catch (error) {
    if (error instanceof Error && /fecha|rango máximo/.test(error.message)) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo preparar el informe.'),
    });
  }
});

app.get<{ Querystring: { max?: string; page?: string; age?: string; category?: string; search?: string; days?: string; from?: string; to?: string } }>('/gmail/follow-ups', async (request, reply) => {
  const account = readSession(request.headers.cookie);
  if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    const analysisWindow = getAnalysisWindow({
      days: request.query.days ? Number(request.query.days) : undefined,
      from: request.query.from,
      to: request.query.to,
    });
    const result = await retryGmailRateLimited(() => listPendingFollowUpsPage(
      account,
      Number(request.query.max ?? 10),
      Number(request.query.page ?? 1),
      analysisWindow,
      request.query.age ?? 'all',
      request.query.category ?? 'all',
      request.query.search ?? '',
    ));
    return { account, analysisWindow: { from: analysisWindow.from, to: analysisWindow.to, days: analysisWindow.days }, ...result };
  } catch (error) {
    if (error instanceof Error && /fecha|rango máximo/.test(error.message)) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudieron detectar seguimientos.'),
    });
  }
});

app.get<{ Querystring: { max?: string; days?: string; from?: string; to?: string } }>('/gmail/commitments', async (request, reply) => {
  const account = readSession(request.headers.cookie);
  if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    const analysisWindow = getAnalysisWindow({
      days: request.query.days ? Number(request.query.days) : undefined,
      from: request.query.from,
      to: request.query.to,
    });
    const limit = Math.min(Math.max(Math.floor(Number(request.query.max) || 10), 1), 1000);
    const commitments = await listDetectedCommitments(account, limit + 1, analysisWindow);
    const syncState = await getGmailSyncState(account);
    return {
      account, analysisWindow: { from: analysisWindow.from, to: analysisWindow.to, days: analysisWindow.days },
      commitments: commitments.slice(0, limit), hasMore: commitments.length > limit,
      truncated: Boolean(syncState?.truncated),
    };
  } catch (error) {
    if (error instanceof Error && /fecha|rango máximo/.test(error.message)) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudieron detectar compromisos.'),
    });
  }
});

app.get<{ Querystring: { email?: string; max?: string } }>('/gmail/client-history', async (request, reply) => {
  const account = readSession(request.headers.cookie);
  if (!account) return reply.code(401).send({ error: 'Sesión no iniciada.' });
  const clientEmail = request.query.email?.trim();
  if (!clientEmail) return reply.code(400).send({ error: 'Indica el correo del cliente.' });

  try {
    const messages = await listClientHistory(account, clientEmail, Number(request.query.max ?? 50));
    return { account, clientEmail, messages };
  } catch (error) {
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo cargar el historial del cliente.'),
    });
  }
});

app.get<{ Params: { threadId: string } }>('/gmail/threads/:threadId', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    return { account: email, messages: await getThreadMessages(email, request.params.threadId) };
  } catch (error) {
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo leer el hilo.'),
    });
  }
});

app.get<{ Params: { messageId: string } }>('/gmail/messages/:messageId', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    return { account: email, message: await getMessageMetadata(email, request.params.messageId) };
  } catch (error) {
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo cargar el mensaje para responder.'),
    });
  }
});

app.patch<{ Params: { messageId: string }; Body: { action?: GmailMessageAction } }>(
  '/gmail/messages/:messageId',
  async (request, reply) => {
    const email = readSession(request.headers.cookie);
    if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });

    const action = request.body?.action;
    if (!action || !['markRead', 'markUnread', 'archive', 'unarchive', 'trash', 'restore'].includes(action)) {
      return reply.code(400).send({ error: 'Acción de correo no válida.' });
    }

    try {
      const context = readSessionContext(request.headers.cookie);
      const result = await modifyGmailMessage(email, request.params.messageId, action);
      if (context) {
        try {
          await recordGmailAction({
            organizationId: context.organizationId,
            userEmail: context.email,
            accountEmail: email,
            messageId: request.params.messageId,
            action,
            outcome: 'success',
          });
        } catch (auditError) {
          request.log.error({ err: auditError }, 'No se pudo registrar la acción de Gmail');
        }
      }
      return { account: email, ...result };
    } catch (error) {
      const context = readSessionContext(request.headers.cookie);
      if (context) {
        try {
          await recordGmailAction({
            organizationId: context.organizationId,
            userEmail: context.email,
            accountEmail: email,
            messageId: request.params.messageId,
            action,
            outcome: 'error',
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          });
        } catch (auditError) {
          request.log.error({ err: auditError }, 'No se pudo registrar el error de Gmail');
        }
      }
      return reply.code(500).send({
        error: gmailErrorMessage(error, 'No se pudo aplicar la acción al correo.'),
      });
    }
  },
);

app.post<{ Body: GmailSendInput }>('/gmail/send', async (request, reply) => {
  const email = readSession(request.headers.cookie);
  if (!email) return reply.code(401).send({ error: 'Sesión no iniciada.' });

  try {
    const context = readSessionContext(request.headers.cookie);
    const result = await sendGmailMessage(email, request.body ?? { to: '', subject: '', body: '' });
    // Gmail confirma el envío antes de que el índice local conozca el mensaje.
    // Sin esta sincronización, «Enviados» puede seguir mostrando la instantánea
    // anterior durante el intervalo normal de sincronización.
    try {
      await syncGmailAccount(email);
    } catch (syncError) {
      // El mensaje ya se ha enviado; no convertimos un fallo de refresco en un
      // falso error de envío. La siguiente carga volverá a sincronizar Gmail.
      request.log.error({ err: syncError }, 'El correo se envió, pero no se pudo actualizar la bandeja inmediatamente');
    }
    if (context) {
      try {
        await recordGmailAction({
          organizationId: context.organizationId,
          userEmail: context.email,
          accountEmail: email,
          messageId: result.messageId ?? 'new-message',
          action: 'send',
          outcome: 'success',
        });
      } catch (auditError) {
        request.log.error({ err: auditError }, 'No se pudo registrar el envío de Gmail');
      }
    }
    return { account: email, ...result };
  } catch (error) {
    const context = readSessionContext(request.headers.cookie);
    if (context) {
      try {
        await recordGmailAction({
          organizationId: context.organizationId,
          userEmail: context.email,
          accountEmail: email,
          messageId: 'send-failed',
          action: 'send',
          outcome: 'error',
          errorCode: error instanceof Error ? error.name : 'UNKNOWN',
        });
      } catch (auditError) {
        request.log.error({ err: auditError }, 'No se pudo registrar el error de envío de Gmail');
      }
    }
    return reply.code(500).send({
      error: gmailErrorMessage(error, 'No se pudo enviar el correo.'),
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
      if (error === 'access_denied') {
        return reply.redirect(frontendUrl + '/?authError=access_denied');
      }
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
      const user = await upsertUser(profile.emailAddress);
      reply.header('Set-Cookie', sessionCookieHeaderForOrganization(profile.emailAddress, user.organizationId));
      return reply.redirect(frontendUrl + '/mailbox?connected=' + encodeURIComponent(profile.emailAddress));
    } catch (callbackError) {
      request.log.error({ err: callbackError }, 'Falló el callback OAuth de Google');
      if (callbackError instanceof Error && callbackError.message.includes('no está autorizada')) {
        return reply.code(403).send({ error: callbackError.message });
      }
      return reply.code(500).send({
        error: callbackError instanceof Error ? callbackError.message : 'Falló la autorización.',
      });
    }
  },
);

export async function startServer() {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port, host });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
