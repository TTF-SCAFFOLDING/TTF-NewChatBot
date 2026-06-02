"use client";

import { useEffect, useState } from "react";
import Chat, { ConstructionAvatar } from "../Chat";

const OPTIONS: { emoji: string; label: string; prompt: string }[] = [
  {
    emoji: "📦",
    label: "Products",
    prompt: "What shoring and formwork products do you rent?",
  },
  {
    emoji: "📞",
    label: "Contact",
    prompt: "How can I contact TTF Scaffolding?",
  },
  {
    emoji: "💬",
    label: "Quotation",
    prompt: "How do I request a rental quotation?",
  },
  {
    emoji: "🚚",
    label: "Delivery",
    prompt: "How does delivery work, and how fast can you ship?",
  },
  {
    emoji: "❓",
    label: "Other",
    prompt: "I have a different question.",
  },
];

const STORAGE_KEY = "ttf-chat-history-v2";
const HERO_DISMISSED_KEY = "ttf-chat-v2-hero-dismissed";

const SUGGESTIONS = [
  "What shoring products do you rent?",
  "Difference between aluminum and steel frames?",
  "Do you serve the Greater Vancouver area?",
  "How do I request a rental quote?",
];

export default function V2Page() {
  const [stage, setStage] = useState<"loading" | "hero" | "chat">("loading");
  const [initialMessage, setInitialMessage] = useState<string | undefined>();

  // On mount, decide whether the user has already moved past the hero in
  // a previous session — if so, jump straight to the chat.
  useEffect(() => {
    try {
      const hadConversation = !!localStorage.getItem(STORAGE_KEY);
      const heroDone =
        hadConversation || !!localStorage.getItem(HERO_DISMISSED_KEY);
      setStage(heroDone ? "chat" : "hero");
    } catch {
      setStage("hero");
    }
  }, []);

  function pickOption(prompt: string) {
    try {
      localStorage.setItem(HERO_DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
    setInitialMessage(prompt);
    setStage("chat");
  }

  if (stage === "loading") return null;

  if (stage === "hero") {
    return <Hero options={OPTIONS} onPick={pickOption} />;
  }

  return (
    <Chat
      storageKey={STORAGE_KEY}
      suggestions={SUGGESTIONS}
      welcomeText="Hi! I'm the TTF Scaffolding assistant. Ask me about our shoring, formwork, and slab support rentals — or how to request a quote in the Greater Vancouver area."
      initialUserMessage={initialMessage}
    />
  );
}

function Hero({
  options,
  onPick,
}: {
  options: typeof OPTIONS;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="flex h-dvh w-full flex-col bg-gradient-to-b from-zinc-50 to-white text-zinc-900">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="flex w-full max-w-3xl flex-col items-center gap-10">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end sm:gap-8">
            <div className="relative shrink-0">
              <ConstructionAvatar size={160} />
              <span className="absolute bottom-3 right-3 h-5 w-5 rounded-full border-[3px] border-white bg-emerald-500 shadow-sm" />
            </div>
            <div className="text-center sm:text-left">
              <h1 className="text-3xl font-semibold leading-tight text-zinc-400 sm:text-4xl">
                Hello <span aria-hidden>👋</span>
              </h1>
              <p className="mt-2 text-3xl font-semibold leading-tight text-zinc-400 sm:text-4xl">
                How can I help you?
              </p>
            </div>
          </div>

          <div className="w-full">
            <p className="mb-4 text-sm text-zinc-600">
              Please select an option below:
            </p>
            <div className="flex flex-wrap gap-3">
              {options.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onPick(opt.prompt)}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-dark)] active:scale-95"
                >
                  <span aria-hidden className="text-base leading-none">
                    {opt.emoji}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

