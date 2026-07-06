# VEDAINVPRO Backend Server

This repository contains the backend service for VEDAINVPRO (Smart Inventory Management). It is built using Node.js, Express, and Sequelize ORM, supporting SQLite locally (and PostgreSQL for production).

## Features
- **User Authentication**: Secure register and login system using JWT and Bcrypt.
- **Inventory Management**: APIs to create, update, retrieve, and delete items.
- **Transaction Processing**: Management of Sales, Purchases, Receipts, and Payments.
- **Supplier & Customer (Parties) management**.
- **Settings Store**: Logo upload, business profile, and metadata config.

---

## Prerequisites
Before you begin, ensure you have the following installed on your machine:
- **Node.js** (v16 or higher)
- **npm** (comes packaged with Node.js)

---

## Step-by-Step Local Setup

1. **Navigate to the Backend Directory**:
   ```bash
   cd inventory-backend
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Database Configuration**:
   - By default, the server is configured to run on a local SQLite database (`inventory.db`).
   - The file will be created automatically in this folder when you start the server for the first time.

4. **Environment Variables**:
   Create a `.env` file in the root of the `inventory-backend` directory to store config securely:
   ```env
   PORT=3000
   JWT_SECRET=your_super_secret_jwt_key
   ```

5. **Start the Server**:
   - **Production mode**:
     ```bash
     npm start
     ```
   - **Development mode** (with automatic reload using nodemon):
     ```bash
     npx nodemon server.js
     ```

6. **Verify the Server is Running**:
   Open your browser or API client (like Postman) and navigate to `http://localhost:3000`. You should see the welcome screen or API configuration status.

---

## API Endpoints List

### Authentication
- `POST /api/auth/register` - Create a new user account.
- `POST /api/auth/login` - Authenticate a user and receive a JWT.

### Items (Inventory)
- `GET /api/items` - Retrieve all inventory items.
- `POST /api/items` - Create a new item.
- `PUT /api/items/:id` - Update details of a specific item.
- `DELETE /api/items/:id` - Remove an item.

### Parties (Customers & Suppliers)
- `GET /api/parties` - Get list of suppliers and customers.
- `POST /api/parties` - Register a new contact.
- `PUT /api/parties/:id` - Edit contact details.
- `DELETE /api/parties/:id` - Delete contact.

### Transactions (Sales/Purchases)
- `GET /api/transactions` - View transaction history.
- `POST /api/transactions` - Record a sale, purchase, receipt, or payment.
- `PUT /api/transactions/:id` - Modify an existing transaction.
- `DELETE /api/transactions/:id` - Delete transaction.
- `DELETE /api/transactions-clear` - Clear all transactions.

### Settings
- `GET /api/settings` - Retrieve store information and configurations.
- `POST /api/settings` - Update shop name, mobile, address, and logo.
