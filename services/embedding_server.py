#!/usr/bin/env python3
# embedding_server.py - Sentence embeddings server for semantic search

import os
import json
import logging
import traceback
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer, util
import torch
import threading
import signal
import sys
import datetime
import pickle

# Configure logging to file and stdout
log_dir = os.path.expanduser("~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/logs")
try:
    os.makedirs(log_dir, exist_ok=True)
except Exception as e:
    print(f"Warning: Could not create log directory: {e}")

log_file = os.path.join(log_dir, f"embedding_server_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

try:
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout)
        ]
    )
except Exception as e:
    # Fallback to just stdout logging if file logging fails
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    print(f"Warning: Could not initialize file logging: {e}")

logger = logging.getLogger('embedding_server')
logger.info(f"Starting embedding server with Python {sys.version}")
logger.info(f"Python executable path: {sys.executable}")

# Log system information
try:
    import platform
    logger.info(f"Platform: {platform.platform()}")
    logger.info(f"Machine: {platform.machine()}")
    logger.info(f"Python version: {platform.python_version()}")
except Exception as e:
    logger.warning(f"Could not get system info: {e}")

app = Flask(__name__)

# Global variables
model = None
model_name = 'all-MiniLM-L6-v2'  # Smaller, faster model
model_lock = threading.Lock()

# Dictionary to store embeddings and documents for different namespaces
embeddings_store = {}
documents_store = {}

# Path for persistent storage
STORAGE_DIR = os.path.expanduser("~/.local/share/gnome-shell/extensions/llmchat@charja113.gmail.com/embeddings")
os.makedirs(STORAGE_DIR, exist_ok=True)

def save_namespace(namespace):
    """Save embeddings and documents for a namespace to disk"""
    try:
        namespace_dir = os.path.join(STORAGE_DIR, namespace)
        os.makedirs(namespace_dir, exist_ok=True)
        
        # Save embeddings
        if namespace in embeddings_store:
            embeddings_path = os.path.join(namespace_dir, 'embeddings.pkl')
            with open(embeddings_path, 'wb') as f:
                pickle.dump(embeddings_store[namespace], f)
            logger.info(f"Saved embeddings for namespace {namespace}")
        
        # Save documents
        if namespace in documents_store:
            documents_path = os.path.join(namespace_dir, 'documents.json')
            with open(documents_path, 'w') as f:
                json.dump(documents_store[namespace], f)
            logger.info(f"Saved documents for namespace {namespace}")
            
    except Exception as e:
        logger.error(f"Error saving namespace {namespace}: {str(e)}")
        logger.error(traceback.format_exc())

def load_namespace(namespace):
    """Load embeddings and documents for a namespace from disk"""
    try:
        namespace_dir = os.path.join(STORAGE_DIR, namespace)
        if not os.path.exists(namespace_dir):
            return
        
        # Load embeddings
        embeddings_path = os.path.join(namespace_dir, 'embeddings.pkl')
        if os.path.exists(embeddings_path):
            with open(embeddings_path, 'rb') as f:
                embeddings_store[namespace] = pickle.load(f)
            logger.info(f"Loaded embeddings for namespace {namespace}")
        
        # Load documents
        documents_path = os.path.join(namespace_dir, 'documents.json')
        if os.path.exists(documents_path):
            with open(documents_path, 'r') as f:
                documents_store[namespace] = json.load(f)
            logger.info(f"Loaded documents for namespace {namespace}")
            
    except Exception as e:
        logger.error(f"Error loading namespace {namespace}: {str(e)}")
        logger.error(traceback.format_exc())

def load_model():
    global model
    try:
        logger.info(f"Loading model: {model_name}")
        model = SentenceTransformer(model_name)
        logger.info("Model loaded successfully")
        
        # Load existing namespaces
        for namespace in os.listdir(STORAGE_DIR):
            if os.path.isdir(os.path.join(STORAGE_DIR, namespace)):
                load_namespace(namespace)
                
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        logger.error(traceback.format_exc())
        model = None

@app.route('/status', methods=['GET'])
def status():
    global model
    try:
        return jsonify({
            'status': 'ok' if model is not None else 'model_loading_failed',
            'model': model_name,
            'namespaces': list(embeddings_store.keys()),
            'document_counts': {ns: len(docs) for ns, docs in documents_store.items()},
            'python_version': sys.version,
            'torch_version': torch.__version__
        })
    except Exception as e:
        logger.error(f"Error in status endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/index', methods=['POST'])
def index_documents():
    global model
    
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 500
    
    try:
        logger.info("Received indexing request")
        data = request.json
        if 'documents' not in data or 'namespace' not in data:
            return jsonify({'error': 'No documents or namespace provided'}), 400
        
        namespace = data['namespace']
        documents = data['documents']
        
        with model_lock:
            documents_store[namespace] = documents
            logger.info(f"Received {len(documents)} documents to index for namespace {namespace}")
            texts = [doc['text'] for doc in documents]
            
            # Compute embeddings
            embeddings_store[namespace] = model.encode(texts, convert_to_tensor=True)
            
            # Save to disk
            save_namespace(namespace)
            
            logger.info(f"Successfully indexed {len(documents)} documents for namespace {namespace}")
            
            return jsonify({'status': 'success', 'count': len(documents)})
    except Exception as e:
        logger.error(f"Error indexing documents: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/search', methods=['POST'])
def search():
    global model
    
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 500
    
    try:
        data = request.json
        query = data.get('query', '')
        top_k = data.get('top_k', 3)
        namespaces = data.get('namespaces', list(embeddings_store.keys()))
        
        logger.info(f"Received search request for query: {query} in namespaces: {namespaces}")
        
        all_results = []
        
        with model_lock:
            # Compute query embedding once
            query_embedding = model.encode(query, convert_to_tensor=True)
            
            # Search in each namespace
            for namespace in namespaces:
                if namespace not in embeddings_store:
                    logger.warning(f"Namespace {namespace} not found")
                    continue
                
                embeddings = embeddings_store[namespace]
                documents = documents_store[namespace]
                
                if len(documents) == 0:
                    continue
                
                # Compute cosine similarities
                cos_scores = util.cos_sim(query_embedding, embeddings)[0]
                
                # Get top-k results for this namespace
                namespace_top_k = min(top_k, len(documents))
                for idx in torch.topk(cos_scores, k=namespace_top_k).indices:
                    doc = documents[idx]
                    score = cos_scores[idx].item()
                    if score > 0.1:  # Lower threshold for more matches
                        all_results.append({
                            'namespace': namespace,
                            'id': doc['id'],
                            'text': doc['text'],
                            'score': score
                        })
            
            # Sort all results by score and take top_k overall
            all_results.sort(key=lambda x: x['score'], reverse=True)
            top_results = all_results[:top_k]
            
            logger.info(f"Found {len(top_results)} relevant documents across all namespaces")
            
            return jsonify({
                'query': query,
                'results': top_results
            })
    except Exception as e:
        logger.error(f"Error performing search: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/clear', methods=['POST'])
def clear_namespace():
    try:
        data = request.json
        namespace = data.get('namespace')
        
        if namespace:
            if namespace in embeddings_store:
                del embeddings_store[namespace]
            if namespace in documents_store:
                del documents_store[namespace]
                
            # Remove from disk
            namespace_dir = os.path.join(STORAGE_DIR, namespace)
            if os.path.exists(namespace_dir):
                for file in os.listdir(namespace_dir):
                    os.remove(os.path.join(namespace_dir, file))
                os.rmdir(namespace_dir)
                
            logger.info(f"Cleared namespace: {namespace}")
            return jsonify({'status': 'success', 'message': f'Cleared namespace {namespace}'})
        else:
            return jsonify({'error': 'No namespace provided'}), 400
    except Exception as e:
        logger.error(f"Error clearing namespace: {str(e)}")
        return jsonify({'error': str(e)}), 500

def signal_handler(sig, frame):
    logger.info("Shutting down server...")
    # Save all namespaces before shutting down
    for namespace in embeddings_store.keys():
        save_namespace(namespace)
    sys.exit(0)

if __name__ == '__main__':
    # Register signal handler for clean shutdown
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
