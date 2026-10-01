import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Talks to the Lehro MCP control plane (default http://localhost:4177),
// started by `lehrosol gui` or `lehrosol mcp start --http`. Set
// LEHRO_CONTROL_PLANE_URL to point the dashboard elsewhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // gui/src/lib/license.js reads the root package.json, which sits above the Vite root.
    fs: { allow: ['..'] },
    proxy: {
      '/rpc': {
        target: process.env.LEHRO_CONTROL_PLANE_URL || 'http://localhost:4177',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc/, '')
      }
    }
  }
});
