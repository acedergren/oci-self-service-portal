import type { FastifyPluginAsync } from "fastify";
import { execFile } from "node:child_process";
import { getPoolStats } from "../plugins/oracle.js";
import type { HealthCheckResponse } from "./schemas.js";

function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

interface HealthCheckEntry {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Health route module.
 *
 * Registers:
 * - GET /api/health  — shallow liveness probe (always fast)
 * - GET /api/healthz — deep readiness probe (queries subsystems)
 *
 * Both routes are PUBLIC (no auth required).
 * Deep check logic ported from SvelteKit's runHealthChecks().
 */
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/health — shallow liveness probe
  fastify.get("/api/health", async (): Promise<HealthCheckResponse> => {
    return {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  });

  // GET /api/healthz — deep readiness probe with dependency checks
  fastify.get(
    "/api/healthz",
    async (_request, reply): Promise<HealthCheckResponse> => {
      const checks: Record<string, HealthCheckEntry> = {};

      // 1. Check database connectivity (CRITICAL)
      const dbStart = performance.now();
      try {
        if (!fastify.hasDecorator("withConnection")) {
          checks.database = {
            status: "error",
            latencyMs: performance.now() - dbStart,
            message: "Oracle plugin not registered",
          };
        } else {
          await fastify.withConnection(async (conn) => {
            await conn.execute("SELECT 1 FROM DUAL");
          });
          checks.database = {
            status: "ok",
            latencyMs: performance.now() - dbStart,
          };
        }
      } catch (err) {
        // Redact internal error details — healthz is public
        fastify.log.error(
          { err },
          "Health check: database connectivity failed",
        );
        checks.database = {
          status: "error",
          latencyMs: performance.now() - dbStart,
          message: "Database connectivity check failed",
        };
      }

      // 2. Check connection pool stats (CRITICAL)
      const poolStart = performance.now();
      const poolStats = getPoolStats(fastify);
      if (poolStats) {
        checks.connection_pool = {
          status: "ok",
          latencyMs: performance.now() - poolStart,
          details: {
            connectionsOpen: poolStats.connectionsOpen,
            connectionsInUse: poolStats.connectionsInUse,
            poolMin: poolStats.poolMin,
            poolMax: poolStats.poolMax,
          },
        };
      } else {
        checks.connection_pool = {
          status: "error",
          latencyMs: performance.now() - poolStart,
          message: "Oracle pool not available",
        };
      }

      // 3. Check OCI CLI (NON-CRITICAL)
      const cliStart = performance.now();
      try {
        const { stdout } = await execFileAsync("oci", ["--version"], {
          timeout: 5000,
        });
        checks.oci_cli = {
          status: "ok",
          latencyMs: performance.now() - cliStart,
          details: { version: stdout.trim() },
        };
      } catch (err) {
        fastify.log.warn({ err }, "Health check: OCI CLI check failed");
        checks.oci_cli = {
          status: "error",
          latencyMs: performance.now() - cliStart,
          message: "OCI CLI check failed",
        };
      }

      // Determine overall status
      // Database and connection_pool are CRITICAL — any error → 'unhealthy'
      // OCI CLI is non-critical — error → 'degraded'
      const criticalChecks = ["database", "connection_pool"];
      let status: HealthCheckResponse["status"] = "ok";

      for (const [name, check] of Object.entries(checks)) {
        if (check.status === "error") {
          if (criticalChecks.includes(name)) {
            status = "unhealthy";
            break;
          } else {
            status = status === "unhealthy" ? "unhealthy" : "degraded";
          }
        }
      }

      // Return 503 if unhealthy
      if (status === "unhealthy") {
        reply.code(503);
      }

      return {
        status,
        service: "api",
        timestamp: new Date().toISOString(),
        checks,
      };
    },
  );
};

export default healthRoutes;
