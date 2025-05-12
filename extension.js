/* extension.js
*/

const { Clutter, Gio, GLib, GObject, Pango, St, Shell } = imports.gi;
const Soup = imports.gi.Soup;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// Initialize session for API requests
const _httpSession = new Soup.Session();

// Utility function to get focused window title (Wayland-compatible)
function getFocusedWindowTitle() {
    try {
        const focusWindow = global.display.focus_window;
        if (focusWindow && focusWindow.title) {
            const appInfo = Shell.WindowTracker.get_default().get_window_app(focusWindow);
            const appName = appInfo ? appInfo.get_name() : (focusWindow.get_wm_class() || 'Unknown');
            return `${focusWindow.title} (${appName})`;
        }
        return "No Active Window";
    } catch (error) {
        log(`Error getting focused window title: ${error.message}`);
        return "No Active Window";
    }
}

// Utility to get the current workspace
function getCurrentWorkspaceInfo() {
    try {
        if (!global.workspace_manager) {
            log('Workspace manager not available');
            return "Unknown Workspace";
        }
        
        const workspaceManager = global.workspace_manager;
        const activeWorkspace = workspaceManager.get_active_workspace();
        if (!activeWorkspace) {
            log('Active workspace not available');
            return "Unknown Workspace";
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
        
        return `Workspace ${workspaceIndex} of ${numWorkspaces} (${windowsOnWorkspace} windows on current workspace)`;
    } catch (error) {
        log(`Error getting workspace info: ${error.message}`);
        return "Unknown Workspace";
    }
}

// Utility function to get selected text (Wayland and X11 compatible)
// Using global.display.get_selection_owner and Shell.Global.get().get_primary_selection().get_text() which is more robust than other methods given Gnomes changes.
function getSelectedText() {
    try {
        // Try primary selection first (most reliable in GNOME)
        const selection = Shell.Global.get().get_primary_selection();
        if (selection) {
            const text = selection.get_text();
            if (text) {
                // Truncate if too long (more than 1000 chars)
                const textStr = text.toString();
                if (textStr.length > 1000) {
                    return textStr.substring(0, 1000) + '... [truncated, total length: ' + textStr.length + ' chars]';
                }
                return textStr;
            }
        }
        
        // No selection found
        return "";
    } catch (error) {
        log(`Error getting selected text: ${error.message}`);
        return "";
    }
}

// Utility function to get clipboard content (Wayland and X11 compatible)
function getClipboardContent() {
    try {
        // Try St.Clipboard first (works in most GNOME versions)
        const clipboard = St.Clipboard.get_default();
        if (clipboard) {
            let content = '';
            clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
                if (text) content = text;
            });
            
            // If we got content, return it (truncated if too long)
            if (content) {
                // Truncate if too long (more than 1000 chars)
                if (content.length > 1000) {
                    return content.substring(0, 1000) + '... [truncated, total length: ' + content.length + ' chars]';
                }
                return content;
            }
        }
        
        // Fallback to other methods if needed
        return "";
    } catch (error) {
        log(`Error getting clipboard content: ${error.message}`);
        return "";
    }
}

// Utility to get a list of open windows (title and application)
function getOpenWindows() {
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
                    onCurrentWorkspace: onCurrentWorkspace,
                    minimized: window.minimized
                });
            } catch (e) {
                log(`Error processing window: ${e.message}`);
            }
        }
        
        return windowList;
    } catch (error) {
        log(`Error retrieving open window information: ${error.message}`);
        return [];
    }
}

// Utility function to get basic system info
function getSystemInfo() {
    const hostname = GLib.get_host_name();
    const username = GLib.get_user_name();
    const osName = GLib.get_os_info('PRETTY_NAME'); // Or use ID, VERSION_ID etc.
    
    // Get current date and time
    let now = GLib.DateTime.new_now_local();
    let dateTimeStr = now.format('%Y-%m-%d %H:%M:%S');
    
    // Get system memory information
    let memInfo = "";
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
                
                memInfo = `Memory: ${usedMB}MB/${totalMB}MB (${usagePercent}% used)`;
            }
        }
    } catch (error) {
        log(`Error getting memory info: ${error}`);
        memInfo = "Memory info unavailable";
    }
    
    // Get CPU information
    let cpuInfo = "";
    try {
        let [success, contents] = GLib.file_get_contents('/proc/cpuinfo');
        if (success) {
            let cpuInfoStr = imports.byteArray.toString(contents);
            let modelName = cpuInfoStr.match(/model name\s+:\s+(.*)/);
            let cpuCores = cpuInfoStr.match(/cpu cores\s+:\s+(\d+)/);
            
            if (modelName) {
                cpuInfo = `CPU: ${modelName[1]}`;
                if (cpuCores) {
                    cpuInfo += ` (${cpuCores[1]} cores)`;
                }
            }
        }
    } catch (error) {
        log(`Error getting CPU info: ${error}`);
        cpuInfo = "CPU info unavailable";
    }
    
    return `Hostname: ${hostname}, Username: ${username}, OS: ${osName}\nCurrent Time: ${dateTimeStr}\n${cpuInfo}\n${memInfo}`;
}

// Get CPU usage information
function getCpuUsage() {
    try {
        // Use a more reliable method to get CPU usage
        let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            "grep -c ^processor /proc/cpuinfo"
        );
        
        if (success && exitCode === 0) {
            const cpuCount = parseInt(imports.byteArray.toString(stdout).trim());
            
            // Get CPU load averages
            [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync("cat /proc/loadavg");
            
            if (success && exitCode === 0) {
                const loadInfo = imports.byteArray.toString(stdout).trim().split(' ');
                if (loadInfo.length >= 3) {
                    const load1 = parseFloat(loadInfo[0]);
                    const load5 = parseFloat(loadInfo[1]);
                    const load15 = parseFloat(loadInfo[2]);
                    
                    const load1Percent = Math.min(100, Math.round((load1 / cpuCount) * 100));
                    const load5Percent = Math.min(100, Math.round((load5 / cpuCount) * 100));
                    
                    return `CPU Load: ${load1Percent}% (1m), ${load5Percent}% (5m), Load Avg: ${load1.toFixed(2)}, ${load5.toFixed(2)}, ${load15.toFixed(2)}`;
                }
            }
            
            // Try another method using top if the first one fails
            [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                "top -bn1 | grep '%Cpu' | awk '{print $2+$4}'"
            );
            
            if (success && exitCode === 0) {
                const cpuUsage = parseFloat(imports.byteArray.toString(stdout).trim());
                if (!isNaN(cpuUsage)) {
                    return `CPU Usage: ${cpuUsage.toFixed(1)}%`;
                }
            }
        }
        
        // One more fallback method
        [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            "vmstat 1 2 | tail -1 | awk '{print 100-$15}'"
        );
        
        if (success && exitCode === 0) {
            const cpuIdle = parseFloat(imports.byteArray.toString(stdout).trim());
            if (!isNaN(cpuIdle)) {
                return `CPU Usage: ${cpuIdle.toFixed(1)}%`;
            }
        }
    } catch (error) {
        log(`Error getting CPU usage: ${error.message}`);
    }
    
    return "CPU Usage: Unknown";
}

// Get disk usage information
function getDiskUsage() {
    try {
        // Get disk usage using GLib.spawn_command_line_sync
        let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            'df -h / --output=used,size,pcent'
        );
        
        if (success && exitCode === 0) {
            let output = imports.byteArray.toString(stdout);
            let lines = output.split('\n');
            
            if (lines.length >= 2) {
                let parts = lines[1].trim().split(/\s+/);
                if (parts.length >= 3) {
                    return `Disk Usage: ${parts[0]} / ${parts[1]} (${parts[2]})`;
                }
            }
        }
    } catch (error) {
        log(`Error getting disk usage: ${error.message}`);
    }
    
    return "Disk Usage: Unknown";
}

// Get top processes using the 'top' command directly
function getTopProcesses(limit = 10) {
    try {
        log('Attempting to get top processes using top command...');
        
        // Use top in batch mode with a single iteration
        let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            'top -b -n 1 -o %CPU'
        );
        
        if (success && exitCode === 0) {
            let output = imports.byteArray.toString(stdout);
            log('Top command successful, output length: ' + output.length);
            
            if (output.trim()) {
                let lines = output.split('\n');
                
                // Find the line containing column headers (it starts with "PID")
                let headerIndex = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes('PID') && lines[i].includes('USER') && lines[i].includes('COMMAND')) {
                        headerIndex = i;
                        break;
                    }
                }
                
                if (headerIndex !== -1) {
                    // Process the lines after the header
                    let processes = [];
                    let processCount = 0;
                    
                    for (let i = headerIndex + 1; i < lines.length && processCount < limit; i++) {
                        let line = lines[i].trim();
                        if (!line) continue;
                        
                        // Split the line and extract the relevant information
                        let parts = line.split(/\s+/);
                        if (parts.length >= 12) {
                            processCount++;
                            processes.push({
                                pid: parts[0],
                                user: parts[1],
                                // Extract CPU% and MEM% values
                                cpu: parts[8] + '%',
                                memory: parts[9] + '%',
                                command: parts.slice(11).join(' ')
                            });
                        }
                    }
                    
                    if (processes.length > 0) {
                        log('Returning ' + processes.length + ' processes from top command');
                        return processes;
                    }
                } else {
                    log('Could not find header line in top output');
                }
            } else {
                log('Top command returned empty output');
            }
        } else {
            log('Top command failed with exit code: ' + exitCode + ', stderr: ' + imports.byteArray.toString(stderr));
        }
        
        // Try a fallback - use ps command
        log('Trying alternative ps command...');
        [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            'ps -axo pid,user,%cpu,%mem,comm --sort=-%cpu | head -n ' + (limit + 1)
        );
        
        if (success && exitCode === 0) {
            let output = imports.byteArray.toString(stdout);
            log('ps command successful, output length: ' + output.length);
            
            if (output.trim()) {
                let lines = output.split('\n');
                // Skip header line
                let processes = [];
                
                for (let i = 1; i < Math.min(lines.length, limit + 1); i++) {
                    let line = lines[i].trim();
                    if (!line) continue;
                    
                    let parts = line.split(/\s+/);
                    if (parts.length >= 5) {
                        processes.push({
                            pid: parts[0],
                            user: parts[1],
                            cpu: parts[2] + '%',
                            memory: parts[3] + '%',
                            command: parts[4]
                        });
                    }
                }
                
                if (processes.length > 0) {
                    log('Returning ' + processes.length + ' processes from ps command');
                    return processes;
                }
            }
        }
    } catch (error) {
        log(`Error getting top processes: ${error.message}`);
    }
    
    log('Failed to get any processes, returning empty array');
    return [];
}

// Get kernel and uptime information
function getKernelAndUptime() {
    try {
        // Get kernel version
        let [success1, stdout1, stderr1, exitCode1] = GLib.spawn_command_line_sync('uname -r');
        
        // Get uptime
        let [success2, stdout2, stderr2, exitCode2] = GLib.spawn_command_line_sync('uptime -p');
        
        let kernelInfo = "";
        if (success1 && exitCode1 === 0) {
            kernelInfo += `Kernel: ${imports.byteArray.toString(stdout1).trim()}\n`;
        }
        
        if (success2 && exitCode2 === 0) {
            kernelInfo += `Uptime: ${imports.byteArray.toString(stdout2).trim()}`;
        }
        
        return kernelInfo;
    } catch (error) {
        log(`Error getting kernel and uptime: ${error.message}`);
        return "Kernel & Uptime: Unknown";
    }
}

// Get detailed CPU information
function getDetailedCpuInfo() {
    try {
        // Get CPU model, cores, threads
        let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync('lscpu');
        
        if (success && exitCode === 0) {
            let output = imports.byteArray.toString(stdout);
            let modelName = output.match(/Model name:\s+(.*)/);
            let cpuCores = output.match(/Core\(s\) per socket:\s+(\d+)/);
            let cpuThreads = output.match(/Thread\(s\) per core:\s+(\d+)/);
            let cpuSockets = output.match(/Socket\(s\):\s+(\d+)/);
            
            let cpuInfo = "";
            if (modelName) cpuInfo += `CPU Model: ${modelName[1].trim()}\n`;
            
            if (cpuCores && cpuThreads && cpuSockets) {
                const cores = parseInt(cpuCores[1]);
                const threads = parseInt(cpuThreads[1]);
                const sockets = parseInt(cpuSockets[1]);
                cpuInfo += `CPU Cores: ${cores * sockets}, Threads: ${cores * threads * sockets}\n`;
            }
            
            return cpuInfo;
        }
    } catch (error) {
        log(`Error getting detailed CPU info: ${error.message}`);
    }
    
    return "";
}

// Get GPU information
function getGpuInfo() {
    try {
        // Try lspci first for GPU info
        let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            "lspci | grep -i 'vga\\|3d\\|2d'"
        );
        
        if (success && exitCode === 0) {
            let output = imports.byteArray.toString(stdout);
            if (output.trim()) {
                // Extract just the device name, not the PCI info
                let gpus = output.split('\n')
                    .filter(line => line.trim())
                    .map(line => {
                        let match = line.match(/:\s+(.*)/);
                        return match ? match[1].trim() : line.trim();
                    });
                
                if (gpus.length > 0) {
                    return `GPU: ${gpus.join(', ')}`;
                }
            }
        }
        
        // Fallback to glxinfo if available
        [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            "glxinfo | grep 'OpenGL renderer'"
        );
        
        if (success && exitCode === 0) {
            let output = imports.byteArray.toString(stdout);
            let match = output.match(/OpenGL renderer string:\s+(.*)/);
            if (match) {
                return `GPU: ${match[1].trim()}`;
            }
        }
    } catch (error) {
        log(`Error getting GPU info: ${error.message}`);
    }
    
    return "GPU: Unknown";
}

// Get current running applications
function getRunningApps() {
    try {
        const appSystem = Shell.AppSystem.get_default();
        const runningApps = appSystem.get_running();
        
        if (runningApps.length > 0) {
            let appList = [];
            runningApps.forEach(app => {
                try {
                    appList.push({
                        name: app.get_name(),
                        id: app.get_id(),
                        windows: app.get_windows().length
                    });
                } catch (e) {
                    log(`Error processing app: ${e.message}`);
                }
            });
            
            return appList;
        }
    } catch (error) {
        log(`Error getting running apps: ${error.message}`);
    }
    
    return [];
}

// Get network information
function getNetworkInfo() {
    try {
        // Try simplified approach first (works on more systems)
        let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            "ip -4 addr show scope global | grep inet | awk '{print $NF, $2}'"
        );
        
        if (success && exitCode === 0 && imports.byteArray.toString(stdout).trim()) {
            let output = imports.byteArray.toString(stdout);
            let lines = output.trim().split('\n');
            
            if (lines.length > 0) {
                let networkInfo = "Network Interfaces:\n";
                lines.forEach(line => {
                    let parts = line.trim().split(/\s+/);
                    if (parts.length >= 2) {
                        networkInfo += `  - ${parts[0]}: ${parts[1]}\n`;
                    }
                });
                return networkInfo;
            }
        }
        
        // Fallback to ifconfig if available
        [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
            "ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $1, $2}'"
        );
        
        if (success && exitCode === 0 && imports.byteArray.toString(stdout).trim()) {
            let output = imports.byteArray.toString(stdout);
            let lines = output.trim().split('\n');
            
            if (lines.length > 0) {
                let networkInfo = "Network Interfaces:\n";
                lines.forEach(line => {
                    let parts = line.trim().split(/\s+/);
                    if (parts.length >= 2) {
                        networkInfo += `  - ${parts[1]}\n`;
                    }
                });
                return networkInfo;
            }
        }
    } catch (error) {
        log(`Error getting network info: ${error.message}`);
    }
    
    return "Network Info: Unavailable";
}

class ShellController {
    constructor() {
        this._workspaceManager = global.workspace_manager;
        this._windowTracker = Shell.WindowTracker.get_default();
        this._displayManager = global.display;
        log('ShellController initialized');
    }

    // Workspace operations
    switchWorkspace(index) {
        try {
            log(`Attempting to switch to workspace ${index}`);
            const workspace = this._workspaceManager.get_workspace_by_index(index - 1);
            if (workspace) {
                workspace.activate(global.get_current_time());
                log(`Successfully switched to workspace ${index}`);
                return true;
            } else {
                log(`Failed to find workspace ${index}`);
            }
        } catch (error) {
            log(`Error switching workspace: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
        }
        return false;
    }

    // Window operations
    minimizeAllWindows() {
        try {
            log('Attempting to minimize all windows');
            const windows = global.get_window_actors();
            let minimizedCount = 0;
            windows.forEach(actor => {
                const window = actor.get_meta_window();
                if (window && !window.is_skip_taskbar()) {
                    window.minimize();
                    minimizedCount++;
                }
            });
            log(`Successfully minimized ${minimizedCount} windows`);
            return true;
        } catch (error) {
            log(`Error minimizing windows: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
        }
        return false;
    }

    maximizeCurrentWindow() {
        try {
            log('Attempting to maximize current window');
            const focusWindow = this._displayManager.focus_window;
            if (focusWindow) {
                log(`Maximizing window: ${focusWindow.title}`);
                focusWindow.maximize(Meta.MaximizeFlags.BOTH);
                log('Window maximized successfully');
                return true;
            } else {
                log('No focused window found');
            }
        } catch (error) {
            log(`Error maximizing window: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
        }
        return false;
    }

    arrangeWindowsInGrid(rows = 2, cols = 2) {
        try {
            log(`Attempting to arrange windows in ${rows}x${cols} grid`);
            const workspace = this._workspaceManager.get_active_workspace();
            const windows = global.get_window_actors()
                .map(actor => actor.get_meta_window())
                .filter(window => window && !window.is_skip_taskbar() && window.get_workspace() === workspace);

            log(`Found ${windows.length} windows to arrange`);

            const workArea = workspace.get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            const cellWidth = workArea.width / cols;
            const cellHeight = workArea.height / rows;

            windows.forEach((window, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
                if (row < rows) {
                    log(`Arranging window ${window.title} at position (${row}, ${col})`);
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    window.move_resize_frame(
                        true,
                        workArea.x + (col * cellWidth),
                        workArea.y + (row * cellHeight),
                        cellWidth,
                        cellHeight
                    );
                }
            });
            log('Window arrangement completed');
            return true;
        } catch (error) {
            log(`Error arranging windows: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
        }
        return false;
    }

    // Application operations
    launchApplication(appId) {
        try {
            log(`Attempting to launch application: ${appId}`);
            
            // Try to get app info using different methods
            let app = null;
            
            // Method 1: Try direct app ID
            app = Gio.AppInfo.get_default_for_type(appId, false);
            if (!app) {
                log(`Direct app lookup failed for ${appId}, trying alternative methods`);
                
                // Method 2: Try with .desktop extension
                const desktopId = appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
                app = Gio.AppInfo.get_default_for_type(desktopId, false);
                
                if (!app) {
                    // Method 3: Try to find by executable name
                    const appSystem = Shell.AppSystem.get_default();
                    const allApps = appSystem.get_installed();
                    
                    for (let installedApp of allApps) {
                        const exec = installedApp.get_executable();
                        if (exec && exec.toLowerCase().includes(appId.toLowerCase())) {
                            app = installedApp;
                            log(`Found matching app by executable: ${exec}`);
                            break;
                        }
                    }
                }
            }

            if (app) {
                log(`Found application: ${app.get_name()} (${app.get_id()})`);
                const success = app.launch([], null);
                if (success) {
                    log(`Successfully launched ${app.get_name()}`);
                    return true;
                } else {
                    log(`Failed to launch ${app.get_name()}`);
                }
            } else {
                log(`Could not find application matching: ${appId}`);
                // List available applications for debugging
                const appSystem = Shell.AppSystem.get_default();
                const allApps = appSystem.get_installed();
                log('Available applications:');
                allApps.forEach(installedApp => {
                    log(`- ${installedApp.get_name()} (${installedApp.get_id()})`);
                });
            }
        } catch (error) {
            log(`Error launching application: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
        }
        return false;
    }

    // System operations
    toggleNightLight() {
        try {
            log('Attempting to toggle night light');
            const settings = new Gio.Settings({ schema: 'org.gnome.settings-daemon.plugins.color' });
            const current = settings.get_boolean('night-light-enabled');
            settings.set_boolean('night-light-enabled', !current);
            log(`Night light ${!current ? 'enabled' : 'disabled'}`);
            return true;
        } catch (error) {
            log(`Error toggling night light: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
        }
        return false;
    }

    // New window management methods
    moveWindow(x, y) {
        try {
            const focusWindow = this._displayManager.focus_window;
            if (focusWindow) {
                focusWindow.move_frame(true, x, y);
                return true;
            }
        } catch (error) {
            log(`Error moving window: ${error.message}`);
        }
        return false;
    }

    resizeWindow(width, height) {
        try {
            const focusWindow = this._displayManager.focus_window;
            if (focusWindow) {
                const [x, y] = focusWindow.get_frame_rect();
                focusWindow.move_resize_frame(true, x, y, width, height);
                return true;
            }
        } catch (error) {
            log(`Error resizing window: ${error.message}`);
        }
        return false;
    }

    closeCurrentWindow() {
        try {
            const focusWindow = this._displayManager.focus_window;
            if (focusWindow) {
                focusWindow.delete(global.get_current_time());
                return true;
            }
        } catch (error) {
            log(`Error closing window: ${error.message}`);
        }
        return false;
    }

    // New workspace management methods
    createWorkspace() {
        try {
            const newIndex = this._workspaceManager.get_n_workspaces();
            this._workspaceManager.add_workspace(newIndex, global.get_current_time());
            return true;
        } catch (error) {
            log(`Error creating workspace: ${error.message}`);
        }
        return false;
    }

    removeWorkspace(index) {
        try {
            const workspace = this._workspaceManager.get_workspace_by_index(index - 1);
            if (workspace) {
                workspace.remove();
                return true;
            }
        } catch (error) {
            log(`Error removing workspace: ${error.message}`);
        }
        return false;
    }

    // New system information methods
    getCurrentTime() {
        try {
            const now = GLib.DateTime.new_now_local();
            return now.format('%H:%M:%S');
        } catch (error) {
            log(`Error getting current time: ${error.message}`);
        }
        return null;
    }

    getCurrentDate() {
        try {
            const now = GLib.DateTime.new_now_local();
            return now.format('%Y-%m-%d');
        } catch (error) {
            log(`Error getting current date: ${error.message}`);
        }
        return null;
    }

    // New application management methods
    listInstalledApps() {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const apps = appSystem.get_installed();
            return apps.map(app => ({
                name: app.get_name(),
                id: app.get_id(),
                description: app.get_description()
            }));
        } catch (error) {
            log(`Error listing installed apps: ${error.message}`);
        }
        return [];
    }

    getRunningApps() {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const runningApps = appSystem.get_running();
            return runningApps.map(app => ({
                name: app.get_name(),
                id: app.get_id(),
                windows: app.get_windows().length
            }));
        } catch (error) {
            log(`Error getting running apps: ${error.message}`);
        }
        return [];
    }

    // New display management methods
    setBrightness(level) {
        try {
            const settings = new Gio.Settings({ schema: 'org.gnome.settings-daemon.plugins.power' });
            settings.set_int('brightness', Math.max(0, Math.min(100, level)));
            return true;
        } catch (error) {
            log(`Error setting brightness: ${error.message}`);
        }
        return false;
    }

    setVolume(level) {
        try {
            const settings = new Gio.Settings({ schema: 'org.gnome.desktop.sound' });
            settings.set_int('volume', Math.max(0, Math.min(100, level)));
            return true;
        } catch (error) {
            log(`Error setting volume: ${error.message}`);
        }
        return false;
    }

    // Add web search method
    searchWeb(query) {
        return new Promise((resolve, reject) => {
            try {
                log(`Searching web for: ${query}`);
                
                // Create a new Soup.Message for the fetch request
                const message = Soup.Message.new('GET', `https://ooglester.com/search?q=${encodeURIComponent(query)}`);
                
                // Add headers to mimic a browser request
                message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7');
                message.request_headers.append('Accept-Language', 'en-US,en;q=0.9');
                message.request_headers.append('Cache-Control', 'max-age=0');
                message.request_headers.append('Sec-Ch-Ua', '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"');
                message.request_headers.append('Sec-Ch-Ua-Mobile', '?0');
                message.request_headers.append('Sec-Ch-Ua-Platform', '"Linux"');
                message.request_headers.append('Sec-Fetch-Dest', 'document');
                message.request_headers.append('Sec-Fetch-Mode', 'navigate');
                message.request_headers.append('Sec-Fetch-Site', 'none');
                message.request_headers.append('Sec-Fetch-User', '?1');
                message.request_headers.append('Upgrade-Insecure-Requests', '1');
                message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');

                log('Sending fetch request...');
                
                // Store reference to this for use in callback
                const self = this;
                
                // Send the request using Soup.Session
                _httpSession.queue_message(message, function(session, msg) {
                    if (msg.status_code !== 200) {
                        log(`Fetch request failed with status: ${msg.status_code}`);
                        reject(`Failed to perform web search. Status: ${msg.status_code}`);
                        return;
                    }

                    const html = msg.response_body.data.toString();
                    log(`Received HTML response of length: ${html.length}`);

                    // Extract results using a more comprehensive approach
                    const results = [];
                    
                    // First, try to find all article elements
                    const articleRegex = /<article[^>]*class="result[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
                    let articleMatch;
                    
                    while ((articleMatch = articleRegex.exec(html)) !== null) {
                        try {
                            const article = articleMatch[1];
                            
                            // Extract URL with more robust pattern
                            const urlMatch = article.match(/<a[^>]*href="([^"]+)"[^>]*class="url_header"/);
                            const url = urlMatch ? urlMatch[1] : null;
                            
                            // Extract title with more robust pattern
                            const titleMatch = article.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
                            const title = titleMatch ? titleMatch[1].trim() : null;
                            
                            // Extract content with more robust pattern
                            const contentMatch = article.match(/<p[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/);
                            const content = contentMatch ? contentMatch[1].trim() : null;
                            
                            // Extract source engine if available
                            const engineMatch = article.match(/<span>([^<]+)<\/span>/);
                            const engine = engineMatch ? engineMatch[1].trim() : null;

                            log(`Processing article - URL: ${url}, Title: ${title}`);
                            
                            if (url && title) {
                                results.push({
                                    title: title,
                                    content: content || '',
                                    url: url,
                                    engine: engine || ''
                                });
                            }
                        } catch (error) {
                            log(`Error processing article: ${error.message}`);
                            continue;
                        }
                    }

                    log(`Successfully processed ${results.length} results`);
                    
                    if (results.length === 0) {
                        reject("No search results found. Please try a different search query.");
                        return;
                    }

                    // Take top 3 results and format them for the AI
                    const topResults = results.slice(0, 3);
                    const searchSummary = topResults.map(result => {
                        return `Title: ${result.title}\nURL: ${result.url}\nSummary: ${result.content || 'No summary available'}\n`;
                    }).join('\n---\n\n');

                    // Store the results for potential follow-up requests
                    self._lastSearchResults = results;

                    // Resolve with the search summary
                    resolve(searchSummary);
                });

            } catch (error) {
                log(`Error in searchWeb: ${error.message}`);
                reject(`An error occurred while performing the web search: ${error.message}`);
            }
        });
    }

    // Add new method to fetch detailed content from a specific URL
    fetchUrlContent(url) {
        try {
            log(`Fetching content from URL: ${url}`);
            
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36');
            
            const self = this;
            
            _httpSession.queue_message(message, function(session, msg) {
                try {
                    if (msg.status_code === 200) {
                        const content = msg.response_body.data.toString();
                        
                        // Extract main content (this is a simple approach, might need refinement)
                        const mainContent = content.match(/<main[^>]*>([\s\S]*?)<\/main>/) || 
                                         content.match(/<article[^>]*>([\s\S]*?)<\/article>/) ||
                                         content.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
                        
                        if (mainContent) {
                            // Clean up the content
                            let cleanContent = mainContent[1]
                                .replace(/<[^>]+>/g, ' ') // Remove HTML tags
                                .replace(/\s+/g, ' ') // Normalize whitespace
                                .trim();
                            
                            // Truncate if too long
                            if (cleanContent.length > 1000) {
                                cleanContent = cleanContent.substring(0, 1000) + '...';
                            }
                            
                            // Send the content back to the AI
                            const followUpPrompt = `Here's the detailed content from ${url}:\n\n${cleanContent}\n\nPlease provide a summary of this information.`;
                            self._addMessage(followUpPrompt, 'ai');
                        } else {
                            self._addMessage(`Could not extract main content from ${url}`, 'ai');
                        }
                    } else {
                        self._addMessage(`Failed to fetch content from ${url}. Status: ${msg.status_code}`, 'ai');
                    }
                } catch (error) {
                    log(`Error processing URL content: ${error.message}`);
                    self._addMessage(`Error processing content from ${url}: ${error.message}`, 'ai');
                }
            });
        } catch (error) {
            log(`Error in fetchUrlContent: ${error.message}`);
            this._addMessage(`Error fetching content from ${url}: ${error.message}`, 'ai');
        }
    }
}

class LLMChatBox {
    constructor(settings) {
        this._settings = settings;
        this._messages = [];
        this._maxResponseLength = settings.get_int('max-response-length');
        this._contextEnabled = false;
        this._maxInitialHeight = 800;
        this._initialHeight = 600;
        this._sessionId = GLib.uuid_string_random(); // Generate unique session ID
        this._lastSearchResults = null; // Store last search results for the current session
        this._lastSearchQuery = null;
        this._lastSearchUrls = new Map(); // Store URLs with their titles for reference
        
        // Create main container
        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: 'llm-chat-box',
            y_expand: true
        });

        // Chat history scroll view - set to fill all available space
        this._scrollView = new St.ScrollView({
            style_class: 'llm-chat-scrollview',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            y_expand: true
        });

        // Container for chat messages
        this._messageContainer = new St.BoxLayout({
            vertical: true,
            y_expand: true
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._scrollView.add_actor(this._messageContainer);
        this.actor.add_child(this._scrollView);

        // --- Input Area Improvements ---
        // Use a vertical layout for input area to accommodate a larger text entry
        const inputBox = new St.BoxLayout({
            style_class: 'llm-chat-input-box',
            vertical: true, // Changed to vertical
            y_align: Clutter.ActorAlign.END, //align to the bottom
        });


        // Text entry (make it multi-line)
        this._entryText = new St.Entry({
            style_class: 'llm-chat-entry',
            can_focus: true,
            hint_text: 'Type your message...',
           // x_expand: true,  Removed to allow for wrapping within the box
            y_expand: false, // Don't expand vertically, let the height be determined by content.
        });

        this._entryText.clutter_text.line_wrap = true;
        this._entryText.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._entryText.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._entryText.clutter_text.single_line_mode = false;
        this._entryText.clutter_text.activatable = false;

        // Store signal handler IDs
        this._entryText.clutter_text._keyPressHandlerId = this._entryText.clutter_text.connect('key-press-event', (actor, event) => {
            let keyval = event.get_key_symbol();
            let state = event.get_state();
            log(`Key press detected: keyval = ${keyval}, state = ${state}`);

            // Submit on Enter (without Ctrl)
            if (keyval === Clutter.KEY_Return && !(state & Clutter.ModifierType.CONTROL_MASK)) {
                this._onEntryActivated();
                return true;
            }
            // Submit on Ctrl+Enter
            if (keyval === Clutter.KEY_Return && (state & Clutter.ModifierType.CONTROL_MASK)) {
                this._onEntryActivated();
                return true;
            }
            return false;
        });

        this._entryText.clutter_text._activateHandlerId = this._entryText.clutter_text.connect('activate', this._onEntryActivated.bind(this));

        // --- Key Press Handling for Multi-Line Input ---
        this._entryText.clutter_text._multiLineHandlerId = this._entryText.clutter_text.connect('key-press-event', (actor, event) => {
            let keyval = event.get_key_symbol();
            let state = event.get_state();
            log(`Key press detected: keyval = ${keyval}, state = ${state}`);

            // Allow new lines on Shift+Enter
            if(keyval === Clutter.KEY_Return && (state & Clutter.ModifierType.SHIFT_MASK)) {
                actor.insert_text("\n", actor.get_cursor_position());
                return true;
            }
            if (keyval === Clutter.KEY_Return) {
                return true;
            }
            return false;
        });

        inputBox.add_child(this._entryText);




        // Container for buttons (horizontal)
        const buttonBox = new St.BoxLayout({
            style_class: 'llm-chat-button-box', // Add a class for potential styling
            vertical: false,
             x_align: Clutter.ActorAlign.END // Align buttons to right
        });



        // Send button
        const sendButton = new St.Button({
            style_class: 'llm-chat-button',
            label: 'Send'
        });
        sendButton.connect('clicked', this._onSendButtonClicked.bind(this));
        buttonBox.add_child(sendButton);

        // Context toggle button
        this._contextToggleButton = new St.Button({
            style_class: 'llm-chat-context-button', // Initial style (unselected)
            label: 'Context: OFF'
        });
        this._contextToggleButton._clickHandlerId = this._contextToggleButton.connect('clicked', this._onContextToggleClicked.bind(this));
        buttonBox.add_child(this._contextToggleButton);


        // Settings button
        const settingsIcon = new St.Icon({
            icon_name: 'emblem-system-symbolic',
            icon_size: 16
        });

        const settingsButton = new St.Button({
            style_class: 'llm-chat-settings-button',
            child: settingsIcon
        });
        settingsButton.connect('clicked', this._onSettingsButtonClicked.bind(this));
        buttonBox.add_child(settingsButton);

        // Add tool calling state
        this._toolCallingEnabled = false;
        
        // Define available tools
        this._availableTools = [
            {
                name: "switch_workspace",
                description: "Switch to a different workspace",
                parameters: {
                    type: "object",
                    properties: {
                        workspace_number: {
                            type: "integer",
                            description: "The workspace number to switch to (1-based index)"
                        }
                    },
                    required: ["workspace_number"]
                }
            },
            {
                name: "minimize_all_windows",
                description: "Minimize all windows on the current workspace",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "maximize_current_window",
                description: "Maximize the currently focused window",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "arrange_windows",
                description: "Arrange windows in a grid pattern",
                parameters: {
                    type: "object",
                    properties: {
                        rows: {
                            type: "integer",
                            description: "Number of rows in the grid"
                        },
                        columns: {
                            type: "integer",
                            description: "Number of columns in the grid"
                        }
                    },
                    required: ["rows", "columns"]
                }
            },
            {
                name: "launch_application",
                description: "Launch an application",
                parameters: {
                    type: "object",
                    properties: {
                        app_id: {
                            type: "string",
                            description: "The application ID or name to launch"
                        }
                    },
                    required: ["app_id"]
                }
            },
            {
                name: "toggle_night_light",
                description: "Toggle the night light feature",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "move_window",
                description: "Move the currently focused window to a specific position",
                parameters: {
                    type: "object",
                    properties: {
                        x: {
                            type: "integer",
                            description: "X coordinate for the window position"
                        },
                        y: {
                            type: "integer",
                            description: "Y coordinate for the window position"
                        }
                    },
                    required: ["x", "y"]
                }
            },
            {
                name: "resize_window",
                description: "Resize the currently focused window",
                parameters: {
                    type: "object",
                    properties: {
                        width: {
                            type: "integer",
                            description: "New width for the window"
                        },
                        height: {
                            type: "integer",
                            description: "New height for the window"
                        }
                    },
                    required: ["width", "height"]
                }
            },
            {
                name: "close_current_window",
                description: "Close the currently focused window",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "create_workspace",
                description: "Create a new workspace",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "remove_workspace",
                description: "Remove a workspace",
                parameters: {
                    type: "object",
                    properties: {
                        workspace_number: {
                            type: "integer",
                            description: "The workspace number to remove (1-based index)"
                        }
                    },
                    required: ["workspace_number"]
                }
            },
            {
                name: "get_current_time",
                description: "Get the current system time",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "get_current_date",
                description: "Get the current system date",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "list_installed_apps",
                description: "List all installed applications",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "get_running_apps",
                description: "Get list of currently running applications",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "set_brightness",
                description: "Set the screen brightness level",
                parameters: {
                    type: "object",
                    properties: {
                        level: {
                            type: "integer",
                            description: "Brightness level (0-100)"
                        }
                    },
                    required: ["level"]
                }
            },
            {
                name: "set_volume",
                description: "Set the system volume level",
                parameters: {
                    type: "object",
                    properties: {
                        level: {
                            type: "integer",
                            description: "Volume level (0-100)"
                        }
                    },
                    required: ["level"]
                }
            },
            {
                name: "web_search",
                description: "Search the internet for information",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query to look up on the internet"
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "fetch_url_content",
                description: "Fetch and extract the main content from a specific URL",
                parameters: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL to fetch content from"
                        }
                    },
                    required: ["url"]
                }
            }
        ];

        // Add tool calling toggle button
        this._toolCallingToggleButton = new St.Button({
            style_class: 'llm-chat-tool-button',
            label: 'Tools: OFF'
        });
        this._toolCallingToggleButton._clickHandlerId = this._toolCallingToggleButton.connect('clicked', this._onToolCallingToggleClicked.bind(this));
        buttonBox.add_child(this._toolCallingToggleButton);

        inputBox.add_child(buttonBox);  // Add button container to vertical input box

        this.actor.add_child(inputBox); // Add the entire input box (entry + buttons) to main actor.
        this._adjustWindowHeight(); // Adjust height on creation.

        this._shellController = new ShellController();
        
        // Add shell control commands to the message handling
        this._shellCommands = {
            'switch to workspace': (params) => {
                const index = parseInt(params[0]);
                if (!isNaN(index)) {
                    log(`Executing shell command: switch to workspace ${index}`);
                    return this._shellController.switchWorkspace(index);
                }
                log(`Invalid workspace index: ${params[0]}`);
                return false;
            },
            'minimize all windows': () => {
                log('Executing shell command: minimize all windows');
                return this._shellController.minimizeAllWindows();
            },
            'maximize current window': () => {
                log('Executing shell command: maximize current window');
                return this._shellController.maximizeCurrentWindow();
            },
            'arrange windows': (params) => {
                const rows = parseInt(params[0]) || 2;
                const cols = parseInt(params[1]) || 2;
                log(`Executing shell command: arrange windows ${rows}x${cols}`);
                return this._shellController.arrangeWindowsInGrid(rows, cols);
            },
            'launch': (params) => {
                if (!params[0]) {
                    log('No application specified for launch command');
                    return false;
                }
                log(`Executing shell command: launch ${params[0]}`);
                return this._shellController.launchApplication(params[0]);
            },
            'toggle night light': () => {
                log('Executing shell command: toggle night light');
                return this._shellController.toggleNightLight();
            },
            'web_search': (params) => {
                if (!params[0]) {
                    log('No query specified for web search');
                    return false;
                }
                log(`Executing shell command: web_search ${params[0]}`);
                return this._shellController.searchWeb(params[0]);
            }
        };
    }

    _onEntryActivated() {
        const text = this._entryText.get_text();
        if (text.trim() !== '') {
            this._sendMessage(text);
            this._entryText.set_text('');
        }
    }

    _onSendButtonClicked() {
        const text = this._entryText.get_text();
        if (text.trim() !== '') {
            this._sendMessage(text);
            this._entryText.set_text('');
        }
    }

    _onSettingsButtonClicked() {
        ExtensionUtils.openPrefs();
    }

     _onContextToggleClicked() {
        this._contextEnabled = !this._contextEnabled;
        this._contextToggleButton.label = this._contextEnabled ? 'Context: ON' : 'Context: OFF';

        // Toggle the style class for visual feedback
        if (this._contextEnabled) {
            this._contextToggleButton.add_style_class_name('llm-chat-context-button-selected');
        } else {
            this._contextToggleButton.remove_style_class_name('llm-chat-context-button-selected');
        }
    }

    _onToolCallingToggleClicked() {
        this._toolCallingEnabled = !this._toolCallingEnabled;
        this._toolCallingToggleButton.label = this._toolCallingEnabled ? 'Tools: ON' : 'Tools: OFF';
        
        if (this._toolCallingEnabled) {
            this._toolCallingToggleButton.add_style_class_name('llm-chat-tool-button-selected');
        } else {
            this._toolCallingToggleButton.remove_style_class_name('llm-chat-tool-button-selected');
        }
    }

    _executeToolCall(toolCall) {
        log(`Executing tool call: ${toolCall.name}`);
        try {
            switch (toolCall.name) {
                case 'web_search':
                    return this._shellController.searchWeb(toolCall.arguments.query);
                
                case 'fetch_url_content':
                    // Check if we have the URL from previous search results
                    const title = toolCall.arguments.title;
                    let url = toolCall.arguments.url;
                    
                    if (title && this._lastSearchUrls.has(title)) {
                        url = this._lastSearchUrls.get(title);
                        log(`Found URL for title "${title}": ${url}`);
                    }
                    
                    if (!url) {
                        throw new Error('No URL provided or found in search results');
                    }
                    
                    return this._shellController.fetchUrlContent(url);
                
                case 'switch_workspace':
                    return this._shellController.switchWorkspace(toolCall.arguments.workspace_number);
                
                case 'minimize_all_windows':
                    return this._shellController.minimizeAllWindows();
                
                case 'maximize_current_window':
                    return this._shellController.maximizeCurrentWindow();
                
                case 'arrange_windows':
                    return this._shellController.arrangeWindowsInGrid(
                        toolCall.arguments.rows,
                        toolCall.arguments.columns
                    );
                
                case 'launch_application':
                    return this._shellController.launchApplication(toolCall.arguments.app_id);
                
                case 'toggle_night_light':
                    return this._shellController.toggleNightLight();
                
                case 'move_window':
                    return this._shellController.moveWindow(
                        toolCall.arguments.x,
                        toolCall.arguments.y
                    );
                
                case 'resize_window':
                    return this._shellController.resizeWindow(
                        toolCall.arguments.width,
                        toolCall.arguments.height
                    );
                
                case 'close_current_window':
                    return this._shellController.closeCurrentWindow();
                
                case 'create_workspace':
                    return this._shellController.createWorkspace();
                
                case 'remove_workspace':
                    return this._shellController.removeWorkspace(
                        toolCall.arguments.workspace_number
                    );
                
                case 'get_current_time':
                    const time = this._shellController.getCurrentTime();
                    return time ? `Current time: ${time}` : 'Failed to get current time';
                
                case 'get_current_date':
                    const date = this._shellController.getCurrentDate();
                    return date ? `Current date: ${date}` : 'Failed to get current date';
                
                case 'list_installed_apps':
                    const apps = this._shellController.listInstalledApps();
                    return apps.length > 0 ? 
                        `Installed apps:\n${apps.map(app => `- ${app.name} (${app.id})`).join('\n')}` :
                        'No installed apps found';
                
                case 'get_running_apps':
                    const runningApps = this._shellController.getRunningApps();
                    return runningApps.length > 0 ?
                        `Running apps:\n${runningApps.map(app => `- ${app.name} (${app.windows} windows)`).join('\n')}` :
                        'No running apps found';
                
                case 'set_brightness':
                    return this._shellController.setBrightness(toolCall.arguments.level);
                
                case 'set_volume':
                    return this._shellController.setVolume(toolCall.arguments.level);
                
                default:
                    throw new Error(`Unknown tool call: ${toolCall.name}`);
            }
        } catch (error) {
            log(`Error executing tool call ${toolCall.name}: ${error.message}`);
            throw error;
        }
    }

    _sendMessage() {
        const message = this._entryText.get_text().trim();
        if (!message) return;

        // Clear input
        this._entryText.set_text('');

        // Add user message
        this._addMessage(message, 'user');

        // Add thinking message if not hidden
        if (!this._settings.get_boolean('hide-thinking')) {
            this._addMessage('Thinking...', 'assistant', true);
        }

        // Get conversation history
        const history = this._getConversationHistory();

        // Check for shell commands first
        const shellResponse = this._handleShellCommand(message);
        if (shellResponse) {
            this._addMessage(shellResponse, 'system');
            return;
        }

        // Prepare context (if enabled) and construct the full prompt
        const context = this._prepareContext();
        const fullPrompt = context + history + message;

        // Get selected service provider
        const provider = this._settings.get_string('service-provider');
        switch (provider) {
            case 'openai':
                log('Calling OpenAI API...');
                this._callOpenAI(fullPrompt);
                break;
            case 'gemini':
                log('Calling Gemini API...');
                this._callGemini(fullPrompt);
                break;
            case 'anthropic':
                log('Calling Anthropic API...');
                this._callAnthropic(fullPrompt);
                break;
            case 'llama':
                log('Calling Llama API...');
                this._callLlama(fullPrompt);
                break;
            case 'ollama':
                log('Calling Ollama API...');
                this._callOllama(fullPrompt);
                break;
            default:
                this._addMessage('Error: Unknown service provider', 'system');
        }
    }

    _getConversationHistory() {
        // Get the last 10 messages for context
        const recentMessages = this._messages.slice(-10);
        let history = '';
        
        // Add last search query and results if available
        if (this._lastSearchQuery) {
            history += `Last search query: ${this._lastSearchQuery}\n`;
            if (this._lastSearchResults) {
                history += 'Last search results:\n';
                this._lastSearchResults.slice(0, 3).forEach(result => {
                    history += `- ${result.title} (${result.url})\n`;
                });
                history += '\n';
            }
        }
        
        recentMessages.forEach(msg => {
            if (msg.sender === 'user') {
                history += `User: ${msg.text}\n`;
            } else if (msg.sender === 'ai') {
                history += `Assistant: ${msg.text}\n`;
            }
        });
        
        return history;
    }

    _callOpenAI(text) {
        const apiKey = this._settings.get_string('openai-api-key');
        if (!apiKey) {
            this._addMessage('Error: OpenAI API key is not set. Please configure it in settings.', 'ai');
            return;
        }
        const model = this._settings.get_string('openai-model');
        const temperature = this._settings.get_double('openai-temperature');

        // Prepare the request data
        const requestData = {
            model: model,
            messages: [
                {
                    role: 'user',
                    content: text
                }
            ],
            max_tokens: Math.round(this._maxResponseLength / 4),
            temperature: temperature
        };

        // Add tools if tool calling is enabled
        if (this._toolCallingEnabled) {
            requestData.tools = this._availableTools;
            requestData.tool_choice = "auto";
        }

        // Set up the message
        const message = Soup.Message.new('POST', 'https://api.openai.com/v1/chat/completions');
        message.request_headers.append('Authorization', `Bearer ${apiKey}`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));

        // Send the request
        _httpSession.queue_message(message, (session, msg) => {
            this._handleApiResponse(msg, 'OpenAI');
        });
    }
      _callGemini(text) {
      const apiKey = this._settings.get_string('gemini-api-key');
      if (!apiKey) {
          this._addMessage('Error: Gemini API key is not set. Please configure it in settings.', 'ai');
          return;
      }

      // Prepare the request data
        const requestData = JSON.stringify({
            contents: [
                {
                    parts: [
                        {
                            text: text
                        }
                    ]
                }
            ]
        });

      // Set up the message and replace the key
      const message = Soup.Message.new('POST', `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`);
      message.request_headers.append('Content-Type', 'application/json');
      message.set_request_body_from_bytes('application/json', new GLib.Bytes(requestData));

      // Send the request
      _httpSession.queue_message(message, (session, msg) => {
          this._handleApiResponse(msg, 'Gemini');
      });
    }

      _callAnthropic(text) {
        const apiKey = this._settings.get_string('anthropic-api-key');
        if (!apiKey) {
            this._addMessage('Error: Anthropic API key is not set. Please configure it in settings.', 'ai');
            return;
        }
        const anthropicModel = this._settings.get_string('anthropic-model');
        const temperature = this._settings.get_double('anthropic-temperature');
        const max_tokens_to_sample = this._settings.get_int('anthropic-max-tokens');

        // Prepare the request data for Anthropic
        const requestData = JSON.stringify({
            model: anthropicModel, // Consider making this configurable
            prompt: `\n\nHuman: ${text}\n\nAssistant:`,
            max_tokens_to_sample: max_tokens_to_sample, //Consider making configurable
            temperature: temperature //Consider making configurable
        });

        // Set up the message
        const message = Soup.Message.new('POST', 'https://api.anthropic.com/v1/complete');
        message.request_headers.append('X-API-Key', apiKey);
        message.request_headers.append('Content-Type', 'application/json');
        message.request_headers.append('anthropic-version', '2023-06-01'); // Add version header.
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(requestData));

        // Send the request
        _httpSession.queue_message(message, (session, msg) => {
            this._handleApiResponse(msg, 'Anthropic');
        });
    }
      _callLlama(text) {
      const serverUrl = this._settings.get_string('llama-server-url');
      if (!serverUrl) {
        this._addMessage(
          'Error: Llama server URL is not set. Please configure it in settings.',
          'ai'
        );
        return;
      }
      const temperature = this._settings.get_double('llama-temperature');

      // Get the model name from settings
      const modelName = this._settings.get_string('llama-model-name') || 'llama';

      // Prepare the request data for Llama (OpenAI-compatible format)
      const requestData = JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: text,
          },
        ],
        max_tokens: Math.round(this._maxResponseLength / 4), // Approximate tokens to characters conversion
        temperature: temperature,
      });

      // Set up the message including serverUrl
      const message = Soup.Message.new('POST', `${serverUrl}/v1/chat/completions`);
      message.request_headers.append('Content-Type', 'application/json');
      message.set_request_body_from_bytes('application/json', new GLib.Bytes(requestData));

      _httpSession.queue_message(message, (session, msg) => {
          this._handleApiResponse(msg, 'Llama');
      });
    }

    _callOllama(text) {
        const serverUrl = this._settings.get_string('ollama-server-url');
        log(`Attempting Ollama API call to server: ${serverUrl}`);
        
        if (!serverUrl) {
            this._addMessage('Error: Ollama server URL is not set. Please configure it in settings.', 'ai');
            return;
        }
        const temperature = this._settings.get_double('ollama-temperature');
        const modelName = this._settings.get_string('ollama-model-name') || 'llama2';
        
        log(`Ollama settings - Model: ${modelName}, Temperature: ${temperature}`);

        // Prepare the request data for Ollama
        const requestData = {
            model: modelName,
            prompt: text,
            stream: false,
            options: {
                temperature: temperature
            }
        };

        // Add tools if tool calling is enabled
        if (this._toolCallingEnabled) {
            requestData.tools = this._availableTools;
            requestData.tool_choice = "auto";
            
            // Add system message to instruct the model about tool usage
            requestData.system = `You are a helpful AI assistant with access to system tools. 
When a user asks for information that can be obtained using tools (like time, system info, etc.), 
you MUST use the appropriate tool to get accurate information.

Available Tools:
1. get_current_time - Get the current system time
2. get_current_date - Get the current system date
3. switch_workspace - Switch to a different workspace (requires workspace_number)
4. minimize_all_windows - Minimize all windows on the current workspace
5. maximize_current_window - Maximize the currently focused window
6. arrange_windows - Arrange windows in a grid pattern (requires rows and columns)
7. launch_application - Launch an application (requires app_id)
8. toggle_night_light - Toggle the night light feature
9. move_window - Move the currently focused window (requires x and y coordinates)
10. resize_window - Resize the currently focused window (requires width and height)
11. close_current_window - Close the currently focused window
12. create_workspace - Create a new workspace
13. remove_workspace - Remove a workspace (requires workspace_number)
14. list_installed_apps - List all installed applications
15. get_running_apps - Get list of currently running applications
16. set_brightness - Set the screen brightness level (requires level 0-100)
17. set_volume - Set the system volume level (requires level 0-100)
18. web_search - Search the internet for information (requires query)
19. fetch_url_content - Fetch and extract the main content from a specific URL (requires url)

To use a tool, you must respond in this exact format:
<tool_call>
{
    "name": "tool_name",
    "arguments": {
        "param1": "value1",
        "param2": "value2"
    }
}
</tool_call>

Examples:
1. For getting the current time:
<tool_call>
{
    "name": "get_current_time",
    "arguments": {}
}
</tool_call>

2. For switching workspaces:
<tool_call>
{
    "name": "switch_workspace",
    "arguments": {
        "workspace_number": 2
    }
}
</tool_call>

3. For launching an application:
<tool_call>
{
    "name": "launch_application",
    "arguments": {
        "app_id": "firefox"
    }
}
</tool_call>

4. For searching the web:
<tool_call>
{
    "name": "web_search",
    "arguments": {
        "query": "latest news about AI"
    }
}
</tool_call>

5. For fetching content from a URL:
<tool_call>
{
    "name": "fetch_url_content",
    "arguments": {
        "url": "https://example.com/article"
    }
}
</tool_call>

IMPORTANT RULES:
1. ALWAYS use tools when they can provide accurate information
2. NEVER make up information that can be obtained from tools
3. ALWAYS use the exact tool_call format shown above
4. Wait for tool responses before providing your final answer
5. If a tool fails, acknowledge the failure and try an alternative if available
6. When you receive tool results, use them to provide a complete and accurate response
7. For tools that require parameters, make sure to provide all required parameters
8. Use the most appropriate tool for the user's request
9. You can use multiple tools in sequence if needed
10. Always verify the tool results before providing your final response
11. For web searches, use specific and relevant search queries
12. When using web search results, cite the sources in your response
13. After getting search results, use fetch_url_content to get detailed information from relevant URLs
14. When fetching URL content, make sure the URL is valid and accessible`;
        }
        
        log(`Ollama request data: ${JSON.stringify(requestData)}`);

        // Set up the message
        const message = Soup.Message.new('POST', `${serverUrl}/api/generate`);
        message.request_headers.append('Content-Type', 'application/json');
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(JSON.stringify(requestData)));
        
        log('Sending Ollama request...');

        _httpSession.queue_message(message, (session, msg) => {
            log(`Ollama response received - Status: ${msg.status_code}`);
            if (msg.status_code !== 200) {
                log(`Ollama error response: ${msg.response_body.data}`);
            }
            this._handleApiResponse(msg, 'Ollama');
        });
    }

    _handleApiResponse(msg, providerName) {
        if (msg.status_code !== 200) {
            this._addMessage(`Error: ${msg.status_code} - ${msg.reason_phrase} (${providerName})`, 'ai');
            return;
        }

        try {
            log(`Received ${providerName} API response with status code ${msg.status_code}`);
            const responseData = JSON.parse(msg.response_body.data);
            let responseText = '';
            let toolCalls = [];

            // Extract response and tool calls based on provider
            switch (providerName) {
                case 'OpenAI':
                    const message = responseData.choices[0].message;
                    responseText = message.content || '';
                    log(`OpenAI response text extracted, length: ${responseText.length}`);
                    
                    // Handle tool calls if present
                    if (message.tool_calls) {
                        toolCalls = message.tool_calls;
                    }
                    break;
                case 'Ollama':
                    responseText = responseData.response || '';
                    log(`Ollama response text extracted, length: ${responseText.length}`);
                    
                    // Check for tool calls in Ollama response
                    if (this._toolCallingEnabled) {
                        // Look for tool call format in the response
                        const toolCallMatch = responseText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
                        if (toolCallMatch) {
                            try {
                                const toolCallData = JSON.parse(toolCallMatch[1]);
                                toolCalls = [{
                                    function: {
                                        name: toolCallData.name,
                                        arguments: JSON.stringify(toolCallData.arguments)
                                    }
                                }];
                                // Remove the tool call from the response text
                                responseText = responseText.replace(/<tool_call>[\s\S]*?<\/tool_call>/, '').trim();
                                log(`Ollama response after removing tool call, length: ${responseText.length}`);
                            } catch (e) {
                                log(`Error parsing tool call: ${e.message}`);
                            }
                        }
                    }
                    break;
                case 'Gemini':
                    responseText = responseData.candidates[0].content.parts[0].text || '';
                    log(`Gemini response text extracted, length: ${responseText.length}`);
                    break;
                case 'Anthropic':
                    responseText = responseData.completion || '';
                    log(`Anthropic response text extracted, length: ${responseText.length}`);
                    break;
                case 'Llama':
                    responseText = responseData.choices[0].message.content || '';
                    log(`Llama response text extracted, length: ${responseText.length}`);
                    break;
                default:
                    responseText = 'Error: Unknown provider response format';
                    log(`Unknown provider: ${providerName}`);
            }

            // Execute tool calls if any
            if (toolCalls.length > 0) {
                log(`Received ${toolCalls.length} tool calls`);
                
                // Create an array of promises for all tool calls
                const toolPromises = toolCalls.map(toolCall => {
                    return new Promise((resolve, reject) => {
                        try {
                            const result = this._executeToolCall({
                                name: toolCall.function.name,
                                arguments: JSON.parse(toolCall.function.arguments)
                            });
                            
                            if (result instanceof Promise) {
                                result.then(resolve).catch(reject);
                            } else {
                                resolve(result);
                            }
                        } catch (error) {
                            reject(error);
                        }
                    });
                });

                // Wait for all tool calls to complete
                Promise.all(toolPromises)
                    .then(results => {
                        const toolResults = results.map((result, index) => ({
                            name: toolCalls[index].function.name,
                            result: result
                        }));

                        // If we have tool results, make a follow-up request
                        if (toolResults.length > 0) {
                            const toolResultsText = toolResults.map(result => 
                                `Tool '${result.name}' returned:\n${result.result}`
                            ).join('\n\n');

                            const followUpPrompt = `${responseText}\n\nTool results:\n${toolResultsText}\n\nPlease provide a complete response using the tool results above. Include relevant information from the search results and cite sources when available.`;
                            
                            log('Making follow-up request with tool results');
                            
                            this._makeFollowUpRequest(followUpPrompt, toolResults);
                        }
                    })
                    .catch(error => {
                        log(`Error executing tool calls: ${error.message}`);
                        this._addMessage(`Error executing tool calls: ${error.message}`, 'ai');
                    });
                return;
            }

            if (responseText) {
                log(`${providerName} API Response ready to display, contains <think> tags: ${responseText.includes('<think>')}, length: ${responseText.length}`);
                this._addMessage(responseText, 'ai');
            } else {
                log(`Warning: Empty ${providerName} response, not displaying anything`);
            }
        } catch (e) {
            log(`Error parsing response: ${e.message}`);
            this._addMessage(`Error parsing response: ${e.message} (${providerName})`, 'ai');
        }
    }

    _makeFollowUpRequest(originalResponse, toolResults) {
        const serviceProvider = this._settings.get_string('service-provider');
        const toolResultsText = toolResults.map(result => 
            `Tool '${result.name}' returned:\n${result.result}`
        ).join('\n\n');

        const followUpPrompt = `${originalResponse}\n\nTool results:\n${toolResultsText}\n\nPlease provide a complete response using the tool results above. Include relevant information from the search results and cite sources when available.`;

        log('Making follow-up request with tool results');
        log(`Follow-up prompt: ${followUpPrompt}`);
        
        switch (serviceProvider) {
            case 'ollama':
                this._callOllama(followUpPrompt);
                break;
            case 'openai':
                this._callOpenAI(followUpPrompt);
                break;
            case 'gemini':
                this._callGemini(followUpPrompt);
                break;
            case 'anthropic':
                this._callAnthropic(followUpPrompt);
                break;
            case 'llama':
                this._callLlama(followUpPrompt);
                break;
            default:
                this._addMessage('Error: Unknown service provider', 'ai');
        }
    }

    _addMessage(text, sender, thinking = false) {
        // Ensure text is a string and not null or undefined
        if (text === null || text === undefined) {
            text = '';
        }
        
        // Log the original message for debugging
        log(`Adding message from ${sender}, thinking=${thinking}, text length=${text.length}`);
        if (text.length > 0 && text.length < 100) {
            log(`Message content: ${text}`);
        }

        // Check if this is a thinking message (explicit thinking flag)
        if (this._settings.get_boolean('hide-thinking') && thinking) {
            log('Skipping explicit thinking message');
            return;
        }
        
        // Handle <think> tags if present
        const thinkTagPattern = /<think>([\s\S]*?)<\/think>/;
        const hasThinkTags = thinkTagPattern.test(text);
        
        if (hasThinkTags) {
            log('Message contains thinking tags');
            // Remove the thinking part but keep the rest of the message
            text = text.replace(thinkTagPattern, '');
            
            // Trim any resulting whitespace and check if there's anything left
            text = text.trim();
            
            if (text.length === 0) {
                log('Message was only thinking content, skipping');
                return;
            }
            
            log(`After removing thinking tags, message length: ${text.length}`);
        }

        const messageBox = new St.BoxLayout({
            style_class: `llm-chat-message llm-chat-message-${sender}`,
            vertical: true
        });

        const messageText = new St.Label({
            text: text,
            style_class: 'llm-chat-message-text',
            y_expand: true
        });

        // Set line wrap properties on the Clutter.Text inside the St.Label
        messageText.clutter_text.line_wrap = true;
        messageText.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        messageText.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        messageText.clutter_text.single_line_mode = false;

        // Create a container to ensure proper spacing
        const textContainer = new St.BoxLayout({
            vertical: true,
            style_class: 'llm-chat-text-container',
            x_expand: true
        });

        // Add text to container, then container to message box
        textContainer.add_child(messageText);
        messageBox.add_child(textContainer);

        this._messageContainer.add_child(messageBox);
        this._adjustWindowHeight();

        // Scroll to the bottom - ensure this happens after the UI has updated
        // Use a small delay to ensure the message is fully rendered before scrolling
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (this._scrollView && this._scrollView.vscroll && this._scrollView.vscroll.adjustment) {
                // Ensure we scroll to the very bottom
                this._scrollView.vscroll.adjustment.value = this._scrollView.vscroll.adjustment.upper - this._scrollView.vscroll.adjustment.page_size;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _adjustWindowHeight() {
        // Calculate total height of messages
        let totalHeight = 0;
        this._messageContainer.get_children().forEach(child => {
            totalHeight += child.get_height();
        });

        // Add height for input area and padding
        const inputHeight = this._entryText.get_height() + 40; // 40px for padding and buttons
        totalHeight += inputHeight;

        // Limit height to maximum
        const height = Math.min(totalHeight, this._maxInitialHeight);

        // Set the height of the chat box
        this.actor.height = Math.max(height, this._initialHeight);
    }

    _prepareContext() {
        if (!this._contextEnabled) {
            return "";
        }

        // Basic system information
        const systemInfo = getSystemInfo();
        const kernelAndUptime = getKernelAndUptime();
        const detailedCpuInfo = getDetailedCpuInfo();
        const gpuInfo = getGpuInfo();
        
        // Resource usage
        const cpuUsage = getCpuUsage();
        const diskUsage = getDiskUsage();
        const networkInfo = getNetworkInfo();
        
        // Window and workspace information
        const workspace = getCurrentWorkspaceInfo();
        const focusedWindowTitle = getFocusedWindowTitle();
        const runningApps = getRunningApps();
        
        // User selection and clipboard
        const selectedText = getSelectedText();
        const clipboardContent = getClipboardContent();
        
        // Process information
        const topProcesses = getTopProcesses(10);
        
        // Get open windows last to ensure we have the most up-to-date information
        const openWindows = getOpenWindows();

        // Build the context string
        let contextString = "--- System Context ---\n";
        contextString += `${systemInfo}\n`;
        if (detailedCpuInfo) contextString += detailedCpuInfo;
        if (gpuInfo) contextString += `${gpuInfo}\n`;
        contextString += `${cpuUsage}\n`;
        contextString += `${diskUsage}\n`;
        contextString += kernelAndUptime + "\n";
        contextString += networkInfo;
        contextString += `Current Workspace: ${workspace}\n`;
        contextString += `Focused Window: ${focusedWindowTitle}\n`;

        // Add clipboard content if available
        if (clipboardContent) {
            contextString += "Clipboard Content:\n";
            contextString += `  ${clipboardContent.replace(/\n/g, '\n  ')}\n`;
        }
        
        // Add selected text if available
        if (selectedText) {
            contextString += "Selected Text:\n";
            contextString += `  ${selectedText.replace(/\n/g, '\n  ')}\n`;
        }

        // Add running applications
        if (runningApps.length > 0) {
            contextString += "Running Applications:\n";
            runningApps.forEach(app => {
                contextString += `  - ${app.name} (${app.windows} windows)\n`;
            });
        }

        // Add top processes information
        if (topProcesses && topProcesses.length > 0) {
            contextString += "Top Processes (CPU/Memory):\n";
            topProcesses.forEach(proc => {
                // Start with basic process info that should always be available
                let processInfo = `  - ${proc.command || 'Unknown'} (PID ${proc.pid || 'Unknown'})`;
                
                // Add CPU info if available
                if (proc.cpu && proc.cpu !== 'N/A') {
                    processInfo += `, CPU: ${proc.cpu}`;
                }
                
                // Add memory info if available
                if (proc.memory && proc.memory !== 'N/A') {
                    processInfo += `, Mem: ${proc.memory}`;
                }
                
                // Add user info if available
                if (proc.user) {
                    processInfo += `, User: ${proc.user}`;
                }
                
                contextString += processInfo + "\n";
            });
        }
        
        // Display open windows with more details
        if (openWindows.length > 0) {
            contextString += "Open Windows:\n";
            openWindows.forEach(window => {
                const workspaceInfo = window.onCurrentWorkspace ? " (current workspace)" : 
                                     (window.workspace > 0 ? ` (workspace ${window.workspace})` : "");
                const minimizedInfo = window.minimized ? " [minimized]" : "";
                contextString += `  - ${window.title}${workspaceInfo}${minimizedInfo}, App: ${window.application}\n`;
            });
        } else {
            contextString += "Open Windows: None\n";
        }
        
        contextString += "--- End System Context ---\n\n";
        return contextString;
    }

    _handleShellCommand(text) {
        const lowerText = text.toLowerCase();
        for (const [command, handler] of Object.entries(this._shellCommands)) {
            if (lowerText.startsWith(command)) {
                const params = text.slice(command.length).trim().split(/\s+/);
                const success = handler(params);
                return success ? 
                    `Successfully executed: ${text}` : 
                    `Failed to execute: ${text}`;
            }
        }
        return null;
    }

    // Add method to clear session
    clearSession() {
        this._messages = [];
        this._lastSearchResults = null;
        this._lastSearchQuery = null;
        this._lastSearchUrls.clear();
        this._sessionId = GLib.uuid_string_random();
        
        // Clear the message container
        if (this._messageContainer) {
            this._messageContainer.destroy_all_children();
        }
        
        log(`New session started with ID: ${this._sessionId}`);
    }
}

var LLMChatButton = GObject.registerClass(
class LLMChatButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'LLM Chat');

        this._settings = settings;

        // Add icon to the panel
        const icon = new St.Icon({
            icon_name: 'system-run-symbolic',
            style_class: 'system-status-icon'
        });
        this.add_child(icon);

        // Create the chat box
        this._chatBox = new LLMChatBox(this._settings);

        // Add chat box to the menu
        this.menu.box.add_child(this._chatBox.actor);

        // Set focus to the text entry when the menu is opened:
        this.menu._openStateId = this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
               // Use a slightly longer delay and grab_key_focus
               GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                   this._chatBox._entryText.grab_key_focus();
                   this._chatBox._entryText.clutter_text.set_cursor_visible(true);
                   return GLib.SOURCE_REMOVE;
               });
            }
        });
    }
});


class Extension {
    constructor() {
        this._button = null;
        this._settings = null;
    }

    enable() {
        this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.llmchat');
        this._button = new LLMChatButton(this._settings);
        Main.panel.addToStatusArea('llm-chat', this._button);
        
        // Clear any existing session when the extension is enabled
        if (this._button._chatBox) {
            this._button._chatBox.clearSession();
        }
    }

    disable() {
        if (this._button) {
            // Clear the session before disabling
            if (this._button._chatBox) {
                this._button._chatBox.clearSession();
            }
            
            // First disconnect all signal handlers
            if (this._button._chatBox) {
                // Disconnect signal handlers from the chat box
                if (this._button._chatBox._entryText) {
                    // Disconnect specific signal handlers
                    if (this._button._chatBox._entryText.clutter_text) {
                        const text = this._button._chatBox._entryText.clutter_text;
                        // Disconnect key-press-event handler
                        if (text._keyPressHandlerId) {
                            text.disconnect(text._keyPressHandlerId);
                        }
                        // Disconnect activate handler
                        if (text._activateHandlerId) {
                            text.disconnect(text._activateHandlerId);
                        }
                        // Disconnect multi-line handler
                        if (text._multiLineHandlerId) {
                            text.disconnect(text._multiLineHandlerId);
                        }
                    }
                    
                    if (this._button._chatBox._clickAction) {
                        this._button._chatBox._clickAction.disconnect_all();
                        this._button._chatBox._clickAction.destroy();
                    }
                }

                if (this._button._chatBox._contextToggleButton) {
                    if (this._button._chatBox._contextToggleButton._clickHandlerId) {
                        this._button._chatBox._contextToggleButton.disconnect(this._button._chatBox._contextToggleButton._clickHandlerId);
                    }
                }

                if (this._button._chatBox._toolCallingToggleButton) {
                    if (this._button._chatBox._toolCallingToggleButton._clickHandlerId) {
                        this._button._chatBox._toolCallingToggleButton.disconnect(this._button._chatBox._toolCallingToggleButton._clickHandlerId);
                    }
                }

                // Remove all children from containers
                if (this._button._chatBox._messageContainer) {
                    this._button._chatBox._messageContainer.destroy_all_children();
                }

                if (this._button._chatBox._scrollView) {
                    this._button._chatBox._scrollView.destroy_all_children();
                }

                // Clear arrays and objects
                this._button._chatBox._messages = [];
                this._button._chatBox._shellCommands = {};
                this._button._chatBox._availableTools = [];

                // Destroy the chat box actor
                if (this._button._chatBox.actor) {
                    this._button._chatBox.actor.destroy_all_children();
                    this._button._chatBox.actor.destroy();
                }
            }

            // Handle menu signals properly - store signal IDs in _init and disconnect them here
            if (this._button.menu) {
                // In GNOME Shell, menu typically has _openStateId for the open-state-changed signal
                // This approach disconnects signals without relying on disconnect_all
                const signals = this._button.menu._signals || [];
                if (Array.isArray(signals)) {
                    signals.forEach(signalId => {
                        if (signalId) {
                            try {
                                this._button.menu.disconnect(signalId);
                            } catch (e) {
                                log(`Error disconnecting signal: ${e.message}`);
                            }
                        }
                    });
                }
                // Also try to disconnect the menu's open-state-changed signal if we have its ID
                if (this._button.menu._openStateId) {
                    try {
                        this._button.menu.disconnect(this._button.menu._openStateId);
                    } catch (e) {
                        log(`Error disconnecting open-state-changed: ${e.message}`);
                    }
                }
                
                // Clean up menu children properly
                try {
                    // The menu's box contains the actual children
                    if (this._button.menu.box) {
                        // Get children and destroy each one
                        const children = this._button.menu.box.get_children() || [];
                        children.forEach(child => {
                            if (child) {
                                this._button.menu.box.remove_child(child);
                                child.destroy();
                            }
                        });
                    }
                } catch (e) {
                    log(`Error cleaning up menu children: ${e.message}`);
                }
            }

            // Remove from panel and destroy the button
            try {
                if (Main.panel.statusArea['llm-chat']) {
                    Main.panel.statusArea['llm-chat'].destroy();
                }
            } catch (e) {
                log(`Error removing from panel: ${e.message}`);
            }
            
            this._button.destroy();
            this._button = null;
        }

        if (this._settings) {
            this._settings = null;
        }
    }
}
function init() {
    return new Extension();
}

// Add CSS for the new tool button
const style = `
.llm-chat-tool-button {
    padding: 5px 10px;
    border-radius: 4px;
    background-color: #4a4a4a;
    color: #ffffff;
    margin: 0 5px;
}

.llm-chat-tool-button-selected {
    background-color: #3584e4;
}

.llm-chat-tool-button:hover {
    background-color: #5a5a5a;
}

.llm-chat-tool-button-selected:hover {
    background-color: #4a8fe4;
}
`;