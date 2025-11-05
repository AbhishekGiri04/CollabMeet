// Whiteboard functionality
let canvas = document.getElementById('whiteboard-canvas');
let ctx = canvas.getContext('2d');
let isDrawing = false;
let currentTool = 'pen';
let lastX = 0;
let lastY = 0;

// WebSocket connection for real-time collaboration
let ws = null;
let sessionId = new URLSearchParams(window.location.search).get('session') || Math.random().toString(36).substr(2, 9);
let userRole = new URLSearchParams(window.location.search).get('role') || 'participant';

// Initialize WebSocket connection
function initWebSocket() {
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = async function() {
            console.log('Connected to CollabMeet whiteboard server');
            
            // Add welcome message only once per session
            if (!sessionStorage.getItem('welcome_shown')) {
                addChatMessage('System', 'Welcome to CollabMeet! This whiteboard syncs in real-time with all participants.');
                sessionStorage.setItem('welcome_shown', 'true');
            }
            
            // Set default names and IDs
            let userName = userRole === 'admin' ? 'Host' : 'Participant';
            let userId = 'user_' + Math.random().toString(36).substr(2, 9);
            
            // Check if coming from video call with stored session
            const storedSession = sessionStorage.getItem('webrtc_session');
            const fromVideoCall = new URLSearchParams(window.location.search).get('from') === 'videocall';
            
            if (storedSession && fromVideoCall) {
                // Restore session data from video call
                const sessionData = JSON.parse(storedSession);
                userName = sessionData.userName || userName;
                userId = sessionData.userId || userId;
                console.log('Restored session data from video call:', sessionData);
            } else if (userRole !== 'admin') {
                // Only ask participants for name, not hosts
                const enteredName = await showNameEntryModal();
                if (enteredName && enteredName.trim()) {
                    userName = enteredName.trim();
                } else {
                    // If cancelled, redirect to home
                    window.location.href = '../index.html';
                    return;
                }
            }
            // Host uses default 'Host' name without prompt
            
            // Store user info globally
            currentUserId = userId;
            currentUserName = userName;
            
            // Send join session message with whiteboard flag
            ws.send(JSON.stringify({
                type: 'join',
                sessionId: sessionId,
                userId: userId,
                userRole: userRole === 'admin' ? 'host' : 'participant',
                userName: userName,
                isWhiteboardMode: true,
                timestamp: Date.now()
            }));
            
            console.log('Joined whiteboard session as:', userName, 'Role:', userRole, 'ID:', userId);
        };
        
        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                console.log('Received whiteboard message:', data.type, data);
                handleIncomingMessage(data);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };
        
        ws.onclose = function() {
            console.log('Disconnected from whiteboard server');
            
            // Check if this is a planned transition (whiteboard switch)
            const isTransitioning = sessionStorage.getItem('whiteboard_transitioning');
            
            if (!isTransitioning) {
                showToast('error', 'Connection Lost', 'Attempting to reconnect...');
                // Attempt to reconnect after 3 seconds
                setTimeout(initWebSocket, 3000);
            } else {
                console.log('Planned transition - not showing reconnect message');
                sessionStorage.removeItem('whiteboard_transitioning');
            }
        };
        
        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            showToast('error', 'Connection Error', 'Failed to connect to collaboration server.');
        };
    } catch (error) {
        console.error('Failed to connect to server:', error);
        showToast('error', 'Server Error', 'Could not establish connection.');
    }
}

// Store user info globally
let currentUserId = null;
let currentUserName = null;
let connectedParticipants = [];

// Send message via WebSocket
function sendWebSocketMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Use stored user info
        const messageData = {
            ...data,
            sessionId: sessionId,
            userId: currentUserId,
            userName: currentUserName
        };
        ws.send(JSON.stringify(messageData));
        console.log('Sending whiteboard message:', messageData.type, messageData);
    } else {
        console.log('WebSocket not connected, cannot send message');
    }
}

// Handle incoming WebSocket messages
function handleIncomingMessage(data) {
    switch (data.type) {
        case 'draw':
            console.log('🎨 DRAW DATA RECEIVED:', data.fromX, data.fromY, '->', data.toX, data.toY);
            // Only draw if it's from another user (not own drawing)
            if (data.userId !== currentUserId && data.fromX !== undefined && data.fromY !== undefined && data.toX !== undefined && data.toY !== undefined) {
                console.log('🎨 DRAWING REMOTE LINE ON CANVAS NOW!');
                drawRemoteLine(data.fromX, data.fromY, data.toX, data.toY, data.tool || 'pen');
                console.log('✅ REMOTE LINE DRAWN SUCCESSFULLY!');
            } else if (data.userId === currentUserId) {
                console.log('🚫 IGNORING OWN DRAWING FROM SERVER');
            } else {
                console.log('❌ INVALID DRAW DATA!');
            }
            break;
        case 'clear':
            console.log('Received clear command from server');
            // Always clear canvas regardless of local permissions
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            break;
        case 'shape':
            console.log('🔷 SHAPE DATA RECEIVED:', data);
            console.log('🔷 My ID:', currentUserId, 'Shape from:', data.userId);
            // Only draw shapes from OTHER users (not own shapes to avoid duplicates)
            if (data.userId !== currentUserId) {
                console.log('🔷 DRAWING REMOTE SHAPE:', data.shape, 'at coordinates:', data.startX, data.startY, data.endX, data.endY);
                drawRemoteShape(data.startX, data.startY, data.endX, data.endY, data.shape);
                console.log('✅ REMOTE SHAPE DRAWN ON CANVAS!');
            } else {
                console.log('🙅 IGNORING OWN SHAPE FROM SERVER');
            }
            break;
        case 'user-joined':
            // Only show join message for new users, not transitions
            const isTransition = sessionStorage.getItem('webrtc_session');
            if (!isTransition) {
                addChatMessage('System', `${data.userName} joined the whiteboard`);
            }
            updateParticipantCount(data.participantCount);
            // Add the new participant to our local list if not already present
            if (!connectedParticipants.some(p => p.userId === data.userId)) {
                // Determine role based on the data or default logic
                const participantRole = data.userRole || (data.userId === currentUserId ? (userRole === 'admin' ? 'host' : 'participant') : 'participant');
                connectedParticipants.push({
                    userId: data.userId,
                    userName: data.userName,
                    role: participantRole
                });
            }
            updateParticipantsList();
            break;
        case 'user-left':
            // Don't show leave messages during whiteboard transitions
            const isWhiteboardTransition = sessionStorage.getItem('whiteboard_transitioning');
            if (!isWhiteboardTransition && !data.isTransition) {
                addChatMessage('System', `${data.userName} left the whiteboard`);
            }
            updateParticipantCount(data.participantCount);
            // Remove the participant from our local list
            connectedParticipants = connectedParticipants.filter(p => p.userId !== data.userId);
            updateParticipantsList();
            break;
        case 'chat':
            console.log('💬 FORCE CHAT DISPLAY:', data);
            // FORCE show ALL messages to ALL users
            let displayName = data.userName;
            if (data.userName === currentUserName) {
                displayName = userRole === 'admin' ? 'You (Host)' : 'You';
            }
            console.log('💬 FORCE ADDING MESSAGE:', displayName, data.message);
            addChatMessage(displayName, data.message);
            break;
            
        case 'switch-to-video':
            console.log('Switching to video call mode');
            // Show notification and redirect to video call
            if (data.userName !== currentUserName) {
                addChatMessage('System', `${data.userName} switched to video call. Joining video meeting...`);
                
                // Mark as transitioning
                sessionStorage.setItem('video_transitioning', 'true');
                
                setTimeout(() => {
                    const role = userRole === 'admin' ? 'admin' : 'participant';
                    window.location.href = `meeting-room.html?session=${sessionId}&role=${role}&from=whiteboard`;
                }, 2000);
            }
            break;
            
        case 'transfer-whiteboard-control':
            console.log('Whiteboard control transferred to:', data.toUserId, data.toUserName);
            console.log('My ID:', currentUserId, 'My Name:', currentUserName);
            if (data.toUserId === currentUserId || data.toUserName === currentUserName) {
                whiteboardController = currentUserId;
                canDraw = true;
                setDrawingPermissions(true);
                addChatMessage('System', `${data.fromUser} gave you whiteboard control`);
                showToast('success', 'Control Granted', 'You can now draw on the whiteboard');
            } else {
                whiteboardController = data.toUserId;
                if (userRole === 'admin') {
                    canDraw = false;
                    setDrawingPermissions(false);
                }
                addChatMessage('System', `${data.fromUser} transferred whiteboard control to ${data.toUserName}`);
            }
            break;
            
        case 'take-whiteboard-control':
            console.log('Whiteboard control taken back');
            whiteboardController = 'admin';
            if (userRole === 'admin') {
                canDraw = true;
                setDrawingPermissions(true);
                showToast('success', 'Control Restored', 'Whiteboard control restored');
            } else {
                canDraw = false;
                setDrawingPermissions(false);
                showToast('info', 'Control Removed', 'Admin took back whiteboard control');
            }
            addChatMessage('System', `${data.fromUser} took back whiteboard control`);
            break;
        case 'whiteboard-meeting-ended':
            console.log('Whiteboard meeting ended by host');
            showToast('info', 'Meeting Ended', 'Host has ended the whiteboard meeting');
            addChatMessage('System', 'Host has ended the whiteboard meeting');
            
            // Clear session data
            sessionStorage.clear();
            
            // Redirect to home after 2 seconds
            setTimeout(() => {
                window.location.href = '../index.html';
            }, 2000);
            break;
        case 'session-state':
            console.log('Received session state:', data);
            // Restore whiteboard state
            if (data.whiteboard) {
                data.whiteboard.forEach(drawData => {
                    drawRemoteLine(drawData.fromX, drawData.fromY, drawData.toX, drawData.toY, drawData.tool);
                });
            }
            // Restore chat messages
            if (data.messages) {
                data.messages.forEach(msg => {
                    if (msg.userName !== 'You') {
                        addChatMessage(msg.userName, msg.message);
                    }
                });
            }
            // Initialize participants list with current user
            connectedParticipants = [{
                userId: currentUserId,
                userName: currentUserName,
                role: userRole === 'admin' ? 'host' : 'participant'
            }];
            updateParticipantCount(data.participantCount || 1);
            updateParticipantsList();
            break;
    }
}

// Draw remote user's line
function drawRemoteLine(fromX, fromY, toX, toY, tool) {
    console.log('🎨 DRAWING REMOTE LINE:', fromX, fromY, '->', toX, toY);
    
    // Ensure canvas is ready
    if (!ctx || !canvas) {
        console.log('❌ Canvas not ready!');
        return;
    }
    
    // Set drawing properties based on tool
    if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 10;
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000000'; // Black color like local drawing
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Draw the line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    
    console.log('✅ LINE DRAWN ON CANVAS!');
}

// Draw remote user's shape
function drawRemoteShape(startX, startY, endX, endY, shape) {
    console.log('🔷 DRAWING REMOTE SHAPE:', shape, 'at', startX, startY, 'to', endX, endY);
    
    // Ensure canvas is ready
    if (!ctx || !canvas) {
        console.log('❌ Canvas not ready for shape!');
        return;
    }
    
    // Save current context
    ctx.save();
    
    // Set shape drawing properties
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';
    
    console.log('🔷 Drawing', shape, 'with context ready');
    
    if (shape === 'rectangle') {
        const width = endX - startX;
        const height = endY - startY;
        console.log('🟦 Drawing rectangle:', width, 'x', height, 'at', startX, startY);
        ctx.strokeRect(startX, startY, width, height);
    } else if (shape === 'circle') {
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        console.log('⚪ Drawing circle with radius:', radius, 'at center', startX, startY);
        ctx.beginPath();
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (shape === 'line') {
        console.log('📍 Drawing line from', startX, startY, 'to', endX, endY);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
    
    // Restore context
    ctx.restore();
    
    console.log('✅ REMOTE SHAPE DRAWN ON CANVAS!');
}

// Set canvas size
function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

// Initialize canvas
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Drawing functions
function startDrawing(e) {
    // Only allow drawing if user has permission
    if (!canDraw) {
        return;
    }
    
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
    
    if (currentTool === 'shape') {
        isDrawingShape = true;
        shapeStartX = lastX;
        shapeStartY = lastY;
    }
}

function draw(e) {
    if (!isDrawing || !canDraw) return;
    
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    if (currentTool === 'shape' && isDrawingShape) {
        // Don't draw while dragging shape, just update preview
        return;
    }

    // Draw locally first
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    // Broadcast drawing event to other users
    sendWebSocketMessage({
        type: 'draw',
        fromX: lastX,
        fromY: lastY,
        toX: currentX,
        toY: currentY,
        tool: currentTool,
        timestamp: Date.now()
    });

    lastX = currentX;
    lastY = currentY;
}

function stopDrawing(e) {
    if (currentTool === 'shape' && isDrawingShape) {
        const rect = canvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        drawShape(shapeStartX, shapeStartY, endX, endY, selectedShape);
        isDrawingShape = false;
    }
    isDrawing = false;
}

function drawShape(startX, startY, endX, endY, shape) {
    // Draw locally first for immediate feedback
    drawLocalShape(startX, startY, endX, endY, shape);
    
    // Then broadcast to server for other users
    sendWebSocketMessage({
        type: 'shape',
        startX: startX,
        startY: startY,
        endX: endX,
        endY: endY,
        shape: shape,
        timestamp: Date.now()
    });
}

function drawLocalShape(startX, startY, endX, endY, shape) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (shape === 'rectangle') {
        const width = endX - startX;
        const height = endY - startY;
        ctx.strokeRect(startX, startY, width, height);
    } else if (shape === 'circle') {
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        ctx.beginPath();
        ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (shape === 'line') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
}

// Event listeners
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Tool functions
function setTool(tool) {
    // Only allow tool changes for users with drawing permission
    if (!canDraw) {
        showToast('error', 'View Only', 'You need whiteboard control to use tools.');
        return;
    }
    
    currentTool = tool;
    
    // Update button styles
    document.querySelectorAll('[id$=\"-btn\"]').forEach(btn => {
        btn.className = 'flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm';
    });
    
    document.getElementById(tool + '-btn').className = 'flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition bg-blue-600 text-white text-sm';
    
    // Update cursor and drawing mode
    if (tool === 'pen') {
        canvas.style.cursor = 'crosshair';
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 2;
    } else if (tool === 'eraser') {
        canvas.style.cursor = 'grab';
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 10;
    } else if (tool === 'shape') {
        canvas.style.cursor = 'crosshair';
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 2;
        showShapeMenu();
    }
}

let selectedShape = 'rectangle';
let isDrawingShape = false;
let shapeStartX, shapeStartY;

function showShapeMenu() {
    const menu = document.createElement('div');
    menu.id = 'shape-menu';
    menu.className = 'absolute top-16 left-4 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-10';
    menu.innerHTML = `
        <div class="flex gap-1">
            <button onclick="selectShape('rectangle')" class="px-3 py-2 hover:bg-gray-100 rounded text-sm">Rectangle</button>
            <button onclick="selectShape('circle')" class="px-3 py-2 hover:bg-gray-100 rounded text-sm">Circle</button>
            <button onclick="selectShape('line')" class="px-3 py-2 hover:bg-gray-100 rounded text-sm">Line</button>
        </div>
    `;
    
    // Remove existing menu
    const existingMenu = document.getElementById('shape-menu');
    if (existingMenu) existingMenu.remove();
    
    document.querySelector('.flex-1').appendChild(menu);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        if (document.getElementById('shape-menu')) {
            document.getElementById('shape-menu').remove();
        }
    }, 3000);
}

function selectShape(shape) {
    selectedShape = shape;
    document.getElementById('shape-menu').remove();
    showToast('success', 'Shape Selected', `${shape.charAt(0).toUpperCase() + shape.slice(1)} tool activated`);
}

function clearCanvas() {
    // Allow clear for admin/host or participant with drawing permission
    if (!canDraw) {
        showToast('error', 'View Only', 'You need whiteboard control to clear.');
        return;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Broadcast clear event to other users
    sendWebSocketMessage({
        type: 'clear',
        timestamp: Date.now()
    });
}

function aiOCR() {
    // Get canvas image data for OCR
    const imageData = canvas.toDataURL('image/png');
    
    if (ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(channel => channel !== 0)) {
        showToast('success', 'AI OCR Processing', 'Analyzing handwritten text on canvas...');
        
        // Simulate OCR processing
        setTimeout(() => {
            const mockResults = [
                'Meeting notes: Q4 targets',
                'Revenue: $2.5M goal',
                'Team size: 15 members',
                'Launch date: March 2024'
            ];
            
            const randomResult = mockResults[Math.floor(Math.random() * mockResults.length)];
            
            // Add OCR result as text on canvas
            ctx.font = '16px Arial';
            ctx.fillStyle = '#2563eb';
            ctx.fillText(`OCR: ${randomResult}`, 20, canvas.height - 30);
            
            showToast('success', 'Text Recognized', `Found: "${randomResult}"`);
        }, 2000);
    } else {
        showToast('error', 'No Content', 'Draw some text on the canvas first for OCR analysis.');
    }
}

function shapeRecognition() {
    // Check if canvas has content
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hasContent = imageData.data.some(channel => channel !== 0);
    
    if (hasContent) {
        showToast('success', 'AI Shape Analysis', 'Analyzing and cleaning up shapes...');
        
        setTimeout(() => {
            // Simulate shape cleanup by redrawing cleaner shapes
            const shapes = ['circle', 'rectangle', 'triangle'];
            const detectedShape = shapes[Math.floor(Math.random() * shapes.length)];
            
            // Clear and redraw with clean shape
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 3;
            
            if (detectedShape === 'circle') {
                ctx.beginPath();
                ctx.arc(canvas.width/2, canvas.height/2, 80, 0, 2 * Math.PI);
                ctx.stroke();
            } else if (detectedShape === 'rectangle') {
                ctx.strokeRect(canvas.width/2 - 80, canvas.height/2 - 60, 160, 120);
            } else {
                ctx.beginPath();
                ctx.moveTo(canvas.width/2, canvas.height/2 - 60);
                ctx.lineTo(canvas.width/2 - 80, canvas.height/2 + 60);
                ctx.lineTo(canvas.width/2 + 80, canvas.height/2 + 60);
                ctx.closePath();
                ctx.stroke();
            }
            
            showToast('success', 'Shape Cleaned', `Detected and cleaned: ${detectedShape}`);
        }, 1500);
    } else {
        showToast('error', 'No Shapes Found', 'Draw some shapes on the canvas first for AI analysis.');
    }
}

function exportCanvas() {
    // Check if canvas has content
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hasContent = imageData.data.some(channel => channel !== 0);
    
    if (hasContent) {
        // Create temporary canvas with white background
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        
        // Fill with white background
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Draw original canvas content on top
        tempCtx.drawImage(canvas, 0, 0);
        
        const link = document.createElement('a');
        link.download = `collabmeet-whiteboard-${sessionId}.png`;
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
        
        showToast('success', 'Whiteboard Exported', 'Your whiteboard has been downloaded as PNG image.');
    } else {
        showToast('error', 'Nothing to Export', 'Draw something on the whiteboard first.');
    }
}

// UI functions
function toggleParticipants() {
    const panel = document.getElementById('participants-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'flex';
}

function copyMeetingLink() {
    const sessionText = `Session: ${sessionId}`;
    navigator.clipboard.writeText(sessionText).then(() => {
        showToast('success', 'Session Copied', 'Meeting link copied to clipboard!');
    }).catch(() => {
        showToast('error', 'Copy Failed', 'Failed to copy session ID.');
    });
}

function switchToVideoCall() {
    // Mark as transitioning to prevent leave messages
    sessionStorage.setItem('video_transitioning', 'true');
    
    // Notify other participants about switch to video call
    sendWebSocketMessage({
        type: 'switch-to-video',
        sessionId: sessionId,
        userName: currentUserName,
        isTransition: true
    });
    
    // Show transition message
    addChatMessage('System', 'Switching to video call mode...');
    
    // Redirect to video call with session info
    setTimeout(() => {
        const role = userRole === 'admin' ? 'admin' : 'participant';
        window.location.href = `meeting-room.html?session=${sessionId}&role=${role}&from=whiteboard`;
    }, 1000);
}

function goHome() {
    // Prevent multiple leave messages
    if (sessionStorage.getItem('leaving_session')) {
        return;
    }
    sessionStorage.setItem('leaving_session', 'true');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (userRole === 'admin') {
            // Host ends meeting for everyone
            sendWebSocketMessage({
                type: 'end-whiteboard-meeting',
                sessionId: sessionId,
                userName: currentUserName,
                reason: 'host_ended_meeting'
            });
        } else {
            // Participant leaves meeting
            sendWebSocketMessage({
                type: 'user-leaving',
                sessionId: sessionId,
                userName: currentUserName,
                reason: 'left_meeting'
            });
        }
    }
    
    // Clear session data
    sessionStorage.clear();
    
    // Redirect to home
    setTimeout(() => {
        window.location.href = '../index.html';
    }, 500);
}

// Chat functions
function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message) {
        console.log('Sending chat message:', message);
        // Send message to server (will broadcast to all including self)
        sendWebSocketMessage({
            type: 'chat',
            message: message,
            timestamp: Date.now()
        });
        
        input.value = '';
    }
}

// Helper function to add chat messages - Video call style
function addChatMessage(userName, message) {
    const chatMessages = document.getElementById('chat-messages');
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'text-sm mb-4';
    
    const isSystem = userName === 'System';
    const isYou = (userName === currentUserName) || 
                 (userName === 'Host' && userRole === 'admin') ||
                 (userName.includes('You'));
    
    if (isSystem) {
        // Check for duplicate system messages
        const existingMessages = chatMessages.querySelectorAll('.system-message');
        const isDuplicate = Array.from(existingMessages).some(msg => 
            msg.textContent.includes(message) && 
            Math.abs(Date.now() - parseInt(msg.dataset.timestamp || '0')) < 5000
        );
        
        if (isDuplicate) {
            console.log('Duplicate system message prevented:', message);
            return;
        }
        
        const isJoinMessage = message.includes('joined');
        const isLeaveMessage = message.includes('left');
        const iconClass = isJoinMessage ? 'fa-user-plus text-green-600' : 
                         isLeaveMessage ? 'fa-user-minus text-red-600' : 
                         'fa-info text-blue-600';
        
        messageDiv.className = 'text-sm system-message';
        messageDiv.dataset.timestamp = Date.now();
        messageDiv.innerHTML = `
            <div class="flex items-center justify-center mb-6">
                <div class="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm border" style="max-width: calc(100% - 1rem);">
                    <i class="fas ${iconClass} text-xs flex-shrink-0"></i>
                    <span class="text-xs text-gray-600 font-medium" style="word-break: break-all; max-width: 180px;">${message}</span>
                    <span class="text-xs text-gray-400 flex-shrink-0">${timeString}</span>
                </div>
            </div>
        `;
    } else {
        const initial = userName.charAt(0).toUpperCase();
        const bgColor = isYou ? 'bg-blue-500' : 'bg-green-500';
        const displayName = isYou ? (userRole === 'admin' ? 'You (Host)' : `You`) : userName;
        
        messageDiv.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <div class="w-6 h-6 ${bgColor} rounded-full flex items-center justify-center text-white text-xs font-bold">${initial}</div>
                <span class="text-gray-700 font-semibold">${displayName}</span>
                <span class="text-xs text-gray-500">${timeString}</span>
            </div>
            <div class="ml-8 bg-gray-50 rounded-lg px-3 py-2" style="max-width: calc(100% - 2rem); word-break: break-all;">
                <p class="text-gray-700" style="word-break: break-all; overflow-wrap: break-word;">${message}</p>
            </div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Update participant count with real data
function updateParticipantCount(count) {
    // Use actual count from server, minimum 1
    const actualCount = Math.max(count || 1, 1);
    
    document.getElementById('participant-count').textContent = actualCount;
    document.getElementById('connected-users').textContent = actualCount;
    
    console.log(`👥 Updated participant count to: ${actualCount}`);
}

// Update participants list in sidebar using real participant data
function updateParticipantsList() {
    const participantsList = document.querySelector('#participants-panel .space-y-2');
    if (!participantsList) return;
    
    console.log(`👥 Updating participants list with real data:`, connectedParticipants);
    
    // Clear all participants
    participantsList.innerHTML = '';
    
    // Add current user first
    const currentUser = connectedParticipants.find(p => p.userId === currentUserId) || {
        userId: currentUserId,
        userName: currentUserName,
        role: userRole === 'admin' ? 'host' : 'participant'
    };
    
    const youDiv = document.createElement('div');
    youDiv.className = 'flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200';
    const youRole = currentUser.role === 'host' ? 'Host' : 'Participant';
    const youInitial = currentUser.userName.charAt(0).toUpperCase();
    youDiv.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                ${youInitial}
            </div>
            <div>
                <div class="font-medium text-sm text-gray-900">You (${currentUser.userName})</div>
                <div class="text-xs text-gray-500">${youRole}</div>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <div class="w-2 h-2 bg-green-400 rounded-full"></div>
        </div>
    `;
    participantsList.appendChild(youDiv);
    
    // Add other participants using real data
    const otherParticipants = connectedParticipants.filter(p => p.userId !== currentUserId);
    
    // If current user is participant and no host in list, add host entry
    if (userRole !== 'admin' && !otherParticipants.some(p => p.role === 'host')) {
        const hostDiv = document.createElement('div');
        hostDiv.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
        hostDiv.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    H
                </div>
                <div>
                    <div class="font-medium text-sm text-gray-900">Host</div>
                    <div class="text-xs text-gray-500">Host</div>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
        `;
        participantsList.appendChild(hostDiv);
    }
    
    // If host and no participants in list, show placeholder for expected participants
    if (userRole === 'admin' && otherParticipants.length === 0) {
        const placeholderDiv = document.createElement('div');
        placeholderDiv.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg opacity-50';
        placeholderDiv.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    P
                </div>
                <div>
                    <div class="font-medium text-sm text-gray-900">Waiting for participants...</div>
                    <div class="text-xs text-gray-500">Participant</div>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
            </div>
        `;
        participantsList.appendChild(placeholderDiv);
    }
    
    otherParticipants.forEach((participant, index) => {
        const otherDiv = document.createElement('div');
        otherDiv.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
        
        const isHost = participant.role === 'host';
        const otherRole = isHost ? 'Host' : 'Participant';
        const otherInitial = participant.userName.charAt(0).toUpperCase();
        const bgColor = isHost ? 'bg-orange-500' : 'bg-green-500';
        
        // Add control buttons for admin (only for participants)
        const controlButtons = userRole === 'admin' && !isHost ? `
            <div class="flex items-center gap-1">
                <button onclick="giveWhiteboardControlToParticipant('${participant.userId}')" class="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600" title="Give Control">
                    <i class="fas fa-pen"></i>
                </button>
                <button onclick="takeWhiteboardControl()" class="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600" title="Take Control">
                    <i class="fas fa-hand-paper"></i>
                </button>
                <div class="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
        ` : `
            <div class="flex items-center gap-2">
                <div class="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
        `;
        
        otherDiv.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 ${bgColor} rounded-full flex items-center justify-center text-white text-sm font-bold">
                    ${otherInitial}
                </div>
                <div>
                    <div class="font-medium text-sm text-gray-900">${participant.userName}</div>
                    <div class="text-xs text-gray-500">${otherRole}</div>
                </div>
            </div>
            ${controlButtons}
        `;
        participantsList.appendChild(otherDiv);
    });
    
    console.log(`✅ Added ${connectedParticipants.length} participants to list`);
}

// Enter key for chat
document.getElementById('chat-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Set session ID from URL or generate random
document.getElementById('session-id').textContent = sessionId;

// Whiteboard control state
let whiteboardController = 'admin'; // Default admin controls
let canDraw = userRole === 'admin';

// Set initial drawing permissions and UI
if (userRole === 'admin') {
    setDrawingPermissions(true);
    console.log('Admin: Drawing enabled by default');
    // Show video call button for admin
    document.getElementById('video-call-btn').style.display = 'flex';
    document.getElementById('end-meeting-btn').style.display = 'flex';
} else {
    setDrawingPermissions(false);
    showWhiteboardStatus();
    console.log('Participant: View-only mode by default');
    // Hide video call button for participants, show only leave
    document.getElementById('video-call-btn').style.display = 'none';
    const leaveBtn = document.getElementById('end-meeting-btn');
    leaveBtn.style.display = 'flex';
    leaveBtn.disabled = false;
    leaveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    // Change button text to "Leave" for participants
    leaveBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Leave';
}

// Function to set drawing permissions
function setDrawingPermissions(allowed) {
    canDraw = allowed;
    
    if (allowed) {
        // Enable drawing
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'crosshair';
        
        // Enable ALL tool buttons
        document.querySelectorAll('#pen-btn, #eraser-btn, #shape-btn').forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.style.pointerEvents = 'auto';
        });
        
        // Enable action buttons
        const clearBtn = document.querySelector('button[onclick="clearCanvas()"]');
        const exportBtn = document.querySelector('button[onclick="exportCanvas()"]');
        if (clearBtn) {
            clearBtn.disabled = false;
            clearBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            clearBtn.style.pointerEvents = 'auto';
        }
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            exportBtn.style.pointerEvents = 'auto';
        }
    } else {
        // Disable drawing
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'not-allowed';
        
        // Disable ALL tool buttons
        document.querySelectorAll('#pen-btn, #eraser-btn, #shape-btn').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            btn.style.pointerEvents = 'none';
        });
        
        // Disable action buttons
        const clearBtn = document.querySelector('button[onclick="clearCanvas()"]');
        const exportBtn = document.querySelector('button[onclick="exportCanvas()"]');
        if (clearBtn) {
            clearBtn.disabled = true;
            clearBtn.classList.add('opacity-50', 'cursor-not-allowed');
            clearBtn.style.pointerEvents = 'none';
        }
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.classList.add('opacity-50', 'cursor-not-allowed');
            exportBtn.style.pointerEvents = 'none';
        }
    }
    
    showWhiteboardStatus();
}

// Function to show whiteboard status
function showWhiteboardStatus() {
    // Remove existing status
    const existingStatus = document.getElementById('whiteboard-status');
    if (existingStatus) existingStatus.remove();
    
    // Create status banner
    const statusBanner = document.createElement('div');
    statusBanner.id = 'whiteboard-status';
    statusBanner.className = 'fixed top-16 left-4 z-50 max-w-md';
    
    if (canDraw) {
        statusBanner.innerHTML = `
            <div class="bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded-lg shadow-lg">
                <div class="flex items-center gap-2">
                    <i class="fas fa-pen text-green-600"></i>
                    <span class="font-medium">Drawing Enabled</span>
                    <span class="text-sm">- You can now control the whiteboard</span>
                </div>
            </div>
        `;
    } else {
        statusBanner.innerHTML = `
            <div class="bg-blue-100 border border-blue-300 text-blue-800 px-4 py-3 rounded-lg shadow-lg">
                <div class="flex items-center gap-2">
                    <i class="fas fa-eye text-blue-600"></i>
                    <span class="font-medium">View Only Mode</span>
                    <span class="text-sm">- ${whiteboardController === 'admin' ? 'Host' : 'Participant'} is controlling the whiteboard</span>
                </div>
            </div>
        `;
    }
    
    document.body.appendChild(statusBanner);
    
    // Auto-hide after 1 second
    setTimeout(() => {
        if (statusBanner) statusBanner.remove();
    }, 1000);
}

// Function to give whiteboard control
function giveWhiteboardControl(userId) {
    console.log('🔄 Giving control to:', userId);
    if (userRole !== 'admin') {
        showToast('error', 'Access Denied', 'Only admin can transfer whiteboard control.');
        return;
    }
    
    sendWebSocketMessage({
        type: 'transfer-whiteboard-control',
        toUserId: userId,
        fromUser: currentUserName
    });
    
    showToast('success', 'Control Transferred', 'Whiteboard control given to participant');
}

// Function to give control to any participant by userId
function giveWhiteboardControlToParticipant(userId) {
    console.log('🔄 Giving control to participant:', userId);
    if (userRole !== 'admin') {
        showToast('error', 'Access Denied', 'Only admin can transfer whiteboard control.');
        return;
    }
    
    const participant = connectedParticipants.find(p => p.userId === userId);
    if (!participant) {
        showToast('error', 'Error', 'Participant not found.');
        return;
    }
    
    // Send control transfer with participant userId
    sendWebSocketMessage({
        type: 'transfer-whiteboard-control',
        toUserId: userId,
        toUserName: participant.userName,
        fromUser: currentUserName
    });
    
    showToast('success', 'Control Transferred', `Whiteboard control given to ${participant.userName}`);
}

// Function to take back whiteboard control
function takeWhiteboardControl() {
    if (userRole !== 'admin') {
        showToast('error', 'Access Denied', 'Only admin can take whiteboard control.');
        return;
    }
    
    sendWebSocketMessage({
        type: 'take-whiteboard-control',
        fromUser: currentUserName
    });
}

// Toast notification functions
function showToast(type, title, message) {
    // Create toast if doesn't exist
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'fixed top-4 right-4 z-50 transform translate-x-full transition-transform duration-300 ease-in-out';
        toast.innerHTML = `
            <div class="bg-white border border-gray-200 rounded-lg shadow-lg p-4 flex items-center gap-3 min-w-80">
                <div id="toast-icon" class="w-8 h-8 rounded-full flex items-center justify-center">
                    <i class="fas fa-check text-white"></i>
                </div>
                <div class="flex-1">
                    <div id="toast-title" class="font-medium text-gray-900"></div>
                    <div id="toast-message" class="text-sm text-gray-600"></div>
                </div>
                <button onclick="hideToast()" class="text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        document.body.appendChild(toast);
    }
    
    const icon = document.getElementById('toast-icon');
    const titleEl = document.getElementById('toast-title');
    const messageEl = document.getElementById('toast-message');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    if (type === 'success') {
        icon.className = 'w-8 h-8 bg-green-500 rounded-full flex items-center justify-center';
        icon.innerHTML = '<i class="fas fa-check text-white"></i>';
    } else if (type === 'error') {
        icon.className = 'w-8 h-8 bg-red-500 rounded-full flex items-center justify-center';
        icon.innerHTML = '<i class="fas fa-times text-white"></i>';
    }
    
    toast.classList.remove('translate-x-full');
    toast.classList.add('translate-x-0');
    
    setTimeout(() => {
        hideToast();
    }, 4000);
}

function hideToast() {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.classList.remove('translate-x-0');
        toast.classList.add('translate-x-full');
    }
}

// Set system timestamp
const now = new Date();
const systemTime = now.toLocaleTimeString('en-US', { 
    hour12: true,
    hour: 'numeric',
    minute: '2-digit'
});
document.getElementById('system-timestamp').textContent = systemTime;

// Check if coming from video call
const urlParams = new URLSearchParams(window.location.search);
const fromVideoCall = urlParams.get('from') === 'videocall';

if (fromVideoCall) {
    // Restore session info from video call
    const storedSession = sessionStorage.getItem('webrtc_session');
    if (storedSession) {
        const sessionData = JSON.parse(storedSession);
        console.log('Restoring session from video call:', sessionData);
        
        // Update UI elements with restored name
        setTimeout(() => {
            updateParticipantCount(2); // Host + Participant
            updateParticipantsList(2);
            showToast('success', 'Whiteboard Ready', 'Collaborative whiteboard is now active');
        }, 1000);
    }
} else {
    // Initialize participants list for new sessions
    setTimeout(() => {
        updateParticipantCount(1);
        updateParticipantsList(1);
    }, 500);
}

// Initialize WebSocket connection
initWebSocket();

// Show appropriate connection status
if (fromVideoCall) {
    showToast('success', 'Whiteboard Mode', 'Switched to collaborative whiteboard');
} else {
    showToast('success', 'Connecting', 'Joining whiteboard session...');
}

console.log('CollabMeet whiteboard initialized with session:', sessionId);