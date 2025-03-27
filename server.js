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

// Image search endpoint using Google Custom Search API
app.get('/api/images', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: { message: 'Query parameter is required' } });
    }
    
    // Log for debugging
    console.log(`Searching Google for images with query: ${query}`);
    
    // Use Google Custom Search API for images
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_ID}&q=${encodeURIComponent(query)}&searchType=image&num=5`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      // Get detailed error information
      let errorDetail;
      try {
        const errorResponse = await response.json();
        errorDetail = errorResponse.error?.message || `Status: ${response.status}`;
        console.error('Google API error details:', errorResponse);
      } catch (e) {
        errorDetail = `Status: ${response.status}`;
      }
      
      return res.status(response.status).json({ 
        error: { message: `Google Search API Error: ${errorDetail}` } 
      });
    }
    
    const data = await response.json();
    console.log(`Successfully retrieved ${data.items?.length || 0} image results`);
    
    // Transform Google's response format to match what our frontend expects
    const transformedResponse = {
      results: data.items?.map(item => ({
        thumbnail: {
          src: item.link
        },
        title: item.title,
        link: item.image?.contextLink || item.link,
        source: {
          name: item.displayLink,
          domain: item.displayLink
        }
      })) || []
    };
    
    res.json(transformedResponse);
  } catch (error) {
    console.error('Error calling Google Search API:', error);
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













// server.js - Deploy this to Railway
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const axios = require('axios');
const xml2js = require('xml2js');
const app = express();

// Environment variables
const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY; // Set this in Railway
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // Google API key
const GOOGLE_SEARCH_ID = process.env.GOOGLE_SEARCH_ID; // Google Search Engine ID

// Parse authors from environment variable
const AUTHORS = JSON.parse(process.env.AUTHORS_JSON || '[]');

// Middleware
app.use(express.json());
app.use(cors({
  origin: '*' // In production, replace with your actual domain
}));

// Get authors endpoint
app.get('/api/authors', (req, res) => {
  res.json(AUTHORS);
});

// Arxiv search endpoint
app.get('/api/arxiv', async (req, res) => {
  try {
    const { authorName, startDate } = req.query;
    
    if (!authorName) {
      return res.status(400).json({ error: 'Author name is required' });
    }
    
    console.log(`Searching arXiv for author: ${authorName} since ${startDate || 'all time'}`);
    
    const url = `http://export.arxiv.org/api/query?search_query=au:${encodeURIComponent(authorName)}&sortBy=submittedDate&sortOrder=descending&start=0&max_results=100`;
    const response = await axios.get(url);
    
    // Parse XML
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);
    
    const entries = result.feed.entry || [];
    let papers = [];
    
    // Handle case when only one paper is returned (not in array)
    if (!Array.isArray(entries)) {
      papers = [processEntry(entries, startDate)].filter(Boolean);
    } else {
      papers = entries
        .map(entry => processEntry(entry, startDate))
        .filter(Boolean);
    }
    
    res.json({ papers });
  } catch (error) {
    console.error('Error searching arXiv:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to process entry
function processEntry(entry, startDate) {
  try {
    const published = entry.published;
    
    // Filter by date if startDate is provided
    if (startDate && published < startDate) {
      return null;
    }
    
    return {
      title: entry.title,
      published: published,
      authors: Array.isArray(entry.author) 
        ? entry.author.map(a => a.name) 
        : [entry.author.name],
      link: entry.id,
      summary: entry.summary
    };
  } catch (error) {
    console.error('Error processing entry:', error);
    return null;
  }
}

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

// Image search endpoint using Google Custom Search API
app.get('/api/images', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: { message: 'Query parameter is required' } });
    }
    
    // Log for debugging
    console.log(`Searching Google for images with query: ${query}`);
    
    // Use Google Custom Search API for images
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_SEARCH_ID}&q=${encodeURIComponent(query)}&searchType=image&num=5`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      // Get detailed error information
      let errorDetail;
      try {
        const errorResponse = await response.json();
        errorDetail = errorResponse.error?.message || `Status: ${response.status}`;
        console.error('Google API error details:', errorResponse);
      } catch (e) {
        errorDetail = `Status: ${response.status}`;
      }
      
      return res.status(response.status).json({ 
        error: { message: `Google Search API Error: ${errorDetail}` } 
      });
    }
    
    const data = await response.json();
    console.log(`Successfully retrieved ${data.items?.length || 0} image results`);
    
    // Transform Google's response format to match what our frontend expects
    const transformedResponse = {
      results: data.items?.map(item => ({
        thumbnail: {
          src: item.link
        },
        title: item.title,
        link: item.image?.contextLink || item.link,
        source: {
          name: item.displayLink,
          domain: item.displayLink
        }
      })) || []
    };
    
    res.json(transformedResponse);
  } catch (error) {
    console.error('Error calling Google Search API:', error);
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
