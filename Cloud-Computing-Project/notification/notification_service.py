import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import Flask, request, jsonify
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from elasticsearch import Elasticsearch, NotFoundError

app = Flask(__name__)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ─── JWT CONFIG ───────────────────────────────────────────────────────────────
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY')
jwt = JWTManager(app)

# Service authentication
SERVICE_SECRET = os.getenv('SERVICE_SECRET')

# ─── ELASTICSEARCH CLIENT ─────────────────────────────────────────────────────
ES_HOST = os.getenv('ES_HOST')
ES_PORT = os.getenv('ES_PORT')
ES_USERNAME = os.getenv('ELASTIC_USERNAME')
ES_PASSWORD = os.getenv('ELASTIC_PASSWORD')
ES_URL = os.getenv('ES_URL')

logger.info(f"Attempting to connect to Elasticsearch at {ES_URL}")
es = Elasticsearch(
        [ES_URL],
        basic_auth=(ES_USERNAME, ES_PASSWORD)
)
# Index names
CARD_INDEX = 'cards'
USER_INDEX = 'users'

# Email configuration
SMTP_SERVER = os.getenv('SMTP_SERVER')
SMTP_PORT = int(os.getenv('SMTP_PORT'))
SMTP_USERNAME = os.getenv('SMTP_USERNAME')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD')
SENDER_EMAIL = os.getenv('SENDER_EMAIL')


# --- Notification backends ---
def send_email(to_address, subject, body):
    """
    Send an email using SMTP.
    Args:
        to_address (str): Recipient's email address
        subject (str): Email subject
        body (str): Email body content
    Returns:
        bool: True if email was sent successfully, False otherwise
    """
    try:
        if not all([SMTP_USERNAME, SMTP_PASSWORD]):
            logger.info(f"[EMAIL] (SMTP not configured) To: {to_address}\nSubject: {subject}\n{body}\n")
            return True

        # Create message(ss)
        msg = MIMEMultipart()
        msg['From'] = SENDER_EMAIL
        msg['To'] = to_address
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        # Connect to SMTP server and send
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        
        logger.info(f"[EMAIL] Sent to {to_address}")
        return True
    except Exception as e:
        logger.error(f"[EMAIL] Error sending to {to_address}: {str(e)}")
        return False

# --- Helpers ---
def fetch_user_email(card_doc):
    """
    Fetch a user's contact data (email and phone) by username using Elasticsearch.
    Returns dict with 'email' and 'phone', or None on failure.
    """
    try:
        # Get user email using phone
        user = es.get(index=USER_INDEX, id=card_doc['phone'])
        return user['_source'].get('email')  # Return email string directly
    except NotFoundError:
        return None
    except Exception as e:
        logger.error(f"Error fetching user data: {e}")
        return None

# --- Routes ---
@app.route('/transaction-notify', methods=['POST'])
def notify_transaction():
    # Verify service authentication
    service_token = request.headers.get('X-Service-Token')
    if not service_token or service_token != SERVICE_SECRET:
        logger.warning("Unauthorized service access attempt")
        return jsonify({'message': 'Unauthorized service access'}), 403

    data = request.get_json() or {}
    status = data.get('status')
    trans_id = data.get('trans_id')
    sender_doc = data.get('sender_doc')
    receiver_doc = data.get('receiver_doc')
    reason = data.get('reason')

    amount = data.get('amount')
    
    # Validate status
    if not status:
        logger.error(f"Missing status: {data}")
        return jsonify({'message': 'Missing status'}), 400

    # Validate required fields
    if status == 'failed':
        if not all([trans_id, sender_doc, amount, reason]):
            logger.error(f"Missing transaction fields: {data}")
            return jsonify({'message': 'Missing transaction fields'}), 400
    else:
        if not all([trans_id, sender_doc, receiver_doc, amount]):
            logger.error(f"Missing transaction fields: {data}")
            return jsonify({'message': 'Missing transaction fields'}), 400

    # Get contact info
    s_email = fetch_user_email(sender_doc)
    if not s_email:
        logger.error(f"Sender email not found for user: {sender_doc.get('username')}")
        return jsonify({'message': 'Sender not found'}), 404

    if status != 'failed':
        r_email = fetch_user_email(receiver_doc)
        if not r_email:
            logger.error(f"Receiver email not found for user: {receiver_doc.get('username')}")
            return jsonify({'message': 'Receiver not found'}), 404
        
        # Construct messages
        sender_msg = f"Dear {sender_doc.get('username')},\n\nYour transaction {trans_id} of ${amount:.2f} has been successfully sent to {receiver_doc.get('username')}."
        logger.info(f"Transaction successful - ID: {trans_id}, Amount: ${amount:.2f}, From: {sender_doc.get('username')}, To: {receiver_doc.get('username')}")
        email_sent = send_email(s_email, 'Transaction sent', sender_msg)

        receiver_msg = f"Dear {receiver_doc.get('username')},\n\nYou received ${amount:.2f} from {sender_doc.get('username')}. Transaction ID: {trans_id}."
        email_sent = email_sent and send_email(r_email, 'Transaction Received', receiver_msg)

    else:
        sender_msg = f"Dear {sender_doc.get('username')},\n\nYour transaction {trans_id} of ${amount:.2f} has failed\nReason: {reason}."
        logger.error(f"Transaction failed - ID: {trans_id}, Amount: ${amount:.2f}, Reason: {reason}")
        email_sent = send_email(s_email, 'Transaction failed', sender_msg)

    if not email_sent:
        logger.error(f"Failed to send notifications for transaction: {trans_id}")
        return jsonify({'message': 'Transaction notifications partially sent'}), 207

    logger.info(f"Successfully sent all notifications for transaction: {trans_id}")
    return jsonify({'message': 'Transaction notifications sent'}), 200

if __name__ == '__main__':
    PORT = int(os.getenv('NOTIFY_PORT'))
    app.run(host='0.0.0.0', port=PORT, debug=True)
