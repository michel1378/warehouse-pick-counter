"use client";
import { createContext, useState, type ReactNode } from "react";

export const AttendanceFeedbackContext = createContext<(message: string) => void>(() => {});

export function AttendanceFeedback({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  return <AttendanceFeedbackContext.Provider value={setMessage}>
    {message && <p role="status">{message}</p>}{children}
  </AttendanceFeedbackContext.Provider>;
}
