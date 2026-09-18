import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  webServer: {
    command: 'npm run dev -- --port 3100',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      DATABASE_MODE: 'local',
      LOCAL_DATABASE_PATH: mkdtempSync(join(tmpdir(), 'agendamagno-e2e-')),
      APP_URL: 'http://localhost:3100',
      PANEL_PASSWORD: 'test-password-only',
      PANEL_PASSWORD_HASH: '',
      SESSION_SECRET: 'test-secret-only-not-for-production-123456789',
      LLM_PROVIDER: 'none',
      N8N_PROCESS_WEBHOOK_URL: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
