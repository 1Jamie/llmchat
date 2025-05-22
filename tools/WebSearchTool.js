'use strict';

const { GObject, Gio, Soup, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Export the tool class with a standard name 'Tool'
// This allows the ToolLoader to find it automatically
var Tool = GObject.registerClass(
    class WebSearchTool extends BaseTool {
        _init() {
            super._init({
                name: 'web_search',
                description: 'Search the web for current information. Use for weather, news, sports, or any up-to-date web data.',
                category: 'web',
                keywords: ['search', 'lookup', 'find', 'information', 'news', 'current', 'latest', 'update', 'weather', 'forecast', 'temperature', 'definition', 'meaning', 'fact', 'check', 'verify', 'research', 'investigate', 'discover', 'explore', 'query', 'results', 'data', 'content', 'web', 'internet', 'online', 'browse', 'google', 'brave', 'search engine'],
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

            // Simplified initialization logging
            log('[WebSearch] Tool initialized with Brave Search API support');
        }

        // Helper function to strip HTML tags and markdown formatting
        _stripHtmlAndMarkdown(text) {
            if (!text) return '';
            
            // Remove HTML tags
            let cleaned = text.replace(/<[^>]*>/g, '');
            
            // Remove common markdown formatting
            cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1'); // Bold
            cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1'); // Italic
            cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // Inline code
            cleaned = cleaned.replace(/```[\s\S]*?```/g, ''); // Code blocks
            cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Links
            cleaned = cleaned.replace(/#{1,6}\s+(.+)/g, '$1'); // Headers
            cleaned = cleaned.replace(/>\s+(.+)/g, '$1'); // Blockquotes
            
            // Remove extra whitespace and clean up
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            cleaned = cleaned.replace(/&nbsp;/g, ' ');
            cleaned = cleaned.replace(/&amp;/g, '&');
            cleaned = cleaned.replace(/&lt;/g, '<');
            cleaned = cleaned.replace(/&gt;/g, '>');
            cleaned = cleaned.replace(/&quot;/g, '"');
            cleaned = cleaned.replace(/&#39;/g, "'");
            
            return cleaned;
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
                    // Consolidate search logging to reduce spam
            if (!this._searchCount) this._searchCount = 0;
            this._searchCount++;
            
            if (this._searchCount === 1 || this._searchCount % 5 === 0) {
                log(`[WebSearch ${this._searchCount}] Searching for: "${query}"`);
            }

            // Get the Brave Search API key from settings
            const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.llmchat');
            const apiKey = settings.get_string('brave-search-api-key');
            
            if (!apiKey) {
                reject('Brave Search API key is not set. Please set it in the extension settings.');
                return;
            }

            // Create the search request
            const message = Soup.Message.new('GET', `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`);

            // Add headers for Brave Search API
            message.request_headers.append('Accept', 'application/json');
            message.request_headers.append('X-Subscription-Token', apiKey);
            message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');

                            // Store reference to this for use in callback
                            const self = this;

                    // Send the request
                            _httpSession.queue_message(message, function (session, msg) {
                                if (msg.status_code !== 200) {
                                    log(`Search request failed with status: ${msg.status_code}`);
                                    reject(`Failed to perform web search. Status: ${msg.status_code}`);
                                    return;
                                }

                        try {
                            const response = JSON.parse(msg.response_body.data.toString());

                            // Extract results from the Brave Search API response
                                const results = [];
                            if (response.web && response.web.results) {
                                response.web.results.forEach(result => {
                                                results.push({
                                        title: self._stripHtmlAndMarkdown(result.title || ''),
                                        content: self._stripHtmlAndMarkdown(result.description || ''),
                                        url: result.url,
                                        // Add additional metadata for better context
                                        source: result.source || 'Unknown',
                                        published_date: result.published_date || null,
                                        language: result.language || 'en',
                                        relevance_score: result.relevance_score || 0
                                    });
                                });
                                }

                                // Log results only occasionally to reduce spam
                                if (self._searchCount === 1 || self._searchCount % 5 === 0) {
                                    log(`[WebSearch] Processed ${results.length} results for query: "${query}"`);
                                }

                                if (results.length === 0) {
                                    reject("No search results found. Please try a different search query.");
                                    return;
                                }

                            // Sort results by relevance score if available
                            results.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

                            // Take top 5 results (increased from 3) and format them for the AI
                            const topResults = results.slice(0, 5);
                            
                            // Create a more structured format for the AI
                            const searchSummary = {
                                query: query,
                                total_results: results.length,
                                top_results: topResults.map((result, index) => ({
                                    rank: index + 1,
                                    title: result.title,
                                    url: result.url,
                                    summary: result.content || 'No summary available',
                                    source: result.source,
                                    published_date: result.published_date,
                                    relevance_score: result.relevance_score
                                }))
                            };

                            // Format the results in a way that's easy for the AI to parse
                            const formattedResults = topResults.map((result, index) => {
                                return `[${index + 1}] ${result.title}
Source: ${result.source}
URL: ${result.url}
Published: ${result.published_date || 'Unknown date'}
Relevance: ${result.relevance_score || 'N/A'}
Summary: ${result.content || 'No summary available'}
Citation: [${result.title}](${result.url}) - ${result.source}
---`;
                            }).join('\n\n');

                                // Store the results and conversation context
                                const searchResult = {
                                    type: 'search',
                                    query,
                                    results: topResults,
                                    timestamp: new Date().toISOString(),
                                    sources: topResults.map(result => ({
                                        title: result.title,
                                    url: result.url,
                                    source: result.source,
                                    published_date: result.published_date
                                })),
                                metadata: {
                                    total_results: results.length,
                                    query_time: new Date().toISOString(),
                                    language: 'en'
                                }
                                };
                                
                                self._lastSearchResults = results;
                                self._conversationHistory = [
                                    ...(self._conversationHistory || []),
                                    searchResult
                                ];

                            // Resolve with both structured and formatted results
                                resolve({
                                summary: formattedResults,
                                structured_results: searchSummary,
                                    results: topResults,
                                    sources: searchResult.sources,
                                metadata: searchResult.metadata,
                                    context: {
                                        query,
                                        timestamp: new Date().toISOString(),
                                        conversation_history: self._conversationHistory,
                                        tool_results: searchResult
                                    }
                            });
                        } catch (error) {
                            log(`Error processing Brave Search API response: ${error.message}`);
                            reject(`Failed to process search results: ${error.message}`);
                        }
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
