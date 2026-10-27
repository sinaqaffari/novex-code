import type { APIRoute } from 'astro';

export const prerender = false;

/** بررسی سلامت برای Docker healthcheck و مانیتورینگ. */
export const GET: APIRoute = () =>
	Response.json(
		{ ok: true, service: 'novex-code', uptime: Math.round(process.uptime()) },
		{ headers: { 'cache-control': 'no-store' } },
	);
