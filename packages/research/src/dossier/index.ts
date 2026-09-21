/**
 * Dossier projection — Phase 1 placeholder. Dossier is a projection over
 * Fact/Claim/Evidence/Event, never a source of truth.
 */
export interface Dossier {
  dossierId: string;
  industryId?: string;
  companyId?: string;
  updatedAt: string;
}

export class DossierEngine {
  async build(_params: { industryId?: string; companyId?: string }): Promise<Dossier> {
    throw new Error("DossierEngine is a Phase 2 placeholder");
  }
}
