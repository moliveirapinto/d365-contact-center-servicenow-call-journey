import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local (never committed) then fall back to real environment variables.
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
}

export const cfg = {
    instance: (process.env.SN_INSTANCE || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    user: process.env.SN_USER,
    pass: process.env.SN_PASS,
    d365Url: (process.env.D365_ORG_URL || '').replace(/\/$/, ''),
    d365AppId: process.env.D365_APP_ID || '',
    timezone: process.env.TIMEZONE || 'UTC',
    timezoneLabel: process.env.TIMEZONE_LABEL || ''
};

if (!cfg.instance || !cfg.user || !cfg.pass) {
    throw new Error('Set SN_INSTANCE, SN_USER and SN_PASS (see .env.example).');
}

const auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');

export async function api(method, urlPath, body) {
    const res = await fetch(`https://${cfg.instance}${urlPath}`, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
        const msg = json?.error?.message || text.slice(0, 300);
        const err = new Error(`${method} ${urlPath} -> ${res.status}: ${msg}${json?.error?.detail ? ' (' + json.error.detail + ')' : ''}`);
        err.status = res.status;
        throw err;
    }
    return json.result ?? json;
}

export const enc = (s) => encodeURIComponent(s);

export async function find(table, query, fields = 'sys_id') {
    const r = await api('GET', `/api/now/table/${table}?sysparm_query=${enc(query)}&sysparm_limit=1&sysparm_fields=${enc(fields)}`);
    return r[0];
}

// Create the record when no match for `query` exists, otherwise update it. Returns the sys_id.
export async function upsert(table, query, data) {
    const existing = await find(table, query);
    if (existing) {
        await api('PATCH', `/api/now/table/${table}/${existing.sys_id}`, data);
        return existing.sys_id;
    }
    const created = await api('POST', `/api/now/table/${table}`, data);
    return created.sys_id;
}

export function readSrc(rel) {
    return fs.readFileSync(path.join(root, 'servicenow', 'src', rel), 'utf8');
}

export const log = (m) => console.log(m);
