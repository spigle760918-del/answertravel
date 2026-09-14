export type Overview = {
  environment: "acceptance_test";
  brand: {
    name: string;
    version: number;
    status: string;
    facts: Array<{
      statement: string;
      category: string;
      status: string;
      visibility: string;
      source: string;
    }>;
  };
  truthQuality: {
    issues: Array<{ type: string; message: string; certainty: string }>;
  };
  questions: {
    panelVersion: number;
    status: string;
    mix: any;
    items: Array<{
      id: string;
      text: string;
      objectType: string;
      panelRole: string;
      included: boolean;
      exclusionReason: string | null;
    }>;
  };
  observations: {
    plans: Array<{
      id: string;
      model: string;
      surface: string;
      cycleKey: string;
      authorizedExpansion: boolean;
      plannedSamples: number;
      createdAt: string;
      success: number;
      failed: number;
      budgetStopped: number;
      tokens: number;
    }>;
    answers: Array<{
      id: string;
      planId: string;
      question: string;
      round: number;
      answerText: string;
      model: string;
      surface: string;
      finishReason: string;
      capturedAt: string;
      tokens: number;
      attempts: number;
      citationEvidence: {
        scanStatus: "pending" | "completed" | "failed";
        candidateCount: number;
        events: Array<{
          id: string;
          kind: string;
          rawUrl: string | null;
          canonicalUrl: string | null;
          domain: string | null;
          evidenceStatus: string;
          snapshot: null | {
            status: string;
            httpStatus: number | null;
            title: string | null;
            author: string | null;
            publishedAt: string | null;
            textExcerpt: string | null;
            contentSha256: string | null;
            errorCode: string | null;
            capturedAt: string;
          };
        }>;
      };
      geoAnalysis: {
        status: "pending" | "completed" | "failed";
        questionObjectType: string | null;
        mentions: Array<{
          entityId: string;
          entityName: string;
          entityRole: string;
          matchedAlias: string;
          excerpt: string;
          certainty: string;
        }>;
        rankings: Array<{
          entityId: string;
          entityName: string;
          applicability: string;
          rank: number | null;
          reason: string;
          evidenceExcerpt: string | null;
        }>;
        claims: Array<{
          entityId: string;
          entityName: string;
          claimText: string;
          sentiment: string;
          certainty: string;
        }>;
      };
    }>;
    failures: Array<{
      question: string;
      round: number;
      status: string;
      errorCode: string | null;
      attempt: number;
      completedAt: string;
    }>;
  };
  geoIntelligence: {
    rulesVersion: "basic-geo.v1";
    naturalSampleCount: number;
    brandNaturalMentionCount: number;
    brandNaturalMentionRate: number | null;
    competitorNaturalMentions: Array<{
      entityId: string;
      entityName: string;
      count: number;
      rate: number | null;
    }>;
    applicableRankingFacts: number;
    claimSentiments: Array<{ sentiment: string; count: number }>;
    note: string;
  };
  decisionIntelligence: null | {
    rulesVersion: "geo-gap-decision.v1";
    factLevel: string;
    evidenceStatus: string;
    sampleCount: number;
    observationPlanCount: number;
    primaryRootCause: string;
    summary: string;
    alternatives: string[];
    missingEvidence: string[];
    strongestCompetitor: null | {
      entityId: string;
      entityName: string;
      mentionCount: number;
    };
    actions: Array<{
      actionType: string;
      factLevel: string;
      title: string;
      rationale: string;
      priority: string;
      risk: string;
      requiresApproval: boolean;
      ownerType: string;
      expectedWindow: string;
      successMetric: string;
    }>;
    deepDive: {
      decision: string;
      factLevel: string;
      reason: string;
      proposedSampleBudget: number;
      questionThemes: string[];
      stopConditions: string[];
      requiresApproval: boolean;
    };
  };
  observationCycles: null | {
    rulesVersion: "comparable-observation.v1";
    status: "comparable" | "not_comparable" | "insufficient";
    validAnswerCount: number;
    observationPlanCount: number;
    differences: string[];
    approvedSampleBudget: number;
    approvedTokenBudget: number;
    decisionReference: string;
    diagnosisId: string | null;
    createdAt: string;
  };
  realBrandOnboarding: null | {
    brandName: string;
    status: "draft";
    sources: Array<{ sourceType: string; reference: string; capturedAt: string }>;
    facts: Array<{ statement: string; category: string; visibility: string; confidence: string; needsHumanConfirmation: boolean }>;
    competitors: Array<{ name: string; aliases: string[]; needsHumanConfirmation: boolean }>;
    seedQuestions: Array<{ text: string; group: string }>;
    conflicts: string[];
    gaps: string[];
    readyForApproval: boolean;
    truthDraft: { status: "draft"; publicCandidateCount: number; excludedCount: number; note: string };
  };
  limitations: string[];
};
