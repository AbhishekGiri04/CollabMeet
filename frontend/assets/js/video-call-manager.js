// WebRTC implementation for real video calls
class WebRTCManager {
    constructor(sessionId, isHost = false, userName = null) {
        this.sessionId = sessionId;
        this.isHost = isHost;
        this.myUserName = userName || (isHost ? 'Host' : 'Participant');
        this.localStream = null;
        this.peers = new Map();
        this.participantNames = new Map();
        this.ws = null;
        this.localVideo = document.getElementById('localVideo');
        this.videoGrid = document.getElementById('video-grid');
        
        this.initWebSocket();
    }
    
    initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to CollabMeet server');
            this.joinSession();
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleSignalingMessage(data);
            
            // Also handle chat messages
            if (data.type === 'chat') {
                this.handleChatMessage(data);
            }
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from server');
            setTimeout(() => this.initWebSocket(), 3000);
        };
    }
    
    async joinSession() {
        try {
            console.log('🔥 Getting user media...');
            // Get user media with better constraints
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            console.log('✅ Local stream obtained:', this.localStream.getTracks().length, 'tracks');
            
            // Set local video and ensure it plays
            this.localVideo.srcObject = this.localStream;
            this.localVideo.muted = true; // Prevent feedback
            
            // Force local video to play
            this.localVideo.onloadedmetadata = () => {
                this.localVideo.play().then(() => {
                    console.log('✅ Local video playing successfully');
                    if (this.onLocalVideoReady) {
                        this.onLocalVideoReady();
                    }
                }).catch(e => console.log('❌ Local video play failed:', e));
            };
            
            // Generate unique user ID
            this.userId = 'user_' + Math.random().toString(36).substr(2, 9);
            console.log('🔥 My user ID:', this.userId, 'Local stream tracks:', this.localStream.getTracks().length);
            
            // Wait a bit for stream to be ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Join session
            console.log('🔥 Joining session...');
            this.sendMessage({
                type: 'join',
                sessionId: this.sessionId,
                userId: this.userId,
                userRole: this.isHost ? 'admin' : 'participant',
                userName: this.myUserName,
                isWhiteboardMode: false
            });
            
        } catch (error) {
            console.error('❌ Error accessing media:', error);
            alert('Could not access camera/microphone. Please check permissions and try again.');
        }
    }
    
    async handleSignalingMessage(data) {
        switch (data.type) {
            case 'user-joined':
                console.log('🔥 User joined:', data);
                if (data.userId && data.userId !== this.userId) {
                    // Store participant name
                    if (data.userName) {
                        this.participantNames.set(data.userId, data.userName);
                    }
                    
                    // Show professional join notification
                    if (window.displayChatMessage) {
                        window.displayChatMessage('System', `${data.userName} joined the meeting`);
                    }
                    
                    console.log('🔥 Creating peer connection for new user:', data.userId, 'I am host:', this.isHost);
                    // Only create connection if we don't already have one
                    if (!this.peers.has(data.userId)) {
                        // Always create connection and let host initiate offer
                        setTimeout(() => {
                            this.createPeerConnection(data.userId, this.isHost);
                        }, 500);
                    }
                }
                this.updateParticipantCount(data.participantCount);
                break;
                
            case 'session-state':
                console.log('Session state:', data);
                if (data.yourUserId) {
                    this.userId = data.yourUserId;
                }
                if (data.yourUserName) {
                    this.myUserName = data.yourUserName;
                }
                // If we're not host, add host to participant names
                if (!this.isHost && data.hostInfo) {
                    this.participantNames.set(data.hostInfo.userId, data.hostInfo.userName);
                }
                this.updateParticipantCount(data.participantCount);
                if (data.isHost) {
                    console.log('You are the host');
                }
                break;
                
            case 'admission-request':
                if (this.onAdmissionRequest) {
                    this.onAdmissionRequest(data);
                }
                break;
                
            case 'waiting-for-admission':
                if (this.onWaitingForAdmission) {
                    this.onWaitingForAdmission();
                }
                break;
                
            case 'admitted-to-meeting':
                console.log('🔥 Admitted to meeting');
                if (this.onAdmitted) {
                    this.onAdmitted();
                }
                // Store user ID
                if (data.yourUserId) {
                    this.userId = data.yourUserId;
                }
                // Store existing users names and create connections
                if (data.existingUsers && data.existingUsers.length > 0) {
                    data.existingUsers.forEach(user => {
                        const userId = user.userId || user;
                        const userName = user.userName || 'Host';
                        this.participantNames.set(userId, userName);
                        console.log('🔥 Creating peer connection with existing user:', userId, userName);
                        // Participant should create offer to existing users (host)
                        setTimeout(() => {
                            this.createPeerConnection(userId, true);
                        }, 1000);
                    });
                }
                // Update participant count to include host + participant
                this.updateParticipantCount(data.existingUsers.length + 1);
                break;
                
            case 'rejected-from-meeting':
                if (this.onRejected) {
                    this.onRejected();
                }
                break;
                
            case 'meeting-ended':
                if (this.onMeetingEnded) {
                    this.onMeetingEnded();
                }
                break;
                
            case 'existing-users':
                console.log('Received existing users:', data.users);
                if (data.users && data.users.length > 0) {
                    data.users.forEach(userId => {
                        console.log('Creating peer connection with existing user:', userId);
                        this.createPeerConnection(userId, true);
                    });
                }
                break;
                
            case 'switch-to-whiteboard':
                console.log('Switching to whiteboard mode - maintaining connection');
                // Show notification and redirect to whiteboard
                if (window.displayChatMessage) {
                    const hostName = data.hostName || 'Host';
                    window.displayChatMessage('System', `${hostName} opened collaborative whiteboard. Switching to whiteboard mode...`);
                }
                
                // Mark as transitioning to prevent leave messages
                sessionStorage.setItem('whiteboard_transitioning', 'true');
                
                // Store connection info before redirect
                sessionStorage.setItem('webrtc_session', JSON.stringify({
                    sessionId: this.sessionId,
                    userId: this.userId,
                    userName: this.myUserName,
                    isHost: this.isHost,
                    participantNames: Array.from(this.participantNames.entries())
                }));
                
                setTimeout(() => {
                    const urlParams = new URLSearchParams(window.location.search);
                    const sessionId = urlParams.get('session');
                    const role = this.isHost ? 'admin' : 'participant';
                    window.location.href = `collaborative-board.html?session=${sessionId}&role=${role}&from=videocall`;
                }, 1500);
                break;
                
            case 'video-offer':
                await this.handleOffer(data);
                break;
                
            case 'video-answer':
                await this.handleAnswer(data);
                break;
                
            case 'ice-candidate':
                await this.handleIceCandidate(data);
                break;
                
            case 'user-left':
                console.log('Received user-left event:', data);
                const leftUserId = data.userId || data.from;
                const leftUserName = this.participantNames.get(leftUserId) || data.userName || 'Participant';
                
                // Show professional leave notification
                if (window.displayChatMessage) {
                    window.displayChatMessage('System', `${leftUserName} left the meeting`);
                }
                
                this.handleUserLeft(leftUserId);
                this.updateParticipantCount(data.participantCount);
                break;
                
            case 'session-state':
                this.updateParticipantCount(data.participantCount);
                break;
        }
    }
    
    async createPeerConnection(peerId, shouldCreateOffer) {
        console.log(`🔥 Creating peer connection with ${peerId}, shouldCreateOffer: ${shouldCreateOffer}`);
        
        // Check if we already have a connection
        if (this.peers.has(peerId)) {
            console.log('🔥 Peer connection already exists for:', peerId);
            return this.peers.get(peerId);
        }
        
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });
        
        // Add local stream to peer connection FIRST
        if (this.localStream && this.localStream.getTracks().length > 0) {
            this.localStream.getTracks().forEach(track => {
                console.log('🔥 Adding track to peer connection:', track.kind, 'enabled:', track.enabled);
                peerConnection.addTrack(track, this.localStream);
            });
        } else {
            console.log('❌ No local stream available for peer connection');
        }
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log('🔥 Received remote track from:', peerId, 'Streams:', event.streams.length);
            if (event.streams && event.streams[0]) {
                console.log('🔥 Stream tracks:', event.streams[0].getTracks().length);
                this.handleRemoteStream(peerId, event.streams[0]);
            } else {
                console.log('❌ No stream received in track event');
            }
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🔥 Sending ICE candidate to:', peerId);
                this.sendMessage({
                    type: 'ice-candidate',
                    to: peerId,
                    candidate: event.candidate
                });
            } else {
                console.log('🔥 ICE gathering complete for:', peerId);
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`🔥 Connection state with ${peerId}:`, peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                console.log('✅ Peer connection established with:', peerId);
            }
        };
        
        this.peers.set(peerId, peerConnection);
        
        if (shouldCreateOffer) {
            console.log('🔥 Creating offer for:', peerId);
            try {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await peerConnection.setLocalDescription(offer);
                
                console.log('✅ Sending offer to:', peerId);
                this.sendMessage({
                    type: 'video-offer',
                    to: peerId,
                    offer: offer
                });
            } catch (error) {
                console.error('❌ Error creating offer for', peerId, ':', error);
            }
        }
        
        return peerConnection;
    }
    
    async handleOffer(data) {
        console.log('✅ Handling offer from:', data.from);
        try {
            let peerConnection = this.peers.get(data.from);
            
            if (!peerConnection) {
                console.log('Creating new peer connection for offer from:', data.from);
                peerConnection = await this.createPeerConnection(data.from, false);
            }
            
            console.log('✅ Setting remote description for:', data.from);
            await peerConnection.setRemoteDescription(data.offer);
            
            console.log('✅ Creating answer for:', data.from);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            console.log('✅ Sending answer to:', data.from);
            this.sendMessage({
                type: 'video-answer',
                to: data.from,
                answer: answer
            });
        } catch (error) {
            console.error('❌ Error handling offer from', data.from, ':', error);
        }
    }
    
    async handleAnswer(data) {
        console.log('✅ Handling answer from:', data.from);
        try {
            const peerConnection = this.peers.get(data.from);
            if (peerConnection) {
                console.log('✅ Setting remote description (answer) for:', data.from);
                await peerConnection.setRemoteDescription(data.answer);
                console.log('✅ Answer processed successfully for:', data.from);
            } else {
                console.log('❌ No peer connection found for answer from:', data.from);
            }
        } catch (error) {
            console.error('❌ Error handling answer from', data.from, ':', error);
        }
    }
    
    async handleIceCandidate(data) {
        const peerConnection = this.peers.get(data.from);
        if (peerConnection) {
            await peerConnection.addIceCandidate(data.candidate);
        }
    }
    
    handleRemoteStream(peerId, stream) {
        console.log('Handling remote stream from:', peerId, 'Tracks:', stream.getTracks().length);
        
        // Remove existing video if any
        const existingVideo = document.getElementById(`video-${peerId}`);
        if (existingVideo) {
            console.log('Removing existing video for:', peerId);
            existingVideo.parentElement.remove();
        }
        
        // Create video element for remote participant
        const videoElement = document.createElement('video');
        videoElement.id = `video-${peerId}`;
        videoElement.srcObject = stream;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.muted = false;
        videoElement.className = 'w-full h-full object-cover';
        
        // Force video to play
        videoElement.onloadedmetadata = () => {
            console.log('Remote video metadata loaded for:', peerId);
            videoElement.play().then(() => {
                console.log('✅ Remote video playing successfully for:', peerId);
            }).catch(e => {
                console.log('❌ Remote video play failed for', peerId, ':', e);
                // Try to play again after a short delay
                setTimeout(() => {
                    videoElement.play().catch(e2 => console.log('Retry failed:', e2));
                }, 1000);
            });
        };
        
        // Also try to play immediately
        setTimeout(() => {
            if (videoElement.paused) {
                videoElement.play().catch(e => console.log('Immediate play failed:', e));
            }
        }, 500);
        
        // Get participant name from stored data
        const participantName = this.participantNames?.get(peerId) || (this.isHost ? 'Participant' : 'Host');
        
        const videoContainer = document.createElement('div');
        videoContainer.className = 'relative bg-gray-900 rounded-xl overflow-hidden aspect-video';
        videoContainer.id = `container-${peerId}`;
        videoContainer.innerHTML = `
            <div class="absolute bottom-3 left-3 bg-black bg-opacity-60 text-white px-2 py-1 rounded text-sm">
                ${participantName}
            </div>
        `;
        
        videoContainer.appendChild(videoElement);
        this.videoGrid.appendChild(videoContainer);
        this.updateVideoGrid();
        
        console.log('✅ Remote video container added to grid for:', participantName);
    }
    
    handleUserLeft(peerId) {
        console.log('User left:', peerId);
        
        // Close peer connection
        const peerConnection = this.peers.get(peerId);
        if (peerConnection) {
            peerConnection.close();
            this.peers.delete(peerId);
            console.log('✅ Peer connection closed for:', peerId);
        }
        
        // Remove video container
        const videoContainer = document.getElementById(`container-${peerId}`);
        if (videoContainer) {
            videoContainer.remove();
            console.log('✅ Video container removed for:', peerId);
            this.updateVideoGrid();
        }
        
        // Remove from participant names
        if (this.participantNames) {
            this.participantNames.delete(peerId);
        }
    }
    
    updateVideoGrid() {
        const totalVideos = this.videoGrid.children.length;
        
        if (totalVideos <= 1) {
            this.videoGrid.className = 'grid grid-cols-1 gap-4 max-w-4xl mx-auto p-8';
        } else if (totalVideos <= 4) {
            this.videoGrid.className = 'grid grid-cols-2 gap-4 max-w-4xl mx-auto p-8';
        } else {
            this.videoGrid.className = 'grid grid-cols-3 gap-4 max-w-6xl mx-auto p-8';
        }
    }
    
    updateParticipantCount(count) {
        const participantCountEl = document.getElementById('participant-count');
        if (participantCountEl) {
            participantCountEl.textContent = count || 1;
        }
        
        // Update participants list if function exists
        if (window.updateParticipantsList) {
            const participants = Array.from(this.participantNames.entries()).map(([id, name]) => ({
                id: id,
                name: name,
                role: this.isHost ? 'Participant' : 'Host'
            }));
            window.updateParticipantsList(count, participants, this.myUserName, this.isHost);
        }
    }
    
    handleChatMessage(data) {
        // Forward to video-meet.html chat display
        if (window.displayChatMessage) {
            window.displayChatMessage(data.userName, data.message);
        }
    }
    
    sendChatMessage(message) {
        this.sendMessage({
            type: 'chat',
            message: message,
            userName: this.myUserName || (this.isHost ? 'Host' : 'Participant')
        });
    }
    
    admitUser(userId) {
        this.sendMessage({
            type: 'admit-user',
            userId: userId
        });
    }
    
    rejectUser(userId) {
        this.sendMessage({
            type: 'reject-user',
            userId: userId
        });
    }
    
    endMeeting() {
        this.sendMessage({
            type: 'end-meeting'
        });
    }
    
    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                
                // Notify other participants
                this.sendMessage({
                    type: 'mute',
                    muted: !audioTrack.enabled
                });
                
                return !audioTrack.enabled;
            }
        }
        return false;
    }
    
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                
                // Notify other participants
                this.sendMessage({
                    type: 'video-toggle',
                    videoOff: !videoTrack.enabled
                });
                
                return !videoTrack.enabled;
            }
        }
        return false;
    }
    
    async shareScreen() {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            
            // Replace video track in all peer connections
            const videoTrack = screenStream.getVideoTracks()[0];
            
            this.peers.forEach(async (peerConnection) => {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender) {
                    await sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local video
            this.localVideo.srcObject = screenStream;
            
            // Handle screen share end
            videoTrack.onended = () => {
                this.stopScreenShare();
            };
            
        } catch (error) {
            console.error('Error sharing screen:', error);
        }
    }
    
    async stopScreenShare() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            
            // Replace screen share with camera in all peer connections
            this.peers.forEach(async (peerConnection) => {
                const sender = peerConnection.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender) {
                    await sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local video
            this.localVideo.srcObject = this.localStream;
        }
    }
    
    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                sessionId: this.sessionId,
                ...message
            }));
        }
    }
    
    disconnect() {
        // Close all peer connections
        this.peers.forEach(peerConnection => {
            peerConnection.close();
        });
        this.peers.clear();
        
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        // Close WebSocket
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Export for use in other files
window.WebRTCManager = WebRTCManager;