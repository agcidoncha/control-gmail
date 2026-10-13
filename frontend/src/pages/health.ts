import type { APIRoute } from 'astro';

export const GET: APIRoute = () => new Response(JSON.stringify({ ok: true, service: 'control-gmail-frontend' }), {
  headers: { 'content-type': 'application/json; charset=utf-8' },
});
