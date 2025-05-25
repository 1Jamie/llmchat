#!/usr/bin/env python3
# qdrant_server.py - Qdrant-based vector store server for semantic search

import os
import json
import logging
import traceback
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import torch
import threading
import signal
import sys
import datetime
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams
from qdrant_client.http.exceptions import UnexpectedResponse
import uuid
from socket import error as socket_error
from llama_cpp import Llama
import numpy as np
import requests
from tqdm import tqdm
import subprocess
import pkg_resources

# Configure logging
log_dir = os.path.expanduser("~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/logs")
try:
    os.makedirs(log_dir, exist_ok=True)
except Exception as e:
    print(f"Warning: Could not create log directory: {e}")

log_file = os.path.join(log_dir, f"qdrant_server_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

# Configure logging with error handling for broken pipes
class SafeStreamHandler(logging.StreamHandler):
    def emit(self, record):
        try:
            msg = self.format(record)
            try:
                self.stream.write(msg + self.terminator)
                self.flush()
            except (BrokenPipeError, ConnectionResetError) as e:
                # Ignore broken pipe errors silently
                pass
            except Exception as e:
                self.handleError(record)
        except Exception:
            self.handleError(record)

try:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            SafeStreamHandler(sys.stdout)
        ]
    )
except Exception as e:
    print(f"Warning: Could not initialize file logging: {e}")
    # Fallback to console-only logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[SafeStreamHandler(sys.stdout)]
    )

logger = logging.getLogger('qdrant_server')
logger.info(f"Starting Qdrant server with Python {sys.version}")
logger.info(f"Python executable path: {sys.executable}")

# Log system information
try:
    import platform
    logger.info(f"Platform: {platform.platform()}")
    logger.info(f"Machine: {platform.machine()}")
    logger.info(f"Python version: {platform.python_version()}")
except Exception as e:
    logger.warning(f"Could not get system info: {e}")

# Global variables
model = None
model_name = 'all-MiniLM-L6-v2'  # Smaller, faster model
model_lock = threading.Lock()

# Initialize LLM
llm = None
llm_lock = threading.Lock()
LLM_MODEL_PATH = os.path.expanduser("~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/models/qwen-0.6b.gguf")

def download_file(url, destination):
    """Download a file with progress bar"""
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        # Get total file size
        total_size = int(response.headers.get('content-length', 0))
        
        # Create progress bar
        progress_bar = tqdm(total=total_size, unit='iB', unit_scale=True)
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        
        # Download file with progress bar
        with open(destination, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    progress_bar.update(len(chunk))
        
        progress_bar.close()
        return True
    except Exception as e:
        logger.error(f"Error downloading file: {str(e)}")
        return False

def load_llm():
    """Load the Qwen LLM model"""
    global llm
    try:
        if not os.path.exists(LLM_MODEL_PATH):
            logger.info(f"LLM model not found at {LLM_MODEL_PATH}, downloading...")
            model_url = "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf"
            if download_file(model_url, LLM_MODEL_PATH):
                logger.info("Model downloaded successfully")
            else:
                logger.error("Failed to download model")
            return None
            
        logger.info(f"Loading LLM model from {LLM_MODEL_PATH}")
        llm = Llama(
            model_path=LLM_MODEL_PATH,
            n_ctx=2048,  # Context window
            n_threads=4,  # Number of CPU threads to use
            n_gpu_layers=0  # No GPU acceleration by default
        )
        logger.info("LLM model loaded successfully")
        return llm
    except Exception as e:
        logger.error(f"Error loading LLM model: {str(e)}")
        logger.error(traceback.format_exc())
        return None

def process_memory_with_llm(text, context=None):
    """Process memory text with LLM using dual-pass extraction for personal vs world information"""
    global llm
    if not llm:
        with llm_lock:
            if not llm:
                llm = load_llm()
                if not llm:
                    return {"personal": [], "world_facts": [], "volatile": []}  # Return empty if LLM fails
    
    try:
        # Quick check to avoid processing tool calls and temporary actions
        text_lower = text.lower()
        exclude_keywords = [
            'opened', 'launched', 'executed', 'tool call', 'browser', 'chrome', 'firefox',
            'youtube', 'website', 'application', 'window', 'tab', 'workspace', 'desktop',
            'search results', 'fetched content', 'web search', 'found information',
            'successfully', 'completed', 'finished', 'already ran', 'previously executed',
            'current session', 'right now', 'at the moment', 'temporary', 'cache'
        ]
        
        # If text contains tool/action keywords, skip LLM processing
        if any(keyword in text_lower for keyword in exclude_keywords):
            logger.info(f"Skipping LLM processing for tool/action content: {text[:50]}...")
            return {"personal": [], "world_facts": [], "volatile": []}
        
        # Only process substantial content (avoid short responses)
        if len(text) < 100:
            logger.info(f"Skipping LLM processing for short content: {text[:50]}...")
            return {"personal": [], "world_facts": [], "volatile": []}

        # FIRST PASS: Extract personal information about the user (more selective)
        personal_prompt = f"""Analyze the following conversation and extract ONLY significant personal information about the USER. Focus ONLY on:
- Where they live (specific city, state, country)
- Strong personal preferences (favorite things, dislikes)
- Important personal circumstances (job, family, major life events)
- Significant skills or expertise they mention
- Important goals or plans they share

IGNORE: tool usage, browser actions, temporary requests, search queries, weather questions, or casual conversation.

Conversation: {text}

Extract 1-2 key personal insights ONLY if they are significant and lasting. If no important personal information is found, respond with "NONE".

Personal insights:
1. """
        
        # Generate personal information extraction
        personal_response = llm(
            personal_prompt,
            max_tokens=256,  # Reduced tokens for more focused output
            temperature=0.1,  # Lower temperature for more focused extraction
            stop=["Conversation:", "Context:", "Personal insights:", "2.", "3."],
            echo=False
        )
        
        personal_text = personal_response['choices'][0]['text'].strip()
        personal_memories = []
        
        if personal_text and personal_text != "NONE" and len(personal_text) > 20:
            # Only add if it's substantial and doesn't contain tool/action keywords
            if not any(keyword in personal_text.lower() for keyword in exclude_keywords):
                personal_memories.append(personal_text)
        
        # SECOND PASS: Extract important world facts (more selective)
        world_facts_prompt = f"""Analyze the following conversation and extract ONLY important factual information. Focus ONLY on:
- Significant historical facts or events
- Important scientific or technical information
- Educational content or explanations
- Geographical or cultural information

IGNORE: current events, weather, news, search results, tool outputs, temporary information, or casual conversation.

Conversation: {text}

Extract important facts ONLY if they are educational and lasting. If no important facts are found, respond with "NONE".

Facts:
1. """
        
        # Generate world facts extraction
        facts_response = llm(
            world_facts_prompt,
            max_tokens=256,  # Reduced tokens
            temperature=0.1,  # Lower temperature
            stop=["Conversation:", "Context:", "Facts:", "2.", "3."],
            echo=False
        )
        
        facts_text = facts_response['choices'][0]['text'].strip()
        world_memories = []
        
        if facts_text and facts_text != "NONE" and len(facts_text) > 20:
            # Only add if it's substantial and doesn't contain tool/action keywords
            if not any(keyword in facts_text.lower() for keyword in exclude_keywords):
                world_memories.append(facts_text)

        # Return categorized memories (no volatile memories for now - too noisy)
        result = {
            "personal": personal_memories,
            "world_facts": world_memories,
            "volatile": []  # Disabled volatile memories to reduce noise
        }
        
        logger.info(f"Memory extraction result: {len(result['personal'])} personal, {len(result['world_facts'])} world facts")
        return result
        
    except Exception as e:
        logger.error(f"Error processing memory with LLM: {str(e)}")
        logger.error(traceback.format_exc())
        return {"personal": [], "world_facts": [], "volatile": []}  # Return empty on error

# Initialize Qdrant client
QDRANT_DIR = os.path.expanduser("~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/qdrant")
os.makedirs(QDRANT_DIR, exist_ok=True)

client = QdrantClient(path=QDRANT_DIR)

app = Flask(__name__)

def ensure_collection(collection_name):
    """Ensure a collection exists and has the correct configuration"""
    try:
        try:
            # Try to get collection info
            collection_info = client.get_collection(collection_name)
            logger.debug(f"Collection {collection_name} exists")
            
            # Check if vector size matches our model
            if collection_info.config.params.vectors.size != 384:
                logger.info(f"Recreating collection {collection_name} with correct vector size")
                client.delete_collection(collection_name)
                raise Exception("Vector size mismatch")
                
        except Exception as e:
            logger.info(f"Creating collection {collection_name}")
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=384,
                    distance=Distance.COSINE
                )
            )
            logger.info(f"Created collection {collection_name}")
            
    except Exception as e:
        logger.error(f"Error managing collection {collection_name}: {str(e)}")
        logger.error(traceback.format_exc())
        raise

def load_model():
    """Load the sentence transformer model"""
    global model
    try:
        # Check NumPy version
        np_version = np.__version__
        logger.info(f"NumPy version: {np_version}")
        
        # Ensure NumPy version is compatible
        if not (np_version >= "1.21.6" and np_version < "1.28.0"):
            raise ImportError(
                f"NumPy version {np_version} is not compatible. "
                "Please use NumPy >= 1.21.6 and < 1.28.0. "
                "You can fix this by running: "
                "pip install 'numpy>=1.21.6,<1.28.0'"
            )

        # Check PyTorch version and device
        import torch
        logger.info(f"PyTorch version: {torch.__version__}")
        logger.info(f"CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            logger.info(f"CUDA device: {torch.cuda.get_device_name(0)}")
        
        # Set device
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Using device: {device}")

        logger.info(f"Loading model: {model_name}")
        try:
            model = SentenceTransformer(model_name, device=device)
            logger.info("Model loaded successfully")
        except Exception as e:
            logger.error(f"Error loading model with device {device}: {str(e)}")
            # Try loading without device specification as fallback
            logger.info("Attempting to load model without device specification...")
            model = SentenceTransformer(model_name)
            logger.info("Model loaded successfully without device specification")
        
        # Ensure collections exist
        logger.info("Ensuring collections exist...")
        ensure_collection('memories')
        ensure_collection('tools')
        ensure_collection('llm_memories')
        ensure_collection('conversation_history')
        logger.info("All collections verified")
        
    except ImportError as e:
        logger.error(f"Import error loading model: {str(e)}")
        logger.error(traceback.format_exc())
        model = None
        raise
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        logger.error(traceback.format_exc())
        model = None
        raise

@app.route('/index', methods=['POST'])
def index_documents():
    """Index documents with their embeddings"""
    try:
        data = request.get_json()
        if not data or 'documents' not in data or 'namespace' not in data:
            logger.error("Missing required fields in request")
            return jsonify({
                'status': 'error',
                'error': 'Missing required fields: documents and namespace',
                'count': 0
            }), 400

        namespace = data['namespace']
        documents = data['documents']
        
        logger.info(f"Indexing {len(documents)} documents in namespace {namespace}")

        # Ensure collection exists
        try:
            ensure_collection(namespace)
        except Exception as e:
            error_msg = f"Failed to ensure collection exists: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return jsonify({
                'status': 'error',
                'error': error_msg,
                'count': 0
            }), 500

        # Process documents with LLM if they are memories
        processed_documents = []
        for doc in documents:
            try:
                if namespace == 'memories' or namespace == 'llm_memories':
                    # Quick check to avoid processing tool calls and temporary actions
                    text_lower = doc['text'].lower()
                    exclude_keywords = [
                        'opened', 'launched', 'executed', 'tool call', 'browser', 'chrome', 'firefox',
                        'youtube', 'website', 'application', 'window', 'tab', 'workspace', 'desktop',
                        'search results', 'fetched content', 'web search', 'found information',
                        'successfully', 'completed', 'finished', 'already ran', 'previously executed',
                        'current session', 'right now', 'at the moment', 'temporary', 'cache'
                    ]
                    
                    # Skip processing if it contains tool/action keywords
                    if any(keyword in text_lower for keyword in exclude_keywords):
                        logger.info(f"Skipping tool/action content: {doc['text'][:50]}...")
                        continue
                    
                    # Skip very short content
                    if len(doc['text']) < 100:
                        logger.info(f"Skipping short content: {doc['text'][:50]}...")
                        continue
                    
                    # Process memory with LLM - now returns categorized memories
                    memory_results = process_memory_with_llm(doc['text'], doc.get('context'))
                    
                    # Only create documents if we actually extracted meaningful memories
                    memories_created = False
                    
                    # Create documents for personal memories (user_info namespace)
                    for personal_memory in memory_results.get('personal', []):
                        if personal_memory.strip() and len(personal_memory) > 20:
                            new_doc = doc.copy()
                            new_doc['text'] = personal_memory
                            new_doc['id'] = f"{doc['id']}_personal_{uuid.uuid4().hex[:8]}"
                            new_doc['namespace'] = 'user_info'  # Store personal info separately
                            new_doc['memory_type'] = 'personal'
                            processed_documents.append(new_doc)
                            memories_created = True
                    
                    # Create documents for world facts (world_facts namespace)
                    for world_fact in memory_results.get('world_facts', []):
                        if world_fact.strip() and len(world_fact) > 20:
                            new_doc = doc.copy()
                            new_doc['text'] = world_fact
                            new_doc['id'] = f"{doc['id']}_world_{uuid.uuid4().hex[:8]}"
                            new_doc['namespace'] = 'world_facts'
                            new_doc['memory_type'] = 'world_fact'
                            processed_documents.append(new_doc)
                            memories_created = True
                    
                    # Create documents for volatile memories (volatile_info namespace) - currently disabled
                    for volatile_memory in memory_results.get('volatile', []):
                        if volatile_memory.get('text', '').strip() and len(volatile_memory.get('text', '')) > 20:
                            new_doc = doc.copy()
                            new_doc['text'] = volatile_memory['text']
                            new_doc['id'] = f"{doc['id']}_volatile_{uuid.uuid4().hex[:8]}"
                            new_doc['namespace'] = 'volatile_info'
                            new_doc['memory_type'] = 'volatile'
                            # Add expiration information to context
                            if 'context' not in new_doc:
                                new_doc['context'] = {}
                            new_doc['context']['is_volatile'] = True
                            new_doc['context']['expires_at'] = volatile_memory.get('expires_at')
                            processed_documents.append(new_doc)
                            memories_created = True
                    
                    # If no meaningful memories were extracted, don't store anything
                    if not memories_created:
                        logger.info(f"No meaningful memories extracted from: {doc['text'][:50]}...")
                        continue
                else:
                    # For non-memory documents (like tools), assign the namespace and process directly
                    new_doc = doc.copy()
                    new_doc['namespace'] = namespace  # Assign the namespace parameter
                    processed_documents.append(new_doc)
            except Exception as e:
                logger.warning(f"Error processing document {doc.get('id', 'unknown')}: {str(e)}")
                # For error cases, don't store anything to avoid noise
                continue

        # Ensure all required collections exist
        collections_needed = set([doc.get('namespace', namespace) for doc in processed_documents])
        for collection_name in collections_needed:
            try:
                ensure_collection(collection_name)
            except Exception as e:
                error_msg = f"Failed to ensure collection {collection_name} exists: {str(e)}"
                logger.error(error_msg)
                return jsonify({
                    'status': 'error',
                    'error': error_msg,
                    'count': 0
                }), 500

        # Generate embeddings for all documents
        try:
            texts = [doc['text'] for doc in processed_documents]
            embeddings = model.encode(texts, show_progress_bar=False)
        except Exception as e:
            error_msg = f"Failed to generate embeddings: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return jsonify({
                'status': 'error',
                'error': error_msg,
                'count': 0
            }), 500

        # Create points with UUIDs
        points = []
        for doc, embedding in zip(processed_documents, embeddings):
            try:
                doc_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, doc['id']))
                point = models.PointStruct(
                    id=doc_id,
                    vector=embedding.tolist(),
                    payload={
                        'text': doc['text'],
                        'original_id': doc['id'],
                        'namespace': doc['namespace'],
                        'context': doc.get('context', {}),
                        'processed': doc['namespace'] in ['memories', 'llm_memories']  # Flag if LLM processed
                    }
                )
                points.append(point)
            except Exception as e:
                logger.warning(f"Error processing document {doc.get('id', 'unknown')}: {str(e)}")
                continue

        if not points:
            error_msg = "No valid points to index after processing"
            logger.error(error_msg)
            return jsonify({
                'status': 'error',
                'error': error_msg,
                'count': 0
            }), 400

        # Upsert points in batches
        try:
            client.upsert(
                collection_name=namespace,
                points=points
            )
            logger.info(f"Successfully indexed {len(points)} documents in namespace {namespace}")
            return jsonify({
                'status': 'success',
                'count': len(points),
                'message': f'Successfully indexed {len(points)} documents'
            })
        except Exception as e:
            error_msg = f"Error during upsert: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return jsonify({
                'status': 'error',
                'error': error_msg,
                'count': 0
            }), 500

    except Exception as e:
        error_msg = f"Error in index_documents: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'error': error_msg,
            'count': 0
        }), 500

@app.route('/search', methods=['POST'])
def search_documents():
    """Search for relevant documents"""
    try:
        data = request.get_json()
        logger.info(f"Received search request data: {data}")
        
        if not data or 'query' not in data or 'namespace' not in data:
            logger.error("Missing required fields in search request")
            return jsonify({
                'status': 'error',
                'error': 'Missing required fields: query and namespace',
                'results': []
            }), 400

        query = data['query']
        namespace = data['namespace']
        top_k = data.get('top_k', 3) # Default to 3
        min_score = data.get('min_score', 0.1) # Default minimum score

        logger.info(f"Searching for '{query}' in ['{namespace}'] (top_k={top_k}, min_score={min_score})")

        if not model:
            logger.error("Model not loaded for search")
            return jsonify({
                'status': 'error',
                'error': 'Model not loaded',
                'results': []
            }), 503 # Service Unavailable

        # Generate embedding for query
        query_embedding = model.encode(query, show_progress_bar=False)

        # Search in collection
        try:
            results = client.query_points(
                collection_name=namespace,
                query=query_embedding.tolist(),
                limit=top_k,
                score_threshold=min_score,
                with_payload=True,  # Ensure we get the full payload
                with_vectors=False   # We don't need the vectors in response
            )
            
            # Format results
            formatted_results = []
            for result in results.points:  # Use results.points instead of iterating results directly
                try:
                    # Handle different result formats
                    if hasattr(result, 'id') and hasattr(result, 'payload') and hasattr(result, 'score'):
                        # Standard qdrant result format
                        formatted_results.append({
                            'id': str(result.id),
                            'text': result.payload.get('text', ''),
                            'score': result.score,
                            'context': result.payload.get('context', {})
                        })
                    else:
                        logger.warning(f"Unexpected result format: {type(result)} - {result}")
                        continue
                        
                except Exception as e:
                    logger.warning(f"Error formatting result: {str(e)}")
                    continue
            
            logger.info(f"Found {len(formatted_results)} results")
            return jsonify({
                'status': 'success',
                'results': formatted_results
            })
            
        except Exception as e:
            logger.error(f"Error during search: {str(e)}")
            logger.error(traceback.format_exc())
            return jsonify({
                'status': 'error',
                'error': f'Error during search: {str(e)}',
                'results': []
            }), 500

    except Exception as e:
        logger.error(f"Error in search_documents: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'error': str(e),
            'results': []
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Ensure all collections exist including new memory namespaces
        ensure_collection('tools')
        ensure_collection('memories')
        ensure_collection('llm_memories')
        ensure_collection('conversation_history')
        ensure_collection('user_info')       # Personal information about the user
        ensure_collection('world_facts')     # General world knowledge
        ensure_collection('volatile_info')   # Time-sensitive information
        
        return jsonify({
            'status': 'healthy',
            'model_loaded': model is not None,
            'collections': [
                'tools', 'memories', 'llm_memories', 'conversation_history',
                'user_info', 'world_facts', 'volatile_info'
            ]
        })
    except Exception as e:
        logger.error(f"Error in health check: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/reset', methods=['POST'])
def reset_memory():
    """Reset all namespaces in the vector store except llm_memories"""
    try:
        # Get all collections
        collections = client.get_collections().collections
        for collection in collections:
            collection_name = collection.name
            # Skip llm_memories namespace
            if collection_name == 'llm_memories':
                logger.info("Preserving llm_memories namespace")
                continue
                
            # Delete all points in the collection
            client.delete(collection_name=collection_name, points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="id",
                            match=models.MatchAny(any=list(range(1000000)))  # Large range to match all IDs
                        )
                    ]
                )
            ))
            logger.info(f"Cleared namespace: {collection_name}")
            
        return jsonify({
            'status': 'success',
            'message': 'All namespaces cleared successfully (llm_memories preserved)'
        })
    except Exception as e:
        logger.error(f"Error resetting memory: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/clear', methods=['POST'])
def clear_namespace():
    """Clear a namespace/collection"""
    try:
        data = request.get_json()
        namespace = data.get('namespace')
        
        if not namespace:
            logger.error("No namespace provided in clear request")
            return jsonify({'error': 'No namespace provided'}), 400

        try:
            # Delete the collection
            client.delete_collection(namespace)
            logger.info(f"Cleared namespace: {namespace}")
            
            # Recreate the collection
            ensure_collection(namespace)
            logger.info(f"Recreated namespace: {namespace}")
            
            return jsonify({
                'status': 'success',
                'message': f'Cleared and recreated namespace {namespace}'
            })
        except Exception as e:
            logger.error(f"Error clearing namespace {namespace}: {str(e)}")
            return jsonify({'error': str(e)}), 500
            
    except Exception as e:
        logger.error(f"Error in clear_namespace: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    """Get server status and statistics"""
    try:
        # Get collection info
        collections = client.get_collections().collections
        collection_stats = {}
        for collection in collections:
            try:
                info = client.get_collection(collection.name)
                collection_stats[collection.name] = {
                    'vectors_count': info.vectors_count,
                    'points_count': info.points_count
                }
            except Exception as e:
                logger.warning(f"Could not get stats for collection {collection.name}: {e}")
                collection_stats[collection.name] = {'error': str(e)}

        return jsonify({
            'status': 'ok' if model is not None else 'model_loading_failed',
            'model': model_name,
            'namespaces': [c.name for c in collections],
            'document_counts': {name: stats.get('points_count', 0) for name, stats in collection_stats.items()},
            'python_version': sys.version,
            'torch_version': torch.__version__
        })
    except Exception as e:
        logger.error(f"Error in status endpoint: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info("Received shutdown signal")
    sys.exit(0)

def check_and_install_dependencies():
    """Check and install required dependencies"""
    required_packages = {
        'requests': 'requests',
        'tqdm': 'tqdm'
    }
    
    missing_packages = []
    for package, pip_name in required_packages.items():
        try:
            pkg_resources.require(package)
        except (pkg_resources.DistributionNotFound, pkg_resources.VersionConflict):
            missing_packages.append(pip_name)
    
    if missing_packages:
        logger.info(f"Installing missing dependencies: {', '.join(missing_packages)}")
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install'] + missing_packages)
            logger.info("Dependencies installed successfully")
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install dependencies: {str(e)}")
            return False
    
    return True

# Check dependencies before starting
if not check_and_install_dependencies():
    logger.error("Failed to install required dependencies")
    sys.exit(1)

if __name__ == '__main__':
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Load model in a separate thread
        model_thread = threading.Thread(target=load_model)
        model_thread.daemon = True  # Allow the program to exit even if thread is running
        model_thread.start()
        
        # Start Flask server
        logger.info("Starting Flask server on 127.0.0.1:5000")
        app.run(host='127.0.0.1', port=5000)
    except Exception as e:
        logger.error(f"Fatal error in main thread: {str(e)}")
        logger.error(traceback.format_exc())
        sys.exit(1) 