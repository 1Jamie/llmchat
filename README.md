# LLM Chat - GNOME Shell Extension

A seamless integration of AI into your GNOME desktop environment. Chat naturally with AI assistants that understand your system, can help manage windows and workspaces, and execute desktop tasks - all through a native interface. Making your desktop experience smarter and more efficient.

> **Note**: Currently, only the Ollama provider and LlamaCPP are verified working with tool calls. Other providers were built based on documentation and may require additional configuration.

## Table of Contents
- [Features](#features)
- [Architecture](#architecture)
  - [Process Flow](#process-flow)
  - [Memory System](#memory-system)
  - [Tool System](#tool-system)
- [Python Embedding Service](#python-embedding-service)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)

## Features

### Core Capabilities
- **Multiple AI Models**: Support for various AI services:
  - Llama (local via API)
  - Ollama (local)

- **Memory System**: Persistent memory storage and retrieval:
  - Stores conversations and context
  - Semantic search for relevant memories
  - Automatic memory indexing
  - Context-aware responses

- **System Integration**: Comprehensive system interaction:
  - Window and workspace management
  - Application control
  - System settings access
  - Resource monitoring
  - Clipboard integration

- **User Interface**:
  - Multi-line text input
  - Smooth scrolling chat history
  - Settings panel
  - Session management
  - Chat persistence

## Architecture

### Process Flow

The extension follows a structured process flow when handling user interactions:

1. **User Input Processing**
   - Message entry in chat interface
   - ProviderAdapter preparation
   - Message formatting

2. **Context Gathering**
   - Memory retrieval via semantic search
   - Tool description loading
   - System context collection
   - Prompt composition

3. **AI Model Interaction**
   - Provider communication (Ollama/Llama)
   - Response generation
   - Tool call detection

4. **Tool Execution**
   - Sequential tool processing
   - User confirmation handling
   - Result collection
   - Context integration

5. **Response Generation**
   - Tool result incorporation
   - Response formatting
   - Markdown processing

6. **Memory Storage**
   - Conversation indexing
   - Vector database storage
   - Context persistence

7. **UI Update**
   - Response display
   - History management
   - Session saving
   - Interface refresh

8. **Error Handling**
   - Network retry logic
   - Tool validation
   - Error messaging
   - Debug logging

### Memory System

The extension includes a robust memory system for persistent storage and retrieval:

#### Features
- Semantic memory storage
- Automatic indexing
- Context-aware responses
- Memory search capabilities

#### Implementation
- Local embedding server for vector storage
- `embeddings/memories` directory structure
- Automatic persistence management
- Tool system integration

#### Directory Structure
```
embeddings/
├── memories/    # Conversation memories and context
└── tools/       # Tool descriptions and embeddings
logs/            # Server and extension logs
```

> **Note**: The `embeddings/` and `logs/` directories are gitignored to prevent committing sensitive data.

### Tool System

The extension uses a modular tool system for system interaction:

#### Core Tools
1. **SystemContextTool**
   - System information
   - Window details
   - Resource usage
   - Clipboard content

2. **WindowManagementTool**
   - Window control
   - Layout management
   - Position/size adjustment

3. **WorkspaceManagementTool**
   - Workspace switching
   - Creation/removal
   - Window movement

4. **WebSearchTool**
   - Brave Search integration
   - Web content fetching
   - Result formatting

5. **ApplicationManagementTool**
   - App launching
   - Process control
   - Installation status

6. **SystemSettingsTool**
   - Display control
   - Volume management
   - Theme settings

#### Tool Safety
- Confirmation system for dangerous actions
- Parameter validation
- Error handling
- User feedback

## Python Embedding Service

The extension includes a Python-based embedding service that provides semantic search capabilities for the memory system.

### Service Overview
- Runs as a local Flask server on port 5000
- Uses the `sentence-transformers` library with the `all-MiniLM-L6-v2` model
- Provides REST API endpoints for memory management
- Handles persistent storage of embeddings and documents

### API Endpoints
1. **GET /status**
   - Returns service status and configuration
   - Shows loaded namespaces and document counts
   - Reports model and system information

2. **POST /index**
   - Indexes new documents for semantic search
   - Stores embeddings and documents in specified namespace
   - Persists data to disk automatically

3. **POST /search**
   - Performs semantic search across namespaces
   - Returns top-k most relevant results
   - Uses cosine similarity with configurable threshold

4. **POST /clear**
   - Clears specified namespace
   - Removes embeddings and documents
   - Updates persistent storage

### Storage Structure
```
~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/
├── embeddings/
│   ├── memories/           # User conversation memories
│   │   ├── embeddings.pkl  # Vector embeddings
│   │   └── documents.json  # Memory documents
│   └── tools/             # Tool descriptions
└── logs/                  # Service logs
```

### Integration
- Started automatically with the extension
- Handles memory persistence between sessions
- Provides semantic search for context retrieval
- Manages tool descriptions for AI understanding

### Requirements
- Python 3.x
- sentence-transformers
- Flask
- PyTorch

## Installation

### From Source
1. Clone the repository:
   ```bash
   git clone https://github.com/1Jamie/llmchat.git
   ```

2. Install to extensions directory:
   ```bash
   cp -r llmchat ~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com
   ```

3. Restart GNOME Shell:
   - X11: `Alt+F2`, type `r`, press `Enter`
   - Wayland: Log out and back in

4. Enable the extension:
   ```bash
   gnome-extensions enable llmchat@charja113.gmail.com
   ```

## Configuration

### Provider Setup
1. Select AI Provider (Ollama/Llama)
2. Configure API keys
3. Set server URLs
4. Adjust model parameters

### Brave Search Setup
1. Visit [Brave Search API](https://brave.com/search/api/)
2. Obtain API key
3. Configure in settings
4. Restart extension

## Usage

1. Open chat interface via panel icon
2. Type message and send
3. Interact with AI assistant
4. Use tools as needed

## Development

### Environment Setup
```bash
# Nested GNOME Shell
gnome-shell --nested --wayland --replace

# Schema compilation
cd schemas
glib-compile-schemas .
```

### Custom Tool Development
1. Use `ToolTemplate.js`
2. Implement required methods
3. Add to tools directory
4. Restart extension

## Troubleshooting

### Common Issues
- Extension crashes: Check cleanup procedures
- API failures: Verify keys and connectivity
- UI problems: Update GNOME Shell
- Message display: Check settings

## Testing

### Core Functionality
```bash
# Session Management
start a new chat
view chat history
resume previous chat

# System Interaction
get system info
manage windows
control workspaces

# Web Features
search the web
fetch content
process results
```

### Error Scenarios
```bash
# Test error handling
invalid searches
failed tool calls
network issues
```

## Credits

Developed by 1jamie

## Testing the Extension

Here's a comprehensive list of commands to test the functionality of the extension:

### Session Management
```
start a new chat
view chat history
resume previous chat
delete a chat session
check session information
```

### Web Search and Content
```
search for latest GNOME news
search for a specific recipe
fetch content from a news article
get recipe instructions from a cooking website
search for technical documentation
```

### Display Management
```
get display information
get primary display
set brightness to 50%
toggle night light
```

### Window Management
```
minimize all windows
maximize all windows
maximize current window
arrange windows in grid
move window to x=100 y=100
resize window to width=800 height=600
close current window
```

### System Settings
```
get brightness
set brightness to 50
get volume
set volume to 75
toggle night light
get system theme
```

### Workspace Management
```
list workspaces
switch to workspace 1
create new workspace
remove last workspace
move current window to workspace 2
```

### Application Management
```
list installed applications
list running applications
launch firefox
close firefox
get application window information
```

### Time and Date
```
get current time
get current date
get timezone
get calendar information
```

### System Context
```
show system info
show window information
show detailed system information
get clipboard content
get selected text
get CPU usage
get memory usage
get running processes
```

### Tool Integration
```
search for a recipe and fetch its instructions
search for news and get article content
get system info and launch an application
search for documentation and open it
```

### Error Handling
```
search with invalid query
fetch content from invalid URL
try to access non-existent workspace
try to launch non-existent application
```

### UI Testing
```
test multi-line input
check message history scrolling
verify session history display
test settings panel
check tool status messages
verify source citations
```
