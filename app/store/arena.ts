import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { StoreKey } from "../constant";
import { Mask } from "./mask";

export type VoteType = "A" | "B" | "Tie" | "BothBad" | null;

export interface ArenaMatchRecord {
  id: string;
  timestamp: number;
  testerId: string; // 测试者ID (可在设置中配置)

  // System configurations
  maskA: {
    id: string;
    name: string;
    modelConfig: any; // 快照完整的 modelConfig
  };
  maskB: {
    id: string;
    name: string;
    modelConfig: any;
  };

  // Conversation history
  messages: {
    userInput: string;
    responseA: string;
    responseB: string;
    timestamp: number;
  }[];

  // Voting result
  vote: VoteType;
  votedAt: number | null;

  // Blind test flag
  wasBlindTest: boolean;
}

export interface ArenaConfig {
  testerId: string; // 测试者的唯一标识
  backupWebhookUrl: string; // Google Apps Script Web App URL
  lastBackupTime: number;
  backupIntervalDays: number; // 默认3天
}

interface ArenaState {
  // Current match state
  isMatchActive: boolean;
  isBlindTest: boolean;

  leftMaskId: string | null;
  rightMaskId: string | null;

  leftSessionId: string | null; // 对应 ChatStore 中的 session.id
  rightSessionId: string | null;

  currentMatchId: string | null;

  // History
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

  currentMatchId: null,

  matches: [],

  config: {
    testerId: nanoid(),
    backupWebhookUrl: "",
    lastBackupTime: 0,
    backupIntervalDays: 3,
  },
};

export const useArenaStore = createPersistStore(
  DEFAULT_ARENA_STATE,
  (set, get) => ({
    // 开始新对局
    startNewMatch(
      maskA: Mask,
      maskB: Mask,
      sessionIdA: string,
      sessionIdB: string,
      isBlind: boolean = false,
    ) {
      const matchId = nanoid();
      const newMatch: ArenaMatchRecord = {
        id: matchId,
        timestamp: Date.now(),
        testerId: get().config.testerId,
        maskA: {
          id: maskA.id,
          name: maskA.name,
          modelConfig: JSON.parse(JSON.stringify(maskA.modelConfig)), // 深拷贝
        },
        maskB: {
          id: maskB.id,
          name: maskB.name,
          modelConfig: JSON.parse(JSON.stringify(maskB.modelConfig)),
        },
        messages: [],
        vote: null,
        votedAt: null,
        wasBlindTest: isBlind,
      };

      set({
        isMatchActive: true,
        isBlindTest: isBlind,
        leftMaskId: maskA.id,
        rightMaskId: maskB.id,
        leftSessionId: sessionIdA,
        rightSessionId: sessionIdB,
        currentMatchId: matchId,
        matches: [...get().matches, newMatch],
      });
    },

    // 记录一轮对话
    recordConversation(
      userInput: string,
      responseA: string,
      responseB: string,
    ) {
      const matchId = get().currentMatchId;
      if (!matchId) return;

      set((state) => ({
        matches: state.matches.map((match) =>
          match.id === matchId
            ? {
                ...match,
                messages: [
                  ...match.messages,
                  {
                    userInput,
                    responseA,
                    responseB,
                    timestamp: Date.now(),
                  },
                ],
              }
            : match,
        ),
      }));
    },

    // 提交投票
    submitVote(vote: VoteType) {
      const matchId = get().currentMatchId;
      if (!matchId || !vote) return;

      set((state) => ({
        matches: state.matches.map((match) =>
          match.id === matchId
            ? {
                ...match,
                vote,
                votedAt: Date.now(),
              }
            : match,
        ),
      }));
    },

    // 结束当前对局
    endMatch() {
      set({
        isMatchActive: false,
        isBlindTest: false,
        leftMaskId: null,
        rightMaskId: null,
        leftSessionId: null,
        rightSessionId: null,
        currentMatchId: null,
      });
    },

    // 导出数据为 JSON
    exportData() {
      const data = {
        testerId: get().config.testerId,
        exportTime: Date.now(),
        matches: get().matches,
      };
      return JSON.stringify(data, null, 2);
    },

    // 检查并执行自动备份（静默模式，不显示任何日志或提示）
    async checkAndPerformBackup() {
      const config = get().config;
      const now = Date.now();
      const intervalMs = config.backupIntervalDays * 24 * 60 * 60 * 1000;

      // 检查是否到期
      if (now - config.lastBackupTime < intervalMs) {
        return;
      }

      // 检查是否配置了 Webhook URL
      if (!config.backupWebhookUrl) {
        return;
      }

      // 获取待备份的数据
      const lastBackup = config.lastBackupTime;
      const pendingMatches = get().matches.filter(
        (match) => match.timestamp > lastBackup,
      );

      const data = {
        testerId: config.testerId,
        backupTime: now,
        periodStart: lastBackup,
        periodEnd: now,
        matchCount: pendingMatches.length,
        matches: pendingMatches,
      };

      if (data.matchCount === 0) {
        set((state) => ({
          config: {
            ...state.config,
            lastBackupTime: now,
          },
        }));
        return;
      }

      try {
        const response = await fetch(config.backupWebhookUrl, {
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
        // 静默失败，不显示错误
      } catch {
        // 静默失败，不显示错误
      }
    },

    // 更新配置
    updateConfig(updates: Partial<ArenaConfig>) {
      set((state) => ({
        config: {
          ...state.config,
          ...updates,
        },
      }));
    },

    // 清空历史数据
    clearHistory() {
      set({ matches: [] });
    },

    // 导入数据（用于管理员面板）
    importData(jsonData: string) {
      try {
        const data = JSON.parse(jsonData);
        if (data.matches && Array.isArray(data.matches)) {
          set((state) => ({
            matches: [...state.matches, ...data.matches],
          }));
          return true;
        }
        return false;
      } catch (error) {
        console.error("[Arena] Import failed:", error);
        return false;
      }
    },
  }),
  {
    name: StoreKey.Arena,
    version: 1.0,
  },
);
