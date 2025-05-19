'use strict';

const { GObject, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

// Helper: restrict all file operations to user's home directory
const HOME_DIR = GLib.get_home_dir();
function expandHome(path) {
    if (!path) return path;
    if (path === '~') return HOME_DIR;
    if (path.startsWith('~/')) return HOME_DIR + path.slice(1);
    return path;
}
function isSafePath(path) {
    if (!path) return false;
    const expanded = expandHome(path);
    const absPath = GLib.build_filenamev([expanded.startsWith('/') ? expanded : `${HOME_DIR}/${expanded}`]);
    return absPath.startsWith(HOME_DIR);
}

// Helper: limit output size
function limitOutput(output, maxLen = 4096) {
    if (output.length > maxLen) {
        return output.substring(0, maxLen) + '\n...[output truncated]';
    }
    return output;
}

function isDangerousAction(action) {
    return [
        'delete', 'move', 'write', 'append', 'chmod', 'chown', 'archive', 'extract'
    ].includes(action);
}

var Tool = GObject.registerClass(
class FileOperationsTool extends BaseTool {
    _init() {
        super._init({
            name: 'file_operations',
            description: 'Perform file and directory operations using safe console commands. Only files and directories within your home directory (~/) are allowed. Use relative paths starting with ~/ (e.g., ~/Documents) to access files and folders. Absolute or system paths are not permitted. Example: {"tool": "file_operations", "arguments": {"action": "list", "path": "~/Documents"}}. Supports listing, reading, writing, copying, moving, deleting, searching, and more.',
            category: 'system',
            parameters: {
                action: {
                    type: 'string',
                    enum: [
                        'list', 'read', 'write', 'append', 'copy', 'move', 'delete',
                        'create_file', 'create_dir', 'stat', 'search', 'chmod', 'chown',
                        'archive', 'extract', 'checksum'
                    ],
                    description: 'The file operation to perform'
                },
                path: {
                    type: 'string',
                    description: 'Path to the file or directory. Only paths within your home directory are allowed. Use relative paths starting with ~/ (e.g., ~/Documents).'
                },
                target: {
                    type: 'string',
                    description: 'Target path for copy/move/rename (if applicable)'
                },
                content: {
                    type: 'string',
                    description: 'Content to write or append (if applicable)'
                },
                pattern: {
                    type: 'string',
                    description: 'Pattern to search for (if applicable)'
                },
                options: {
                    type: 'object',
                    description: 'Additional options for the operation'
                },
                confirm: {
                    type: 'boolean',
                    description: 'Confirm the operation'
                }
            }
        });
    }

    execute(params = {}) {
        const { action, path, target, content, pattern, options, confirm } = params;
        if (!action) return { error: 'Missing action parameter' };
        let cmd = [];
        let expandedPath = path ? expandHome(path) : null;
        let expandedTarget = target ? expandHome(target) : null;
        let safePath = expandedPath && isSafePath(expandedPath) ? expandedPath : null;
        let safeTarget = expandedTarget && isSafePath(expandedTarget) ? expandedTarget : null;
        // Only allow actions within home dir
        if (path && !safePath) return { error: 'Path is not allowed' };
        if (target && !safeTarget) return { error: 'Target path is not allowed' };

        // Require confirmation for dangerous actions
        if (isDangerousAction(action) && !confirm) {
            let summary = `⚠️ Confirmation required for dangerous action.\nAction: ${action}\nPath: ${path}`;
            if (target) summary += `\nTarget: ${target}`;
            if (action === 'write' || action === 'append') summary += `\nContent: ${content ? content.substring(0, 100) : ''}`;
            return {
                confirmation_required: true,
                summary,
                params: { ...params, confirm: true, tool: 'file_operations' }
            };
        }

        try {
            switch (action) {
                case 'list':
                    cmd = ['ls', '-lah', safePath || HOME_DIR];
                    break;
                case 'read':
                    cmd = ['head', '-c', '4096', safePath];
                    break;
                case 'write':
                    if (!content) return { error: 'Missing content for write' };
                    // Use echo and overwrite
                    cmd = ['bash', '-c', `echo ${GLib.shell_quote(content)} > ${GLib.shell_quote(safePath)}`];
                    break;
                case 'append':
                    if (!content) return { error: 'Missing content for append' };
                    cmd = ['bash', '-c', `echo ${GLib.shell_quote(content)} >> ${GLib.shell_quote(safePath)}`];
                    break;
                case 'copy':
                    if (!safeTarget) return { error: 'Missing or invalid target for copy' };
                    cmd = ['cp', '-r', safePath, safeTarget];
                    break;
                case 'move':
                    if (!safeTarget) return { error: 'Missing or invalid target for move' };
                    cmd = ['mv', safePath, safeTarget];
                    break;
                case 'delete':
                    // Only allow deleting files, not directories recursively
                    cmd = ['rm', '-f', safePath];
                    break;
                case 'create_file':
                    cmd = ['touch', safePath];
                    break;
                case 'create_dir':
                    cmd = ['mkdir', '-p', safePath];
                    break;
                case 'stat':
                    cmd = ['stat', safePath];
                    break;
                case 'search':
                    if (!pattern) return { error: 'Missing pattern for search' };
                    cmd = ['grep', '-rnI', pattern, safePath || HOME_DIR];
                    break;
                case 'chmod':
                    if (!options || !options.mode) return { error: 'Missing mode in options for chmod' };
                    cmd = ['chmod', options.mode, safePath];
                    break;
                case 'chown':
                    if (!options || !options.owner) return { error: 'Missing owner in options for chown' };
                    cmd = ['chown', options.owner, safePath];
                    break;
                case 'archive':
                    if (!safeTarget) return { error: 'Missing or invalid target for archive' };
                    cmd = ['tar', '-czf', safeTarget, '-C', GLib.path_get_dirname(safePath), GLib.path_get_basename(safePath)];
                    break;
                case 'extract':
                    if (!safeTarget) return { error: 'Missing or invalid target for extract' };
                    cmd = ['tar', '-xzf', safePath, '-C', safeTarget];
                    break;
                case 'checksum':
                    cmd = ['sha256sum', safePath];
                    break;
                default:
                    return { error: 'Unknown action' };
            }

            // Run the command
            let proc = Gio.Subprocess.new(cmd, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            let [ok, stdout, stderr] = proc.communicate_utf8(null, null);
            let out = (stdout || '').trim();
            let err = (stderr || '').trim();
            let msg;
            if (ok && (!err || err.length === 0)) {
                msg = `✅ File operation '${action}' succeeded${safePath ? ' on ' + safePath : ''}${safeTarget ? ' to ' + safeTarget : ''}.`;
            } else if (ok && err) {
                msg = `⚠️ File operation '${action}' completed with warnings: ${err}`;
            } else {
                msg = `❌ File operation '${action}' failed${safePath ? ' on ' + safePath : ''}${err ? ': ' + err : ''}`;
            }
            return {
                success: ok,
                action,
                path: safePath,
                target: safeTarget,
                output: limitOutput(out),
                message: msg,
                error: err ? limitOutput(err) : undefined
            };
        } catch (e) {
            return {
                success: false,
                action,
                path: safePath,
                target: safeTarget,
                output: '',
                message: `❌ File operation '${action}' failed: ${e.message}`,
                error: `Failed to execute file operation: ${e.message}`
            };
        }
    }
}); 