import { DurableObject } from 'cloudflare:workers';

export interface Env {
	BLOCK: DurableObjectNamespace<Block>;
}

export class Block extends DurableObject {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request<unknown, CfProperties<unknown>>): Promise<Response> {
		const url = new URL(request.url);
		const [start, end] = getIndexes(url);
		if (isNaN(start) || isNaN(end)) return new Response('INDEX_QUERY_MALFORMED', { status: 400 });
		if (!request.body) return new Response('NEEDS_BODY', { status: 400 });
		const conf = { allowConcurrency: true, allowUnconfirmed: true };
		if (start === end) {
			this.ctx.storage.put(`BLOCK_${start}`, await request.bytes(), conf);
			return new Response('ok');
		}

		const reader = request.body.getReader({ mode: 'byob' });
		const chunkSize = 128 * 1024;
		const len = +(request.headers.get('Content-Length') ?? '');
		if (isNaN(len)) {
			return new Response('NO_CONTENT_LEN', { status: 400 });
		}

		for (let index = start; index <= end; index++) {
			const result = await reader.readAtLeast(chunkSize, new Uint8Array(chunkSize));
			this.ctx.storage.put(`BLOCK_${index}`, result.value, conf);
		}

		return new Response('OK');
	}

	async get(index: number): Promise<Response> {
		const blockChunk = await this.ctx.storage.get(`BLOCK_${index}`);
		if (blockChunk === null || blockChunk === undefined) return new Response('BLOCK_CHUNK_NOT_FOUND', { status: 404 });
		return new Response(blockChunk as Uint8Array);
	}

	async free(): Promise<number> {
		await this.ctx.storage.deleteAll();
		return 0;
	}
}

function getKey(url: URL) {
	const key = url.pathname.split('/').shift() ?? '/';
	if (key.trim() === '') return '/';
	return key;
}

function getIndex(url: URL) {
	const key = url.pathname.split('/').pop() ?? '0';
	if (key.trim() === '') return 0;
	return +key;
}

function getIndexes(url: URL) {
	const key = url.pathname.split('/').pop() ?? '0';
	if (key.trim() === '') return [0, 0];
	const k = key.split(',');
	if (k.length === 1) return [+key, +key];
	return [+k[0], +k[1]];
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			const url = new URL(request.url);
			const locationHint = (request.headers.get('X-Location-Hint') ?? 'enam') as DurableObjectLocationHint;
			const id: DurableObjectId = env.BLOCK.idFromName(getKey(url));
			const stub = env.BLOCK.get(id, { locationHint });
			if (request.method === 'DELETE') {
				await stub.free();
				return new Response();
			} else if (request.method === 'PUT') {
				return stub.fetch(request);
			} else if (request.method === 'GET') {
				const index = getIndex(url);
				return stub.get(index);
			}

			return new Response('I_DONT_UNDERSTAND', { status: 404 });
		} catch (err) {
			if (err instanceof Error) {
				console.error('Uhhh...', err.name, err.message, err.stack);
				return new Response(`ERROR: ${err.message}`, { status: 500 });
			}

			console.error('Welp.', err);
			return new Response('ERROR: system doesnt understand error, give us patience...', { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
