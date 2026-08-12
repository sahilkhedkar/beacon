import express from "express";

const app = express();

app.post("/chat" , (req , res) => {
    // get query from the user

    // make sure user has credits/access to hit the endpoint

    // check if we have web search indexed for a similar query

    // web search to gather resources

    // do some context engineering on the prompt + web search responses

    // hit the LLM and stream the response back to the user
})

app.listen(3000);