'use strict';
const originalFetch = globalThis.fetch;
const backend = new URL(process.env.TEKTONIK_TEST_BACKEND);
if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1') throw new Error('Synthetic backend must use loopback.');
const endpoints = new Set([
  'https://myviarapida-resource.services.ai.azure.com/openai/v1/responses',
  'https://second-test.openai.azure.com/openai/v1/responses',
]);
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (endpoints.has(url.href)) {
    const headers = new Headers(options?.headers);
    headers.set('x-mock-azure-url', url.href);
    return originalFetch(new URL('/mock/azure/responses', backend), { ...options, headers });
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Production integration tests cannot call external services.');
  return originalFetch(input, options);
};
