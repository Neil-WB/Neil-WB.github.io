\// Parse search queries from Claude's response
function parseSearchQueries(responseText, maxQueries = 5) {
  const searches = [];
  const regex = /<search(\d+) tool:([^>]+)>([^<]+)<\/search\1>/g;
  let match;
  
  while ((match = regex.exec(responseText)) !== null && searches.length < maxQueries) {
    searches.push({
      id: match[1],
      tool: match[2].trim().toLowerCase(),
      query: match[3].trim()
    });
  }
  
  return searches;
}

// Endpoint for distributing searches
app.post('/api/distribute-searches', async (req, res) => {
  try {
    const { userQuery, maxSearches = 5 } = req.body;
    
    if (!userQuery) {
      return res.status(400).json({ error: { message: 'User query is required' } });
    }
    
    console.log(`Distributing searches for query: ${userQuery}`);
    
    // Call Claude to distribute searches
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1024,
        system: PROMPT_SEARCH_DISTRIBUTION,
        messages: [{ role: "user", content: userQuery }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Error from Claude API:", errorData);
      return res.status(response.status).json({ 
        error: { message: `Failed to distribute searches: ${errorData.error?.message || response.status}` } 
      });
    }

    const data = await response.json();
    const completion = data.content?.[0]?.text || '';
    
    // Parse the search queries
    const searches = parseSearchQueries(completion, maxSearches);
    console.log(`Generated ${searches.length} searches:`, searches);
    
    if (searches.length === 0) {
      return res.status(400).json({ error: { message: 'Failed to generate valid search queries' } });
    }
    
    res.json({ searches });
  } catch (error) {
    console.error('Error distributing searches:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Endpoint for executing searches
app.post('/api/execute-searches', async (req, res) => {
  try {
    const { searches } = req.body;
    
    if (!searches || !Array.isArray(searches) || searches.length === 0) {
      return res.status(400).json({ error: { message: 'Valid searches array is required' } });
    }
    
    console.log(`Executing ${searches.length} searches`);
    
    // Execute all searches in parallel
    const searchPromises = searches.map(async search => {
      try {
        let results = [];
        
        switch (search.tool) {
          case 'arxiv':
            results = await searchArxiv(search.query);
            break;
          case 'semantic_scholar':
            results = await searchSemanticScholar(search.query);
            break;
          case 'biorxiv':
            results = await searchBioRxiv(search.query);
            break;
          default:
            console.warn(`Unknown search tool: ${search.tool}`);
            return { search, results: [] };
        }
        
        return { search, results };
      } catch (error) {
        console.error(`Error executing search ${search.id}:`, error);
        return { search, results: [], error: error.message };
      }
    });
    
    const searchResults = await Promise.all(searchPromises);
    
    // Collect and flatten all results
    const allResults = [];
    const searchErrors = [];
    
    searchResults.forEach(result => {
      if (result.error) {
        searchErrors.push(`${result.search.tool}: ${result.error}`);
      }
      
      if (result.results && result.results.length > 0) {
        allResults.push(...result.results.map(paper => ({
          ...paper,
          searchQuery: result.search.query
        })));
      }
    });
    
    console.log(`Found ${allResults.length} total results`);
    
    if (allResults.length === 0) {
      return res.status(404).json({ 
        error: { 
          message: 'No relevant papers found',
          searchErrors: searchErrors.length > 0 ? searchErrors : undefined
        } 
      });
    }
    
    res.json({ 
      results: allResults,
      searchErrors: searchErrors.length > 0 ? searchErrors : undefined
    });
  } catch (error) {
    console.error('Error executing searches:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// Endpoint for processing a paper with Gemini
app.post('/api/process-paper', async (req, res) => {
  try {
    const { paper, userQuery } = req.body;
    
    if (!paper || !userQuery) {
      return res.status(400).json({ error: { message: 'Paper and user query are required' } });
    }
    
    console.log(`Processing paper: ${paper.title}`);
    
    // Construct prompt for Gemini
    const prompt = `${PROMPT_RESULT_EXTRACTION}

Research Question: ${userQuery}

Paper Information:
Title: ${paper.title}
Authors: ${paper.authors}
Source: ${paper.source}
Abstract: ${paper.abstract}`;

    // Process with Gemini
    const processedContent = await callGeminiAPI(prompt);
    
    res.json({
      originalPaper: paper,
      processedContent
    });
  } catch (error) {
    console.error('Error processing paper:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});// Search arXiv
async function searchArxiv(query, maxResults = 5) {
  try {
    console.log(`Searching arXiv for: ${query}`);
    const response = await fetch(
      `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=${maxResults}`
    );
    
    if (!response.ok) {
      throw new Error(`arXiv API Error: Status ${response.status}`);
    }
    
    const xmlData = await response.text();
    
    // Simple regex-based parsing - in a production app, use a proper XML parser
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch;
    
    while ((entryMatch = entryRegex.exec(xmlData)) !== null) {
      const entryContent = entryMatch[1];
      
      // Extract relevant fields
      const idMatch = /<id>(.*?)<\/id>/.exec(entryContent);
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(entryContent);
      const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(entryContent);
      const authorMatches = entryContent.match(/<author>([\s\S]*?)<\/author>/g) || [];
      const authors = authorMatches.map(author => {
        const nameMatch = /<name>(.*?)<\/name>/.exec(author);
        return nameMatch ? nameMatch[1] : '';
      }).join(', ');
      
      if (idMatch && titleMatch) {
        const arxivId = idMatch[1].split('/').pop();
        entries.push({
          source: 'arxiv',
          doi: `arxiv:${arxivId}`,
          title: titleMatch[1].replace(/\s+/g, ' ').trim(),
          authors: authors,
          abstract: summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '',
          url: `https://arxiv.org/abs/${arxivId}`
        });
      }
    }
    
    console.log(`Found ${entries.length} results from arXiv`);
    return entries;
  } catch (error) {
    console.error('Error searching arXiv:', error);
    return []; // Return empty array instead of throwing to continue with other sources
  }
}

// Search Semantic Scholar
async function searchSemanticScholar(query, maxResults = 5) {
  try {
    console.log(`Searching Semantic Scholar for: ${query}`);
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=title,authors,abstract,url,year,venue`
    );
    
    if (!response.ok) {
      throw new Error(`Semantic Scholar API Error: Status ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      console.warn("Unexpected response format from Semantic Scholar:", data);
      return [];
    }
    
    const papers = data.data.map(paper => ({
      source: 'semantic_scholar',
      doi: paper.paperId || '',
      title: paper.title || '',
      authors: paper.authors?.map(a => a.name).join(', ') || '',
      abstract: paper.abstract || '',
      url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`
    }));
    
    console.log(`Found ${papers.length} results from Semantic Scholar`);
    return papers;
  } catch (error) {
    console.error('Error searching Semantic Scholar:', error);
    return []; // Return empty array instead of throwing to continue with other sources
  }
}

// Search BioRxiv (using existing logic but wrapped in a function)
async function searchBioRxiv(query, maxResults = 5) {
  try {
    console.log(`Searching BioRxiv for: ${query}`);
    const currentYear = new Date().getFullYear();
    const searchUrl = `https://api.biorxiv.org/details/biorxiv/2021-01-01/${currentYear}-12-31/0/json`;
    
    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      throw new Error(`BioRxiv API error: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    if (!searchData.collection || searchData.collection.length === 0) {
      return [];
    }
    
    // Process papers
    const papers = searchData.collection
      .filter(paper => 
        paper.title.toLowerCase().includes(query.toLowerCase()) ||
        paper.abstract.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, maxResults)
      .map(paper => ({
        source: 'biorxiv',
        doi: paper.doi,
        title: paper.title,
        authors: paper.authors,
        abstract: paper.abstract,
        url: `https://www.biorxiv.org/content/${paper.doi}v${paper.version}`
      }));
    
    console.log(`Found ${papers.length} results from BioRxiv`);
    return papers;
  } catch (error) {
    console.error('Error searching BioRxiv:', error);
    return []; // Return empty array instead of throwing
  }
}// Call Gemini API
async function callGeminiAPI(prompt, maxTokens = 512) {
  try {
    console.log("Calling Gemini API with prompt:", prompt.substring(0, 100) + "...");
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      let errDetail;
      try {
        const errData = await response.json();
        errDetail = errData.error?.message || `Status: ${response.status}`;
        console.error("Gemini API error details:", errData);
      } catch (e) {
        errDetail = `Status: ${response.status}`;
      }
      throw new Error(`Gemini API Error: ${errDetail}`);
    }

    const data = await response.json();
    console.log("Gemini API response:", JSON.stringify(data).substring(0, 150) + "...");
    
    // Extract text from Gemini response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw error;
  }
}// server.js - Deploy this to Railway
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
    const { systemPrompt, userContent, maxTokens, promptType } = req.body;
    
    // Use prompt from environment variables if promptType is provided
    let finalSystemPrompt = systemPrompt;
    if (promptType) {
      switch(promptType) {
        case 'query_optimization':
          finalSystemPrompt = PROMPT_QUERY_OPTIMIZATION;
          break;
        case 'paper_selection':
          finalSystemPrompt = PROMPT_PAPER_SELECTION;
          break;
        case 'best_paper_selection':
          finalSystemPrompt = PROMPT_BEST_PAPER_SELECTION;
          break;
        case 'research_synthesis':
          finalSystemPrompt = PROMPT_RESEARCH_SYNTHESIS;
          break;
        case 'image_search':
          finalSystemPrompt = PROMPT_IMAGE_SEARCH;
          break;
      }
    }
    
    const payload = {
      model: "claude-3-7-sonnet-20250219",
      max_tokens: maxTokens || 512,
      system: finalSystemPrompt,
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
