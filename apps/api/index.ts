import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { gateway } from "@ai-sdk/gateway";
import { generateText, Output, streamText } from "ai";
import { tavily } from "@tavily/core";
import { z } from "zod";
import { prisma } from "@repo/db";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompts";

const app = express();
const port = Number(process.env.PORT ?? 3003);
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
const frontendOrigin = new URL(frontendUrl).origin;
const sessionCookie = "beacon_session";
const sessionDuration = 7 * 24 * 60 * 60;
const configuredSessionSecret = process.env.SESSION_SECRET;

if (!configuredSessionSecret) {
  throw new Error("SESSION_SECRET must be set to start the API");
}
const sessionSecret: string = configuredSessionSecret;

const searchClient = process.env.TAVILY_API_KEY
  ? tavily({ apiKey: process.env.TAVILY_API_KEY })
  : null;

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === frontendOrigin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAge * 1000,
  };
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function makeSession(userId: string) {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + sessionDuration * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookies(header = "") {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      const rawValue = part.slice(separator + 1).trim();
      let value = rawValue;
      try {
        value = decodeURIComponent(rawValue);
      } catch {
        // Ignore malformed escaping and let session validation reject the value.
      }
      return [[part.slice(0, separator).trim(), value]];
    }),
  );
}

function getSessionUserId(req: Request) {
  const token = readCookies(req.headers.cookie)[sessionCookie];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      userId: string;
      expiresAt: number;
    };
    return session.expiresAt > Date.now() ? session.userId : null;
  } catch {
    return null;
  }
}

function requireUser(req: Request, res: Response) {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return null;
  }
  return userId;
}

function requireTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && origin !== frontendOrigin) {
    res.status(403).json({ error: "This request origin is not allowed." });
    return;
  }
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/session", requireTrustedOrigin, async (req, res) => {
  const accessToken =
    typeof req.body?.accessToken === "string" ? req.body.accessToken : "";
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(503).json({ error: "Supabase Auth is not configured on the API." });
    return;
  }
  if (!accessToken) {
    res.status(400).json({ error: "A Supabase access token is required." });
    return;
  }

  let profileResponse: globalThis.Response;
  try {
    profileResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (cause) {
    console.error("Could not reach Supabase Auth:", cause);
    res.status(502).json({ error: "Beacon could not reach Supabase Auth to verify your sign-in." });
    return;
  }
  if (!profileResponse.ok) {
    console.error("Supabase rejected session verification:", profileResponse.status);
    const rejectedByAuth = profileResponse.status >= 400 && profileResponse.status < 500;
    res.status(rejectedByAuth ? 401 : 502).json({
      error:
        rejectedByAuth
          ? "Your Supabase session expired. Please sign in again."
          : "Supabase Auth could not verify your sign-in.",
    });
    return;
  }

  let profile: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  try {
    profile = (await profileResponse.json()) as typeof profile;
  } catch (cause) {
    console.error("Supabase returned an invalid user response:", cause);
    res.status(502).json({ error: "Supabase returned an invalid user response." });
    return;
  }
  if (!profile.id || !profile.email) {
    res.status(400).json({ error: "The GitHub account must include an email address." });
    return;
  }

  const metadata = profile.user_metadata ?? {};
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    profile.email.split("@")[0] ||
    "Beacon user";
  const accountId = `supabase:${profile.id}`;
  try {
    const userWithAccount = await prisma.user.findUnique({
      where: { providerAccountId: accountId },
      select: { id: true },
    });
    const user = userWithAccount
      ? await prisma.user.update({
          where: { id: userWithAccount.id },
          data: {
            email: profile.email,
            name,
            provider: "GITHUB",
            providerAccountId: accountId,
          },
          select: { id: true },
        })
      : await prisma.user.upsert({
          where: { email: profile.email },
          create: {
            email: profile.email,
            name,
            provider: "GITHUB",
            providerAccountId: accountId,
          },
          update: {
            name,
            provider: "GITHUB",
            providerAccountId: accountId,
          },
          select: { id: true },
        });

    res.cookie(
      sessionCookie,
      makeSession(user.id),
      cookieOptions(sessionDuration),
    );
    res.json({ ok: true });
  } catch (cause) {
    console.error("Could not save Supabase user in Beacon database:", cause);
    res.status(500).json({
      error: "Supabase verified your sign-in, but Beacon could not save your account. Check the API database logs.",
    });
  }
});

app.get("/auth/me", async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, provider: true },
    });
    if (!user) {
      res.clearCookie(sessionCookie, { path: "/" });
      res.status(401).json({ error: "Session expired" });
      return;
    }
    res.json({ user });
  } catch (cause) {
    console.error("Could not load signed-in Beacon user:", cause);
    res.status(503).json({ error: "Beacon could not load your account from the database." });
  }
});

app.post("/auth/logout", requireTrustedOrigin, (_req, res) => {
  res.clearCookie(sessionCookie, { path: "/" });
  res.status(204).end();
});

app.get("/conversations", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const conversations = await prisma.conversation.findMany({
    where: { userId, messages: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      slug: true,
      _count: { select: { messages: true } },
    },
  });
  res.json({ conversations });
});

app.post("/conversations", requireTrustedOrigin, async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  // Reuse the current empty thread so development Strict Mode or a quick
  // refresh cannot litter the library with duplicate blank conversations.
  const forceNew = req.body?.forceNew === true;
  let conversation = forceNew
    ? null
    : await prisma.conversation.findFirst({
        where: { userId, messages: { none: {} } },
        orderBy: { createdAt: "desc" },
      });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { userId, slug: randomBytes(12).toString("hex") },
    });
  }
  res.status(201).json({ conversation });
});

app.get("/conversations/:conversationId", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.conversationId, userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          role: true,
          createdAt: true,
          sources: true,
          followUpQuestions: true,
        },
      },
    },
  });
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({ conversation });
});

app.post("/chat", requireTrustedOrigin, async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const query =
    typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const conversationId =
    typeof req.body?.conversationId === "string"
      ? req.body.conversationId
      : null;
  if (!query || query.length > 4000) {
    res
      .status(400)
      .json({ error: "Enter a question up to 4,000 characters long." });
    return;
  }
  if (!searchClient) {
    res.status(503).json({ error: "Web search is not configured on the API." });
    return;
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    res
      .status(503)
      .json({ error: "The answer service is not configured on the API." });
    return;
  }

  let conversation = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
      })
    : null;
  if (conversationId && !conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId,
        title: query.slice(0, 72),
        slug: randomBytes(12).toString("hex"),
      },
    });
  }
  const previousMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { id: "desc" },
    take: 10,
    select: { content: true, role: true },
  });
  if (!conversation.title && previousMessages.length === 0) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { title: query.slice(0, 72) },
    });
  }
  const conversationHistory = previousMessages
    .reverse()
    .map(
      (message) =>
        `${message.role === "USER" ? "User" : "Beacon"}: ${message.content}`,
    )
    .join("\n\n");
  await prisma.message.create({
    data: { content: query, role: "USER", conversationId: conversation.id },
  });

  let answer = "";
  let sources: Array<{ title: string; url: string; excerpt: string }> = [];
  let streamStarted = false;
  try {
    const search = await searchClient.search(query, {
      searchDepth: "advanced",
    });
    sources = search.results.map(({ title, url, content }) => ({
      title: title ?? url,
      url,
      excerpt: content,
    }));
    const result = streamText({
      model: gateway("openai/gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      prompt: PROMPT_TEMPLATE.replace(
        "{{WEB_SEARCH_RESULTS}}",
        JSON.stringify(sources),
      )
        .replace(
          "{{CONVERSATION_HISTORY}}",
          conversationHistory || "No previous messages.",
        )
        .replace("{{USER_QUERY}}", query),
    });

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    streamStarted = true;
    for await (const text of result.textStream) {
      answer += text;
      res.write(`${JSON.stringify({ type: "delta", text })}\n`);
    }
    let followUpQuestions = [
      "Can you explain the key takeaway in more detail?",
      "Which sources are most useful to read first?",
      "What should I explore next about this topic?",
    ];
    try {
      const followUps = await generateText({
        model: gateway("openai/gpt-4o-mini"),
        output: Output.object({
          schema: z.object({
            questions: z.array(z.string().min(8).max(120)).length(3),
          }),
        }),
        prompt: `Suggest exactly three short, specific follow-up questions that naturally continue this research conversation.\nUser question: ${query}\nAnswer: ${answer.slice(0, 5000)}`,
      });
      followUpQuestions = followUps.output.questions;
    } catch (cause) {
      console.warn("Could not generate tailored follow-up questions:", cause);
    }
    await prisma.message.create({
      data: {
        content: answer,
        role: "ASSISTANT",
        conversationId: conversation.id,
        sources,
        followUpQuestions,
      },
    });
    res.end(
      `${JSON.stringify({ type: "done", conversationId: conversation.id, sources, followUpQuestions })}\n`,
    );
  } catch (cause) {
    console.error("Chat request failed:", cause);
    if (streamStarted && answer.trim()) {
      const partialAnswer = `${answer.trim()}\n\n*This answer was interrupted before it finished. You can ask again to continue.*`;
      const followUpQuestions = [
        "Can you continue the answer from where it stopped?",
        "What are the key points so far?",
        "Which sources support this answer?",
      ];
      try {
        await prisma.message.create({
          data: {
            content: partialAnswer,
            role: "ASSISTANT",
            conversationId: conversation.id,
            sources,
            followUpQuestions,
          },
        });
        if (!res.destroyed) {
          res.end(
            `${JSON.stringify({ type: "done", conversationId: conversation.id, sources, followUpQuestions, partial: true })}\n`,
          );
        }
        return;
      } catch (persistError) {
        console.error("Could not save the interrupted answer:", persistError);
      }
    }
    if (!res.headersSent) {
      res.status(502).json({
        error: "Beacon could not complete that answer. Please try again.",
      });
    } else {
      res.end(
        `${JSON.stringify({ type: "error", error: "The answer stream was interrupted." })}\n`,
      );
    }
  }
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error("API request failed:", error);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(port, () => {
  console.log(`Beacon API listening on ${port}`);
});
