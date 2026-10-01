import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EuPiiRedactionApi implements ICredentialType {
	name = 'euPiiRedactionApi';

	displayName = 'EU PII Redaction API';

	icon: Icon = { light: 'file:euPiiRedaction.svg', dark: 'file:euPiiRedaction.dark.svg' };

	documentationUrl = 'https://github.com/JulianJohansen/n8n-nodes-eu-pii-redact#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'RapidAPI Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your RapidAPI key, subscribed to EU PII Redaction (the free plan works): https://rapidapi.com/JulianJohansen/api/eu-pii-redaction/pricing',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-RapidAPI-Key': '={{$credentials.apiKey}}',
				'X-RapidAPI-Host': 'eu-pii-redaction.p.rapidapi.com',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://eu-pii-redaction.p.rapidapi.com',
			url: '/types',
			method: 'GET',
		},
	};
}
