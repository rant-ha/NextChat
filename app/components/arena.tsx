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
import ReturnIcon from "../icons/return.svg";

import { Path } from "../constant";
import { useArenaStore, VoteType } from "../store/arena";
import { useChatStore } from "../store/chat";
import { Mask, useMaskStore } from "../store/mask";
import { getMessageTextContent } from "../utils";
import { IconButton } from "./button";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

function ArenaChatView(props: { title: string; sessionId: string }) {
  const chatStore = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = useMemo(() => {
    return chatStore.sessions.find((s) => s.id === props.sessionId);
  }, [chatStore.sessions, props.sessionId]);

  const messages = session?.messages ?? [];

  useEffect(() => {
    const dom = scrollRef.current;
    if (!dom) return;
    requestAnimationFrame(() => {
      dom.scrollTo(0, dom.scrollHeight);
    });
  }, [messages.length]);

  return (
    <div className={styles["arena-chat"]}>
      <div className={styles["arena-chat-title"]}>{props.title}</div>
      <div className={styles["arena-chat-body"]} ref={scrollRef}>
        {messages.length === 0 && (
          <div className={styles["arena-chat-empty"]}>
            <span>等待开始对话…</span>
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === "user";
          const content = getMessageTextContent(m);
          return (
            <div
              key={m.id}
              className={
                isUser
                  ? styles["arena-message-user"]
                  : styles["arena-message-assistant"]
              }
            >
              <div className={styles["arena-message-role"]}>
                {isUser ? "User" : "Assistant"}
              </div>
              <div className={styles["arena-message-content"]}>
                <Markdown content={content} defaultShow />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toMaskTitle(mask: Mask | undefined, blind: boolean, fallback: string) {
  if (blind) return fallback;
  return mask?.name ?? fallback;
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

  const waitForFinalAssistant = useCallback(
    async (sessionId: string, timeoutMs: number = 120_000) => {
      const start = Date.now();

      // 轮询等待流式输出结束，取最后一条 assistant 消息
      while (Date.now() - start < timeoutMs) {
        const session = chatStore.sessions.find((s) => s.id === sessionId);
        const msgs = session?.messages ?? [];

        // 找到最后一条 assistant
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

    // 约束：同一模型/同一 provider，仅对比系统提示词（mask.context）差异
    const baseModel = leftMask.modelConfig.model;
    const baseProviderName = leftMask.modelConfig.providerName;

    // 创建两个独立会话（各自携带不同的 Mask / system prompt）
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

    // 依次触发两次请求（同一模型、不同系统提示词）
    chatStore.selectSession(leftIndex);
    await chatStore.onUserInput(text);

    chatStore.selectSession(rightIndex);
    await chatStore.onUserInput(text);

    // 等待两侧最终回复（流式结束）并落库到 ArenaStore
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
    },
    [arenaStore],
  );

  return (
    <div className={styles["arena"]}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              icon={<ReturnIcon />}
              bordered
              title="返回"
              onClick={() => navigate(Path.Home)}
            />
          </div>
        </div>

        <div className={styles["arena-title"]}>
          <div className={styles["arena-title-main"]}>Arena</div>
          <div className={styles["arena-title-sub"]}>
            同一模型，不同系统提示词（Mask）对比
          </div>
        </div>

        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              bordered
              text="Admin"
              onClick={() => navigate(Path.ArenaAdmin)}
            />
          </div>
        </div>
      </div>

      {!arenaStore.isMatchActive && (
        <div className={styles["arena-setup"]}>
          <div className={styles["arena-setup-row"]}>
            <label>左侧系统：</label>
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
            <label>右侧系统：</label>
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
              />
              盲测（隐藏系统名称）
            </label>
          </div>

          <div className={styles["arena-setup-row"]}>
            <button
              className={styles["arena-primary-btn"]}
              disabled={!canStart}
              onClick={startMatch}
            >
              开始对比
            </button>
          </div>

          {!canStart && (
            <div className={styles["arena-setup-hint"]}>
              需要选择两个不同的系统提示词（Mask）。
            </div>
          )}
        </div>
      )}

      {arenaStore.isMatchActive &&
        arenaStore.leftSessionId &&
        arenaStore.rightSessionId && (
          <div className={styles["arena-main"]}>
            <div className={styles["arena-panels"]}>
              <ArenaChatView
                title={toMaskTitle(leftMask, blind, "System A")}
                sessionId={arenaStore.leftSessionId}
              />
              <ArenaChatView
                title={toMaskTitle(rightMask, blind, "System B")}
                sessionId={arenaStore.rightSessionId}
              />
            </div>

            <div className={styles["arena-controls"]}>
              <div className={styles["arena-vote"]}>
                <button onClick={() => vote("A")}>A 更好</button>
                <button onClick={() => vote("B")}>B 更好</button>
                <button onClick={() => vote("Tie")}>平局</button>
                <button onClick={() => vote("BothBad")}>都不好</button>
              </div>

              <div className={styles["arena-input"]}>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.currentTarget.value)}
                  placeholder="输入同一条消息，分别发送给 A/B 两个系统…"
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendToBoth();
                    }
                  }}
                />
                <button
                  className={styles["arena-primary-btn"]}
                  onClick={sendToBoth}
                  disabled={isSending}
                >
                  {isSending ? "发送中…" : "发送"}
                </button>
                <button
                  className={styles["arena-secondary-btn"]}
                  onClick={() => arenaStore.endMatch()}
                >
                  结束对局
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
