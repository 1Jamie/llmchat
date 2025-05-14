'use strict';

const { GObject, Gio, Soup } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

// Initialize session for API requests
const _httpSession = new Soup.Session();

var Tool = GObject.registerClass(
    class FetchContentTool extends BaseTool {
        _init() {
            super._init({
                name: 'fetch_web_content',
                description: 'Fetch and extract content from web URLs. Use this tool when you need to get the actual content from a specific URL, such as recipe instructions, article content, or any other web page content.',
                category: 'web',
                parameters: {
                    urls: {
                        type: 'array',
                        description: 'Array of URLs to fetch content from',
                        items: {
                            type: 'string'
                        }
                    }
                }
            });

            // Initialize conversation history tracking
            this._conversationHistory = [];
            this._lastFetchResults = null;

            // Log initialization with capabilities and usage guidelines
            log('FetchContentTool initialized with the following capabilities:');
            log('1. Fetch content from any valid web URL');
            log('2. Extract main content from HTML pages');
            log('3. Clean and format content for readability');
            log('\nUSAGE GUIDELINES:');
            log('- Use for getting detailed content from specific URLs');
            log('- Works best with article pages, recipes, and documentation');
            log('- Content is cleaned and formatted for readability');
            log('- Maintains conversation history for context');
        }

        execute(params = {}) {
            const { urls } = params;

            if (!urls || !Array.isArray(urls) || urls.length === 0) {
                return { error: 'At least one URL is required' };
            }

            // Store the current conversation context
            this._lastFetchContext = {
                urls,
                timestamp: new Date().toISOString(),
                conversation_history: this._conversationHistory || []
            };

            return this.fetchMultipleUrls(urls);
        }

        fetchMultipleUrls(urls) {
            return new Promise((resolve, reject) => {
                try {
                    log(`Fetching content from ${urls.length} URLs`);

                    const results = [];
                    let completed = 0;
                    let hasError = false;
                    const self = this; // Store reference to this

                    urls.forEach(url => {
                        const message = Soup.Message.new('GET', url);
                        
                        // Add headers to mimic a browser request
                        message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
                        message.request_headers.append('Accept-Language', 'en-US,en;q=0.9');
                        message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');

                        _httpSession.queue_message(message, (session, msg) => { // Changed to arrow function
                            try {
                                if (msg.status_code === 200) {
                                    const content = msg.response_body.data.toString();

                                    try {
                                        // Extract main content using multiple strategies
                                        const mainContent = content.match(/<main[^>]*>([\s\S]*?)<\/main>/) ||
                                            content.match(/<article[^>]*>([\s\S]*?)<\/article>/) ||
                                            content.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
                                            content.match(/<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
                                            content.match(/<div[^>]*class="[^"]*main[^"]*"[^>]*>([\s\S]*?)<\/div>/);

                                        if (mainContent) {
                                            // Clean up the content
                                            let cleanContent = mainContent[1]
                                                .replace(/<[^>]+>/g, ' ') // Remove HTML tags
                                                .replace(/\s+/g, ' ') // Normalize whitespace
                                                .replace(/&nbsp;/g, ' ') // Replace HTML entities
                                                .replace(/&amp;/g, '&')
                                                .replace(/&lt;/g, '<')
                                                .replace(/&gt;/g, '>')
                                                .replace(/&quot;/g, '"')
                                                .replace(/&#39;/g, "'")
                                                .trim();

                                            // Extract title if available
                                            const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
                                            const title = titleMatch ? titleMatch[1].trim() : '';

                                            // Extract meta description if available
                                            const metaDescMatch = content.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
                                            const description = metaDescMatch ? metaDescMatch[1].trim() : '';

                                            // Format the content with title and description
                                            let formattedContent = '';
                                            if (title) {
                                                formattedContent += `Title: ${title}\n\n`;
                                            }
                                            if (description) {
                                                formattedContent += `Description: ${description}\n\n`;
                                            }
                                            formattedContent += `Content:\n${cleanContent}`;

                                            // Truncate if too long
                                            if (formattedContent.length > 2000) {
                                                formattedContent = formattedContent.substring(0, 2000) + '...';
                                            }

                                            results.push({
                                                url: url,
                                                content: cleanContent,
                                                formatted_content: formattedContent,
                                                title: title,
                                                description: description,
                                                status: 'success'
                                            });
                                        } else {
                                            results.push({
                                                url: url,
                                                error: 'Could not extract main content from the page',
                                                status: 'error'
                                            });
                                            hasError = true;
                                        }
                                    } catch (error) {
                                        results.push({
                                            url: url,
                                            error: `Error processing content: ${error.message}`,
                                            status: 'error'
                                        });
                                        hasError = true;
                                    }
                                } else {
                                    results.push({
                                        url: url,
                                        error: `Failed to fetch content. Status: ${msg.status_code}`,
                                        status: 'error'
                                    });
                                    hasError = true;
                                }
                            } catch (error) {
                                results.push({
                                    url: url,
                                    error: `Error processing content: ${error.message}`,
                                    status: 'error'
                                });
                                hasError = true;
                            }

                            completed++;
                            if (completed === urls.length) {
                                // Store the results and conversation context
                                const fetchResult = {
                                    type: 'fetch',
                                    urls,
                                    results,
                                    timestamp: new Date().toISOString()
                                };
                                
                                self._lastFetchResults = results;
                                self._conversationHistory = [
                                    ...(self._conversationHistory || []),
                                    fetchResult
                                ];

                                if (hasError) {
                                    resolve({
                                        results: results,
                                        status: 'partial',
                                        message: 'Some URLs failed to fetch',
                                        context: {
                                            urls,
                                            timestamp: new Date().toISOString(),
                                            conversation_history: self._conversationHistory,
                                            tool_results: fetchResult
                                        }
                                    });
                                } else {
                                    resolve({
                                        results: results,
                                        status: 'success',
                                        context: {
                                            urls,
                                            timestamp: new Date().toISOString(),
                                            conversation_history: self._conversationHistory,
                                            tool_results: fetchResult
                                        }
                                    });
                                }
                            }
                        });
                    });
                } catch (error) {
                    log(`Error in fetchMultipleUrls: ${error.message}`);
                    reject(`Error fetching content from URLs: ${error.message}`);
                }
            });
        }
    }); 