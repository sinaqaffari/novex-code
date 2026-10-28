/**
 * تجزیهٔ readme.txt — همان قالب رسمی فهرست افزونه‌های WordPress.
 *
 * ساختار:
 *
 *   === Plugin Name ===
 *   Contributors: a, b
 *   Tags: seo, meta
 *   Requires at least: 2.0
 *   Tested up to: 2.0
 *   Stable tag: 1.0.0
 *   License: MIT
 *
 *   Short description (one line).
 *
 *   == Description ==
 *   ...
 *   == Changelog ==
 *   = 1.0.0 =
 *   - ...
 */

import type { PluginReadme } from './types';

export function parseReadme(raw: string): PluginReadme {
	const lines = raw.replace(/\r\n/g, '\n').split('\n');

	const header: Record<string, string> = {};
	const sections: Array<{ title: string; body: string }> = [];

	let index = 0;

	// سرصفحهٔ اول: تا اولین خط خالی یا اولین «== بخش ==»
	while (index < lines.length) {
		const line = lines[index]?.trim() ?? '';
		if (!line || /^==[^=]/.test(line)) break;

		const match = /^([A-Za-z][A-Za-z /]+):\s*(.+)$/.exec(line);
		if (match) header[match[1].trim().toLowerCase()] = match[2].trim();
		index += 1;
	}

	// توضیح کوتاه: پاراگراف بعد از سرصفحه، پیش از اولین بخش
	const short: string[] = [];
	while (index < lines.length && !/^==[^=]/.test(lines[index]?.trim() ?? '')) {
		if (lines[index]?.trim()) short.push(lines[index].trim());
		index += 1;
	}
	if (short.length) {
		header['short description'] = short.join(' ');
	}

	let current: { title: string; body: string[] } | null = null;

	for (; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const heading = /^==\s*(.+?)\s*==$/.exec(line.trim());

		if (heading) {
			if (current) sections.push({ title: current.title, body: current.body.join('\n').trim() });
			current = { title: heading[1], body: [] };
			continue;
		}

		if (current) current.body.push(line);
	}

	if (current) sections.push({ title: current.title, body: current.body.join('\n').trim() });

	return { header, sections };
}
