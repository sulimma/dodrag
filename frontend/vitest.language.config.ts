import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/i18n/i18n.audit.ts'] },
});
