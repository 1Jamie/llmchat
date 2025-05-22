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
        logger.info(f"Loading model: {model_name}")
        model = SentenceTransformer(model_name)
        logger.info("Model loaded successfully")
        
        # Ensure collections exist
        ensure_collection('memories')
        ensure_collection('tools')
        ensure_collection('llm_memories')
        ensure_collection('conversation_history')
        
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        logger.error(traceback.format_exc())
        model = None

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
        ensure_collection(namespace)

        # Generate embeddings for all documents
        texts = [doc['text'] for doc in documents]
        embeddings = model.encode(texts, show_progress_bar=False)

        # Create points with UUIDs
        points = []
        for doc, embedding in zip(documents, embeddings):
            try:
                doc_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, doc['id']))
                point = models.PointStruct(
                    id=doc_id,
                    vector=embedding.tolist(),
                    payload={
                        'text': doc['text'],
                        'original_id': doc['id'],
                        'namespace': namespace,
                        'context': doc.get('context', {})
                    }
                )
                points.append(point)
            except Exception as e:
                logger.warning(f"Error processing document {doc.get('id', 'unknown')}: {str(e)}")
                continue

        if not points:
            logger.error("No valid points to index")
            return jsonify({
                'status': 'error',
                'error': 'No valid points to index',
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
            logger.error(f"Error during upsert: {str(e)}")
            logger.error(traceback.format_exc())
            return jsonify({
                'status': 'error',
                'error': f'Error during upsert: {str(e)}',
                'count': 0
            }), 500

    except Exception as e:
        logger.error(f"Error in index_documents: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({
            'status': 'error',
            'error': str(e),
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
            results = client.search(
                collection_name=namespace,
                query_vector=query_embedding.tolist(),
                limit=top_k,
                score_threshold=min_score
            )
            
            # Format results
            formatted_results = []
            for result in results:
                formatted_results.append({
                    'id': result.payload.get('original_id', str(result.id)),
                    'text': result.payload.get('text', ''),
                    'score': result.score,
                    'context': result.payload.get('context', {})
                })
            
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
        # Ensure collections exist
        ensure_collection('tools')
        ensure_collection('memories')
        ensure_collection('llm_memories')
        ensure_collection('conversation_history')
        
        return jsonify({
            'status': 'healthy',
            'model_loaded': model is not None
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