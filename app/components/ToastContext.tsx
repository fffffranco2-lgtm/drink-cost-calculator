"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

type Toast = {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
};

type ToastContextValue = {
  toasts: Toast[];
  addToast: (message: string, type?: "success" | "error" | "info") => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastStack />
    </ToastContext.Provider>
  );
}

function ToastStack() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
      }}
    >
      {ctx.toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => ctx.removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const bg =
    toast.type === "error"
      ? "#fff0f0"
      : toast.type === "info"
        ? "#e7f0ff"
        : "#d1fae5";
  const border =
    toast.type === "error"
      ? "#f2caca"
      : toast.type === "info"
        ? "#bfd4f5"
        : "#86efac";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "12px 16px",
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: bg,
        color: "#1d232a",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      }}
    >
      <span
        className="material-symbols-rounded"
        style={{
          fontSize: 20,
          flexShrink: 0,
          color: toast.type === "error" ? "#b00020" : toast.type === "info" ? "#1d4ed8" : "#0f766e",
        }}
        aria-hidden
      >
        {toast.type === "error" ? "error" : toast.type === "info" ? "info" : "check_circle"}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Fechar"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          color: "#5a6672",
        }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 18 }} aria-hidden>close</span>
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      addToast: (_m: string, _t?: "success" | "error" | "info") => {},
      removeToast: (_id: string) => {},
    };
  }
  return ctx;
}
