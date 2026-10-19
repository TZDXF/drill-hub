import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

function devAutoReload(): Plugin {
  return {
    name: 'drill-hub-dev-auto-reload',
    transformIndexHtml(html) {
      const buildId = Date.now().toString(36);
      const reloadScript = `
(() => {
  const initial = document
    .querySelector('meta[name="drill-hub-dev-build"]')
    ?.getAttribute('content');
  if (!initial) return;
  let checking = false;
  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch('/', { cache: 'no-store' });
      const next = new DOMParser()
        .parseFromString(await response.text(), 'text/html')
        .querySelector('meta[name="drill-hub-dev-build"]')
        ?.getAttribute('content');
      if (next && next !== initial) location.reload();
    } catch {}
    finally {
      checking = false;
    }
  }, 1000);
})();
`;
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { name: 'drill-hub-dev-build', content: buildId },
            injectTo: 'head',
          },
          { tag: 'script', children: reloadScript, injectTo: 'body' },
        ],
      };
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins: [
    vue(),
    tailwindcss(),
    ...(command === 'build' && mode === 'development' ? [devAutoReload()] : []),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
}));
