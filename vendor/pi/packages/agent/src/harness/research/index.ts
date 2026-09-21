/**
 * Investment-research kernel extensions:
 *  - research-prompt.ts: configurable deep-research loop system-prompt skeleton
 *  - quality-gate.ts:     pre-delivery fact-check / self-review loop on before_run_end
 */
export {
	DEFAULT_RESEARCH_LOOP_PROMPT,
	RESEARCH_LOOP_SECTION_NAME,
	buildResearchLoopSection,
	type ResearchLoopSectionOptions,
} from "./research-prompt.ts";
export {
	createQualityGateHook,
	heuristicReviewer,
	lastAssistantText,
	registerQualityGate,
	type QualityGateConfig,
	type QualityGateResult,
	type QualityGateReviewer,
} from "./quality-gate.ts";
