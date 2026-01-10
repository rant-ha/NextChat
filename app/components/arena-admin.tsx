"use client";

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import ReturnIcon from "../icons/return.svg";
import { Path } from "../constant";
import { useArenaStore } from "../store/arena";
import { IconButton } from "./button";

export function ArenaAdmin() {
  const navigate = useNavigate();
  const arenaStore = useArenaStore();

  const exported = useMemo(() => arenaStore.exportData(), [arenaStore]);
  const [importText, setImportText] = useState<string>("");

  return (
    <div
      className="window"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
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
        <div className="window-header-title">
          <div className="window-header-main-title">Arena Admin</div>
          <div className="window-header-sub-title">
            导出 / 导入 / 清空测评数据
          </div>
        </div>
        <div className="window-actions"></div>
      </div>

      <div style={{ padding: 16, overflow: "auto" }}>
        <h3>导出数据（JSON）</h3>
        <textarea
          style={{ width: "100%", minHeight: 220 }}
          value={exported}
          readOnly
        />

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={() => {
              navigator.clipboard.writeText(exported);
            }}
          >
            复制到剪贴板
          </button>
          <button
            onClick={() => {
              const blob = new Blob([exported], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `arena-export-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载文件
          </button>
        </div>

        <hr style={{ margin: "16px 0" }} />

        <h3>导入数据（追加）</h3>
        <textarea
          style={{ width: "100%", minHeight: 160 }}
          placeholder="粘贴 JSON..."
          value={importText}
          onChange={(e) => setImportText(e.currentTarget.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            onClick={() => {
              const ok = arenaStore.importData(importText);
              if (ok) setImportText("");
            }}
          >
            导入
          </button>
          <button onClick={() => arenaStore.clearHistory()}>
            清空本地历史
          </button>
        </div>

        <hr style={{ margin: "16px 0" }} />

        <h3>自动备份（Webhook）</h3>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          配置指南：
          <a
            href="/docs/GOOGLE_DRIVE_SETUP.md"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 6 }}
          >
            GOOGLE_DRIVE_SETUP.md
          </a>
          （包含 Google Apps Script 代码与部署步骤）
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Webhook URL（Google Apps Script Web App）：
            <input
              style={{ width: "100%" }}
              value={arenaStore.config.backupWebhookUrl}
              onChange={(e) =>
                arenaStore.updateConfig({
                  backupWebhookUrl: e.currentTarget.value,
                })
              }
            />
          </label>
          <label>
            备份间隔（天）：
            <input
              type="number"
              value={arenaStore.config.backupIntervalDays}
              onChange={(e) =>
                arenaStore.updateConfig({
                  backupIntervalDays: Math.max(
                    1,
                    Number(e.currentTarget.value) || 3,
                  ),
                })
              }
            />
          </label>
          <label>
            Tester ID：
            <input
              style={{ width: "100%" }}
              value={arenaStore.config.testerId}
              onChange={(e) =>
                arenaStore.updateConfig({ testerId: e.currentTarget.value })
              }
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => arenaStore.checkAndPerformBackup()}>
              立即触发备份
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
