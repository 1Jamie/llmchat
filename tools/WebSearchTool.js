'use strict';

const { GObject, Gio, Soup } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Export the tool class with a standard name 'Tool'
// This allows the ToolLoader to find it automatically
var Tool = GObject.registerClass(
    class WebSearchTool extends BaseTool {
        _init() {
            super._init({
                name: 'web_search',
                description: 'Search the web for information and return formatted results. Use this tool for: 1) Initial web searches, 2) Finding relevant URLs. For detailed content from URLs, use fetch_web_content tool instead.',
                category: 'web',
                parameters: {
                    query: {
                        type: 'string',
                        description: 'Search query to find relevant web content. This should be a natural language query describing what you want to find.'
                    }
                }
            });

            // Initialize conversation history tracking
            this._conversationHistory = [];
            this._lastSearchResults = null;
            this._lastSearchContext = null;

            // Log initialization with capabilities and usage guidelines
            log('WebSearchTool initialized with the following capabilities:');
            log('1. Web search using SearXNG engine');
            log('2. Result formatting with clickable URLs');
            log('3. Source attribution and cache links');
            log('\nUSAGE GUIDELINES:');
            log('- Use for initial web searches and finding relevant URLs');
            log('- Results include clickable URLs and cache links');
            log('- For detailed content from URLs, use fetch_web_content tool');
            log('- Maintains conversation history for context');
        }

        execute(params = {}) {
            const { query } = params;

            if (!query) {
                return { error: 'Search query is required' };
            }

            // Store the current conversation context with timestamp
            this._lastSearchContext = {
                query,
                timestamp: new Date().toISOString(),
                conversation_history: this._conversationHistory || []
            };

            return this.searchWeb(query);
        }

        searchWeb(query) {
            return new Promise((resolve, reject) => {
                try {
                    log(`Searching web for: ${query}`);

                    // Create a new Soup.Message for the fetch request
                    const message = Soup.Message.new('GET', `https://ooglester.com/search?q=${encodeURIComponent(query)}`);

                    // Add headers to mimic a browser request
                    message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7');
                    message.request_headers.append('Accept-Language', 'en-US,en;q=0.9');
                    message.request_headers.append('Cache-Control', 'max-age=0');
                    message.request_headers.append('Sec-Ch-Ua', '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"');
                    message.request_headers.append('Sec-Ch-Ua-Mobile', '?0');
                    message.request_headers.append('Sec-Ch-Ua-Platform', '"Linux"');
                    message.request_headers.append('Sec-Fetch-Dest', 'document');
                    message.request_headers.append('Sec-Fetch-Mode', 'navigate');
                    message.request_headers.append('Sec-Fetch-Site', 'none');
                    message.request_headers.append('Sec-Fetch-User', '?1');
                    message.request_headers.append('Upgrade-Insecure-Requests', '1');
                    message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');

                    log('Sending fetch request...');

                    // Store reference to this for use in callback
                    const self = this;

                    // Send the request using Soup.Session
                    _httpSession.queue_message(message, function (session, msg) {
                        if (msg.status_code !== 200) {
                            log(`Fetch request failed with status: ${msg.status_code}`);
                            reject(`Failed to perform web search. Status: ${msg.status_code}`);
                            return;
                        }

                        const html = msg.response_body.data.toString();
                        log(`Received HTML response of length: ${html.length}`);

                        // Extract results using a more comprehensive approach
                        const results = [];

                        // Find all article elements with the correct class
                        const articleRegex = /<article[^>]*class="result[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
                        let articleMatch;

                        while ((articleMatch = articleRegex.exec(html)) !== null) {
                            try {
                                const article = articleMatch[1];

                                // Extract URL with more precise pattern
                                const urlMatch = article.match(/<a[^>]*href="([^"]+)"[^>]*class="url_header"[^>]*>/);
                                const url = urlMatch ? urlMatch[1] : null;

                                // Extract title with more precise pattern
                                const titleMatch = article.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
                                const title = titleMatch ? titleMatch[1].trim() : null;

                                // Extract content with more precise pattern
                                const contentMatch = article.match(/<p[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/);
                                const content = contentMatch ? contentMatch[1]
                                    .replace(/<[^>]+>/g, '') // Remove HTML tags
                                    .replace(/\s+/g, ' ') // Normalize whitespace
                                    .trim() : null;

                                // Extract search engines with more precise pattern
                                const enginesMatch = article.match(/<div class="engines">([\s\S]*?)<\/div>/);
                                const engines = enginesMatch ? enginesMatch[1]
                                    .match(/<span>([^<]+)<\/span>/g)
                                    .map(span => span.replace(/<\/?span>/g, '').trim()) : [];

                                // Extract cache link if available
                                const cacheMatch = article.match(/<a[^>]*href="([^"]+)"[^>]*class="cache_link"/);
                                const cacheUrl = cacheMatch ? cacheMatch[1] : null;

                                log(`Processing article - URL: ${url}, Title: ${title}`);

                                if (url && title) {
                                    results.push({
                                        title: title,
                                        content: content || '',
                                        url: url,
                                        engines: engines,
                                        cacheUrl: cacheUrl
                                    });
                                }
                            } catch (error) {
                                log(`Error processing article: ${error.message}`);
                                continue;
                            }
                        }

                        log(`Successfully processed ${results.length} results`);

                        if (results.length === 0) {
                            reject("No search results found. Please try a different search query.");
                            return;
                        }

                        // Take top 3 results and format them for the AI
                        const topResults = results.slice(0, 3);
                        const searchSummary = topResults.map((result, index) => {
                            const source = result.engines.length > 0 ? `Source: ${result.engines.join(', ')}` : '';
                            return `[${index + 1}] ${result.title}\nURL: ${result.url}\nSummary: ${result.content || 'No summary available'}\n${source}\nCache: ${result.cacheUrl || 'Not available'}\n`;
                        }).join('\n---\n\n');

                        // Add a note about follow-up capability
                        const followUpNote = "\nTo get detailed recipe instructions, you can ask me to fetch the content from any of these URLs using the fetch_web_content tool.";

                        // Store the results and conversation context
                        const searchResult = {
                            type: 'search',
                            query,
                            results: topResults,
                            timestamp: new Date().toISOString()
                        };
                        
                        self._lastSearchResults = results;
                        self._conversationHistory = [
                            ...(self._conversationHistory || []),
                            searchResult
                        ];

                        // Resolve with the search summary and follow-up note
                        resolve({
                            summary: searchSummary + followUpNote,
                            results: topResults,
                            context: {
                                query,
                                timestamp: new Date().toISOString(),
                                conversation_history: self._conversationHistory,
                                tool_results: searchResult // Include tool results in context
                            }
                        });
                    });

                } catch (error) {
                    log(`Error in searchWeb: ${error.message}`);
                    reject(`An error occurred while performing the web search: ${error.message}`);
                }
            });
        }
    });

var SystemContextTool = GObject.registerClass(
    class SystemContextTool extends BaseTool {
        _init() {
            super._init({
                name: 'system_context',
                description: 'Get system-level information ONLY (windows, workspaces, system info, process monitoring). DO NOT use for web content or user queries.',
                category: 'system',
                parameters: {
                    type: {
                        type: 'string',
                        enum: [
                            'basic',
                            'window',
                            'workspace',
                            'system_info',
                            'resource_usage',
                            'processes',
                            'clipboard',
                            'selection',
                            'detailed'
                        ],
                        description: 'Type of system information to retrieve. Use ONLY for system-level queries, not for web content or user queries.'
                    },
                    limit: {
                        type: 'number',
                        description: 'Number of top processes to return when retrieving resource usage (default: 10)'
                    },
                    sort_by: {
                        type: 'string',
                        enum: ['cpu', 'memory', 'pid'],
                        description: 'Sort processes by CPU usage, memory usage, or process ID (default: memory)'
                    }
                }
            });
        }

        execute(params = {}) {
            const { type, limit = 10, sort_by = 'memory' } = params;

            if (!type) {
                return { error: 'Type of system information is required' };
            }

            // Store the current conversation context
            this._lastContext = {
                type,
                limit,
                sort_by,
                timestamp: new Date().toISOString()
            };

            return this.getSystemContext(type, limit, sort_by);
        }

        getSystemContext(type, limit, sort_by) {
            return new Promise((resolve, reject) => {
                try {
                    // Add conversation history to the context
                    const context = {
                        ...this._lastContext,
                        conversation_history: this._conversationHistory || []
                    };

                    // Rest of the existing getSystemContext implementation
                    // ... existing code ...
                } catch (error) {
                    log(`Error in getSystemContext: ${error.message}`);
                    reject(`An error occurred while getting system context: ${error.message}`);
                }
            });
        }
    }); 