/**
 * Server-side only — imported exclusively by /api/agent/* route handlers.
 * The GEMINI_API_KEY never leaves the server; this file is never bundled
 * for the client because no "use client" component imports it.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export type GeminiOptions<T> = {
  systemInstruction: string;
  userText: string;
  /** Gemini OpenAPI-format schema for structured JSON output */
  geminiSchema?: Record<string, unknown>;
  /** Zod schema to validate + type the parsed JSON */
  zodSchema?: z.ZodType<T>;
  temperature?: number;
  /** 0 = no thinking (fast); >0 = reasoning budget tokens */
  thinkingBudget?: number;
};

export type GeminiSuccess<T> = { ok: true; data: T };
export type GeminiError = { ok: false; rateLimited: boolean; error: string };
export type GeminiResult<T> = GeminiSuccess<T> | GeminiError;

export async function callGemini<T = string>(
  opts: GeminiOptions<T>
): Promise<GeminiResult<T>> {
  const {
    systemInstruction,
    userText,
    geminiSchema,
    zodSchema,
    temperature = 0.1,
    thinkingBudget = 0,
  } = opts;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, rateLimited: false, error: "GEMINI_API_KEY is not configured on the server." };
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const config: Record<string, unknown> = {
      systemInstruction,
      temperature,
      thinkingConfig: { thinkingBudget },
    };

    if (geminiSchema) {
      config.responseMimeType = "application/json";
      config.responseSchema = geminiSchema;
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userText,
      config,
    });

    const text = response.text ?? "";

    if (zodSchema) {
      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(text);
      } catch {
        return { ok: false, rateLimited: false, error: "Model returned non-JSON text." };
      }

      const validated = zodSchema.safeParse(rawParsed);
      if (!validated.success) {
        return {
          ok: false,
          rateLimited: false,
          error: `Schema validation failed: ${validated.error.message}`,
        };
      }
      return { ok: true, data: validated.data };
    }

    return { ok: true, data: text as T };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const rateLimited =
      message.includes("429") ||
      message.toLowerCase().includes("quota") ||
      message.toLowerCase().includes("rate limit") ||
      message.toLowerCase().includes("resource_exhausted");
    return { ok: false, rateLimited, error: message };
  }
}
