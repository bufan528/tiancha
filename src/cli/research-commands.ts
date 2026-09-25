/**
 * S7 CLI research commands — a thin **composition seam**.
 *
 * Each handler is: parse → service/repo call → formatter → out. Nothing more.
 * Dependencies are INJECTED so the same handlers run against `~/.tiancha` in production
 * and against a temp/in-memory db in tests — no global state, no hidden wiring.
 * The seam adds NO new domain logic (S7 red line 9).
 *
 * Write boundaries (R3 — locked with the reviewer):
 *   evaluate → EvaluationService.evaluate()          CLI MAY append an InvestmentEvaluation
 *   pool     → repository reads only
 *   priority → PriorityService.currentPriorities()   read-only face (S6-R1)
 *   report   → ReportService.generateDossier() + Markdown materialisation
 *              (appends a projection ONLY — Knowledge/Pool/Gap/Evaluation/State untouched)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  ChainProjectionService,
  DiligencePreparationService,
  EvaluationService,
  MaterialIngestService,
  PriorityService,
  QuestionTargetFitService,
  ReportService,
  ResearchNeedService,
  ResearchRepository,
  TargetService,
} from "@tiancha/research";
// ★ C2: the current-only preparation view (single source of truth for CLI/Agent output).
// ★ C2 Step 2-A: the shared active-requirement predicate (never re-written at call sites).
// ★ C2 Step 2-B: `targetRefFor` locates an EXISTING target for the link-only mode.
import { ActiveRequirementResolver, currentPreparationView, MethodologyService, targetRefFor } from "@tiancha/research";
import type { PositionCoverage } from "@tiancha/research";
import {
  formatChainHuman,
  formatDiligenceHuman,
  formatDiligenceListHuman,
  formatEvaluationHuman,
  formatMaterialAddHuman,
  formatNeedHuman,
  formatPoolHuman,
  formatPriorityHuman,
  formatReportHuman,
  formatTargetHuman,
  formatTargetWithFitHuman,
  toJson,
  type NeedListView,
  type TargetListView,
} from "./research-format.js";
import { renderDossierMarkdown, reportFileName } from "./report-markdown.js";

export interface ResearchCliDeps {
  repo: ResearchRepository;
  /** The ONLY writer in this seam (CLI `evaluate`). */
  evaluation: EvaluationService;
  priority: PriorityService;
  reports: ReportService;
  /** C-MVP: the material input pipe (writes a Material, then the existing claim pipeline). */
  materials: MaterialIngestService;
  /** B2: the ONLY writer of ResearchTarget — human-confirmed subjects. */
  targets: TargetService;
  /** B5: projects the chain template into `research_position` (idempotent, system-side). */
  chain: ChainProjectionService;
  /** B5: derives the read-only `ResearchNeed` list. */
  needs: ResearchNeedService;
  /** B5: read-only fit counts per target (B3 aggregation). */
  fits: QuestionTargetFitService;
  /** B5: assembles a preparation for one human-confirmed target (writes its own row). */
  diligence: DiligencePreparationService;
  /** Materialised-Markdown directory (production: `~/.tiancha/reports`). */
  reportDir: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface ResearchCliOptions {
  json: boolean;
}

export type ResearchSubcommand =
  | "evaluate"
  | "pool"
  | "priority"
  | "report"
  | "chain"
  | "need"
  | "diligence";
export const RESEARCH_SUBCOMMANDS: readonly ResearchSubcommand[] = [
  "evaluate",
  "pool",
  "priority",
  "report",
  "chain",
  "need",
  "diligence",
];

/** `--json` is a FORMAT switch only; the positional arg is the industry name. */
export function parseResearchArgs(rest: string[]): { name?: string; options: ResearchCliOptions } {
  return { name: rest.find((a) => !a.startsWith("--")), options: { json: rest.includes("--json") } };
}

export async function runResearchCommand(sub: string, rest: string[], deps: ResearchCliDeps): Promise<number> {
  const { name, options } = parseResearchArgs(rest);
  switch (sub) {
    case "evaluate":
      return runEvaluate(name, options, deps);
    case "pool":
      return runPool(name, options, deps);
    case "priority":
      return runPriority(name, options, deps);
    case "report":
      return runReport(name, options, deps);
    case "chain":
      return runChain(name, options, deps);
    case "need":
      return runNeed(name, options, deps);
    case "diligence":
      return runDiligence(rest, options, deps);
    default:
      deps.err(`unknown research subcommand: ${sub}（可用：${RESEARCH_SUBCOMMANDS.join(" | ")}）`);
      return 1;
  }
}

// ---- handlers ---------------------------------------------------------------

export async function runEvaluate(name: string | undefined, options: ResearchCliOptions, deps: ResearchCliDeps): Promise<number> {
  const ind = resolveIndustry(name, options, deps, "evaluate");
  if (!ind) return 1;
  // R3: the CLI is the ONLY place that appends a new InvestmentEvaluation.
  const evaluation = deps.evaluation.evaluate("industry", ind.industryId);
  deps.out(options.json ? toJson(evaluation) : formatEvaluationHuman(evaluation, dimensionNames(deps)));
  return 0;
}

export async function runPool(name: string | undefined, options: ResearchCliOptions, deps: ResearchCliDeps): Promise<number> {
  const ind = resolveIndustry(name, options, deps, "pool");
  if (!ind) return 1;
  const views = deps.repo.listPoolSlots(ind.industryId).map((slot) => ({
    slot,
    items: deps.repo.listPoolItems(slot.slotId),
  }));
  deps.out(options.json ? toJson(views) : formatPoolHuman(views, dimensionNames(deps)));
  return 0;
}

export async function runPriority(name: string | undefined, options: ResearchCliOptions, deps: ResearchCliDeps): Promise<number> {
  const ind = resolveIndustry(name, options, deps, "priority");
  if (!ind) return 1;
  // READ-ONLY: the persisted priorities S5 already produced (never recomputed here).
  const priorities = deps.priority.currentPriorities(ind.industryId);
  deps.out(options.json ? toJson(priorities) : formatPriorityHuman(priorities, dimensionNames(deps)));
  return 0;
}

export async function runReport(name: string | undefined, options: ResearchCliOptions, deps: ResearchCliDeps): Promise<number> {
  const ind = resolveIndustry(name, options, deps, "report");
  if (!ind) return 1;
  // A projection is GENERATED and appended (S6 semantics): "暂无" is per-section, and
  // generating never recomputes upstream (no Evaluation / Priority computation).
  const dossier = deps.reports.generateDossier(ind.industryId);
  const markdown = renderDossierMarkdown(dossier);
  mkdirSync(deps.reportDir, { recursive: true });
  const mdPath = join(deps.reportDir, reportFileName(ind.canonicalName, dossier.dossierId));
  writeFileSync(mdPath, markdown, "utf8");
  deps.out(options.json ? toJson({ ...dossier, markdownPath: mdPath }) : formatReportHuman(dossier, mdPath));
  return 0;
}

// ---- C-MVP: material entry --------------------------------------------------

/** `tiancha research material add <行业> <文件>` — the first real input pipe. */
export async function runMaterialAdd(
  industryName: string | undefined,
  file: string | undefined,
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
): Promise<number> {
  if (!industryName || !file) {
    deps.err("usage: tiancha research material add <行业> <文件> [--json]");
    return 1;
  }
  const ind = deps.repo.findIndustryByName(industryName);
  if (!ind) {
    deps.err(`未找到行业「${industryName}」。请先用 tiancha industry ingest 建立该行业。`);
    return 1;
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    deps.err(`无法读取材料文件：${(err as Error).message}`);
    return 1;
  }

  const snapshot = () => ({
    // ★ C2 Step 2-A: the active set comes from the shared resolver (same predicate as Need/Fit).
    openGaps: ActiveRequirementResolver.activeGaps(deps.repo.listGaps(ind.industryId)).length,
    priorities: deps.priority.currentPriorities(ind.industryId).length,
    slotStatuses: Object.fromEntries(
      deps.repo.listPoolSlots(ind.industryId).map((s) => [s.dimension, s.status]),
    ),
  });

  const before = snapshot();
  const title = basename(file);
  const result = await deps.materials.ingest({
    subjectKind: "industry",
    subjectId: ind.industryId,
    title,
    text,
    filename: title,
    locator: file,
  });
  const after = snapshot();

  const view = {
    industry: ind.canonicalName,
    title,
    materialId: result.material.materialId,
    created: result.created,
    parsedClaims: result.parsedClaims,
    parseErrors: result.parseErrors,
    before,
    after,
  };
  deps.out(options.json ? toJson(view) : formatMaterialAddHuman(view));
  return 0;
}

// ---- B2: ResearchTarget (human-confirmed subjects) ---------------------------

/** `--flag value` / repeated `--flag` parser (positional args collected separately). */
export function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return { positional, flags };
}

/**
 * `tiancha research target add <行业> --kind <k> --name <主体> --position <posRef>
 *  --purpose <...> --reason <...> [--fallback-for <ref>] [--limitation <...>]...
 *  [--accessibility <a>] [--value <n>] [--json]`
 *
 * ★ This is the ONLY target write path in the product (contract §6): the subject `--name`
 *   is human input, and `TargetService` hard-codes `createdBy="user"`.
 */
export async function runTargetAdd(
  rest: string[],
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
): Promise<number> {
  const { positional, flags } = parseFlags(rest);
  const industryName = positional[0];
  const name = flags.get("name")?.[0];
  const kind = flags.get("kind")?.[0];
  const positionRef = flags.get("position")?.[0];
  const purpose = flags.get("purpose")?.[0];
  const reason = flags.get("reason")?.[0];
  const fallbackFor = flags.get("fallback-for")?.[0] || undefined;
  // ★ C2 Step 2-B: `--for-gap <gapId>` is repeatable (`parseFlags` accumulates) and is the ONLY
  //   trigger that writes `relatedRequirementRefs`. A gapId is **never** stored on the Target
  //   (FINAL LOCK §1.4: the refs hold requirement refs, not gap refs).
  const forGaps = (flags.get("for-gap") ?? []).filter((value) => value !== "");

  // Q7a: the industry + `--name` are always required. The four CREATE args may be omitted ONLY in
  // link-only mode — which needs an EXISTING target — so that check runs after the target lookup.
  if (!industryName || !name) {
    deps.err(
      "usage: tiancha research target add <行业> --name <主体> --kind <k> --position <posRef> " +
        "--purpose <...> --reason <...> [--fallback-for <ref>] [--limitation <...>]... " +
        "[--accessibility <contactable|likely|unlikely|unknown>] [--value <0..1>] [--for-gap <gapId>]... [--json]\n" +
        "       把既有对象关联到研究缺口：tiancha research target add <行业> --name <主体> --for-gap <gapId>...",
    );
    return 1;
  }

  const ind = deps.repo.findIndustryByName(industryName);
  if (!ind) {
    deps.err(`未找到行业「${industryName}」。请先用 tiancha industry ingest 建立该行业。`);
    return 1;
  }

  // ★ C′ / Q7a: an EXISTING target + at least one `--for-gap` = link-only mode (create args may
  // be omitted there); a NEW target always needs them.
  const subjectKey = name.trim();
  const existing = deps.targets.get(targetRefFor(ind.industryId, subjectKey));
  const linkOnly = existing !== undefined && forGaps.length > 0;
  const createArgsProvided = Boolean(kind && positionRef && purpose && reason);
  if (!linkOnly && !createArgsProvided) {
    deps.err(
      "usage: tiancha research target add <行业> --name <主体> --kind <k> --position <posRef> " +
        "--purpose <...> --reason <...> [--for-gap <gapId>]... [--json]\n" +
        "       只有已存在的对象才可用 --for-gap 关联（此时可省略创建参数）。",
    );
    return 1;
  }

  const accessibility = flags.get("accessibility")?.[0] as
    | "contactable"
    | "likely"
    | "unlikely"
    | "unknown"
    | undefined;
  const valueRaw = flags.get("value")?.[0];
  const expectedInformationValue = valueRaw !== undefined && valueRaw !== "" ? Number(valueRaw) : undefined;
  if (expectedInformationValue !== undefined && Number.isNaN(expectedInformationValue)) {
    deps.err(`--value 必须是数字：${valueRaw}`);
    return 1;
  }

  // ---- ★ Step 2-B · atomicity step ①: validate EVERY --for-gap BEFORE any write -----------
  // (a rejected gap must leave the database completely untouched — T-C2-40①)
  const gapsById = new Map(deps.repo.listGaps(ind.industryId).map((gap) => [gap.gapId, gap]));
  for (const gapId of forGaps) {
    if (gapsById.has(gapId)) continue;
    // distinguish "unknown gap" from "gap of another industry" (Q6 ruling)
    const foreign = deps.repo
      .listIndustries()
      .filter((i) => i.industryId !== ind.industryId)
      .some((i) => deps.repo.listGaps(i.industryId).some((gap) => gap.gapId === gapId));
    deps.err(
      foreign ? `研究缺口「${gapId}」不属于行业「${ind.canonicalName}」。` : `未找到研究缺口「${gapId}」。`,
    );
    return 1; // ★ zero mutation: `targets.add()` is never reached
  }

  // ---- ★ C′ (link-only): `relatedRequirementRefs` is the ONLY field allowed to change -----
  // An explicitly provided non-refs argument that WOULD change a field is an ERROR — user input
  // is never silently swallowed (contract §4.2 / gate Q1).
  if (linkOnly && existing) {
    const conflicts: string[] = [];
    if (kind !== undefined && kind !== existing.targetKind) conflicts.push("--kind");
    if (positionRef !== undefined && positionRef !== existing.positionRef) conflicts.push("--position");
    if (purpose !== undefined && purpose.trim() !== existing.researchPurpose) conflicts.push("--purpose");
    if (reason !== undefined && reason.trim() !== existing.selectionReason) conflicts.push("--reason");
    if (flags.has("limitation") && JSON.stringify(flags.get("limitation") ?? []) !== JSON.stringify(existing.limitations)) {
      conflicts.push("--limitation");
    }
    if (accessibility !== undefined && accessibility !== existing.accessibility) conflicts.push("--accessibility");
    if (expectedInformationValue !== undefined && expectedInformationValue !== existing.expectedInformationValue) {
      conflicts.push("--value");
    }
    if ((flags.has("fallback-for") || fallbackFor !== undefined) && (!existing.isFallback || existing.fallbackForTargetRef !== (fallbackFor ?? null))) {
      conflicts.push("--fallback-for");
    }
    if (conflicts.length > 0) {
      deps.err(
        `关联模式（既有对象 + --for-gap）只允许改变 relatedRequirementRefs，不能修改其它字段：` +
          `${conflicts.join("、")}。请去掉这些参数；如需修改对象本身，请单独执行一次 target add。`,
      );
      return 1; // ★ zero mutation
    }
  }

  // ---- ★ Step 2-B · atomicity step ②: derive the refs (FINAL LOCK §4.2 order) -------------
  // start point = the EXISTING refs (or [] for a new target); then, for every <gapId> in CLI
  // order, append `gap.relatedRequirementIds` in their own order; first occurrence wins.
  const merged: string[] = [...(existing?.relatedRequirementRefs ?? [])];
  const seen = new Set(merged);
  for (const gapId of forGaps) {
    for (const ref of gapsById.get(gapId)!.relatedRequirementIds) {
      if (seen.has(ref)) continue; // de-dupes repeated --for-gap too (Q5)
      seen.add(ref);
      merged.push(ref);
    }
  }

  // ---- ★ Step 2-B · atomicity step ③: exactly ONE persistence ----------------------------
  try {
    const target = deps.targets.add(
      linkOnly && existing
        ? {
            // C′: every non-refs field is taken from the EXISTING row, so this single upsert can
            // only ever change `relatedRequirementRefs`. `TargetService.add()` is untouched.
            industryId: ind.industryId,
            subjectKey: existing.subjectKey,
            targetKind: existing.targetKind,
            positionRef: existing.positionRef,
            researchPurpose: existing.researchPurpose,
            selectionReason: existing.selectionReason,
            expectedInformationValue: existing.expectedInformationValue,
            accessibility: existing.accessibility,
            limitations: existing.limitations,
            isFallback: existing.isFallback,
            fallbackForTargetRef: existing.fallbackForTargetRef,
            kindSubject: existing.kindSubject,
            relatedQuestionRefs: existing.relatedQuestionRefs,
            relatedRequirementRefs: merged,
          }
        : {
            industryId: ind.industryId,
            subjectKey,
            targetKind: kind!,
            positionRef: positionRef!,
            researchPurpose: purpose!,
            selectionReason: reason!,
            limitations: flags.get("limitation") ?? [],
            accessibility,
            expectedInformationValue,
            isFallback: fallbackFor !== undefined,
            fallbackForTargetRef: fallbackFor ?? null,
            // FINAL LOCK §4.2: without `--for-gap` the existing refs are PRESERVED ([] for new).
            relatedRequirementRefs: merged,
          },
    );
    deps.out(options.json ? toJson(target) : formatTargetHuman(target));
    return 0;
  } catch (err) {
    deps.err(`无法录入研究对象：${(err as Error).message}`);
    return 1;
  }
}

/** `tiancha research target list <行业> [--json]` */
export async function runTargetList(
  industryName: string | undefined,
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
): Promise<number> {
  if (!industryName) {
    deps.err("usage: tiancha research target list <行业> [--json]");
    return 1;
  }
  const ind = deps.repo.findIndustryByName(industryName);
  if (!ind) {
    deps.err(`未找到行业「${industryName}」。`);
    return 1;
  }
  // B5: each target is listed together with its READ-ONLY fit counts (B3 aggregation over
  // the same `QuestionTargetFit`s the outline uses) — no target is written or chosen here.
  // ★ C2 Step 2-B: also show which requirements the target is used to fill ("用于补充 Requirement").
  // The label is the requirement's dimension name — deterministically derived from the row, no LLM.
  const requirementsById = new Map(deps.repo.listRequirements(ind.industryId).map((r) => [r.requirementId, r]));
  const names = dimensionNames(deps);
  const views: TargetListView[] = deps.targets.list(ind.industryId).map((target) => ({
    target,
    fit: deps.fits.summarize(target.targetRef),
    requirementLabels: target.relatedRequirementRefs.map((ref) => {
      const requirement = requirementsById.get(ref);
      return { ref, label: requirement ? (names[requirement.dimension] ?? requirement.dimension) : ref };
    }),
  }));
  deps.out(options.json ? toJson(views) : formatTargetWithFitHuman(views));
  return 0;
}

// ---- B5: chain / need / diligence exposure ---------------------------------
// B5 exposes what B1–B4 already compute. Write boundaries are unchanged: the CLI may
// project the chain (system-side, idempotent) and assemble a preparation for a
// HUMAN-confirmed target; nothing here writes Gap / Priority / Requirement / Pool.

/**
 * `tiancha research chain <行业> [--json]` — B5 exposure of B1.
 *
 * ★ This is the ONE production entry that runs the template projection. `project()` is
 *   idempotent (stable `positionRef`, I-B7) and writes ONLY `research_position`, which is
 *   a system-side projection (contract §6). Without this command the B1 projection would
 *   be unreachable outside tests, and `target add --position <ref>` would have no legal
 *   way to obtain a `positionRef`.
 */
export async function runChain(
  name: string | undefined,
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
): Promise<number> {
  const ind = resolveIndustry(name, options, deps, "chain");
  if (!ind) return 1;
  const result = deps.chain.project(ind.industryId);
  // ★ C2 Step 2-A: coverage is derived READ-ONLY from the projected positions (no write-back,
  // no state change on a position); the derivation is shared with the Agent tool below so the
  // two surfaces can never disagree (T-C2-36).
  const derived = deps.chain.positionCoverage(ind.industryId);
  // …and align it to the PROJECTED order, so `positions` and `coverage` line up by index too
  // (the derivation reads positions from the repository, whose order is not the template order).
  const coverageByRef = new Map(derived.map((c) => [c.positionRef, c]));
  const coverage: PositionCoverage[] = result.positions
    .map((p) => coverageByRef.get(p.positionRef))
    .filter((c): c is PositionCoverage => c !== undefined);
  deps.out(options.json ? toJson({ ...result, coverage }) : formatChainHuman(result, coverage));
  return 0;
}

/** `tiancha research need <行业> [--json]` — READ-ONLY derivation of `ResearchNeed` (I-B6). */
export async function runNeed(
  name: string | undefined,
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
): Promise<number> {
  const ind = resolveIndustry(name, options, deps, "need");
  if (!ind) return 1;
  const view: NeedListView = {
    industry: ind.canonicalName,
    // Without projected positions we cannot say WHICH position serves a need; say so.
    chainProjected: deps.repo.listPositions(ind.industryId).length > 0,
    needs: deps.needs.list(ind.industryId),
  };
  deps.out(options.json ? toJson(view) : formatNeedHuman(view, dimensionNames(deps)));
  return 0;
}

/**
 * `tiancha research diligence <行业> [--target <targetRef>] [--json]`
 *
 * With `--target`: assemble (and persist) the preparation for that human-confirmed target.
 * Without it: list the industry's existing preparations — read-only, so no target is
 * ever guessed on the user's behalf.
 */
export async function runDiligence(
  rest: string[],
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
): Promise<number> {
  const { positional, flags } = parseFlags(rest);
  const industryName = positional[0];
  const targetRef = flags.get("target")?.[0];
  if (!industryName) {
    deps.err("usage: tiancha research diligence <行业> [--target <targetRef>] [--all] [--json]");
    return 1;
  }
  const ind = deps.repo.findIndustryByName(industryName);
  if (!ind) {
    deps.err(`未找到行业「${industryName}」。`);
    return 1;
  }

  if (!targetRef) {
    const preparations = deps.diligence.list(ind.industryId);
    deps.out(
      options.json
        ? toJson(preparations.map(currentPreparationView))
        : formatDiligenceListHuman(preparations, ind.canonicalName),
    );
    return 0;
  }

  const target = deps.targets.get(targetRef);
  if (!target) {
    deps.err(`未找到研究对象「${targetRef}」。请先用 tiancha research target list <行业> 查看。`);
    return 1;
  }
  if (target.industryId !== ind.industryId) {
    deps.err(`研究对象「${targetRef}」不属于行业「${ind.canonicalName}」。`);
    return 1;
  }
  try {
    // ★ C2 (I-C2-9): `--all` is an EXPLICIT audit mode ("this target vs ALL requirements").
    // The default scope is the gaps that are still open — never an implicit fallback.
    const preparation = deps.diligence.prepare(targetRef, { all: flags.has("all") });
    deps.out(
      options.json ? toJson(currentPreparationView(preparation)) : formatDiligenceHuman(preparation),
    );
    return 0;
  } catch (err) {
    deps.err(`无法生成调研准备：${(err as Error).message}`);
    return 1;
  }
}

// ---- helpers ----------------------------------------------------------------

function resolveIndustry(
  name: string | undefined,
  options: ResearchCliOptions,
  deps: ResearchCliDeps,
  sub: ResearchSubcommand,
): { industryId: string; canonicalName: string } | undefined {
  if (!name) {
    deps.err(`usage: tiancha research ${sub} <行业> [--json]`);
    return undefined;
  }
  const ind = deps.repo.findIndustryByName(name);
  if (!ind) {
    const message = `未找到行业「${name}」。`;
    deps.out(options.json ? toJson({ error: "industry_not_found", name, message }) : message);
    deps.err(message);
    return undefined;
  }
  return { industryId: ind.industryId, canonicalName: ind.canonicalName };
}

/** Dimension labels for human output (presentation only; never a business rule). */
function dimensionNames(deps: ResearchCliDeps): Record<string, string> {
  const active = new MethodologyService(deps.repo).getActive();
  const names: Record<string, string> = {};
  for (const d of active.dimensions) names[d.key] = d.name;
  return names;
}
