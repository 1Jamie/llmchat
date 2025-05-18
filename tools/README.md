# LLM Chat GNOME Shell Extension Tools

This directory contains tool modules for the LLM Chat GNOME Shell extension. Tools provide functionality that can be accessed through the AI assistant interface, allowing it to interact with your system and perform various operations.

## How Tools Work

Each tool is a separate JavaScript file that exports a class called `Tool` which extends `BaseTool`. The extension automatically loads all `.js` files in this directory (except for special files like BaseTool.js, ToolLoader.js, and ToolTemplate.js) and makes them available to be called from the AI assistant.

When the user enables tool calling in the chat interface, the assistant can use these tools to perform actions when needed, rather than just providing text responses.

## Creating Your Own Tool

To create a new tool:

1. Copy `ToolTemplate.js` to a new file with a descriptive name (e.g., `MyAwesomeTool.js`)
2. Edit the new file:
   - Rename the class to match your tool's purpose
   - Set a unique `name` for your tool (this is what will be used to call it)
   - Fill in the `description` and `category`
   - Define any parameters your tool will accept
   - Implement the `execute()` method with your tool's logic
3. Save the file in this directory
4. The extension will automatically load your tool the next time it starts

## Tool Structure

Each tool file should follow this structure:

```javascript
'use strict';

const { GObject, Gio /* Add other imports from imports.gi as needed */ } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

// Export the class as "Tool" for automatic loading
var Tool = GObject.registerClass(
class MyToolName extends BaseTool {
    _init() {
        super._init({
            name: 'my_tool_name',
            description: 'What my tool does',
            category: 'category_name',
            parameters: {
                // Define parameters here
                parameter1: {
                    type: 'string',
                    description: 'Description of parameter1'
                }
            }
        });
    }

    execute(params = {}) {
        // Access parameters 
        const { parameter1 } = params;
        
        try {
            // Implement tool logic here
            
            // Return success result with data
            return { 
                success: true,
                // Add any relevant data in the response
                result: 'Tool executed successfully' 
            };
        } catch (error) {
            // Return error message if something goes wrong
            return { error: `Failed to execute tool: ${error.message}` };
        }
    }
});
```

## Parameter Types

Your tool can accept various parameter types:

- `string`: Text values
- `integer` or `number`: Numeric values
- `boolean`: True/false values
- `object`: Complex data structures
- `enum`: Values from a specific list of options (include an `enum` array with allowed values)

Example of enum parameter:
```javascript
action: {
    type: 'string',
    enum: ['create', 'delete', 'update'],
    description: 'Action to perform'
}
```

## Return Values

Tools should return an object with either:

- A successful result: Include `success: true` and any relevant data
- An error result: Include `error: 'Error message'` 

The result format should be consistent and well-structured to make it easy for the AI assistant to interpret and use the results.

## Important Notes

- Your tool file must export a class called `Tool` (the variable name must be exactly `Tool`)
- The tool must extend `BaseTool` using `Me.imports.tools.BaseTool`
- Each tool must have a unique `name` property
- Keep tools focused on a single responsibility
- Handle errors gracefully and provide helpful error messages
- Consider security implications - tools have access to system functionality

## Available Tools

Currently available tools include:

- `WebSearchTool`: Perform web searches
- `ApplicationManagementTool`: Launch and manage applications
- `TimeDateTool`: Get current time, date, and timezone information  
- `DisplayManagementTool`: Manage display settings like brightness
- `SystemSettingsTool`: Control system settings like night light
- `SystemContextTool`: Get information about system context, windows, and workspace

## Tool Categories

Current tool categories:

- `system`: System information and settings (SystemContextTool, SystemSettingsTool)
- `window`: Window management functionality
- `workspace`: Workspace management
- `application`: Application launching and management
- `web`: Web-related functionality (WebSearchTool)
- `utility`: Misc. utility functions
- `display`: Display and screen settings
- `custom`: Your custom tools

You can create new categories as needed, but try to use existing ones where appropriate for consistency.

## Adding Tool Dependencies

If your tool requires external libraries, you should use GJS imports and GNOME platform libraries. Avoid trying to use Node.js-style `require()` since GNOME Shell doesn't support this.

For GNOME libraries, import them from `imports.gi`:

```javascript
const { GObject, Gio, GLib, Gtk, Shell } = imports.gi;
```

For extension components, use:

```javascript
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
```

## Confirmation for Dangerous Actions

Some tools may perform dangerous or destructive actions (such as deleting files, overwriting data, or changing system settings). To protect users, tools should implement a confirmation system:

- Add a `confirm` parameter (boolean) to your tool's parameters.
- In your `execute()` method, check if the action is dangerous (e.g., `delete`) and if `confirm` is not true.
- If confirmation is needed, return an object like this:
  ```js
  return {
      confirmation_required: true,
      summary: '⚠️ Confirmation required for dangerous action.\nAction: delete\nTarget: ...',
      params: { ...params, confirm: true }
  };
  ```
- The UI will show an inline confirmation prompt. Only after the user confirms will the tool be executed with `confirm: true`.
- On success or error, always return a user-friendly `message` property in your result object.

### Example (in your tool's execute method):
```js
if (action === 'delete' && !confirm) {
    return {
        confirmation_required: true,
        summary: `⚠️ Confirmation required for dangerous action.\nAction: delete\nTarget: ${text_input}`,
        params: { ...params, confirm: true }
    };
}
```

On success:
```js
return {
    success: true,
    action,
    result,
    message: `✅ Action '${action}' succeeded on ${text_input}`
};
```
On error:
```js
return {
    success: false,
    action,
    result: null,
    message: `❌ Action '${action}' failed on ${text_input}: ${error.message}`,
    error: `Failed to execute tool: ${error.message}`
};
```

The extension will handle confirmation dialogs and only execute the tool after the user approves. 