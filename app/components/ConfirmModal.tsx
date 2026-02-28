"use client";

import React, { useEffect, useRef } from "react";

type ConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
};

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const isDanger = variant === "danger";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 16,
          border: "1px solid var(--border, #dccdb8)",
          padding: 24,
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
        }}
      >
        <h2 id="confirm-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {title}
        </h2>
        <p style={{ margin: "12px 0 20px", fontSize: 14, color: "#5a6672", lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            aria-label={cancelLabel}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid var(--border, #dccdb8)",
              background: "#f6f8fa",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            aria-label={confirmLabel}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "none",
              background: isDanger ? "#b00020" : "#0f766e",
              color: "white",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
