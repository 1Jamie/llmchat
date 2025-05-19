'use strict';

const { GObject, GLib, Shell } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

var Tool = GObject.registerClass(
class WorkspaceManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'workspace_management',
            description: 'Manage workspaces including switching, creating, and removing. Provides detailed application information per workspace.',
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
        this._windowTracker = Shell.WindowTracker.get_default();
        
        // Log initialization with capabilities
        log('WorkspaceManagementTool initialized with the following capabilities:');
        log('1. Switch between workspaces by index');
        log('2. Create new workspaces');
        log('3. Remove existing workspaces');
        log('4. List all workspaces with detailed application information');
        log('5. Enhanced detection of applications per workspace');
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
                const windows = workspace.list_windows();
                const windowCount = windows.length;
                
                // Build list of applications in this workspace
                const apps = [];
                const appDict = {};
                
                windows.forEach(win => {
                    if (!win || win.is_skip_taskbar()) return;
                    
                    const app = this._windowTracker.get_window_app(win);
                    if (!app) return;
                    
                    const appId = app.get_id();
                    const title = win.get_title();
                    
                    if (!appDict[appId]) {
                        appDict[appId] = {
                            name: app.get_name(),
                            id: appId,
                            windows: []
                        };
                    }
                    
                    appDict[appId].windows.push({
                        title: title || 'Untitled Window',
                        active: win.has_focus()
                    });
                });
                
                // Convert to array
                for (const id in appDict) {
                    apps.push(appDict[id]);
                }
                
                // Create formatted list for display
                let formattedAppList = '';
                if (apps.length > 0) {
                    apps.forEach((app, index) => {
                        formattedAppList += `${index + 1}. ${app.name} (${app.windows.length} window${app.windows.length > 1 ? 's' : ''})\n`;
                        app.windows.forEach(win => {
                            formattedAppList += `   • "${win.title}"${win.active ? ' (Active)' : ''}\n`;
                        });
                    });
                } else {
                    formattedAppList = 'No applications running in this workspace.';
                }
                
                workspaces.push({
                    index: i + 1, // User-friendly index (1-based)
                    is_active: (i + 1) === activeIndex,
                    window_count: windowCount,
                    applications: apps,
                    app_count: apps.length,
                    formatted_apps: formattedAppList
                });
            }
            
            // Create a nicely formatted overview of all workspaces
            let formattedWorkspaceList = 'Workspace Summary:\n\n';
            workspaces.forEach(ws => {
                formattedWorkspaceList += `Workspace ${ws.index}${ws.is_active ? ' (Active)' : ''}:\n`;
                formattedWorkspaceList += `${ws.app_count} applications, ${ws.window_count} windows\n`;
                formattedWorkspaceList += ws.formatted_apps;
                formattedWorkspaceList += '\n';
            });
            
            return {
                success: true,
                workspaces,
                active_workspace: activeIndex,
                total_workspaces: count,
                formatted_list: formattedWorkspaceList
            };
        } catch (error) {
            log(`Error listing workspaces: ${error.message}`);
            return { error: `Failed to list workspaces: ${error.message}` };
        }
    }
}); 