import type { CodeWidgetProps } from './types.ts';

// JSON strings inside bootstrap scripts may not close the script tag or introduce JS line separators.
const scriptString = (value: string): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * The iframe must also have sandbox="allow-scripts" (never allow-same-origin) and
 * referrerpolicy="no-referrer". This is page-author browser content, NOT a Node plugin.
 * CSP limits subresource requests; it does not guarantee CPU limits or prevent
 * every form of self-navigation, so only reviewed code should be published.
 */
export function sandboxedCodeDocument(props: CodeWidgetProps): string {
	const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'";
	return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><script>(()=>{const style=document.createElement('style');style.textContent=${scriptString(props.css)};document.head.append(style);})();</script></head><body>${props.html}<script>(()=>{const code=document.createElement('script');code.textContent=${scriptString(props.javascript)};document.body.append(code);})();</script></body></html>`;
}
