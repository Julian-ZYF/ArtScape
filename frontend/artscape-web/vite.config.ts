import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import jwt from 'jsonwebtoken';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.ARTSCAPE_API_URL || 'http://localhost:3100';
  const demoSecret = env.ARTSCAPE_DEMO_JWT_SECRET;
  const demoToken = demoSecret
    ? jwt.sign({ roles: ['portfolio-owner'] }, demoSecret, {
        subject: env.ARTSCAPE_DEMO_USER_ID || 'artscape-demo-owner',
        issuer: env.JWT_ISSUER || 'artscape',
        audience: env.JWT_AUDIENCE || 'artscape-api',
        expiresIn: '12h',
        algorithm: 'HS256',
      })
    : undefined;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq) => {
              if (demoToken && !proxyReq.hasHeader('authorization')) {
                proxyReq.setHeader('authorization', `Bearer ${demoToken}`);
              } else if (!demoToken && !proxyReq.hasHeader('authorization')) {
                proxyReq.setHeader('x-user-id', env.ARTSCAPE_DEMO_USER_ID || 'artscape-demo-owner');
                proxyReq.setHeader('x-user-roles', 'portfolio-owner');
              }
            });
          },
        },
        '/health': { target, changeOrigin: true },
      },
    },
  };
});
