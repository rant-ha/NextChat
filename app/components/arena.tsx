"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";

import styles from "./arena.module.scss";

import LoadingIcon from "../icons/three-dots.svg";
import CopyIcon from "../icons/copy.svg";
import SendWhiteIcon from "../icons/send-white.svg";

import { useArenaStore, VoteType } from "../store/arena";
import { useChatStore } from "../store/chat";
import { createEmptyMask } from "../store/mask";
import { copyToClipboard, getMessageTextContent } from "../utils";
import { getHeaders } from "../client/api";
import { showToast } from "./ui-lib";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />, // eslint-disable-line react/no-unstable-nested-components
});

interface ArenaPanelProps {
  title: string;
  sessionId: string;
}

function ArenaPanel(props: ArenaPanelProps) {
  const { title, sessionId } = props;
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
        <div className={styles["arena-panel-title"]}>{title}</div>
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

function formatVoteLabel(vote: VoteType) {
  switch (vote) {
    case "A":
      return "A";
    case "B":
      return "B";
    case "Tie":
      return "Tie";
    case "BothBad":
      return "Both Bad";
    default:
      return "";
  }
}

export function Arena() {
  const arenaStore = useArenaStore();
  const chatStore = useChatStore();

  const [userInput, setUserInput] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const threads = useMemo(() => arenaStore.threads ?? [], [arenaStore.threads]);

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      const ta = (a.updatedAt ?? a.timestamp) || 0;
      const tb = (b.updatedAt ?? b.timestamp) || 0;
      return tb - ta;
    });
  }, [threads]);

  const activeThreadId =
    arenaStore.currentThreadId ?? arenaStore.currentMatchId;

  const currentThread = useMemo(() => {
    if (!activeThreadId) return null;
    return threads.find((t) => t.id === activeThreadId) ?? null;
  }, [activeThreadId, threads]);

  const leftSessionId =
    arenaStore.leftSessionId ?? currentThread?.sessionIdA ?? null;
  const rightSessionId =
    arenaStore.rightSessionId ?? currentThread?.sessionIdB ?? null;

  const leftSession = useMemo(() => {
    if (!leftSessionId) return null;
    return chatStore.sessions.find((s) => s.id === leftSessionId) ?? null;
  }, [chatStore.sessions, leftSessionId]);

  const rightSession = useMemo(() => {
    if (!rightSessionId) return null;
    return chatStore.sessions.find((s) => s.id === rightSessionId) ?? null;
  }, [chatStore.sessions, rightSessionId]);

  const hasAnyChatMessages =
    (leftSession?.messages.length ?? 0) > 0 ||
    (rightSession?.messages.length ?? 0) > 0;

  const canVote = (currentThread?.messages.length ?? 0) > 0;
  const isVoted = (currentThread?.vote ?? null) !== null;

  useEffect(() => {
    if (activeThreadId) return;
    if (sortedThreads.length === 0) return;

    arenaStore.selectThread(sortedThreads[0].id);
  }, [activeThreadId, arenaStore, sortedThreads]);

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

  const createNewThread = useCallback(() => {
    const maskA = createEmptyMask();
    const maskB = createEmptyMask();

    maskA.name = "Assistant A";
    maskB.name = "Assistant B";

    maskA.syncGlobalConfig = false;
    maskB.syncGlobalConfig = false;

    chatStore.newSession(maskA);
    const sessionA = chatStore.currentSession();
    chatStore.updateTargetSession(sessionA, (s) => {
      s.mask.syncGlobalConfig = false;
    });

    chatStore.newSession(maskB);
    const sessionB = chatStore.currentSession();
    chatStore.updateTargetSession(sessionB, (s) => {
      s.mask.syncGlobalConfig = false;

      // Force same base model/provider as A (defensive)
      s.mask.modelConfig.model = sessionA.mask.modelConfig.model;
      s.mask.modelConfig.providerName = sessionA.mask.modelConfig.providerName;
    });

    arenaStore.startNewThread(maskA, maskB, sessionA.id, sessionB.id, true);

    const state = useArenaStore.getState();
    return {
      threadId: state.currentThreadId ?? state.currentMatchId,
      leftSessionId: state.leftSessionId,
      rightSessionId: state.rightSessionId,
    };
  }, [arenaStore, chatStore]);

  const sendToBoth = useCallback(async () => {
    if (isSending) return;

    const text = userInput.trim();
    if (!text) return;

    setIsSending(true);
    setUserInput("");

    let state = useArenaStore.getState();

    if (!state.leftSessionId || !state.rightSessionId) {
      createNewThread();
      state = useArenaStore.getState();
    }

    const leftId = state.leftSessionId;
    const rightId = state.rightSessionId;

    if (!leftId || !rightId) {
      setIsSending(false);
      return;
    }

    const leftSession = chatStore.sessions.find((s) => s.id === leftId);
    const rightSession = chatStore.sessions.find((s) => s.id === rightId);

    if (!leftSession || !rightSession) {
      setIsSending(false);
      return;
    }

    const provider = (
      leftSession.mask.modelConfig.providerName || "openai"
    ).toLowerCase();
    const model = leftSession.mask.modelConfig.model || "";

    const messagesA = (leftSession.messages || []).map((m: any) => ({
      role: m.role,
      content: getMessageTextContent(m),
    }));
    const messagesB = (rightSession.messages || []).map((m: any) => ({
      role: m.role,
      content: getMessageTextContent(m),
    }));

    try {
      if (!model) {
        showToast("Model is empty. Please select a model in Settings.");
        setUserInput(text);
        return;
      }

      const supportedProviders = new Set([
        "openai",
        "xai",
        "moonshot",
        "siliconflow",
        "302ai",
        "302.ai",
        "302",
        "deepseek",
      ]);

      if (!supportedProviders.has(provider)) {
        showToast(
          `Arena currently supports OpenAI-compatible providers only (got: ${provider}).`,
        );
        setUserInput(text);
        return;
      }

      const res = await fetch("/api/arena/turn", {
        method: "POST",
        headers: {
          ...getHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messagesA,
          messagesB,
          userInput: text,
          a: { mode: "method", methodId: "template_system" },
          b: { mode: "method", methodId: "baseline" },
          model: { provider, model },
        }),
      });

      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json?.ok) {
        const errMsg =
          json?.error ||
          json?.msg ||
          raw ||
          `HTTP ${res.status} ${res.statusText}`;
        showToast(`Arena request failed: ${String(errMsg).slice(0, 200)}`);
        setUserInput(text);
        return;
      }

      const respA = json.a?.text ?? "";
      const respB = json.b?.text ?? "";

      // append messages into sessions
      chatStore.updateTargetSession(leftSession, (s) => {
        s.messages = s.messages.concat([
          {
            id: `${Date.now()}-u`,
            role: "user",
            content: text,
            date: new Date().toLocaleString(),
          },
          {
            id: `${Date.now()}-a`,
            role: "assistant",
            content: respA,
            date: new Date().toLocaleString(),
            streaming: false,
          },
        ] as any);
      });
      chatStore.updateTargetSession(rightSession, (s) => {
        s.messages = s.messages.concat([
          {
            id: `${Date.now()}-u2`,
            role: "user",
            content: text,
            date: new Date().toLocaleString(),
          },
          {
            id: `${Date.now()}-b`,
            role: "assistant",
            content: respB,
            date: new Date().toLocaleString(),
            streaming: false,
          },
        ] as any);
      });

      arenaStore.recordConversation(text, respA, respB);
    } catch (e) {
      console.error("[Arena] sendToBoth failed", e);
      showToast(`Arena request failed: ${String(e).slice(0, 200)}`);
      setUserInput(text);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [arenaStore, chatStore, createNewThread, isSending, userInput]);

  const vote = useCallback(
    (v: VoteType) => {
      arenaStore.submitVote(v);
    },
    [arenaStore],
  );

  return (
    <div className={styles["arena-root"]}>
      <div className={styles["arena-sidebar"]}>
        <div className={styles["arena-sidebar-header"]}>
          <button
            className={styles["arena-new-chat"]}
            onClick={() => {
              createNewThread();
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            New Chat
          </button>
        </div>

        <div className={styles["arena-thread-list"]}>
          {sortedThreads.map((t) => {
            const isActive = t.id === activeThreadId;
            const title = (t.title ?? "").trim() || "New Chat";
            const subtitle = t.vote
              ? `Voted: ${formatVoteLabel(t.vote)}`
              : "Not voted";

            return (
              <button
                key={t.id}
                className={clsx(styles["arena-thread-item"], {
                  [styles["arena-thread-item-active"]]: isActive,
                })}
                onClick={() => {
                  arenaStore.selectThread(t.id);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <div className={styles["arena-thread-title"]}>{title}</div>
                <div className={styles["arena-thread-subtitle"]}>
                  {subtitle}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles["arena-content"]}>
        {!hasAnyChatMessages ? (
          <div className={styles["arena-landing"]}>
            <div className={styles["arena-landing-title"]}>Ask anything</div>
            <div className={styles["arena-landing-subtitle"]}>
              Chat with two anonymous assistants and vote when you are ready.
            </div>

            <div className={styles["arena-landing-input"]}>
              <textarea
                ref={inputRef}
                value={userInput}
                onChange={(e) => setUserInput(e.currentTarget.value)}
                placeholder="Ask anything..."
                rows={3}
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
            </div>
          </div>
        ) : (
          <div className={styles["arena-main"]}>
            <div className={styles["arena-panels"]}>
              {leftSessionId && (
                <ArenaPanel title="Assistant A" sessionId={leftSessionId} />
              )}
              {rightSessionId && (
                <ArenaPanel title="Assistant B" sessionId={rightSessionId} />
              )}
            </div>

            {canVote && (
              <div className={styles["arena-vote-section"]}>
                <div className={styles["arena-vote-buttons"]}>
                  <button
                    className={clsx(
                      styles["arena-vote-btn"],
                      styles["left-better"],
                    )}
                    onClick={() => vote("A")}
                    disabled={isVoted}
                  >
                    A is Better
                  </button>
                  <button
                    className={clsx(styles["arena-vote-btn"], styles["tie"])}
                    onClick={() => vote("Tie")}
                    disabled={isVoted}
                  >
                    Tie
                  </button>
                  <button
                    className={clsx(
                      styles["arena-vote-btn"],
                      styles["both-bad"],
                    )}
                    onClick={() => vote("BothBad")}
                    disabled={isVoted}
                  >
                    Both Bad
                  </button>
                  <button
                    className={clsx(
                      styles["arena-vote-btn"],
                      styles["right-better"],
                    )}
                    onClick={() => vote("B")}
                    disabled={isVoted}
                  >
                    B is Better
                  </button>
                </div>

                {isVoted && (
                  <div className={styles["arena-vote-locked"]}>
                    Vote recorded. You can keep chatting, but you cannot change
                    the vote.
                  </div>
                )}
              </div>
            )}

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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
