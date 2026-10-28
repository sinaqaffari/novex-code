#!/usr/bin/env node
/**
 * بررسی نگارش متن‌های پروژه.
 *
 * Usage: npm run check:copy
 *
 * قواعد:
 *  - خط تیرهٔ بلند (em dash —) به‌جای خط تیرهٔ کوتاه در جمله‌های فارسی.
 *  - خط تیرهٔ نیمه‌بلند (en dash –) فقط بین دو عدد (بازه) مجاز است.
 *  - در متن فارسی، خط تیرهٔ بلند باید با فاصله در دو طرف بیاید.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const targets = ['src', 'plugins', 'scripts', 'README.md'];
const extensions = /\.(astro|ts|js|mjs|md|txt|json)$/;

const findings = [];
let checked = 0;

const isPersian = (character) => /[\u0600-\u06FF]/.test(character);

/** ارقام فارسی و عربی هم «عدد» حساب می‌شوند تا بازه‌ها مجاز بمانند. */
const isDigit = (character) => /[0-9\u06F0-\u06F9\u0660-\u0669]/.test(character);

async function walk(target) {
	const absolute = path.join(root, target);
	if (extensions.test(absolute)) return [absolute];

	let entries;
	try {
		entries = await readdir(absolute, { withFileTypes: true });
	} catch {
		return [];
	}

	const files = [];
	for (const entry of entries) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const child = path.join(absolute, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path.relative(root, child))));
		else if (extensions.test(entry.name)) files.push(child);
	}
	return files;
}

const files = [];
for (const target of targets) files.push(...(await walk(target)));

for (const file of files) {
	const relative = path.relative(root, file);
	const lines = (await readFile(file, 'utf8')).split('\n');
	checked += 1;

	// کد برنامه (نه متن) و برچسب‌های فنی از بررسی خارج می‌شوند.
	const skipFile = relative === 'package-lock.json' || relative === 'scripts/check-copy.mjs';

	lines.forEach((line, index) => {
		const trimmed = line.trim();
		if (skipFile) return;
		if (trimmed.startsWith('//') && !isPersian(line)) return;
		if (/^import\s|^export\s|^const\s|^let\s|^function\s/.test(trimmed) && !isPersian(line)) return;

		// ۱) en dash بیرون از بازهٔ عددی
		const enDash = /[–]/g;
		for (const match of line.matchAll(enDash)) {
			const before = line[match.index - 1] ?? '';
			const after = line[match.index + 1] ?? '';
			if (isDigit(before) && isDigit(after)) continue;
			findings.push(`${relative}:${index + 1} — خط تیرهٔ نیمه‌بلند (–)؛ از خط تیرهٔ بلند (—) استفاده کنید.`);
		}

		// ۲) hyphen با فاصله در دو طرف، در متن فارسی
		if (/[آ-ی]\s+-\s+[آ-ی]/.test(line)) {
			findings.push(`${relative}:${index + 1} — خط تیرهٔ کوتاه در جملهٔ فارسی؛ از «—» استفاده کنید.`);
		}

		// ۳) em dash چسبیده به حروف فارسی
		if (/[آ-ی]—|—[آ-ی]/.test(line)) {
			findings.push(`${relative}:${index + 1} — خط تیرهٔ بلند باید فاصله در دو طرف داشته باشد.`);
		}
	});
}

console.log('— بررسی نگارش متن‌ها (خط تیرهٔ بلند) —');
console.log(`فایل‌های بررسی‌شده: ${checked}`);

if (findings.length) {
	console.error('\nایرادها');
	for (const finding of findings) console.error(`  • ${finding}`);
	console.error(`\n✗ ${findings.length} ایراد نگارشی پیدا شد.`);
	process.exit(1);
}

console.log('\n✓ همهٔ متن‌ها از خط تیرهٔ بلند و فاصلهٔ درست استفاده می‌کنند.');
