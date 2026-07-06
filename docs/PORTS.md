# System Ports Configuration

## Running Services

- **Backend Server**: Port 5000
  - http://localhost:5050
  - Handles both CredMate and External PSP APIs

- **External PSP Portal**: Port 5174 (Greenish Theme)
  - http://localhost:5174
  - New system we just built
  - For external PSPs to manage order books and request loans

- **CredMate PSP Client**: Port 5173 (Purple/Magenta Theme)
  - http://localhost:5173
  - Existing CredMate system
  - Where PSPs manage repayments, credit lines, etc.

## Usage Flow

1. **External PSP Portal (5173)**:
   - Register/Login
   - Create orders
   - Request financing (calls CredMate webhook)

2. **Backend validates** via webhook

3. **CredMate PSP Portal (5174)**:
   - PSP manages repayments
   - Views credit line status
   - Handles all financing management

## Quick Start

```bash
# Start all services (run in separate terminals)

# Terminal 1: Backend
cd server
npm run dev

# Terminal 2: CredMate PSP Client
cd client
npm run dev

# Terminal 3: External PSP Portal
cd external_psp
npm run dev
```

## Access URLs

- External PSP: http://localhost:5174
- CredMate PSP: http://localhost:5173
- Backend API: http://localhost:5050
