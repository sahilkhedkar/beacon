"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { getSupabaseClient } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ExternalLink,
  Globe2,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./page.module.css";
import natureHero from "../../../packages/ui/nature.png";

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
  const [theme, setTheme] = useState<"light" | "dark">("light");
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
  const [heroPrompt, setHeroPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("beacon-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      window.localStorage.setItem("beacon-theme", next);
      return next;
    });
  }

  useEffect(() => {
    if (user || draft || document.activeElement?.getAttribute("data-hero-input") === "true") return;
    const prompts = [
      "How can cities make room for more nature?",
      "What are the quietest places to see the stars?",
      "How are forests recovering from wildfires?",
    ];
    let promptIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (document.activeElement?.getAttribute("data-hero-input") === "true") {
        timer = setTimeout(tick, 160);
        return;
      }
      const prompt = prompts[promptIndex];
      characterIndex += deleting ? -1 : 1;
      setHeroPrompt(prompt.slice(0, characterIndex));
      if (characterIndex >= prompt.length) {
        deleting = true;
        timer = setTimeout(tick, 1900);
      } else if (characterIndex <= 0) {
        deleting = false;
        promptIndex = (promptIndex + 1) % prompts.length;
        timer = setTimeout(tick, 450);
      } else {
        timer = setTimeout(tick, deleting ? 24 : 48);
      }
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [user, draft]);

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
        <div className={styles.loadingMessage} role="status" aria-live="polite">
          <span className={styles.loadingWord}>Beacon</span>
          <span className={styles.loadingCaption}>Gathering your workspace<span className={styles.loadingEllipsis}>…</span></span>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={styles.authPage}>
        <section className={styles.landingHero}>
          <div className={styles.heroPhotoFrame}>
            <Image className={styles.heroPhoto} src={natureHero} alt="A quiet river winding around a green island at sunset" fill priority sizes="100vw" />
            <div className={styles.heroPhotoShade} />
            <div className={styles.heroTopline}><Link className={styles.landingBrand} href="/" aria-label="Beacon home"><span>Beacon</span></Link><button className={styles.navSignIn} onClick={() => void signInWithGitHub()} type="button">Sign in <ArrowUpRight size={15} /></button></div>
            <div className={styles.heroCopy}>
              <h1>Follow your<br /><em>curiosity.</em></h1>
              <p className={styles.authDescription}>Live web search, thoughtful answers with sources, and a quiet place for every question that follows.</p>
              {apiUnavailable && <p className={styles.authError} role="status">Beacon’s API isn’t reachable. Start the app with <code>bun dev</code>, then reload.</p>}
              {authFailed && <p className={styles.authError}>{authError ?? "Sign-in didn’t finish. Please try again."}</p>}
            </div>
            <div className={styles.heroSearchCard}>
              <div className={styles.heroInputRow}><Search size={18} /><input data-hero-input="true" value={draft || heroPrompt} onChange={(event) => setDraft(event.target.value)} onFocus={() => setHeroPrompt("")} placeholder="Ask anything, web search it…" aria-label="Ask Beacon anything" /><button aria-label="Continue with GitHub" type="button" onClick={() => void signInWithGitHub()}><ArrowUp size={17} /></button></div>
              <div className={styles.heroInputMeta}><span><Globe2 size={13} />Live web · Answers with sources</span><button type="button" onClick={() => void signInWithGitHub()}>Start exploring <ArrowUpRight size={14} /></button></div>
            </div>
            <div className={styles.heroFeatures}><span><i>01</i> Live search</span><span><i>02</i> Sourced answers</span><span><i>03</i> Saved conversations</span></div>
          </div>
        </section>
      </main>
    );
  }

  const showWelcome = messages.length === 0 && !loadingConversation;
  const titledConversations = conversations.filter((conversation) =>
    Boolean(conversation.title?.trim()),
  );
  const filteredConversations = titledConversations.filter((conversation) =>
    conversation.title!.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <main className={styles.appShell} data-theme={theme}>
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
            <span>Beacon</span>
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
            {titledConversations.length === 0 ? (
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
                  variant="ghost"
                  className={`${styles.conversationItem} ${activeId === conversation.id ? styles.conversationActive : ""}`}
                  onClick={() => void selectConversation(conversation.id)}
                  title={conversation.title!}
                >
                  <span>{conversation.title}</span>
                </Button>
              ))
            )}
          </div>
        </div>
        <div className={styles.sidebarBottom}>
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
            <strong>
              {activeId
                ? (conversations.find((item) => item.id === activeId)?.title ??
                  "New chat")
                : "New chat"}
            </strong>
          </div>
          <div className={styles.topbarRight}>
            <button className={styles.themeToggle} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
          </div>
        </header>

        <div className={styles.contentArea} ref={scrollRef}>
          {showWelcome ? (
            <section className={styles.welcome}>
              <h1 className={styles.rainbowGreeting}>Hello, {user.name.trim().split(/\s+/)[0] || "there"}.</h1>
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
                        <span className={styles.assistantIdentityDot} />
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
