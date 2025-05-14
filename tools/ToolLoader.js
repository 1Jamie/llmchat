'use strict';

const { GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var ToolLoader = GObject.registerClass(
class ToolLoader extends GObject.Object {
    _init() {
        super._init();
        this.tools = new Map();
        this._availableTools = [];
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
                        // Import the module from our extension's imports.tools namespace
                        const toolModule = Me.imports.tools[toolName];
                        // Look for a Tool class export in the module
                        if (toolModule && toolModule.Tool) {
                            const tool = new toolModule.Tool();
                            this.tools.set(tool.name, tool);
                            
                            // Add to available tools list in the format expected by the system
                            this._availableTools.push({
                                name: tool.name,
                                description: tool.description,
                                parameters: tool.parameters
                            });
                            
                            log(`Loaded tool: ${tool.name} from ${name}`);
                        } else {
                            log(`No Tool class found in ${name}`);
                        }
                    } catch (e) {
                        logError(e, `Failed to load tool: ${name}`);
                    }
                }
            }
            enumerator.close(null);
            log(`Loaded ${this._availableTools.length} tools in total`);
        } catch (e) {
            logError(e, "Error loading tools");
        }
    }

    getTools() {
        return Array.from(this.tools.values());
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
        return this.tools.get(name);
    }
}); 