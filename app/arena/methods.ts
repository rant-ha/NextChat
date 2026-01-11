export type ArenaRole = "system" | "user" | "assistant";

export type ArenaMessage = {
  role: ArenaRole;
  content: string;
};

export type ArenaMethodContext = {
  /** The full conversation messages so far (without variant-injected system, unless the method chooses to). */
  messages: ArenaMessage[];

  /** Base model settings shared across methods (provider/model) */
  model: {
    provider: string;
    model: string;
  };

  /**
   * Optional request origin and headers forwarded from the browser.
   * Used when a method needs to call a classifier model server-side.
   */
  origin?: string;
  forwardHeaders?: Record<string, string>;
};

export type ArenaMethodResult = {
  /** System prompt to inject for this turn (optional). */
  systemPrompt?: string;

  /** Internal metadata for export (never shown to end users). */
  internal?: Record<string, any>;
};

export interface ArenaMethod {
  id: string;
  displayName: string;

  /**
   * Build the method-specific prompt for this turn.
   * Must NOT call the model directly; server route will do that.
   */
  build(
    ctx: ArenaMethodContext,
  ): Promise<ArenaMethodResult> | ArenaMethodResult;
}

// Register built-in methods
import { BaselineMethod } from "./methods/baseline";
import { TemplateSystemMethod } from "./methods/template_system";

export const AvailableMethods: Record<string, ArenaMethod> = {
  [BaselineMethod.id]: BaselineMethod,
  [TemplateSystemMethod.id]: TemplateSystemMethod,
};
