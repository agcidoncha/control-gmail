import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  vite: {
    server: {
      proxy: {
        '/me': 'http://127.0.0.1:3000',
        '/gmail': 'http://127.0.0.1:3000',
        '/assistant': 'http://127.0.0.1:3000',
        '/auth': 'http://127.0.0.1:3000',
        '/brand': 'http://127.0.0.1:3000',
      },
    },
  },
});
