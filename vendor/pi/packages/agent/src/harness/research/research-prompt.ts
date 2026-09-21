/**
 * Deep-investment-research loop system-prompt skeleton.
 *
 * This is a kernel-side, configurable prompt fragment (NOT a forced prompt). The
 * host / extension layer injects it as a named system-prompt section (e.g. via the
 * `sections` option on `buildSystemPromptSections`) by calling
 * `buildResearchLoopSection({ enabled: true, scoringConfig })`. When `enabled` is
 * false/undefined it returns `undefined` so the default assistant behavior is
 * unchanged.
 *
 * Loop: planning -> hypothesis -> multi-source collection -> cross-validation ->
 * scoring -> conclusion -> self-check. The scoring block mirrors the 7-dimension
 * model in docs/SCORING_MODEL.md so "change config = change scoring rubric".
 */

/** Section name used when this fragment is injected into the structured system prompt. */
export const RESEARCH_LOOP_SECTION_NAME = "research_loop";

/** Default, self-contained loop skeleton injected when research mode is enabled. */
export const DEFAULT_RESEARCH_LOOP_PROMPT = `You are operating in deep-investment-research mode for an early-stage (primary-market) sector scan. Follow this loop for every sector/industry investigation, and do not skip steps:

1. PLANNING - State the question being answered, the scope (geography, segment, time horizon), the deliverable format, and a short research plan with the sources you intend to consult.
2. HYPOTHESIS - Form 2-3 testable hypotheses about the sector that this investigation will confirm or refute.
3. MULTI-SOURCE COLLECTION - Gather evidence from at least two independent source types (e.g. industry report + company/filing + expert/Wind-style data). For every quantitative claim record its source name, date, and a locator (URL / document / tool-output id).
4. CROSS-VALIDATION - Compare sources against each other. Flag conflicts explicitly, prefer primary and more recent sources, and never average or blend conflicting numbers without noting the discrepancy.
5. SCORING - Apply the current scoring configuration (dimensions, weights, anchors, threshold). For EACH dimension give: the 0-10 sub-score, the weight, the anchor it maps to, and the specific evidence cited. Then compute total = sum(sub_score * weight) * 10, rounded to an integer.
6. CONCLUSION - State the total score, the grade band (A/B/C/D), the enter-pool decision relative to the threshold, the 3 strongest reasons, and the top risks / open unknowns.
7. SELF-CHECK - Before delivering, verify: (a) every number has a source, (b) every dimension score cites evidence, (c) no conclusion rests on an unsupported claim, (d) the grade is consistent with the computed score. If a quality-gate review returns findings, address each finding and re-deliver the corrected result.

Rules: never fabricate data; label estimates/assumptions as such; preserve numbers, units, dates, and citations verbatim rather than paraphrasing them away.`;

export interface ResearchLoopSectionOptions {
	/** When false/undefined, `buildResearchLoopSection` returns `undefined` (feature off). */
	enabled?: boolean;
	/**
	 * Optional serialized scoring configuration (e.g. the JSON of
	 * config/scoring.json) injected verbatim so the model applies the live rubric.
	 */
	scoringConfig?: string;
	/** Optional override of the loop skeleton text. Defaults to `DEFAULT_RESEARCH_LOOP_PROMPT`. */
	prompt?: string;
}

/**
 * Build the research-loop system-prompt section text, or `undefined` when the
 * feature is disabled. The returned string is meant to be placed under the
 * `research_loop` section key of the structured system prompt.
 */
export function buildResearchLoopSection(options: ResearchLoopSectionOptions = {}): string | undefined {
	if (!options.enabled) return undefined;
	const prompt = options.prompt ?? DEFAULT_RESEARCH_LOOP_PROMPT;
	if (!options.scoringConfig) return prompt;
	return `${prompt}\n\n<scoring_config>\n${options.scoringConfig}\n</scoring_config>`;
}
