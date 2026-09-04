import * as fs from 'fs';
import { generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { buildPrompt } from './prompt';

export interface AIAnalysisResult {
  analysis: string;
  provider: string;
  model: string;
}

type Provider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'qwen';

function detectProvider(model: string): Provider {
  const m = model.toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('qwen')) return 'qwen';
  return 'openai';
}

function createModel(
  provider: Provider,
  model: string,
  token: string,
): LanguageModel {
  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: token });
      return anthropic(model);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: token });
      return google(model);
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey: token });
      return deepseek(model);
    }
    case 'qwen': {
      const qwen = createOpenAI({
        apiKey: token,
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
      return qwen(model);
    }
    default: {
      const openai = createOpenAI({ apiKey: token });
      return openai(model);
    }
  }
}

/**
 * Run AI degradation analysis on a bundle-diff JSON file.
 *
 * @param diffJsonPath  Path to the JSON file produced by `rsdoctor bundle-diff --json`
 * @param token         AI API key (Anthropic or OpenAI)
 * @param model         Model name — auto-detects provider from prefix (default: claude-3-5-haiku-latest)
 */
export async function analyzeWithAI(
  diffJsonPath: string,
  token: string,
  model = 'claude-3-5-haiku-latest',
): Promise<AIAnalysisResult | null> {
  if (!token) {
    console.log('ℹ️  No AI token provided, skipping AI analysis');
    return null;
  }

  if (!fs.existsSync(diffJsonPath)) {
    console.log(
      `⚠️  Bundle diff JSON not found at ${diffJsonPath}, skipping AI analysis`,
    );
    return null;
  }

  try {
    const diffData: unknown = JSON.parse(fs.readFileSync(diffJsonPath, 'utf8'));
    const prompt = buildPrompt(diffData);
    const provider = detectProvider(model);

    console.log(`🤖 Running AI analysis with ${provider} (${model})...`);

    const llm = createModel(provider, model, token);
    const { text: analysis } = await generateText({
      model: llm,
      maxOutputTokens: 2048,
      prompt,
    });

    console.log('✅ AI analysis completed');
    return { analysis, provider, model };
  } catch (error) {
    console.warn(`⚠️ AI analysis failed: ${error}`);
    return null;
  }
}
