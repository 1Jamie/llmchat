const { Gio, GLib } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();

// Log levels
const LogLevel = {
    ERROR: 0,
    WARN: 1, 
    INFO: 2,
    DEBUG: 3
};

// Global log level - can be changed to control verbosity
let currentLogLevel = LogLevel.INFO; // Default to INFO level

// Get the log file path
const logFile = Gio.File.new_for_path(`${Me.path}/debug.log`);

// Internal logging function
function _writeLog(level, levelName, message) {
    if (level > currentLogLevel) {
        return; // Skip if level is higher than current setting
    }
    
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] [${levelName}] ${message}`;
    
    // Log to console
    console.log(`[LLMChat] ${formattedMessage}`);
    
    // Only write to file for WARN and ERROR in production
    if (level <= LogLevel.WARN) {
        try {
            const outputStream = logFile.append_to(Gio.FileCreateFlags.NONE, null);
            outputStream.write(`${formattedMessage}\n`, null);
            outputStream.close(null);
        } catch (e) {
            console.log(`[LLMChat] [ERROR] Failed to write to log file: ${e.message}`);
        }
    }
}

// Public logging functions
function error(message) {
    _writeLog(LogLevel.ERROR, 'ERROR', message);
}

function warn(message) {
    _writeLog(LogLevel.WARN, 'WARN', message);
}

function info(message) {
    _writeLog(LogLevel.INFO, 'INFO', message);
}

function debug(message) {
    _writeLog(LogLevel.DEBUG, 'DEBUG', message);
}

// Legacy log function for backward compatibility
function log(message) {
    _writeLog(LogLevel.INFO, 'INFO', message);
}

// Function to set log level
function setLogLevel(level) {
    currentLogLevel = level;
    info(`Log level set to: ${Object.keys(LogLevel)[level]}`);
}

// Export the logger
var Logger = {
    LogLevel: LogLevel,
    setLogLevel: setLogLevel,
    error: error,
    warn: warn,
    info: info,
    debug: debug,
    log: log  // For backward compatibility
}; 