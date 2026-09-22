import { z } from "zod";

export const productApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  eventId: z.string().uuid().optional(),
});

export const workspaceSchema = z.object({
  tenantId: z.string().uuid(),
  brandName: z.string().min(1),
  environment: z.enum(["development", "test", "production"]),
  permissions: z.object({
    viewQuestions: z.literal(true),
    viewObservations: z.literal(true),
    viewEvidence: z.literal(true),
  }),
});

export const questionCandidateReadSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  journeyStage: z.string(),
  objectType: z.string(),
  panelRole: z.string(),
  intentCluster: z.string(),
  audience: z.string().nullable(),
  scenario: z.string().nullable(),
  included: z.boolean(),
  exclusionReason: z.string().nullable(),
});

export const questionPanelSummarySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  includedCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
});

export const questionPanelDetailSchema = questionPanelSummarySchema.extend({
  brandTruthVersion: z.number().int().positive(),
  mix: z.record(z.string(), z.unknown()),
  questions: z.array(questionCandidateReadSchema),
});

export const observationPlanSummarySchema = z.object({
  id: z.string().uuid(),
  questionPanelId: z.string().uuid(),
  questionPanelVersion: z.number().int().positive(),
  provider: z.string(),
  model: z.string(),
  surface: z.string(),
  cycleKey: z.string().nullable(),
  authorized: z.boolean(),
  plannedSamples: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  budgetStopped: z.number().int().nonnegative(),
  usedTokens: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
});

export const observationTargetReadSchema = z.object({
  id: z.string().uuid(),
  questionCandidateId: z.string().uuid(),
  question: z.string(),
  round: z.number().int().positive(),
  language: z.string().nullable(),
  region: z.string().nullable(),
  latestStatus: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  usedTokens: z.number().int().nonnegative(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  answerId: z.string().uuid().nullable(),
});

export const observationPlanDetailSchema = observationPlanSummarySchema.extend({
  rules: z.record(z.string(), z.unknown()),
  targets: z.array(observationTargetReadSchema),
});

export const rawAnswerDetailSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  targetId: z.string().uuid(),
  question: z.string(),
  round: z.number().int().positive(),
  answerText: z.string(),
  provider: z.string(),
  model: z.string(),
  surface: z.string(),
  finishReason: z.string(),
  providerResponseId: z.string(),
  payloadSha256: z.string().length(64),
  capturedAt: z.string().datetime({ offset: true }),
  tokens: z.object({ prompt: z.number().int().nonnegative(), completion: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  attempt: z.object({ number: z.number().int().positive(), status: z.string(), httpStatus: z.number().int().nullable(), completedAt: z.string().datetime({ offset: true }) }),
  evidence: z.object({ citationStatus: z.string(), citationCandidateCount: z.number().int().nonnegative(), geoAnalysisStatus: z.string() }),
});

export const productOverviewSchema = z.object({
  questionPanel: questionPanelSummarySchema.nullable(),
  latestPlan: observationPlanSummarySchema.nullable(),
  totals: z.object({ plans: z.number().int().nonnegative(), plannedSamples: z.number().int().nonnegative(), succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), usedTokens: z.number().int().nonnegative() }),
  nextStep: z.enum(["approve_questions", "create_plan", "review_run", "review_failures"]),
});

export const questionPanelListSchema = z.object({ items: z.array(questionPanelSummarySchema) });
export const observationPlanListSchema = z.object({ items: z.array(observationPlanSummarySchema) });

const questionInsightAnswerSchema = z.object({
  id: z.string().uuid().nullable(),
  round: z.number().int().positive(),
  status: z.string(),
  errorCode: z.string().nullable(),
  model: z.string(),
  surface: z.string(),
  capturedAt: z.string().datetime({ offset: true }).nullable(),
  citationStatus: z.string(),
  citationCandidates: z.number().int().nonnegative(),
  sourceSnapshots: z.number().int().nonnegative(),
  geoStatus: z.string(),
});

export const questionInsightSchema = z.object({
  context: z.object({
    panelId: z.string().uuid(), panelVersion: z.number().int().positive(),
    planCount: z.number().int().nonnegative(), provider: z.string().nullable(), model: z.string().nullable(), surface: z.string().nullable(),
    language: z.string().nullable(), region: z.string().nullable(), rulesVersion: z.string().nullable(),
    effectiveSamples: z.number().int().nonnegative(), failedSamples: z.number().int().nonnegative(),
    comparisonStatus: z.enum(["comparable", "single_platform", "insufficient"]),
  }).nullable(),
  questions: z.array(z.object({
    id: z.string().uuid(), text: z.string(), objectType: z.string(), journeyStage: z.string(),
    audience: z.string().nullable(), scenario: z.string().nullable(), included: z.boolean(),
    plannedSamples: z.number().int().nonnegative(), succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  })),
  selectedQuestionId: z.string().uuid().nullable(),
  answers: z.array(questionInsightAnswerSchema),
  entities: z.array(z.object({
    id: z.string(), name: z.string(), role: z.enum(["brand", "competitor"]),
    mentionedAnswers: z.number().int().nonnegative(), certainMentions: z.number().int().nonnegative(),
    claimCount: z.number().int().nonnegative(), applicableRanks: z.array(z.number().int().positive()),
  })),
  sources: z.object({
    structuredCitations: z.number().int().nonnegative(), inlineLinks: z.number().int().nonnegative(),
    sourceListItems: z.number().int().nonnegative(), absorptionCandidates: z.number().int().nonnegative(),
    snapshots: z.number().int().nonnegative(), successfulSnapshots: z.number().int().nonnegative(),
  }),
  decision: z.object({
    scope: z.literal("workspace_latest"), rulesVersion: z.string(), factLevel: z.string(), evidenceStatus: z.string(),
    summary: z.string(), rootCause: z.string(), sampleCount: z.number().int().nonnegative(),
    missingEvidence: z.array(z.unknown()), actions: z.array(z.object({
      id: z.string().uuid(), type: z.string(), title: z.string(), rationale: z.string(), priority: z.string(),
      risk: z.string(), requiresApproval: z.boolean(), factLevel: z.string(),
    })),
  }).nullable(),
});

export const questionPerformanceSchema = z.object({
  context: z.object({
    panelId: z.string().uuid(), panelVersion: z.number().int().positive(), planCount: z.number().int().nonnegative(),
    provider: z.string().nullable(), model: z.string().nullable(), surface: z.string().nullable(), rulesVersion: z.string().nullable(),
    effectiveSamples: z.number().int().nonnegative(), failedSamples: z.number().int().nonnegative(),
  }).nullable(),
  items: z.array(z.object({
    id: z.string().uuid(), text: z.string(), objectType: z.string(), journeyStage: z.string(), audience: z.string().nullable(), scenario: z.string().nullable(),
    plannedSamples: z.number().int().nonnegative(), effectiveAnswers: z.number().int().nonnegative(), failedSamples: z.number().int().nonnegative(),
    geoAnalyzedAnswers: z.number().int().nonnegative(), brandMentionAnswers: z.number().int().nonnegative(), competitorMentionAnswers: z.number().int().nonnegative(),
    citationCandidates: z.number().int().nonnegative(), sourceSnapshots: z.number().int().nonnegative(),
  })),
});

const analysisContextSchema = z.object({
  panelId: z.string().uuid(), panelVersion: z.number().int().positive(), planCount: z.number().int().nonnegative(),
  provider: z.string().nullable(), model: z.string().nullable(), surface: z.string().nullable(), rulesVersion: z.string().nullable(),
  effectiveSamples: z.number().int().nonnegative(), failedSamples: z.number().int().nonnegative(),
});

export const aiVisibilitySchema = z.object({
  context: analysisContextSchema.nullable(),
  brand: z.object({ id:z.string(), name:z.string() }).nullable(),
  items: z.array(z.object({
    id:z.string().uuid(), text:z.string(), objectType:z.string(), journeyStage:z.string(), audience:z.string().nullable(),
    plannedSamples:z.number().int().nonnegative(), effectiveAnswers:z.number().int().nonnegative(), failedSamples:z.number().int().nonnegative(),
    analyzedAnswers:z.number().int().nonnegative(), mentionedAnswers:z.number().int().nonnegative(), certainMentions:z.number().int().nonnegative(),
    claimCount:z.number().int().nonnegative(), positiveClaims:z.number().int().nonnegative(), negativeClaims:z.number().int().nonnegative(),
    applicableRanks:z.array(z.number().int().positive()),
  })),
});

export const sourceAnalysisSchema = z.object({
  context: analysisContextSchema.nullable(),
  items: z.array(z.object({
    id:z.string().uuid(), text:z.string(), objectType:z.string(), journeyStage:z.string(),
    effectiveAnswers:z.number().int().nonnegative(), failedSamples:z.number().int().nonnegative(), scannedAnswers:z.number().int().nonnegative(),
    inlineLinks:z.number().int().nonnegative(), sourceListItems:z.number().int().nonnegative(), structuredCitations:z.number().int().nonnegative(),
    absorptionCandidates:z.number().int().nonnegative(), successfulSnapshots:z.number().int().nonnegative(), blockedSnapshots:z.number().int().nonnegative(), failedSnapshots:z.number().int().nonnegative(),
  })),
  evidence: z.array(z.object({
    id:z.string().uuid(), questionId:z.string().uuid(), question:z.string(), answerId:z.string().uuid(), kind:z.string(),
    rawValue:z.string(), canonicalUrl:z.string().nullable(), domain:z.string().nullable(), evidenceStatus:z.string(), createdAt:z.string().datetime({offset:true}),
    snapshot:z.object({id:z.string().uuid(),status:z.string(),httpStatus:z.number().int().nullable(),title:z.string().nullable(),capturedAt:z.string().datetime({offset:true}),errorCode:z.string().nullable()}).nullable(),
  })),
});

export const competitorScopeSchema = z.object({
  status: z.enum(["not_established", "not_comparable", "approved"]),
  current: z.object({
    id:z.string().uuid(), version:z.number().int().positive(), status:z.string(), brandTruthVersion:z.number().int().positive(),
    effectiveFrom:z.string(), effectiveTo:z.string().nullable(), region:z.string(), evidenceNote:z.string(), sourceReference:z.string(),
    confirmedAt:z.string().datetime({offset:true}).nullable(), createdAt:z.string().datetime({offset:true}),
  }).nullable(),
  versions: z.array(z.object({id:z.string().uuid(),version:z.number().int().positive(),status:z.string(),effectiveFrom:z.string(),effectiveTo:z.string().nullable(),region:z.string(),entityCount:z.number().int().nonnegative(),createdAt:z.string().datetime({offset:true})})),
  entities: z.array(z.object({id:z.string().uuid(),entityId:z.string(),name:z.string(),aliases:z.array(z.string()),relationshipType:z.enum(["direct_competitor","alternative","reference","excluded"]),overlappingOfferings:z.array(z.string()),region:z.string(),effectiveFrom:z.string(),effectiveTo:z.string().nullable(),status:z.string(),evidenceNote:z.string(),sourceReference:z.string()})),
});

export const competitorAnalysisSchema = z.object({
  context: analysisContextSchema.nullable(),
  scope: z.object({version:z.number().int().positive(),region:z.string(),effectiveFrom:z.string(),effectiveTo:z.string().nullable()}).nullable(),
  items: z.array(z.object({
    id:z.string().uuid(), text:z.string(), objectType:z.string(), journeyStage:z.string(), comparability:z.enum(["comparable","not_comparable","insufficient"]), reason:z.string(),
    brand:z.object({name:z.string(),analyzedAnswers:z.number().int().nonnegative(),mentionedAnswers:z.number().int().nonnegative(),certainMentions:z.number().int().nonnegative(),applicableRanks:z.array(z.number().int().positive())}),
    competitors:z.array(z.object({entityId:z.string(),name:z.string(),relationshipType:z.enum(["direct_competitor","alternative"]),analyzedAnswers:z.number().int().nonnegative(),mentionedAnswers:z.number().int().nonnegative(),certainMentions:z.number().int().nonnegative(),applicableRanks:z.array(z.number().int().positive())})),
  })),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type ProductOverview = z.infer<typeof productOverviewSchema>;
export type QuestionPanelSummary = z.infer<typeof questionPanelSummarySchema>;
export type QuestionPanelDetail = z.infer<typeof questionPanelDetailSchema>;
export type ObservationPlanSummary = z.infer<typeof observationPlanSummarySchema>;
export type ObservationPlanDetail = z.infer<typeof observationPlanDetailSchema>;
export type RawAnswerDetail = z.infer<typeof rawAnswerDetailSchema>;
export type QuestionInsight = z.infer<typeof questionInsightSchema>;
export type QuestionPerformance = z.infer<typeof questionPerformanceSchema>;
export type AiVisibility = z.infer<typeof aiVisibilitySchema>;
export type SourceAnalysis = z.infer<typeof sourceAnalysisSchema>;
export type CompetitorScope = z.infer<typeof competitorScopeSchema>;
export type CompetitorAnalysis = z.infer<typeof competitorAnalysisSchema>;
