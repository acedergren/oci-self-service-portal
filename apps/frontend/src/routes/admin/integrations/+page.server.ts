import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// SSR prefetch catalog and servers for initialData pattern
		const [catalogRes, serversRes] = await Promise.all([
			fetch('/api/admin/mcp/catalog'),
			fetch('/api/admin/mcp/servers')
		]);

		return {
			initialCatalog: catalogRes.ok ? await catalogRes.json() : { items: [] },
			initialServers: serversRes.ok ? await serversRes.json() : { servers: [] }
		};
	} catch (error) {
		console.error('Failed to prefetch MCP data:', error);
	}

	return {
		initialCatalog: { items: [] },
		initialServers: { servers: [] }
	};
};
