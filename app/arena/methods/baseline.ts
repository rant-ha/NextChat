import type {
  ArenaMethod,
  ArenaMethodContext,
  ArenaMethodResult,
} from "../methods";

export const BaselineMethod: ArenaMethod = {
  id: "baseline",
  displayName: "Baseline (no system)",

  async build(_ctx: ArenaMethodContext): Promise<ArenaMethodResult> {
    return {
      systemPrompt: "",
      internal: {
        methodId: "baseline",
      },
    };
  },
};
