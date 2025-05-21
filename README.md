# LLM Chat GNOME Shell Extension

A seamless integration of AI into your GNOME desktop environment. Chat naturally with AI assistants that understand your system, can help manage windows and workspaces, and execute desktop tasks - all through a native interface. Making your desktop experience smarter and more efficient.

> **Note**: Currently, only the Ollama provider and LlamaCPP are verified working with tool calls. Other providers were built based on documentation and may require additional configuration.

## Table of Contents
- [Features](#features)
- [Architecture](#architecture)
  - [Process Flow](#process-flow)
  - [Memory System](#memory-system)
  - [Tool System](#tool-system)
- [Python Qdrant Service](#python-qdrant-service)
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
- Semantic memory storage using Qdrant vector database
- Automatic indexing and retrieval
- Context-aware responses
- Memory search capabilities
- Efficient vector similarity search
- Autonomous memory creation by the LLM
- Context token management for conversation history

#### Implementation
- Local Qdrant server for vector storage
- Sentence transformers for embeddings
- Automatic persistence management
- Tool system integration
- LLM-driven memory creation
- Configurable context window size

#### Memory Creation
The LLM autonomously creates memories based on user interactions:
- Personal information (name, location, preferences)
- Important decisions and choices
- Technical configurations
- User preferences and settings
- Significant conversation context

The LLM uses a dedicated memory tool to store information:
```json
{
  "tool": "add_memory",
  "arguments": {
    "text": "Memory content",
    "context": {
      "type": "memory_type",
      "importance": "high/normal/low",
      "tags": ["relevant", "tags"]
    }
  }
}
```

#### Context Management
- Configurable maximum context tokens (default: 2000)
- Smart conversation history pruning
- Priority-based message retention
- Automatic context summarization
- Memory-based context enhancement

#### Directory Structure
```
qdrant/          # Qdrant vector database storage
logs/            # Server and extension logs
```

> **Note**: The `qdrant/` and `logs/` directories are gitignored to prevent committing sensitive data.

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

## Python Qdrant Service

The extension includes a Python-based Qdrant service that provides vector storage and semantic search capabilities for the memory system.

### Service Overview
- Runs as a local Flask server on port 5000
- Uses Qdrant for efficient vector storage and retrieval
- Uses the `sentence-transformers` library with the `all-MiniLM-L6-v2` model
- Provides REST API endpoints for memory management
- Handles persistent storage of vectors and metadata

### API Endpoints
1. **GET /health**
   - Returns service health status
   - Shows model loading status
   - Reports system information

2. **POST /index**
   - Indexes new documents in Qdrant collections
   - Stores vectors and metadata in specified namespace
   - Persists data to disk automatically

3. **POST /search**
   - Performs semantic search across collections
   - Returns top-k most relevant results
   - Uses cosine similarity with configurable threshold

### Storage Structure
```
~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/
├── qdrant/              # Qdrant vector database
│   ├── collections/     # Vector collections
│   │   ├── memories    # User conversation memories
│   │   └── tools       # Tool descriptions
│   └── snapshots/      # Database snapshots
```

## Installation

1. Install the extension:
   ```bash
   git clone https://github.com/yourusername/llmchat.git
   cp llmchat ~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/

   ```

2. Install Python dependencies:
   ```bash
   pip install --user sentence-transformers flask qdrant-client
   ```

3. Restart GNOME Shell:
   - Press Alt+F2
   - Type 'r' and press Enter

## Configuration

The extension can be configured through the GNOME Extensions app:

1. Open GNOME Extensions
2. Find "LLM Chat"
3. Click the settings icon
4. Configure:
   - AI Provider settings
   - Model selection
   - Temperature
   - Memory settings
   - Tool preferences

## Usage

1. Click the LLM Chat icon in the top panel
2. Type your message in the input box
3. Press Enter or click Send
4. The AI will respond and can:
   - Execute system commands
   - Manage windows
   - Search the web
   - Control applications
   - Remember context

## Development

### Prerequisites
- GNOME Shell development environment
- Python 3.6+
- Node.js and npm
- Make

### Building
```bash
make build
```

### Testing
```bash
make test
```

## Troubleshooting

### Common Issues

1. **Python Server Not Starting**
   - Check Python installation
   - Verify dependencies are installed
   - Check logs in `~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/logs/`

2. **Memory System Issues**
   - Verify Qdrant server is running
   - Check collection permissions
   - Clear and reindex if needed

3. **Tool Execution Failures**
   - Check tool permissions
   - Verify system requirements
   - Review error logs

### Logs

Logs are stored in:
```
~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/logs/
```

## Testing

The extension includes automated tests:

```bash
# Run all tests
make test

# Run specific test suite
make test-unit
make test-integration
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
