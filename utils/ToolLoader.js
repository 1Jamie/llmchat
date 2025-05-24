'use strict';

const { GObject, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

var ToolLoader = GObject.registerClass(
class ToolLoader extends GObject.Object {
    _init() {
        super._init();
        this._tools = new Map();
        this._memoryService = null;
        this._availableTools = [];
        this._toolsDir = null;
    }

    initialize(toolsPath) {
        if (!toolsPath) {
            throw new Error('Tools path is required for initialization');
        }
        this._toolsDir = toolsPath;
        log(`ToolLoader initialized with path: ${toolsPath}`);
    }

    setMemoryService(memoryService) {
        this._memoryService = memoryService;
        if (memoryService) {
            memoryService.addInitializationListener(() => {
                this._loadTools();
            });
        }
    }

    getMemoryService() {
        return this._memoryService;
    }

    async _loadTools() {
        if (!this._memoryService || !this._memoryService._initialized) {
            log('Memory service not ready, deferring tool loading');
            return;
        }

        // Wait a bit for the model to be fully loaded after initialization
        await new Promise(resolve => {
            setTimeout(resolve, 2000); // Use setTimeout instead of GLib.timeout_add
        });

        try {
            // First, make sure we have tools loaded locally
            if (this._tools.size === 0) {
                log('No tools loaded locally, calling loadTools first');
                this.loadTools();
            }

            // Get currently indexed tools
            let indexedTools = new Set();
            try {
                const memoryDescriptions = await this._getToolDescriptions();
                if (memoryDescriptions && memoryDescriptions.length > 0) {
                    log(`Found ${memoryDescriptions.length} tool descriptions already in memory service`);
                    indexedTools = new Set(memoryDescriptions.map(d => d.name));
                }
            } catch (e) {
                log(`Could not check existing tools in memory (model may still be loading): ${e.message}`);
                // Continue with loading anyway
            }

            // Convert our loaded tools to descriptions for indexing
            const toolDescriptions = [];
            for (const tool of this._tools.values()) {
                if (!tool.name || !tool.description) {
                    log(`Skipping tool with missing name or description: ${JSON.stringify(tool)}`);
                    continue;
                }
                
                // Only add tools that aren't already indexed
                if (!indexedTools.has(tool.name)) {
                    log(`Tool ${tool.name} is not indexed, will be added`);
                    toolDescriptions.push({
                        name: tool.name,
                        description: tool.description,
                        category: tool.category || 'general',
                        parameters: tool.parameters || {},
                        keywords: tool.keywords || []
                    });
                } else {
                    log(`Tool ${tool.name} is already indexed, skipping`);
                }
            }

            if (toolDescriptions.length > 0) {
                log(`Loading ${toolDescriptions.length} new tool descriptions into memory service`);
                await this._indexToolDescriptions(toolDescriptions);
            } else {
                log('No new tool descriptions to load into memory');
            }
        } catch (e) {
            log(`Error in _loadTools: ${e.message}`);
            log(`Stack trace: ${e.stack}`);
        }
    }

    async _indexToolDescriptions(descriptions) {
        if (!this._memoryService || !this._memoryService._initialized) {
            log('Memory service not ready, cannot index tool descriptions');
            return;
        }

        try {
            log(`Indexing ${descriptions.length} tool descriptions into memory service`);
            
            // Use the memory service's loadToolDescriptions method
            await this._memoryService.loadToolDescriptions(descriptions);
            log('Successfully indexed tool descriptions into memory service');
        } catch (e) {
            log(`Error in _indexToolDescriptions: ${e.message}`);
        }
    }

    async _getToolDescriptions() {
        if (!this._memoryService || !this._memoryService._initialized) {
            log('Memory service not ready, cannot get tool descriptions');
            return [];
        }

        try {
            // Try to get tool descriptions from memory service
            const descriptions = await this._memoryService.getRelevantToolDescriptions('all tools', 100);
            if (descriptions && descriptions.length > 0) {
                return descriptions;
            }
            return [];
        } catch (e) {
            log(`Error getting tool descriptions: ${e.message}`);
            return [];
        }
    }

    loadTools() {
        try {
            const toolsDir = Gio.File.new_for_path(Me.path).get_child('tools');
            const enumerator = toolsDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            
            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                if (name.endsWith('.js') && name !== 'BaseTool.js' && name !== 'ToolLoader.js' && name !== 'index.js' && name !== 'ToolTemplate.js' && name !== 'README.md') {
                    try {
                        const toolName = name.slice(0, -3);
                        const toolModule = Me.imports.tools[toolName];
                        if (toolModule && toolModule.Tool) {
                            const tool = new toolModule.Tool();
                            if (!tool.name || !tool.description) {
                                log(`Skipping tool ${name} with missing name or description`);
                                continue;
                            }
                            if (this._memoryService) {
                                tool.setMemoryService(this._memoryService);
                            }
                            this._tools.set(tool.name, tool);
                            this._availableTools.push({
                                name: tool.name,
                                description: tool.description,
                                parameters: tool.parameters
                            });
                            log(`Successfully loaded tool: ${tool.name}`);
                        } else {
                            log(`Tool module ${toolName} does not export a Tool class`);
                        }
                    } catch (e) {
                        logError(e, `Failed to load tool: ${name}`);
                    }
                }
            }
            enumerator.close(null);
            log(`Loaded ${this._availableTools.length} tools: ${this._availableTools.map(t => t.name).join(', ')}`);
        } catch (e) {
            logError(e, "Error loading tools");
        }
    }

    getTools() {
        return Array.from(this._tools.values());
    }

    getToolsAsSchemaArray() {
        return this._availableTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            type: 'function',  // Required by LlamaCPP
            parameters: {
                type: 'object',  // Required by OpenAI function calling format
                properties: tool.parameters,
                required: Object.keys(tool.parameters).filter(param => 
                    !tool.parameters[param].optional
                )
            }
        }));
    }

    getTool(name) {
        return this._tools.get(name);
    }
}); 