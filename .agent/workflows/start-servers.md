---
description: Start all SINTI servers (MongoDB Docker + Next.js HTTPS)
---

# SINTI Server Startup Workflow

## Prerequisites
- Docker Desktop must be running
- Node.js installed
- Working directory: `c:\Users\91834\Desktop\New folder\sinti-v2`

## Step 1: Start Docker Desktop
Ensure Docker Desktop is running before proceeding. Look for the Docker icon in the system tray.

// turbo
## Step 2: Start MongoDB Container
```powershell
docker-compose up -d
```

This starts:
- `sinti-v2-mongodb` on port 27017
- `sinti-v2-mongo-express` (admin UI) on port 8081

// turbo
## Step 3: Verify MongoDB is Running
```powershell
docker ps
```

You should see both containers listed.

// turbo
## Step 4: Start Next.js HTTPS Server
```powershell
npm run start:https
```

Server runs on: `https://192.168.1.40.nip.io:3001`

## Connection Details
- **MongoDB URI**: `mongodb://admin:sinti_password_2024@localhost:27017/sinti_v2?authSource=admin`
- **App URL**: `https://192.168.1.40.nip.io:3001`
- **Mongo Express**: `http://localhost:8081`

## Troubleshooting
- If Docker commands fail with "pipe not found", start Docker Desktop first
- If MongoDB connection fails, wait a few seconds for container to fully start
- Use `-k` flag with curl to skip SSL verification for self-signed certs

## Admin Commands
Clear database and images:
```powershell
curl -k -X POST https://192.168.1.40.nip.io:3001/api/admin/clear-data
```
