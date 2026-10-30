/** Safe CSS lengths accepted by the document. Functions, variables and raw CSS are not supported. */
export function normalizeLayoutLength(input: unknown, property: string): string {
	if (typeof input !== 'string') throw new Error(`Property "${property}" must be a CSS length.`);
	const value = input.trim().toLowerCase();
	if (['auto', 'fit-content', '0'].includes(value)) return value;
	const match = /^(?:\d{1,5}(?:\.\d{1,3})?|\.\d{1,3})(px|%|rem|em|vw|vh)$/.exec(value);
	if (!match || Number.parseFloat(value) > 10000) throw new Error(`Property "${property}" has an unsupported CSS length.`);
	return value;
}
