import { resolvePluginApiRoute } from './registry';
import { dispatchPluginApiRequest, type PluginApiRequest } from './route-dispatch';

/** Host-bound adapter: the pure dispatcher can be tested with a controlled resolver. */
export function handlePluginApiRequest(input: PluginApiRequest): Promise<Response> {
	return dispatchPluginApiRequest(input, resolvePluginApiRoute);
}
