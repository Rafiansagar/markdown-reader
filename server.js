#!/usr/bin/env node
/*
 * Local server for the WP Readme Viewer.
 *
 *   node server.js            -> http://localhost:4321
 *   node server.js --open     -> also opens the browser
 *   PORT=5000 node server.js
 *
 * It serves the viewer and lets it read any readme on this PC (file or plugin
 * folder) or on the web (any URL, no CORS limits), and pushes changes live.
 * Listens on 127.0.0.1 only.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const PORT = +process.env.PORT || 4321;
const HOST = '127.0.0.1';
const ROOT = __dirname;
const URL_POLL_MS = +process.env.POLL_MS || 4000;
const FILE_SAFETY_POLL_MS = 3000;

const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/readme-parser.js': 'readme-parser.js' };
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp'
};
const ASSET_RE = /^(banner-(?:772x250|1544x500)|icon-(?:128x128|256x256)|icon|screenshot-\d+)\.(png|jpe?g|gif|svg|webp)$/i;
const README_NAMES = ['readme.txt', 'readme.md'];

/* ---------- helpers ---------- */

function send(res, status, body, type) {
	res.writeHead(status, {
		'Content-Type': type || 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff'
	});
	res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function sha(s) {
	return crypto.createHash('sha1').update(s).digest('hex');
}

async function fetchText(url) {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), 15000);
	try {
		const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'wp-readme-viewer', 'Cache-Control': 'no-cache' } });
		if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
		return await r.text();
	} catch (e) {
		if (e.name === 'AbortError') throw new Error('Timed out fetching ' + url);
		throw e.cause && e.cause.code ? new Error(e.cause.code + ' fetching ' + url) : e;
	} finally {
		clearTimeout(timer);
	}
}

// Turns page URLs into the raw readme they show.
function normalizeUrl(u) {
	let m;
	if ((m = u.match(/^https?:\/\/(?:[\w-]+\.)?wordpress\.org\/plugins\/([a-z0-9-]+)/i))) {
		return { url: `https://plugins.svn.wordpress.org/${m[1]}/trunk/readme.txt`, wpSlug: m[1].toLowerCase() };
	}
	if ((m = u.match(/^https?:\/\/plugins\.svn\.wordpress\.org\/([a-z0-9-]+)\/?(.*?)\/?$/i))) {
		let rest = m[2] || 'trunk';
		if (!/\.(txt|md)$/i.test(rest)) rest += '/readme.txt';
		return { url: `https://plugins.svn.wordpress.org/${m[1]}/${rest}`, wpSlug: m[1].toLowerCase() };
	}
	if ((m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i))) {
		return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` };
	}
	if ((m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i))) {
		return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/readme.txt` };
	}
	return { url: u };
}

async function findReadme(dir) {
	const names = await fsp.readdir(dir);
	for (const want of README_NAMES) {
		const hit = names.find((n) => n.toLowerCase() === want);
		if (hit) return path.join(dir, hit);
	}
	return null;
}

async function resolveSource(src) {
	src = String(src || '').trim().replace(/^["']+|["']+$/g, '');
	if (!src) throw new Error('Enter a file, a plugin folder or a URL.');

	if (/^https?:\/\//i.test(src)) return Object.assign({ kind: 'url', label: src }, normalizeUrl(src));

	if (/^file:\/\//i.test(src)) src = fileURLToPath(src);
	let p = path.resolve(src);
	let st;
	try {
		st = await fsp.stat(p);
	} catch (e) {
		throw new Error('Not found: ' + p);
	}
	if (st.isDirectory()) {
		const f = await findReadme(p);
		if (!f) throw new Error('No readme.txt in ' + p);
		p = f;
	}
	return { kind: 'file', file: p, label: p };
}

// Where plugin images usually live, relative to the readme.
function assetDirs(file) {
	const dir = path.dirname(file);
	return [dir, path.join(dir, '.wordpress-org'), path.join(dir, 'assets'), path.join(dir, '..', 'assets')];
}

async function localAssets(file) {
	const out = {};
	for (const d of assetDirs(file)) {
		let names;
		try { names = await fsp.readdir(d); } catch (e) { continue; }
		for (const n of names) {
			if (!ASSET_RE.test(n)) continue;
			const key = n.toLowerCase();
			if (out[key]) continue;
			const full = path.join(d, n);
			try {
				const st = await fsp.stat(full);
				out[key] = 'api/asset?path=' + encodeURIComponent(full) + '&v=' + Math.round(st.mtimeMs);
			} catch (e) { /* vanished */ }
		}
	}
	return out;
}

const wpAssetCache = new Map();
async function wpAssets(slug) {
	const hit = wpAssetCache.get(slug);
	if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;
	const v = {};
	try {
		const html = await fetchText(`https://plugins.svn.wordpress.org/${slug}/assets/`);
		for (const m of html.matchAll(/href="([^"?/]+)"/g)) {
			const n = decodeURIComponent(m[1]);
			if (ASSET_RE.test(n)) v[n.toLowerCase()] = `https://ps.w.org/${slug}/assets/${encodeURIComponent(n)}`;
		}
	} catch (e) { /* no assets folder */ }
	wpAssetCache.set(slug, { t: Date.now(), v });
	return v;
}

async function readSource(s) {
	if (s.kind === 'file') {
		const [text, st] = await Promise.all([fsp.readFile(s.file, 'utf8'), fsp.stat(s.file)]);
		return { kind: 'file', label: s.label, file: s.file, mtime: st.mtimeMs, text, assets: await localAssets(s.file) };
	}
	const text = await fetchText(s.url);
	return { kind: 'url', label: s.label, url: s.url, mtime: Date.now(), text, assets: s.wpSlug ? await wpAssets(s.wpSlug) : {} };
}

/* ---------- handlers ---------- */

async function handleRead(res, src) {
	try {
		const s = await resolveSource(src);
		send(res, 200, await readSource(s));
	} catch (e) {
		send(res, 400, { error: e.message });
	}
}

async function handleWatch(req, res, src) {
	let s;
	try {
		s = await resolveSource(src);
	} catch (e) {
		return send(res, 400, { error: e.message });
	}

	res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
	res.write('retry: 2000\n\n');

	let last = '';
	let closed = false;
	let busy = false;
	let again = false;

	async function push() {
		if (closed) return;
		if (busy) { again = true; return; }
		busy = true;
		try {
			const p = await readSource(s);
			const h = sha(p.text + '\n' + JSON.stringify(p.assets));
			if (h !== last && !closed) {
				last = h;
				res.write('data: ' + JSON.stringify(p) + '\n\n');
			}
		} catch (e) {
			last = '';
			if (!closed) res.write('event: problem\ndata: ' + JSON.stringify({ error: e.message }) + '\n\n');
		} finally {
			busy = false;
			if (again) { again = false; push(); }
		}
	}

	const watchers = [];
	let debounce;
	let timer;

	if (s.kind === 'file') {
		const kick = () => { clearTimeout(debounce); debounce = setTimeout(push, 120); };
		// Watch folders, not the file: editors often save by replacing the file.
		for (const d of assetDirs(s.file)) {
			try { watchers.push(fs.watch(d, kick)); } catch (e) { /* missing folder */ }
		}
		timer = setInterval(push, FILE_SAFETY_POLL_MS); // network drives / missed events
	} else {
		timer = setInterval(push, URL_POLL_MS);
	}
	const ping = setInterval(() => res.write(': ping\n\n'), 25000);

	req.on('close', () => {
		closed = true;
		clearTimeout(debounce);
		clearInterval(timer);
		clearInterval(ping);
		watchers.forEach((w) => w.close());
	});

	push();
}

function handleAsset(res, p) {
	if (!p || !ASSET_RE.test(path.basename(p))) return send(res, 400, { error: 'Not a plugin image.' });
	fs.readFile(p, (err, buf) => {
		if (err) return send(res, 404, { error: 'Not found.' });
		send(res, 200, buf, MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
	});
}

/* ---------- server ---------- */

const server = http.createServer((req, res) => {
	// Only answer to localhost names (blocks DNS-rebinding from other sites).
	const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
	if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return send(res, 403, { error: 'Forbidden host.' });
	if (req.method !== 'GET') return send(res, 405, { error: 'GET only.' });

	const u = new URL(req.url, 'http://localhost');

	if (STATIC[u.pathname]) {
		const file = path.join(ROOT, STATIC[u.pathname]);
		return fs.readFile(file, (err, buf) => err ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(file)]));
	}

	switch (u.pathname) {
		case '/api/ping': return send(res, 200, { ok: true });
		case '/api/read': return handleRead(res, u.searchParams.get('src'));
		case '/api/watch': return handleWatch(req, res, u.searchParams.get('src'));
		case '/api/asset': return handleAsset(res, u.searchParams.get('path'));
	}
	send(res, 404, { error: 'Not found.' });
});

server.on('error', (e) => {
	if (e.code === 'EADDRINUSE') {
		console.error(`Port ${PORT} is busy. Is the viewer already running? Try another port: set PORT=4322 and run again.`);
	} else {
		console.error(e.message);
	}
	process.exit(1);
});

server.listen(PORT, HOST, () => {
	const url = `http://localhost:${PORT}/`;
	console.log(`WP Readme Viewer running at ${url}`);
	console.log('Press Ctrl+C to stop.');
	if (process.argv.includes('--open')) {
		const { exec } = require('child_process');
		const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
		exec(cmd);
	}
});
