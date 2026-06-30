import express from "express";
import dotenv from "dotenv";
import { tavily } from "@tavily/core";
import { streamText } from "ai";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompts";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

dotenv.config();

const app = express();
const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

app.use(express.json());

app.post("/chat", async (req, res) => {

  // get the user query from the request body
  const query = req.body.query;

  // make sure user has credits top hit the endpoint

  // check if we have websearch indexed for the similar query

  // websearch to gather responses
  const webSearchResponse = await client.search(query, {
    searchDepth: "advanced"
  });

  const webSearchResults = webSearchResponse.results;

  // hit the llm and stream back the response
  // llm vercel ai gateway

  const prompt = PROMPT_TEMPLATE
    .replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResults))
    .replace("{{USER_QUERY}}", query);

  const result = streamText({
    model: openai("gpt-4.1"),
    prompt: prompt,
    system: SYSTEM_PROMPT,
  });

  res.header("Cache-Control" , "no-cache");
  res.header("Content-Type" , "text/event-stream")


  for await ( const textPart of result.textStream) {
    res.write(textPart);
  }

  res.write("\n----------SOURCES-----------\n")

  // also stream back the sources and the follow up questions
    res.write(JSON.stringify(webSearchResults.map( result => ({ url : result.url }))));

  // close the event stream

  res.end();
 
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});