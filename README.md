# Nexoro Solution Digital Agency - Backend Server

This is the backend server for the Nexoro Solution Digital Agency Web App. It provides RESTful APIs for managing users, services, team members, client reviews, and messages, utilizing a modern implementation with Node.js, Express, and MongoDB.

## 🚀 Technologies Used

- **Runtime Environment:** [Node.js](https://nodejs.org/)
- **Web Framework:** [Express.js](https://expressjs.com/)
- **Database:** [MongoDB](https://www.mongodb.com/) (Native Driver)
- **Authentication & Authorization:** [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- **Image Storage:** [Cloudinary](https://cloudinary.com/)
- **File Handling:** [Multer](https://github.com/expressjs/multer) & [Multer Storage Cloudinary](https://github.com/affanshahid/multer-storage-cloudinary)
- **Middleware:** `cors`, `dotenv`, `body-parser`

## ✨ Features

- **User Management**
  - Secure user creation and management using Firebase Auth integration.
  - Store and retrieve user profiles (Name, Email, Role, Join Date).
  - Update user information and handle deletions.

- **Service Management**
  - CRUD operations for agency services.
  - Upload and manage service icons directly to Cloudinary.
  - Fields include: Title, Slug, Short Description, Long Description, and Icon.

- **Team Management**
  - Manage team member profiles.
  - Store team details and roles.

- **Client & Portfolio**
  - Manage client information and associated data (e.g., logos for "Trusted By" sections).

- **Reviews & Testimonials**
  - Handle client reviews and testimonials.

- **Messaging System**
  - Process and store contact form submissions or inquiries.

## 📂 Project Structure

```
nexoro-server/
├── admin/               # Firebase Admin SDK configuration
├── config/              # Database and Cloudinary configurations
├── controllers/         # Request logic for each feature
├── middleware/          # Custom middleware
├── routes/              # API Route definitions
├── server.js            # Entry point for the application
└── ...
```

## 🛠️ Setup & Installation

Follow these steps to run the server locally.

### 1. Clone the repository
```bash
git clone <repository-url>
cd nexoro-server
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory and add the following configuration keys:

**General:**
```env
PORT=5000
```

**MongoDB:**
```env
MONGODB_URI=your_mongodb_connection_string
```

**Cloudinary:**
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

**Firebase Admin SDK:**
```env
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY_ID=your_private_key_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_CLIENT_ID=your_client_id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_CERT_URL=your_client_cert_url
FIREBASE_UNIVERSE_DOMAIN=googleapis.com
```

### 4. Run the Server
```bash
node server.js
```
The server will start on `http://localhost:5000` (or your defined PORT).

## 📡 API Endpoints Overview

| Feature | Base Route | Description |
| :--- | :--- | :--- |
| **Users** | `/users` | User management endpoints |
| **Clients** | `/clients` | Client-related data endpoints |
| **Messages** | `/messages` | Contact/Message endpoints |
| **Services** | `/services` | Service CRUD endpoints |
| **Team** | `/team` | Team member endpoints |
| **Reviews** | `/reviews` | Review/Testimonial endpoints |

## 📄 License
This project is licensed under the ISC License.
