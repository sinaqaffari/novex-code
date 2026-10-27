/** External links stored in settings must remain safe browser destinations. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeExternalUrl } from '../src/lib/urls.ts';

describe('safe external URLs', () => {
	it('accepts absolute HTTPS URLs without credentials', () => {
		assert.equal(safeExternalUrl('https://example.com/profile'), 'https://example.com/profile');
	});

	it('rejects script, non-HTTPS, malformed, and credential-bearing URLs', () => {
		assert.equal(safeExternalUrl('javascript:alert(1)'), null);
		assert.equal(safeExternalUrl('http://example.com'), null);
		assert.equal(safeExternalUrl('https://user:pass@example.com'), null);
		assert.equal(safeExternalUrl('not a URL'), null);
		assert.equal(safeExternalUrl(''), null);
	});
});
