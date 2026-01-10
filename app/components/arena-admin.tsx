"use client";

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import ReturnIcon from "../icons/return.svg";
import { Path } from "../constant";
import { useArenaStore } from "../store/arena";
import { IconButton } from "./button";

// Admin password from environment variable
// Set NEXT_PUBLIC_ARENA_ADMIN_PASSWORD in your .env.local file
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ARENA_ADMIN_PASSWORD || "";

export function ArenaAdmin() {
  const navigate = useNavigate();
  const arenaStore = useArenaStore();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [error, setError] = useState("");

  const exported = useMemo(() => arenaStore.exportData(), [arenaStore]);
  const [importText, setImportText] = useState<string>("");

  const handleLogin = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setError("");
    } else {
      setError("Incorrect password");
    }
  };

  // Password gate
  if (!isAuthenticated) {
    return (
      <div
        className="window"
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            padding: 32,
            background: "var(--white)",
            borderRadius: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
            maxWidth: 400,
            width: "90%",
          }}
        >
          <h2 style={{ marginBottom: 16, textAlign: "center" }}>
            Admin Access
          </h2>
          <p
            style={{
              fontSize: 13,
              opacity: 0.7,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            Enter password to access admin panel.
          </p>
          <input
            type="password"
            placeholder="Password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              border: "var(--border-in-light)",
              marginBottom: 12,
              fontSize: 14,
            }}
          />
          {error && (
            <p style={{ color: "red", fontSize: 12, marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button
            onClick={handleLogin}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--primary)",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Login
          </button>
          <button
            onClick={() => navigate(Path.Home)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              border: "var(--border-in-light)",
              background: "transparent",
              marginTop: 8,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Back to Arena
          </button>
        </div>
      </div>
    );
  }

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
              title="Back"
              onClick={() => navigate(Path.Home)}
            />
          </div>
        </div>
        <div className="window-header-title">
          <div className="window-header-main-title">Arena Admin</div>
          <div className="window-header-sub-title">
            Export / Import / Manage evaluation data
          </div>
        </div>
        <div className="window-actions">
          <button
            onClick={() => setIsAuthenticated(false)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "var(--border-in-light)",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ padding: 16, overflow: "auto" }}>
        <h3>Export Data (JSON)</h3>
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
            Copy to Clipboard
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
            Download File
          </button>
        </div>

        <hr style={{ margin: "16px 0" }} />

        <h3>Import Data (Append)</h3>
        <textarea
          style={{ width: "100%", minHeight: 160 }}
          placeholder="Paste JSON..."
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
            Import
          </button>
          <button onClick={() => arenaStore.clearHistory()}>
            Clear Local History
          </button>
        </div>

        <hr style={{ margin: "16px 0" }} />

        <h3>Auto Backup (Webhook)</h3>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          Configuration guide:{" "}
          <a
            href="/docs/GOOGLE_DRIVE_SETUP.md"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 6 }}
          >
            GOOGLE_DRIVE_SETUP.md
          </a>{" "}
          (contains Google Apps Script code and deployment steps)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Webhook URL (Google Apps Script Web App):
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
            Backup Interval (days):
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
            Tester ID:
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
              Trigger Backup Now
            </button>
          </div>
        </div>

        <hr style={{ margin: "16px 0" }} />

        <h3>Statistics</h3>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          <p>Total matches: {arenaStore.matches.length}</p>
          <p>
            Matches with votes:{" "}
            {arenaStore.matches.filter((m) => m.vote !== null).length}
          </p>
          <p>
            Last backup:{" "}
            {arenaStore.config.lastBackupTime
              ? new Date(arenaStore.config.lastBackupTime).toLocaleString()
              : "Never"}
          </p>
        </div>
      </div>
    </div>
  );
}
