/**
 * Quality gate: pre-delivery fact-check / logic self-review loop.
 *
 * Implemented with ZERO changes to the harness runtime: it registers a handler on
 * the existing `before_run_end` hook. When a run is about to terminate, the gate
 * reviews the final assistant output. If it finds problems, the handler returns a
 * `followUp` string; the runtime (see runtime/drive/boundary.ts) appends that
 * string as a new user message and continues the run - i.e. it closes the review
 * loop. A per-run attempt counter caps the loop so it cannot spin forever.
 *
 * Wiring (minimal, opt-in):
 *   const unregister = registerQualityGate(hooks, {
 *     enabled: process.env.PI_RESEARCH_MODE === "1",
 *     reviewer: myModelBackedReviewer, // optional; a heuristic default is used
 *   });
 *
 * When `enabled` is false (the default), the handler is a no-op and normal
 * behavior is unchanged.
 */

import { contentText } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.ts";
import type { Context } from "../context.ts";
import type { HookHandler, Hooks } from "../agent-harness.ts";

/** Outcome of one quality-gate review pass. */
export interface QualityGateResult {
	/** `true` = deliver as-is; `false` = needs revision. */
	pass: boolean;
	/** Human-readable findings, fed back to the model on failure. */
	findings: string[];
}

/** A review implementation. The host usually wires a model-backed reviewer here. */
export type QualityGateReviewer = (input: {
	runId: string;
	messages: AgentMessage[];
	attempt: number;
	context: Context;
}) => Promise<QualityGateResult>;

export interface QualityGateConfig {
	/** Master switch. Defaults to `false` (gate off, no extra provider calls). */
	enabled?: boolean;
	/** Max review loops per run. Defaults to 2. */
	maxAttempts?: number;
	/**
	 * Reviewer implementation. When omitted, a built-in conservative heuristic is
	 * used that only flags likely-incomplete research deliverables.
	 */
	reviewer?: QualityGateReviewer;
	/** Extra guidance appended to the follow-up message (e.g. scoring rubric pointer). */
	extraInstructions?: string;
}

/** Best-effort text extraction from a single message's content blocks. */
function messageText(message: AgentMessage): string {
	const candidate = message as { role?: string; content?: unknown };
	if (typeof candidate.content !== "object" || candidate.content === null) return "";
	try {
		const text = contentText(candidate.content as Parameters<typeof contentText>[0]);
		return typeof text === "string" ? text : "";
	} catch {
		return "";
	}
}

/** Return the text of the most recent assistant message, or "". */
export function lastAssistantText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const candidate = messages[i] as { role?: string };
		if (candidate.role === "assistant") {
			const text = messageText(messages[i]);
			if (text.trim().length > 0) return text;
		}
	}
	return "";
}

const RESEARCH_TELLS = /(行业|赛道|市场|评分|得分|评级|结论|风险|TAM|CAGR|enter|pool|储备|尽调)/i;
const SCORE_TELL = /(\d{1,3}\s*分|\b[ABCD]\s*级|总分|score\s*[:=]?\s*\d)/i;
const SOURCE_TELL = /(来源|出处|引自|参考|http|www\.|\[?\d+\]?\]?|报告|研报|披露|年报|filing)/i;

/**
 * Conservative built-in reviewer. It only flags a problem when the output looks
 * like a research deliverable but is missing a score or any source citation. It
 * never invokes the model, so it is safe offline and cheap.
 */
export const heuristicReviewer: QualityGateReviewer = async ({ messages }): Promise<QualityGateResult> => {
	const text = lastAssistantText(messages);
	if (text.trim().length === 0) {
		return { pass: true, findings: [] };
	}
	const looksLikeResearch = RESEARCH_TELLS.test(text);
	if (!looksLikeResearch) {
		return { pass: true, findings: [] };
	}
	const findings: string[] = [];
	if (!SCORE_TELL.test(text)) {
		findings.push("The deliverable appears to be a research/sector assessment but contains no explicit total score or grade.");
	}
	if (!SOURCE_TELL.test(text)) {
		findings.push("No source citation is present; quantitative claims should carry a source name/date/locator.");
	}
	return { pass: findings.length === 0, findings };
};

function buildFollowUp(findings: string[], attempt: number, max: number, extraInstructions?: string): string {
	const bullets = findings.map((f) => `- ${f}`).join("\n");
	const lines = [
		"[Quality gate] This draft was not approved for delivery. Address each issue below, then re-deliver the corrected result:",
		bullets,
		"Do not restate the whole report unless needed; just fix the gaps and keep every existing number, citation, and score intact.",
	];
	if (extraInstructions) {
		lines.push(extraInstructions);
	}
	lines.push(`(review attempt ${attempt + 1} of ${max})`);
	return lines.join("\n\n");
}

/**
 * Build a `before_run_end` hook handler that closes the review loop. The returned
 * function is stateless except for an internal per-run attempt map, so it is safe
 * to register once.
 */
export function createQualityGateHook(config: QualityGateConfig = {}): HookHandler<"before_run_end"> {
	const enabled = config.enabled ?? false;
	const maxAttempts = config.maxAttempts ?? 2;
	const reviewer = config.reviewer ?? heuristicReviewer;
	const attempts = new Map<string, number>();

	return async (event, context) => {
		if (!enabled) return undefined;

		const current = attempts.get(event.runId) ?? 0;
		if (current >= maxAttempts) {
			// Give up gracefully rather than looping forever; clear the slot.
			attempts.delete(event.runId);
			return undefined;
		}

		let result: QualityGateResult;
		try {
			result = await reviewer({ runId: event.runId, messages: event.messages, attempt: current, context });
		} catch (error) {
			// A broken reviewer must never block delivery - fail open.
			attempts.delete(event.runId);
			void error;
			return undefined;
		}

		if (result.pass || result.findings.length === 0) {
			attempts.delete(event.runId);
			return undefined;
		}

		attempts.set(event.runId, current + 1);
		return { followUp: buildFollowUp(result.findings, current, maxAttempts, config.extraInstructions) };
	};
}

/**
 * Register the quality gate on a harness `Hooks` instance and return an
 * unsubscribe function. A single-line, opt-in integration point.
 */
export function registerQualityGate(hooks: Hooks, config: QualityGateConfig = {}): () => void {
	return hooks.on("before_run_end", createQualityGateHook(config), { id: "research-quality-gate" });
}
