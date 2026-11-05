"use client";
// Solved state lives in localStorage for now (per-viewer convenience until accounts land).
import { useSyncExternalStore } from "react";

const KEY = "unstuck:solved";
const EVENT = "unstuck:solved-changed";

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function parseSolved(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markSolved(id: string) {
  const ids = parseSolved(read());
  if (ids.includes(id)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids, id]));
  } catch {
    /* storage unavailable: solved state just isn't remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Raw JSON string snapshot (a primitive, so useSyncExternalStore stays stable). */
export function useSolvedRaw(): string {
  return useSyncExternalStore(subscribe, read, () => "[]");
}

export function useSolved(): string[] {
  return parseSolved(useSolvedRaw());
}
