import { parseBuilderMediaReference } from './media-reference.ts';
import { validateSiteKit, type SiteKit } from './site-kits.ts';

/** Verify declared managed assets before writing any draft. No remote fetch or file copy. */
export async function verifySiteKitAssets(kit: SiteKit, exists: (path: string) => Promise<boolean>): Promise<boolean> {
	const valid = validateSiteKit(kit);
	for (const asset of valid.assets) {
		const reference = parseBuilderMediaReference(asset);
		if (!reference || !await exists(reference.bucket === 'uploads' ? `uploads/${reference.name}` : reference.name)) return false;
	}
	return true;
}
