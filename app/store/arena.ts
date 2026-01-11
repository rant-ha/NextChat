import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { StoreKey } from "../constant";
import type { Mask } from "./mask";

export type VoteType = "A" | "B" | "Tie" | "BothBad" | null;

export interface ArenaTurnRecord {
  userInput: string;
  responseA: string;
  responseB: string;
  timestamp: number;
}

export interface ArenaThreadRecord {
  id: string;

  /** Thread created time */
  timestamp: number;

  /** Thread last updated time */
  updatedAt: number;

  testerId: string;

  /** Link to ChatStore sessions (needed for thread switching UI) */
  sessionIdA?: string;
  sessionIdB?: string;

  /** A short title for sidebar thread list */
  title?: string;

  /**
   * System configurations (legacy; kept for backward compatibility).
   * UI should not rely on these fields for revealing method identities.
   */
  maskA: {
    id: string;
    name: string;
    modelConfig: any;
  };
  maskB: {
    id: string;
    name: string;
    modelConfig: any;
  };

  /** Conversation history (multi-turn) */
  messages: ArenaTurnRecord[];

  /** Voting result (locked once voted) */
  vote: VoteType;
  votedAt: number | null;

  /** Blind test flag (legacy) */
  wasBlindTest: boolean;

  /** Internal metadata for research export (never display in UI) */
  internal?: Record<string, any>;
}

// Backward-compatible name; conceptually this is a "thread".
export type ArenaMatchRecord = ArenaThreadRecord;

export interface ArenaConfig {
  testerId: string;
  lastBackupTime: number;
  backupIntervalDays: number;
}

interface ArenaState {
  // Current thread state (legacy flags kept)
  isMatchActive: boolean;
  isBlindTest: boolean;

  leftMaskId: string | null;
  rightMaskId: string | null;

  leftSessionId: string | null;
  rightSessionId: string | null;

  // Canonical thread fields
  currentThreadId: string | null;
  threads: ArenaThreadRecord[];

  // Backward-compatible aliases
  currentMatchId: string | null;
  matches: ArenaMatchRecord[];

  // Configuration
  config: ArenaConfig;
}

const DEFAULT_ARENA_STATE: ArenaState = {
  isMatchActive: false,
  isBlindTest: false,

  leftMaskId: null,
  rightMaskId: null,

  leftSessionId: null,
  rightSessionId: null,

  currentThreadId: null,
  threads: [],

  currentMatchId: null,
  matches: [],

  config: {
    testerId: nanoid(),
    lastBackupTime: 0,
    backupIntervalDays: 3,
  },
};

function cloneModelConfig(modelConfig: any) {
  return JSON.parse(JSON.stringify(modelConfig));
}

function normalizeTitle(userInput: string) {
  const trimmed = userInput.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 32);
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]) {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => {
    const ta = (a as any).timestamp ?? 0;
    const tb = (b as any).timestamp ?? 0;
    return ta - tb;
  });
}

export const useArenaStore = createPersistStore(
  DEFAULT_ARENA_STATE,
  (set, get) => ({
    // Start a new thread (canonical)
    startNewThread(
      maskA: Mask,
      maskB: Mask,
      sessionIdA: string,
      sessionIdB: string,
      isBlind: boolean = false,
    ) {
      const threadId = nanoid();
      const now = Date.now();

      const newThread: ArenaThreadRecord = {
        id: threadId,
        timestamp: now,
        updatedAt: now,
        testerId: get().config.testerId,
        sessionIdA,
        sessionIdB,
        title: "",
        maskA: {
          id: maskA.id,
          name: maskA.name,
          modelConfig: cloneModelConfig(maskA.modelConfig),
        },
        maskB: {
          id: maskB.id,
          name: maskB.name,
          modelConfig: cloneModelConfig(maskB.modelConfig),
        },
        messages: [],
        vote: null,
        votedAt: null,
        wasBlindTest: isBlind,
      };

      const nextThreads = [...get().threads, newThread];

      set({
        isMatchActive: true,
        isBlindTest: isBlind,
        leftMaskId: maskA.id,
        rightMaskId: maskB.id,
        leftSessionId: sessionIdA,
        rightSessionId: sessionIdB,
        currentThreadId: threadId,
        threads: nextThreads,

        // Backward-compatible aliases
        currentMatchId: threadId,
        matches: nextThreads,
      });
    },

    // Backward-compatible: start a new match
    startNewMatch(
      maskA: Mask,
      maskB: Mask,
      sessionIdA: string,
      sessionIdB: string,
      isBlind: boolean = false,
    ) {
      (get() as any).startNewThread(
        maskA,
        maskB,
        sessionIdA,
        sessionIdB,
        isBlind,
      );
    },

    // Record a turn (multi-turn)
    recordConversation(
      userInput: string,
      responseA: string,
      responseB: string,
    ) {
      const threadId = get().currentThreadId ?? get().currentMatchId;
      if (!threadId) return;

      set((state) => {
        const nextThreads = state.threads.map((thread) => {
          if (thread.id !== threadId) return thread;

          const nextTitle = thread.title
            ? thread.title
            : normalizeTitle(userInput);
          const now = Date.now();

          return {
            ...thread,
            title: nextTitle,
            updatedAt: now,
            messages: [
              ...thread.messages,
              {
                userInput,
                responseA,
                responseB,
                timestamp: now,
              },
            ],
          };
        });

        return {
          threads: nextThreads,
          matches: nextThreads,
        } as Partial<ArenaState>;
      });
    },

    // Switch to existing thread
    selectThread(threadId: string) {
      const thread = get().threads.find((t) => t.id === threadId);
      if (!thread) return;

      set({
        isMatchActive: true,
        isBlindTest: thread.wasBlindTest,
        leftMaskId: thread.maskA.id,
        rightMaskId: thread.maskB.id,
        leftSessionId: thread.sessionIdA ?? null,
        rightSessionId: thread.sessionIdB ?? null,
        currentThreadId: thread.id,

        // Backward-compatible aliases
        currentMatchId: thread.id,
      });
    },

    // Backward-compatible: select match
    selectMatch(matchId: string) {
      (get() as any).selectThread(matchId);
    },

    // Submit vote (locked once voted)
    submitVote(vote: VoteType) {
      const threadId = get().currentThreadId ?? get().currentMatchId;
      if (!threadId || !vote) return;

      set((state) => {
        const nextThreads = state.threads.map((thread) => {
          if (thread.id !== threadId) return thread;
          if (thread.vote !== null) return thread;

          return {
            ...thread,
            vote,
            votedAt: Date.now(),
            updatedAt: Date.now(),
          };
        });

        return {
          threads: nextThreads,
          matches: nextThreads,
        } as Partial<ArenaState>;
      });
    },

    // End current thread (legacy behavior)
    endMatch() {
      set({
        isMatchActive: false,
        isBlindTest: false,
        leftMaskId: null,
        rightMaskId: null,
        leftSessionId: null,
        rightSessionId: null,
        currentThreadId: null,

        // Backward-compatible aliases
        currentMatchId: null,
      });
    },

    // Export data as JSON
    exportData() {
      const data = {
        testerId: get().config.testerId,
        exportTime: Date.now(),
        threads: get().threads,
      };
      return JSON.stringify(data, null, 2);
    },

    // Auto backup (silent)
    async checkAndPerformBackup() {
      const config = get().config;
      const now = Date.now();
      const intervalMs = config.backupIntervalDays * 24 * 60 * 60 * 1000;

      if (now - config.lastBackupTime < intervalMs) return;

      const lastBackup = config.lastBackupTime;
      const pendingThreads = get().threads.filter(
        (t) => t.timestamp > lastBackup,
      );

      const data = {
        testerId: config.testerId,
        backupTime: now,
        periodStart: lastBackup,
        periodEnd: now,
        threadCount: pendingThreads.length,
        threads: pendingThreads,
      };

      if (data.threadCount === 0) {
        set((state) => ({
          config: {
            ...state.config,
            lastBackupTime: now,
          },
        }));
        return;
      }

      // Prefer server-side proxy to avoid exposing webhook URL to clients.
      const backupEndpoint = "/api/arena/backup";

      try {
        const response = await fetch(backupEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });

        if (response.ok) {
          set((state) => ({
            config: {
              ...state.config,
              lastBackupTime: now,
            },
          }));
        }
      } catch {
        // silent
      }
    },

    // Update config
    updateConfig(updates: Partial<ArenaConfig>) {
      set((state) => ({
        config: {
          ...state.config,
          ...updates,
        },
      }));
    },

    // Clear history
    clearHistory() {
      set({ threads: [], matches: [] });
    },

    // Import data (append)
    importData(jsonData: string) {
      try {
        const data = JSON.parse(jsonData);
        const incoming: ArenaThreadRecord[] = Array.isArray(data?.threads)
          ? data.threads
          : Array.isArray(data?.matches)
          ? data.matches
          : [];

        if (!Array.isArray(incoming) || incoming.length === 0) return false;

        const normalized = incoming.map((t) => {
          const ts = Number(t.timestamp) || Date.now();
          const updatedAt = Number((t as any).updatedAt) || ts;
          return {
            ...t,
            timestamp: ts,
            updatedAt,
            title: typeof t.title === "string" ? t.title : "",
            messages: Array.isArray(t.messages) ? t.messages : [],
            vote: (t.vote ?? null) as VoteType,
            votedAt: t.votedAt ?? null,
            wasBlindTest: Boolean(t.wasBlindTest),
          } as ArenaThreadRecord;
        });

        set((state) => {
          const merged = mergeById(state.threads, normalized);
          return {
            threads: merged,
            matches: merged,
          } as Partial<ArenaState>;
        });

        return true;
      } catch (error) {
        console.error("[Arena] Import failed:", error);
        return false;
      }
    },
  }),
  {
    name: StoreKey.Arena,
    version: 2.0,
    migrate(state, version) {
      const next = JSON.parse(
        JSON.stringify(state ?? {}),
      ) as Partial<ArenaState>;

      // v1 -> v2: introduce threads/currentThreadId and keep matches aliases.
      if (version < 2) {
        const matches = Array.isArray((next as any).matches)
          ? ((next as any).matches as ArenaThreadRecord[])
          : [];

        (next as any).threads = matches;
        (next as any).currentThreadId = (next as any).currentMatchId ?? null;

        // Ensure aliases exist
        (next as any).matches = matches;
      }

      // Ensure updatedAt exists on all threads
      if (Array.isArray((next as any).threads)) {
        (next as any).threads = (
          (next as any).threads as ArenaThreadRecord[]
        ).map((t) => ({
          ...t,
          updatedAt: Number((t as any).updatedAt) || Number(t.timestamp) || 0,
          title: typeof (t as any).title === "string" ? (t as any).title : "",
          messages: Array.isArray((t as any).messages)
            ? (t as any).messages
            : [],
          vote: ((t as any).vote ?? null) as VoteType,
          votedAt: (t as any).votedAt ?? null,
        }));
        (next as any).matches = (next as any).threads;
      }

      return next as any;
    },
  },
);
