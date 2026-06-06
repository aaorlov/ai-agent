import { tool } from "@langchain/core/tools";
import { getCurrentTaskInput } from "@langchain/langgraph";
import { z } from "zod";

import { AppError } from "@/common/errors";
import { requireField } from "@/common/utils";

import { MAX_PLAN_STEPS } from "../constants";
import { MessageRole, ToolAction } from "../enums";
import type { AgentState } from "../state";
import type { AgentMessage, ToolMessage } from "../types";

// -----------------------------------------------------------------------------
// Public types — the wire contract
// -----------------------------------------------------------------------------

/**
 * Lifecycle of a single plan step. Stable string values so persisted
 * history, the UI, and the LLM all agree on the shape.
 */
export enum PlanStepStatus {
	Pending = "pending",
	InProgress = "in_progress",
	Completed = "completed",
	Cancelled = "cancelled",
}

/** A fully-resolved plan step. Lives in `Plan`, never on the wire directly. */
export interface PlanStep {
	id: string;
	description: string;
	status: PlanStepStatus;
}

/**
 * The resolved plan as understood at some point in time. This is the
 * authoritative shape — the `manage_plan` tool returns one of these so the
 * agent state's `plan` channel can be replaced atomically. Persisted as the
 * `result` of each `manage_plan` tool message for UI replay/audit.
 */
export interface Plan {
	goal: string;
	steps: PlanStep[];
	createdAt: string;
	updatedAt: string;
}

/**
 * Partial step payload carried in an update. `merge=true` updates omit
 * fields they don't intend to change; `merge=false` updates must include
 * `description` and `status` for every step.
 */
export interface PlanStepPatch {
	id: string;
	description?: string;
	status?: PlanStepStatus;
}

/**
 * The shape of a single `manage_plan` invocation, normalized to a server
 * timestamp. Used internally by `applyPlanUpdate`; not persisted to message
 * history (the resolved `Plan` is — see the tool's return type).
 */
export interface PlanUpdate {
	merge: boolean;
	updatedAt: string;
	goal?: string;
	steps: PlanStepPatch[];
}

export const MANAGE_PLAN_TOOL_NAME = "manage_plan";

// -----------------------------------------------------------------------------
// Input schema
// -----------------------------------------------------------------------------

const ManagePlanInputSchema = z.object({
	goal: z
		.string()
		.min(1)
		.optional()
		.describe(
			"One-sentence restatement of what the user wants. Omit when only updating step statuses on an existing plan.",
		),
	steps: z
		.array(
			z.object({
				id: z
					.string()
					.min(1)
					.max(32)
					.describe(
						"Stable identifier for this step. Reuse the same id across calls to update an existing step; pick a new id to add one.",
					),
				description: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Concrete, observable action starting with a verb. Required when merge=false or when introducing a new step id.",
					),
				status: z
					.nativeEnum(PlanStepStatus)
					.optional()
					.describe(
						"Lifecycle state of the step. Required when merge=false. Use 'in_progress' before starting work and 'completed' once finished.",
					),
			}),
		)
		.min(1)
		.max(MAX_PLAN_STEPS),
	merge: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			"If true, patch the existing plan by step id (omitted fields are kept). If false (default), replace the plan entirely; every step must include description and status.",
		),
});

// -----------------------------------------------------------------------------
// Apply / replay — pure helpers, exported for the UI and thread-restore paths
// -----------------------------------------------------------------------------

const replaceFromUpdate = (previous: Plan | null, update: PlanUpdate): Plan => ({
	goal: update.goal ?? previous?.goal ?? "",
	steps: update.steps.map((step) => ({
		id: step.id,
		description: requireField(
			step.description,
			`manage_plan: step '${step.id}' is missing 'description' (required when merge=false)`,
		),
		status: requireField(
			step.status,
			`manage_plan: step '${step.id}' is missing 'status' (required when merge=false)`,
		),
	})),
	createdAt: previous?.createdAt ?? update.updatedAt,
	updatedAt: update.updatedAt,
});

const patchFromUpdate = (previous: Plan, update: PlanUpdate): Plan => {
	const stepsById = new Map(previous.steps.map((step) => [step.id, step]));
	for (const updatedStep of update.steps) {
		const current = stepsById.get(updatedStep.id);
		if (current) {
			stepsById.set(updatedStep.id, {
				id: current.id,
				description: updatedStep.description ?? current.description,
				status: updatedStep.status ?? current.status,
			});
		} else {
			stepsById.set(updatedStep.id, {
				id: updatedStep.id,
				description: requireField(
					updatedStep.description,
					`manage_plan: new step '${updatedStep.id}' needs 'description'`,
				),
				status: updatedStep.status ?? PlanStepStatus.Pending,
			});
		}
	}
	return {
		goal: update.goal ?? previous.goal,
		steps: Array.from(stepsById.values()),
		createdAt: previous.createdAt,
		updatedAt: update.updatedAt,
	};
};

/**
 * Reduces a single `PlanUpdate` onto a plan. Pure. Throws when the merged
 * plan would violate invariants (missing required fields, step cap exceeded).
 */
export const applyPlanUpdate = (previous: Plan | null, update: PlanUpdate): Plan => {
	const newPlan = !previous || !update.merge
		? replaceFromUpdate(previous, update)
		: patchFromUpdate(previous, update);
	if (newPlan.steps.length > MAX_PLAN_STEPS) {
		throw new AppError(
			`manage_plan: plan would have ${newPlan.steps.length} steps (max ${MAX_PLAN_STEPS})`,
		);
	}
	return newPlan;
};

const PLAN_GLYPHS: Readonly<Record<PlanStepStatus, string>> = {
	[PlanStepStatus.Pending]: "[ ]",
	[PlanStepStatus.InProgress]: "[~]",
	[PlanStepStatus.Completed]: "[x]",
	[PlanStepStatus.Cancelled]: "[-]",
};

/**
 * Renders a plan as a compact checklist string. Used by `call_model` to
 * inject the active plan into the LLM's system context; clients may render
 * the same format if they want to mirror the LLM's view.
 */
export const renderPlanChecklist = (plan: Plan): string => {
	const header = plan.goal ? `Plan: ${plan.goal}` : "Plan:";
	const body = plan.steps
		.map((step, i) => `${PLAN_GLYPHS[step.status]} ${i + 1}. ${step.description}`)
		.join("\n");
	return `${header}\n${body}`;
};

const isPlanStep = (value: unknown): value is PlanStep => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.id === "string"
		&& typeof candidate.description === "string"
		&& typeof candidate.status === "string"
	);
};

/**
 * Returns the plan carried by `message` if it's a successful `manage_plan`
 * tool result, otherwise `undefined`. Used by nodes that run tools to fold
 * the latest plan into the agent's `plan` channel.
 */
export const extractPlanFromToolMessage = (message: ToolMessage): Plan | undefined => {
	if (message.toolName === MANAGE_PLAN_TOOL_NAME && message.action === ToolAction.Executed) return message.result as Plan;
};

/**
 * Returns the resolved plan from the most recent successful `manage_plan`
 * tool message, or `undefined` if none. Each tool message carries a fully
 * resolved plan (not a delta), so the latest one is the answer; earlier
 * messages are stale snapshots.
 *
 * Used in two places:
 *  - `execute_tool` folds the new plan into `state.plan` after a super-step.
 *  - thread-restore seeds `state.plan` from the persisted message log when
 *    no healthy checkpoint exists.
 */
export const findLatestPlan = (messages: readonly AgentMessage[]): Plan | undefined => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!message || message.role !== MessageRole.Tool) continue;
		const plan = extractPlanFromToolMessage(message);
		if (plan) return plan;
	}
};

// -----------------------------------------------------------------------------
// Tool definition
// -----------------------------------------------------------------------------

const TOOL_DESCRIPTION = `Create or update the agent's task plan. The user sees this as a live checklist; updates here are the only way they learn about plan progress.

When to use:
- Use when the work has 3 or more distinct steps, spans multiple tool calls, or otherwise benefits from a checklist.
- Do NOT use for trivial requests (greetings, single fact lookups, single tool calls). Answer directly.

How to use:
- First call: merge=false (default), include every step with description and status="pending".
- Status updates: merge=true, send only the steps that changed; omitted fields are kept.
- Mark a step "in_progress" before starting it, then "completed" immediately after finishing.
- Use merge=true to add new steps or set status="cancelled" to retire ones that no longer apply.
- Starting a new task while a prior plan is still in state: call with merge=false (new goal + fresh steps) to replace it. Do not extend a finished plan with merge=true if the new request is a different goal.`;

export const managePlanTool = tool(
	async (input): Promise<Plan> => {
		const update: PlanUpdate = {
			merge: input.merge ?? false,
			updatedAt: new Date().toISOString(),
			...(input.goal !== undefined ? { goal: input.goal } : {}),
			steps: input.steps,
		};

		const state = getCurrentTaskInput<AgentState>();
		return applyPlanUpdate(state.plan, update);
	},
	{
		name: MANAGE_PLAN_TOOL_NAME,
		description: TOOL_DESCRIPTION,
		schema: ManagePlanInputSchema,
	},
);
