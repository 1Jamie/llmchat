'use strict';

const { GObject, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class WorkspaceManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'workspace_management',
            description: 'Manage workspaces including switching, creating, and removing',
            category: 'workspace',
            parameters: {
                action: {
                    type: 'string',
                    enum: ['switch', 'create', 'remove', 'list'],
                    description: 'Workspace action to perform'
                },
                index: {
                    type: 'integer',
                    description: 'Workspace index (starting from 1)'
                }
            }
        });
        
        this._workspaceManager = global.workspace_manager;
    }

    execute(params = {}) {
        const { action, index } = params;

        switch (action) {
            case 'switch':
                if (typeof index !== 'number' || index < 1) {
                    return { error: 'Valid workspace index (starting from 1) is required' };
                }
                return this._switchWorkspace(index);
            case 'create':
                return this._createWorkspace();
            case 'remove':
                if (typeof index !== 'number' || index < 1) {
                    return { error: 'Valid workspace index (starting from 1) is required' };
                }
                return this._removeWorkspace(index);
            case 'list':
                return this._listWorkspaces();
            default:
                return { error: 'Invalid workspace management action' };
        }
    }

    _switchWorkspace(index) {
        try {
            log(`Attempting to switch to workspace ${index}`);
            
            const workspace = this._workspaceManager.get_workspace_by_index(index - 1);
            if (!workspace) {
                log(`Failed to find workspace ${index}`);
                return { 
                    error: `Workspace ${index} not found. Available workspaces: 1-${this._workspaceManager.get_n_workspaces()}`
                };
            }
            
            workspace.activate(global.get_current_time());
            log(`Successfully switched to workspace ${index}`);
            
            return {
                success: true,
                workspace_index: index,
                message: `Switched to workspace ${index}`
            };
        } catch (error) {
            log(`Error switching workspace: ${error.message}`);
            return { error: `Failed to switch workspace: ${error.message}` };
        }
    }

    _createWorkspace() {
        try {
            const newIndex = this._workspaceManager.get_n_workspaces();
            this._workspaceManager.append_new_workspace(false, global.get_current_time());
            
            const newWorkspaceIndex = newIndex + 1; // User-friendly index (1-based)
            log(`Created new workspace at index ${newWorkspaceIndex}`);
            
            return {
                success: true,
                workspace_index: newWorkspaceIndex,
                message: `Created new workspace at index ${newWorkspaceIndex}`
            };
        } catch (error) {
            log(`Error creating workspace: ${error.message}`);
            return { error: `Failed to create workspace: ${error.message}` };
        }
    }

    _removeWorkspace(index) {
        try {
            const workspace = this._workspaceManager.get_workspace_by_index(index - 1);
            if (!workspace) {
                log(`Failed to find workspace ${index}`);
                return { 
                    error: `Workspace ${index} not found. Available workspaces: 1-${this._workspaceManager.get_n_workspaces()}`
                };
            }
            
            // Check if this is the last workspace
            if (this._workspaceManager.get_n_workspaces() <= 1) {
                return { error: "Cannot remove the last workspace" };
            }
            
            this._workspaceManager.remove_workspace(workspace, global.get_current_time());
            log(`Removed workspace ${index}`);
            
            return {
                success: true,
                workspace_index: index,
                message: `Removed workspace ${index}`
            };
        } catch (error) {
            log(`Error removing workspace: ${error.message}`);
            return { error: `Failed to remove workspace: ${error.message}` };
        }
    }

    _listWorkspaces() {
        try {
            const count = this._workspaceManager.get_n_workspaces();
            const activeIndex = this._workspaceManager.get_active_workspace_index() + 1; // User-friendly index (1-based)
            
            const workspaces = [];
            for (let i = 0; i < count; i++) {
                const workspace = this._workspaceManager.get_workspace_by_index(i);
                const windowCount = workspace.list_windows().length;
                
                workspaces.push({
                    index: i + 1, // User-friendly index (1-based)
                    is_active: (i + 1) === activeIndex,
                    window_count: windowCount
                });
            }
            
            return {
                success: true,
                workspaces,
                active_workspace: activeIndex,
                total_workspaces: count
            };
        } catch (error) {
            log(`Error listing workspaces: ${error.message}`);
            return { error: `Failed to list workspaces: ${error.message}` };
        }
    }
}); 