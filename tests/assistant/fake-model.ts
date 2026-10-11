// A scripted stand-in for the model, so the chat is tested with no network: each call takes the next step of the script. A step is
// a response, a function of the request, or an error to throw. Every request is kept as a snapshot (the loop changes its message
// list after the call), so a test can look at exactly what the model was shown.

import { ModelError, type ModelBlock, type ModelClient, type ModelRequest, type ModelResponse } from "@/lib/assistant/model";

export type Step = ModelResponse | ModelError | ((request: ModelRequest, call: number) => ModelResponse | ModelError);

export class FakeModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  private readonly script: Step[];
  private readonly then: Step | null;

  /** `then` is used for every call after the script runs out (to model a model that never stops asking for tools). */
  constructor(script: Step[], then: Step | null = null) {
    this.script = [...script];
    this.then = then;
  }

  async create(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
    const step = this.script.length > 0 ? this.script.shift()! : this.then;
    if (!step) throw new Error(`the fake model was called ${this.requests.length} times but its script has no more steps`);
    const out = typeof step === "function" ? step(request, this.requests.length) : step;
    if (out instanceof ModelError) throw out;
    return out;
  }

  /** Everything the model was shown across all calls, as one string (the system prompt, every message). */
  seen(): string {
    return JSON.stringify(this.requests.map((r) => ({ system: r.system, messages: r.messages })));
  }
}

export const say = (text: string, stopReason = "end_turn"): ModelResponse => ({ content: [{ type: "text", text }], stopReason });

let counter = 0;
export const toolCall = (name: string, input: unknown = {}, id = `toolu_${++counter}`): ModelBlock => ({ type: "tool_use", id, name, input });

export const callTools = (...calls: ModelBlock[]): ModelResponse => ({ content: calls, stopReason: "tool_use" });

export const sayThenCall = (text: string, ...calls: ModelBlock[]): ModelResponse => ({ content: [{ type: "text", text }, ...calls], stopReason: "tool_use" });
