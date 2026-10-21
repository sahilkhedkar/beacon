"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileText,
  Github,
  Globe2,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./page.module.css";

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3003"
).replace(/\/+$/, "");

type User = { id: string; name: string; email: string; provider: string };
type Conversation = {
  id: string;
  title: string | null;
  slug: string;
  _count?: { messages: number };
  createdAt?: string;
};
type Source = { title: string; url: string; excerpt: string };
type Message = {
  id: string;
  content: string;
  role: "USER" | "ASSISTANT";
  sources?: Source[];
  followUpQuestions?: string[];
  pending?: boolean;
};

function BeaconMark({ className }: { className?: string }) {
  return (
    <span
      className={[styles.beaconMark, className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      ℬ
    </span>
  );
}

async function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const authStarted = useRef(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadConversations = useCallback(async () => {
    const response = await apiFetch("/conversations");
    if (!response.ok) return [] as Conversation[];
    const data = (await response.json()) as { conversations: Conversation[] };
    setConversations(data.conversations);
    return data.conversations;
  }, []);

  useEffect(() => {
    if (authStarted.current) return;
    authStarted.current = true;
    const params = new URLSearchParams(window.location.search);
    const failed = params.get("auth") === "failed" || params.has("error");
    setAuthFailed(failed);
    if (params.has("error_description"))
      setAuthError(params.get("error_description"));
    if (params.has("auth") || params.has("error"))
      window.history.replaceState({}, "", window.location.pathname);

    void (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session) {
          const exchange = await apiFetch("/auth/session", {
            method: "POST",
            body: JSON.stringify({ accessToken: data.session.access_token }),
          });
          if (!exchange.ok) {
            const result = (await exchange.json().catch(() => ({}))) as {
              error?: string;
            };
            if (exchange.status === 401) await supabase.auth.signOut();
            throw new Error(result.error ?? "Could not establish your Beacon session.");
          }
        }

        const response = await apiFetch("/auth/me");
        if (response.status === 401) return;
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(result.error ?? "Beacon could not load your account.");
        }
        const result = (await response.json()) as { user: User };
        setUser(result.user);
        const loadedConversations = await loadConversations();
        const requestedId = params.get("conversationId");
        const requestedConversation = loadedConversations.find(
          (conversation) => conversation.id === requestedId,
        );
        if (requestedConversation) {
          setActiveId(requestedConversation.id);
        }
        if (window.location.pathname === "/")
          router.replace("/chat");
      } catch (error) {
        if (error instanceof TypeError) setApiUnavailable(true);
        else {
          setAuthFailed(true);
          setAuthError(
            error instanceof Error ? error.message : "Sign-in could not be completed.",
          );
        }
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [loadConversations, router]);

  useEffect(() => {
    if (!user || !activeId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("conversationId") === activeId) return;
    params.set("conversationId", activeId);
    window.history.replaceState({}, "", `${pathname}?${params.toString()}`);
  }, [activeId, pathname, user]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingConversation(true);
    apiFetch(`/conversations/${activeId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load this conversation.");
        const data = (await response.json()) as {
          conversation: {
            messages: Array<{
              id: number;
              content: string;
              role: Message["role"];
              sources: Source[] | null;
              followUpQuestions: string[] | null;
            }>;
          };
        };
        if (!cancelled) {
          setMessages(
            data.conversation.messages.map((message) => ({
              ...message,
              id: String(message.id),
              sources: message.sources ?? undefined,
              followUpQuestions: message.followUpQuestions ?? undefined,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([
            {
              id: "load-error",
              role: "ASSISTANT",
              content: "I couldn’t load this conversation. Please try again.",
            },
          ]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (
        event.key === "Escape" &&
        document.activeElement === searchRef.current
      ) {
        setSearchTerm("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  async function startNewConversation() {
    setDraft("");
    setSidebarOpen(false);
    setLoadingConversation(false);
    setActiveId(null);
    setMessages([]);
    window.history.replaceState({}, "", "/chat");
    inputRef.current?.focus();
  }

  async function selectConversation(id: string) {
    setLoadingConversation(true);
    setMessages([]);
    setActiveId(id);
    setSidebarOpen(false);
  }

  async function signOut() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    await getSupabaseClient().auth.signOut();
    setUser(null);
    setConversations([]);
    setActiveId(null);
    setLoadingConversation(false);
    setMessages([]);
    setUserMenuOpen(false);
  }

  async function signInWithGitHub() {
    setAuthError(null);
    try {
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      setAuthFailed(true);
      setAuthError(
        error instanceof Error ? error.message : "Could not start GitHub sign-in.",
      );
    }
  }

  async function sendMessage(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const query = (suggested ?? draft).trim();
    if (!query || sending) return;
    const conversationId = activeId;
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "USER",
      content: query,
    };
    const assistantId = `assistant-${Date.now()}`;
    setMessages((current) => [
      ...(conversationId === activeId ? current : []),
      userMessage,
      { id: assistantId, role: "ASSISTANT", content: "", pending: true },
    ]);
    setDraft("");
    setSending(true);

    try {
      const response = await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ query, conversationId }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error.error ?? "Beacon couldn’t answer that just now.");
      }
      if (!response.body)
        throw new Error("The response stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newConversationId = conversationId;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as
          | { type: "delta"; text: string }
          | {
              type: "done";
              conversationId: string;
              sources: Source[];
              followUpQuestions: string[];
              partial?: boolean;
            }
          | { type: "error"; error: string };
        if (event.type === "delta") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + event.text }
                : message,
            ),
          );
        } else if (event.type === "done") {
          newConversationId = event.conversationId;
          setActiveId(event.conversationId);
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: event.partial
                      ? `${message.content}\n\n*This answer was interrupted before it finished. You can ask again to continue.*`
                      : message.content,
                    pending: false,
                    sources: event.sources,
                    followUpQuestions: event.followUpQuestions,
                  }
                : message,
            ),
          );
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handleLine);
        if (done) break;
      }
      if (buffer.trim()) handleLine(buffer);
      setActiveId(newConversationId);
      await loadConversations();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.";
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                pending: false,
                content: item.content || `**A momentary issue**\n\n${message}`,
              }
            : item,
        ),
      );
      await loadConversations();
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (authLoading) {
    return (
      <main className={styles.loadingPage}>
        <BeaconMark className={styles.loaderMark} />
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.authPage}>
        <header className={styles.landingNav}>
          <Link className={styles.landingBrand} href="/" aria-label="Beacon home">
            <BeaconMark className={styles.landingBrandMark} />
            <span>beacon</span>
          </Link>
          <button
            className={styles.navSignIn}
            onClick={() => void signInWithGitHub()}
            type="button"
          >
            Sign in <ArrowUpRight size={15} />
          </button>
        </header>

        <section className={styles.landingHero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Research, without the noise</p>
            <h1>
              Research that
              <br />
              <span>shows its work.</span>
            </h1>
            <p className={styles.authDescription}>
              Beacon searches the live web, turns what it finds into a clear,
              sourced answer, and keeps every conversation and reading trail
              together so you can pick up where you left off.
            </p>
            {apiUnavailable && (
              <p className={styles.authError} role="status">
                Beacon’s API isn’t reachable. Start the app with <code>bun dev</code>, then reload.
              </p>
            )}
            {authFailed && (
              <p className={styles.authError}>
                {authError ?? "Sign-in didn’t finish. Please try again."}
              </p>
            )}
            <button
              className={styles.githubButton}
              onClick={() => void signInWithGitHub()}
              type="button"
            >
              <Github size={17} /> Continue with GitHub
              <ArrowUpRight size={16} />
            </button>
            <div className={styles.authTrust}>
              <ShieldCheck size={14} /> Private by default. Yours to explore.
            </div>
          </div>

          <div className={styles.previewWrap}>
            <div className={styles.previewTopline}>
              <span><span className={styles.previewDot} /> A SAMPLE RESEARCH THREAD</span>
              <span>01 / 03</span>
            </div>
            <div className={styles.previewCard}>
              <div className={styles.previewQuestionIcon}><Search size={16} /></div>
              <p className={styles.previewLabel}>YOUR QUESTION</p>
              <h2>How are cities adapting to extreme heat?</h2>
              <div className={styles.previewRule} />
              <div className={styles.previewAnswerHead}>
                <BeaconMark className={styles.previewAnswerMark} />
                <span>THE SHORT VERSION</span>
              </div>
              <p className={styles.previewAnswer}>
                From cool roofs to shaded streets, cities are combining
                neighborhood-scale changes with better heat forecasting.
              </p>
              <div className={styles.previewSources}>
                <div className={styles.previewSourcesTitle}><span>FOLLOW THE SOURCES</span><span>02</span></div>
                <div className={styles.previewSource}><FileText size={14} /><span><strong>Urban heat resilience</strong><small>World Resources Institute</small></span><ArrowUpRight size={13} /></div>
                <div className={styles.previewSource}><FileText size={14} /><span><strong>Cooling cities at scale</strong><small>Nature Climate Change</small></span><ArrowUpRight size={13} /></div>
              </div>
            </div>
            <p className={styles.previewCaption}>A thoughtful answer, with the reading trail intact.</p>
          </div>
        </section>

        <section className={styles.landingFeatures}>
          <article><span>01</span><h3>See the bigger picture.</h3><p>Beacon looks across the web and brings the most useful perspectives into one clear answer.</p></article>
          <article><span>02</span><h3>Follow every source.</h3><p>Explore the references behind an answer and decide what deserves a closer read.</p></article>
          <article><span>03</span><h3>Keep your research.</h3><p>Conversations, sources, and follow-up questions stay together in your private workspace.</p></article>
        </section>
        <footer className={styles.landingFooter}><span>beacon</span><span>Make room for curiosity.</span><span>© 2026</span></footer>
      </main>
    );
  }

  const showWelcome = messages.length === 0 && !loadingConversation;
  const filteredConversations = conversations.filter((conversation) =>
    (conversation.title ?? "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <main className={styles.appShell}>
      {sidebarOpen && (
        <Button
          className={styles.mobileScrim}
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.sidebarTop}>
          <Link className={styles.brand} href="/chat" aria-label="Beacon home">
            <BeaconMark className={styles.brandMarkSmall} />
            <span>beacon</span>
          </Link>
          <Button
            className={styles.iconButton}
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={17} />
          </Button>
        </div>
        <Button className={styles.newChatButton} onClick={startNewConversation}>
          <Plus size={16} /> New chat
        </Button>
        <div className={styles.sidebarSearch}>
          <Search size={15} />
          <input
            ref={searchRef}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
          />
          <span className={styles.searchShortcut}>⌘ K</span>
        </div>
        <div className={styles.sidebarSection}>
          <div className={styles.sectionLabel}>
            RECENTS
          </div>
          <div className={styles.conversationList}>
            {conversations.length === 0 ? (
              <p className={styles.sidebarEmpty}>
                Your conversations will appear here.
              </p>
            ) : filteredConversations.length === 0 ? (
              <p className={styles.sidebarEmpty}>
                No conversations match your search.
              </p>
            ) : (
              filteredConversations.map((conversation) => (
                <Button
                  key={conversation.id}
                  className={`${styles.conversationItem} ${activeId === conversation.id ? styles.conversationActive : ""}`}
                  onClick={() => void selectConversation(conversation.id)}
                  title={conversation.title ?? "New chat"}
                >
                  <span>{conversation.title ?? "New chat"}</span>
                </Button>
              ))
            )}
          </div>
        </div>
        <div className={styles.sidebarBottom}>
          <a className={styles.helpLink} href="mailto:hello@beacon.app">
            <CircleHelp size={15} /> Help & feedback
          </a>
          <div className={styles.userMenuWrap}>
            <Button
              className={styles.userButton}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className={styles.avatar}>
                {user.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className={styles.userDetails}>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
              <ChevronDown
                size={15}
                className={userMenuOpen ? styles.chevronOpen : ""}
              />
            </Button>
            {userMenuOpen && (
              <div className={styles.userMenu}>
                <Button onClick={() => void signOut()}>
                  <LogOut size={15} /> Sign out
                </Button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className={styles.mainPanel}>
        <header className={styles.topbar}>
          <Button
            className={`${styles.iconButton} ${styles.mobileMenu}`}
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={19} />
          </Button>
          <div className={styles.breadcrumb}>
            <span>Workspace</span>
            <span className={styles.breadcrumbDivider}>/</span>
            <strong>
              {activeId
                ? (conversations.find((item) => item.id === activeId)?.title ??
                  "New chat")
                : "New chat"}
            </strong>
          </div>
          <div className={styles.topbarRight}>
            <span className={styles.onlineDot} /> <span>Private workspace</span>
          </div>
        </header>

        <div className={styles.contentArea} ref={scrollRef}>
          {showWelcome ? (
            <section className={styles.welcome}>
              <h1>Hello, {user.name.trim().split(/\s+/)[0] || "there"}.</h1>
            </section>
          ) : (
            <section className={styles.thread}>
              {loadingConversation && (
                <div className={styles.threadLoading}>
                  Loading conversation…
                </div>
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`${styles.message} ${message.role === "USER" ? styles.userMessage : styles.assistantMessage}`}
                >
                  {message.role === "USER" ? (
                    <div className={styles.userBubble}>{message.content}</div>
                  ) : (
                    <>
                      <div className={styles.assistantIdentity}>
                        <BeaconMark className={styles.assistantMark} />
                        <span>Beacon</span>
                        <span className={styles.answerLabel}>ANSWER</span>
                      </div>
                      <div className={styles.answerBody}>
                        {message.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        ) : message.pending ? (
                          <span className={styles.thinking}>
                            <i />
                            <i />
                            <i /> Searching and thinking
                          </span>
                        ) : null}
                      </div>
                      {message.pending && message.content && (
                        <span className={styles.streamCursor} />
                      )}
                      {message.sources && message.sources.length > 0 && (
                        <div className={styles.sourcesBlock}>
                          <div className={styles.sourcesHeading}>
                            <span>
                              <Globe2 size={14} /> Sources
                            </span>
                            <span>{message.sources.length} references</span>
                          </div>
                          <div className={styles.sourceGrid}>
                            {message.sources.slice(0, 4).map((source) => (
                              <a
                                key={source.url}
                                className={styles.sourceCard}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span className={styles.sourceDomain}>
                                  {new URL(source.url).hostname.replace(
                                    /^www\./,
                                    "",
                                  )}
                                </span>
                                <strong>{source.title}</strong>
                                <span className={styles.sourceExcerpt}>
                                  {source.excerpt}
                                </span>
                                <ExternalLink
                                  size={13}
                                  className={styles.sourceExternal}
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {message.followUpQuestions &&
                        message.followUpQuestions.length > 0 && (
                          <div className={styles.followUps}>
                            <span className={styles.followUpsLabel}>
                              Keep exploring
                            </span>
                            <div className={styles.followUpList}>
                              {message.followUpQuestions.map((question) => (
                                <Button
                                  key={question}
                                  className={styles.followUpButton}
                                  disabled={sending}
                                  onClick={() => void sendMessage(undefined, question)}
                                >
                                  {question}
                                  <ArrowUpRight size={14} />
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                    </>
                  )}
                </article>
              ))}
              <div className={styles.threadEnd} />
            </section>
          )}
        </div>

        <div className={styles.composerArea}>
          <form
            className={styles.composer}
            onSubmit={(event) => void sendMessage(event)}
          >
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Beacon anything…"
              rows={1}
              maxLength={4000}
              disabled={sending || loadingConversation}
              aria-label="Ask Beacon"
            />
            <div className={styles.composerFooter}>
              <span className={styles.composerHint}>
                <Search size={13} /> Web search included
              </span>
              <div className={styles.composerActions}>
                <span className={styles.enterHint}>↵ to send</span>
                <Button
                  className={styles.sendButton}
                  type="submit"
                  disabled={!draft.trim() || sending}
                  aria-label="Send message"
                >
                  {sending ? (
                    <span className={styles.sendSpinner} />
                  ) : (
                    <ArrowUp size={17} />
                  )}
                </Button>
              </div>
            </div>
          </form>
          <p className={styles.disclaimer}>
            Beacon can make mistakes. Check important information against the
            sources.
          </p>
        </div>
      </section>
      {sending && (
        <div className={styles.streamStatus}>
          <span className={styles.statusDot} /> Working on your answer
        </div>
      )}
    </main>
  );
}
