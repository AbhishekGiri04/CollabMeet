// Primary functions - Video Call with Whiteboard
function startNewMeeting() {
    const sessionId = Math.random().toString(36).substr(2, 9);
    window.location.href = `pages/meeting-room.html?session=${sessionId}&role=admin`;
}

function joinVideoSession() {
    const sessionCode = document.getElementById('join_meeting_input').value.trim();
    if (sessionCode) {
        // Extract session ID from different formats
        let sessionId = sessionCode;
        
        // Handle "Meeting ID: xyz" format
        if (sessionCode.startsWith('Meeting ID: ')) {
            sessionId = sessionCode.replace('Meeting ID: ', '').trim();
        }
        // Handle "Session: xyz" format  
        else if (sessionCode.startsWith('Session: ')) {
            sessionId = sessionCode.replace('Session: ', '').trim();
        }
        
        // Validate session ID format
        if (sessionId.length >= 8) {
            // Check if it's a whiteboard session or video meeting
            const whiteboardKey = `whiteboard_${sessionId}`;
            const videoKey = `meeting_${sessionId}`;
            
            const whiteboardExists = localStorage.getItem(whiteboardKey);
            const videoExists = localStorage.getItem(videoKey);
            
            if (whiteboardExists && videoExists) {
                // Both exist - show choice
                const choice = confirm('This session has both video meeting and whiteboard.\n\nClick OK for Video Meeting\nClick Cancel for Whiteboard');
                if (choice) {
                    window.location.href = `pages/meeting-room.html?session=${sessionId}&role=participant`;
                } else {
                    window.location.href = `pages/collaborative-board.html?session=${sessionId}&role=participant`;
                }
            } else if (whiteboardExists) {
                window.location.href = `pages/collaborative-board.html?session=${sessionId}&role=participant`;
            } else {
                // Default to video meeting
                window.location.href = `pages/meeting-room.html?session=${sessionId}&role=participant`;
            }
        } else {
            showToast('error', 'Invalid Session ID', 'Please enter a valid meeting ID or session ID.');
        }
    } else {
        showToast('error', 'Session Required', 'Please enter a meeting ID or session ID to join.');
    }
}

// Alternative - Whiteboard only
function startWhiteboardOnly() {
    const sessionId = Math.random().toString(36).substr(2, 9);
    window.location.href = `pages/collaborative-board.html?session=${sessionId}&role=admin`;
}

function startWhiteboardSession() {
    const sessionId = Math.random().toString(36).substr(2, 9);
    window.location.href = `pages/collaborative-board.html?session=${sessionId}&role=admin`;
}

function joinWhiteboardSession() {
    const whiteboardId = document.getElementById('join_whiteboard_input').value.trim();
    
    if (!whiteboardId) {
        showToast('error', 'Whiteboard ID Required', 'Please enter a valid whiteboard ID to join.');
        return;
    }
    
    if (whiteboardId.length < 8) {
        showToast('error', 'Invalid Whiteboard ID', 'Whiteboard ID must be at least 8 characters long.');
        return;
    }
    
    // Redirect to whiteboard page with session ID
    window.location.href = `pages/collaborative-board.html?session=${whiteboardId}&role=participant`;
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Header join button
    const headerJoinBtn = document.getElementById('header_join_btn');
    if (headerJoinBtn) {
        headerJoinBtn.addEventListener('click', () => {
            document.getElementById('join_meeting_input').focus();
        });
    }
    
    // Enter key support
    const joinInput = document.getElementById('join_meeting_input');
    if (joinInput) {
        joinInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                joinVideoSession();
            }
        });
    }
    

});

// Demo functions
function demoAI() {
    alert('🧠 AI Features Demo:\n\n• OCR: Convert handwriting to text\n• Shape Recognition: Clean up drawings\n• Smart Suggestions: AI-powered improvements\n\nTry these in the whiteboard!');
}

function showFeatures() {
    alert('🎨 CollabMeet Features:\n\n✅ Real-time collaboration\n✅ AI-powered tools\n✅ Video integration\n✅ Cross-platform support\n✅ No downloads required');
}

// Toggle CollabMeet content dropdown
function toggleCollabMeetContent() {
    const content = document.getElementById('collabmeet-content');
    const arrow = document.getElementById('dropdown-arrow');
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        arrow.style.transform = 'rotate(180deg)';
    } else {
        content.classList.add('hidden');
        arrow.style.transform = 'rotate(0deg)';
    }
}

// Toast notification functions
function showToast(type, title, message) {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    const titleEl = document.getElementById('toast-title');
    const messageEl = document.getElementById('toast-message');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    if (type === 'error') {
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
    toast.classList.remove('translate-x-0');
    toast.classList.add('translate-x-full');
}

console.log('🎨 CollabMeet Ready! Click Start Whiteboard to begin.');