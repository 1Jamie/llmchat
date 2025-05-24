'use strict';

const { GObject, Gio } = imports.gi;
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

        try {
            // Load tool descriptions from memory service first
            const memoryDescriptions = await this._getToolDescriptions();
            if (memoryDescriptions && memoryDescriptions.length > 0) {
                log(`Loaded ${memoryDescriptions.length} tool descriptions from memory service`);
                await this._indexToolDescriptions(memoryDescriptions);
                return;
            }

            // If no descriptions found in memory service, load from local files
            const toolsDir = Gio.File.new_for_path(this._toolsDir);
            if (!toolsDir.query_exists(null)) {
                log(`Tools directory does not exist: ${this._toolsDir}`);
                return;
            }

            const enumerator = toolsDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let fileInfo;
            const localDescriptions = [];

            while ((fileInfo = enumerator.next_file(null))) {
                const fileName = fileInfo.get_name();
                if (fileName.endsWith('.js') && fileName !== 'BaseTool.js') {
                    const toolPath = `${this._toolsDir}/${fileName}`;
                    try {
                        const toolModule = await import(toolPath);
                        if (toolModule.default && toolModule.default.prototype instanceof BaseTool) {
                            const tool = new toolModule.default();
                            if (tool.getDescription) {
                                const description = tool.getDescription();
                                localDescriptions.push(description);
                            }
                        }
                    } catch (e) {
                        log(`Error loading tool ${fileName}: ${e.message}`);
                    }
                }
            }

            if (localDescriptions.length > 0) {
                log(`Loaded ${localDescriptions.length} tool descriptions from local files`);
                await this._indexToolDescriptions(localDescriptions);
            } else {
                log('No tool descriptions found in local files');
            }
        } catch (e) {
            log(`Error in _loadTools: ${e.message}`);
        }
    }

    async _indexToolDescriptions(descriptions) {
        if (!this._memoryService || !this._memoryService._initialized) {
            log('Memory service not ready, cannot index tool descriptions');
            return;
        }

        try {
            // Clear existing tool descriptions
            await this._memoryService.clearNamespace('tools');

            // Index each tool description
            for (const description of descriptions) {
                try {
                    await this._memoryService.indexMemory({
                        text: description.description,
                        metadata: {
                            type: 'tool_description',
                            name: description.name,
                            category: description.category || 'general',
                            parameters: description.parameters || {}
                        },
                        namespace: 'tools'
                    });
                } catch (e) {
                    log(`Error indexing tool description for ${description.name}: ${e.message}`);
                }
            }
            log('Successfully indexed tool descriptions');
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
                            if (this._memoryService) {
                                tool.setMemoryService(this._memoryService);
                            }
                            this._tools.set(tool.name, tool);
                            this._availableTools.push({
                                name: tool.name,
                                description: tool.description,
                                parameters: tool.parameters
                            });
                        }
                    } catch (e) {
                        logError(e, `Failed to load tool: ${name}`);
                    }
                }
            }
            enumerator.close(null);
            log(`Loaded ${this._availableTools.length} tools`);
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