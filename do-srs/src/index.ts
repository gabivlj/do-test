import { DurableObject } from 'cloudflare:workers';

export interface Env {
	BLOCK: DurableObjectNamespace<Block>;
}

export class Block extends DurableObject {
	sql = this.ctx.storage.sql;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		ctx.blockConcurrencyWhile(async () => {
			this.sql.exec('CREATE TABLE IF NOT EXISTS blobs (i INTEGER PRIMARY KEY, blob BLOB);');
		});
	}

	async fetch(request: Request<unknown, CfProperties<unknown>>): Promise<Response> {
		const url = new URL(request.url);
		const [start, end] = getIndexes(url);
		if (isNaN(start) || isNaN(end)) return new Response('INDEX_QUERY_MALFORMED', { status: 400 });
		if (!request.body) return new Response('NEEDS_BODY', { status: 400 });
		const insertQuery = `INSERT INTO blobs (i, blob) VALUES (?, ?) ON CONFLICT (i) DO UPDATE SET blob = EXCLUDED.blob;`;

		if (start === end) {
			const bytes = await request.bytes();
			this.sql.exec(insertQuery, start, bytes);
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
			if (result.done) break;
			this.sql.exec(insertQuery, index, result.value.buffer);
		}

		return new Response('OK');
	}

	async get(index: number): Promise<Response> {
		const res = this.sql.exec('SELECT blob FROM blobs WHERE i = ?', index);
		const value = res.next();
		if (value.value !== undefined && value.value['blob'] instanceof ArrayBuffer) {
			return new Response(value.value['blob']);
		}

		return new Response('not found', { status: 404 });
	}

	async free(): Promise<number> {
		this.sql.exec('DROP TABLE blobs');
		await this.ctx.storage.deleteAll();
		return 0;
	}
}

function getKey(url: URL) {
	const key = url.pathname.split('/').slice(1).shift() ?? '/';
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
	async fetch(request, env: Env, ctx): Promise<Response> {
		try {
			const url = new URL(request.url);
			const locationHint = (request.headers.get('X-Location-Hint') ?? 'enam') as DurableObjectLocationHint;
			const k = getKey(url);
			const id: DurableObjectId = env.BLOCK.idFromName(k);
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
