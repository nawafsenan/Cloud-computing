import os
from flask import Flask, request, jsonify
import requests
from datetime import datetime, timedelta
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from elasticsearch import Elasticsearch, NotFoundError
from flask_cors import CORS

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

# JWT Configuration
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY')
jwt = JWTManager(app)

TRANSACTION_SERVICE_URL = os.getenv('TRANSACTION_SERVICE_URL')

# Elasticsearch connection
ES_HOST = os.getenv('ES_HOST')
ES_PORT = os.getenv('ES_PORT')
ES_USERNAME = os.getenv('ELASTIC_USERNAME')
ES_PASSWORD = os.getenv('ELASTIC_PASSWORD')
es = Elasticsearch(
    [f'http://{ES_HOST}:{ES_PORT}'],
    basic_auth=(ES_USERNAME, ES_PASSWORD)
)

# Index names
CARD_INDEX = 'cards'

def get_auth_headers():
    """Helper function to get authorization headers"""
    token = request.headers.get('Authorization', '')
    return {'Authorization': token}

def verify_username_access(username):
    """
    Verify that the username belongs to the authenticated user.
    Returns True if authorized, False otherwise.
    """
    current_phone = get_jwt_identity()
    try:
        res = es.get(index=CARD_INDEX, id=username)
        return res['_source'].get('phone') == current_phone
    except NotFoundError:
        return False

@app.route('/report/<string:username>', methods=['GET'])
@jwt_required()
def get_report(username):
    """Get a comprehensive report for a user including balance and transaction summary"""
    if not verify_username_access(username):
        return jsonify({'message': 'Unauthorized access'}), 403
        
    headers = get_auth_headers()
    
    # Get user's transactions
    transactions_response = requests.get(
        f'{TRANSACTION_SERVICE_URL}/transactions/{username}',
        headers=headers
    )
    
    if transactions_response.status_code != 200:
        return jsonify({'message': 'Unable to fetch transactions'}), transactions_response.status_code
    
    transactions = transactions_response.json().get('transactions', [])
    
    # Calculate transaction summary
    summary = {
        'total_sent': 0,
        'total_received': 0,
        'transaction_count': len(transactions),
        'successful_transactions': 0,
        'failed_transactions': 0,
        'average_transaction_amount': 0,
        'largest_transaction': 0,
        'recent_activity': []
    }
    
    total_amount = 0
    for tx in transactions:
        amount = float(tx.get('amount', 0))
        if tx.get('status') == 'completed':
            summary['successful_transactions'] += 1
            if tx['sender_username'] == username:
                summary['total_sent'] += amount
            else:
                summary['total_received'] += amount
            total_amount += amount
            summary['largest_transaction'] = max(summary['largest_transaction'], amount)
        else:
            summary['failed_transactions'] += 1
            
        # Add to recent activity (last 5 transactions)
        if len(summary['recent_activity']) < 5:
            summary['recent_activity'].append({
                'transaction_id': tx.get('trans_id'),
                'amount': amount,
                'type': 'sent' if tx['sender_username'] == username else 'received',
                'status': tx.get('status'),
                'timestamp': tx.get('timestamp')
            })
    
    if summary['successful_transactions'] > 0:
        summary['average_transaction_amount'] = total_amount / summary['successful_transactions']
    
    return jsonify({
        'username': username,
        'summary': summary
    }), 200

@app.route('/report/<string:username>/usage', methods=['GET'])
@jwt_required()
def get_usage_analysis(username):
    """Get detailed account usage analysis"""
    if not verify_username_access(username):
        return jsonify({'message': 'Unauthorized access'}), 403
        
    headers = get_auth_headers()
    
    # Get user's transactions
    transactions_response = requests.get(
        f'{TRANSACTION_SERVICE_URL}/transactions/{username}',
        headers=headers
    )
    
    if transactions_response.status_code != 200:
        return jsonify({'message': 'Unable to fetch transactions'}), transactions_response.status_code
    
    transactions = transactions_response.json().get('transactions', [])
    
    # Initialize usage analysis
    usage = {
        'daily_activity': {},
        'transaction_patterns': {
            'morning': 0,  # 6-12
            'afternoon': 0,  # 12-18
            'evening': 0,  # 18-24
            'night': 0  # 0-6
        },
        'common_recipients': {},
        'common_senders': {},
        'transaction_frequency': {
            'daily': 0,
            'weekly': 0,
            'monthly': 0
        }
    }
    
    # Analyze transactions
    for tx in transactions:
        if tx.get('status') != 'completed':
            continue
            
        timestamp = datetime.fromisoformat(tx.get('timestamp').replace('Z', '+00:00'))
        date_str = timestamp.strftime('%Y-%m-%d')
        hour = timestamp.hour
        
        # Daily activity
        if date_str not in usage['daily_activity']:
            usage['daily_activity'][date_str] = {
                'count': 0,
                'total_amount': 0
            }
        usage['daily_activity'][date_str]['count'] += 1
        usage['daily_activity'][date_str]['total_amount'] += float(tx.get('amount', 0))
        
        # Time of day analysis
        if 6 <= hour < 12:
            usage['transaction_patterns']['morning'] += 1
        elif 12 <= hour < 18:
            usage['transaction_patterns']['afternoon'] += 1
        elif 18 <= hour < 24:
            usage['transaction_patterns']['evening'] += 1
        else:
            usage['transaction_patterns']['night'] += 1
            
        # Common recipients/senders
        if tx['sender_username'] == username:
            recipient = tx['receiver_username']
            usage['common_recipients'][recipient] = usage['common_recipients'].get(recipient, 0) + 1
        else:
            sender = tx['sender_username']
            usage['common_senders'][sender] = usage['common_senders'].get(sender, 0) + 1
    
    # Calculate transaction frequency
    if usage['daily_activity']:
        days_with_transactions = len(usage['daily_activity'])
        total_days = (datetime.now() - min(datetime.fromisoformat(d) for d in usage['daily_activity'].keys())).days + 1
        
        if total_days > 0:
            usage['transaction_frequency']['daily'] = days_with_transactions / total_days
            usage['transaction_frequency']['weekly'] = days_with_transactions / (total_days / 7)
            usage['transaction_frequency']['monthly'] = days_with_transactions / (total_days / 30)
    
    # Sort and limit common recipients/senders to top 5
    usage['common_recipients'] = dict(sorted(usage['common_recipients'].items(), key=lambda x: x[1], reverse=True)[:5])
    usage['common_senders'] = dict(sorted(usage['common_senders'].items(), key=lambda x: x[1], reverse=True)[:5])
    
    return jsonify({
        'username': username,
        'usage_analysis': usage
    }), 200

if __name__ == '__main__':
    PORT = int(os.getenv('REPORT_PORT'))
    app.run(host='0.0.0.0', port=PORT, debug=True)