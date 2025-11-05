// Name entry modal for whiteboard participants
function showNameEntryModal() {
    return new Promise((resolve) => {
        // Create modal HTML
        const modal = document.createElement('div');
        modal.id = 'whiteboard-name-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md mx-4">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                        <i class="fas fa-pen text-purple-600 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-semibold text-gray-900">Join Whiteboard</h3>
                        <p class="text-sm text-gray-600">Enter your name to join the whiteboard</p>
                    </div>
                </div>
                
                <div class="mb-6">
                    <label for="whiteboard-participant-name" class="block text-sm font-medium text-gray-700 mb-2">
                        Your Name
                    </label>
                    <input type="text" id="whiteboard-participant-name" 
                           class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                           placeholder="Enter your full name" maxlength="50">
                    <p class="text-xs text-gray-500 mt-1">This name will be visible to other participants</p>
                </div>
                
                <div class="flex gap-3 justify-end">
                    <button onclick="cancelWhiteboardNameEntry()" class="px-4 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button onclick="confirmWhiteboardNameEntry()" class="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
                        Join Whiteboard
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.getElementById('whiteboard-participant-name').focus();
        
        // Store resolve function globally
        window.whiteboardNameResolve = resolve;
        
        // Enter key support
        document.getElementById('whiteboard-participant-name').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                confirmWhiteboardNameEntry();
            }
        });
    });
}

function confirmWhiteboardNameEntry() {
    const name = document.getElementById('whiteboard-participant-name').value.trim();
    if (name) {
        document.getElementById('whiteboard-name-modal').remove();
        if (window.whiteboardNameResolve) {
            window.whiteboardNameResolve(name);
            window.whiteboardNameResolve = null;
        }
    } else {
        const input = document.getElementById('whiteboard-participant-name');
        input.classList.add('border-red-500');
        input.placeholder = 'Name is required';
        setTimeout(() => {
            input.classList.remove('border-red-500');
            input.placeholder = 'Enter your full name';
        }, 2000);
    }
}

function cancelWhiteboardNameEntry() {
    document.getElementById('whiteboard-name-modal').remove();
    if (window.whiteboardNameResolve) {
        window.whiteboardNameResolve(null);
        window.whiteboardNameResolve = null;
    }
    window.location.href = '../index.html';
}