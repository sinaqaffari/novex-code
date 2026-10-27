#!/usr/bin/env node
/**
 * بررسی خودکار راست‌به‌چپ بودن پنل مدیریت.
 *
 * Usage: npm run check:rtl
 *
 * Fails when the panel drifts away from its Persian/RTL contract:
 *  - physical CSS properties (margin-left, padding-right, float: left, …)
 *  - LTR-only alignment (text-align: left/right)
 *  - a page that does not render through CmsLayout (dir="rtl", lang="fa")
 *  - English UI copy left inside the panel
 *  - content files without Persian text
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const scannedDirs = [
	'src/pages/cms',
	'src/pages/shop',
	'src/pages/blog',
	'src/components/cms',
	'src/lib/cms',
	'src/lib/commerce',
	'src/lib/plugins',
	'src/layouts',
	'src/styles/cms.css',
	'src/styles/shop.css',
	'src/pages/index.astro',
	'src/pages/about.astro',
];

/** هر گروه از صفحه‌ها باید از چیدمان درست خودش استفاده کند. */
const layoutContracts = [
	{ prefix: 'src/pages/cms', layout: 'CmsLayout', file: 'src/components/cms/CmsLayout.astro' },
	{
		prefix: 'src/pages/shop',
		layout: 'ShopLayout',
		file: 'src/layouts/ShopLayout.astro',
	},
	{ prefix: 'src/pages/blog', layout: 'ShopLayout', file: 'src/layouts/ShopLayout.astro' },
];

const failures = [];
const warnings = [];
let checked = 0;

/** Physical properties that break RTL layouts. */
const physicalRules = [
	{
		name: 'حاشیهٔ فیزیکی',
		pattern: /\b(margin|padding|border)-(left|right)\b\s*:/g,
		hint: 'از margin-inline / padding-inline-start استفاده کنید.',
	},
	{
		name: 'ترازبندی فیزیکی',
		pattern: /\btext-align\s*:\s*(left|right)\b/g,
		hint: 'از text-align: start / end استفاده کنید.',
	},
	{
		name: 'شناوری فیزیکی',
		pattern: /\bfloat\s*:\s*(left|right)\b/g,
		hint: 'به‌جای float از flex یا grid استفاده کنید.',
	},
	{
		name: 'جای‌گذاری فیزیکی',
		pattern: /(^|[;{\s])(left|right)\s*:\s*[^;{}]+;/g,
		hint: 'از inset-inline-start / inset-inline-end استفاده کنید.',
	},
];

/** English UI words that must never appear as visible text. */
const englishUiWords = [
	'Save',
	'Delete',
	'Edit',
	'Search',
	'Settings',
	'Dashboard',
	'Cancel',
	'Submit',
	'Loading',
	'Preview',
	'Publish',
	'Draft',
	'Media',
	'Back',
	'New post',
	'Sign out',
	'Log in',
];

const allowPhysical = [
	// The custom <select> chevron is deliberately pinned to the physical left
	// edge, which is the "end" side in RTL.
	/background-position:\s*left [^;]+;/,
];

async function walk(directory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}

	const files = [];
	for (const entry of entries) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(full)));
		else if (/\.(astro|css|ts)$/.test(entry.name)) files.push(full);
	}
	return files;
}

function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
			comment.includes('rtl-check-ignore') ? ' rtl-check-ignore ' : '',
		)
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\/[^\n]*rtl-check-ignore[^\n]*/g, ' rtl-check-ignore ');

}

const files = [];
for (const target of scannedDirs) {
	const absolute = path.join(root, target);
	if (target.endsWith('.css')) files.push(absolute);
	else files.push(...(await walk(absolute)));
}

for (const file of files) {
	const relative = path.relative(root, file);
	const raw = await readFile(file, 'utf8');
	// Documentation pages are allowed to spell out anti-patterns on purpose.
	const isDocumentation = raw.includes('rtl-check-ignore-file');
	const source = stripComments(
		isDocumentation ? raw.replace(/<code[\s\S]*?<\/code>/g, '') : raw,
	);
	const lines = source.split('\n');
	checked += 1;

	lines.forEach((line, index) => {
		if (line.includes('rtl-check-ignore')) return;
		if (allowPhysical.some((pattern) => pattern.test(line))) return;
		if (isDocumentation) return;

		for (const rule of physicalRules) {
			const match = new RegExp(rule.pattern.source, 'g').exec(line);
			if (match) {
				failures.push(`${relative}:${index + 1} — ${rule.name}: «${match[1] ?? match[0]}» — ${rule.hint}`);
			}
		}
	});

	if (file.endsWith('.astro')) {
		if (!/[پچژگکی‌]/.test(source) && relative.startsWith('src/pages')) {
			failures.push(`${relative} — هیچ متن فارسی‌ای ندارد؛ رابط کاربری باید فارسی باشد.`);
		}

		for (const contract of layoutContracts) {
			if (!relative.startsWith(contract.prefix)) continue;
			if (/\/api\//.test(relative)) break;
			if (!source.includes(contract.layout)) {
				failures.push(
					`${relative} — از ${contract.layout} استفاده نمی‌کند؛ dir=\"rtl\" تضمین نمی‌شود.`,
				);
			}
			break;
		}

		const textNodes = [...source.matchAll(/>([^<>{}]+)</g)].map((match) => match[1].trim());
		for (const node of textNodes) {
			if (!node || node.length < 3) continue;
			for (const word of englishUiWords) {
				const pattern = new RegExp(`\\b${word}\\b`);
				if (pattern.test(node)) {
					failures.push(`${relative} — متن انگلیسی «${node.slice(0, 40)}» در رابط کاربری پیدا شد.`);
				}
			}
		}
	}
}

// The root element of every layout must declare both language and direction.
for (const layoutFile of [
	'src/components/cms/CmsLayout.astro',
	'src/layouts/SiteLayout.astro',
]) {
	const layout = await readFile(path.join(root, layoutFile), 'utf8');
	if (!/<html[^>]*\blang="fa"/.test(layout)) {
		failures.push(`${layoutFile} — ویژگی lang="fa" روی <html> تنظیم نشده است.`);
	}
	if (!/<html[^>]*\bdir="rtl"/.test(layout)) {
		failures.push(`${layoutFile} — ویژگی dir="rtl" روی <html> تنظیم نشده است.`);
	}
	if (!layout.includes("'@fontsource-variable/vazirmatn'")) {
		warnings.push(`${layoutFile} — قلم وزیرمتن بارگذاری نشده است.`);
	}
}

// A couple of global checks on the stylesheets.
for (const [stylesheet, directionRule] of [
	['src/styles/cms.css', /html\s*{[^}]*direction:\s*rtl/],
	['src/styles/shop.css', /html\s*{[^}]*direction:\s*rtl/],
]) {
	const styles = await readFile(path.join(root, stylesheet), 'utf8');
	if (!directionRule.test(styles)) {
		failures.push(`${stylesheet} — direction: rtl روی html تنظیم نشده است.`);
	}
	if (!/Vazirmatn/.test(styles)) {
		failures.push(`${stylesheet} — خانوادهٔ قلم فارسی (Vazirmatn) تعریف نشده است.`);
	}
}

const report = (title, items, stream) => {
	if (!items.length) return;
	console.log(`\n${title}`);
	for (const item of items) console.log(`  • ${item}`);
	stream.write('');
};

console.log('— بررسی راست‌به‌چپ پنل مدیریت —');
console.log(`فایل‌های بررسی‌شده: ${checked}`);
report('خطاها', failures, process.stderr);
report('هشدارها', warnings, process.stderr);

if (failures.length) {
	console.error(`\n✗ ${failures.length} خطا در رعایت راست‌به‌چپ یافت شد.`);
	process.exit(1);
}

console.log('\n✓ پنل مدیریت فارسی و راست‌به‌چپ است؛ هیچ خطایی پیدا نشد.');
