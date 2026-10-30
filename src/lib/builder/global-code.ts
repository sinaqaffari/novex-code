/** Author code runs in the site's browser origin. These functions prevent raw-text
 * tag breakouts while preserving the code itself; they do not sandbox the code. */
export function globalStyleRawText(css: string): string {
	// CSS escapes decode back to '<', including in strings and URLs, without
	// allowing an HTML parser to terminate the enclosing style element.
	return css.replace(/</g, '\\3c ');
}

export function globalScriptBootstrap(javascript: string): string {
	// JSON-encode the source inside an inline bootstrap. Escaping '<' prevents
	// literal </script> sequences from terminating the bootstrap's HTML element.
	const encoded = JSON.stringify(javascript).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
	return `(()=>{const script=document.createElement('script');script.textContent=${encoded};document.currentScript.before(script)})()`;
}
