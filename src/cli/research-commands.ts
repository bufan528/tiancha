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
  EvaluationService,
  MaterialIngestService,
  PriorityService,
  ReportService,
  ResearchRepository,
} from "@tiancha/research";
import { MethodologyService } from "@tiancha/research";
import {
  formatEvaluationHuman,
  formatMaterialAddHuman,
  formatPoolHuman,
  formatPriorityHuman,
  formatReportHuman,
  toJson,
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
  /** Materialised-Markdown directory (production: `~/.tiancha/reports`). */
  reportDir: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface ResearchCliOptions {
  json: boolean;
}

export type ResearchSubcommand = "evaluate" | "pool" | "priority" | "report";
export const RESEARCH_SUBCOMMANDS: readonly ResearchSubcommand[] = ["evaluate", "pool", "priority", "report"];

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
    openGaps: deps.repo
      .listGaps(ind.industryId)
      .filter((g) => g.status === "open" || g.status === "mitigating").length,
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
