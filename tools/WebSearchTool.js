'use strict';

const { GObject, Gio, Soup, GLib } = imports.gi;
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

                    // Create a new Soup.Message for the POST request
                    const message = Soup.Message.new('POST', 'https://ooglester.com/search');

                    // Add headers to mimic a real browser request
                    message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
                    message.request_headers.append('Accept-Language', 'en-US,en;q=0.5');
                    message.request_headers.append('Content-Type', 'application/x-www-form-urlencoded');
                    message.request_headers.append('Origin', 'https://ooglester.com');
                    message.request_headers.append('Referer', 'https://ooglester.com/');
                    message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0');
                    message.request_headers.append('Connection', 'keep-alive');
                    message.request_headers.append('Upgrade-Insecure-Requests', '1');
                    message.request_headers.append('Sec-Fetch-Dest', 'document');
                    message.request_headers.append('Sec-Fetch-Mode', 'navigate');
                    message.request_headers.append('Sec-Fetch-Site', 'same-origin');
                    message.request_headers.append('Sec-Fetch-User', '?1');
                    message.request_headers.append('Pragma', 'no-cache');
                    message.request_headers.append('Cache-Control', 'no-cache');

                    // Build form data to match exactly what the browser sends
                    const formData = [
                        `q=${encodeURIComponent(query)}`,
                        'engines=google',
                        'engines=bing',
                        'engines=duckduckgo',
                        'category_general=1',
                        'language=auto',
                        'time_range=',
                        'safesearch=2',
                        'theme=simple',
                        'format=html',
                        'results_on_page=10'
                    ].join('&');

                    log(`Sending form data: ${formData}`);

                    // Set the request body
                    message.set_request_body_from_bytes('application/x-www-form-urlencoded', 
                        new GLib.Bytes(formData));

                    log('Sending POST request with form data...');

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
                        log(`First 500 characters of HTML: ${html.substring(0, 500)}`);

                        // Extract results using a more comprehensive approach
                        const results = [];

                        // Try multiple patterns to find search results
                        const patterns = [
                            // Pattern 1: Standard SearXNG result format
                            /<article[^>]*class="result[^"]*"[^>]*>([\s\S]*?)<\/article>/g,
                            // Pattern 2: Alternative result format
                            /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
                            // Pattern 3: Generic search result format
                            /<div[^>]*class="[^"]*search-result[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
                            // Pattern 4: New SearXNG format
                            /<div[^>]*class="[^"]*result-default[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
                            // Pattern 5: Latest SearXNG format
                            /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<div class="engines">/g
                        ];

                        log('Starting search result extraction...');
                        
                        for (const pattern of patterns) {
                            let match;
                            while ((match = pattern.exec(html)) !== null) {
                                try {
                                    const resultHtml = match[1];
                                    log(`Found potential result with pattern: ${pattern.toString().substring(0, 50)}...`);
                                    log(`Result HTML: ${resultHtml.substring(0, 200)}...`);

                                    // Try multiple patterns for URL extraction
                                    const urlPatterns = [
                                        /<a[^>]*href="([^"]+)"[^>]*class="url_header"[^>]*>/,
                                        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result-url[^"]*"[^>]*>/,
                                        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>/,
                                        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result-title[^"]*"[^>]*>/,
                                        /<a[^>]*href="([^"]+)"[^>]*class="[^"]*url[^"]*"[^>]*>/
                                    ];

                                    let url = null;
                                    for (const urlPattern of urlPatterns) {
                                        const urlMatch = resultHtml.match(urlPattern);
                                        if (urlMatch) {
                                            url = urlMatch[1];
                                            log(`Found URL with pattern: ${urlPattern.toString().substring(0, 50)}...`);
                                            break;
                                        }
                                    }

                                    // Try multiple patterns for title extraction
                                    const titlePatterns = [
                                        /<h3[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/,
                                        /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/,
                                        /<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/,
                                        /<a[^>]*class="[^"]*result-title[^"]*"[^>]*>([^<]+)<\/a>/,
                                        /<h3[^>]*>([^<]+)<\/h3>/
                                    ];

                                    let title = null;
                                    for (const titlePattern of titlePatterns) {
                                        const titleMatch = resultHtml.match(titlePattern);
                                        if (titleMatch) {
                                            title = titleMatch[1].trim();
                                            log(`Found title with pattern: ${titlePattern.toString().substring(0, 50)}...`);
                                            break;
                                        }
                                    }

                                    // Try multiple patterns for content extraction
                                    const contentPatterns = [
                                        /<p[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/,
                                        /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/,
                                        /<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/,
                                        /<div[^>]*class="[^"]*result-content[^"]*"[^>]*>([\s\S]*?)<\/div>/,
                                        /<p[^>]*>([\s\S]*?)<\/p>/
                                    ];

                                    let content = null;
                                    for (const contentPattern of contentPatterns) {
                                        const contentMatch = resultHtml.match(contentPattern);
                                        if (contentMatch) {
                                            content = contentMatch[1]
                                                .replace(/<[^>]+>/g, '')
                                                .replace(/\s+/g, ' ')
                                                .trim();
                                            log(`Found content with pattern: ${contentPattern.toString().substring(0, 50)}...`);
                                            break;
                                        }
                                    }

                                    if (url && title) {
                                        results.push({
                                            title: title,
                                            content: content || '',
                                            url: url
                                        });
                                        log(`Added result: ${title}`);
                                    } else {
                                        log(`Skipped result - missing URL or title`);
                                    }
                                } catch (error) {
                                    log(`Error processing result: ${error.message}`);
                                    continue;
                                }
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
                            return `[${index + 1}] ${result.title}\nURL: ${result.url}\nSummary: ${result.content || 'No summary available'}\n`;
                        }).join('\n---\n\n');

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

                        // Resolve with the search summary
                        resolve({
                            summary: searchSummary,
                            results: topResults,
                            context: {
                                query,
                                timestamp: new Date().toISOString(),
                                conversation_history: self._conversationHistory,
                                tool_results: searchResult
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
