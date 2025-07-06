import os
import uuid
from datetime import datetime
import requests
import logging
from flask import Flask, request, jsonify
from elasticsearch import Elasticsearch, NotFoundError
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from flask_cors import CORS
import hashlib

# ─── LOGGING CONFIG ───────────────────────────────────────────────────────────
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
app = Flask(__name__)

# ─── CORS CONFIG ─────────────────────────────────────────────────────────────
CORS(app, resources={
    r"/*": {
        "origins": ["*"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
        "supports_credentials": True,
        "expose_headers": ["Content-Type", "Authorization"],
        "max_age": 3600
    }
}, supports_credentials=True)

# ─── JWT CONFIG ───────────────────────────────────────────────────────────────
app.config['JWT_SECRET_KEY']     = os.getenv('JWT_SECRET_KEY')
jwt = JWTManager(app)

# ─── ELASTICSEARCH CLIENT ─────────────────────────────────────────────────────
ES_HOST = os.getenv('ES_HOST')
ES_PORT = os.getenv('ES_PORT')
ES_USERNAME = os.getenv('ELASTIC_USERNAME')
ES_PASSWORD = os.getenv('ELASTIC_PASSWORD')
try:
    es = Elasticsearch(
        [f'http://{ES_HOST}:{ES_PORT}'],
        basic_auth=(ES_USERNAME, ES_PASSWORD)
    )
    # Test the connection
    if not es.ping():
        logger.error(f"Failed to connect to Elasticsearch at {ES_HOST}:{ES_PORT}")
        raise ConnectionError("Elasticsearch connection failed")
    logger.info(f"Successfully connected to Elasticsearch at {ES_HOST}:{ES_PORT}")
except Exception as e:
    logger.error(f"Failed to initialize Elasticsearch client: {str(e)}")
    raise

# ─── INDEX SETUP ───────────────────────────────────────────────────────────────
CARD_INDEX        = 'cards'
TRANSACTION_INDEX = 'transactions'
if not es.indices.exists(index=TRANSACTION_INDEX):
    logger.info(f"Creating transaction index: {TRANSACTION_INDEX}")
    es.indices.create(index=TRANSACTION_INDEX)

# ─── NOTIFICATION SERVICE ────────────────────────────────────────────────────
NOTIFY_URL = os.getenv('NOTIFY_URL')
SERVICE_SECRET = os.getenv('SERVICE_SECRET')

def notify_transaction(tx, sdoc, rdoc, amt, status, reason):
    payload = {
        'trans_id':          tx,
        'sender_doc':        sdoc,
        'receiver_doc':      rdoc,
        'amount':            amt,
        'status':            status,
        'reason':            reason
    }   
    headers = {
        'X-Service-Token': SERVICE_SECRET,
        'Content-Type':  'application/json'
    }
    try:
        if reason:
            logger.info(f"Sending notification for transaction {tx} with status {status}. Reason: {reason}")
        else:
            logger.info(f"Sending notification for transaction {tx} with status {status}")
        requests.post(NOTIFY_URL, json=payload, headers=headers, timeout=5)
        logger.info(f"Successfully sent notification for transaction {tx}")
    except Exception as e:
        logger.error(f"Failed to send notification for transaction {tx}: {str(e)}")

def username_to_phone(username):
    """
    Given a username (used as the ES doc‐ID in the cards index),
    return the associated phone number, or None if not found.
    """
    try:
        res = es.get(index=CARD_INDEX, id=username)
        return res['_source'].get('phone')
    except NotFoundError:
        logger.warning(f"Card not found for username: {username}")
        return None

@app.route('/transactions', methods=['POST'])
@jwt_required()
def create_transaction():
    current_phone = get_jwt_identity()
    data = request.get_json() or {}
    logger.info(f"Received transaction request from {current_phone}")

    sender   = data.get('sender_username')
    receiver = data.get('receiver_username')
    amount   = data.get('amount')
    pin      = data.get('pin')

    # 1) Generate tx_id & get timestamp
    tx_id     = uuid.uuid4().hex
    timestamp = datetime.utcnow().isoformat()+'Z'
    logger.info(f"Generated transaction ID: {tx_id}")

    # 2) Early validation helpers
    def fail(msg, code=400, should_notify=True):
        logger.warning(f"Transaction {tx_id} failed: {msg}")
        # create a failed audit only if notification is needed
        if should_notify:
            audit = {
                'sender_username':   sender,
                'receiver_username': receiver,
                'timestamp':         timestamp,
                'status':            'failed',
                'amount':            amount,
                'error':             msg
            }
            es.index(index=TRANSACTION_INDEX, id=tx_id, body=audit)
            logger.info(f"Notifying about failed transaction {tx_id} with reason: {msg}")
            notify_transaction(tx_id, sdoc, rdoc, amount, 'failed', msg)
        return jsonify({'message': msg}), code

    # Fetch & check PIN & verify sender
    try:
        sdoc = es.get(index=CARD_INDEX, id=sender)['_source']
        logger.info(f"Found sender card for {sender}")
    except NotFoundError:
        logger.error(f"Sender card not found: {sender}")
        return fail('Sender card not found', 404, should_notify=False)

    # Fetch receiver
    try:
        rdoc = es.get(index=CARD_INDEX, id=receiver)['_source']
        logger.info(f"Found receiver card for {receiver}")
    except NotFoundError:
        logger.error(f"Receiver card not found: {receiver}")
        return fail('Receiver not found', 404, should_notify=False)

    # Verify token matches sender
    if current_phone != sdoc.get('phone'):
        logger.error(f"Token mismatch: {current_phone} != {sdoc.get('phone')}")
        return fail('Invalid sender', 403, should_notify=False)

    # Basic payload validation
    if not all([sender, receiver, amount, pin]) or amount <= 0:
        logger.error(f"Invalid transaction payload: {data}")
        return fail('Invalid transaction payload', 400, should_notify=False)

    # Prevent self-transactions
    if sender == receiver:
        logger.warning(f"Self-transaction attempted: {sender}")
        return fail('Cannot send money to yourself', 400, should_notify=False)

    # Verify PIN
    if sdoc.get('pin') != pin:
        logger.warning(f"Invalid PIN for user: {sender}")
        return fail('invalid PIN', 401, should_notify=True)

    # Balance check
    if float(sdoc.get('balance', 0)) < amount:
        logger.warning(f"Insufficient balance for {sender}: {sdoc.get('balance')} < {amount}")
        return fail('Insufficient balance', 400, should_notify=True)

    # 3) All checks passed → perform debit/credit
    try:
        logger.info(f"Processing transaction {tx_id}: {amount} from {sender} to {receiver}")
        
        # Log the current balances before transaction
        try:
            sender_balance = es.get(index=CARD_INDEX, id=sender)['_source'].get('balance', 0)
            receiver_balance = es.get(index=CARD_INDEX, id=receiver)['_source'].get('balance', 0)
            logger.info(f"Before transaction - Sender balance: {sender_balance}, Receiver balance: {receiver_balance}")
        except Exception as e:
            logger.error(f"Error fetching initial balances: {str(e)}")

        # Update sender balance
        try:
            es.update(
                index=CARD_INDEX,
                id=sender,
                body={'script':{
                    'source':'ctx._source.balance-=params.amt',
                    'lang':'painless',
                    'params':{'amt':amount}
                }}
            )
            logger.info(f"Successfully updated sender balance")
        except Exception as e:
            logger.error(f"Error updating sender balance: {str(e)}")
            raise

        # Update receiver balance
        try:
            es.update(
                index=CARD_INDEX,
                id=receiver,
                body={'script':{
                    'source':'ctx._source.balance+=params.amt',
                    'lang':'painless',
                    'params':{'amt':amount}
                }}
            )
            logger.info(f"Successfully updated receiver balance")
        except Exception as e:
            logger.error(f"Error updating receiver balance: {str(e)}")
            raise

        # Mark completed
        try:
            audit = {
                'sender_username':   sender,
                'receiver_username': receiver,
                'timestamp':         timestamp,
                'status':            'completed',
                'amount':            amount
            }
            es.index(index=TRANSACTION_INDEX, id=tx_id, body=audit)
            logger.info(f"Successfully created transaction audit record")
        except Exception as e:
            logger.error(f"Error creating transaction audit: {str(e)}")
            raise

        # Log final balances
        try:
            sender_balance = es.get(index=CARD_INDEX, id=sender)['_source'].get('balance', 0)
            receiver_balance = es.get(index=CARD_INDEX, id=receiver)['_source'].get('balance', 0)
            logger.info(f"After transaction - Sender balance: {sender_balance}, Receiver balance: {receiver_balance}")
        except Exception as e:
            logger.error(f"Error fetching final balances: {str(e)}")

        # Notify both
        notify_transaction(tx_id, sdoc, rdoc, amount, 'completed', None)
        return jsonify({'message':'Transaction completed','trans_id':tx_id}), 201

    except Exception as e:
        error_msg = f"Transaction {tx_id} failed with error: {str(e)}"
        logger.error(error_msg)
        # Log the full exception details
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return fail('Transaction failed', 500, should_notify=True)

@app.route('/transaction/<string:trans_id>', methods=['GET'])
@jwt_required()
def get_transaction(trans_id):
    logger.info(f"Fetching transaction: {trans_id}")
    try:
        tx = es.get(index=TRANSACTION_INDEX, id=trans_id)['_source']
    except NotFoundError:
        logger.warning(f"Transaction not found: {trans_id}")
        return jsonify({'message':'Transaction not found'}), 404

    cur_phone = get_jwt_identity()
    s_phone = username_to_phone(tx['sender_username'])
    r_phone = username_to_phone(tx['receiver_username'])

    # If user is neither sender nor receiver
    if s_phone != cur_phone and r_phone != cur_phone:
        logger.warning(f"Unauthorized access attempt to transaction {trans_id} by {cur_phone}")
        return jsonify({'message':'Forbidden'}), 403
    
    # If user is receiver and transaction is failed, don't show it
    if r_phone == cur_phone and tx.get('status') == 'failed':
        logger.info(f"Receiver {r_phone} attempted to view failed transaction {trans_id}")
        return jsonify({'message':'Transaction not found'}), 404

    logger.info(f"Successfully retrieved transaction {trans_id}")
    return jsonify(tx), 200

@app.route('/transactions/<string:username>', methods=['GET'])
@jwt_required()
def get_transactions_for_user(username):
    logger.info(f"Fetching transactions for user: {username}")
    current_phone = get_jwt_identity()
    user_phone = username_to_phone(username)
    if current_phone != user_phone:
        logger.warning(f"Unauthorized access attempt to user {username}'s transactions by {current_phone}")
        return jsonify({'message':'Forbidden'}), 403

    # Get all transactions where user is either sender or receiver
    q = {
        "query": {
            "bool": {
                "should": [
                    {"term": {"sender_username.keyword": username}},  # Using .keyword for exact match
                    {"term": {"receiver_username.keyword": username}}  # Using .keyword for exact match
                ]
            }
        },
        "size": 10000,  # Set a large size to get all transactions
        "sort": [
            {"timestamp": {"order": "desc"}}  # Sort by timestamp in descending order (newest first)
        ]
    }
    res = es.search(index=TRANSACTION_INDEX, body=q)
    txs = []
    
    # Filter transactions based on user role and status
    for hit in res['hits']['hits']:
        tx = hit['_source']
        tx['trans_id'] = hit['_id']  # Add transaction ID to the response
        # If user is sender, show all transactions
        if tx['sender_username'] == username:  # Exact case match
            txs.append(tx)
        # If user is receiver, only show successful transactions
        elif tx['receiver_username'] == username and tx.get('status') != 'failed':  # Exact case match
            txs.append(tx)
    
    logger.info(f"Found {len(txs)} transactions for user {username}")
    return jsonify({'transactions': txs}), 200

if __name__ == '__main__':
    PORT = int(os.getenv('TRANS_PORT'))
    app.run(host='0.0.0.0', port=PORT, debug=True)
