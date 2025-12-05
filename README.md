# SINTI V2 - Setup Guide

## Prerequisites

1. **Firebase Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project
   - Enable Authentication (Email/Password or Google)
   - Create Firestore Database (start in test mode)
   - Enable Firebase Storage

2. **OpenAI API Key**:
   - Go to [OpenAI Platform](https://platform.openai.com/)
   - Create an API key
   - Add billing information (required for Vision API)

## Installation

1. **Install dependencies** (already done):
```bash
npm install
```

2. **Configure Environment Variables**:

Create `.env.local` file in the project root:

```env
# Copy these values from your Firebase project settings
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Your OpenAI API key
OPENAI_API_KEY=sk-...
```

3. **Run Development Server**:
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Features

- 📸 **Real-time Barcode Scanner**: Camera-based product scanning
- 🤖 **AI Product Recognition**: Fallback identification when barcode fails
- 👨‍👩‍👧‍👦 **Family Settings**: Track household size for better predictions
- 📊 **Smart Surveys**: Post-consumption surveys with anomaly detection
- ✨ **Modern UI**: Beautiful, responsive design with smooth animations

## Tech Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS
- **Backend**: Firebase (Firestore, Auth, Storage)
- **Barcode**: @zxing/library
- **AI**: OpenAI GPT-4 Vision
- **UI**: Radix UI, Framer Motion, Lucide Icons
