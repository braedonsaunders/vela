import type { AISearchJob, SearchRequest, SearchResponse } from '../../wire/v0/types';
import type { ServerAdapter } from '../adapter';

/** One coordinator per search surface. Callers provide unique mutation keys. */
export class SearchCoordinator {
  private generation = 0;
  private job?: AISearchJob;
  constructor(private adapter: ServerAdapter) {}
  begin(): number { return ++this.generation; }
  async search(request: SearchRequest): Promise<SearchResponse | undefined> {
    const result = await this.adapter.search(request);
    return result.generation === this.generation && request.generation === this.generation ? result : undefined;
  }
  async startAI(query: string, generation: number, idempotencyKey: string): Promise<AISearchJob | undefined> {
    const result = await this.adapter.startAI({ query, generation, idempotencyKey, previousJobId: this.job?.id });
    if (generation !== this.generation || result.generation !== generation) return undefined;
    this.job = result;
    return result;
  }
  async pollAI(): Promise<AISearchJob | undefined> {
    const job = this.job;
    if (!job) return undefined;
    const result = await this.adapter.aiJob(job.id);
    if (this.job !== job || result.generation !== this.generation) return undefined;
    this.job = result;
    return result;
  }
  async cancelAI(idempotencyKey: string): Promise<void> {
    const job = this.job;
    this.job = undefined;
    if (job) await this.adapter.cancelAI(job.id, { idempotencyKey, generation: job.generation });
  }
}
