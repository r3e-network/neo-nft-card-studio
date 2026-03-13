import { X } from "lucide-react";
import { useEffect } from "react";

interface StatusMessageProps {
  message: string;
  type: "success" | "error";
  onClose: () => void;
  autoCloseMs?: number;
}

export function StatusMessage({ message, type, onClose, autoCloseMs = 5000 }: StatusMessageProps) {
  useEffect(() => {
    if (autoCloseMs > 0) {
      const timer = setTimeout(onClose, autoCloseMs);
      return () => clearTimeout(timer);
    }
  }, [onClose, autoCloseMs]);

  if (!message) return null;

  return (
    <div 
      className={type === "success" ? "success" : "error"} 
      style={{ 
        position: "fixed", 
        bottom: "2rem", 
        right: "2rem", 
        maxWidth: "400px", 
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        gap: "1rem",
        padding: "1rem 1.25rem",
        borderRadius: "12px",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.4)",
        animation: "slide-up 0.3s cubic-bezier(0.2, 0, 0, 1)"
      }}
    >
      <div style={{ flex: 1 }}>{message}</div>
      <button 
        onClick={onClose}
        style={{ 
          background: "none", 
          border: "none", 
          color: "inherit", 
          cursor: "pointer",
          padding: 0,
          display: "flex",
          opacity: 0.7
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
