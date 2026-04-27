import type { ArchitectMessage, ToolDefinition, ToolUseRequest } from "./architect-llm";

export type OpenAIResponsesReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type OpenAIResponsesTextVerbosity = "low" | "medium" | "high";

export interface OpenAIResponsesOptions {
  model: string;
  reasoningEffort: OpenAIResponsesReasoningEffort;
  textVerbosity: OpenAIResponsesTextVerbosity;
  rawMessages?: unknown[];
  tools?: ToolDefinition[];
}

export interface OpenAIResponsesData {
  output_text?: string;
  output?: Array<Record<string, unknown>>;
}

type ArchitectMessageContent = ArchitectMessage["content"];

type ResponsesContentBlock =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export function usesOpenAIResponsesApi(model: string): boolean {
  return model.trim().toLowerCase().startsWith("gpt-5.5");
}

export function buildOpenAIResponsesRequest(
  messages: ArchitectMessage[],
  options: OpenAIResponsesOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    max_output_tokens: 16384,
    input: options.rawMessages
      ? translateRawToOpenAIResponses(options.rawMessages)
      : messages.map((m) => ({ role: m.role, content: toOpenAIResponsesContent(m.content) })),
    reasoning: { effort: options.reasoningEffort },
    text: { verbosity: options.textVerbosity },
  };

  if (options.tools?.length) {
    body.tools = options.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }

  return body;
}

export function toOpenAIResponsesContent(content: ArchitectMessageContent): unknown {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const blocks: ResponsesContentBlock[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "input_text", text: block.text });
      continue;
    }

    if (block.type === "image") {
      const image = toInputImageBlock(block);
      if (image) {
        blocks.push(image);
      }
    }
  }

  return blocks;
}

export function translateRawToOpenAIResponses(raw: unknown[]): unknown[] {
  const out: unknown[] = [];

  for (const msg of raw) {
    if (!isRecord(msg)) {
      continue;
    }

    const role = typeof msg.role === "string" ? msg.role : "";
    const content = msg.content;

    if (typeof content === "string") {
      if (role === "system" || role === "user" || role === "assistant") {
        out.push({ role, content });
      }
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    const blocks = content.filter(isRecord);
    if (role === "assistant") {
      const textParts = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (textParts.length > 0) {
        out.push({ role: "assistant", content: textParts.join("") });
      }

      for (const block of blocks) {
        if (block.type !== "tool_use") {
          continue;
        }
        if (typeof block.id !== "string" || block.id.length === 0) {
          continue;
        }
        if (typeof block.name !== "string" || block.name.length === 0) {
          continue;
        }

        out.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
        });
      }
      continue;
    }

    if (role === "user") {
      const contentBlocks: ResponsesContentBlock[] = [];
      for (const block of blocks) {
        if (block.type === "tool_result") {
          continue;
        }
        if (block.type === "text" && typeof block.text === "string") {
          contentBlocks.push({ type: "input_text", text: block.text });
          continue;
        }
        if (block.type === "image") {
          const image = toInputImageBlock(block);
          if (image) {
            contentBlocks.push(image);
          }
        }
      }

      if (contentBlocks.length > 0) {
        out.push({ role: "user", content: contentBlocks });
      }

      for (const tr of blocks) {
        if (tr.type !== "tool_result") {
          continue;
        }
        if (typeof tr.tool_use_id !== "string" || tr.tool_use_id.length === 0) {
          continue;
        }
        out.push({
          type: "function_call_output",
          call_id: tr.tool_use_id,
          output: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? ""),
        });
      }
    }
  }

  return out;
}

export function extractOpenAIResponsesText(data: OpenAIResponsesData): string {
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }

  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (!isRecord(block)) {
          continue;
        }
        if ((block.type === "output_text" || block.type === "text") && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
      continue;
    }

    if ((item.type === "output_text" || item.type === "text") && typeof item.text === "string") {
      parts.push(item.text);
    }
  }

  return parts.join("");
}

export function extractOpenAIResponsesToolCalls(data: OpenAIResponsesData): ToolUseRequest[] {
  const toolCalls: ToolUseRequest[] = [];

  for (const item of data.output ?? []) {
    if (!isRecord(item) || item.type !== "function_call") {
      continue;
    }

    if (typeof item.name !== "string" || item.name.length === 0) {
      continue;
    }

    const id = typeof item.call_id === "string" && item.call_id.length > 0
      ? item.call_id
      : typeof item.id === "string" && item.id.length > 0
        ? item.id
        : "";
    if (!id) {
      continue;
    }

    const rawArguments = typeof item.arguments === "string" ? item.arguments : "{}";
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawArguments) as unknown;
      input = isRecord(parsed) ? parsed : { arguments: parsed };
    } catch {
      input = { arguments: rawArguments };
    }

    toolCalls.push({ id, name: item.name, input });
  }

  return toolCalls;
}

function toInputImageBlock(block: Record<string, unknown>): ResponsesContentBlock | undefined {
  const source = isRecord(block.source) ? block.source : undefined;
  if (source && source.type === "base64" && typeof source.media_type === "string" && typeof source.data === "string") {
    return {
      type: "input_image",
      image_url: `data:${source.media_type};base64,${source.data}`,
    };
  }

  if (typeof block.mimeType === "string" && typeof block.dataBase64 === "string") {
    return {
      type: "input_image",
      image_url: `data:${block.mimeType};base64,${block.dataBase64}`,
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
