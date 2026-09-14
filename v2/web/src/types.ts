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
  limitations: string[];
};
