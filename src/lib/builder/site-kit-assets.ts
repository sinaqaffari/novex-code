import { parseBuilderMediaReference } from './media-reference.ts';
import { validateSiteKit, type SiteKit } from './site-kits.ts';

/** Verify declared bundled assets before writing any draft. No remote fetch or file copy. */
export async function verifySiteKitAssets(kit: SiteKit, exists: (path: string) => Promise<boolean>): Promise<boolean> {
	const valid = validateSiteKit(kit);
	for (const asset of valid.assets) {
		const reference = parseBuilderMediaReference(asset);
		if (!reference || reference.bucket !== 'assets' || !await exists(reference.name)) return false;
	}
	return true;
}
