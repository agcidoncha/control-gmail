import { defineMiddleware } from 'astro:middleware';

const backendPaths = [
  '/auth',
  '/gmail',
  '/assistant',
  '/ai',
  '/admin',
  '/me',
  '/brand',
];

function belongsToBackend(pathname: string) {
  return backendPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function responseHeaders(response: Response) {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie')
      ? [response.headers.get('set-cookie') as string]
      : [];
  headers.delete('set-cookie');
  setCookies.forEach((cookie) => headers.append('set-cookie', cookie));
  return headers;
}

export const onRequest = defineMiddleware(async ({ request, url }, next) => {
  if (!belongsToBackend(url.pathname)) return next();

  const backendUrl = process.env.BACKEND_URL ?? `http://127.0.0.1:${process.env.BACKEND_PORT ?? '3003'}`;
  const target = new URL(url.pathname + url.search, backendUrl);

  const init: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(target, init);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response),
  });
});
