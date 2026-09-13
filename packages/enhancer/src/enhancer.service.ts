import { z } from "zod";
import type {
  EnhanceOptions,
  EnhanceResult,
  EnhancerLogger,
  LlmJsonClient,
  MediaKind,
  TemplateSource,
} from "./types";

export const ENHANCER_TEMPLATE_KEY = "enhancer_system";

const llmResponseSchema = z.object({
  prompt_en: z.string().min(1),
  negative_en: z.string().default(""),
  category: z.string().min(1).default("other"),
});

/**
 * enhance(promptRu, kind) → {promptEn, negativeEn, category} | null.
 * null при ЛЮБОЙ ошибке (нет шаблона, таймаут LLM после ретрая, битый JSON) —
 * вызывающий использует исходный текст, генерация не фейлится (ТЗ §7).
 */
export class EnhancerService {
  constructor(
    private readonly llm: LlmJsonClient,
    private readonly templates: TemplateSource,
    private readonly logger: EnhancerLogger,
  ) {}

  async enhance(
    promptRu: string,
    kind: MediaKind,
    opts: EnhanceOptions = {},
  ): Promise<EnhanceResult | null> {
    let system: string | null;
    try {
      system = await this.templates.getActiveBody(ENHANCER_TEMPLATE_KEY);
    } catch (err) {
      this.logger.warn({ err: String(err) }, "enhancer: template lookup failed");
      return null;
    }
    if (!system) {
      this.logger.warn({ key: ENHANCER_TEMPLATE_KEY }, "enhancer: no active template");
      return null;
    }

    const user = `Media type: ${kind}\nUser request (Russian): ${promptRu}`;

    let raw: string;
    try {
      raw = await this.llm.generateJson(system, user, { timeoutMs: opts.timeoutMs });
    } catch (err) {
      this.logger.warn({ err: String(err), kind }, "enhancer: llm call failed, using raw prompt");
      return null;
    }

    try {
      const parsed = llmResponseSchema.parse(JSON.parse(raw));
      return {
        promptEn: parsed.prompt_en.trim(),
        negativeEn: parsed.negative_en.trim(),
        category: parsed.category.trim().toLowerCase(),
      };
    } catch (err) {
      this.logger.warn({ err: String(err), raw: raw.slice(0, 200) }, "enhancer: invalid llm json");
      return null;
    }
  }
}
