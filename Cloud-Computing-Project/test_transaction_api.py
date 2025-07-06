import requests
import json
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:5000"  # User management service
TRANSACTION_URL = "http://localhost:5001"  # Transaction service

# Test data
test_users = [
    {
        "email": "hossamatef21@yahoo.com",
        "phone": "1000000000",
        "password": "passAlice",
        "birthdate": "1990-01-01",
        "fname": "Hossam",
        "lname": "Atef"
    },
    {
        "email": "Rmnawaff@gmail.com",
        "phone": "2000000000",
        "password": "passBob",
        "birthdate": "1990-02-02",
        "fname": "Bob",
        "lname": "Jones"
    }
]

test_cards = [
    {
        "username": "hos",
        "cvv": "111",
        "cardnumber": "4111111111111111",
        "exp_date": "2027-12",
        "cardholder_name": "Hossam Atef",
        "balance": 500.0,
        "phone": "1000000000",
        "pin": "1234"
    },
    {
        "username": "nawaf",
        "cvv": "222",
        "cardnumber": "4222222222222222",
        "exp_date": "2028-11",
        "cardholder_name": "Bob Jones",
        "balance": 300.0,
        "phone": "2000000000",
        "pin": "5678"
    }
]

def print_response(response, message):
    """Helper function to print API responses"""
    print(f"\n{message}")
    print(f"Status Code: {response.status_code}")
    try:
        print(f"Response: {json.dumps(response.json(), indent=2)}")
    except json.JSONDecodeError:
        print(f"Response text: {response.text}")
    return response

def test_user_registration():
    """Test user registration for both users"""
    print("\n=== Testing User Registration ===")
    for user in test_users:
        try:
            response = requests.post(f"{BASE_URL}/register", json=user)
            if response.status_code == 400 and "already in use" in response.json().get("message", ""):
                print(f"User {user['email']} already exists (expected)")
            else:
                print_response(response, f"Registering user: {user['email']}")
        except requests.exceptions.RequestException as e:
            print(f"Error registering user {user['email']}: {str(e)}")

def test_user_login():
    """Test user login and return tokens"""
    print("\n=== Testing User Login ===")
    tokens = {}
    for user in test_users:
        try:
            response = requests.post(
                f"{BASE_URL}/login",
                json={"identifier": user["phone"], "password": user["password"]}
            )
            resp = print_response(response, f"Logging in user: {user['email']}")
            if response.status_code == 200:
                tokens[user["phone"]] = resp.json()["access_token"]
        except requests.exceptions.RequestException as e:
            print(f"Error logging in user {user['email']}: {str(e)}")
    return tokens

def test_card_creation(tokens):
    """Test card creation for both users"""
    print("\n=== Testing Card Creation ===")
    for card in test_cards:
        try:
            response = requests.post(
                f"{BASE_URL}/cards",
                headers={"Authorization": f"Bearer {tokens[card['phone']]}"},
                json=card
            )
            if response.status_code == 404 and "username exist" in response.json().get("message", ""):
                print(f"Card for {card['username']} already exists (expected)")
            else:
                print_response(response, f"Creating card for: {card['username']}")
        except requests.exceptions.RequestException as e:
            print(f"Error creating card for {card['username']}: {str(e)}")

def test_transaction_creation(tokens):
    """Test creating a transaction"""
    print("\n=== Testing Transaction Creation ===")
    transaction_data = {
        "sender_username": "hos",  # Updated to match the card username
        "receiver_username": "nawaf",
        "amount": 100.0,
        "pin": "1234"
    }
    
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        resp = print_response(response, "Creating transaction from Hossam to Nawaf")
        
        if response.status_code == 201:
            return resp.json().get("trans_id")
    except requests.exceptions.RequestException as e:
        print(f"Error creating transaction: {str(e)}")
    return None

def test_get_transaction(trans_id, tokens):
    """Test getting a specific transaction with both users' tokens"""
    print("\n=== Testing Get Transaction ===")
    
    # Test with sender's token (Hossam)
    try:
        response = requests.get(
            f"{TRANSACTION_URL}/transaction/{trans_id}",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"}
        )
        print_response(response, f"Getting transaction {trans_id} with sender's token (Hossam)")
    except requests.exceptions.RequestException as e:
        print(f"Error getting transaction with sender's token: {str(e)}")
    
    # Test with receiver's token (Bob)
    try:
        response = requests.get(
            f"{TRANSACTION_URL}/transaction/{trans_id}",
            headers={"Authorization": f"Bearer {tokens['2000000000']}"}
        )
        print_response(response, f"Getting transaction {trans_id} with receiver's token (Bob)")
    except requests.exceptions.RequestException as e:
        print(f"Error getting transaction with receiver's token: {str(e)}")

def test_failed_transaction_visibility(tokens):
    """Test visibility of failed transactions"""
    print("\n=== Testing Failed Transaction Visibility ===")
    
    # Create a transaction that will fail (insufficient balance)
    transaction_data = {
        "sender_username": "hos",
        "receiver_username": "nawaf",
        "amount": 1000.0,  # More than Hossam's balance
        "pin": "1234"
    }
    
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        resp = print_response(response, "Creating a failed transaction (insufficient balance)")
        
        if response.status_code == 400:  # Transaction failed
            failed_trans_id = response.json().get("trans_id")
            if failed_trans_id:
                # Test visibility with sender's token (should see the failed transaction)
                response = requests.get(
                    f"{TRANSACTION_URL}/transaction/{failed_trans_id}",
                    headers={"Authorization": f"Bearer {tokens['1000000000']}"}
                )
                print_response(response, "Getting failed transaction with sender's token (should succeed)")
                
                # Test visibility with receiver's token (should not see the failed transaction)
                response = requests.get(
                    f"{TRANSACTION_URL}/transaction/{failed_trans_id}",
                    headers={"Authorization": f"Bearer {tokens['2000000000']}"}
                )
                print_response(response, "Getting failed transaction with receiver's token (should fail)")
    except requests.exceptions.RequestException as e:
        print(f"Error testing failed transaction visibility: {str(e)}")

def test_get_user_transactions(tokens):
    """Test getting all transactions for both users with their respective tokens"""
    print("\n=== Testing Get User Transactions ===")
    
    # Test getting Hossam's transactions
    try:
        response = requests.get(
            f"{TRANSACTION_URL}/transactions/hos",  # Using card username
            headers={"Authorization": f"Bearer {tokens['1000000000']}"}
        )
        print_response(response, "Getting transactions for Hossam (sender)")
    except requests.exceptions.RequestException as e:
        print(f"Error getting Hossam's transactions: {str(e)}")
    
    # Test getting Nawaf's transactions
    try:
        response = requests.get(
            f"{TRANSACTION_URL}/transactions/nawaf",  # Using card username
            headers={"Authorization": f"Bearer {tokens['2000000000']}"}
        )
        print_response(response, "Getting transactions for Nawaf (receiver)")
    except requests.exceptions.RequestException as e:
        print(f"Error getting Nawaf's transactions: {str(e)}")
    
    # Test unauthorized access (try to get Hossam's transactions with Nawaf's token)
    try:
        response = requests.get(
            f"{TRANSACTION_URL}/transactions/hos",
            headers={"Authorization": f"Bearer {tokens['2000000000']}"}
        )
        print_response(response, "Attempting to get Hossam's transactions with Nawaf's token (should fail)")
    except requests.exceptions.RequestException as e:
        print(f"Error testing unauthorized access: {str(e)}")

def test_invalid_transaction(tokens):
    """Test invalid transaction scenarios"""
    print("\n=== Testing Invalid Transactions ===")
    
    # Test 1: Invalid PIN
    transaction_data = {
        "sender_username": "hos",  # Updated to match the card username
        "receiver_username": "nawaf",
        "amount": 50.0,
        "pin": "9999"  # Wrong PIN
    }
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        print_response(response, "Testing invalid PIN")
    except requests.exceptions.RequestException as e:
        print(f"Error testing invalid PIN: {str(e)}")

def test_additional_scenarios(tokens):
    """Test additional transaction scenarios"""
    print("\n=== Testing Additional Scenarios ===")
    
    # Test 1: Self-transaction attempt
    transaction_data = {
        "sender_username": "hos",
        "receiver_username": "hos",  # Same as sender
        "amount": 50.0,
        "pin": "1234"
    }
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        if response.status_code == 400:
            print("Self-transaction correctly rejected (expected)")
        else:
            print_response(response, "Testing self-transaction (should fail)")
    except requests.exceptions.RequestException as e:
        print(f"Error testing self-transaction: {str(e)}")

    # Test 2: Multiple successful transactions
    for amount in [10.0, 20.0, 30.0]:
        transaction_data = {
            "sender_username": "hos",
            "receiver_username": "nawaf",
            "amount": amount,
            "pin": "1234"
        }
        try:
            response = requests.post(
                f"{TRANSACTION_URL}/transactions",
                headers={"Authorization": f"Bearer {tokens['1000000000']}"},
                json=transaction_data
            )
            print_response(response, f"Creating multiple transactions: {amount}")
        except requests.exceptions.RequestException as e:
            print(f"Error creating multiple transactions: {str(e)}")

    # Test 3: Transaction with invalid receiver
    transaction_data = {
        "sender_username": "hos",
        "receiver_username": "nonexistent",
        "amount": 50.0,
        "pin": "1234"
    }
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        if response.status_code == 404:
            print("Invalid receiver correctly rejected with 404 (expected)")
            print(f"Response: {response.json()}")
        else:
            print_response(response, "Testing transaction with invalid receiver")
    except requests.exceptions.RequestException as e:
        print(f"Error testing invalid receiver: {str(e)}")

    # Test 4: Transaction with invalid sender
    transaction_data = {
        "sender_username": "nonexistent",
        "receiver_username": "nawaf",
        "amount": 50.0,
        "pin": "1234"
    }
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        if response.status_code == 404:
            print("Invalid sender correctly rejected with 404 (expected)")
            print(f"Response: {response.json()}")
        else:
            print_response(response, "Testing transaction with invalid sender")
    except requests.exceptions.RequestException as e:
        print(f"Error testing invalid sender: {str(e)}")

    # Test 5: Transaction with zero amount
    transaction_data = {
        "sender_username": "hos",
        "receiver_username": "nawaf",
        "amount": 0.0,
        "pin": "1234"
    }
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        if response.status_code == 400:
            print("Zero amount transaction correctly rejected (expected)")
        else:
            print_response(response, "Testing transaction with zero amount")
    except requests.exceptions.RequestException as e:
        print(f"Error testing zero amount: {str(e)}")

    # Test 6: Transaction with negative amount
    transaction_data = {
        "sender_username": "hos",
        "receiver_username": "nawaf",
        "amount": -50.0,
        "pin": "1234"
    }
    try:
        response = requests.post(
            f"{TRANSACTION_URL}/transactions",
            headers={"Authorization": f"Bearer {tokens['1000000000']}"},
            json=transaction_data
        )
        if response.status_code == 400:
            print("Negative amount transaction correctly rejected (expected)")
        else:
            print_response(response, "Testing transaction with negative amount")
    except requests.exceptions.RequestException as e:
        print(f"Error testing negative amount: {str(e)}")

def main():
    """Main test function"""
    print("Starting Transaction API Tests...")
    
    # Test user registration
    test_user_registration()
    
    # Test user login and get tokens
    tokens = test_user_login()
    if not tokens:
        print("Failed to get tokens. Exiting...")
        return
    
    # Test card creation
    test_card_creation(tokens)
    
    # Test transaction creation
    trans_id = test_transaction_creation(tokens)
    if trans_id:
        # Test getting specific transaction
        test_get_transaction(trans_id, tokens)
    
    # Test failed transaction visibility
    test_failed_transaction_visibility(tokens)
    
    # Test invalid transaction scenarios
    test_invalid_transaction(tokens)
    
    # Test additional scenarios
    test_additional_scenarios(tokens)
    
    # Test getting all transactions for users
    test_get_user_transactions(tokens)
    
    print("\nTransaction API Tests Completed!")

if __name__ == "__main__":
    main() 