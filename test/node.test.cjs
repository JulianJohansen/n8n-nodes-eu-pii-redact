// Runs the built node's execute() with a mocked n8n context.
// HTTP responses are real API outputs (test/fixtures.json), matched on the request body.
// Run after `npm run build`: node --test test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { EuPiiRedaction, restore, originalsFrom } = require('../dist/nodes/EuPiiRedaction/EuPiiRedaction.node.js');
const fixtures = require('./fixtures.json');

function context(itemParams, { continueOnFail = false, http } = {}) {
	const calls = [];
	return {
		calls,
		getInputData: () => itemParams.map(() => ({ json: {} })),
		getNodeParameter: (name, i, fallback) => (name in itemParams[i] ? itemParams[i][name] : fallback),
		getNode: () => ({ name: 'EU PII Redaction', type: 'euPiiRedaction', typeVersion: 1, parameters: {} }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ credential, options });
				if (http) return http(options);
				const hit = fixtures.find((f) => JSON.stringify(f.request) === JSON.stringify(options.body));
				if (!hit) throw new Error('no fixture for ' + JSON.stringify(options.body));
				return hit.response;
			},
		},
	};
}

const run = (ctx) => new EuPiiRedaction().execute.call(ctx);
const TICKET = fixtures[0].request.text;

test('redact returns placeholders, counts and originals', async () => {
	const ctx = context([{ operation: 'redact', text: TICKET, types: [], mode: 'label' }]);
	const [[out]] = await run(ctx);
	assert.equal(out.json.redacted, 'Hi, my name is [PERSON_1]. Refund to [IBAN_1].\n[PERSON_1]');
	assert.deepEqual(out.json.counts, { PERSON: 2, IBAN: 1 });
	assert.deepEqual(out.json.originals, { '[PERSON_1]': 'Karina Dahl', '[IBAN_1]': 'DK50 0040 0440 1162 43' });
	assert.deepEqual(out.pairedItem, { item: 0 });
	const { credential, options } = ctx.calls[0];
	assert.equal(credential, 'euPiiRedactionApi');
	assert.equal(options.url, 'https://eu-pii-redaction.p.rapidapi.com/redact');
	assert.deepEqual(options.body, { text: TICKET, mode: 'label' }); // no "types" when empty = all
});

test('originals can be switched off', async () => {
	const ctx = context([{ operation: 'redact', text: TICKET, types: [], mode: 'label', includeOriginals: false }]);
	const [[out]] = await run(ctx);
	assert.equal(out.json.originals, undefined);
	assert.ok(!JSON.stringify(out.json).includes('Karina'));
});

test('mask mode and type filter', async () => {
	const ctx = context([{ operation: 'redact', text: 'Karina Dahl <karina.dahl@example.com>', types: ['EMAIL'], mode: 'mask' }]);
	const [[out]] = await run(ctx);
	assert.equal(out.json.redacted, 'Karina Dahl <***********************>');
	assert.equal(out.json.originals, undefined);
});

test('national ID entities keep country and scheme', async () => {
	const ctx = context([{ operation: 'redact', text: 'PESEL: 44051401359, mail jan@example.nl', types: ['NATIONAL_ID'], mode: 'label' }]);
	const [[out]] = await run(ctx);
	assert.equal(out.json.redacted, 'PESEL: [NATIONAL_ID_1], mail jan@example.nl');
	assert.equal(out.json.entities[0].country, 'PL');
	assert.equal(out.json.entities[0].scheme, 'PESEL');
});

test('restore puts the values back without calling the API', async () => {
	const originals = { '[PERSON_1]': 'Karina Dahl', '[IBAN_1]': 'DK50 0040 0440 1162 43' };
	const ctx = context([
		{ operation: 'restore', restoreText: 'Hi [PERSON_1], refunded to [IBAN_1].', originals },
		{ operation: 'restore', restoreText: 'Bye [PERSON_1]', originals: JSON.stringify(originals) },
	]);
	const [out] = await run(ctx);
	assert.equal(out[0].json.restored, 'Hi Karina Dahl, refunded to DK50 0040 0440 1162 43.');
	assert.equal(out[1].json.restored, 'Bye Karina Dahl');
	assert.equal(ctx.calls.length, 0);
});

test('restore never confuses [PERSON_1] with [PERSON_10]', () => {
	const originals = {};
	for (let n = 1; n <= 10; n++) originals[`[PERSON_${n}]`] = `P${n}`;
	assert.equal(restore('[PERSON_10] and [PERSON_1]', originals), 'P10 and P1');
});

test('originalsFrom keeps the first (fullest) mention', () => {
	assert.deepEqual(
		originalsFrom('Karina Dahl … Karina', [
			{ type: 'PERSON', start: 0, end: 11, placeholder: '[PERSON_1]' },
			{ type: 'PERSON', start: 14, end: 20, placeholder: '[PERSON_1]' },
		]),
		{ '[PERSON_1]': 'Karina Dahl' },
	);
});

test('text over 50,000 characters is rejected before calling the API', async () => {
	const ctx = context([{ operation: 'redact', text: 'x'.repeat(50_001), types: [], mode: 'label' }]);
	await assert.rejects(run(ctx), (e) => e instanceof NodeOperationError && /50000/.test(e.message));
	assert.equal(ctx.calls.length, 0);
});

test('invalid originals are a NodeOperationError', async () => {
	const ctx = context([{ operation: 'restore', restoreText: 'x', originals: [] }]);
	await assert.rejects(run(ctx), (e) => e instanceof NodeOperationError);
});

test('API failures become NodeApiError with the item index', async () => {
	const ctx = context([{ operation: 'redact', text: 'x', types: [], mode: 'label' }], {
		http: () => {
			const err = new Error('Request failed with status code 403');
			err.httpCode = '403';
			throw err;
		},
	});
	await assert.rejects(run(ctx), (e) => e instanceof NodeApiError && e.context.itemIndex === 0);
});

test('continueOnFail turns errors into output items', async () => {
	const ctx = context(
		[
			{ operation: 'redact', text: 'x'.repeat(50_001), types: [], mode: 'label' },
			{ operation: 'redact', text: TICKET, types: [], mode: 'label' },
		],
		{ continueOnFail: true },
	);
	const [out] = await run(ctx);
	assert.match(out[0].json.error, /50000/);
	assert.equal(out[1].json.counts.PERSON, 2);
});
