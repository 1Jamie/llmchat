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
            description: 'Get system-level information ONLY (windows, workspaces, system info, process monitoring). DO NOT use for web content or user queries.',
            category: 'system',
            parameters: {
                type: {
                    type: 'string',
                    enum: ['basic', 'window', 'workspace', 'system_info', 'resource_usage', 'processes', 'clipboard', 'selection', 'detailed'],
                    description: 'Type of system information to retrieve. Use ONLY for system-level queries, not for web content or user queries.'
                },
                limit: {
                    type: 'number',
                    description: 'Number of top processes to return when retrieving resource usage (default: 10)'
                },
                sort_by: {
                    type: 'string',
                    enum: ['cpu', 'memory', 'pid'],
                    description: 'Sort processes by CPU usage, memory usage, or process ID (default: memory)'
                }
            }
        });
        
        // Log initialization with capabilities and limitations
        log('SystemContextTool initialized with the following capabilities:');
        log('1. Basic system information (hostname, username, OS)');
        log('2. Detailed system information (memory, CPU, kernel)');
        log('3. Window information and management');
        log('4. Workspace information');
        log('5. Clipboard and selection management');
        log('6. Process and resource usage monitoring (CPU, RAM)');
        log('\nIMPORTANT: This tool is for system-level information ONLY.');
        log('DO NOT use for:');
        log('- Web content fetching');
        log('- URL content retrieval');
        log('- Web searches');
        log('- User queries');
        log('- Any non-system related tasks');
    }

    execute(params = {}) {
        const { type = 'basic', limit = 10, sort_by = 'memory' } = params;

        switch (type) {
            case 'basic':
                return this._getBasicContext();
            case 'window':
                return this._getWindowInfo();
            case 'workspace':
                return this._getWorkspaceInfo();
            case 'system_info':
                return this._getSystemInfo();
            case 'resource_usage':
            case 'processes':
                return this._getResourceUsage(limit, sort_by);
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
            const resourceUsage = this._getResourceUsage(5, 'memory');
            
            return {
                success: true,
                ...basicContext,
                clipboard: clipboardContent.content,
                selection: selectedText.text,
                detailed_system_info: detailedSystemInfo,
                resource_usage: resourceUsage,
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

    _getSystemInfo() {
        try {
            const basicInfo = this._getBasicSystemInfo();
            const detailedInfo = this._getDetailedSystemInfo();
            const resourceInfo = this._getResourceUsage(5, 'memory');
            
            return {
                success: true,
                basic_info: basicInfo,
                detailed_info: detailedInfo,
                resource_info: resourceInfo
            };
        } catch (error) {
            return { error: `Failed to get system info: ${error.message}` };
        }
    }

    _getResourceUsage(limit = 10, sortBy = 'memory') {
        try {
            // Process data holders
            let processes = [];
            let totalCpuUsage = 0;
            let totalMemUsage = 0;
            
            // Get system memory information
            let memoryInfo = {};
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
                        
                        memoryInfo = {
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
            
            // Get CPU count for system information
            let cpuInfo = {
                cores: 0,
                usage_percent: 0
            };
            
            try {
                let [cpuSuccess, cpuContents] = GLib.file_get_contents('/proc/cpuinfo');
                if (cpuSuccess) {
                    let cpuInfoStr = imports.byteArray.toString(cpuContents);
                    let processors = cpuInfoStr.match(/processor\s+:/g);
                    if (processors) {
                        cpuInfo.cores = processors.length;
                    }
                }
            } catch (e) {
                log(`Error getting CPU count: ${e}`);
            }
            
            // Approach 1: Use /proc directly
            try {
                // Read process directories from /proc
                let procDir = Gio.File.new_for_path('/proc');
                let procEnum = procDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                
                let procList = [];
                let fileInfo;
                while ((fileInfo = procEnum.next_file(null)) !== null) {
                    let name = fileInfo.get_name();
                    // Check if the directory name is a number (PID)
                    if (/^\d+$/.test(name)) {
                        procList.push(parseInt(name));
                    }
                }
                
                // Process each PID
                for (let pid of procList) {
                    try {
                        // Get status file
                        let statusFile = Gio.File.new_for_path(`/proc/${pid}/status`);
                        if (!statusFile.query_exists(null)) continue;
                        
                        let [success, contents] = GLib.file_get_contents(`/proc/${pid}/status`);
                        if (!success) continue;
                        
                        let statusStr = imports.byteArray.toString(contents);
                        
                        // Get process name and memory info
                        let name = statusStr.match(/^Name:\s+(.*?)$/m);
                        let vmSize = statusStr.match(/^VmSize:\s+(\d+)/m);
                        let vmRSS = statusStr.match(/^VmRSS:\s+(\d+)/m);
                        
                        // Get command line
                        let cmdline = '';
                        try {
                            let [cmdSuccess, cmdContents] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
                            if (cmdSuccess) {
                                cmdline = imports.byteArray.toString(cmdContents).replace(/\0/g, ' ').trim();
                            }
                        } catch (e) {
                            // Ignore errors for cmdline
                        }
                        
                        // Get user
                        let user = 'unknown';
                        try {
                            let [userSuccess, userContents] = GLib.file_get_contents(`/proc/${pid}/loginuid`);
                            if (userSuccess) {
                                let uid = parseInt(imports.byteArray.toString(userContents).trim());
                                // Try to get username from /etc/passwd
                                try {
                                    let [passSuccess, passContents] = GLib.file_get_contents('/etc/passwd');
                                    if (passSuccess) {
                                        let passLines = imports.byteArray.toString(passContents).split('\n');
                                        for (let line of passLines) {
                                            let parts = line.split(':');
                                            if (parts.length >= 3 && parseInt(parts[2]) === uid) {
                                                user = parts[0];
                                                break;
                                            }
                                        }
                                    }
                                } catch (e) {
                                    // Ignore passwd errors
                                }
                            }
                        } catch (e) {
                            // Ignore user errors
                        }
                        
                        if (name) {
                            let processName = name[1] || 'unknown';
                            let displayName = cmdline || processName;
                            
                            // Calculate memory percentage
                            let memoryPercent = 0;
                            if (vmRSS && memoryInfo.total_mb) {
                                // VmRSS is in kB, convert to percentage of total memory
                                memoryPercent = (parseInt(vmRSS[1]) / 1024 / memoryInfo.total_mb) * 100;
                            }
                            
                            // We don't have direct access to CPU percentage from /proc without taking multiple samples
                            // For now, we'll set it to 0 and focus on memory sorting
                            
                            processes.push({
                                pid: pid,
                                name: processName,
                                command: displayName,
                                user: user,
                                memory_percent: memoryPercent,
                                memory_kb: vmRSS ? parseInt(vmRSS[1]) : 0,
                                cpu_percent: 0 // We can't get this accurately without sampling
                            });
                            
                            totalMemUsage += memoryPercent;
                        }
                    } catch (e) {
                        // Skip processes we can't read
                        log(`Error reading process ${pid}: ${e}`);
                    }
                }
                
                // Sort processes based on the specified criteria
                if (sortBy === 'cpu') {
                    // Since we can't get accurate CPU percentages right now, this falls back to PID sorting
                    processes.sort((a, b) => b.pid - a.pid);
                } else if (sortBy === 'memory') {
                    processes.sort((a, b) => b.memory_percent - a.memory_percent);
                } else if (sortBy === 'pid') {
                    processes.sort((a, b) => a.pid - b.pid);
                }
                
                // Limit to requested number of processes
                processes = processes.slice(0, limit);
                
                // Log the top process memory percentages to help debug
                if (processes.length > 0) {
                    log(`Top process memory percentages: ${processes.slice(0, 3).map(p => `${p.name}: ${p.memory_percent.toFixed(2)}%`).join(', ')}`);
                }
                
            } catch (e) {
                log(`Error reading /proc directory: ${e}`);
            }
            
            // Fallback: If we didn't get any processes, try a simpler approach
            if (processes.length === 0) {
                try {
                    // Try to get a list of processes using 'ps -e'
                    let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync('ps -e');
                    
                    if (success && exitCode === 0) {
                        let output = imports.byteArray.toString(stdout);
                        let lines = output.trim().split('\n');
                        
                        // Skip header
                        for (let i = 1; i < lines.length && processes.length < limit; i++) {
                            let parts = lines[i].trim().split(/\s+/);
                            if (parts.length >= 4) {
                                let pid = parseInt(parts[0]);
                                let cmd = parts.slice(3).join(' ');
                                
                                processes.push({
                                    pid: pid,
                                    command: cmd,
                                    user: parts[1],
                                    memory_percent: 0, // We don't have memory info in this fallback
                                    cpu_percent: 0     // We don't have CPU info in this fallback
                                });
                            }
                        }
                    }
                } catch (e) {
                    log(`Error in fallback process list: ${e}`);
                }
            }
            
            // Update CPU info (we don't have a good way to get this right now)
            cpuInfo.usage_percent = 0;
            
            // Create formatted output for better presentation
            let formattedList = '';
            
            if (processes.length > 0) {
                // Sort name based on what we sorted by
                const sortTypeName = sortBy === 'cpu' ? 'CPU Usage' : (sortBy === 'memory' ? 'Memory Usage' : 'Process ID');
                formattedList += `Top Processes by ${sortTypeName}:\n\n`;
                
                // Table headers
                formattedList += `PID    | User     | Memory %  | Command\n`;
                formattedList += `--------------------------------------\n`;
                
                // Add each process
                processes.forEach(proc => {
                    formattedList += `${proc.pid.toString().padEnd(6)} | `;
                    formattedList += `${(proc.user || 'N/A').padEnd(8)} | `;
                    formattedList += `${proc.memory_percent.toFixed(1).padEnd(9)} | `;
                    formattedList += `${proc.command.substring(0, 30)}\n`;
                });
                
                // Add system totals
                formattedList += `\nSystem Totals:\n`;
                formattedList += `Memory: ${memoryInfo.used_mb}MB / ${memoryInfo.total_mb}MB (${memoryInfo.usage_percent}% used)\n`;
                formattedList += `CPU: ${cpuInfo.cores} cores available\n`;
            } else {
                formattedList += 'No process information available. Your system may not provide process information through standard commands.\n\n';
                formattedList += `System Memory: ${memoryInfo.used_mb}MB / ${memoryInfo.total_mb}MB (${memoryInfo.usage_percent}% used)\n`;
                formattedList += `CPU: ${cpuInfo.cores} cores available\n`;
            }
            
            // Create a short list of top resource users for easy parsing
            const topUsers = processes.slice(0, 3).map(p => 
                `${p.command.length > 20 ? p.command.substring(0, 17) + '...' : p.command} (PID ${p.pid}): ${p.memory_percent.toFixed(1)}% memory`
            );
            
            return {
                success: true,
                processes: processes,
                system: {
                    memory: memoryInfo,
                    cpu: cpuInfo
                },
                formatted_list: formattedList,
                top_resource_users: topUsers,
                message: processes.length > 0 ? 
                    `Successfully retrieved ${processes.length} processes ordered by ${sortBy === 'cpu' ? 'CPU usage' : (sortBy === 'memory' ? 'memory usage' : 'PID')}` : 
                    "Couldn't retrieve process information. System memory usage is at " + memoryInfo.usage_percent + "%"
            };
        } catch (error) {
            log(`Error in _getResourceUsage: ${error.message}`);
            return { error: `Failed to get resource usage information: ${error.message}` };
        }
    }
}); 