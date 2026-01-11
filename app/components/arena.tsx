"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useNavigate } from "react-router-dom";

import styles from "./arena.module.scss";

import LoadingIcon from "../icons/three-dots.svg";
import CopyIcon from "../icons/copy.svg";
import ReloadIcon from "../icons/reload.svg";
import MaxIcon from "../icons/max.svg";
import SendWhiteIcon from "../icons/send-white.svg";
import SettingsIcon from "../icons/settings.svg";

import { Path } from "../constant";
import { useArenaStore, VoteType } from "../store/arena";
import { useChatStore } from "../store/chat";
import { Mask, useMaskStore } from "../store/mask";
import { getMessageTextContent, copyToClipboard } from "../utils";
import { IconButton } from "./button";
import clsx from "clsx";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

interface ArenaPanelProps {
  title: string;
  sessionId: string;
  revealed?: boolean;
  realName?: string;
}

function ArenaPanel(props: ArenaPanelProps) {
  const { title, sessionId, revealed, realName } = props;
  const chatStore = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = useMemo(() => {
    return chatStore.sessions.find((s) => s.id === sessionId);
  }, [chatStore.sessions, sessionId]);

  const messages = useMemo(() => {
    return session?.messages ?? [];
  }, [session?.messages]);

  useEffect(() => {
    const dom = scrollRef.current;
    if (!dom) return;
    requestAnimationFrame(() => {
      dom.scrollTo(0, dom.scrollHeight);
    });
  }, [messages.length]);

  const lastAssistantMessage = useMemo(() => {
    const msgs = messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        return msgs[i];
      }
    }
    return null;
  }, [messages]);

  const isStreaming = lastAssistantMessage?.streaming ?? false;

  return (
    <div className={styles["arena-panel"]}>
      <div className={styles["arena-panel-header"]}>
        <div>
          <div className={styles["arena-panel-title"]}>{title}</div>
          {revealed && realName && (
            <div className={styles["arena-revealed-name"]}>({realName})</div>
          )}
        </div>
        <div className={styles["arena-panel-actions"]}>
          <button
            title="Copy"
            onClick={() => {
              if (lastAssistantMessage) {
                copyToClipboard(getMessageTextContent(lastAssistantMessage));
              }
            }}
          >
            <CopyIcon />
          </button>
          <button title="Reload">
            <ReloadIcon />
          </button>
          <button title="Expand">
            <MaxIcon />
          </button>
        </div>
      </div>
      <div className={styles["arena-panel-body"]} ref={scrollRef}>
        {messages.length === 0 ? (
          <div className={styles["arena-empty"]}>Waiting for input...</div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === "user";
            const content = getMessageTextContent(m);
            return (
              <div
                key={m.id}
                className={clsx(styles["arena-message"], {
                  [styles["arena-message-user"]]: isUser,
                  [styles["arena-message-assistant"]]: !isUser,
                })}
              >
                <div className={styles["arena-message-content"]}>
                  <Markdown content={content} defaultShow />
                </div>
              </div>
            );
          })
        )}
        {isStreaming && (
          <div className={styles["arena-loading"]}>
            <div className={styles["arena-typing-indicator"]}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Arena() {
  const navigate = useNavigate();
  const arenaStore = useArenaStore();
  const chatStore = useChatStore();
  const maskStore = useMaskStore();

  const masks = useMemo(() => maskStore.getAll(), [maskStore]);

  const [leftMaskId, setLeftMaskId] = useState<string>(masks.at(0)?.id ?? "");
  const [rightMaskId, setRightMaskId] = useState<string>(masks.at(1)?.id ?? "");
  const [blind, setBlind] = useState<boolean>(true);
  const [revealed, setRevealed] = useState<boolean>(false);

  const leftMask = useMemo(
    () => masks.find((m) => m.id === leftMaskId),
    [masks, leftMaskId],
  );
  const rightMask = useMemo(
    () => masks.find((m) => m.id === rightMaskId),
    [masks, rightMaskId],
  );

  const canStart = !!leftMask && !!rightMask && leftMask.id !== rightMask.id;

  const [userInput, setUserInput] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const waitForFinalAssistant = useCallback(
    async (sessionId: string, timeoutMs: number = 120_000) => {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const session = chatStore.sessions.find((s) => s.id === sessionId);
        const msgs = session?.messages ?? [];

        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          const m = msgs[i];
          if (m?.role !== "assistant") continue;
          if (m.streaming) break;
          return getMessageTextContent(m);
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      return "";
    },
    [chatStore.sessions],
  );

  const startMatch = useCallback(() => {
    if (!canStart || !leftMask || !rightMask) return;

    setRevealed(false);

    const baseModel = leftMask.modelConfig.model;
    const baseProviderName = leftMask.modelConfig.providerName;

    chatStore.newSession(leftMask);
    const sessionA = chatStore.currentSession();
    chatStore.updateTargetSession(sessionA, (s) => {
      s.mask.syncGlobalConfig = false;
      s.mask.modelConfig.model = baseModel;
      s.mask.modelConfig.providerName = baseProviderName;
    });

    chatStore.newSession(rightMask);
    const sessionB = chatStore.currentSession();
    chatStore.updateTargetSession(sessionB, (s) => {
      s.mask.syncGlobalConfig = false;
      s.mask.modelConfig.model = baseModel;
      s.mask.modelConfig.providerName = baseProviderName;
    });

    arenaStore.startNewMatch(
      leftMask,
      rightMask,
      sessionA.id,
      sessionB.id,
      blind,
    );
  }, [arenaStore, blind, canStart, chatStore, leftMask, rightMask]);

  const sendToBoth = useCallback(async () => {
    if (isSending) return;
    if (!arenaStore.isMatchActive) return;
    if (!arenaStore.leftSessionId || !arenaStore.rightSessionId) return;

    const text = userInput.trim();
    if (!text) return;

    const leftIndex = chatStore.sessions.findIndex(
      (s) => s.id === arenaStore.leftSessionId,
    );
    const rightIndex = chatStore.sessions.findIndex(
      (s) => s.id === arenaStore.rightSessionId,
    );

    if (leftIndex < 0 || rightIndex < 0) return;

    setIsSending(true);
    setUserInput("");

    chatStore.selectSession(leftIndex);
    await chatStore.onUserInput(text);

    chatStore.selectSession(rightIndex);
    await chatStore.onUserInput(text);

    const [respA, respB] = await Promise.all([
      waitForFinalAssistant(arenaStore.leftSessionId),
      waitForFinalAssistant(arenaStore.rightSessionId),
    ]);

    arenaStore.recordConversation(text, respA, respB);
    setIsSending(false);
  }, [arenaStore, chatStore, isSending, userInput, waitForFinalAssistant]);

  const vote = useCallback(
    (v: VoteType) => {
      arenaStore.submitVote(v);
      if (blind) {
        setRevealed(true);
      }
    },
    [arenaStore, blind],
  );

  const endMatch = useCallback(() => {
    arenaStore.endMatch();
    setRevealed(false);
  }, [arenaStore]);

  const getTitle = (side: "left" | "right") => {
    if (blind && !revealed) {
      return side === "left" ? "Assistant A" : "Assistant B";
    }
    const mask = side === "left" ? leftMask : rightMask;
    return mask?.name ?? (side === "left" ? "System A" : "System B");
  };

  return (
    <div className={styles["arena"]}>
      {/* Header */}
      <div className={styles["arena-header"]}>
        <div className={styles["arena-header-title"]}>
          ⚔️ Arena
          <span className={styles["arena-header-mode"]}>Battle</span>
        </div>
        <div className={styles["arena-header-actions"]}>
          <button
            className={styles["arena-settings-btn"]}
            onClick={() => navigate(Path.Settings)}
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* Setup or Main View */}
      {!arenaStore.isMatchActive ? (
        <div className={styles["arena-setup"]}>
          <div className={styles["arena-setup-row"]}>
            <label>Left System:</label>
            <select
              value={leftMaskId}
              onChange={(e) => setLeftMaskId(e.currentTarget.value)}
            >
              {masks.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles["arena-setup-row"]}>
            <label>Right System:</label>
            <select
              value={rightMaskId}
              onChange={(e) => setRightMaskId(e.currentTarget.value)}
            >
              {masks.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles["arena-setup-row"]}>
            <label>
              <input
                type="checkbox"
                checked={blind}
                onChange={(e) => setBlind(e.currentTarget.checked)}
              />{" "}
              Blind Test (hide system names until vote)
            </label>
          </div>

          <button
            className={styles["arena-start-btn"]}
            disabled={!canStart}
            onClick={startMatch}
          >
            Start Battle
          </button>

          {!canStart && (
            <div className={styles["arena-setup-hint"]}>
              Please select two different system prompts (Masks).
            </div>
          )}
        </div>
      ) : (
        <div className={styles["arena-main"]}>
          {/* Two Panels */}
          <div className={styles["arena-panels"]}>
            <ArenaPanel
              title={getTitle("left")}
              sessionId={arenaStore.leftSessionId!}
              revealed={revealed}
              realName={leftMask?.name}
            />
            <ArenaPanel
              title={getTitle("right")}
              sessionId={arenaStore.rightSessionId!}
              revealed={revealed}
              realName={rightMask?.name}
            />
          </div>

          {/* Vote Section */}
          <div className={styles["arena-vote-section"]}>
            <div className={styles["arena-vote-buttons"]}>
              <button
                className={clsx(
                  styles["arena-vote-btn"],
                  styles["left-better"],
                )}
                onClick={() => vote("A")}
              >
                ← Left is Better
              </button>
              <button
                className={clsx(styles["arena-vote-btn"], styles["tie"])}
                onClick={() => vote("Tie")}
              >
                It&apos;s a tie 🤝
              </button>
              <button
                className={clsx(styles["arena-vote-btn"], styles["both-bad"])}
                onClick={() => vote("BothBad")}
              >
                Both are bad 👎
              </button>
              <button
                className={clsx(
                  styles["arena-vote-btn"],
                  styles["right-better"],
                )}
                onClick={() => vote("B")}
              >
                Right is Better →
              </button>
            </div>
          </div>

          {/* Input Section */}
          <div className={styles["arena-input-section"]}>
            <div className={styles["arena-input-container"]}>
              <textarea
                ref={inputRef}
                value={userInput}
                onChange={(e) => setUserInput(e.currentTarget.value)}
                placeholder="Ask followup..."
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendToBoth();
                  }
                }}
              />
              <button
                className={styles["arena-send-btn"]}
                onClick={sendToBoth}
                disabled={isSending}
              >
                <SendWhiteIcon />
                {isSending ? "Sending..." : "Send"}
              </button>
              <button className={styles["arena-end-btn"]} onClick={endMatch}>
                End Battle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
