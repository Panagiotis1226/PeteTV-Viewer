import { defineConfig } from '@playwright/test';

// Playback tests need H.264/AAC: use Google Chrome (CI) or Chrome for Testing via CHROME_PATH.
const chrome = process.env.CHROME_PATH
  ? { launchOptions: { executablePath: process.env.CHROME_PATH } }
  : { channel: 'chrome' as const };

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 720 },
    ...chrome,
    launchOptions: { ...(chrome as { launchOptions?: object }).launchOptions, args: ['--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node tools/mock-iptv/server.js', url: 'http://localhost:9090/player_api.php', reuseExistingServer: true, timeout: 120000 },
    { command: 'node server/index.js', url: 'http://localhost:8080/api/health', reuseExistingServer: true, env: { ALLOW_PRIVATE_NETWORKS: 'true', PORT: '8080' } },
  ],
});
