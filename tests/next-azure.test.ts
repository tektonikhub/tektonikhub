import assert from 'node:assert/strict';
import test from 'node:test';
import { azureClearSchema, azureGenerationSchema, azureRequestError, azureSaveSchema, normalizeAzureEndpoint } from '../lib/server/azure-policy';

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
  assert.equal(azureGenerationSchema.safeParse({ orgId, prompt: 'ventas', allowDataChanges: true }).success, true);
  assert.equal(azureGenerationSchema.safeParse({ orgId, prompt: 'ventas', allowDataChanges: 'true' }).success, false);
});
test('Azure explains rejected request parameters without forwarding upstream messages', () => {
  for (const [param, expected] of [
    ['model', /nombre exacto del deployment/], ['text.format', /formato JSON/], ['text.format.type', /formato JSON/],
    ['input', /JSON explícitamente/], ['instructions', /parámetro instructions/],
    ['max_output_tokens', /límites de salida/], ['store', /sin almacenar/],
  ] as const) {
    const message = azureRequestError(400, { error: { param, code: 'unsupported_parameter', message: fields.apiKey } });
    assert.match(message, /HTTP 400/); assert.match(message, expected); assert.ok(!message.includes(fields.apiKey));
  }
  assert.match(azureRequestError(400, { error: { code: 'OperationNotSupported' } }), /no admite esta operación/);
  assert.match(azureRequestError(400, { error: { code: 'unsupported_model' } }), /no admite esta operación/);
  assert.match(azureRequestError(400, { error: { code: 'DeploymentNotFound' } }), /nombre exacto de un deployment/);
  assert.match(azureRequestError(404, null), /recurso correcto/);
});
test('Azure keeps unknown and malformed error details private', () => {
  for (const value of [
    null, [], 'not JSON', { error: fields.apiKey }, { message: fields.apiKey },
    { error: { code: fields.apiKey, param: fields.apiKey, message: fields.apiKey } },
    { error: { code: { secret: fields.apiKey }, param: ['model'], message: fields.apiKey } },
  ]) {
    assert.equal(azureRequestError(400, value), 'Azure rechazó la solicitud (HTTP 400). Revisa el endpoint, el modelo desplegado y su compatibilidad con Responses y JSON.');
  }
});
