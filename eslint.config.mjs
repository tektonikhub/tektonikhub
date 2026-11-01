import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { files: ['app/layout.tsx'], rules: { '@next/next/no-page-custom-font': 'off' } },
  globalIgnores(['.next/**', 'public/**', 'Old/**', 'server/**', 'node_modules/**']),
]);
