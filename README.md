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
  - Session search

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
   - Markdown processing(maybe... planned at least)

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

The extension includes a robust memory system for persistent storage and retrieval with advanced dual-pass processing:

#### Features
- Semantic memory storage using Qdrant vector database
- **Dual-pass memory extraction** for intelligent categorization
- **Personal vs world knowledge** separation
- **Volatile vs stable information** classification
- Automatic indexing and retrieval
- Context-aware responses
- Memory search capabilities
- Efficient vector similarity search
- Autonomous memory creation by the LLM
- Context token management for conversation history
- Local LLM-based memory extraction using Qwen model
- Automatic memory categorization and tagging
- **Multi-namespace storage** for different memory types

#### Implementation
- Local Qdrant server for vector storage
- Sentence transformers for embeddings
- **Qwen 0.6B model for dual-pass memory processing**
- Automatic persistence management
- Tool system integration
- LLM-driven memory creation
- Configurable context window size
- Local llama.cpp integration for memory processing
- **Intelligent memory routing** to appropriate namespaces

#### Dual-Pass Memory Processing
The system uses an advanced dual-pass extraction process with the local Qwen model:

**First Pass - Personal Information Extraction:**
- User location, preferences, and personal circumstances
- Opinions and viewpoints
- Past experiences and future plans
- Personal habits and lifestyle information
- Individual context and background

**Second Pass - World Knowledge Classification:**
- Factual information about the world
- Current events and news
- Weather and time-sensitive data
- Technical information and explanations
- Historical facts and general knowledge

**Volatility Classification:**
- **VOLATILE**: Time-sensitive information (weather, current events, "today/tomorrow" data)
- **STABLE**: Lasting information (geographical facts, historical data, general knowledge)

#### Memory Storage Namespaces
The system automatically routes memories to specialized collections:

1. **`user_info`**: Personal information about the user
   - Location, preferences, personal circumstances
   - Individual context and background information
   - User-specific settings and choices

2. **`world_facts`**: General world knowledge and stable facts
   - Historical information and geographical data
   - Technical explanations and definitions
   - General knowledge and reference information

3. **`volatile_info`**: Time-sensitive information with expiration
   - Weather forecasts and current conditions
   - Current events and breaking news
   - Temporary system states and time-bound data
   - Automatic expiration based on content type

4. **`conversation_history`**: Dialog context and interaction history
   - Recent conversation exchanges
   - Context for ongoing discussions
   - Interaction patterns and preferences

#### Memory Creation
The LLM autonomously creates and categorizes memories based on user interactions:
- **Intelligent routing** to appropriate namespaces
- **Automatic expiration** for volatile information
- **Importance scoring** for relevance ranking
- **Context preservation** for future reference
- **Duplicate detection** and consolidation

The memory processing system extracts structured information:
```json
{
  "personal": ["User lives in Memphis", "Prefers morning coffee"],
  "world_facts": ["Memphis is in Tennessee", "Coffee contains caffeine"],
  "volatile": [
    {
      "text": "Weather in Memphis: 75°F, thunderstorms likely",
      "expires_at": "2025-05-25T00:00:00Z"
    }
  ]
}
```

#### Context Management
- Configurable maximum context tokens (default: 2000)
- Smart conversation history pruning
- Priority-based message retention
- **Memory-type prioritization** (personal > volatile > facts > history)
- **Expiration-aware filtering** for volatile data

#### Directory Structure
```
qdrant/          # Qdrant vector database storage
├── user_info/          # Personal user information
├── world_facts/        # General world knowledge
├── volatile_info/      # Time-sensitive data with expiration
├── conversation_history/  # Dialog context
└── tools/              # Tool descriptions
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
   - Context length
   - AI Provider settings
   - Reindex session search
   - Model selection
   - Logging level
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
### Python Requirements
- Sentence Transformers
- qdrant-client
- Flask
- Torch



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

This project is licensed under the MIT License - see the LICENSE file for details.
