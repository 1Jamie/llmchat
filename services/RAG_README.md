# RAG Memory System for Tool Description Management

This document explains the Retrieval-Augmented Generation (RAG) memory system implemented for the LLM Chat GNOME Shell extension.

## Overview

The RAG memory system optimizes tool usage by:

1. Storing all tool descriptions and parameters in an embedded vector database
2. Performing semantic search to find relevant tools for each user query
3. Including only the most relevant tool descriptions in the prompt sent to the LLM
4. Reducing token usage and improving response quality

## Components

### 1. MemoryService

Located in `tools/MemoryService.js`, this service:

- Manages the Python-based embedding server
- Loads tool descriptions into the vector database
- Performs semantic search to retrieve relevant tool descriptions
- Formats the results for inclusion in the LLM prompt

### 2. Embedding Server

A Python Flask server that:

- Uses sentence-transformers for semantic embeddings
- Provides an API for indexing and searching tool descriptions
- Uses the all-MiniLM-L6-v2 model for efficient embeddings
- Runs as a background process while the extension is active

### 3. Integration with Providers

The RAG system integrates with all supported LLM providers:

- OpenAI (GPT models)
- Anthropic (Claude models)
- Gemini
- LlamaCPP
- Ollama

## How It Works

1. **Initialization**:
   - On extension start, the MemoryService checks for Python and required libraries
   - If needed, it installs the sentence-transformers package
   - The embedding server starts as a background process
   - All tool descriptions are indexed in the database

2. **Query Processing**:
   - When a user submits a query, it's sent to the memory service
   - The service performs semantic search to find the most relevant tool descriptions
   - Only the top-k (default: 3) most relevant tool descriptions are included in the prompt
   - The LLM can then use the most appropriate tools for the query

3. **Fallback Mechanism**:
   - If the memory service is unavailable or fails, the system falls back to the default behavior
   - If no relevant tools are found, generic guidance is provided instead

## Benefits

- **Reduced Token Usage**: By including only relevant tool descriptions, token usage is significantly reduced
- **Improved Responses**: The LLM can focus on the most appropriate tools for each query
- **Better Performance**: Local embedding computation reduces latency compared to embedding via the LLM API
- **Efficient Resource Usage**: The all-MiniLM-L6-v2 model balances quality and efficiency

## Requirements

- Python 3.6+
- pip package manager
- Internet connection (for initial model download)
- ~100MB disk space for the embedding model

## Troubleshooting

If you encounter issues with the RAG system:

1. Check the logs for Python installation or library errors
2. Ensure the Python server process is running (`ps aux | grep embedding_server.py`)
3. The system will automatically fall back to the standard method if RAG is unavailable
4. You can manually install dependencies with: `pip install --user sentence-transformers flask` 