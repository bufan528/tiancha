/**
 * ResearchState — independent, persisted research cognition (Phase 2A).
 * Distinct from Dossier/Profile (which are projections).
 * Answers: what are we researching / what is known / what is verified /
 * what is uncertain/conflicting/unknown / key questions / gaps / next actions.
 */

export interface StateItemRef {
  ref: string;
  confidence?: number;
}

export interface ResearchState {
  stateId: string;
  subjectKind: "industry" | "company" | "general";
  subjectId: string;
  known: StateItemRef[];
  confirmed: StateItemRef[];
  uncertain: StateItemRef[];
  conflicting: StateItemRef[];
  unknown: StateItemRef[];
  keyQuestionIds: string[];
  researchGapIds: string[];
  nextActionIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function emptyResearchState(params: {
  stateId: string;
  subjectKind: ResearchState["subjectKind"];
  subjectId: string;
  now?: Date;
}): ResearchState {
  const now = (params.now ?? new Date()).toISOString();
  return {
    stateId: params.stateId,
    subjectKind: params.subjectKind,
    subjectId: params.subjectId,
    known: [],
    confirmed: [],
    uncertain: [],
    conflicting: [],
    unknown: [],
    keyQuestionIds: [],
    researchGapIds: [],
    nextActionIds: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
