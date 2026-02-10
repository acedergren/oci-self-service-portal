import Fuse, { type IFuseOptions, type FuseResult } from 'fuse.js';

/**
 * Create a fuzzy search function for a list of items.
 * Returns all items when query is empty, otherwise returns fuzzy-matched results.
 */
export function createFuzzySearch<T>(
	items: T[],
	keys: IFuseOptions<T>['keys'],
	options?: Partial<IFuseOptions<T>>
): (query: string) => T[] {
	const fuse = new Fuse(items, {
		keys,
		threshold: 0.4,
		ignoreLocation: true,
		...options
	});

	return (query: string): T[] => {
		if (!query.trim()) return items;
		return fuse.search(query).map((result: FuseResult<T>) => result.item);
	};
}

/**
 * Perform a one-shot fuzzy search. Use createFuzzySearch for repeated searches
 * against the same dataset (it caches the Fuse index).
 */
export function fuzzySearch<T>(
	items: T[],
	query: string,
	keys: IFuseOptions<T>['keys'],
	options?: Partial<IFuseOptions<T>>
): T[] {
	if (!query.trim()) return items;

	const fuse = new Fuse(items, {
		keys,
		threshold: 0.4,
		ignoreLocation: true,
		...options
	});

	return fuse.search(query).map((result: FuseResult<T>) => result.item);
}
