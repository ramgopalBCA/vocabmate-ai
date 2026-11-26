"use strict";

const { handler: tutorHandler } = require("../netlify/functions/tutor");

module.exports = async function handler(req, res) {
    try {
        const body = typeof req.body === "string"
            ? req.body
            : req.body === undefined
                ? ""
                : JSON.stringify(req.body);
        const result = await tutorHandler({
            httpMethod: req.method,
            body,
        });

        for (const [name, value] of Object.entries(result.headers || {})) {
            res.setHeader(name, value);
        }
        res.statusCode = result.statusCode;
        res.end(result.body);
    } catch (error) {
        console.error("Vercel tutor function failed:", error);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ error: "The tutor is temporarily unavailable. Please try again." }));
    }
};
