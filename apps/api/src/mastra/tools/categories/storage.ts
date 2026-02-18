import { z } from 'zod';
import type { ToolEntry } from '../types.js';
import { executeOCIAsync, requireCompartmentId } from '../executor.js';
import { executeOCISDK, normalizeSDKResponse } from '@portal/shared/tools/executor-sdk.js';

const compartmentIdSchema = z
	.string()
	.optional()
	.describe(
		'The OCID of the compartment (optional - uses OCI_COMPARTMENT_ID env var if not provided)'
	);

/** Resolve the Object Storage namespace via SDK, falling back to CLI. */
async function resolveNamespace(hint?: string): Promise<string> {
	if (hint) return hint;
	try {
		const nsResp = await executeOCISDK('objectStorage', 'getNamespace', {});
		return normalizeSDKResponse(nsResp).data as string;
	} catch {
		const nsResult = (await executeOCIAsync(['os', 'ns', 'get'])) as { data: string };
		return nsResult.data;
	}
}

export const storageTools: ToolEntry[] = [
	{
		name: 'listBuckets',
		description:
			'List Object Storage buckets in a compartment. Present as a table: Name | Created | Public Access | Storage Tier. Flag any buckets with public access as a security concern. Mention that OCI Object Storage includes 10TB/month free egress. The namespace is auto-resolved if not provided.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			namespace: z
				.string()
				.optional()
				.describe('The Object Storage namespace (auto-resolved if omitted)')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const namespace = await resolveNamespace(args.namespace as string | undefined);
			try {
				const response = await executeOCISDK('objectStorage', 'listBuckets', {
					namespaceName: namespace,
					compartmentId,
					limit: 1000
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCIAsync([
					'os',
					'bucket',
					'list',
					'--compartment-id',
					compartmentId,
					'--namespace',
					namespace,
					'--all'
				]);
			}
		}
	},
	{
		name: 'createBucket',
		description:
			'Create a new Object Storage bucket. ALWAYS default to NoPublicAccess unless user explicitly needs public access. After creation, suggest setting up lifecycle rules for automatic archival and an IAM policy for access control. Mention S3-compatible API access. The namespace is auto-resolved if not provided.',
		category: 'storage',
		approvalLevel: 'confirm',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			namespace: z
				.string()
				.optional()
				.describe('The Object Storage namespace (auto-resolved if omitted)'),
			name: z.string().describe('Name for the bucket'),
			publicAccessType: z.enum(['NoPublicAccess', 'ObjectRead']).default('NoPublicAccess')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			const namespace = await resolveNamespace(args.namespace as string | undefined);
			const publicAccessType = (args.publicAccessType as string) || 'NoPublicAccess';
			try {
				const response = await executeOCISDK('objectStorage', 'createBucket', {
					namespaceName: namespace,
					createBucketDetails: {
						compartmentId,
						name: args.name as string,
						publicAccessType
					}
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCIAsync([
					'os',
					'bucket',
					'create',
					'--compartment-id',
					compartmentId,
					'--namespace',
					namespace,
					'--name',
					args.name as string,
					'--public-access-type',
					publicAccessType
				]);
			}
		}
	},
	{
		name: 'deleteBucket',
		description:
			'Delete an Object Storage bucket. DANGER: Bucket must be empty first. Confirm with user by stating the bucket name. Warn that all objects must be deleted before the bucket can be removed. The namespace is auto-resolved if not provided.',
		category: 'storage',
		approvalLevel: 'danger',
		parameters: z.object({
			namespace: z
				.string()
				.optional()
				.describe('The Object Storage namespace (auto-resolved if omitted)'),
			bucketName: z.string()
		}),
		executeAsync: async (args) => {
			const namespace = await resolveNamespace(args.namespace as string | undefined);
			try {
				const response = await executeOCISDK('objectStorage', 'deleteBucket', {
					namespaceName: namespace,
					bucketName: args.bucketName as string
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCIAsync([
					'os',
					'bucket',
					'delete',
					'--namespace',
					namespace,
					'--bucket-name',
					args.bucketName as string,
					'--force'
				]);
			}
		}
	},
	{
		name: 'getObjectStorageNamespace',
		description:
			'Get the Object Storage namespace for the tenancy. This is required before calling listBuckets. Returns a single string (the namespace name). Cache this value — it does not change.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({}),
		executeAsync: async () => {
			try {
				const response = await executeOCISDK('objectStorage', 'getNamespace', {});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCIAsync(['os', 'ns', 'get']);
			}
		}
	},
	{
		name: 'listContainerRepos',
		description:
			'List Docker image repositories in OCI Container Registry (OCIR). Present as a table: Name | Image Count | Public | Created. Useful for managing container deployments and CI/CD pipelines.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const response = await executeOCISDK('artifacts', 'listContainerRepositories', {
					compartmentId,
					limit: 1000
				});
				return normalizeSDKResponse(response);
			} catch {
				return executeOCIAsync([
					'artifacts',
					'container',
					'repository',
					'list',
					'--compartment-id',
					compartmentId,
					'--all'
				]);
			}
		}
	},
	{
		name: 'listContainerImages',
		description:
			'List container images in OCI Container Registry. Filter by repository name or image version. Present as a table: Repository | Version/Tag | Digest | Created | Size.',
		category: 'storage',
		approvalLevel: 'auto',
		parameters: z.object({
			compartmentId: compartmentIdSchema,
			repositoryName: z.string().optional().describe('Filter by repository name'),
			imageVersion: z.string().optional().describe('Filter by image version/tag')
		}),
		executeAsync: async (args) => {
			const compartmentId = requireCompartmentId(args);
			try {
				const request: Record<string, unknown> = { compartmentId, limit: 1000 };
				if (args.repositoryName) request.repositoryName = args.repositoryName as string;
				if (args.imageVersion) request.displayName = args.imageVersion as string;
				const response = await executeOCISDK('artifacts', 'listContainerImages', request);
				return normalizeSDKResponse(response);
			} catch {
				const cliArgs = [
					'artifacts',
					'container',
					'image',
					'list',
					'--compartment-id',
					compartmentId,
					'--all'
				];
				if (args.repositoryName) cliArgs.push('--repository-name', args.repositoryName as string);
				if (args.imageVersion) cliArgs.push('--display-name', args.imageVersion as string);
				return executeOCIAsync(cliArgs);
			}
		}
	}
];
