import assert from 'node:assert/strict';
import test from 'node:test';
import { azureClearSchema, azureGenerationSchema, azureSaveSchema, normalizeAzureEndpoint } from '../lib/server/azure-policy';

const orgId = '00000000-0000-4000-8000-000000000001';
const fields = {
  orgId, endpoint: 'https://myviarapida-resource.services.ai.azure.com/openai/v1/responses',
  deployment: 'my-deployed-model', apiKey: 'synthetic-not-a-real-api-key', version: 0,
};
test('Azure accepts the supplied Foundry Responses endpoint and normalizes only known v1 paths', () => {
  assert.equal(normalizeAzureEndpoint(fields.endpoint), fields.endpoint);
  for (const host of ['myviarapida-resource.services.ai.azure.com', 'resource.openai.azure.com']) {
    for (const path of ['', '/', '/openai/v1', '/openai/v1/', '/openai/v1/responses', '/openai/v1/responses/']) {
      assert.equal(normalizeAzureEndpoint(`https://${host}${path}`), `https://${host}/openai/v1/responses`);
    }
  }
});
test('Azure rejects arbitrary proxy destinations, credentials, ports, fragments and queries', () => {
  for (const endpoint of [
    'http://resource.openai.azure.com/openai/v1/responses', 'https://127.0.0.1/openai/v1/responses',
    'https://resource.openai.azure.com.evil.invalid/openai/v1/responses',
    'https://resource.services.ai.azure.com.evil.invalid/openai/v1/responses',
    'https://resource-.openai.azure.com/openai/v1/responses', 'https://resource.openai.azure.com:444/openai/v1/responses',
    'https://user:password@resource.openai.azure.com/openai/v1/responses',
    'https://resource.openai.azure.com/openai/v1/responses?api-version=preview',
    'https://resource.openai.azure.com/openai/v1/responses#fragment',
    'https://resource.openai.azure.com/openai/v1/chat/completions',
    'https://resource.openai.azure.com/openai/v1/responses/../models',
    'https://sub.resource.openai.azure.com/openai/v1/responses',
  ]) assert.throws(() => normalizeAzureEndpoint(endpoint), /Usa/, endpoint);
});
test('Azure settings require an organization, deployment, bounded key and concurrency version', () => {
  assert.deepEqual(azureSaveSchema.parse(fields), fields);
  assert.equal(azureSaveSchema.parse({ ...fields, apiKey: '' }).apiKey, '');
  for (const change of [
    { orgId: '#4029' }, { deployment: '' }, { deployment: 'model/path' }, { deployment: 'x'.repeat(129) },
    { apiKey: 'short' }, { apiKey: 'x'.repeat(513) }, { apiKey: 'key\nheader' },
    { version: undefined }, { version: -1 }, { version: 1.5 }, { version: 2147483648 }, { unexpected: true },
  ]) assert.equal(azureSaveSchema.safeParse({ ...fields, ...change }).success, false);
  assert.equal(azureClearSchema.safeParse({ orgId, version: 3 }).success, true);
  assert.equal(azureClearSchema.safeParse({ orgId }).success, false);
});
test('Azure validates generation input before charging or sending it to the provider', () => {
  assert.equal(azureGenerationSchema.safeParse({ orgId, prompt: 'Dashboard de ventas', previous: null }).success, true);
  for (const prompt of ['', '   ', 'x'.repeat(2001)]) {
    assert.equal(azureGenerationSchema.safeParse({ orgId, prompt }).success, false);
  }
  assert.equal(azureGenerationSchema.safeParse({ orgId, prompt: 'ventas', endpoint: 'https://evil.invalid' }).success, false);
});
