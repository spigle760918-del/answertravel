export type Overview = {
  environment: "acceptance_test" | "real_brand_draft" | "real_brand_baseline";
  alphaReadiness?:{rulesVersion:"alpha-readiness.v1";overallStatus:"ready"|"pending"|"blocked";summary:string;items:Array<{key:string;label:string;status:"ready"|"pending"|"blocked"|"not_in_alpha";evidence:string;requiredForLaunch:boolean}>;readyCount:number;pendingCount:number;blockedCount:number;notInAlphaCount:number};
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
  periodicMonitoring: null | { status:"active"|"paused"; cadence:"daily"; timezone:"Asia/Shanghai"; nextRunAt:string; maxSamplesPerCycle:number; maxTokensPerCycle:number; decisionReference:string; cycles:Array<{cycleKey:string;scheduledFor:string;observationPlanId:string;status:"planned"}> };
  brandClaimVerification: { rulesVersion:"brand-claim-verification.v2"; analyzedAnswers:number; totalFindings:number; counts:Array<{verdict:string;count:number}>; findings:Array<{id:string;answerId:string;question:string;round:number;claimText:string;evidenceExcerpt:string;verdict:string;severity:string;matchedRule:string|null;brandFactId:string|null;reason:string;createdAt:string}>; note:string };
  evidenceGapRouting:null|{rulesVersion:"evidence-gap-routing.v1";sourceFindingCount:number;clusterCount:number;createdAt:string;clusters:Array<{id:string;theme:string;title:string;factLevel:"F3";priorityScore:number;occurrenceCount:number;uniqueClaimCount:number;cycleCount:number;recommendedRoute:string;rationale:string;noActionOption:string;minimalHumanQuestion:string|null;expectedWindow:string;risk:string;contentBriefEligible:boolean}>};
  optimizationActionPlan:null|{rulesVersion:"optimization-action-plan.v1";sourceFindingCount:number;sourceClusterCount:number;packageCount:number;createdAt:string;executionOrder:string[];packages:Array<{id:string;key:string;title:string;factLevel:"F4";priority:number;status:"waiting_facts"|"ai_can_prepare"|"waiting_yes_no"|"no_action";risk:string;sourceClusterIds:string[];sourceFindingIds:string[];businessGoal:string;aiPreparation:string[];humanInputs:string[];approvalQuestion:string|null;afterHumanInput:string;dependencies:string[];acceptanceCriteria:string[];noActionOption:string;expectedWindow:string}>};
  trustEvidenceBlueprint:null|{rulesVersion:"trust-evidence-blueprint.v1";status:"draft";factLevel:"F4";evidenceItemCount:number;evidenceItems:Array<{id:string;factId:string;statement:string;factLevel:"F1";sourceReference:string;sourceClass:string;verificationState:"user_confirmed_reference"|"independent_snapshot";sourceStrength:string;publicUse:string;exactUrl:string|null;missingEvidence:string[]}>;pageSections:Array<{key:string;heading:string;purpose:string;factIds:string[];requiredFields:string[];displayRules:string[]}>;machineReadableDraft:Record<string,unknown>;prohibitedClaims:string[];nextEvidenceTasks:string[];publicationAuthorized:false;createdAt:string};
  trustSourceVerification:null|{rulesVersion:"trust-source-verification.v1";status:"complete_with_gaps";factLevel:"F2";targetCount:4;independentlyVerifiedCount:number;selfAssertedCount:number;blockedCount:number;results:Array<{id:string;key:string;label:string;url:string;factLevel:"F1";fetchStatus:"succeeded"|"blocked"|"failed";verificationStatus:"independently_verified"|"self_asserted"|"source_blocked"|"insufficient";httpStatus:number|null;title:string|null;textExcerpt:string|null;contentSha256:string|null;errorCode:string|null;capturedAt:string;verifiedSignals:string[];limitations:string[]}>;resolvedEvidenceTasks:string[];remainingEvidenceTasks:string[];publicationAuthorized:false;createdAt:string};
  websiteDiagnosis:null|{rulesVersion:"website-diagnosis.v1";status:"complete_with_gaps";factLevel:"F2";targetCount:number;succeededCount:number;blockedCount:number;failedCount:number;pages:Array<{key:string;label:string;url:string;status:string;httpStatus:number|null;title:string|null;contentSha256:string|null;errorCode:string|null;documentSignals:unknown}>;strengths:string[];gaps:string[];selfReportedClaims:string[];publicationAuthorized:false;createdAt:string};
  refundPolicyIntake:null|{rulesVersion:"refund-policy-intake.v1";status:"waiting_facts";factLevel:"F4";sourceFindingCount:7;fieldCount:7;fields:Array<{key:string;label:string;question:string;whyNeeded:string;requiredInputs:string[];acceptableEvidence:string[];visibility:"internal_first"|"public_candidate";required:true}>;paths:Array<{key:"current_policy"|"no_unified_policy";label:string;whenToChoose:string;nextStep:string;publicOutcome:string}>;completenessRules:string[];conflictRules:string[];missingInputs:string[];summaryDraftAuthorized:false;publicationAuthorized:false;createdAt:string};
  actionFactIntakes:Array<{rulesVersion:"action-fact-intake.v1";status:"waiting_facts";factLevel:"F4";actionPackageKey:string;actionPackageTitle:string;personalizationMode:"diagnosis_driven";sourceFindingCount:number;coreEnvelopeFields:string[];focusCount:number;focusAreas:Array<{key:string;label:string;prompt:string;businessReason:string;requestedInputs:string[];acceptableEvidence:string[];required:true}>;responseOptions:Array<"provide_now"|"not_applicable"|"defer">;acceptanceCriteria:string[];completenessRules:string[];missingInputs:string[];factDraftAuthorized:false;publicationAuthorized:false;createdAt:string}>;
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
