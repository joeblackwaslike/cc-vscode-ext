import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    files: 'out/test/integration/**/*.test.js',
    extensionDevelopmentPath: '.',
    workspaceFolder: '.',
    mocha: { timeout: 15000 },
  },
]);
