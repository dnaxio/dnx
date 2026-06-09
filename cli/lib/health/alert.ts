/**
 * Health check state machine and alerting.
 * Tracks healthy → degraded → unhealthy transitions per target.
 */

import { logger } from "../cli/output.ts";
import { getConnection } from "../db/connection.ts";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

interface TargetState {
  targetType: "app" | "service";
  targetId: string;
  currentStatus: HealthStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheck: Date;
}

const state = new Map<string, TargetState>();

function stateKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export function getState(type: string, id: string): TargetState {
  const key = stateKey(type, id);
  if (!state.has(key)) {
    state.set(key, {
      targetType: type as "app" | "service",
      targetId: id,
      currentStatus: "healthy",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCheck: new Date(),
    });
  }
  return state.get(key)!;
}

/**
 * Record a health check result and return the new status.
 * Also logs to the database.
 */
export function recordCheck(
  type: "app" | "service",
  id: string,
  serverId: string,
  success: boolean,
  responseTimeMs: number,
  error?: string,
): HealthStatus {
  const target = getState(type, id);
  target.lastCheck = new Date();

  if (success) {
    target.consecutiveSuccesses++;
    target.consecutiveFailures = 0;
  } else {
    target.consecutiveFailures++;
    target.consecutiveSuccesses = 0;
  }

  // State transitions
  const prevStatus = target.currentStatus;
  if (target.consecutiveFailures >= 3) {
    target.currentStatus = "unhealthy";
  } else if (
    target.consecutiveFailures >= 1 &&
    target.currentStatus === "healthy"
  ) {
    target.currentStatus = "degraded";
  } else if (
    target.consecutiveSuccesses >= 2 &&
    target.currentStatus !== "healthy"
  ) {
    target.currentStatus = "healthy";
  }

  // Log to DB
  try {
    const db = getConnection();
    db.run(
      "INSERT INTO health_logs (target_type, target_id, server_id, status, response_time_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
      type,
      id,
      serverId,
      target.currentStatus,
      responseTimeMs,
      error ?? null,
    );
  } catch {
    // DB might not be initialized
  }

  // Alert on transitions
  if (prevStatus !== target.currentStatus) {
    if (target.currentStatus === "unhealthy") {
      logger.error(
        `🔴 ${type} "${id}" est UNHEALTHY${error ? ` : ${error}` : ""}`,
      );
    } else if (target.currentStatus === "degraded") {
      logger.warn(`🟡 ${type} "${id}" est DEGRADED`);
    } else if (target.currentStatus === "healthy" && prevStatus !== "healthy") {
      logger.success(`🟢 ${type} "${id}" est RECOVERED`);
    }
  }

  return target.currentStatus;
}

/**
 * Get all current health states.
 */
export function getAllStates(): TargetState[] {
  return [...state.values()];
}

/**
 * Reset state for a target.
 */
export function resetState(type: string, id: string): void {
  state.delete(stateKey(type, id));
}
