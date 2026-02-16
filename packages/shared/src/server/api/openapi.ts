/**
 * OpenAPI 3.1 specification generator for the portal REST API.
 *
 * Dynamically builds the spec from the tool registry, converting Zod
 * parameter schemas to JSON Schema via Zod's built-in `toJSONSchema()`.
 *
 * The generated spec is cached in memory (generated once per process).
 * GET /api/v1/openapi.json serves it as-is.
 */
import { z } from 'zod';
import { getAllToolDefinitions } from '../../tools/registry';
import { createLogger } from '../logger';

const log = createLogger('openapi');

/** OpenAPI 3.1 document type (simplified) */
interface OpenAPIDocument {
	openapi: string;
	info: { title: string; version: string; description: string };
	servers: Array<{ url: string; description?: string }>;
	paths: Record<string, Record<string, unknown>>;
	components: {
		securitySchemes: Record<string, unknown>;
		schemas: Record<string, unknown>;
	};
	security: Array<Record<string, string[]>>;
}

let cachedSpec: OpenAPIDocument | null = null;

/**
 * Convert a Zod schema to JSON Schema, handling edge cases gracefully.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	try {
		const jsonSchema = z.toJSONSchema(schema);
		// Remove the $schema key since OpenAPI embeds schemas inline
		const { $schema: _$schema, ...rest } = jsonSchema as Record<string, unknown>;
		return rest;
	} catch (err) {
		log.warn({ err }, 'failed to convert Zod schema to JSON Schema');
		return { type: 'object', additionalProperties: true };
	}
}

/**
 * Build the /tools/{name}/execute path item for a specific tool.
 */
function buildToolExecutePath(
	toolName: string,
	description: string,
	category: string,
	approvalLevel: string,
	parametersSchema: Record<string, unknown>
): Record<string, unknown> {
	const requiresConfirmation = approvalLevel === 'confirm' || approvalLevel === 'danger';

	return {
		post: {
			operationId: `execute_${toolName}`,
			summary: `Execute ${toolName}`,
			description,
			tags: [category],
			parameters: requiresConfirmation
				? [
						{
							name: 'X-Confirm',
							in: 'header',
							required: false,
							description: 'Set to "true" to confirm execution of tools that require approval.',
							schema: { type: 'string', enum: ['true'] }
						}
					]
				: [],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								args: parametersSchema,
								...(requiresConfirmation
									? {
											confirmed: {
												type: 'boolean',
												description:
													'Set to true to confirm execution. Required for confirm/danger tools.'
											}
										}
									: {})
							},
							required: ['args']
						}
					}
				}
			},
			responses: {
				'200': {
					description: 'Tool executed successfully',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ToolExecutionSuccess' }
						}
					}
				},
				'400': {
					description: 'Validation error',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ErrorResponse' }
						}
					}
				},
				'401': { description: 'Authentication required' },
				'403': {
					description: 'Insufficient permissions or confirmation required',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ErrorResponse' }
						}
					}
				},
				'404': { description: 'Tool not found' },
				'502': {
					description: 'OCI CLI error',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ToolExecutionError' }
						}
					}
				}
			},
			security: [{ bearerAuth: [] }, { cookieAuth: [] }]
		}
	};
}

/**
 * Generate the complete OpenAPI 3.1 specification.
 *
 * Iterates over all registered tools and builds:
 * - GET /tools (list all)
 * - GET /tools/{name} (get one)
 * - POST /tools/{name}/execute (execute)
 *
 * Tool parameters are converted from Zod to JSON Schema inline.
 */
export function generateOpenAPISpec(): OpenAPIDocument {
	if (cachedSpec) return cachedSpec;

	const tools = getAllToolDefinitions();
	const categories = [...new Set(tools.map((t) => t.category))].sort();

	// Build per-tool execute paths
	const toolPaths: Record<string, Record<string, unknown>> = {};
	for (const tool of tools) {
		const pathKey = `/tools/${tool.name}/execute`;
		const paramSchema = zodToJsonSchema(tool.parameters);
		toolPaths[pathKey] = buildToolExecutePath(
			tool.name,
			tool.description,
			tool.category,
			tool.approvalLevel,
			paramSchema
		);
	}

	const spec: OpenAPIDocument = {
		openapi: '3.1.0',
		info: {
			title: 'CloudNow API',
			version: '1.0.0',
			description:
				'REST API for CloudNow. Provides tool discovery, execution, ' +
				'and management for Oracle Cloud Infrastructure operations.'
		},
		servers: [{ url: '/api/v1', description: 'Portal API v1' }],
		paths: {
			'/tools': {
				get: {
					operationId: 'listTools',
					summary: 'List all tools',
					description: 'Returns all available tool definitions, optionally filtered by category.',
					tags: ['tools'],
					parameters: [
						{
							name: 'category',
							in: 'query',
							required: false,
							description: 'Filter tools by category',
							schema: { type: 'string', enum: categories }
						}
					],
					responses: {
						'200': {
							description: 'List of tools',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/ToolListResponse' }
								}
							}
						},
						'400': {
							description: 'Invalid category',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/ErrorResponse' }
								}
							}
						},
						'401': { description: 'Authentication required' },
						'403': { description: 'Insufficient permissions' }
					},
					security: [{ bearerAuth: [] }, { cookieAuth: [] }]
				}
			},
			'/tools/{name}': {
				get: {
					operationId: 'getToolByName',
					summary: 'Get tool by name',
					description: 'Returns the definition for a single tool.',
					tags: ['tools'],
					parameters: [
						{
							name: 'name',
							in: 'path',
							required: true,
							description: 'Tool name',
							schema: { type: 'string' }
						}
					],
					responses: {
						'200': {
							description: 'Tool definition',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/ToolDetailResponse' }
								}
							}
						},
						'401': { description: 'Authentication required' },
						'403': { description: 'Insufficient permissions' },
						'404': { description: 'Tool not found' }
					},
					security: [{ bearerAuth: [] }, { cookieAuth: [] }]
				}
			},
			// Per-tool execute paths
			...toolPaths
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description: 'API key: Authorization: Bearer portal_...'
				},
				cookieAuth: {
					type: 'apiKey',
					in: 'cookie',
					name: 'better-auth.session_token',
					description: 'Session cookie from Better Auth login'
				}
			},
			schemas: {
				ErrorResponse: {
					type: 'object',
					properties: {
						error: { type: 'string' },
						code: { type: 'string' },
						requestId: { type: 'string' }
					},
					required: ['error', 'code']
				},
				ToolDefinition: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						description: { type: 'string' },
						category: { type: 'string', enum: categories },
						approvalLevel: { type: 'string', enum: ['auto', 'confirm', 'danger'] }
					},
					required: ['name', 'description', 'category', 'approvalLevel']
				},
				ToolListResponse: {
					type: 'object',
					properties: {
						tools: {
							type: 'array',
							items: { $ref: '#/components/schemas/ToolDefinition' }
						},
						total: { type: 'integer' }
					},
					required: ['tools', 'total']
				},
				ToolDetailResponse: {
					type: 'object',
					properties: {
						tool: {
							allOf: [
								{ $ref: '#/components/schemas/ToolDefinition' },
								{
									type: 'object',
									properties: {
										requiresApproval: { type: 'boolean' },
										warning: { type: 'string' },
										impact: { type: 'string' }
									}
								}
							]
						}
					},
					required: ['tool']
				},
				ToolExecutionSuccess: {
					type: 'object',
					properties: {
						success: { type: 'boolean', const: true },
						tool: { type: 'string' },
						data: {},
						duration: { type: 'number', description: 'Execution duration in milliseconds' },
						approvalLevel: { type: 'string', enum: ['auto', 'confirm', 'danger'] }
					},
					required: ['success', 'tool', 'duration', 'approvalLevel']
				},
				ToolExecutionError: {
					type: 'object',
					properties: {
						success: { type: 'boolean', const: false },
						tool: { type: 'string' },
						error: { type: 'string' },
						code: { type: 'string' },
						duration: { type: 'number' },
						approvalLevel: { type: 'string' }
					},
					required: ['success', 'tool', 'error', 'code', 'duration', 'approvalLevel']
				}
			}
		},
		security: [{ bearerAuth: [] }, { cookieAuth: [] }]
	};

	cachedSpec = spec;
	log.info({ toolCount: tools.length, categoryCount: categories.length }, 'OpenAPI spec generated');

	return spec;
}

/**
 * Invalidate the cached spec (useful for testing or hot-reload scenarios).
 */
export function _invalidateOpenAPICache(): void {
	cachedSpec = null;
}
