/**
 * Defers each importer until its first request, coalesces concurrent loads,
 * and retains a successfully imported module for the lifetime of the process.
 */
export function createLazyModuleCache<T>() {
	const modules = new Map<string, T>();
	const pending = new Map<string, Promise<T>>();

	return {
		get(id: string): T | undefined {
			return modules.get(id);
		},
		load(id: string, importer: () => Promise<T>): Promise<T> {
			const cached = modules.get(id);
			if (cached !== undefined) return Promise.resolve(cached);
			const inFlight = pending.get(id);
			if (inFlight) return inFlight;

			let request: Promise<T>;
			try {
				request = Promise.resolve(importer());
			} catch (error) {
				request = Promise.reject(error);
			}
			request = request.then((module) => {
				modules.set(id, module);
				return module;
			});
			pending.set(id, request);

			void request.finally(() => {
				if (pending.get(id) === request) pending.delete(id);
			}).catch(() => undefined);
			return request;
		},
	};
}
