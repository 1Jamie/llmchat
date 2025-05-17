'use strict';

const { GObject, Gio, Soup } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

// Initialize session for API requests
const _httpSession = new Soup.Session();
_httpSession.timeout = 30; // Set timeout to 30 seconds
_httpSession.max_conns = 10; // Allow multiple concurrent connections
_httpSession.ssl_strict = false; // Allow self-signed certificates
_httpSession.ssl_use_system_ca_file = true; // Use system CA certificates

// Helper function for URL validation (since URL is not available in GJS)
function isValidUrl(url) {
    // Basic check for http(s):// and at least one dot after protocol
    return typeof url === 'string' && /^https?:\/\//.test(url) && url.indexOf('.', 8) > 8;
}

var Tool = GObject.registerClass(
    class FetchContentTool extends BaseTool {
        _init() {
            super._init({
                name: 'fetch_web_content',
                description: 'Fetch and extract content from webpages. Use this tool when you need to get the actual content from a specific URL, such as recipe instructions, article content, or any other web page content.',
                category: 'web',
                parameters: {
                    urls: {
                        type: 'array',
                        description: 'Array of URLs to fetch content from',
                        items: {
                            type: 'string'
                        }
                    },
                    context: {
                        type: 'object',
                        description: 'Optional context about the original request and search results',
                        properties: {
                            original_query: {
                                type: 'string',
                                description: 'The original user query or request'
                            },
                            search_results: {
                                type: 'array',
                                description: 'The search results that led to these URLs'
                            },
                            focus_keywords: {
                                type: 'array',
                                description: 'Keywords to focus on when extracting content'
                            }
                        }
                    }
                }
            });

            // Initialize conversation history tracking
            this._conversationHistory = [];
            this._lastFetchResults = null;
            this._lastContext = null;

            // Log initialization with capabilities and usage guidelines
            log('FetchContentTool initialized with the following capabilities:');
            log('1. Fetch content from any valid web URL');
            log('2. Extract main content from HTML pages');
            log('3. Clean and format content for readability');
            log('4. Maintain context and focus on original request');
            log('\nUSAGE GUIDELINES:');
            log('- Use for getting detailed content from specific URLs');
            log('- Works best with article pages, recipes, and documentation');
            log('- Content is cleaned and formatted for readability');
            log('- Maintains conversation history for context');
            log('- Preserves focus on original user request');
        }

        execute(params = {}) {
            const { urls, context } = params;

            if (!urls || !Array.isArray(urls) || urls.length === 0) {
                return { error: 'At least one URL is required' };
            }

            // Validate URLs using regex
            const validUrls = urls.filter(url => {
                if (!isValidUrl(url)) {
                    log(`Invalid URL: ${url}`);
                    return false;
                }
                return true;
            });

            if (validUrls.length === 0) {
                return { error: 'No valid URLs provided' };
            }

            // Store the current conversation context
            this._lastFetchContext = {
                urls: validUrls,
                context,
                timestamp: new Date().toISOString(),
                conversation_history: this._conversationHistory || []
            };

            // Return a Promise that resolves with the fetch results
            return new Promise((resolve, reject) => {
                const warmupMessage = Soup.Message.new('GET', 'https://example.com');
                _httpSession.queue_message(warmupMessage, (session, msg) => {
                    log('Network warm-up complete, status: ' + msg.status_code);
                    // Now proceed with the real search
                    this.fetchMultipleUrls(validUrls, context)
                        .then(resolve)
                        .catch(reject);
                });
            });
        }

        fetchMultipleUrls(urls, context) {
            return new Promise((resolve, reject) => {
                try {
                    log(`Fetching content from ${urls.length} URLs with context: ${JSON.stringify(context)}`);

                    const results = [];
                    let completed = 0;
                    let hasError = false;
                    const self = this;

                    urls.forEach(url => {
                        log(`Starting fetch for URL: ${url}`);
                        let message;
                        try {
                            // Manual protocol and hostname extraction
                            let protocol = '';
                            let hostname = '';
                            const match = url.match(/^(https?):\/\/([^\/]+)/);
                            if (match) {
                                protocol = match[1];
                                hostname = match[2];
                            } else {
                                throw new Error('Invalid URL structure: cannot extract protocol/hostname');
                            }

                            message = Soup.Message.new('GET', url);
                            
                            // Enhanced headers for better compatibility
                            message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
                            message.request_headers.append('Accept-Language', 'en-US,en;q=0.9');
                            message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');
                            message.request_headers.append('Cache-Control', 'no-cache');
                            message.request_headers.append('Pragma', 'no-cache');
                            
                            // Add referer header to prevent some sites from blocking requests
                            message.request_headers.append('Referer', protocol + '://' + hostname);

                            // Log request details
                            log(`Created request for URL: ${url}`);
                            // Log each header key/value in GJS-compatible way
                            message.request_headers.foreach((name, value) => {
                                log(`Header: ${name}: ${value}`);
                            });
                        } catch (error) {
                            log(`Error creating message for URL ${url}: ${error.message}`);
                            results.push({
                                url: url,
                                error: `Invalid URL format: ${error.message}`,
                                status: 'error'
                            });
                            hasError = true;
                            completed++;
                            return;
                        }

                        _httpSession.queue_message(message, (session, msg) => {
                            try {
                                log(`Received response for ${url} with status: ${msg.status_code}`);
                                
                                if (msg.status_code === 200) {
                                    const content = msg.response_body.data.toString();
                                    const contentType = msg.response_headers.get_one('Content-Type') || '';
                                    
                                    log(`Content type for ${url}: ${contentType}`);
                                    log(`Content length: ${content.length} characters`);
                                    
                                    // Check if content is HTML
                                    if (!contentType.includes('text/html')) {
                                        log(`Non-HTML content type detected for ${url}: ${contentType}`);
                                        results.push({
                                            url: url,
                                            error: `Unsupported content type: ${contentType}`,
                                            status: 'error',
                                            content_type: contentType
                                        });
                                        hasError = true;
                                        completed++;
                                        return;
                                    }

                                    try {
                                        // Extract metadata first
                                        log(`Extracting metadata for ${url}`);
                                        const metadata = this._extractMetadata(content);
                                        log(`Metadata extracted: ${JSON.stringify(metadata)}`);
                                        
                                        // Get focus keywords from context
                                        const focusKeywords = context?.focus_keywords || [];
                                        const originalQuery = context?.original_query || '';
                                        
                                        log(`Extracting content for ${url} with query: ${originalQuery}`);
                                        // Extract content using enhanced strategies
                                        let mainContent = null;
                                        
                                        // First try to find recipe-specific content
                                        if (originalQuery.toLowerCase().includes('recipe')) {
                                            log(`Attempting recipe-specific content extraction for ${url}`);
                                            mainContent = this._extractRecipeContent(content, originalQuery, focusKeywords);
                                            if (mainContent) {
                                                log(`Found recipe content for ${url}, length: ${mainContent.length}`);
                                            }
                                        }
                                        
                                        // If no recipe content found, try general content extraction
                                        if (!mainContent) {
                                            log(`Attempting general content extraction for ${url}`);
                                            mainContent = this._extractMainContent(content);
                                            if (mainContent) {
                                                log(`Found general content for ${url}, length: ${mainContent.length}`);
                                            }
                                        }
                                        
                                        // If still no content, try direct text extraction
                                        if (!mainContent) {
                                            log(`Attempting direct text extraction for ${url}`);
                                            mainContent = this._extractDirectText(content);
                                            if (mainContent) {
                                                log(`Found direct text for ${url}, length: ${mainContent.length}`);
                                            }
                                        }
                                        
                                        // FINAL FALLBACK: Extract all visible text from the <body> if previous methods are missing or incomplete
                                        if (!mainContent || mainContent.trim().length < 100) {
                                            log(`Attempting full body text extraction for ${url}`);
                                            const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                                            let bodyText = bodyMatch ? bodyMatch[1] : content;
                                            // Remove all HTML tags
                                            bodyText = bodyText.replace(/<[^>]+>/g, ' ');
                                            // Clean up whitespace
                                            bodyText = bodyText.replace(/\s+/g, ' ').trim();
                                            mainContent = bodyText;
                                            log(`Full body text extracted for ${url}, length: ${mainContent.length}`);
                                        }
                                        
                                        if (mainContent && mainContent.trim().length > 0) {
                                            log(`Processing extracted content for ${url}`);
                                            // Clean and format content
                                            const { cleanContent, formattedContent } = this._cleanAndFormatContent(mainContent, metadata);
                                            
                                            // Calculate relevance score and focus matches
                                            const { relevanceScore, focusMatches } = this._calculateRelevance(cleanContent, originalQuery, focusKeywords);
                                            
                                            log(`Content processed for ${url}, clean length: ${cleanContent.length}`);
                                            
                                            const result = {
                                                url: url,
                                                content: cleanContent,
                                                formatted_content: formattedContent,
                                                title: metadata.title,
                                                description: metadata.description,
                                                author: metadata.author,
                                                date: metadata.date,
                                                content_type: contentType,
                                                metadata: metadata,
                                                relevance_score: relevanceScore,
                                                focus_matches: focusMatches,
                                                status: 'success'
                                            };
                                            
                                            log(`Adding successful result for ${url}`);
                                            results.push(result);
                                        } else {
                                            log(`No content extracted for ${url}`);
                                            results.push({
                                                url: url,
                                                error: 'Could not extract meaningful content from the page',
                                                status: 'error',
                                                content_type: contentType
                                            });
                                            hasError = true;
                                        }
                                    } catch (error) {
                                        log(`Error extracting content for ${url}: ${error.message}`);
                                        results.push({
                                            url: url,
                                            error: `Error processing content: ${error.message}`,
                                            status: 'error',
                                            content_type: contentType
                                        });
                                        hasError = true;
                                    }
                                } else {
                                    log(`Failed to fetch ${url}, status: ${msg.status_code}`);
                                    results.push({
                                        url: url,
                                        error: `Failed to fetch content. Status: ${msg.status_code}`,
                                        status: 'error',
                                        status_code: msg.status_code
                                    });
                                    hasError = true;
                                }
                            } catch (error) {
                                log(`Error processing response for ${url}: ${error.message}`);
                                results.push({
                                    url: url,
                                    error: `Error processing content: ${error.message}`,
                                    status: 'error'
                                });
                                hasError = true;
                            }

                            completed++;
                            log(`Completed ${completed} of ${urls.length} URLs`);
                            
                            if (completed === urls.length) {
                                log(`All URLs processed, preparing final result`);
                                const fetchResult = {
                                    type: 'fetch',
                                    urls,
                                    results,
                                    context,
                                    timestamp: new Date().toISOString()
                                };
                                
                                self._lastFetchResults = results;
                                self._conversationHistory = [
                                    ...(self._conversationHistory || []),
                                    fetchResult
                                ];

                                const finalResult = {
                                    results: results,
                                    status: hasError ? 'partial' : 'success',
                                    message: hasError ? 'Some URLs failed to fetch' : 'All URLs fetched successfully',
                                    context: {
                                        urls,
                                        context,
                                        timestamp: new Date().toISOString(),
                                        conversation_history: self._conversationHistory,
                                        tool_results: fetchResult
                                    }
                                };
                                
                                log(`Returning final result with ${results.length} items`);
                                resolve(finalResult);
                            }
                        });
                    });
                } catch (error) {
                    log(`Error in fetchMultipleUrls: ${error.message}`);
                    reject(`Error fetching content from URLs: ${error.message}`);
                }
            });
        }

        _extractRecipeContent(content, query, keywords) {
            // Common recipe section patterns
            const recipePatterns = [
                // Look for recipe-specific sections
                /<div[^>]*class="[^"]*(?:recipe|ingredients|instructions|method|directions)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<section[^>]*class="[^"]*(?:recipe|ingredients|instructions|method|directions)[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
                // Look for recipe lists
                /<ul[^>]*class="[^"]*(?:ingredients|instructions)[^"]*"[^>]*>([\s\S]*?)<\/ul>/i,
                /<ol[^>]*class="[^"]*(?:ingredients|instructions)[^"]*"[^>]*>([\s\S]*?)<\/ol>/i,
                // Look for recipe content in article
                /<article[^>]*>([\s\S]*?)<\/article>/i,
                // Look for recipe content in main
                /<main[^>]*>([\s\S]*?)<\/main>/i
            ];

            for (const pattern of recipePatterns) {
                const match = content.match(pattern);
                if (match && match[1].trim().length > 100) {
                    return match[1];
                }
            }

            return null;
        }

        _extractMainContent(content) {
            // Common content section patterns
            const contentPatterns = [
                // Try to find the main content area
                /<main[^>]*>([\s\S]*?)<\/main>/i,
                /<article[^>]*>([\s\S]*?)<\/article>/i,
                // Look for content in common div patterns
                /<div[^>]*class="[^"]*(?:content|article|post|entry|story|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<div[^>]*id="[^"]*(?:content|article|post|entry|story|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                // Look for content in common blog post patterns
                /<div[^>]*class="[^"]*blog[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<div[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                // Look for content in common news article patterns
                /<div[^>]*class="[^"]*news[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<div[^>]*class="[^"]*story[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                // Look for content in common documentation patterns
                /<div[^>]*class="[^"]*docs[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                /<div[^>]*class="[^"]*documentation[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
                // Fallback to body content
                /<body[^>]*>([\s\S]*?)<\/body>/i
            ];

            for (const pattern of contentPatterns) {
                const match = content.match(pattern);
                if (match && match[1].trim().length > 100) {
                    return match[1];
                }
            }

            return null;
        }

        _extractDirectText(html) {
            // Remove script and style elements
            let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                          .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
                          .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
                          .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
                          .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
                          .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
                          .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
                          .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');

            // Convert common HTML elements to text with proper spacing
            text = text.replace(/<br\b[^>]*>/gi, '\n')
                      .replace(/<p\b[^>]*>([^<]+)<\/p>/gi, '\n$1\n')
                      .replace(/<div\b[^>]*>([^<]+)<\/div>/gi, '\n$1\n')
                      .replace(/<h([1-6])\b[^>]*>([^<]+)<\/h\1>/gi, '\n\n$2\n\n')
                      .replace(/<li\b[^>]*>([^<]+)<\/li>/gi, '\n• $1')
                      .replace(/<blockquote\b[^>]*>([^<]+)<\/blockquote>/gi, '\n\nQuote: $1\n\n');

            // Remove remaining HTML tags
            text = text.replace(/<[^>]+>/g, '');

            // Clean up whitespace and HTML entities
            text = text.replace(/&nbsp;/g, ' ')
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'")
                      .replace(/&mdash;/g, '—')
                      .replace(/&ndash;/g, '–')
                      .replace(/&hellip;/g, '...')
                      .replace(/\s+/g, ' ')
                      .trim();

            // Remove empty lines and normalize spacing
            text = text.split('\n')
                      .map(line => line.trim())
                      .filter(line => line.length > 0)
                      .join('\n');

            return text;
        }

        _calculateRelevance(content, query, keywords) {
            const focusMatches = [];
            let relevanceScore = 0;
            
            // Convert to lowercase for case-insensitive matching
            const lowerContent = content.toLowerCase();
            const lowerQuery = query.toLowerCase();
            const lowerKeywords = keywords.map(k => k.toLowerCase());
            
            // Check for query matches
            if (lowerQuery && lowerContent.includes(lowerQuery)) {
                relevanceScore += 0.5;
                focusMatches.push(query);
            }
            
            // Check for keyword matches
            lowerKeywords.forEach(keyword => {
                if (lowerContent.includes(keyword)) {
                    relevanceScore += 0.2;
                    focusMatches.push(keyword);
                }
            });
            
            // Check for common content indicators
            const contentIndicators = [
                'recipe', 'ingredients', 'instructions', 'method',
                'article', 'post', 'content', 'main',
                'tutorial', 'guide', 'how to', 'steps'
            ];
            
            contentIndicators.forEach(indicator => {
                if (lowerContent.includes(indicator)) {
                    relevanceScore += 0.1;
                }
            });
            
            // Normalize score to 0-1 range
            relevanceScore = Math.min(1.0, relevanceScore);
            
            return { relevanceScore, focusMatches };
        }

        _extractMetadata(content) {
            const metadata = {
                title: '',
                description: '',
                author: '',
                date: '',
                keywords: [],
                language: 'en'
            };

            // Extract title
            const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
                metadata.title = titleMatch[1].trim();
            }

            // Extract meta description
            const metaDescMatch = content.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
            if (metaDescMatch) {
                metadata.description = metaDescMatch[1].trim();
            }

            // Extract author
            const authorMatch = content.match(/<meta[^>]*name="author"[^>]*content="([^"]*)"[^>]*>/i) ||
                              content.match(/<meta[^>]*property="article:author"[^>]*content="([^"]*)"[^>]*>/i);
            if (authorMatch) {
                metadata.author = authorMatch[1].trim();
            }

            // Extract date
            const dateMatch = content.match(/<meta[^>]*property="article:published_time"[^>]*content="([^"]*)"[^>]*>/i) ||
                            content.match(/<meta[^>]*name="date"[^>]*content="([^"]*)"[^>]*>/i);
            if (dateMatch) {
                metadata.date = dateMatch[1].trim();
            }

            // Extract keywords
            const keywordsMatch = content.match(/<meta[^>]*name="keywords"[^>]*content="([^"]*)"[^>]*>/i);
            if (keywordsMatch) {
                metadata.keywords = keywordsMatch[1].split(',').map(k => k.trim());
            }

            // Extract language
            const langMatch = content.match(/<html[^>]*lang="([^"]*)"[^>]*>/i);
            if (langMatch) {
                metadata.language = langMatch[1].trim();
            }

            return metadata;
        }

        _cleanAndFormatContent(content, metadata) {
            log(`Cleaning and formatting content, length: ${content.length}`);
            
            // First, remove unwanted elements
            let cleanedContent = content
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
                .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframes
                .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '') // Remove noscript
                .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '') // Remove SVG
                .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '') // Remove forms
                .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '') // Remove navigation
                .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '') // Remove footer
                .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ''); // Remove header

            log(`Content after removing unwanted elements, length: ${cleanedContent.length}`);

            // Preserve important structural elements
            cleanedContent = cleanedContent
                .replace(/<h([1-6])\b[^>]*>([^<]+)<\/h\1>/gi, '\n\nHeading $1: $2\n\n') // Preserve headings
                .replace(/<p\b[^>]*>([^<]+)<\/p>/gi, '\n$1\n') // Preserve paragraphs
                .replace(/<li\b[^>]*>([^<]+)<\/li>/gi, '\n• $1') // Preserve list items
                .replace(/<br\b[^>]*>/gi, '\n') // Preserve line breaks
                .replace(/<blockquote\b[^>]*>([^<]+)<\/blockquote>/gi, '\n\nQuote: $1\n\n'); // Preserve quotes

            log(`Content after preserving structure, length: ${cleanedContent.length}`);

            // Clean up HTML entities and whitespace
            cleanedContent = cleanedContent
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&mdash;/g, '—')
                .replace(/&ndash;/g, '–')
                .replace(/&hellip;/g, '...')
                .replace(/\s+/g, ' ')
                .trim();

            log(`Content after cleaning entities, length: ${cleanedContent.length}`);

            // Format the content with metadata
            let formattedContent = '';
            if (metadata.title) {
                formattedContent += `Title: ${metadata.title}\n\n`;
            }
            if (metadata.author) {
                formattedContent += `Author: ${metadata.author}\n`;
            }
            if (metadata.date) {
                formattedContent += `Date: ${metadata.date}\n`;
            }
            if (metadata.description) {
                formattedContent += `\nDescription: ${metadata.description}\n\n`;
            }
            formattedContent += `Content:\n${cleanedContent}`;

            // Truncate if too long (increased limit to 20000 characters)
            if (formattedContent.length > 20000) {
                formattedContent = formattedContent.substring(0, 20000) + '...';
            }

            log(`Final formatted content length: ${formattedContent.length}`);

            return {
                cleanContent: cleanedContent,
                formattedContent: formattedContent
            };
        }
    }); 