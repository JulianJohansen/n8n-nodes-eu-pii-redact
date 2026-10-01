import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

// Programmatic style: Redact derives a placeholder -> original value map from the API's
// offsets, and Restore runs locally without an API call. Declarative routing can do neither.

const API_URL = 'https://eu-pii-redaction.p.rapidapi.com/redact';
const MAX_CHARS = 50_000;

interface ApiEntity {
	type: string;
	start: number;
	end: number;
	placeholder?: string;
	country?: string;
	scheme?: string;
}

interface ApiResponse {
	redacted: string;
	entities: ApiEntity[];
}

export function originalsFrom(text: string, entities: ApiEntity[]): Record<string, string> {
	const originals: Record<string, string> = {};
	for (const e of entities) {
		// The first mention is the fullest one ("Karina Dahl" before "Karina").
		if (e.placeholder && !(e.placeholder in originals)) {
			originals[e.placeholder] = text.slice(e.start, e.end);
		}
	}
	return originals;
}

export function restore(text: string, originals: Record<string, string>): string {
	// Longest placeholder first, so "[PERSON_1]" never touches "[PERSON_10]".
	return Object.keys(originals)
		.sort((a, b) => b.length - a.length)
		.reduce((out, placeholder) => out.split(placeholder).join(originals[placeholder]), text);
}

export class EuPiiRedaction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EU PII Redaction',
		name: 'euPiiRedaction',
		icon: { light: 'file:euPiiRedaction.svg', dark: 'file:euPiiRedaction.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Replace names, EU national ID numbers, IBANs, emails and phones with placeholders before text reaches an LLM, and restore them afterwards',
		defaults: { name: 'EU PII Redaction' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'euPiiRedactionApi', required: true, displayOptions: { show: { operation: ['redact'] } } }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Redact',
						value: 'redact',
						description: 'Replace personal data in a text with placeholders',
						action: 'Redact personal data in a text',
					},
					{
						name: 'Restore',
						value: 'restore',
						description: 'Put the original values back into a text that contains placeholders',
						action: 'Restore original values in a text',
					},
				],
				default: 'redact',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['redact'] } },
				description: 'The text to redact (up to 50,000 characters)',
			},
			{
				displayName: 'Entity Types',
				name: 'types',
				type: 'multiOptions',
				options: [
					{ name: 'Credit Card', value: 'CREDIT_CARD' },
					{ name: 'Email', value: 'EMAIL' },
					{ name: 'EU VAT Number', value: 'EU_VAT' },
					{ name: 'IBAN', value: 'IBAN' },
					{ name: 'IP Address', value: 'IP_ADDRESS' },
					{ name: 'National ID Number', value: 'NATIONAL_ID' },
					{ name: 'Person Name', value: 'PERSON' },
					{ name: 'Phone', value: 'PHONE' },
				],
				default: [],
				displayOptions: { show: { operation: ['redact'] } },
				description: 'Which kinds of personal data to redact. Leave empty for all.',
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{
						name: 'Placeholders',
						value: 'label',
						description: 'Replace with [PERSON_1], [IBAN_1], …; the same value keeps the same placeholder',
					},
					{ name: 'Mask', value: 'mask', description: 'Replace each character with *' },
				],
				default: 'label',
				displayOptions: { show: { operation: ['redact'] } },
			},
			{
				displayName: 'Include Original Values',
				name: 'includeOriginals',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['redact'], mode: ['label'] } },
				description:
					'Whether to output an "originals" map (placeholder → original value) for the Restore operation. Turn off if the output may be stored or sent somewhere personal data must not go.',
			},
			{
				displayName: 'Text',
				name: 'restoreText',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['restore'] } },
				description: "Text containing placeholders, for example an AI node's answer",
			},
			{
				displayName: 'Originals',
				name: 'originals',
				type: 'json',
				default: '{}',
				required: true,
				displayOptions: { show: { operation: ['restore'] } },
				placeholder: "{{ $('EU PII Redaction').item.json.originals }}",
				description: 'The "originals" output of an earlier Redact operation (placeholder → original value)',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'restore') {
					const text = this.getNodeParameter('restoreText', i) as string;
					const raw = this.getNodeParameter('originals', i);
					const originals = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, string>;
					if (!originals || typeof originals !== 'object' || Array.isArray(originals)) {
						throw new NodeOperationError(this.getNode(), 'Originals must be an object of placeholder → value', {
							itemIndex: i,
						});
					}
					returnData.push({ json: { restored: restore(text, originals) }, pairedItem: { item: i } });
					continue;
				}

				const text = this.getNodeParameter('text', i) as string;
				const types = this.getNodeParameter('types', i, []) as string[];
				const mode = this.getNodeParameter('mode', i) as string;
				if (text.length > MAX_CHARS) {
					throw new NodeOperationError(
						this.getNode(),
						`Text is ${text.length} characters; the API accepts up to ${MAX_CHARS} per request. Split it first.`,
						{ itemIndex: i },
					);
				}
				const body: IDataObject = { text, mode };
				if (types.length) body.types = types;

				let response: ApiResponse;
				try {
					response = (await this.helpers.httpRequestWithAuthentication.call(this, 'euPiiRedactionApi', {
						method: 'POST',
						url: API_URL,
						body,
						json: true,
					})) as ApiResponse;
				} catch (error) {
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				}

				const counts: Record<string, number> = {};
				for (const e of response.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
				const json: IDataObject = {
					redacted: response.redacted,
					entities: response.entities as unknown as IDataObject[],
					counts,
				};
				if (mode === 'label' && this.getNodeParameter('includeOriginals', i, true)) {
					json.originals = originalsFrom(text, response.entities);
				}
				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Both constructors return the error unchanged when it already has their type.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
