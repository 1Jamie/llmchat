    'use strict';

    const { GObject, Gio, Soup } = imports.gi;
    const ExtensionUtils = imports.misc.extensionUtils;
    const Me = ExtensionUtils.getCurrentExtension();
    const { BaseTool } = Me.imports.tools.BaseTool;

    // Export the tool class with a standard name 'Tool'
    // This allows the ToolLoader to find it automatically
    var Tool = GObject.registerClass(
    class WebSearchTool extends BaseTool {
        _init() {
            super._init({
                name: 'web_search',
                description: 'Search the web using various search engines',
                category: 'web',
                parameters: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    engine: {
                        type: 'string',
                        enum: ['google', 'bing', 'duckduckgo'],
                        description: 'Search engine to use'
                    }
                }
            });
        }

        execute(params = {}) {
            const { query, engine = 'google' } = params;

            if (!query) {
                return { error: 'Search query is required' };
            }

            const searchUrl = this._getSearchUrl(query, engine);
            if (!searchUrl) {
                return { error: 'Invalid search engine' };
            }

            try {
                Gio.app_info_launch_default_for_uri(searchUrl, null);
                return { success: true, url: searchUrl };
            } catch (error) {
                return { error: `Failed to open search URL: ${error.message}` };
            }
        }

        _getSearchUrl(query, engine) {
            const encodedQuery = encodeURIComponent(query);
            switch (engine.toLowerCase()) {
                case 'google':
                    return `https://www.google.com/search?q=${encodedQuery}`;
                case 'bing':
                    return `https://www.bing.com/search?q=${encodedQuery}`;
                case 'duckduckgo':
                    return `https://duckduckgo.com/?q=${encodedQuery}`;
                default:
                    return null;
            }
        }
    }); 