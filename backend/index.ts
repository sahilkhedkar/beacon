import express from "express";
import dotenv from "dotenv";
import { tavily } from "@tavily/core";
import { streamText } from "ai";

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

  const result = streamText({
    model: 'openai/gpt-5.4',
    prompt: 'Invent a new holiday and describe its traditions.',
  });

  // also stream back the sources and the follow up questions

  // close the event stream
 
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});