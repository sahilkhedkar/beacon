import express from "express";
import { Output, streamText } from "ai";
import { tavily } from "@tavily/core";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompts";
import {z} from "zod";

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

    const result = streamText({
        model: "gpt-4o-mini",
        prompt : prompt,
        system: SYSTEM_PROMPT,
    })



    for await ( const textPart of result.textStream) {
        res.write(textPart);
    }

    res.write("\n<SOURCES>\n");

    // step 7 : also stream back the sources and the follow up questions ( which we can get from another parallel LLM call )

    res.write(JSON.stringify(webSearchResult.map(result => result.url)));

    res.write("\n</SOURCES>\n");

    // step 8 : close the event stream
    res.end();
})

app.post("/chat/followup" , async (req , res) => {

    // step 1 : get the existing chat from the database
    // step 2 : forward the full history to the LLM
    // step 2.5 - todo : do context engineering here
    // step 3 : stream the response to the user
})

app.listen(3003);