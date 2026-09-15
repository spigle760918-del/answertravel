import { createActionFactIntake } from "./action-fact-intake.js";
import { ActionFactIntakeRepository } from "./action-fact-intake-repository.js";

export class ActionFactIntakeService {
  constructor(private readonly repository: ActionFactIntakeRepository) {}

  async create(tenantId: string, actionPackageKey: string) {
    const plan = await this.repository.input(tenantId);
    const draft = createActionFactIntake(tenantId, plan, actionPackageKey);
    const existing = await this.repository.byHash(tenantId, draft.inputSha256);
    if (existing) return { intake: existing, idempotent: true };
    return { intake: await this.repository.save(draft), idempotent: false };
  }
}
