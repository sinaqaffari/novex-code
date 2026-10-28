import type { APIRoute } from 'astro';
import { failure, json } from '../../../../../../lib/cms/http.ts';
import { can } from '../../../../../../lib/cms/rbac.ts';
import { BuilderStoreError, getPageHistory } from '../../../../../../lib/builder/store.ts';
import { isValidPageSlug } from '../../../../../../lib/builder/document.ts';
import type { BuilderNode } from '../../../../../../lib/builder/types.ts';

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
	if (!can(locals.cmsUser?.role ?? 'subscriber', 'cms.pages:read')) return failure('اجازهٔ مشاهدهٔ تاریخچه را ندارید.', 403);
	const slug = params.slug ?? '';
	if (!isValidPageSlug(slug)) return failure('نامک صفحه معتبر نیست.', 400);
	try {
		const history = await getPageHistory(slug);
		const revisionValue = url.searchParams.get('revision');
		if (revisionValue !== null) {
			const revision = Number(revisionValue);
			if (!Number.isSafeInteger(revision) || revision < 1) return failure('شمارهٔ نسخه معتبر نیست.', 400);
			const snapshot = history.find((entry) => entry.revision === revision);
			if (!snapshot) return failure('نسخهٔ درخواستی در تاریخچه پیدا نشد.', 404);
			return json({ ok: true, revision: snapshot.revision, savedAt: snapshot.savedAt, document: snapshot.document });
		}
		return json({
			ok: true,
			revisions: history.map(({ revision, savedAt, document }) => ({
				revision,
				savedAt,
				title: document.title,
				nodeCount: countNodes(document.nodes),
			})),
		});
	} catch (error) {
		if (error instanceof BuilderStoreError) return json({ ok: false, code: error.code, message: error.message }, error.status);
		return failure('خواندن تاریخچهٔ صفحه ممکن نشد.', 500);
	}
};

function countNodes(nodes: BuilderNode[]): number {
	return nodes.reduce((count, node) => count + 1 + (node.type === 'Container' ? countNodes(node.children) : 0), 0);
}
