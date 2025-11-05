#!/bin/bash

echo "🚀 CollabMeet - Professional Collaboration Platform"
echo "============================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

# Get script directory and navigate to backend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

# Check if we're in the right directory
if [ ! -f "websocket-server.js" ]; then
    echo "❌ Error: websocket-server.js not found. Please run from project root."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed successfully!"
fi

# Start the server
echo ""
echo "🌐 Starting CollabMeet server..."
echo "🔗 Server URL: http://localhost:8080"
echo "🎥 Features: Video Calls + Live Whiteboard"
echo "🔄 Real-time collaboration enabled"
echo ""
echo "📝 Press Ctrl+C to stop the server"
echo "============================================="
echo ""

# Start server in background and open Chrome
npm start &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 3

# Open Chrome automatically
echo "🌐 Opening Chrome browser..."
if command -v open &> /dev/null; then
    # macOS
    open -a "Google Chrome" http://localhost:8080
elif command -v google-chrome &> /dev/null; then
    # Linux
    google-chrome http://localhost:8080
elif command -v chrome &> /dev/null; then
    # Windows/Linux alternative
    chrome http://localhost:8080
else
    echo "⚠️  Chrome not found. Please open http://localhost:8080 manually"
fi

echo "✅ CollabMeet is ready!"
echo "📱 Browser should open automatically"
echo ""

# Wait for server process
wait $SERVER_PID