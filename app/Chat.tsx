"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";

type Role = "user" | "assistant";
type Status = "sending" | "sent" | "delivered" | "error";
type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  status?: Status;
};

const DEFAULT_SUGGESTIONS = [
  "What shoring products do you rent?",
  "Difference between aluminum and steel frames?",
  "Do you serve the Greater Vancouver area?",
  "How do I request a rental quote?",
];

const DEFAULT_STORAGE_KEY = "ttf-chat-history-v1";
const MAX_INPUT = 1500;

const DEFAULT_WELCOME_TEXT =
  "Hi! I'm the TTF Scaffolding assistant. Ask me about our shoring, formwork, and slab support rentals — or how to request a quote in the Greater Vancouver area.";

function buildWelcome(text: string): Message {
  return {
    id: "welcome",
    role: "assistant",
    content: text,
    createdAt: Date.now(),
    status: "delivered",
  };
}

export type ChatProps = {
  welcomeText?: string;
  suggestions?: string[];
  storageKey?: string;
  initialUserMessage?: string;
};

type Contact = { name: string; phone: string; email: string };

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "Today";
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// Live-format a phone number to North-American style as the user types.
// Caps at 11 digits so a leading "1" country code is allowed but no further.
function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";

  // Handle a leading "1" country code as "+1 (xxx) xxx-xxxx".
  let cc = "";
  let rest = digits;
  if (digits.length === 11 && digits.startsWith("1")) {
    cc = "+1 ";
    rest = digits.slice(1);
  }

  if (rest.length <= 3) return `${cc}${rest}`;
  if (rest.length <= 6)
    return `${cc}(${rest.slice(0, 3)}) ${rest.slice(3)}`;
  return `${cc}(${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)}`;
}

// Strip every dash character (hyphen, en/em dash, minus, horizontal bar) from
// visible prose, while preserving Markdown link URLs like [text](tel:+1-...)
// and <br> HTML tags. Replaces dashes used as separators (" — ", " - ") with
// a colon when between words, otherwise removes them.
const DASH_CHAR_CLASS = "\\-\\u2010-\\u2015\\u2212\\u2043\\uFE58\\uFE63\\uFF0D";
function stripDashes(input: string): string {
  // Protect Markdown link URLs: replace ](...) groups with placeholders.
  const urls: string[] = [];
  let masked = input.replace(/\]\(([^)]+)\)/g, (_m, url: string) => {
    const i = urls.push(url) - 1;
    return `](§URL${i}§)`;
  });

  const dashRange = new RegExp(`[${DASH_CHAR_CLASS}]`, "g");
  const dashSep = new RegExp(`\\s*[${DASH_CHAR_CLASS}]+\\s*`, "g");

  // " — " or " - " between words becomes ": " (only first per item).
  masked = masked.replace(
    new RegExp(`(\\w|\\))\\s*[${DASH_CHAR_CLASS}]+\\s*(?=\\w|\\()`, "g"),
    "$1: ",
  );
  // Any leftover dashes (ranges, leading dashes, etc.) -> remove or replace.
  masked = masked.replace(dashSep, " ");
  masked = masked.replace(dashRange, "");

  // Restore URLs.
  masked = masked.replace(/§URL(\d+)§/g, (_m, i: string) => urls[Number(i)]);

  // Tidy spacing.
  return masked
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1");
}

// Normalize streamed assistant text so markdown structure renders properly.
function normalizeAssistantText(text: string): string {
  let out = text;
  out = out.replace(/\s+(\d{1,2}\.\s)/g, "\n\n$1");
  out = out.replace(
    /\s+(For (?:specific|more)|Feel free|You can (?:contact|reach)|Want (?:a |to )|Would you like|Need (?:help|more)|If you|Let me know|Reach out)/g,
    "\n\n$1",
  );
  out = stripDashes(out);
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

type ContactActions = { phone: boolean; email: boolean };

function extractContactActions(text: string): {
  cleaned: string;
  actions: ContactActions;
} {
  const actions: ContactActions = { phone: false, email: false };
  const PHONE_TOKEN = "§PHONE§";
  const EMAIL_TOKEN = "§EMAIL§";
  let out = text;

  // Replace links/raw mentions with tokens first, so we can rewrite the
  // surrounding phrase intelligently before deleting them.
  out = out.replace(/\[[^\]]*\]\(tel:[^)]+\)/gi, () => {
    actions.phone = true;
    return PHONE_TOKEN;
  });
  out = out.replace(/\[[^\]]*\]\(mailto:[^)]+\)/gi, () => {
    actions.email = true;
    return EMAIL_TOKEN;
  });
  out = out.replace(/\(?604\)?[\s.\-‐-―]?800[\s.\-‐-―]?9062/g, () => {
    actions.phone = true;
    return PHONE_TOKEN;
  });
  out = out.replace(/(?<![\w.\-])info@ttfscaffolding\.com/gi, () => {
    actions.email = true;
    return EMAIL_TOKEN;
  });

  const TOKEN = `(?:${PHONE_TOKEN}|${EMAIL_TOKEN})`;

  // Rewrite common "call/email at TOKEN" lead-ins so the sentence reads
  // naturally once the tokens (and trailing fragments) are stripped.
  // 1. "call us at TOKEN" / "reach us at TOKEN" / "contact us at TOKEN"
  out = out.replace(
    new RegExp(
      `\\b(call|reach|contact|email)(?:\\s+us)?(?:\\s+(?:directly|today|anytime))?\\s+(?:at|on|via)\\s+${TOKEN}`,
      "gi",
    ),
    "use the buttons below",
  );
  // 2. "via email at TOKEN" / "via phone at TOKEN"
  out = out.replace(
    new RegExp(`\\bvia\\s+(?:email|phone)\\s+(?:at\\s+)?${TOKEN}`, "gi"),
    "using the buttons below",
  );
  // 3. "send us an email at TOKEN" / "give us a call at TOKEN"
  out = out.replace(
    new RegExp(
      `\\b(?:send\\s+(?:us\\s+)?an?\\s+email|give\\s+(?:us\\s+)?a\\s+call)\\s+(?:at\\s+)?${TOKEN}`,
      "gi",
    ),
    "use the buttons below",
  );
  // 4. "for inquiries TOKEN" / "for any questions TOKEN"
  out = out.replace(
    new RegExp(
      `\\bfor\\s+(?:any\\s+)?(?:inquiries|questions|details|info(?:rmation)?)[^.\\n]*${TOKEN}[^.\\n]*`,
      "gi",
    ),
    "for any inquiries, use the buttons below",
  );

  // Remove any leftover tokens and the small connector words around them
  // ("at PHONE", ", or EMAIL", " and PHONE", etc.).
  out = out.replace(
    new RegExp(
      `[ \\t]*(?:,?\\s*(?:or|and)\\s+)?(?:at|on|via)?\\s*${TOKEN}`,
      "gi",
    ),
    "",
  );

  // Tidy up leftover punctuation/conjunctions.
  out = out
    .replace(/[ \t]*,[ \t]*(?=[,.;)])/g, "")
    .replace(/[ \t]*,[ \t]*(?:or|and)[ \t]*(?=[,.;)])/gi, "")
    .replace(/[ \t]+(?:or|and)[ \t]*(?=[.;)])/gi, "")
    .replace(/\([ \t]*[,;]?[ \t]*\)/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    // Collapse blank paragraphs left behind by removed sentences.
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleaned: out, actions };
}

export default function Chat({
  welcomeText = DEFAULT_WELCOME_TEXT,
  suggestions = DEFAULT_SUGGESTIONS,
  storageKey = DEFAULT_STORAGE_KEY,
  initialUserMessage,
}: ChatProps = {}) {
  const initialWelcome = useMemo(() => buildWelcome(welcomeText), [welcomeText]);
  const [messages, setMessages] = useState<Message[]>([initialWelcome]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initialSentRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages, hydrated, storageKey]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  const prevMsgCountRef = useRef(messages.length);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevCount = prevMsgCountRef.current;
    const newMessageAdded = messages.length > prevCount;
    prevMsgCountRef.current = messages.length;

    if (newMessageAdded) {
      // Always scroll to the latest on new messages, even if the user
      // had scrolled up.
      scrollToBottom();
      return;
    }
    // Streaming updates to the existing last message: only follow along
    // when already near the bottom, so we don't hijack the user's scroll.
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distance > 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const sendRaw = useCallback(
    async (text: string, apiOverride?: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: Message = {
        id: uid(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
        status: "sending",
      };
      const assistantId = uid();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "sending",
      };

      const next = [...messages, userMsg];
      setMessages([...next, assistantMsg]);
      setInput("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Payload for the API: same as `next`, but the last user message's
      // content may be overridden (e.g. to include hidden contact info on
      // the first send without polluting the visible bubble).
      const apiMessages = next.map((m, idx) =>
        apiOverride && idx === next.length - 1
          ? { role: m.role, content: apiOverride }
          : { role: m.role, content: m.content },
      );

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id ? { ...m, status: "sent" } : m,
          ),
        );

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: acc } : m,
            ),
          );
        }

        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === assistantId) return { ...m, status: "delivered" };
            if (m.id === userMsg.id) return { ...m, status: "delivered" };
            return m;
          }),
        );
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === assistantId) {
              return {
                ...m,
                content: aborted
                  ? "_Response stopped._"
                  : "Sorry — I couldn't reach the server. Please try again in a moment.",
                status: "error",
              };
            }
            if (m.id === userMsg.id) {
              return { ...m, status: aborted ? "sent" : "error" };
            }
            return m;
          }),
        );
        if (!aborted) console.error(err);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [isStreaming, messages],
  );

  const hasPriorUserMessage = useMemo(
    () => messages.some((m) => m.role === "user"),
    [messages],
  );

  // Gated send: on the user's very first message, capture name/phone/email
  // via a modal before actually dispatching. Subsequent messages go through
  // unchanged.
  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      if (!contact && !hasPriorUserMessage) {
        setPendingMessage(trimmed);
        setShowContactForm(true);
        return;
      }
      sendRaw(trimmed);
    },
    [contact, hasPriorUserMessage, isStreaming, sendRaw],
  );

  const submitContact = useCallback(
    (info: Contact) => {
      setContact(info);
      setShowContactForm(false);
      const msg = pendingMessage;
      setPendingMessage(null);
      if (msg) {
        // The visible user bubble shows the message they typed; the API
        // payload silently includes their contact info as a hidden prefix
        // so the assistant (and downstream operators) can see it.
        const apiText = `[User contact — name: ${info.name}, phone: ${info.phone}, email: ${info.email}]\n\n${msg}`;
        sendRaw(msg, apiText);
      }
      // Fire-and-forget: email the lead to the team. Don't block the chat
      // experience if SMTP is slow or fails — errors only show in the
      // server console.
      fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: info.name,
          phone: info.phone,
          email: info.email,
          message: msg ?? "",
          source: storageKey,
        }),
      }).catch((err) => console.error("Lead email request failed:", err));
    },
    [pendingMessage, sendRaw, storageKey],
  );

  const cancelContact = useCallback(() => {
    setShowContactForm(false);
    setPendingMessage(null);
    inputRef.current?.focus();
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const endChat = useCallback(() => {
    const hasUserMessage = messages.some((m) => m.role === "user");
    if (hasUserMessage) {
      const ok = window.confirm(
        "End this chat? Your current conversation will be cleared.",
      );
      if (!ok) return;
    }
    abortRef.current?.abort();
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setMessages([buildWelcome(welcomeText)]);
    setInput("");
    setPendingMessage(null);
    setShowContactForm(false);
    setContact(null); // re-prompt for contact on next message
    initialSentRef.current = true; // don't replay any initialUserMessage
    inputRef.current?.focus();
  }, [messages, storageKey, welcomeText]);

  // Auto-send an initial user message (e.g. from a hero-page option pick)
  // once hydration finishes — and only if there's nothing in storage yet.
  useEffect(() => {
    if (!hydrated || initialSentRef.current || !initialUserMessage) return;
    if (messages.length > 1) {
      // Already has prior conversation — don't replay the option.
      initialSentRef.current = true;
      return;
    }
    initialSentRef.current = true;
    send(initialUserMessage);
  }, [hydrated, initialUserMessage, messages.length, send]);

  const copyMessage = useCallback(async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // ignore
    }
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  const showSuggestions = useMemo(
    () => messages.length === 1 && messages[0].id === "welcome",
    [messages],
  );

  return (
    <div className="flex h-dvh w-full flex-col bg-gradient-to-b from-zinc-50 to-white text-zinc-900">
      <header className="relative z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="relative">
          <ConstructionAvatar size={40} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold leading-tight text-zinc-900">
            TTF Scaffolding Assistant
          </h1>
          <p className="flex items-center gap-1.5 text-xs leading-tight text-zinc-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {isStreaming ? "Typing…" : "Online · replies instantly"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="tel:+16048009062"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--color-brand-hover)] active:scale-95"
            aria-label="Call TTF Scaffolding at 604 800 9062"
            title="Call 604 800 9062"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
            </svg>
            <span className="hidden sm:inline">Call 604 800 9062</span>
            <span className="sm:hidden">Call</span>
          </a>
          <button
            type="button"
            onClick={endChat}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 active:scale-95"
            aria-label="End chat"
            title="End chat"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            <span className="hidden sm:inline">End chat</span>
            <span className="sm:hidden">End</span>
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const groupedWithPrev =
              !!prev &&
              prev.role === m.role &&
              !showDay &&
              m.createdAt - prev.createdAt < 2 * 60 * 1000;

            return (
              <div key={m.id} className="flex flex-col">
                {showDay && <DaySeparator label={formatDayLabel(m.createdAt)} />}
                <MessageRow
                  message={m}
                  groupedWithPrev={groupedWithPrev}
                  isStreaming={isStreaming && i === messages.length - 1}
                  copied={copiedId === m.id}
                  onCopy={() => copyMessage(m.id, m.content)}
                />
              </div>
            );
          })}

          {isStreaming &&
            messages[messages.length - 1]?.content === "" && <TypingRow />}

          {showSuggestions && (
            <div className="mt-3 flex flex-wrap gap-2 pl-11">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 shadow-sm transition hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-dark)]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {showScrollBtn && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="sticky bottom-3 ml-auto mr-2 flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-md transition hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-dark)]"
            aria-label="Scroll to latest"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-200 bg-white/95 p-3 backdrop-blur sm:p-4"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) =>
                  setInput(e.target.value.slice(0, MAX_INPUT))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Type your message…"
                disabled={isStreaming}
                maxLength={MAX_INPUT}
                aria-label="Message"
                className="no-scrollbar block max-h-40 min-h-[44px] w-full resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-2.5 text-sm leading-6 outline-none transition focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20 disabled:opacity-60"
              />
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white shadow transition hover:bg-zinc-800 active:scale-95"
                aria-label="Stop response"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-white shadow transition hover:bg-[var(--color-brand-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-1 text-[10px] text-zinc-400">
            <span>Press Enter to send · Shift+Enter for newline</span>
            <span
              className={
                input.length > MAX_INPUT - 100 ? "text-[var(--color-brand-dark)]" : ""
              }
            >
              {input.length}/{MAX_INPUT}
            </span>
          </div>
          <p className="text-center text-[10px] text-zinc-400">
            AI assistant for ttfscaffolding.com — responses may contain errors.
          </p>
        </div>
      </form>

      {showContactForm && (
        <ContactModal onCancel={cancelContact} onSubmit={submitContact} />
      )}
    </div>
  );
}

function ContactModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (info: Contact) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function validate() {
    const next: { [k: string]: string } = {};
    if (!name.trim()) next.name = "Please enter your name.";
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 7) next.phone = "Please enter a valid phone.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      next.email = "Please enter a valid email.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-6 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl ring-1 ring-zinc-200 sm:p-6"
      >
        <div className="mb-4 flex items-start gap-3">
          <ConstructionAvatar size={40} />
          <div className="flex-1">
            <h2
              id="contact-modal-title"
              className="text-base font-semibold text-zinc-900"
            >
              Before we start
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Share your contact details so our team can follow up if needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field
            ref={firstFieldRef}
            label="Name"
            value={name}
            onChange={setName}
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
            error={errors.name}
          />
          <Field
            label="Phone"
            value={phone}
            onChange={(v) => setPhone(formatPhone(v))}
            type="tel"
            autoComplete="tel"
            placeholder="(604) 800-9062"
            error={errors.phone}
          />
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="email"
            placeholder="jane@example.com"
            error={errors.email}
          />
        </div>

        <button
          type="submit"
          className="mt-5 w-full rounded-full bg-[var(--color-brand)] py-2.5 text-sm font-semibold text-white shadow transition hover:bg-[var(--color-brand-hover)] active:scale-[0.98]"
        >
          Continue
        </button>
        <p className="mt-2 text-center text-[10px] text-zinc-400">
          We use this only to follow up about your inquiry.
        </p>
      </form>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: "text" | "tel" | "email";
  autoComplete: string;
  placeholder: string;
  error?: string;
  ref?: React.Ref<HTMLInputElement>;
};

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  placeholder,
  error,
  ref,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-zinc-700">{label}</span>
      <input
        ref={ref}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded-xl border px-3 py-2 text-sm outline-none transition focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-500/20"
            : "border-zinc-300 focus:border-[var(--color-brand)] focus:ring-[var(--color-brand)]/20"
        }`}
      />
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-400">
      <div className="h-px flex-1 bg-zinc-200" />
      <span className="font-medium">{label}</span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

function MessageRow({
  message,
  groupedWithPrev,
  isStreaming,
  copied,
  onCopy,
}: {
  message: Message;
  groupedWithPrev: boolean;
  isStreaming: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div
        className={`flex justify-end ${groupedWithPrev ? "mt-0.5" : "mt-2"}`}
      >
        <div className="flex max-w-[85%] flex-col items-end sm:max-w-[75%]">
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--color-brand)] px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm">
            {message.content || " "}
          </div>
          <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-zinc-400">
            <span>{formatTime(message.createdAt)}</span>
            <StatusIcon status={message.status} />
          </div>
        </div>
      </div>
    );
  }

  const { cleaned, actions } = extractContactActions(message.content);
  const normalized = normalizeAssistantText(cleaned);
  const showActions = actions.phone || actions.email;
  const hasContent = !!normalized;
  const chunks = hasContent ? splitIntoBubbles(normalized) : [];

  return (
    <div
      className={`group flex flex-col gap-1 ${groupedWithPrev ? "mt-0.5" : "mt-2"}`}
    >
      {hasContent ? (
        chunks.map((chunk, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === chunks.length - 1;
          return (
            <div key={idx} className="flex items-end gap-2">
              <div className="w-8 shrink-0">
                {isFirst && !groupedWithPrev && (
                  <ConstructionAvatar size={32} />
                )}
              </div>
              <div className="flex max-w-[calc(100%-3rem)] flex-col items-start gap-1.5 sm:max-w-[80%]">
                <div className="relative rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm leading-[1.65] text-zinc-800 shadow-sm ring-1 ring-zinc-200">
                  <AssistantMarkdown>{chunk}</AssistantMarkdown>
                  {isStreaming && isLast && (
                    <span className="ml-0.5 inline-block h-3.5 w-1 translate-y-0.5 animate-pulse rounded-sm bg-[var(--color-brand)] align-middle" />
                  )}
                </div>

                {isLast && showActions && (
                  <div className="flex flex-wrap gap-2">
                    {actions.phone && (
                      <a
                        href="tel:+16048009062"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--color-brand-hover)] active:scale-95"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
                        </svg>
                        Call 604 800 9062
                      </a>
                    )}
                    {actions.email && <EmailButton />}
                  </div>
                )}

                {isLast && (
                  <div className="flex items-center gap-2 px-1 text-[10px] text-zinc-400">
                    <span>{formatTime(message.createdAt)}</span>
                    {!isStreaming && (
                      <button
                        type="button"
                        onClick={onCopy}
                        className="opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-brand-dark)] focus:opacity-100"
                        aria-label="Copy message"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="flex items-end gap-2">
          <div className="w-8 shrink-0">
            {!groupedWithPrev && <ConstructionAvatar size={32} />}
          </div>
          <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200">
            <TypingDots inline />
          </div>
        </div>
      )}
    </div>
  );
}

// Split assistant text into separate bubbles. Splits on blank-line paragraph
// breaks while:
//   - keeping consecutive list items together as ONE list (don't break a
//     numbered list into separate bubbles, otherwise each item restarts at 1).
//   - gluing a short intro paragraph onto the following list.
//   - dropping chunks that are empty or contain only HTML <br> tags.
function splitIntoBubbles(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && p.replace(/<br\s*\/?>/gi, "").trim().length > 0);
  if (paragraphs.length <= 1) return paragraphs;

  const isList = (p: string) =>
    /^(?:\s*(?:[-*]|\d{1,2}\.)\s)/m.test(p) || /^\s*[-*]\s/.test(p);

  // First pass: merge consecutive list paragraphs into one block so the
  // numbered list stays a single list when rendered.
  const merged: string[] = [];
  for (const p of paragraphs) {
    const last = merged[merged.length - 1];
    if (last && isList(last) && isList(p)) {
      merged[merged.length - 1] = `${last}\n${p}`;
    } else {
      merged.push(p);
    }
  }

  // Second pass: glue a short intro paragraph onto the following list.
  const out: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    const p = merged[i];
    if (
      !isList(p) &&
      p.length < 140 &&
      i + 1 < merged.length &&
      isList(merged[i + 1])
    ) {
      out.push(`${p}\n\n${merged[i + 1]}`);
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

function AssistantMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeRaw]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        br: () => <br className="block leading-loose" />,
        strong: ({ children }) => (
          <strong className="font-semibold text-zinc-900">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0 marker:text-[var(--color-brand)]">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0 marker:font-semibold marker:text-[var(--color-brand-dark)]">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="pl-1 leading-relaxed">{children}</li>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-brand-dark)] underline underline-offset-2 hover:text-[var(--color-brand-hover)]"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px]">
            {children}
          </code>
        ),
        h1: ({ children }) => (
          <h3 className="mb-1.5 mt-3 text-sm font-semibold text-zinc-900 first:mt-0">
            {children}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="mb-1.5 mt-3 text-sm font-semibold text-zinc-900 first:mt-0">
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1.5 mt-3 text-sm font-semibold text-zinc-900 first:mt-0">
            {children}
          </h3>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function StatusIcon({ status }: { status?: Status }) {
  if (status === "sending") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Sending"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#dc2626"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Failed to send"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    );
  }
  if (status === "delivered") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Delivered"
      >
        <path d="m2 12 5 5L17 7" />
        <path d="m13 17 6-6" />
      </svg>
    );
  }
  // sent
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Sent"
    >
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

const EMAIL_ADDRESS = "info@ttfscaffolding.com";

function EmailButton() {
  return (
    <a
      href={`mailto:${EMAIL_ADDRESS}`}
      className="relative inline-flex items-center gap-1.5 rounded-full border border-[var(--color-brand)] bg-white px-3.5 py-2 text-xs font-medium text-[var(--color-brand-dark)] shadow-sm transition hover:bg-[var(--color-brand-soft)] active:scale-95"
      aria-label={`Email ${EMAIL_ADDRESS}`}
      title={EMAIL_ADDRESS}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <path d="m22 6-10 7L2 6" />
      </svg>
      Email us
    </a>
  );
}

function TypingRow() {
  return (
    <div className="mt-2 flex items-end gap-2">
      <div className="shrink-0">
        <ConstructionAvatar size={32} />
      </div>
      <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200">
        <TypingDots />
      </div>
    </div>
  );
}

export function ConstructionAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-white shadow-sm"
      style={{ width: size, height: size }}
      aria-label="TTF assistant avatar"
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {/* face */}
        <circle cx="32" cy="34" r="11" fill="#f5d6b3" />
        {/* neck */}
        <rect x="28" y="43" width="8" height="5" fill="#e8c096" />
        {/* shirt / shoulders */}
        <path
          d="M14 60c0-8 8-13 18-13s18 5 18 13v4H14z"
          fill="#1e3a8a"
        />
        {/* hi-vis vest stripe */}
        <path
          d="M14 56c0-4 8-7 18-7s18 3 18 7v2H14z"
          fill="#fbbf24"
          opacity="0.95"
        />
        {/* hard hat brim */}
        <rect x="16" y="24" width="32" height="4" rx="1.5" fill="#facc15" />
        {/* hard hat dome */}
        <path
          d="M20 24c0-7 5.5-12 12-12s12 5 12 12z"
          fill="#facc15"
        />
        {/* hard hat ridge */}
        <rect x="30" y="14" width="4" height="10" fill="#eab308" />
        {/* eyes */}
        <circle cx="28.5" cy="34" r="1.3" fill="#1f2937" />
        <circle cx="35.5" cy="34" r="1.3" fill="#1f2937" />
        {/* smile */}
        <path
          d="M28.5 38.5c1.2 1.2 5.8 1.2 7 0"
          stroke="#1f2937"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

function TypingDots({ inline = false }: { inline?: boolean }) {
  return (
    <div className={inline ? "flex gap-1 py-0.5" : "flex gap-1"}>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
    </div>
  );
}
