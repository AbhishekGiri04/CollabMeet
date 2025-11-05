const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active sessions and participants
const sessions = new Map();
const participants = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.json());

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Invalid message format:', error);
        }
    });
    
    ws.on('close', () => {
        handleDisconnection(ws);
    });
});

function handleMessage(ws, data) {
    const { type, sessionId } = data;
    
    switch (type) {
        case 'join':
            handleJoin(ws, data);
            break;
        case 'video-offer':
        case 'video-answer':
        case 'ice-candidate':
            console.log(`WebRTC ${data.type} from ${participants.get(ws)?.id} to ${data.to}`);
            handleWebRTC(ws, data);
            break;
        case 'draw':
            handleDraw(ws, data);
            break;
        case 'clear':
            handleClear(ws, data);
            break;
        case 'shape':
            handleShape(ws, data);
            break;
        case 'chat':
            console.log('Chat message received:', data);
            handleChat(ws, data);
            break;
        case 'mute':
        case 'video-toggle':
            handleMediaControl(ws, data);
            break;
        case 'admit-user':
            handleAdmitUser(ws, data);
            break;
        case 'reject-user':
            handleRejectUser(ws, data);
            break;
        case 'end-meeting':
            handleEndMeeting(ws, data);
            break;
        case 'switch-to-whiteboard':
            handleWhiteboardSwitch(ws, data);
            break;
        case 'switch-to-video':
            handleVideoSwitch(ws, data);
            break;
        case 'user-leaving':
            handleUserLeaving(ws, data);
            break;
        case 'transfer-whiteboard-control':
            handleWhiteboardControlTransfer(ws, data);
            break;
        case 'take-whiteboard-control':
            handleTakeWhiteboardControl(ws, data);
            break;
        case 'end-whiteboard-meeting':
            handleEndWhiteboardMeeting(ws, data);
            break;
    }
}

function handleJoin(ws, data) {
    const { sessionId, userId, userRole, userName } = data;
    
    // Check if this WebSocket is already connected
    if (participants.has(ws)) {
        console.log('WebSocket already connected, ignoring duplicate join');
        return;
    }
    
    // Initialize session if doesn't exist
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            participants: new Set(),
            whiteboard: [],
            messages: [],
            users: new Map(),
            host: null,
            pendingRequests: new Map(),
            admittedUsers: new Set()
        });
    }
    
    const session = sessions.get(sessionId);
    const participantId = userId || generateId();
    
    // If this is the first user (host)
    if (userRole === 'admin' || userRole === 'host') {
        session.host = participantId;
        
        // Store host info
        participants.set(ws, {
            id: participantId,
            sessionId,
            userName: userName || 'Host',
            role: 'host'
        });
        
        session.participants.add(ws);
        session.users.set(participantId, ws);
        session.admittedUsers.add(participantId);
        
        // Send session state to host
        ws.send(JSON.stringify({
            type: 'session-state',
            whiteboard: session.whiteboard,
            messages: session.messages,
            participantCount: session.users.size,
            yourUserId: participantId,
            yourUserName: userName,
            isHost: true
        }));
        
        console.log(`Host ${participantId} (${userName}) created session ${sessionId}`);
        return;
        return;
    }
    
    // Check if this is whiteboard mode (no admission control)
    if (data.isWhiteboardMode) {
        // For whiteboard - add directly to session
        participants.set(ws, {
            id: participantId,
            sessionId,
            userName: userName || 'Participant',
            role: 'participant'
        });
        
        session.participants.add(ws);
        session.users.set(participantId, ws);
        
        // Send session state to participant
        ws.send(JSON.stringify({
            type: 'session-state',
            whiteboard: session.whiteboard,
            messages: session.messages,
            participantCount: session.users.size,
            yourUserId: participantId,
            yourUserName: userName
        }));
        
        // Notify all other participants
        session.participants.forEach(participantWs => {
            if (participantWs !== ws && participantWs.readyState === WebSocket.OPEN) {
                participantWs.send(JSON.stringify({
                    type: 'user-joined',
                    userId: participantId,
                    userName: userName,
                    participantCount: session.users.size
                }));
            }
        });
        
        console.log(`User ${participantId} (${userName}) joined whiteboard session ${sessionId}`);
        return;
    }
    
    // For video call participants - use admission control
    if (!session.host) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'No host found for this session'
        }));
        return;
    }
    
    // Store pending participant info
    participants.set(ws, {
        id: participantId,
        sessionId,
        userName: userName || `User${session.pendingRequests.size + 1}`,
        role: 'participant',
        status: 'pending'
    });
    
    session.pendingRequests.set(participantId, ws);
    
    // Send waiting message to participant
    ws.send(JSON.stringify({
        type: 'waiting-for-admission',
        message: 'Waiting for host to admit you to the meeting'
    }));
    
    // Send admission request to host
    const hostWs = session.users.get(session.host);
    if (hostWs && hostWs.readyState === WebSocket.OPEN) {
        hostWs.send(JSON.stringify({
            type: 'admission-request',
            userId: participantId,
            userName: participants.get(ws).userName,
            sessionId: sessionId
        }));
    }
    
    console.log(`User ${participantId} (${userName}) requesting admission to video session ${sessionId}`);
}

function handleWebRTC(ws, data) {
    const participant = participants.get(ws);
    if (!participant) {
        console.log('WebRTC: Participant not found');
        return;
    }
    
    const session = sessions.get(participant.sessionId);
    if (!session) {
        console.log('WebRTC: Session not found');
        return;
    }
    
    console.log(`WebRTC ${data.type} from ${participant.id} to ${data.to || 'all'}`);
    
    // Forward WebRTC signaling to specific participant or all
    if (data.to) {
        // Send to specific user
        const targetWs = session.users.get(data.to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            const message = {
                type: data.type,
                from: participant.id,
                offer: data.offer,
                answer: data.answer,
                candidate: data.candidate
            };
            targetWs.send(JSON.stringify(message));
            console.log(`WebRTC message sent to ${data.to}`);
        } else {
            console.log(`WebRTC: Target user ${data.to} not found or disconnected`);
        }
    } else {
        // Broadcast to all participants
        broadcastToSession(participant.sessionId, {
            type: data.type,
            from: participant.id,
            offer: data.offer,
            answer: data.answer,
            candidate: data.candidate
        }, ws);
    }
}

function handleDraw(ws, data) {
    const participant = participants.get(ws);
    if (!participant) {
        console.log('Draw: Participant not found');
        return;
    }
    
    const session = sessions.get(participant.sessionId);
    if (!session) {
        console.log('Draw: Session not found');
        return;
    }
    
    console.log(`Draw from ${participant.userName} (${participant.id}):`, data.fromX, data.fromY, data.toX, data.toY);
    
    // Store drawing data with user info
    const drawData = {
        ...data,
        userId: participant.id,
        userName: participant.userName
    };
    session.whiteboard.push(drawData);
    
    // Broadcast to ALL participants (including host to see participant drawings)
    broadcastToSession(participant.sessionId, {
        type: 'draw',
        ...drawData
    });
    
    console.log(`Broadcasted draw to ${session.participants.size} participants`);
}

function handleClear(ws, data) {
    const participant = participants.get(ws);
    if (!participant) {
        console.log('Clear: Participant not found');
        return;
    }
    
    const session = sessions.get(participant.sessionId);
    if (!session) {
        console.log('Clear: Session not found');
        return;
    }
    
    console.log(`Clear from ${participant.userName} (${participant.id})`);
    
    // Clear whiteboard data
    session.whiteboard = [];
    
    // Broadcast clear to ALL participants
    broadcastToSession(participant.sessionId, {
        type: 'clear',
        userId: participant.id,
        userName: participant.userName
    });
    
    console.log(`Broadcasted clear to ${session.participants.size} participants`);
}

function handleShape(ws, data) {
    const participant = participants.get(ws);
    if (!participant) {
        console.log('Shape: Participant not found');
        return;
    }
    
    const session = sessions.get(participant.sessionId);
    if (!session) {
        console.log('Shape: Session not found');
        return;
    }
    
    console.log(`Shape from ${participant.userName} (${participant.id}):`, data.shape);
    
    // Store shape data
    const shapeData = {
        ...data,
        userId: participant.id,
        userName: participant.userName
    };
    session.whiteboard.push(shapeData);
    
    // Broadcast to ALL participants INCLUDING the sender for consistency
    broadcastToSession(participant.sessionId, {
        type: 'shape',
        ...shapeData
    }, null);
    
    console.log(`Broadcasted shape to ${session.participants.size} participants`);
}

function handleChat(ws, data) {
    const participant = participants.get(ws);
    if (!participant) {
        console.log('Chat: Participant not found');
        return;
    }
    
    const session = sessions.get(participant.sessionId);
    if (!session) {
        console.log('Chat: Session not found');
        return;
    }
    
    const message = {
        type: 'chat',
        userId: participant.id,
        userName: participant.userName,
        message: data.message,
        timestamp: Date.now()
    };
    
    console.log(`💬 FORCE CHAT from ${participant.userName}: ${data.message}`);
    
    // Store message
    session.messages.push(message);
    
    // FORCE send to ALL participants INCLUDING sender
    let sentCount = 0;
    session.participants.forEach(participantWs => {
        if (participantWs.readyState === WebSocket.OPEN) {
            participantWs.send(JSON.stringify(message));
            sentCount++;
        }
    });
    
    console.log(`💬 FORCE sent to ${sentCount} participants`);
}

function handleMediaControl(ws, data) {
    const participant = participants.get(ws);
    if (!participant) return;
    
    // Broadcast media control to other participants
    broadcastToSession(participant.sessionId, {
        type: data.type,
        from: participant.id,
        ...data
    }, ws);
}

function handleDisconnection(ws) {
    const participant = participants.get(ws);
    if (!participant) return;
    
    const session = sessions.get(participant.sessionId);
    if (session) {
        session.participants.delete(ws);
        session.users.delete(participant.id);
        
        // Only notify if not in whiteboard transition mode
        if (!session.whiteboardMode && !participant.isTransitioning) {
            broadcastToSession(participant.sessionId, {
                type: 'user-left',
                userId: participant.id,
                userName: participant.userName || 'Unknown User',
                participantCount: session.participants.size,
                isTransition: false
            });
        }
        
        console.log(`User ${participant.id} (${participant.userName}) ${participant.isTransitioning ? 'transitioned' : 'left'} session ${participant.sessionId}`);
        
        // Clean up empty sessions only if not transitioning
        if (session.participants.size === 0 && !session.whiteboardMode) {
            sessions.delete(participant.sessionId);
        }
    }
    
    participants.delete(ws);
}

function broadcastToSession(sessionId, message, excludeWs = null) {
    const session = sessions.get(sessionId);
    if (!session) return;
    
    const messageStr = JSON.stringify(message);
    session.participants.forEach(ws => {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(messageStr);
        }
    });
}

function handleAdmitUser(ws, data) {
    const host = participants.get(ws);
    if (!host || host.role !== 'host') return;
    
    const session = sessions.get(host.sessionId);
    if (!session) return;
    
    const { userId } = data;
    const participantWs = session.pendingRequests.get(userId);
    
    if (participantWs) {
        // Move from pending to admitted
        session.pendingRequests.delete(userId);
        session.participants.add(participantWs);
        session.users.set(userId, participantWs);
        session.admittedUsers.add(userId);
        
        // Update participant status
        const participant = participants.get(participantWs);
        participant.status = 'admitted';
        
        // Get existing users before adding new one
        const existingUsers = Array.from(session.users.keys()).filter(id => id !== userId);
        
        // Send admission confirmation to participant with host info
        const hostInfo = participants.get(session.users.get(session.host));
        participantWs.send(JSON.stringify({
            type: 'admitted-to-meeting',
            sessionId: host.sessionId,
            yourUserId: userId,
            existingUsers: existingUsers.map(id => ({
                userId: id,
                userName: participants.get(session.users.get(id))?.userName || 'Host'
            })),
            hostInfo: {
                userId: session.host,
                userName: hostInfo?.userName || 'Host'
            }
        }));
        
        // Notify all existing participants about new user joining
        broadcastToSession(host.sessionId, {
            type: 'user-joined',
            userId: userId,
            userName: participant.userName,
            participantCount: session.users.size
        }, participantWs);
        
        console.log(`User ${userId} admitted. Existing users: ${existingUsers.join(', ')}`);
        
        console.log(`Host admitted user ${userId} to session ${host.sessionId}`);
    }
}

function handleRejectUser(ws, data) {
    const host = participants.get(ws);
    if (!host || host.role !== 'host') return;
    
    const session = sessions.get(host.sessionId);
    if (!session) return;
    
    const { userId } = data;
    const participantWs = session.pendingRequests.get(userId);
    
    if (participantWs) {
        // Remove from pending requests
        session.pendingRequests.delete(userId);
        participants.delete(participantWs);
        
        // Send rejection message
        participantWs.send(JSON.stringify({
            type: 'rejected-from-meeting',
            message: 'Host has denied your request to join the meeting'
        }));
        
        // Close connection
        participantWs.close();
        
        console.log(`Host rejected user ${userId} from session ${host.sessionId}`);
    }
}

function handleEndMeeting(ws, data) {
    const host = participants.get(ws);
    if (!host || host.role !== 'host') return;
    
    const session = sessions.get(host.sessionId);
    if (!session) return;
    
    // Notify all participants that meeting is ending
    broadcastToSession(host.sessionId, {
        type: 'meeting-ended',
        message: 'Host has ended the meeting'
    });
    
    // Close all connections
    session.participants.forEach(participantWs => {
        if (participantWs.readyState === WebSocket.OPEN) {
            participantWs.close();
        }
    });
    
    session.pendingRequests.forEach(pendingWs => {
        if (pendingWs.readyState === WebSocket.OPEN) {
            pendingWs.close();
        }
    });
    
    // Clean up session
    sessions.delete(host.sessionId);
    
    console.log(`Host ended meeting ${host.sessionId}`);
}

function handleWhiteboardSwitch(ws, data) {
    const participant = participants.get(ws);
    if (!participant || participant.role !== 'host') return;
    
    const session = sessions.get(participant.sessionId);
    if (!session) return;
    
    console.log(`Host ${participant.id} switched to whiteboard - maintaining session`);
    
    // Mark session as in whiteboard mode
    session.whiteboardMode = true;
    
    // Notify all participants to switch to whiteboard (including host)
    broadcastToSession(participant.sessionId, {
        type: 'switch-to-whiteboard',
        sessionId: participant.sessionId,
        hostName: participant.userName
    });
}

function handleVideoSwitch(ws, data) {
    const participant = participants.get(ws);
    if (!participant) return;
    
    const session = sessions.get(participant.sessionId);
    if (!session) return;
    
    console.log(`User ${participant.id} switched to video call`);
    
    // Mark session as in video mode
    session.whiteboardMode = false;
    
    // Notify all participants to switch to video call (excluding sender)
    broadcastToSession(participant.sessionId, {
        type: 'switch-to-video',
        sessionId: participant.sessionId,
        userName: participant.userName,
        isTransition: true
    }, ws);
}

function handleUserLeaving(ws, data) {
    const participant = participants.get(ws);
    if (!participant) return;
    
    const session = sessions.get(participant.sessionId);
    if (!session) return;
    
    console.log(`User ${participant.id} is leaving the meeting`);
    
    // Send leave message to all participants
    broadcastToSession(participant.sessionId, {
        type: 'user-left',
        userId: participant.id,
        userName: participant.userName,
        participantCount: session.participants.size - 1,
        reason: data.reason || 'left_meeting'
    });
}

function handleWhiteboardControlTransfer(ws, data) {
    const participant = participants.get(ws);
    if (!participant || participant.role !== 'host') return;
    
    const session = sessions.get(participant.sessionId);
    if (!session) return;
    
    console.log(`🔄 Admin ${participant.id} transferring control`);
    
    let targetUserId = null;
    let targetUserName = null;
    
    // Handle participant index based transfer
    if (data.toParticipantIndex !== undefined) {
        // Get only participants (exclude host)
        const participantArray = [];
        for (const [userId, userWs] of session.users) {
            const p = participants.get(userWs);
            if (p && p.role !== 'host') {
                participantArray.push([userId, userWs]);
            }
        }
        
        const targetIndex = data.toParticipantIndex - 1; // Convert to 0-based index
        
        if (targetIndex >= 0 && targetIndex < participantArray.length) {
            const [userId, userWs] = participantArray[targetIndex];
            const targetParticipant = participants.get(userWs);
            if (targetParticipant) {
                targetUserId = targetParticipant.id;
                targetUserName = targetParticipant.userName;
            }
        }
    } else if (data.toUserId && data.toUserName) {
        // Handle direct userId and userName transfer
        targetUserId = data.toUserId;
        targetUserName = data.toUserName;
    } else {
        // Handle name-based transfer (fallback)
        for (const [userId, userWs] of session.users) {
            const targetParticipant = participants.get(userWs);
            if (targetParticipant && targetParticipant.userName === data.toUserId) {
                targetUserId = targetParticipant.id;
                targetUserName = targetParticipant.userName;
                break;
            }
        }
    }
    
    if (targetUserId) {
        console.log(`✅ Found target user: ${targetUserName} (${targetUserId})`);
        // Broadcast control transfer to all participants
        broadcastToSession(participant.sessionId, {
            type: 'transfer-whiteboard-control',
            toUserId: targetUserId,
            toUserName: targetUserName,
            fromUser: participant.userName
        });
    } else {
        console.log(`❌ Target user not found`);
    }
}

function handleTakeWhiteboardControl(ws, data) {
    const participant = participants.get(ws);
    if (!participant || participant.role !== 'host') return;
    
    const session = sessions.get(participant.sessionId);
    if (!session) return;
    
    console.log(`Admin ${participant.id} taking back whiteboard control`);
    
    // Broadcast control taken back to all participants
    broadcastToSession(participant.sessionId, {
        type: 'take-whiteboard-control',
        fromUser: participant.userName
    });
}

function handleEndWhiteboardMeeting(ws, data) {
    const host = participants.get(ws);
    if (!host || host.role !== 'host') return;
    
    const session = sessions.get(host.sessionId);
    if (!session) return;
    
    console.log(`Host ${host.id} ending whiteboard meeting ${host.sessionId}`);
    
    // Notify all participants that whiteboard meeting is ending
    broadcastToSession(host.sessionId, {
        type: 'whiteboard-meeting-ended',
        message: 'Host has ended the whiteboard meeting',
        hostName: host.userName
    });
    
    // Close all participant connections after a delay
    setTimeout(() => {
        session.participants.forEach(participantWs => {
            if (participantWs !== ws && participantWs.readyState === WebSocket.OPEN) {
                participantWs.close();
            }
        });
        
        // Clean up session
        sessions.delete(host.sessionId);
        
        console.log(`Whiteboard meeting ${host.sessionId} ended and cleaned up`);
    }, 3000);
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// REST API endpoints
app.get('/api/sessions/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session) {
        res.json({
            exists: true,
            participantCount: session.participants.size
        });
    } else {
        res.json({ exists: false });
    }
});

app.post('/api/sessions', (req, res) => {
    const sessionId = generateId();
    sessions.set(sessionId, {
        participants: new Set(),
        whiteboard: [],
        messages: []
    });
    
    res.json({ sessionId });
});

// Plan selection endpoint
app.post('/api/select-plan', (req, res) => {
    const { plan, timestamp } = req.body;
    
    console.log(`Plan selected: ${plan} at ${new Date(timestamp)}`);
    
    // Store plan selection (in real app, save to database)
    const planData = {
        plan,
        timestamp,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    };
    
    res.json({ 
        success: true, 
        message: `${plan} plan selected successfully`,
        planData 
    });
});

// Contact form endpoint
app.post('/api/contact', (req, res) => {
    const { name, email, message, timestamp } = req.body;
    
    console.log(`Contact form submission:`);
    console.log(`Name: ${name}`);
    console.log(`Email: ${email}`);
    console.log(`Message: ${message}`);
    console.log(`Time: ${new Date(timestamp)}`);
    
    // Store contact submission (in real app, save to database and send email)
    const contactData = {
        name,
        email,
        message,
        timestamp,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    };
    
    res.json({ 
        success: true, 
        message: 'Contact form submitted successfully',
        contactData 
    });
});

// Stats endpoint for about page
app.get('/api/stats', (req, res) => {
    let totalParticipants = 0;
    sessions.forEach(session => {
        totalParticipants += session.participants.size;
    });
    
    res.json({
        activeSessions: sessions.size,
        totalParticipants: totalParticipants,
        totalMeetings: sessions.size,
        avgResponseTime: '<50ms',
        uptime: '99.9%'
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`CollabMeet server running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
});