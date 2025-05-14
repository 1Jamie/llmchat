'use strict';

const { GObject, Gio, GLib, St, Shell } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class SystemContextTool extends BaseTool {
    _init() {
        super._init({
            name: 'system_context',
            description: 'Get system context information including windows, workspaces, system info, and clipboard content',
            category: 'system',
            parameters: {
                type: {
                    type: 'string',
                    enum: ['basic', 'window', 'workspace', 'system_info', 'clipboard', 'selection', 'detailed'],
                    description: 'Type of context information to retrieve'
                }
            }
        });
    }

    execute(params = {}) {
        const { type = 'basic' } = params;

        switch (type) {
            case 'basic':
                return this._getBasicContext();
            case 'window':
                return this._getWindowInfo();
            case 'workspace':
                return this._getWorkspaceInfo();
            case 'system_info':
                return this._getSystemInfo();
            case 'clipboard':
                return this._getClipboardContent();
            case 'selection':
                return this._getSelectedText();
            case 'detailed':
                return this._getDetailedContext();
            default:
                return { error: 'Invalid context type' };
        }
    }

    _getBasicContext() {
        try {
            const systemInfo = this._getBasicSystemInfo();
            const workspaceInfo = this._getWorkspaceInfo();
            const windowInfo = this._getWindowInfo();
            
            return {
                success: true,
                system_info: systemInfo,
                workspace: workspaceInfo.workspace,
                active_window: windowInfo.focused_window
            };
        } catch (error) {
            return { error: `Failed to get basic context: ${error.message}` };
        }
    }

    _getDetailedContext() {
        try {
            const basicContext = this._getBasicContext();
            const clipboardContent = this._getClipboardContent();
            const selectedText = this._getSelectedText();
            const detailedSystemInfo = this._getDetailedSystemInfo();
            const openWindows = this._getOpenWindows();
            const runningApps = this._getRunningApps();
            
            return {
                success: true,
                ...basicContext,
                clipboard: clipboardContent.content,
                selection: selectedText.text,
                detailed_system_info: detailedSystemInfo,
                windows: openWindows.windows,
                applications: runningApps.applications
            };
        } catch (error) {
            return { error: `Failed to get detailed context: ${error.message}` };
        }
    }

    _getWindowInfo() {
        try {
            const focusWindow = global.display.focus_window;
            let windowInfo = {
                focused_window: "No Active Window"
            };
            
            if (focusWindow && focusWindow.title) {
                const appInfo = Shell.WindowTracker.get_default().get_window_app(focusWindow);
                const appName = appInfo ? appInfo.get_name() : (focusWindow.get_wm_class() || 'Unknown');
                windowInfo.focused_window = `${focusWindow.title} (${appName})`;
                windowInfo.app_name = appName;
                windowInfo.title = focusWindow.title;
                windowInfo.minimized = focusWindow.minimized;
            }
            
            return {
                success: true,
                ...windowInfo
            };
        } catch (error) {
            return { error: `Failed to get window info: ${error.message}` };
        }
    }

    _getWorkspaceInfo() {
        try {
            if (!global.workspace_manager) {
                return { 
                    success: false,
                    error: 'Workspace manager not available',
                    workspace: "Unknown Workspace"
                };
            }
            
            const workspaceManager = global.workspace_manager;
            const activeWorkspace = workspaceManager.get_active_workspace();
            if (!activeWorkspace) {
                return { 
                    success: false,
                    error: 'Active workspace not available',
                    workspace: "Unknown Workspace"
                };
            }
            
            const workspaceIndex = activeWorkspace.index() + 1; // +1 for user-friendly numbering
            const numWorkspaces = workspaceManager.get_n_workspaces();
            
            // Count windows on current workspace
            let windowsOnWorkspace = 0;
            try {
                const windows = global.get_window_actors();
                for (const actor of windows) {
                    const win = actor.get_meta_window();
                    if (win && win.get_workspace() === activeWorkspace) {
                        windowsOnWorkspace++;
                    }
                }
            } catch (e) {
                log(`Error counting windows: ${e.message}`);
            }
            
            return {
                success: true,
                workspace: `Workspace ${workspaceIndex} of ${numWorkspaces}`,
                index: workspaceIndex,
                total: numWorkspaces,
                windows_count: windowsOnWorkspace
            };
        } catch (error) {
            return { error: `Failed to get workspace info: ${error.message}` };
        }
    }

    _getBasicSystemInfo() {
        try {
            const hostname = GLib.get_host_name();
            const username = GLib.get_user_name();
            const osName = GLib.get_os_info('PRETTY_NAME');
            
            // Get current date and time
            let now = GLib.DateTime.new_now_local();
            let dateTimeStr = now.format('%Y-%m-%d %H:%M:%S');
            
            return {
                hostname,
                username,
                os: osName,
                date_time: dateTimeStr
            };
        } catch (error) {
            return { error: `Failed to get system info: ${error.message}` };
        }
    }

    _getDetailedSystemInfo() {
        try {
            const basicInfo = this._getBasicSystemInfo();
            
            // Get memory info
            let memInfo = {};
            try {
                let [success, contents] = GLib.file_get_contents('/proc/meminfo');
                if (success) {
                    let memInfoStr = imports.byteArray.toString(contents);
                    let memTotal = memInfoStr.match(/MemTotal:\s+(\d+)/);
                    let memAvailable = memInfoStr.match(/MemAvailable:\s+(\d+)/);
                    
                    if (memTotal && memAvailable) {
                        let totalMB = Math.round(parseInt(memTotal[1]) / 1024);
                        let availableMB = Math.round(parseInt(memAvailable[1]) / 1024);
                        let usedMB = totalMB - availableMB;
                        let usagePercent = Math.round((usedMB / totalMB) * 100);
                        
                        memInfo = {
                            total_mb: totalMB,
                            available_mb: availableMB,
                            used_mb: usedMB,
                            usage_percent: usagePercent
                        };
                    }
                }
            } catch (e) {
                log(`Error getting memory info: ${e}`);
            }
            
            // Get CPU info
            let cpuInfo = {};
            try {
                let [success, contents] = GLib.file_get_contents('/proc/cpuinfo');
                if (success) {
                    let cpuInfoStr = imports.byteArray.toString(contents);
                    let modelName = cpuInfoStr.match(/model name\s+:\s+(.*)/);
                    let cpuCores = cpuInfoStr.match(/cpu cores\s+:\s+(\d+)/);
                    
                    if (modelName) {
                        cpuInfo.model = modelName[1];
                        if (cpuCores) {
                            cpuInfo.cores = parseInt(cpuCores[1]);
                        }
                    }
                }
            } catch (e) {
                log(`Error getting CPU info: ${e}`);
            }
            
            // Get kernel and uptime
            let kernelAndUptime = {};
            try {
                let [success1, stdout1, stderr1, exitCode1] = GLib.spawn_command_line_sync('uname -r');
                let [success2, stdout2, stderr2, exitCode2] = GLib.spawn_command_line_sync('uptime -p');
                
                if (success1 && exitCode1 === 0) {
                    kernelAndUptime.kernel = imports.byteArray.toString(stdout1).trim();
                }
                
                if (success2 && exitCode2 === 0) {
                    kernelAndUptime.uptime = imports.byteArray.toString(stdout2).trim();
                }
            } catch (e) {
                log(`Error getting kernel and uptime: ${e}`);
            }
            
            return {
                ...basicInfo,
                memory: memInfo,
                cpu: cpuInfo,
                kernel_uptime: kernelAndUptime
            };
        } catch (error) {
            return { error: `Failed to get detailed system info: ${error.message}` };
        }
    }

    _getClipboardContent() {
        try {
            // Try St.Clipboard first (works in most GNOME versions)
            const clipboard = St.Clipboard.get_default();
            let content = '';
            
            if (clipboard) {
                clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
                    if (text) content = text;
                });
                
                // If we got content, return it (truncated if too long)
                if (content) {
                    // Truncate if too long (more than 1000 chars)
                    if (content.length > 1000) {
                        return {
                            success: true,
                            content: content.substring(0, 1000),
                            truncated: true,
                            total_length: content.length
                        };
                    }
                    
                    return {
                        success: true,
                        content: content,
                        truncated: false
                    };
                }
            }
            
            return {
                success: true,
                content: "",
                empty: true
            };
        } catch (error) {
            return { error: `Failed to get clipboard content: ${error.message}` };
        }
    }

    _getSelectedText() {
        try {
            // Try primary selection first (most reliable in GNOME)
            const selection = Shell.Global.get().get_primary_selection();
            if (selection) {
                const text = selection.get_text();
                if (text) {
                    // Truncate if too long (more than 1000 chars)
                    const textStr = text.toString();
                    if (textStr.length > 1000) {
                        return {
                            success: true,
                            text: textStr.substring(0, 1000),
                            truncated: true,
                            total_length: textStr.length
                        };
                    }
                    
                    return {
                        success: true,
                        text: textStr,
                        truncated: false
                    };
                }
            }
            
            return {
                success: true,
                text: "",
                empty: true
            };
        } catch (error) {
            return { error: `Failed to get selected text: ${error.message}` };
        }
    }

    _getOpenWindows() {
        try {
            const windowList = [];
            
            // Try different methods to get windows
            let windows = [];
            try {
                // Method 1: Using window actors
                windows = global.get_window_actors().map(actor => actor.get_meta_window());
            } catch (e) {
                log(`Error with get_window_actors: ${e.message}`);
                try {
                    // Method 2: Using display.list_windows
                    windows = global.display.list_windows(0); // 0 means all windows
                } catch (e2) {
                    log(`Error with list_windows: ${e2.message}`);
                }
            }
            
            // Get active workspace
            let activeWorkspace = null;
            try {
                activeWorkspace = global.workspace_manager.get_active_workspace();
            } catch (e) {
                log(`Error getting active workspace: ${e.message}`);
            }
            
            // Process windows
            for (const window of windows) {
                try {
                    if (!window || !window.title || window.is_skip_taskbar()) {
                        continue; // Skip invalid or taskbar-skipped windows
                    }
                    
                    const appInfo = Shell.WindowTracker.get_default().get_window_app(window);
                    const appName = appInfo ? appInfo.get_name() : (window.get_wm_class() || 'Unknown');
                    
                    let onCurrentWorkspace = false;
                    let workspaceIndex = -1;
                    
                    try {
                        const windowWorkspace = window.get_workspace();
                        if (windowWorkspace) {
                            workspaceIndex = windowWorkspace.index() + 1;
                            onCurrentWorkspace = (activeWorkspace && windowWorkspace === activeWorkspace);
                        }
                    } catch (e) {
                        log(`Error getting window workspace: ${e.message}`);
                    }
                    
                    windowList.push({
                        title: window.title,
                        application: appName,
                        workspace: workspaceIndex,
                        on_current_workspace: onCurrentWorkspace,
                        minimized: window.minimized
                    });
                } catch (e) {
                    log(`Error processing window: ${e.message}`);
                }
            }
            
            return {
                success: true,
                windows: windowList,
                count: windowList.length
            };
        } catch (error) {
            return { error: `Failed to get open windows: ${error.message}` };
        }
    }

    _getRunningApps() {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const runningApps = appSystem.get_running();
            
            const appList = [];
            if (runningApps.length > 0) {
                runningApps.forEach(app => {
                    try {
                        appList.push({
                            name: app.get_name(),
                            id: app.get_id(),
                            windows_count: app.get_windows().length
                        });
                    } catch (e) {
                        log(`Error processing app: ${e.message}`);
                    }
                });
            }
            
            return {
                success: true,
                applications: appList,
                count: appList.length
            };
        } catch (error) {
            return { error: `Failed to get running applications: ${error.message}` };
        }
    }
}); 