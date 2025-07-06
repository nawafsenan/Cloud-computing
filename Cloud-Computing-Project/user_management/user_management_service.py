import os
from datetime import datetime
from flask import Flask, request, jsonify
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from flask_cors import CORS
from elasticsearch import Elasticsearch
from werkzeug.security import generate_password_hash, check_password_hash
import logging

app = Flask(__name__)
# Enable CORS for all routes
CORS(app, resources={r"/*": {"origins": ["*"]}})

app.config['JWT_SECRET_KEY']     = os.getenv('JWT_SECRET_KEY')
jwt = JWTManager(app)

# Elasticsearch connection
ES_HOST = os.getenv('ES_HOST')
ES_PORT = os.getenv('ES_PORT')
ES_USERNAME = os.getenv('ELASTIC_USERNAME')
ES_PASSWORD = os.getenv('ELASTIC_PASSWORD')

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Log Elasticsearch configuration
logger.info("Elasticsearch Configuration:")
logger.info(f"Host: {ES_HOST}")
logger.info(f"Port: {ES_PORT}")
logger.info(f"Username: {ES_USERNAME}")
logger.info(f"Password: {ES_PASSWORD}")  # Mask password for security
ES_URL = os.getenv('ES_URL')
try:
    logger.info(f"Attempting to connect to Elasticsearch at {ES_URL}")
    es = Elasticsearch(
        [ES_URL],
        basic_auth=(ES_USERNAME, ES_PASSWORD)
    )
    # Test the connection
    if not es.ping():
        logger.error(f"Failed to connect to Elasticsearch at {ES_URL}")
        raise ConnectionError("Elasticsearch connection failed")
    logger.info(f"Successfully connected to Elasticsearch at {ES_URL}")
    # Log cluster information
    cluster_info = es.info()
    logger.info(f"Connected to Elasticsearch cluster: {cluster_info.get('name', 'unknown')}")
    logger.info(f"Elasticsearch version: {cluster_info.get('version', {}).get('number', 'unknown')}")
except Exception as e:
    logger.error(f"Failed to initialize Elasticsearch client: {str(e)}")
    raise

# Index names
USER_INDEX  = 'users'
CARD_INDEX = 'cards'

# — Users index: password, email(unique), birthdate, phone(unique), created_date —
if not es.indices.exists(index=USER_INDEX):
    es.indices.create(index=USER_INDEX)
# — Cards index: card_id(unique), username(unique), cvv, cardnumber,
#   exp_date, cardholder_name, created_date, balance, phone —
if not es.indices.exists(index=CARD_INDEX):
    es.indices.create(index=CARD_INDEX)



@app.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    fname   = data.get('fname')
    lname   = data.get('lname')
    email     = data.get('email')
    phone     = data.get('phone')
    password  = data.get('password')
    birthdate = data.get('birthdate')  # "YYYY-MM-DD"
    # Validate
    if not all([email, phone, password, birthdate]):
        return jsonify({'message': 'Missing required fields: email, phone, password, birthdate'}), 400

    # Check unique email OR phone
    res = es.search(index=USER_INDEX, body={
        "query": {
            "bool": {
                "should": [
                    {"term": {"email": email}},
                    {"term": {"phone": phone}}
                ]
            }
        }
    })
    if res['hits']['total']['value'] > 0:
        return jsonify({'message': 'Email or phone already in use'}), 400

    # Hash password, index user using email as doc ID
    doc = {
        'fname':        fname,
        'lname':        lname,
        'password':     generate_password_hash(password),
        'email':        email,
        'birthdate':    birthdate,
        'phone':        phone,
        'created_date': datetime.utcnow().isoformat()
    }
    es.index(index=USER_INDEX, id=phone, body=doc)
    return jsonify({'message': 'User registered successfully'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    identifier = data.get('identifier')  # could be phone or email
    password   = data.get('password')

    if not identifier or not password:
        return jsonify({'message': 'Missing identifier or password'}), 400

    # Try direct ID lookup (phone)
    try:
        res = es.get(index=USER_INDEX, id=identifier)
        user = res['_source']
    except:
        # Fallback: search by email using match query
        search = es.search(index=USER_INDEX, body={
            "query": {
                "match": {
                    "email": {
                        "query": identifier,
                        "operator": "and"
                    }
                }
            }
        })
        hits = search['hits']['hits']
        if not hits:
            return jsonify({'message': 'Invalid credentials'}), 401
        user = hits[0]['_source']

    # Check password
    if check_password_hash(user['password'], password):
        access_token = create_access_token(identity=user['phone'])
        return jsonify({'access_token': access_token,
                        'user_id': user['phone']}), 200

    return jsonify({'message': 'Invalid credentials'}), 401


@app.route('/cards', methods=['POST'])
@jwt_required()
def create_card():
    """
    Create or overwrite a card document using the username as the document ID.
    Body JSON:
    {
      "username": str,
      "cvv": str,
      "cardnumber": str,
      "exp_date": "YYYY-MM",
      "cardholder_name": str,
      "balance": float,
      "phone": str
    }
    """
    data = request.get_json() or {}
    username        = data.get('username')
    cvv             = data.get('cvv')
    cardnumber      = data.get('cardnumber')
    exp_date        = data.get('exp_date')
    cardholder_name = data.get('cardholder_name')
    balance         = data.get('balance')
    phone           = data.get('phone')
    pin             = data.get('pin')

    # Validate required fields
    if not all([username, cvv, cardnumber, exp_date, cardholder_name, balance, phone,pin]):
        return jsonify({'message': 'Missing required card fields'}), 400

    # Ensure the username doesn't exist
    if es.exists(index=CARD_INDEX, id=username):
        return jsonify({'message': 'username exist'}), 404

    # Enforce uniqueness on cardnumber
    dup = es.search(index=CARD_INDEX, body={
        "query": {"term": {"cardnumber": cardnumber}}
    })
    if dup['hits']['total']['value'] > 0:
        return jsonify({'message': 'cardnumber already in use'}), 400

    # Build the document, using username
    card_doc = {
        'username':        username,
        'cvv':             cvv,
        'cardnumber':      cardnumber,
        'exp_date':        exp_date,
        'cardholder_name': cardholder_name,
        'created_date':    datetime.utcnow().isoformat(),
        'balance':         balance,
        'phone':           phone,
        'pin':             pin
    }

    # Index with document ID = username
    es.index(index=CARD_INDEX, id=username, body=card_doc)

    return jsonify({'message': 'Card created', 'card_id': username}), 201


@app.route('/users/<string:user_id>', methods=['GET'])
@jwt_required()
def get_user(user_id):
    """
    Retrieve the user document by ES ID (e.g. phone or email).
    Only the authenticated user may fetch their own data.
    """
    current_user = get_jwt_identity()
    if current_user != user_id:
        return jsonify({'message': 'Unauthorized'}), 403

    # Attempt to fetch the user; ignore 404 so it doesn't raise
    res = es.get(index=USER_INDEX, id=user_id, ignore=[404])
    if not res.get('found', False):
        return jsonify({'message': 'User not found'}), 404

    user = res['_source'].copy()
    user.pop('password', None)  # never return the password hash
    return jsonify(user), 200

@app.route('/internal/users/<string:user_id>', methods=['GET'])
def get_user_internal(user_id):
    """
    Retrieve the user document by ES ID without requiring authentication.
    Strips out the password field.
    """
    # Attempt to fetch the user; ignore 404 so it doesn't raise
    res = es.get(index=USER_INDEX, id=user_id, ignore=[404])
    if not res.get('found', False):
        return jsonify({'message': 'User not found'}), 404

    user = res['_source'].copy()
    user.pop('password', None)  # never return the password hash
    return jsonify(user), 200

@app.route('/cards/<string:username>', methods=['GET'])
@jwt_required()
def get_card(username):
    card = verify_user_by_username(username)
    if not card:
        return jsonify({'message': 'Unauthorized'}), 403
    return jsonify(card), 200

def verify_user_by_username(username):
    # Get the currently authenticated user's phone from JWT
    current_user_phone = get_jwt_identity()
    # Retrieve the card document by username (used as doc ID)
    res = es.get(index=CARD_INDEX, id=username, ignore=[404])
    if not res.get('found', False):
        return False
    card = res['_source']
    # Check if the phone number in the card matches the current user
    if card.get('phone') != current_user_phone:
        return False
    return card

@app.route('/internal/cards/<string:username>', methods=['GET'])
def get_card_internal(username):
    res = es.get(index=CARD_INDEX, id=username, ignore=[404])
    if not res.get('found', False):
        return jsonify({'message': 'Card not found'}), 404
    return jsonify(res['_source']), 200


@app.route('/cards', methods=['GET'])
@jwt_required()
def get_cards():
    # Ensure the authenticated user is the owner
    current_user_phone = get_jwt_identity()

    # Search for all cards that match this phone
    res = es.search(index=CARD_INDEX, body={
        "query": {
            "term": {
                "phone": current_user_phone
            }
        }
    })

    hits = res['hits']['hits']
    cards = [hit['_source'] for hit in hits]

    return jsonify({'cards': cards}), 200

if __name__ == '__main__':
    PORT = int(os.getenv('USER_PORT'))
    app.run(host='0.0.0.0', port=PORT, debug=True)
    

