// server.js - Deploy this to Railway
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();

// Environment variables
const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY; // Set this in Railway
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Google API key
const GOOGLE_SEARCH_ID = process.env.GOOGLE_SEARCH_ID; // Google Search Engine ID

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*' // In production, replace with your actual domain
}));

// Proxy endpoint for Claude API
app.post('/api/claude', async (req, res) => {
  try {
    const { systemPrompt, userContent, maxTokens } = req.body;
    
    const payload = {
      model: "claude-3-7-sonnet-20250219",
      max_tokens: maxTokens || 512,
      system: systemPrompt,
      messages: [
        { role: "user", content: userContent }
      ]
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error || { message: `API Error: Status ${response.status}` }
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Error proxying to Claude API:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Image search endpoint using Brave Search API
app.get('/api/images', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: { message: 'Query parameter is required' } });
    }
    
    const response = await fetch(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: { message: `Brave API Error: ${response.status}` } 
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error calling Brave Search API:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
