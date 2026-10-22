import type * as z from "zod/v4";

export interface StructuredRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

/** A model that can return JSON validated against a zod schema. */
export interface AssistProvider {
  readonly id: string;
  generate<T>(req: StructuredRequest<T>): Promise<T>;
}

export class AssistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistError";
  }
}
