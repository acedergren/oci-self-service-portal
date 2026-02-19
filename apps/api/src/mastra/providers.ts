import { getProviderRegistry } from './models/provider-registry.js';

const MODEL_ALIASES: Record<string, string> = {
	'gemini-flash': 'google.gemini-2.5-flash',
	'gemini-pro': 'google.gemini-2.5-pro',
	'command-r': 'oci:cohere.command-r-plus'
};

/**
 * Resolve a friendly model alias or full model ID to an AI SDK LanguageModel.
 * getProviderRegistry() is async — must be awaited.
 */
export async function selectModel(name: string) {
	const modelId = MODEL_ALIASES[name] ?? name;
	const registry = await getProviderRegistry();
	// Type assertion needed: createProviderRegistry with dynamic providers infers
	// model IDs as `never` at compile time; the runtime registry is fully populated.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (registry as any).languageModel(modelId);
}
