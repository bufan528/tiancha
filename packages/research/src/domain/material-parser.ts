/**
 * Material claim parser (Phase C-MVP) — **rule-based, no model**.
 *
 * The ONLY thing that becomes a Claim is an explicit block:
 *
 *   [CLAIM]
 *   dimension: market
 *   content: 市场规模约 500 亿元，CAGR 25%
 *   confidence: 0.8            # optional
 *   source: 客户访谈 A          # optional
 *   relation: REVISE           # optional: SUPPORT | REVISE | CONFLICT | SUPERSEDE
 *   supersedes: artifact:claim/xxx   # required only when relation is SUPERSEDE
 *   [/CLAIM]
 *
 * Everything outside such blocks stays material text and produces NO claim. A malformed
 * block is REPORTED (in `errors`) and skipped — it is never guessed or invented.
 * There is deliberately no LLM here: Phase C-MVP only proves that real material can
 * enter the system and drive the existing state machine.
 */

import type { ParsedClaim, ParsedRelationHint } from "./material.js";

/**
 * ★ §29.2 (C-MVP-R1): recorded on every material row, so a resume / audit knows exactly which
 * rule version produced the blocks. Bump it whenever the block grammar changes.
 */
export const PARSER_VERSION = "material-parser/v1";

export interface ParseResult {
  claims: ParsedClaim[];
  errors: string[];
}

const CLAIM_BLOCK = /\[CLAIM\]([\s\S]*?)\[\/CLAIM\]/gi;

const RELATIONS = new Set(["SUPPORT", "REVISE", "CONFLICT", "SUPERSEDE"]);

export function parseClaims(text: string): ParseResult {
  const claims: ParsedClaim[] = [];
  const errors: string[] = [];
  let index = 0;

  for (const match of text.matchAll(CLAIM_BLOCK)) {
    index += 1;
    const body = match[1] ?? "";
    const fields = parseFields(body);
    const label = `claim block #${index}`;

    const dimension = fields.get("dimension")?.trim();
    if (!dimension) {
      errors.push(`${label}: missing "dimension"`);
      continue;
    }
    const statement = (fields.get("content") ?? fields.get("statement"))?.trim();
    if (!statement) {
      errors.push(`${label}: missing "content"`);
      continue;
    }

    const claim: ParsedClaim = { dimension, statement };

    const confidence = fields.get("confidence");
    if (confidence !== undefined) {
      const value = Number(confidence);
      if (Number.isNaN(value)) errors.push(`${label}: "confidence" is not a number (ignored)`);
      else claim.confidence = value;
    }

    const source = fields.get("source")?.trim();
    if (source) claim.sourceRef = source;

    const relation = fields.get("relation")?.trim().toUpperCase();
    if (relation) {
      if (!RELATIONS.has(relation)) {
        errors.push(`${label}: unknown relation "${relation}" (ignored)`);
      } else {
        const hint = relationHint(relation, fields.get("supersedes")?.trim(), errors, label);
        if (hint) claim.relationHint = hint;
      }
    }

    claims.push(claim);
  }

  return { claims, errors };
}

function relationHint(
  relation: string,
  supersedes: string | undefined,
  errors: string[],
  label: string,
): ParsedRelationHint | undefined {
  switch (relation) {
    case "SUPPORT":
      return { kind: "SUPPORT" };
    case "REVISE":
      return { kind: "REVISE" };
    case "CONFLICT":
      return { kind: "CONFLICT" };
    case "SUPERSEDE":
      if (!supersedes) {
        errors.push(`${label}: relation SUPERSEDE requires "supersedes" (ignored)`);
        return undefined;
      }
      return { kind: "SUPERSEDE", supersedesClaimRef: supersedes };
    default:
      return undefined;
  }
}

/** `key: value` lines inside a block (comments after `#` are ignored). */
function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key.length > 0) fields.set(key, value);
  }
  return fields;
}
