import express from "express";
import { streamText } from "ai";
import { tavily } from "@tavily/core";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompts";

const client = tavily({
    apiKey: process.env.TAVILY_API_KEY,
});

const app = express();

app.use(express.json());

app.post("/chat" , async (req , res) => {
    // step 1 : get query from the user
    const { query } = req.body;
    // step 2 : make sure user has credits/access to hit the endpoint

    // step 3 : check if we have web search indexed for a similar query

    // step 4 : web search to gather resources

       const webSearchResponse = await client.search(query , {
          searchDepth: "advanced"
       });

       const webSearchResult = webSearchResponse.results

    // step 5 : do some context engineering on the prompt + web search responses

    // step 6 : hit the LLM and stream the response back to the user

    const prompt = PROMPT_TEMPLATE
       .replace("{{WEB_SEARCH_RESULTS}}" , JSON.stringify(webSearchResult))
       .replace("{{USER_QUERY}}" , query);

    const result = await streamText({
        model: "gpt-4o-mini",
        prompt : prompt,
        system: SYSTEM_PROMPT,
    })

    // step 7 : also stream back the sources and the follow up questions ( which we can get from another parallel LLM call )

    // step 8 : close the event stream
})

app.listen(3000);