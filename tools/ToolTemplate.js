'use strict';

const { GObject, Gio, GLib, St } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

/**
 * This is a template for creating new tools for the LLM Chat extension.
 * 
 * To create a new tool:
 * 1. Copy this file to a new file in the tools directory (e.g., MyTool.js)
 * 2. Rename the class to your tool's name
 * 3. Fill in the parameters in _init()
 * 4. Implement the execute() method
 * 5. The extension will automatically load your tool when it starts
 *
 * Important notes:
 * - Make sure to export your class as "Tool" (the variable name must be exactly "Tool")
 * - Always extend BaseTool
 * - The name property should be unique and follow the pattern 'tool_name' (lowercase with underscores)
 * - Handle errors gracefully and return clear error messages
 * - Return useful data in a structured format
 */
var Tool = GObject.registerClass(
class ToolTemplate extends BaseTool {
    _init() {
        super._init({
            // Unique name for the tool (used when the AI calls it)
            // Use lowercase with underscores: 'my_tool_name'
            name: 'template_tool',
            
            // Clear description of what the tool does (will be shown to the AI)
            description: 'Template tool for demonstration purposes. Replace with actual functionality.',
            
            // Category to group the tool in (use existing categories when possible)
            // Options: system, window, workspace, application, web, utility, display, custom
            category: 'custom',
            
            // Define parameters that the tool accepts
            // Each parameter should have a type and description
            parameters: {
                // Simple string parameter
                text_input: {
                    type: 'string',
                    description: 'Text to process'
                },
                
                // Number parameter
                count: {
                    type: 'integer',
                    description: 'Number of items to process'
                },
                
                // Boolean parameter
                enable_feature: {
                    type: 'boolean',
                    description: 'Whether to enable a specific feature'
                },
                
                // Parameter with specific allowed values (enum)
                action: {
                    type: 'string',
                    enum: ['create', 'read', 'update', 'delete'],
                    description: 'Action to perform'
                },
                
                // Optional parameter
                optional_param: {
                    type: 'string',
                    description: 'An optional parameter that has a default value',
                    optional: true
                }
            }
        });
    }

    /**
     * Execute the tool with the provided parameters
     * 
     * @param {Object} params - Parameters passed to the tool
     * @returns {Object} - Result of the tool execution
     */
    execute(params = {}) {
        // Extract parameters with defaults for optional ones
        const { 
            text_input, 
            count = 1, 
            enable_feature = false, 
            action = 'read',
            optional_param = 'default value'
        } = params;
        
        // Validate required parameters
        if (!text_input) {
            return { error: 'text_input parameter is required' };
        }
        
        try {
            // Log for debugging (will appear in journalctl for the GNOME Shell)
            log(`Executing template tool with text: ${text_input}, count: ${count}, action: ${action}`);
            
            // Example of different actions based on the 'action' parameter
            let result;
            switch (action) {
                case 'create':
                    result = this._createSomething(text_input, count);
                    break;
                case 'read':
                    result = this._readSomething(text_input);
                    break;
                case 'update':
                    result = this._updateSomething(text_input, enable_feature);
                    break;
                case 'delete':
                    result = this._deleteSomething(text_input);
                    break;
                default:
                    return { error: `Invalid action: ${action}` };
            }
            
            // Return successful result with data
            return { 
                success: true,
                action: action,
                result: result,
                // Include any other useful information
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            // Log error and return error message
            log(`Error in template tool: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
            return { 
                error: `Failed to execute tool: ${error.message}`
            };
        }
    }
    
    // Example of breaking down functionality into helper methods
    
    _createSomething(text, count) {
        // Example implementation
        return `Created ${count} item(s) with text: ${text}`;
    }
    
    _readSomething(text) {
        // Example implementation
        return `Read item with text: ${text}`;
    }
    
    _updateSomething(text, enableFeature) {
        // Example implementation
        return `Updated item with text: ${text}, feature ${enableFeature ? 'enabled' : 'disabled'}`;
    }
    
    _deleteSomething(text) {
        // Example implementation
        return `Deleted item with text: ${text}`;
    }
}); 