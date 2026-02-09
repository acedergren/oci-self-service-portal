import { getAllToolDefinitions } from '@portal/shared/tools/registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const defs = getAllToolDefinitions();
	const toolDefs = defs.map((d) => ({
		name: d.name,
		description: d.description,
		category: d.category,
		approvalLevel: d.approvalLevel
	}));
	return { toolDefs };
};
